import "server-only";
import { decodeJwt } from "jose";
import { blockToGoogleEvent, mapGoogleEvent, type GoogleEvent } from "@/lib/google/mapping";
import type { CalendarEvent, ScheduledBlock, Task } from "@/lib/scheduler/types";
import { decrypt, encrypt, randomToken } from "./crypto";
import { env } from "./env";
import type { Store, StoredBlock } from "./store";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

/** Least privilege: read/write events only (no calendar settings, no other Google data). */
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export const redirectUri = () => `${env.appUrl}/api/google/callback`;

export class GoogleAuthError extends Error {}

export function authorizationUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GoogleAuthError("Google access was revoked or expired. Connect Google Calendar again.");
    throw new Error(`Google token request failed (${res.status}): ${json.error ?? "unknown"}`);
  }
  return json as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string };
}

/** Exchange the OAuth code and store the encrypted tokens. */
export async function connect(store: Store, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access in your Google account and try again.");
  if (!t.scope?.includes("calendar.events")) throw new Error("Calendar access was not granted. Tick the calendar permission when connecting.");
  const email = t.id_token ? ((decodeJwt(t.id_token).email as string | undefined) ?? null) : null;
  await store.saveConnection({
    email,
    refresh_token_enc: encrypt(t.refresh_token),
    access_token_enc: encrypt(t.access_token),
    access_token_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    error: null,
  });
}

async function accessToken(store: Store): Promise<string> {
  const c = await store.getConnection();
  if (!c) throw new GoogleAuthError("Google Calendar is not connected");
  if (c.access_token_enc && c.access_token_expires_at && new Date(c.access_token_expires_at) > new Date()) return decrypt(c.access_token_enc);
  try {
    const t = await tokenRequest({ refresh_token: decrypt(c.refresh_token_enc), grant_type: "refresh_token" });
    await store.saveConnection({
      ...c,
      access_token_enc: encrypt(t.access_token),
      access_token_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    });
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleAuthError) await store.saveConnection({ ...c, error: e.message });
    throw e;
  }
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204 || res.status === 410) return undefined as T;
  if (!res.ok) throw new Error(`Google Calendar API ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Fetch events in [from, to) from the primary calendar, expanding recurring events. */
export async function fetchEvents(store: Store, from: Date, to: Date, timezone: string): Promise<CalendarEvent[]> {
  const token = await accessToken(store);
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      showDeleted: "false",
    });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await api<{ items?: GoogleEvent[]; nextPageToken?: string }>(token, `/calendars/primary/events?${q}`);
    for (const e of page.items ?? []) {
      const mapped = mapGoogleEvent(e, timezone);
      if (mapped) out.push(mapped);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** Ask Google to call our webhook when the primary calendar changes (max ~7 days). */
export async function startWatch(store: Store) {
  if (!env.appUrl.startsWith("https://")) return; // Google only delivers to public HTTPS URLs.
  const token = await accessToken(store);
  const id = crypto.randomUUID();
  const channelToken = randomToken(24);
  const res = await api<{ resourceId: string; expiration: string }>(token, "/calendars/primary/events/watch", {
    method: "POST",
    body: JSON.stringify({ id, type: "web_hook", address: `${env.appUrl}/api/google/webhook`, token: channelToken, params: { ttl: "604800" } }),
  });
  const c = await store.getConnection();
  if (c?.channel_id && c.channel_resource_id) await stopWatch(token, c.channel_id, c.channel_resource_id).catch(() => undefined);
  await store.saveConnection({
    ...c!,
    channel_id: id,
    channel_resource_id: res.resourceId,
    channel_token: channelToken,
    channel_expires_at: new Date(Number(res.expiration)).toISOString(),
  });
}

async function stopWatch(token: string, id: string, resourceId: string) {
  await api(token, "/channels/stop", { method: "POST", body: JSON.stringify({ id, resourceId }) });
}

/** Revoke access, stop notifications, forget tokens and cached events. */
export async function disconnect(store: Store) {
  const c = await store.getConnection();
  if (c) {
    try {
      const token = await accessToken(store);
      if (c.channel_id && c.channel_resource_id) await stopWatch(token, c.channel_id, c.channel_resource_id).catch(() => undefined);
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(c.refresh_token_enc))}`, { method: "POST" }).catch(() => undefined);
    } catch {
      // Already revoked: just forget it.
    }
  }
  await store.deleteConnection();
  await store.clearEvents();
}

/**
 * Mirror the plan into Google Calendar: create events for new blocks, move changed ones,
 * delete removed ones. Only touches events carrying our private marker.
 */
export async function writeBack(
  store: Store,
  diff: { created: ScheduledBlock[]; updated: ScheduledBlock[]; deleted: StoredBlock[] },
  blocksById: Map<string, StoredBlock>,
  tasks: Task[],
) {
  const token = await accessToken(store);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const ids: { id: string; googleEventId: string | null }[] = [];
  const jobs: (() => Promise<void>)[] = [];

  for (const b of [...diff.created, ...diff.updated]) {
    const existing = blocksById.get(b.id)?.googleEventId;
    const body = JSON.stringify(blockToGoogleEvent(b, taskById.get(b.taskId), env.appUrl));
    jobs.push(async () => {
      if (existing) {
        const updated = await api<{ id: string } | undefined>(token, `/calendars/primary/events/${encodeURIComponent(existing)}`, { method: "PATCH", body });
        if (updated) return;
      }
      const created = await api<{ id: string }>(token, "/calendars/primary/events", { method: "POST", body });
      ids.push({ id: b.id, googleEventId: created.id });
    });
  }
  for (const b of diff.deleted) {
    if (!b.googleEventId) continue;
    jobs.push(async () => {
      await api(token, `/calendars/primary/events/${encodeURIComponent(b.googleEventId!)}`, { method: "DELETE" });
    });
  }
  await runLimited(jobs, 5);
  if (ids.length) await store.setBlockGoogleIds(ids);
}

async function runLimited(jobs: (() => Promise<void>)[], limit: number) {
  const errors: unknown[] = [];
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      await job().catch((e) => errors.push(e));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  if (errors.length) throw new AggregateError(errors, `${errors.length} calendar write(s) failed`);
}
