import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Slack request signature (v0 HMAC-SHA256 over "v0:{timestamp}:{raw body}").
 * Rejects requests older than 5 minutes to stop replays.
 */
export function verifySlackSignature(opts: {
  signingSecret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  nowSeconds?: number;
}): boolean {
  const { signingSecret, rawBody, timestamp, signature } = opts;
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
