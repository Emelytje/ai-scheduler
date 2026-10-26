import "server-only";
import { verifyEmbedToken } from "./embed-token";
import { env, isEmbedConfigured } from "./env";
import { supabaseForRequest } from "./supabase";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestUser {
  id: string;
  via: "session" | "embed";
}

/** Identify the caller: an embed bearer token, otherwise the Supabase session cookie. */
export async function requireUser(req: Request): Promise<RequestUser> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    if (!isEmbedConfigured()) throw new HttpError(401, "Embedding is not configured on this server");
    const id = await verifyEmbedToken(auth.slice(7), env.embedSigningSecret);
    if (!id) throw new HttpError(401, "Embed session expired. Reload the page to get a new one.");
    return { id, via: "embed" };
  }
  const supabase = await supabaseForRequest();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new HttpError(401, "Sign in to continue");
  return { id: data.user.id, via: "session" };
}
