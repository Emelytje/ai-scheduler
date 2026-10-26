import "server-only";

/** Server configuration. Missing Supabase settings switch the app to demo mode. */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  appUrl: (process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  embedSigningSecret: process.env.EMBED_SIGNING_SECRET ?? "",
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
