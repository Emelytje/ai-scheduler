import { z } from "zod";
import { HttpError, requireUser } from "@/lib/server/auth";
import { estimateAfterOverrun } from "@/lib/scheduler/engine";
import { json, route } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** "This task needs N more minutes": grow the estimate and re-plan everything after it. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = z.uuid().parse((await ctx.params).id);
  const { extraMinutes } = z.object({ extraMinutes: z.number().int().min(5).max(2400) }).parse(await req.json());
  const store = new Store(user.id);
  // Re-plan first so worked/locked minutes reflect the current time.
  const current = await replanForUser(user.id, { trigger: "overrun-check", sync: "never" });
  const task = current.tasks.find((t) => t.id === id);
  const plan = current.plans[id];
  if (!task || !plan) throw new HttpError(404, "Task not found");
  await store.updateTask(id, { estimateMinutes: estimateAfterOverrun(task, plan, extraMinutes) });
  return json(await replanForUser(user.id, { trigger: "overrun", sync: "never" }));
});
