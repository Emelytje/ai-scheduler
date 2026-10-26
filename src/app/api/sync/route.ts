import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  return json(await replanForUser(user.id, { trigger: "manual-sync", sync: "always" }));
});
