import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { randomToken } from "@/lib/server/crypto";
import { env, isGoogleConfigured } from "@/lib/server/env";
import { authorizationUrl } from "@/lib/server/google";
import { route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Start Google OAuth. The state value is bound to this browser with an httpOnly cookie. */
export const GET = route(async (req: Request) => {
  await requireUser(req);
  if (!isGoogleConfigured()) return NextResponse.redirect(`${env.appUrl}/?calendar=not-configured`);
  const state = randomToken(24);
  (await cookies()).set("g_oauth_state", state, { httpOnly: true, secure: env.appUrl.startsWith("https://"), sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(authorizationUrl(state));
});
