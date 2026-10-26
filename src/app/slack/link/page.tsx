import { redirect } from "next/navigation";
import { verifySlackLinkToken } from "@/lib/server/embed-token";
import { env, isLive, isSlackConfigured } from "@/lib/server/env";
import { teamName } from "@/lib/server/slack";
import { supabaseForRequest } from "@/lib/server/supabase";
import { AfterLoginRedirect } from "./AfterLoginRedirect";

export const dynamic = "force-dynamic";

/** Opened from the "Link my account" button in Slack. Asks for confirmation before linking. */
export default async function SlackLink({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (!isLive() || !isSlackConfigured()) redirect("/");
  const { t } = await searchParams;
  const identity = t ? await verifySlackLinkToken(t, env.embedSigningSecret) : null;
  const supabase = await supabaseForRequest();
  const { data } = await supabase.auth.getUser();
  if (identity && !data.user) return <AfterLoginRedirect path={`/slack/link?t=${encodeURIComponent(t!)}`} />;
  const workspace = identity ? await teamName(identity.teamId) : null;

  return (
    <main className="as-app" style={{ maxWidth: 460, margin: "10vh auto 0" }}>
      <div className="as-brand">
        <span className="as-mark" aria-hidden />
        <h1>Link Slack</h1>
      </div>
      {!identity ? (
        <div className="as-banner is-error">This link has expired or is invalid. Run <code>/plan connect</code> in Slack for a new one.</div>
      ) : (
        <form action="/api/slack/link" method="post" className="as-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0 }}>
            Link Slack user <code>{identity.slackUserId}</code>
            {workspace ? (
              <>
                {" "}
                in <strong>{workspace}</strong>
              </>
            ) : null}{" "}
            to the planner account <strong>{data.user!.email}</strong>?
          </p>
          <p className="as-hint" style={{ margin: 0 }}>
            That Slack account can then see your plan, add tasks and get deadline alerts. Only continue if you clicked this link yourself.
          </p>
          <input type="hidden" name="t" value={t} />
          <div className="as-row">
            <button className="as-btn is-primary">Link account</button>
            <a className="as-btn" href="/">
              Cancel
            </a>
          </div>
        </form>
      )}
    </main>
  );
}
