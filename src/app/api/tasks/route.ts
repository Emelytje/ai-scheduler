import { requireUser } from "@/lib/server/auth";
import { json, route, taskInputSchema } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  const input = taskInputSchema.parse(await req.json());
  await new Store(user.id).createTask(input);
  return json(await replanForUser(user.id, { trigger: "task-created", sync: "if-stale" }), { status: 201 });
});
