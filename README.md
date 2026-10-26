# AI Scheduler

Puts every task on the calendar automatically, in the web app, embedded in another app, or from Slack. Tasks have a duration, deadline, priority and optional "not before" date. The planner places them in free working time around Google Calendar meetings, deadline first. When a meeting moves or a task runs over, it re-plans the rest of the week and flags anything that will miss its deadline. There's a day/week calendar and a task list, and the whole view can be embedded in another app.

Stack: Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Google Calendar API · Vercel.

## Status: what is verified

| Area | Status | How it was checked |
| --- | --- | --- |
| Scheduling engine (conflicts, deadlines, replanning) | ✅ Verified | 31 unit tests in `tests/scheduler.test.ts`, including 200 randomized calendars |
| Acceptance: seeded calendar + 20 tasks, no overlaps, nothing late when there was room, re-plan < 5 s | ✅ Verified | Unit tests + browser test that moves a meeting in the real UI (re-plan visible after 86 ms in demo mode; live mode adds the Google fetch and is not yet measured) |
| UI: day/week calendar, task list, add/edit/done, overrun, settings | ✅ Verified (demo mode) | Browser tests (`tests/e2e/preview.e2e.ts`) against both the preview build and `next start` |
| Embedding (iframe + `embed.js`, postMessage, frame allow-list) | ✅ Verified (demo mode) | Browser test from a separate host origin, plus a blocked-origin check (`tests/e2e/embed.e2e.ts`) |
| Database schema, RLS, atomic block replacement | ✅ Verified | `supabase/tests/db_test.sql` on Supabase's Postgres 17 image |
| Embed tokens, Google event mapping | ✅ Verified | Unit tests |
| Slack: `/plan` parsing, request signatures, messages, alert de-duplication, link tokens | ✅ Verified | 14 unit tests in `tests/slack.test.ts`; Slack tables covered by the DB tests |
| Slack against a real workspace (install, `/plan`, buttons, DMs) | ⚠️ Not verified | Needs a Slack app and a public HTTPS URL |
| API routes against a real Supabase project | ⚠️ Not verified | Builds and type-checks; needs a Supabase project to run |
| Supabase Auth sign-in (magic link / Google) | ⚠️ Not verified | Needs a Supabase project |
| Google Calendar OAuth, sync, push notifications, write-back | ⚠️ Not verified | Needs Google OAuth credentials and a public HTTPS URL |
| CI workflow (`.github/workflows/ci.yml`) | ✅ Verified | Green on GitHub Actions: unit, database, build and browser tests |
| Automatic database setup on deploy (`scripts/migrate.mjs`) | ✅ Verified locally | Fresh database, repeat run, database set up by hand, and no database |
| Vercel's Supabase integration env names, live deploy | ⚠️ Not verified | The app accepts both the integration's names and the manual ones |

## How the planner decides

All rules live in one pure function, `plan()` in `src/lib/scheduler/engine.ts`. The browser runs it in demo mode and the server runs it in production, so the same rules apply everywhere.

