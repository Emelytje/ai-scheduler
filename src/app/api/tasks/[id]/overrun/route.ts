import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { addTimeToTask } from "@/lib/server/planner";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** "This task needs N more minutes": grow the estimate and re-plan everything after it. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = z.uuid().parse((await ctx.params).id);
  const { extraMinutes } = z.object({ extraMinutes: z.number().int().min(5).max(2400) }).parse(await req.json());
  return json(await addTimeToTask(user.id, id, extraMinutes));
});
