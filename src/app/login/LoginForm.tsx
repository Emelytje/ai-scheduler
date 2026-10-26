"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useMemo, useState } from "react";

export function LoginForm({
  supabaseUrl,
  supabaseAnonKey,
  appUrl,
  google,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
  /** Only true when Google is enabled under Supabase → Authentication → Providers. */
  google: boolean;
}) {
  const supabase = useMemo(() => createBrowserClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const redirectTo = `${appUrl}/auth/callback`;

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) {
      setError(error.message);
      setState("idle");
    } else setState("sent");
  };

  return (
    <div className="as-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {google && (
        <button
          className="as-btn"
          style={{ justifyContent: "center", padding: "8px 12px" }}
          onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })}
        >
          Continue with Google
        </button>
      )}
      <form onSubmit={sendLink} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="as-field">
          <span>Work email</span>
          <input id="login-email" className="as-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className="as-btn is-primary" style={{ justifyContent: "center" }} disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {state === "sent" && <p className="as-hint" style={{ margin: 0 }}>Check {email} for your sign-in link.</p>}
      {error && <p style={{ margin: 0, color: "var(--late)" }}>{error}</p>}
    </div>
  );
}
