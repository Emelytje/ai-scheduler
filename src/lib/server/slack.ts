import "server-only";
import type { SchedulerState } from "@/lib/client/types";
import { alertMessage, diffAlerts, isAtRisk, planMessage, type SlackMessage } from "@/lib/slack/messages";
import { decrypt, encrypt } from "./crypto";
import { env, isSlackConfigured } from "./env";
import { supabaseAdmin } from "./supabase";

/** Bot scopes: slash commands and sending messages. Nothing that reads workspace content. */
export const SLACK_BOT_SCOPES = ["commands", "chat:write"];
export const slackRedirectUri = () => `${env.appUrl}/api/slack/oauth`;

export function slackInstallUrl(state: string): string {
  const p = new URLSearchParams({ client_id: env.slackClientId, scope: SLACK_BOT_SCOPES.join(","), redirect_uri: slackRedirectUri(), state });
  return `https://slack.com/oauth/v2/authorize?${p}`;
}

async function slackApi<T>(method: string, body: Record<string, unknown>, token?: string, form = false): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: form
      ? { "content-type": "application/x-www-form-urlencoded" }
      : { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
    body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? "unknown"}`);
  return json;
}

/** Finish "Add to Slack": store the workspace's bot token and link the installer. */
export async function completeInstall(code: string, installerUserId: string) {
  const r = await slackApi<{
    access_token: string;
    bot_user_id: string;
    team: { id: string; name: string };
    authed_user?: { id: string };
  }>("oauth.v2.access", { client_id: env.slackClientId, client_secret: env.slackClientSecret, code, redirect_uri: slackRedirectUri() }, undefined, true);
  const db = supabaseAdmin();
  const { error } = await db.from("slack_installations").upsert({
    team_id: r.team.id,
    team_name: r.team.name,
    bot_user_id: r.bot_user_id,
    bot_token_enc: encrypt(r.access_token),
    installed_by: installerUserId,
    installed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  if (r.authed_user?.id) await linkSlackUser(r.team.id, r.authed_user.id, installerUserId);
  return { teamName: r.team.name };
}

export async function teamName(teamId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("slack_installations").select("team_name").eq("team_id", teamId).maybeSingle();
  return (data?.team_name as string | undefined) ?? null;
}

async function botToken(teamId: string): Promise<string> {
  const { data, error } = await supabaseAdmin().from("slack_installations").select("bot_token_enc").eq("team_id", teamId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Slack workspace ${teamId} is not installed`);
  return decrypt(data.bot_token_enc as string);
}

export async function linkedUser(teamId: string, slackUserId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("slack_links").select("user_id").eq("team_id", teamId).eq("slack_user_id", slackUserId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.user_id as string | undefined) ?? null;
}

export async function linkSlackUser(teamId: string, slackUserId: string, userId: string) {
  const { error } = await supabaseAdmin().from("slack_links").upsert({ team_id: teamId, slack_user_id: slackUserId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function unlinkSlack(userId: string) {
  const { error } = await supabaseAdmin().from("slack_links").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function linksForUser(userId: string): Promise<{ team_id: string; slack_user_id: string }[]> {
  const { data, error } = await supabaseAdmin().from("slack_links").select("team_id, slack_user_id").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as { team_id: string; slack_user_id: string }[];
}

/** Message from the app's bot to a user (appears in the app's Messages tab). */
export async function sendDM(teamId: string, slackUserId: string, message: SlackMessage) {
  await slackApi("chat.postMessage", { channel: slackUserId, text: message.text, blocks: message.blocks, unfurl_links: false }, await botToken(teamId));
}

/** Reply to a slash command or button click after the 3-second window. */
export async function respond(responseUrl: string, message: SlackMessage & { replace_original?: boolean }) {
  if (!responseUrl.startsWith("https://hooks.slack.com/")) throw new Error("Unexpected Slack response_url");
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", ...message }),
  });
}

/** DM linked Slack users about tasks that newly became at risk. Called after every re-plan. */
export async function notifyDeadlineRisks(userId: string, state: SchedulerState) {
  if (!isSlackConfigured()) return;
  const links = await linksForUser(userId);
  if (!links.length) return;
  const db = supabaseAdmin();
  const { data, error } = await db.from("slack_alerts").select("task_id, status").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const alerted = new Map((data ?? []).map((r) => [r.task_id as string, r.status as string]));
  const { send, clear } = diffAlerts(state, alerted);
  if (clear.length) await db.from("slack_alerts").delete().eq("user_id", userId).in("task_id", clear);
  if (!send.length) return;
  const message = alertMessage(send, state.settings.timezone, env.appUrl);
  for (const l of links) await sendDM(l.team_id, l.slack_user_id, message);
  const { error: upsertError } = await db
    .from("slack_alerts")
    .upsert(send.map((s) => ({ user_id: userId, task_id: s.task.id, status: s.plan.status, sent_at: new Date().toISOString() })));
  if (upsertError) throw new Error(upsertError.message);
}

/** Morning summary, sent by the daily cron job. */
export async function sendDailyDigest(userId: string, state: SchedulerState) {
  if (!isSlackConfigured()) return;
  const links = await linksForUser(userId);
  if (!links.length) return;
  const now = new Date();
  const endOfDay = new Date(now.getTime() + 24 * 3_600_000);
  const hasWorkToday = state.blocks.some((b) => new Date(b.end) > now && new Date(b.start) < endOfDay);
  const hasRisk = state.tasks.some((t) => t.status === "open" && isAtRisk(state.plans[t.id]));
  if (!hasWorkToday && !hasRisk) return; // nothing to say (weekends, holidays)
  const message = planMessage(state, now, "today", env.appUrl);
  for (const l of links) await sendDM(l.team_id, l.slack_user_id, message);
}
