import { redirect } from "next/navigation";
import { env, isLive } from "@/lib/server/env";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isLive()) redirect("/");
  const { error } = await searchParams;
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
      <LoginForm supabaseUrl={env.supabaseUrl} supabaseAnonKey={env.supabaseAnonKey} appUrl={env.appUrl} />
    </main>
  );
}
