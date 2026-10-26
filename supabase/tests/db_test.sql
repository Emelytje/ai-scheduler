-- Database checks: RLS isolation and replace_future_blocks semantics.
-- Run against a database with the migration applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/db_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', 'authenticated', 'authenticated');

insert into public.tasks (id, user_id, title, estimate_minutes) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'A task', 60),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'B task', 60);
insert into public.google_connections (user_id, refresh_token_enc) values ('00000000-0000-0000-0000-00000000000a', 'secret');
insert into public.api_keys (user_id, name, key_hash, key_prefix) values ('00000000-0000-0000-0000-00000000000a', 'k', 'hash', 'ais_x');

-- Blocks for A: one finished, one running, two future. "now" = 2026-10-26 10:00Z.
insert into public.scheduled_blocks (id, user_id, task_id, start_at, end_at, google_event_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '2026-10-26 08:00Z', '2026-10-26 09:00Z', 'g-past'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '2026-10-26 09:30Z', '2026-10-26 10:30Z', 'g-running'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '2026-10-26 12:00Z', '2026-10-26 13:00Z', 'g-keep'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '2026-10-26 14:00Z', '2026-10-26 15:00Z', 'g-drop'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '2026-10-26 14:00Z', '2026-10-26 15:00Z', null);

-- New plan for A: running block shortened, block 3 moved (no google id in payload), block 4 gone, one new block.
select public.replace_future_blocks(
  '00000000-0000-0000-0000-00000000000a', '2026-10-26 10:00Z',
  '[{"id":"20000000-0000-0000-0000-000000000002","taskId":"10000000-0000-0000-0000-00000000000a","start":"2026-10-26T09:30:00Z","end":"2026-10-26T10:15:00Z","googleEventId":"g-running"},
    {"id":"20000000-0000-0000-0000-000000000003","taskId":"10000000-0000-0000-0000-00000000000a","start":"2026-10-26T13:00:00Z","end":"2026-10-26T14:00:00Z"},
    {"id":"20000000-0000-0000-0000-000000000006","taskId":"10000000-0000-0000-0000-00000000000a","start":"2026-10-26T15:00:00Z","end":"2026-10-26T15:30:00Z"}]'::jsonb);

do $$
declare n int;
begin
  -- finished history untouched
  perform 1 from scheduled_blocks where id = '20000000-0000-0000-0000-000000000001' and end_at = '2026-10-26 09:00Z' and google_event_id = 'g-past';
  if not found then raise exception 'FAIL: finished block was changed'; end if;
  -- running block shortened
  perform 1 from scheduled_blocks where id = '20000000-0000-0000-0000-000000000002' and end_at = '2026-10-26 10:15Z';
  if not found then raise exception 'FAIL: running block not updated'; end if;
  -- moved block keeps its Google event id
  perform 1 from scheduled_blocks where id = '20000000-0000-0000-0000-000000000003' and start_at = '2026-10-26 13:00Z' and google_event_id = 'g-keep';
  if not found then raise exception 'FAIL: moved block lost its google id or did not move'; end if;
  -- removed block deleted, new block inserted
  perform 1 from scheduled_blocks where id = '20000000-0000-0000-0000-000000000004';
  if found then raise exception 'FAIL: removed block still present'; end if;
  perform 1 from scheduled_blocks where id = '20000000-0000-0000-0000-000000000006';
  if not found then raise exception 'FAIL: new block missing'; end if;
  -- other user untouched
  select count(*) into n from scheduled_blocks where user_id = '00000000-0000-0000-0000-00000000000b';
  if n <> 1 then raise exception 'FAIL: other user''s blocks changed'; end if;
  raise notice 'PASS replace_future_blocks';
end $$;

-- RLS as user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
-- Older auth.uid() versions (bare Postgres image without the Auth service) read this one.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare n int;
begin
  select count(*) into n from tasks;
  if n <> 1 then raise exception 'FAIL: A sees % tasks', n; end if;
  select count(*) into n from scheduled_blocks where user_id = '00000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception 'FAIL: A sees B''s blocks'; end if;
  select count(*) into n from google_connections;
  if n <> 0 then raise exception 'FAIL: tokens readable by user'; end if;
  select count(*) into n from api_keys;
  if n <> 0 then raise exception 'FAIL: api keys readable by user'; end if;
  begin
    insert into tasks (user_id, title, estimate_minutes) values ('00000000-0000-0000-0000-00000000000b', 'sneaky', 30);
    raise exception 'FAIL: A inserted a task for B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into scheduled_blocks (id, user_id, task_id, start_at, end_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', now(), now() + interval '1 hour');
    raise exception 'FAIL: user wrote blocks directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.replace_future_blocks('00000000-0000-0000-0000-00000000000b', now(), '[]'::jsonb);
    raise exception 'FAIL: user could call replace_future_blocks';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS rls authenticated';
end $$;

-- RLS as anon: no policies apply to anon at all, even with a (forged) sub claim present.
reset role;
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from tasks;
  if n <> 0 then raise exception 'FAIL: anon sees tasks'; end if;
  raise notice 'PASS rls anon';
end $$;

rollback;
