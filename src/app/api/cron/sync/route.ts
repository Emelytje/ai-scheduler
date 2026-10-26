import { timingSafeEqual } from "node:crypto";
import { env, isGoogleConfigured } from "@/lib/server/env";
import { startWatch } from "@/lib/server/google";
import { json, route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { listConnectedUsers, Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Safety net next to push notifications: renews expiring watch channels and re-syncs every
 * connected calendar (also moves the plan forward for tasks that ran over).
 * Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = route(async (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret}`;
  if (!env.cronSecret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGoogleConfigured()) return json({ synced: 0, renewed: 0, failed: 0 });
  const users = await listConnectedUsers();
  let synced = 0;
  let renewed = 0;
  let failed = 0;
  for (const u of users) {
    try {
      if (!u.channel_expires_at || new Date(u.channel_expires_at).getTime() - Date.now() < 2 * 86_400_000) {
        await startWatch(new Store(u.user_id));
        renewed++;
      }
      await replanForUser(u.user_id, { trigger: "cron", sync: "always" });
      synced++;
    } catch (e) {
      failed++;
      console.error("cron sync failed", u.user_id, e);
    }
  }
  return json({ synced, renewed, failed });
});