1. **Free time** = working hours (per weekday, in the user's time zone, DST-safe), minus busy meetings plus an optional buffer on each side, minus the block that is running right now. Starts snap to a 15-minute grid.
2. **Order:** earliest deadline first; equal deadlines go by priority (urgent → low), then "not before", then age. Tasks without a deadline come last, by priority.
3. **Placement:** as early as possible, never before "not before". Splittable tasks may be split into blocks of at least the minimum block size (default 30 min). A split never leaves a smaller leftover.
4. **Deadline protection:** a task that cannot finish before its deadline is flagged **Will miss deadline** and placed after the tasks that can still make theirs, so one hopeless task doesn't make others late too. Tests prove that a task is only ever late when there was no room for it before its deadline.
5. **Doesn't fit:** work that can't be placed within the planning window (14 days by default, extended to the latest deadline + 7 days, up to 60) is flagged.
6. **Re-planning:** past blocks stay as history and count as work done. The block in progress is kept, but cut short if a meeting is moved onto it. Everything else is re-placed. Block ids are reused, so calendar write-back moves existing events instead of recreating them.
7. **Overruns:** if a task's planned time has passed and it isn't marked done, the planner adds extra time automatically (30 min by default) and marks the task as having run over. "Needs +15/30/60/120 min" sets the real amount, and everything after it moves.

Re-planning runs when a task or setting changes, on "Sync now", when the app regains focus, every 2 minutes while it's open, when Google sends a push notification, and once a day from the cron job.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000. Without Supabase env vars it runs in demo mode.
```

Demo mode needs no credentials. It plans 20 sample tasks around a sample week of meetings and stores everything in the browser.

```bash
npm test                 # engine, Google mapping and embed-token unit tests
npm run test:e2e         # builds the single-file preview and drives it in Chromium (needs Playwright + Chromium)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db   # schema + RLS tests
npm run build:preview    # preview-dist/index.html: the demo as one self-contained file
```

For the embed browser test, start the app with `EMBED_ALLOWED_ORIGINS=http://localhost:3200 npx next start -p 3100`, then run `E2E_URL=http://localhost:3100/ npm run test:e2e`.

## Deploy (Vercel + Supabase + Google)

The app needs as few hand-made settings as possible:
- **Supabase:** added through Vercel's Supabase integration, which fills in the database settings.
- **Database tables:** created by the build (`scripts/migrate.mjs` applies any migrations that haven't run yet).
- **App URL:** taken from Vercel (`VERCEL_PROJECT_PRODUCTION_URL`).
- **Encryption and signing keys:** derived from the Supabase service-role key (HKDF), unless you set them yourself.

### 1. Vercel and Supabase
1. In Vercel, go to **Add New → Project**, pick the repository and deploy. Without a database it runs in demo mode.
2. In the Vercel project, go to **Storage → Create / Connect → Supabase** (Marketplace). This creates the Supabase project and adds its environment variables to Vercel.
3. Go to **Deployments → Redeploy**. The build creates the tables.
4. In Supabase, go to **Authentication → URL Configuration**. Set Site URL to the app URL and add `https://YOUR-APP/auth/callback` to the redirect URLs.

### 2. Google Calendar
1. In Google Cloud Console, enable the **Google Calendar API**.
2. On the **OAuth consent screen**, add the scope `.../auth/calendar.events` and list your test users. This scope is *sensitive*: until Google has verified the app, at most 100 test users can connect.
3. Create **Credentials → OAuth client ID → Web application** with the redirect URI `https://YOUR-APP/api/google/callback`.
4. In Vercel, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then redeploy.

### 3. Optional settings

| Variable | When |
| --- | --- |
| `CRON_SECRET` | Needed for the daily job (morning summary, safety-net sync). Any long random string. |
| `EMBED_ALLOWED_ORIGINS` | When the planner is embedded in another app: that app's origin(s), space separated |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | For Slack; see [Slack](#slack) |
| `APP_URL` | Only with a custom domain that isn't the Vercel production domain |
| `TOKEN_ENCRYPTION_KEY`, `EMBED_SIGNING_SECRET` | Only to manage keys yourself instead of deriving them. Rotating the Supabase service-role key changes derived keys, and users then reconnect Google and Slack. |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL_NON_POOLING` | Set by the Supabase integration; set them by hand only without it |

Then open `https://YOUR-APP/api/health`. It shows which parts are configured (never their values).

Cron: `vercel.json` runs `/api/cron/sync` daily at 05:00 UTC, which is the Hobby plan limit. On Pro you can run it more often.

## Slack

What users get:
- `/plan` (or `/plan today`): the rest of today's plan, with **Done** buttons. The block in progress also gets **+30 min**.
- `/plan week`: the next 7 days. `/plan risks`: tasks that will miss their deadline.
- `/plan add Send quote to Smits 1h30 by fri 17:00 !high`: adds a task and replies with when it will be finished. It also accepts `after <day>`, `today`/`tomorrow`/`mon`–`sun`/`30/10`/`2026-10-30`, `17:00`/`5pm`, and `!urgent|!high|!low`.
- **A direct message when a task starts to miss its deadline.** Each task and status is sent once; it's sent again if a task recovers and then slips again.
- **A morning summary** from the daily job, skipped when there's nothing planned and nothing at risk.

Setup:
1. Open `https://YOUR-APP/api/slack/manifest` and copy the JSON. It already contains your URLs.
2. Go to api.slack.com/apps → **Create New App → From a manifest**, pick the workspace and paste the JSON.
3. Under **Basic Information**, copy the Client ID, Client Secret and Signing Secret into Vercel as `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`, then redeploy.
4. In the planner, go to **Integrations → Add to Slack**. This installs the bot in the workspace and links your own Slack account.
5. Colleagues type `/plan connect` in Slack, click the link, sign in and confirm.

The app only asks for the `commands` and `chat:write` scopes, so it can't read channels or messages. Every request from Slack is checked against the signing secret, and requests older than 5 minutes are refused. Bot tokens are encrypted like the Google tokens. If the client's workspace already has a `/plan` command, rename it in the manifest.

## Embedding in another app

1. The user creates an API key in the app under **Embed** (`/developers`).
2. Your **backend** exchanges it for a 1-hour embed token:
   ```bash
   curl -X POST https://YOUR-APP/api/embed/token -H "Authorization: Bearer ais_…"
   # → { "token": "…", "expiresIn": 3600, "embedUrl": "https://YOUR-APP/embed?token=…" }
   ```
3. Render it in your page:
   ```html
   <div data-ai-scheduler data-token="TOKEN" data-view="week"></div>
   <script src="https://YOUR-APP/embed.js" async></script>
   ```
4. Listen for `ai-scheduler:plan` events on the container (`event.detail.atRisk` lists the tasks at risk). To switch views, post `{ type: "ai-scheduler:set-view", view: "day" }` to the iframe.

The embed uses a bearer token instead of cookies, so it works in third-party iframes. Only origins listed in `EMBED_ALLOWED_ORIGINS` can frame it; the policy is read at request time, so changing it needs no rebuild.

## Security notes
- Google refresh and access tokens are encrypted with AES-256-GCM before storage. The `google_connections` and `api_keys` tables have no RLS policies, so only the server can read them.
- API keys are stored as SHA-256 hashes and shown once.
- The server uses the service role and filters every query by `user_id` (`src/lib/server/store.ts`). RLS still protects direct access with the anon key; the DB tests cover cross-user reads and writes.
- Re-plans for the same user are serialized with a Postgres advisory lock, so a webhook and a user action can't interleave.
- OAuth uses a `state` value bound to an httpOnly cookie. The webhook checks a per-channel secret token, and the cron route checks `CRON_SECRET`, both with constant-time comparison.

## Project layout
```
src/lib/scheduler/   engine.ts (planning rules), time.ts, seed.ts (demo + test data), types.ts
src/lib/client/      SchedulerClient interface; DemoClient (browser) and ApiClient (server)
src/lib/server/      env, auth, Supabase store, Google OAuth/sync/write-back, planner orchestration
src/lib/google/      pure Google event mapping
src/lib/slack/       /plan parsing, Block Kit messages, alert logic, signature check (pure, tested)
src/components/      SchedulerApp, CalendarView, TaskList, TaskForm, Inspector, SettingsPanel
src/app/             pages (/, /login, /embed, /developers) and API routes (/api/*)
supabase/            migration and database tests
tests/               unit tests; tests/e2e browser tests
```

## Next steps (paid per workspace)
- **Slack:** an App Home tab with the week view, and posting in the client's existing "Dependables" bot instead of a separate app.
- **Team scheduling:** add `workspaces` and `workspace_members`, and plan across members' free time. The engine already takes events and tasks as plain inputs.
- **Outlook:** add a Microsoft Graph provider next to `src/lib/server/google.ts`. `CalendarEvent.source` and the connection model are provider-neutral.
- **Auto-tasks** from a builder's project page or a seller's campaigns: create tasks through the API with `source` set (e.g. `campaign:123`). The column already exists.
