import { z } from "zod";
import { HttpError, requireUser } from "@/lib/server/auth";
import { randomToken, sha256 } from "@/lib/server/crypto";
import { json, route } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** API keys for embedding. Only manageable with a signed-in session, never with an embed token. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user.via !== "session") throw new HttpError(403, "Manage API keys from the app itself");
  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return json({ keys: data });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user.via !== "session") throw new HttpError(403, "Manage API keys from the app itself");
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await req.json());
  const key = `ais_${randomToken(32)}`;
  const { error } = await supabaseAdmin()
    .from("api_keys")
    .insert({ user_id: user.id, name, key_hash: sha256(key), key_prefix: key.slice(0, 10) });
  if (error) throw new Error(error.message);
  // The plain key is shown once; only its hash is stored.
  return json({ key, name }, { status: 201 });
});
