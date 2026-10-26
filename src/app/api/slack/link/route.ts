import { NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/server/auth";
import { verifySlackLinkToken } from "@/lib/server/embed-token";
import { env } from "@/lib/server/env";
import { route } from "@/lib/server/http";
import { linkSlackUser } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

/** Confirmed from /slack/link: tie the Slack user to the signed-in planner account. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user.via !== "session") throw new HttpError(403, "Link Slack from the app itself");
  const form = await req.formData();
  const identity = await verifySlackLinkToken(String(form.get("t") ?? ""), env.embedSigningSecret);
  if (!identity) return NextResponse.redirect(`${env.appUrl}/slack/link`, { status: 303 });
  await linkSlackUser(identity.teamId, identity.slackUserId, user.id);
  return NextResponse.redirect(`${env.appUrl}/developers?slack=linked`, { status: 303 });
});
