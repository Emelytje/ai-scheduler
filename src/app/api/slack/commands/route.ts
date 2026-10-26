import { signSlackLinkToken } from "@/lib/server/embed-token";
import { env, isSlackConfigured } from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { linkedUser } from "@/lib/server/slack";
import { Store } from "@/lib/server/store";
import { parseCommand } from "@/lib/slack/commands";
import { addedMessage, connectMessage, helpMessage, planMessage, risksMessage, type SlackMessage } from "@/lib/slack/messages";
import { verifySlackSignature } from "@/lib/slack/signature";

export const dynamic = "force-dynamic";

const reply = (m: SlackMessage) => json({ response_type: "ephemeral", ...m });

/** The /plan slash command. Slack expects an answer within 3 seconds, so no calendar sync here. */
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

  const p = new URLSearchParams(raw);
  const teamId = p.get("team_id") ?? "";
  const slackUserId = p.get("user_id") ?? "";
  const text = p.get("text") ?? "";
  const userId = await linkedUser(teamId, slackUserId);
  const linkReply = async () =>
    reply(connectMessage(`${env.appUrl}/slack/link?t=${await signSlackLinkToken({ teamId, slackUserId }, env.embedSigningSecret)}`));

  if (!userId) return text.trim().toLowerCase() === "help" ? reply(helpMessage()) : linkReply();

  const store = new Store(userId);
  const settings = await store.getSettings();
  const now = new Date();
  const cmd = parseCommand(text, settings.timezone, now);
  switch (cmd.kind) {
    case "help":
      return reply(helpMessage());
    case "connect":
      return linkReply();
    case "error":
      return reply({ text: cmd.message, blocks: [{ type: "section", text: { type: "mrkdwn", text: cmd.message } }] });
    case "today":
    case "week":
      return reply(planMessage(await replanForUser(userId, { trigger: "slack", sync: "never" }), now, cmd.kind, env.appUrl));
    case "risks":
      return reply(risksMessage(await replanForUser(userId, { trigger: "slack", sync: "never" }), env.appUrl));
    case "add": {
      const task = await store.createTask(cmd.input, "slack");
      const state = await replanForUser(userId, { trigger: "slack-add", sync: "never" });
      return reply(addedMessage(task, state.plans[task.id], settings.timezone));
    }
  }
});
