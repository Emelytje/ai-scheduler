import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type CalendarEvent, type ScheduledBlock, type Settings, type Task } from "@/lib/scheduler/types";
import type { TaskInput } from "@/lib/client/types";
import { supabaseAdmin } from "./supabase";

export interface StoredBlock extends ScheduledBlock {
  googleEventId: string | null;
}

export interface GoogleConnectionRow {
  user_id: string;
  email: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_token: string | null;
  channel_expires_at: string | null;
  write_blocks: boolean;
  last_sync_at: string | null;
  error: string | null;
}

type TaskRow = {
  id: string;
  title: string;
  estimate_minutes: number;
  deadline: string | null;
  not_before: string | null;
  priority: Task["priority"];
  status: Task["status"];
  splittable: boolean;
  min_chunk_minutes: number;
  source: string;
  created_at: string;
};

const toIso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const taskFromRow = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  estimateMinutes: r.estimate_minutes,
  deadline: toIso(r.deadline),
  notBefore: toIso(r.not_before),
  priority: r.priority,
  status: r.status,
  splittable: r.splittable,
  minChunkMinutes: r.min_chunk_minutes,
  createdAt: new Date(r.created_at).toISOString(),
  source: r.source,
});

function taskPatchToRow(p: Partial<TaskInput> & { status?: Task["status"] }) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.title !== undefined) row.title = p.title;
  if (p.estimateMinutes !== undefined) row.estimate_minutes = p.estimateMinutes;
  if (p.deadline !== undefined) row.deadline = p.deadline;
  if (p.notBefore !== undefined) row.not_before = p.notBefore;
  if (p.priority !== undefined) row.priority = p.priority;
  if (p.splittable !== undefined) row.splittable = p.splittable;
  if (p.minChunkMinutes !== undefined) row.min_chunk_minutes = p.minChunkMinutes;
  if (p.status !== undefined) row.status = p.status;
  return row;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

/** All data access for one user. The service-role client bypasses RLS, so every query filters by user_id. */
export class Store {
  constructor(
    readonly userId: string,
    private readonly db: SupabaseClient = supabaseAdmin(),
  ) {}

  async getSettings(): Promise<Settings> {
    const row = check(await this.db.from("scheduler_settings").select("settings").eq("user_id", this.userId).maybeSingle());
    return { ...DEFAULT_SETTINGS, ...((row?.settings as Partial<Settings>) ?? {}) };
  }

  async saveSettings(settings: Settings) {
    check(
      await this.db
        .from("scheduler_settings")
        .upsert({ user_id: this.userId, settings, updated_at: new Date().toISOString() }),
    );
  }

  async listTasks(): Promise<Task[]> {
    // Done tasks older than 14 days are not needed for planning or display.
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const rows = check(
      await this.db
        .from("tasks")
        .select("*")
        .eq("user_id", this.userId)
        .or(`status.eq.open,updated_at.gte."${since}"`)
        .order("created_at"),
    ) as TaskRow[];
    return rows.map(taskFromRow);
  }

  async getTask(id: string): Promise<Task | null> {
    const row = check(await this.db.from("tasks").select("*").eq("user_id", this.userId).eq("id", id).maybeSingle()) as TaskRow | null;
    return row ? taskFromRow(row) : null;
  }

  async createTask(input: TaskInput, source = "manual"): Promise<Task> {
    const row = check(
      await this.db
        .from("tasks")
        .insert({ ...taskPatchToRow(input), user_id: this.userId, source })
        .select("*")
        .single(),
    ) as TaskRow;
    return taskFromRow(row);
  }

  async updateTask(id: string, patch: Partial<TaskInput> & { status?: Task["status"] }) {
    const rows = check(await this.db.from("tasks").update(taskPatchToRow(patch)).eq("user_id", this.userId).eq("id", id).select("id"));
    if (!rows?.length) throw new Error("Task not found");
  }

  async deleteTask(id: string) {
    check(await this.db.from("tasks").delete().eq("user_id", this.userId).eq("id", id));
  }

