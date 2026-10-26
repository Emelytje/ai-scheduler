/**
 * Finds the Supabase settings in the environment, whatever names they were given. Vercel's
 * Supabase integration lets you pick a custom prefix (e.g. STORAGE_SUPABASE_URL or
 * STORAGE_URL), so exact names are tried first, then any name with the expected ending.
 */
type Env = Record<string, string | undefined>;

function byName(env: Env, names: string[]): string {
  for (const n of names) if (env[n]?.trim()) return env[n]!.trim();
  return "";
}

function bySuffix(env: Env, suffixes: string[]): string {
  const keys = Object.keys(env).sort();
  for (const s of suffixes) {
    const k = keys.find((key) => key.endsWith(`_${s}`) && env[key]?.trim());
    if (k) return env[k]!.trim();
  }
  return "";
}

export function supabaseEnv(env: Env) {
  const url =
    byName(env, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) ||
    bySuffix(env, ["SUPABASE_URL"]) ||
    // Prefix replacing the provider name (e.g. STORAGE_URL): recognise the value itself.
    Object.values(env).find((v) => v && /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(v.trim()))?.trim().replace(/\/$/, "") ||
    "";
  const anonKey =
    byName(env, ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"]) ||
    bySuffix(env, ["SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "ANON_KEY", "PUBLISHABLE_KEY"]);
  const serviceKey =
    byName(env, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) || bySuffix(env, ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]);
  return { url, anonKey, serviceKey };
}
