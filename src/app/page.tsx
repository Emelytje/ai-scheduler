import { redirect } from "next/navigation";
import { DemoApp, LiveApp } from "@/components/ClientApps";
import { isLive } from "@/lib/server/env";
import { supabaseForRequest } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const CALENDAR_MESSAGES: Record<string, string> = {
  connected: "Google Calendar connected. Your tasks are now planned around your meetings.",
  denied: "Google Calendar was not connected: access was declined.",
  failed: "Connecting Google Calendar failed. Try again.",
  "invalid-state": "The Google sign-in link expired. Start connecting again.",
  "not-configured": "Google Calendar isn't set up on this server yet (missing GOOGLE_CLIENT_ID / SECRET).",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  if (!isLive()) return <DemoApp />;
  const supabase = await supabaseForRequest();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { calendar } = await searchParams;
  const message = calendar ? CALENDAR_MESSAGES[calendar] : null;
  return (
    <>
      {message && (
        <div className="as-banner" role="status" style={{ margin: "12px max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px))" }}>
          {message}
        </div>
      )}
      <LiveApp />
    </>
  );
}
