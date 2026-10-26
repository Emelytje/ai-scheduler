import { NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { route } from "@/lib/server/http";
import { unlinkSlack } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user.via !== "session") throw new HttpError(403, "Manage Slack from the app itself");
  await unlinkSlack(user.id);
  return NextResponse.redirect(`${env.appUrl}/developers?slack=unlinked`, { status: 303 });
});
