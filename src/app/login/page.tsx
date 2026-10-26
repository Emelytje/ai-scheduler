import { redirect } from "next/navigation";
import { env, isLive } from "@/lib/server/env";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

/** Ask Supabase Auth whether Google sign-in is switched on, so we never show a button that fails. */
async function googleSignInEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey }, cache: "no-store" });
    if (!res.ok) return false;
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return settings.external?.google === true;
  } catch {
    return false;
  }
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isLive()) redirect("/");
  const [{ error }, google] = await Promise.all([searchParams, googleSignInEnabled()]);
  return (
    <main className="as-app" style={{ maxWidth: 420, margin: "10vh auto 0" }}>
      <div className="as-brand">
        <span className="as-mark" aria-hidden />
        <h1>AI Scheduler</h1>
      </div>
      <p className="as-hint" style={{ margin: 0 }}>
        Sign in to plan your tasks around your calendar.
      </p>
      {error && <div className="as-banner is-error">That sign-in link is invalid or expired. Request a new one.</div>}
      <LoginForm supabaseUrl={env.supabaseUrl} supabaseAnonKey={env.supabaseAnonKey} appUrl={env.appUrl} google={google} />
      <p className="as-hint" style={{ margin: 0 }}>
        Just looking? <a href="/demo">Try the demo</a> with sample meetings and tasks, no sign-in needed.
      </p>
    </main>
  );
}
