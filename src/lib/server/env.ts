import "server-only";
import { supabaseEnv } from "@/lib/supabase-env";
import { deriveSecret } from "./derive";

/** Server configuration. Missing Supabase settings switch the app to demo mode. */
const e = process.env;
const first = (...values: (string | undefined)[]) => values.find((v) => v && v.trim()) ?? "";
// Names set by hand, or by Vercel's Supabase integration (any custom prefix).
const supabase = supabaseEnv(e);
const supabaseServiceKey = supabase.serviceKey;
const derived = (purpose: string, encoding: "base64" | "hex") =>
  supabaseServiceKey ? deriveSecret(supabaseServiceKey, purpose).toString(encoding) : "";

export const env = {
  supabaseUrl: supabase.url,
  supabaseAnonKey: supabase.anonKey,
  supabaseServiceKey,
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // APP_URL, else the project's production domain that Vercel provides, else this deployment's URL.
  appUrl: (e.APP_URL || (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : e.VERCEL_URL ? `https://${e.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
  // Optional: derived from the service-role key when not set.
  tokenEncryptionKey: first(e.TOKEN_ENCRYPTION_KEY) || derived("token-encryption", "base64"),
  embedSigningSecret: first(e.EMBED_SIGNING_SECRET) || derived("embed-signing", "hex"),
  embedAllowedOrigins: (process.env.EMBED_ALLOWED_ORIGINS ?? "").split(/[\s,]+/).filter(Boolean),
  cronSecret: process.env.CRON_SECRET ?? "",
  slackClientId: process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? "",
};

export const isLive = () => !!(env.supabaseUrl && env.supabaseAnonKey && env.supabaseServiceKey);
export const isGoogleConfigured = () => !!(env.googleClientId && env.googleClientSecret && env.tokenEncryptionKey);
export const isEmbedConfigured = () => env.embedSigningSecret.length >= 32;
/** Slack also needs EMBED_SIGNING_SECRET (signs the account-link links) and TOKEN_ENCRYPTION_KEY (bot tokens). */
export const isSlackConfigured = () =>
  !!(env.slackClientId && env.slackClientSecret && env.slackSigningSecret && env.tokenEncryptionKey) && isEmbedConfigured();

/** Which integrations are configured (never the values). */
export function configReport() {
  return {
    mode: isLive() ? "live" : "demo",
    supabase: isLive(),
    google: isGoogleConfigured(),
    embedTokens: isEmbedConfigured(),
    cron: !!env.cronSecret,
    slack: isSlackConfigured(),
    appUrl: env.appUrl,
  };
}
