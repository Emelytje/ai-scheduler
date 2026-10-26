import { DemoApp, LiveApp } from "@/components/ClientApps";
import { isLive } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/**
 * Embeddable view. Host apps load it in an iframe with ?token=<embed token> (see /developers).
 * Without a token it falls back to the signed-in session (same-site embedding).
 */
export default async function Embed({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (!isLive()) return <DemoApp variant="embed" />;
  const { token } = await searchParams;
  return <LiveApp variant="embed" token={token ?? null} />;
}
