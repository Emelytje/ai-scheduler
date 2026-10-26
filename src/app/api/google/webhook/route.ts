import { timingSafeEqual } from "node:crypto";
import { route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { userForChannel } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Google Calendar push notification: a meeting was added, moved or removed. We re-sync and
 * re-plan straight away. Google retries on non-2xx, so unknown channels get 200 as well.
 */
export const POST = route(async (req: Request) => {
  const channelId = req.headers.get("x-goog-channel-id");
  const state = req.headers.get("x-goog-resource-state");
  const token = req.headers.get("x-goog-channel-token") ?? "";
  if (!channelId) return new Response(null, { status: 400 });
  const owner = await userForChannel(channelId);
  if (!owner || !owner.token || !same(owner.token, token)) return new Response(null, { status: 200 });
  if (state === "sync") return new Response(null, { status: 200 }); // handshake on channel creation
  await replanForUser(owner.userId, { trigger: "google-webhook", sync: "always" });
  return new Response(null, { status: 200 });
});
