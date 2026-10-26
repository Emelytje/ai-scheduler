import { redirect } from "next/navigation";
import { env, isEmbedConfigured, isLive, isSlackConfigured } from "@/lib/server/env";
import { linksForUser } from "@/lib/server/slack";
import { supabaseForRequest } from "@/lib/server/supabase";
import { ApiKeys } from "./ApiKeys";

export const dynamic = "force-dynamic";

const SLACK_MESSAGES: Record<string, string> = {
  installed: "Slack is installed and your Slack account is linked. Try /plan in Slack.",
  linked: "Your Slack account is linked. Try /plan in Slack.",
  unlinked: "Slack account unlinked.",
  denied: "Slack was not installed: access was declined.",
  failed: "Installing Slack failed. Try again.",
  "invalid-state": "The Slack link expired. Start again.",
  "not-configured": "Slack isn't set up on this server yet (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET).",
};

export default async function Developers({ searchParams }: { searchParams: Promise<{ slack?: string }> }) {
  if (!isLive()) redirect("/");
  const supabase = await supabaseForRequest();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { slack } = await searchParams;
  const slackLinks = isSlackConfigured() ? await linksForUser(data.user.id) : [];
  const snippet = `<!-- 1. On your server: exchange the user's API key for a 1-hour embed token -->
curl -X POST ${env.appUrl}/api/embed/token -H "Authorization: Bearer ais_…"
# → { "token": "…", "embedUrl": "${env.appUrl}/embed?token=…" }

<!-- 2. In your page -->
<div data-ai-scheduler data-token="TOKEN_FROM_STEP_1" data-view="week"></div>
<script src="${env.appUrl}/embed.js" async></script>`;
  return (
    <main className="as-app" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="as-topbar">
        <div className="as-brand">
          <span className="as-mark" aria-hidden />
          <h1>Integrations</h1>
        </div>
        <a className="as-btn" href="/">
          Back to planner
        </a>
      </div>
      {!isEmbedConfigured() && (
        <div className="as-banner is-error">EMBED_SIGNING_SECRET is not set on this server, so embed tokens can't be issued yet.</div>
      )}
      <section className="as-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>How it works</h2>
        <p style={{ margin: 0, maxWidth: "65ch" }}>
          Your backend keeps an API key per user and swaps it for a short-lived embed token. The iframe uses that token instead of cookies,
          so it works inside another product. The embed shows the calendar and task list and re-plans exactly like this app. Allowed host
          origins: <code>{env.embedAllowedOrigins.join(", ") || "none set (EMBED_ALLOWED_ORIGINS)"}</code>.
        </p>
        <pre style={{ overflowX: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 12, margin: 0 }}>
          {snippet}
        </pre>
        <p className="as-hint" style={{ margin: 0 }}>
          The iframe posts <code>ai-scheduler:resize</code> and <code>ai-scheduler:plan</code> (tasks at risk) messages to the host page, and
          accepts <code>{`{ type: "ai-scheduler:set-view", view: "day" | "week" }`}</code>.
        </p>
      </section>
      <ApiKeys />
      <section className="as-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} aria-label="Slack">
        <h2 style={{ margin: 0, fontSize: 15 }}>Slack</h2>
        {slack && SLACK_MESSAGES[slack] && <div className={`as-banner${["denied", "failed", "invalid-state", "not-configured"].includes(slack) ? " is-error" : ""}`}>{SLACK_MESSAGES[slack]}</div>}
        <p style={{ margin: 0, maxWidth: "65ch" }}>
          With <code>/plan</code> you see today's plan, tasks at risk and add tasks from Slack. The bot sends a direct message when a task is going
          to miss its deadline, and a short plan every morning.
        </p>
        {!isSlackConfigured() ? (
          <p className="as-hint" style={{ margin: 0 }}>
            Not set up yet. Create the Slack app from <a href="/api/slack/manifest">this manifest</a> at api.slack.com/apps, then set
            SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET.
          </p>
        ) : (
          <div className="as-row">
            {slackLinks.length ? (
              <>
                <span className="as-chip is-ok">Linked to {slackLinks.length} Slack account{slackLinks.length > 1 ? "s" : ""}</span>
                <form action="/api/slack/unlink" method="post">
                  <button className="as-btn is-small">Unlink</button>
                </form>
              </>
            ) : (
              <span className="as-chip is-muted">Not linked</span>
            )}
            <a className="as-btn is-primary" href="/api/slack/install">
              Add to Slack
            </a>
          </div>
        )}
        <p className="as-hint" style={{ margin: 0 }}>
          Colleagues in a workspace where the app is already installed link themselves by typing <code>/plan connect</code>.
        </p>
      </section>
    </main>
  );
}
