import { redirect } from "next/navigation";
import { env, isEmbedConfigured, isLive } from "@/lib/server/env";
import { supabaseForRequest } from "@/lib/server/supabase";
import { ApiKeys } from "./ApiKeys";

export const dynamic = "force-dynamic";

export default async function Developers() {
  if (!isLive()) redirect("/");
  const supabase = await supabaseForRequest();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
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
          <h1>Embed in your app</h1>
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
    </main>
  );
}
