import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";

export const dynamic = "force-dynamic";

/** Current plan. Re-plans against the current time and syncs the calendar if it is stale. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  return json(await replanForUser(user.id, { trigger: "load", sync: "if-stale" }));
});
