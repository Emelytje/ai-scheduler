import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { randomToken } from "@/lib/server/crypto";
import { env, isSlackConfigured } from "@/lib/server/env";
import { route } from "@/lib/server/http";
import { slackInstallUrl } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

/** "Add to Slack": start Slack OAuth for the signed-in user. */
export const GET = route(async (req: Request) => {
  await requireUser(req);
  if (!isSlackConfigured()) return NextResponse.redirect(`${env.appUrl}/developers?slack=not-configured`);
  const state = randomToken(24);
  (await cookies()).set("slack_oauth_state", state, { httpOnly: true, secure: env.appUrl.startsWith("https://"), sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(slackInstallUrl(state));
});
