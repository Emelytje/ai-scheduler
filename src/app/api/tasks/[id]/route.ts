import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { json, route, taskPatchSchema } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = z.uuid().parse((await ctx.params).id);
  const patch = taskPatchSchema.parse(await req.json());
  await new Store(user.id).updateTask(id, patch);
  return json(await replanForUser(user.id, { trigger: "task-updated", sync: "if-stale" }));
});

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = z.uuid().parse((await ctx.params).id);
  await new Store(user.id).deleteTask(id);
  return json(await replanForUser(user.id, { trigger: "task-deleted", sync: "never" }));
});
