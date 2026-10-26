-- AI Scheduler schema. Apply with `supabase db push` or paste into the SQL editor.
-- The Next.js server talks to these tables with the service role and always filters by
-- user_id; RLS additionally protects direct access with the anon key.

create table if not exists public.scheduler_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  estimate_minutes integer not null check (estimate_minutes between 1 and 10000),
  deadline timestamptz,
  not_before timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'done')),
  splittable boolean not null default true,
  min_chunk_minutes integer not null default 30 check (min_chunk_minutes between 5 and 480),
  -- Origin of the task: 'manual' now; reserved for auto-tasks from projects/campaigns.
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_status on public.tasks (user_id, status);

create table if not exists public.scheduled_blocks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  -- Id of the mirrored Google Calendar event when write-back is on.
  google_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists blocks_user_start on public.scheduled_blocks (user_id, start_at);

create table if not exists public.calendar_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  busy boolean not null default true,
  all_day boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists events_user_start on public.calendar_events (user_id, start_at);

-- Server-only: OAuth tokens (encrypted at the application layer) and push channel state.
create table if not exists public.google_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  refresh_token_enc text not null,
  access_token_enc text,
  access_token_expires_at timestamptz,
  sync_token text,
  channel_id text unique,
  channel_resource_id text,
  channel_token text,
  channel_expires_at timestamptz,
  write_blocks boolean not null default true,
  last_sync_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

-- Server-only: keys a host application uses to mint short-lived embed tokens.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.plan_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null,
  engine_ms numeric not null,
  total_ms numeric not null,
  blocks_created integer not null default 0,
  blocks_updated integer not null default 0,
  blocks_deleted integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists plan_runs_user_created on public.plan_runs (user_id, created_at desc);

alter table public.scheduler_settings enable row level security;
alter table public.tasks enable row level security;
alter table public.scheduled_blocks enable row level security;
alter table public.calendar_events enable row level security;
alter table public.google_connections enable row level security;
alter table public.api_keys enable row level security;
alter table public.plan_runs enable row level security;

create policy "own settings" on public.scheduler_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks" on public.tasks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own blocks (read)" on public.scheduled_blocks for select to authenticated using (auth.uid() = user_id);
create policy "own events (read)" on public.calendar_events for select to authenticated using (auth.uid() = user_id);
create policy "own plan runs (read)" on public.plan_runs for select to authenticated using (auth.uid() = user_id);
-- google_connections and api_keys: no policies → only the service role can access them.

-- Atomically replace a user's not-yet-finished blocks with a new plan. p_blocks holds every
-- block of the new plan that ends at or after p_now (finished history is never touched). The advisory lock serialises
-- concurrent re-plans (webhook + user action) for the same user.
create or replace function public.replace_future_blocks(p_user uuid, p_now timestamptz, p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  delete from scheduled_blocks
   where user_id = p_user
     and end_at > p_now
     and id not in (select (b ->> 'id')::uuid from jsonb_array_elements(p_blocks) b);
  insert into scheduled_blocks (id, user_id, task_id, start_at, end_at, google_event_id)
  select (b ->> 'id')::uuid, p_user, (b ->> 'taskId')::uuid, (b ->> 'start')::timestamptz, (b ->> 'end')::timestamptz,
         b ->> 'googleEventId'
    from jsonb_array_elements(p_blocks) b
  on conflict (id) do update
     set start_at = excluded.start_at,
         end_at = excluded.end_at,
         google_event_id = coalesce(excluded.google_event_id, scheduled_blocks.google_event_id);
end;
$$;
revoke all on function public.replace_future_blocks(uuid, timestamptz, jsonb) from public, anon, authenticated;
