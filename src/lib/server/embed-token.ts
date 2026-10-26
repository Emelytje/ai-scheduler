import { jwtVerify, SignJWT } from "jose";

const AUDIENCE = "ai-scheduler-embed";
const ISSUER = "ai-scheduler";
export const EMBED_TOKEN_TTL_SECONDS = 60 * 60;

const secretKey = (secret: string) => new TextEncoder().encode(secret);

/** Short-lived token that lets the embedded UI act for one user without cookies. */
export async function signEmbedToken(userId: string, secret: string, ttlSeconds = EMBED_TOKEN_TTL_SECONDS): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(secret));
}

/** Returns the user id, or null when the token is invalid or expired. */
export async function verifyEmbedToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { audience: AUDIENCE, issuer: ISSUER, algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
