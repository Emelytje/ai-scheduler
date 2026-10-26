import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { route } from "@/lib/server/http";
import { completeInstall } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("slack_oauth_state")?.value;
  jar.delete("slack_oauth_state");
  const back = (status: string) => NextResponse.redirect(`${env.appUrl}/developers?slack=${status}`);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("invalid-state");
  try {
    await completeInstall(code, user.id);
  } catch (e) {
    console.error("slack install failed", e);
    return back("failed");
  }
  return back("installed");
});
