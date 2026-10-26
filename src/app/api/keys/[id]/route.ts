import { z } from "zod";
import { HttpError, requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  if (user.via !== "session") throw new HttpError(403, "Manage API keys from the app itself");
  const id = z.uuid().parse((await ctx.params).id);
  const { error } = await supabaseAdmin().from("api_keys").delete().eq("user_id", user.id).eq("id", id);
  if (error) throw new Error(error.message);
  return json({ ok: true });
});
