import { after } from "next/server";
import { z } from "zod";
import { signSlackLinkToken } from "@/lib/server/embed-token";
import { env, isSlackConfigured } from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { addTimeToTask, replanForUser } from "@/lib/server/planner";
import { linkedUser, respond } from "@/lib/server/slack";
import { Store } from "@/lib/server/store";
import { fmtDateTime } from "@/lib/format";
import { ACTION_DONE, ACTION_MORE_30, connectMessage } from "@/lib/slack/messages";
import { verifySlackSignature } from "@/lib/slack/signature";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  type: z.string(),
  user: z.object({ id: z.string(), team_id: z.string().optional() }),
  team: z.object({ id: z.string() }).nullable().optional(),
  response_url: z.string().optional(),
  actions: z.array(z.object({ action_id: z.string(), value: z.string().optional() })).optional(),
});

const note = (text: string) => ({ text, blocks: [{ type: "section" as const, text: { type: "mrkdwn" as const, text } }] });

/** Button clicks from our messages ("Done", "+30 min"). Answer fast, report back via response_url. */
export const POST = route(async (req: Request) => {
  if (!isSlackConfigured()) return json({ error: "Slack is not configured" }, { status: 503 });
  const raw = await req.text();
  const ok = verifySlackSignature({
    signingSecret: env.slackSigningSecret,
    rawBody: raw,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!ok) return json({ error: "Invalid signature" }, { status: 401 });

  const payload = payloadSchema.parse(JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}"));
  const action = payload.actions?.[0];
  if (payload.type !== "block_actions" || !action || !payload.response_url) return new Response(null, { status: 200 });
  if (action.action_id !== ACTION_DONE && action.action_id !== ACTION_MORE_30) return new Response(null, { status: 200 }); // link buttons
  const responseUrl = payload.response_url;
  const teamId = payload.team?.id ?? payload.user.team_id ?? "";
  const slackUserId = payload.user.id;

  after(async () => {
    try {
      const userId = await linkedUser(teamId, slackUserId);
      if (!userId) {
        const token = await signSlackLinkToken({ teamId, slackUserId }, env.embedSigningSecret);
        return await respond(responseUrl, connectMessage(`${env.appUrl}/slack/link?t=${token}`));
      }
      const taskId = z.uuid().parse(action.value);
      const task = await new Store(userId).getTask(taskId);
      if (!task) return await respond(responseUrl, note("That task no longer exists."));
      if (action.action_id === ACTION_DONE) {
        await new Store(userId).updateTask(taskId, { status: "done" });
        await replanForUser(userId, { trigger: "slack-done", sync: "never" });
        return await respond(responseUrl, note(`:white_check_mark: *${task.title}* marked done. Its time is free again.`));
      }
      const state = await addTimeToTask(userId, taskId, 30, "slack-overrun");
      const p = state.plans[taskId];
      const tz = state.settings.timezone;
      await respond(responseUrl, note(`Added 30 min to *${task.title}*.${p?.finishAt ? ` Now finishing ${fmtDateTime(p.finishAt, tz)}.` : ""}`));
    } catch (e) {
      console.error("slack interaction failed", e);
      await respond(responseUrl, note("That didn't work. Try again in the planner.")).catch(() => undefined);
    }
  });
  return new Response(null, { status: 200 });
});
