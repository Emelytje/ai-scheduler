# AI Scheduler

Puts every task on the calendar automatically. Tasks have a duration, deadline, priority and optional "not before" date. The planner places them in free working time around Google Calendar meetings, deadline first. When a meeting moves or a task runs over, it re-plans the rest of the week and flags anything that will miss its deadline. There's a day/week calendar and a task list, and the whole view can be embedded in another app.

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
| API routes against a real Supabase project | ⚠️ Not verified | Builds and type-checks; needs a Supabase project to run |
| Supabase Auth sign-in (magic link / Google) | ⚠️ Not verified | Needs a Supabase project |
| Google Calendar OAuth, sync, push notifications, write-back | ⚠️ Not verified | Needs Google OAuth credentials and a public HTTPS URL |
| CI workflow (`.github/workflows/ci.yml`) | ⚠️ Not verified | Runs on the first push |

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

## Deploy (Supabase + Google + Vercel)

### 1. Supabase
1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_init.sql`, either in the SQL editor or with `npx supabase link && npx supabase db push`.
3. Go to **Authentication → URL Configuration**. Set Site URL to your app URL and add `https://YOUR-APP/auth/callback` to the redirect URLs.
4. Optional: to offer "Continue with Google" sign-in, enable Google under **Authentication → Providers**. Email magic links work without this.
5. From **Project Settings → API**, copy the project URL, the anon (publishable) key and the service role (secret) key.

### 2. Google Calendar
1. In Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Configure the **OAuth consent screen** and add the scope `.../auth/calendar.events`. This scope is classified as *sensitive*. While the app is in "Testing", only the test users you list can connect (max. 100). Going public requires Google's verification.
3. Under **Credentials → OAuth client ID → Web application**, add the authorized redirect URI `https://YOUR-APP/api/google/callback`.
4. Push notifications (instant re-plans when a meeting moves) need the public HTTPS URL of the deployment. Without them, changes are picked up on load, focus, every 2 minutes in the open app, and by the daily cron job.

### 3. Vercel
1. Import the GitHub repository in Vercel. The framework is detected as Next.js.
2. Add the environment variables from `.env.example`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `APP_URL` | Your production URL, e.g. `https://ai-scheduler.vercel.app` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → Credentials |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (encrypts Google tokens at rest) |
| `EMBED_SIGNING_SECRET` | `openssl rand -hex 32` |
| `EMBED_ALLOWED_ORIGINS` | Origins of the host apps that may iframe `/embed`, space separated |
| `CRON_SECRET` | `openssl rand -hex 32` (Vercel Cron sends it automatically) |

3. Deploy, then open `https://YOUR-APP/api/health`. It reports which integrations are configured (never their values).
4. Cron: `vercel.json` runs `/api/cron/sync` daily, which is the Hobby plan limit. On Pro, change it to e.g. `*/15 * * * *` for a tighter safety net.

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
src/components/      SchedulerApp, CalendarView, TaskList, TaskForm, Inspector, SettingsPanel
src/app/             pages (/, /login, /embed, /developers) and API routes (/api/*)
supabase/            migration and database tests
tests/               unit tests; tests/e2e browser tests
```

## Next steps (paid per workspace)
- **Team scheduling:** add `workspaces` and `workspace_members`, and plan across members' free time. The engine already takes events and tasks as plain inputs.
- **Outlook:** add a Microsoft Graph provider next to `src/lib/server/google.ts`. `CalendarEvent.source` and the connection model are provider-neutral.
- **Auto-tasks** from a builder's project page or a seller's campaigns: create tasks through the API with `source` set (e.g. `campaign:123`). The column already exists.
