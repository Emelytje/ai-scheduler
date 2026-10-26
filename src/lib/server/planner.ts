import "server-only";
import { after } from "next/server";
import { plan } from "@/lib/scheduler/engine";
import type { SchedulerState } from "@/lib/client/types";
import type { Settings } from "@/lib/scheduler/types";
import { GoogleAuthError, fetchEvents, writeBack } from "./google";
import { isGoogleConfigured } from "./env";
import { Store, type StoredBlock } from "./store";

const SYNC_WINDOW_DAYS = 60;
const STALE_AFTER_MS = 2 * 60_000;

export type SyncMode = "always" | "if-stale" | "never";

/** Pull the user's Google events for the planning window into the cache. */
export async function syncCalendar(store: Store, settings: Settings) {
  const now = Date.now();
  const from = new Date(now - 86_400_000);
  const to = new Date(now + SYNC_WINDOW_DAYS * 86_400_000);
  const events = await fetchEvents(store, from, to, settings.timezone);
  await store.replaceEventsInWindow(from, to, events);
  const c = await store.getConnection();
  if (c) await store.saveConnection({ ...c, last_sync_at: new Date().toISOString(), error: null });
}

/**
 * Sync (optionally), re-plan and persist for one user. Used by every API mutation, the
 * Google webhook and the cron job, so all paths share the same rules.
 */
export async function replanForUser(userId: string, opts: { trigger: string; sync: SyncMode }): Promise<SchedulerState> {
  const started = performance.now();
  const store = new Store(userId);
  const [settings, initialConnection] = await Promise.all([store.getSettings(), store.getConnection()]);
  let connection = initialConnection;
  let calendarError = connection?.error ?? null;

  const stale = !connection?.last_sync_at || Date.now() - new Date(connection.last_sync_at).getTime() > STALE_AFTER_MS;
  if (connection && isGoogleConfigured() && !connection.error && (opts.sync === "always" || (opts.sync === "if-stale" && stale))) {
    try {
      await syncCalendar(store, settings);
      connection = await store.getConnection();
    } catch (e) {
      calendarError = e instanceof GoogleAuthError ? e.message : "Couldn't reach Google Calendar; showing the last synced meetings.";
      console.error("calendar sync failed", userId, e);
    }
  }

  const [tasks, events, stored] = await Promise.all([store.listTasks(), store.listEvents(), store.listBlocks()]);
  const now = new Date();
  const result = plan({ tasks, events, previousBlocks: stored, settings, now });

  // Persist what changed among unfinished blocks (new, moved, shortened or removed).
  const storedById = new Map(stored.map((b) => [b.id, b]));
  const unfinished: StoredBlock[] = result.blocks
    .filter((b) => new Date(b.end) >= now)
    .map((b) => ({ ...b, googleEventId: storedById.get(b.id)?.googleEventId ?? null }));
  const resultIds = new Set(result.blocks.map((b) => b.id));
  const created = unfinished.filter((b) => !storedById.has(b.id));
  const updated = unfinished.filter((b) => {
    const s = storedById.get(b.id);
    return s && (s.start !== b.start || s.end !== b.end);
  });
  const deleted = stored.filter((b) => new Date(b.end) > now && !resultIds.has(b.id));
  if (created.length || updated.length || deleted.length) await store.replaceUnfinishedBlocks(now, unfinished);

  const totalMs = performance.now() - started;
  const canWrite = connection && connection.write_blocks && !connection.error && isGoogleConfigured();
  after(async () => {
    if (canWrite && (created.length || updated.length || deleted.length)) {
      try {
        await writeBack(store, { created, updated, deleted }, new Map(unfinished.map((b) => [b.id, b])), tasks);
      } catch (e) {
        console.error("calendar write-back failed", userId, e);
      }
    }
    await store
      .recordPlanRun({
        trigger: opts.trigger,
        engineMs: result.durationMs,
        totalMs,
        created: created.length,
        updated: updated.length,
        deleted: deleted.length,
      })
      .catch((e) => console.error("plan run log failed", e));
  });

  return {
    mode: "live",
    tasks,
    events,
    blocks: result.blocks,
    plans: result.plans,
    settings,
    calendar: {
      provider: connection ? "google" : null,
      connected: !!connection && !calendarError,
      email: connection?.email ?? null,
      lastSyncAt: connection?.last_sync_at ?? null,
      error: calendarError,
    },
    lastPlannedAt: result.computedAt,
    lastPlanMs: result.durationMs,
  };
}
