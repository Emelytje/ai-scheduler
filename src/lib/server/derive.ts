import { hkdfSync } from "node:crypto";

/**
 * Derive an app secret from another high-entropy secret (the Supabase service-role key), so a
 * deployment works without generating extra keys by hand. Each purpose gets an independent key
 * (HKDF-SHA256 with a distinct label). An explicitly configured env var always wins.
 * Note: rotating the service-role key changes derived keys (users then reconnect Google/Slack).
 */
export function deriveSecret(master: string, purpose: string, bytes = 32): Buffer {
  if (!master) throw new Error("No master secret to derive from");
  return Buffer.from(hkdfSync("sha256", master, "ai-scheduler", `ai-scheduler:${purpose}`, bytes));
}
