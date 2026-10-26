import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { connect, startWatch } from "@/lib/server/google";
import { route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  jar.delete("g_oauth_state");
  const back = (status: string) => NextResponse.redirect(`${env.appUrl}/?calendar=${status}`);

  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("invalid-state");

  const store = new Store(user.id);
  try {
    await connect(store, code);
  } catch (e) {
    console.error("google connect failed", e);
    return back("failed");
  }
  await startWatch(store).catch((e) => console.error("google watch failed (falling back to polling)", e));
  await replanForUser(user.id, { trigger: "google-connected", sync: "always" });
  return back("connected");
});
