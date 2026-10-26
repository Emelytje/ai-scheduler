import { z } from "zod";
import { HttpError } from "@/lib/server/auth";
import { sha256 } from "@/lib/server/crypto";
import { EMBED_TOKEN_TTL_SECONDS, signEmbedToken } from "@/lib/server/embed-token";
import { env, isEmbedConfigured } from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { userForApiKey } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * Server-to-server: the host application exchanges a user's API key for a short-lived
 * embed token, then renders <iframe src="/embed?token=…">. Never call this from a browser.
 */
export const POST = route(async (req: Request) => {
  if (!isEmbedConfigured()) throw new HttpError(503, "EMBED_SIGNING_SECRET is not set (min. 32 characters)");
  const auth = req.headers.get("authorization") ?? "";
  const key = z.string().startsWith("ais_").min(20).safeParse(auth.replace(/^Bearer\s+/i, ""));
  if (!key.success) throw new HttpError(401, "Send the API key as: Authorization: Bearer ais_…");
  const userId = await userForApiKey(sha256(key.data));
  if (!userId) throw new HttpError(401, "Unknown API key");
  const token = await signEmbedToken(userId, env.embedSigningSecret);
  return json({ token, expiresIn: EMBED_TOKEN_TTL_SECONDS, embedUrl: `${env.appUrl}/embed?token=${token}` });
});
