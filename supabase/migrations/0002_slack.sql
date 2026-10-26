-- Slack integration. All tables are server-only (RLS on, no policies).

-- One row per Slack workspace that installed the app.
create table if not exists public.slack_installations (
  team_id text primary key,
  team_name text,
  bot_user_id text not null,
  bot_token_enc text not null,
  installed_by uuid references auth.users (id) on delete set null,
  installed_at timestamptz not null default now()
);

-- Which planner account a Slack user acts as.
create table if not exists public.slack_links (
  team_id text not null references public.slack_installations (team_id) on delete cascade,
  slack_user_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, slack_user_id)
);
create index if not exists slack_links_user on public.slack_links (user_id);

-- Deadline alerts already sent, so each risk is announced once per status.
create table if not exists public.slack_alerts (
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  status text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.slack_installations enable row level security;
alter table public.slack_links enable row level security;
alter table public.slack_alerts enable row level security;
