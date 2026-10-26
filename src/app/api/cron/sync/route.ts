import { timingSafeEqual } from "node:crypto";
import { env, isGoogleConfigured, isSlackConfigured } from "@/lib/server/env";
import { startWatch } from "@/lib/server/google";
import { json, route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { sendDailyDigest } from "@/lib/server/slack";
import { listUsersToRefresh, Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily job (Vercel Cron, `Authorization: Bearer $CRON_SECRET`): renews expiring Google watch
 * channels, re-syncs and re-plans every active user (which also catches tasks that silently ran
 * over and sends Slack deadline alerts), and sends the Slack morning summary.
 */
export const GET = route(async (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret}`;
  if (!env.cronSecret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await listUsersToRefresh();
  let synced = 0;
  let renewed = 0;
  let digests = 0;
  let failed = 0;
  for (const u of users) {
    try {
      if (u.google && isGoogleConfigured() && (!u.channelExpiresAt || new Date(u.channelExpiresAt).getTime() - Date.now() < 2 * 86_400_000)) {
        await startWatch(new Store(u.userId));
        renewed++;
      }
      const state = await replanForUser(u.userId, { trigger: "cron", sync: u.google && isGoogleConfigured() ? "always" : "never" });
      synced++;
      if (isSlackConfigured()) {
        await sendDailyDigest(u.userId, state);
        digests++;
      }
    } catch (e) {
      failed++;
      console.error("cron refresh failed", u.userId, e);
    }
  }
  return json({ users: users.length, synced, renewed, digests, failed });
});