  /** Blocks that can still matter: finished in the last 14 days or later. */
  async listBlocks(): Promise<StoredBlock[]> {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const rows = check(
      await this.db
        .from("scheduled_blocks")
        .select("id, task_id, start_at, end_at, google_event_id")
        .eq("user_id", this.userId)
        .gte("end_at", since)
        .order("start_at"),
    ) as { id: string; task_id: string; start_at: string; end_at: string; google_event_id: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      start: new Date(r.start_at).toISOString(),
      end: new Date(r.end_at).toISOString(),
      googleEventId: r.google_event_id,
    }));
  }

  /** Atomically replace unfinished blocks (see replace_future_blocks in the migration). */
  async replaceUnfinishedBlocks(now: Date, blocks: StoredBlock[]) {
    check(
      await this.db.rpc("replace_future_blocks", {
        p_user: this.userId,
        p_now: now.toISOString(),
        p_blocks: blocks.map((b) => ({ id: b.id, taskId: b.taskId, start: b.start, end: b.end, googleEventId: b.googleEventId })),
      }),
    );
  }

  async setBlockGoogleIds(pairs: { id: string; googleEventId: string | null }[]) {
    for (const p of pairs) {
      check(
        await this.db.from("scheduled_blocks").update({ google_event_id: p.googleEventId }).eq("user_id", this.userId).eq("id", p.id),
      );
    }
  }

  async listEvents(): Promise<CalendarEvent[]> {
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const rows = check(
      await this.db
        .from("calendar_events")
        .select("id, title, start_at, end_at, busy, all_day")
        .eq("user_id", this.userId)
        .gte("end_at", since)
        .order("start_at"),
    ) as { id: string; title: string; start_at: string; end_at: string; busy: boolean; all_day: boolean }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      start: new Date(r.start_at).toISOString(),
      end: new Date(r.end_at).toISOString(),
      busy: r.busy,
      allDay: r.all_day,
      source: "google" as const,
    }));
  }

  /** Replace the cached events that overlap [from, to) with a fresh copy from the calendar. */
  async replaceEventsInWindow(from: Date, to: Date, events: CalendarEvent[]) {
    check(
      await this.db
        .from("calendar_events")
        .delete()
        .eq("user_id", this.userId)
        .lt("start_at", to.toISOString())
        .gt("end_at", from.toISOString()),
    );
    if (!events.length) return;
    check(
      await this.db.from("calendar_events").upsert(
        events.map((e) => ({
          user_id: this.userId,
          id: e.id,
          title: e.title,
          start_at: e.start,
          end_at: e.end,
          busy: e.busy,
          all_day: !!e.allDay,
          updated_at: new Date().toISOString(),
        })),
      ),
    );
  }

  async clearEvents() {
    check(await this.db.from("calendar_events").delete().eq("user_id", this.userId));
  }

  async getConnection(): Promise<GoogleConnectionRow | null> {
    return check(await this.db.from("google_connections").select("*").eq("user_id", this.userId).maybeSingle()) as GoogleConnectionRow | null;
  }

  async saveConnection(patch: Partial<GoogleConnectionRow>) {
    check(await this.db.from("google_connections").upsert({ ...patch, user_id: this.userId }));
  }

  async deleteConnection() {
    check(await this.db.from("google_connections").delete().eq("user_id", this.userId));
  }

  async recordPlanRun(run: { trigger: string; engineMs: number; totalMs: number; created: number; updated: number; deleted: number }) {
    check(
      await this.db.from("plan_runs").insert({
        user_id: this.userId,
        trigger: run.trigger,
        engine_ms: run.engineMs,
        total_ms: run.totalMs,
        blocks_created: run.created,
        blocks_updated: run.updated,
        blocks_deleted: run.deleted,
      }),
    );
  }
}

/** Look up the user that owns a Google push channel. */
export async function userForChannel(channelId: string): Promise<{ userId: string; token: string | null } | null> {
  const row = check(
    await supabaseAdmin().from("google_connections").select("user_id, channel_token").eq("channel_id", channelId).maybeSingle(),
  ) as { user_id: string; channel_token: string | null } | null;
  return row ? { userId: row.user_id, token: row.channel_token } : null;
}

/** Everyone the daily job should re-plan: connected calendars plus linked Slack users. */
export async function listUsersToRefresh(): Promise<{ userId: string; channelExpiresAt: string | null; google: boolean }[]> {
  const db = supabaseAdmin();
  const google = check(await db.from("google_connections").select("user_id, channel_expires_at").is("error", null)) as {
    user_id: string;
    channel_expires_at: string | null;
  }[];
  const slack = check(await db.from("slack_links").select("user_id")) as { user_id: string }[];
  const out = new Map<string, { userId: string; channelExpiresAt: string | null; google: boolean }>();
  for (const g of google) out.set(g.user_id, { userId: g.user_id, channelExpiresAt: g.channel_expires_at, google: true });
  for (const s of slack) if (!out.has(s.user_id)) out.set(s.user_id, { userId: s.user_id, channelExpiresAt: null, google: false });
  return [...out.values()];
}

export async function userForApiKey(keyHash: string): Promise<string | null> {
  const db = supabaseAdmin();
  const row = check(await db.from("api_keys").select("id, user_id").eq("key_hash", keyHash).maybeSingle()) as {
    id: string;
    user_id: string;
  } | null;
  if (!row) return null;
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return row.user_id;
}
