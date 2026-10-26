// Applies supabase/migrations/*.sql that have not run yet. Runs before `next build`, so a
// deploy sets up its own database. Skips quietly when no database URL is configured (demo mode).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Vercel's Supabase integration sets POSTGRES_URL_NON_POOLING (direct connection, needed for locks).
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.log("migrate: no database URL set, skipping (demo mode)");
  process.exit(0);
}

// Tables that prove a migration was applied by hand before this script existed.
const MARKERS = { "0001_init.sql": "public.tasks", "0002_slack.sql": "public.slack_installations" };

const parsed = new URL(url);
const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
parsed.searchParams.delete("sslmode");
const client = new pg.Client({
  connectionString: parsed.toString(),
  // Supabase requires TLS; its certificate chain isn't in Node's default store.
  ssl: local ? false : { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('ai-scheduler-migrations'))");
  await client.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  await client.query("alter table public.schema_migrations enable row level security");
  const applied = new Set((await client.query("select name from public.schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(path.join(root, "supabase/migrations"))).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const marker = MARKERS[file];
    if (marker && (await client.query("select to_regclass($1) as t", [marker])).rows[0].t) {
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      console.log(`migrate: ${file} was already applied, recorded`);
      continue;
    }
    const sql = await readFile(path.join(root, "supabase/migrations", file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`migrate: applied ${file}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`migrate: ${file} failed: ${e.message}`);
    }
  }
  console.log("migrate: database is up to date");
} finally {
  await client.query("select pg_advisory_unlock(hashtext('ai-scheduler-migrations'))").catch(() => {});
  await client.end();
}
