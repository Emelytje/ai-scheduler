import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { SLACK_BOT_SCOPES, slackRedirectUri } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

/** Ready-to-paste Slack app manifest with this deployment's URLs (api.slack.com/apps → Create from manifest). */
export function GET() {
  return NextResponse.json({
    display_information: {
      name: "AI Scheduler",
      description: "Plans your tasks around your meetings and warns you before a deadline slips.",
      background_color: "#2347b8",
    },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: true },
      bot_user: { display_name: "AI Scheduler", always_online: false },
      slash_commands: [
        {
          command: "/plan",
          url: `${env.appUrl}/api/slack/commands`,
          description: "See today's plan, tasks at risk, or add a task",
          usage_hint: "today | week | risks | add <task> <duration> by <day> [time] | help",
          should_escape: false,
        },
      ],
    },
    oauth_config: { redirect_urls: [slackRedirectUri()], scopes: { bot: SLACK_BOT_SCOPES } },
    settings: {
      interactivity: { is_enabled: true, request_url: `${env.appUrl}/api/slack/interactions` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  });
}
