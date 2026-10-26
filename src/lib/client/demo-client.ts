import { TZDate } from "@date-fns/tz";
import { estimateAfterOverrun, plan } from "@/lib/scheduler/engine";
import { buildSeed } from "@/lib/scheduler/seed";
import { DEFAULT_SETTINGS, type Task } from "@/lib/scheduler/types";
import type { SchedulerClient, SchedulerState, TaskInput } from "./types";

const STORAGE_KEY = "ai-scheduler:demo:v1";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_SETTINGS.timezone;
  } catch {
    return DEFAULT_SETTINGS.timezone;
  }
}

/** Seed on today if it is a weekday morning, otherwise on the next weekday. */
function seedAnchor(now: Date, tz: string): Date {
  const local = new TZDate(now.getTime(), tz);
  const weekday = local.getDay() !== 0 && local.getDay() !== 6;
  if (weekday && local.getHours() < 12) return now;
  for (let i = 1; i < 4; i++) {
    const d = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + i, 8, 0, 0, tz);
    if (d.getDay() !== 0 && d.getDay() !== 6) return new Date(d.getTime());
  }
  return now;
}

export function seededState(now: Date): SchedulerState {
  const timezone = browserTimezone();
  const settings = { ...DEFAULT_SETTINGS, timezone };
  const { events, tasks } = buildSeed(seedAnchor(now, timezone), timezone);
  return replan(
    {
      mode: "demo",
      tasks,
      events,
      blocks: [],
      plans: {},
      settings,
      calendar: { provider: "demo", connected: true, email: null, lastSyncAt: now.toISOString(), error: null },
      lastPlannedAt: null,
      lastPlanMs: null,
    },
    now,
  );
}

export function replan(state: SchedulerState, now: Date): SchedulerState {
  const result = plan({
    tasks: state.tasks,
    events: state.events,
    previousBlocks: state.blocks,
    settings: state.settings,
    now,
  });
  return { ...state, blocks: result.blocks, plans: result.plans, lastPlannedAt: result.computedAt, lastPlanMs: result.durationMs };
}

/** Runs entirely in the browser; data lives in localStorage. */
export class DemoClient implements SchedulerClient {
  private state: SchedulerState | null = null;
  constructor(private readonly clock: () => Date = () => new Date()) {}

  private read(): SchedulerState | null {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SchedulerState) : null;
    } catch {
      return null;
    }
  }

  private commit(next: SchedulerState): SchedulerState {
    this.state = replan(next, this.clock());
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage unavailable (private mode, embedded preview): keep state in memory only.
    }
    return this.state;
  }

  private current(): SchedulerState {
    if (!this.state) this.state = this.read() ?? seededState(this.clock());
    return this.state;
  }

  private patchTask(id: string, fn: (t: Task) => Task): SchedulerState {
    const s = this.current();
    return this.commit({ ...s, tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) });
  }

  async load() {
    return this.commit(this.current());
  }

  async createTask(input: TaskInput) {
    const s = this.current();
    const task: Task = { ...input, id: newId(), status: "open", createdAt: this.clock().toISOString(), source: "manual" };
    return this.commit({ ...s, tasks: [...s.tasks, task] });
  }

  async updateTask(id: string, patch: Partial<TaskInput>) {
    return this.patchTask(id, (t) => ({ ...t, ...patch }));
  }

  async deleteTask(id: string) {
    const s = this.current();
    return this.commit({ ...s, tasks: s.tasks.filter((t) => t.id !== id), blocks: s.blocks.filter((b) => b.taskId !== id) });
  }

  async setTaskDone(id: string, done: boolean) {
    return this.patchTask(id, (t) => ({ ...t, status: done ? "done" : "open" }));
  }

  async reportOverrun(id: string, extraMinutes: number) {
    const s = this.current();
    const p = s.plans[id];
    if (!p) return s;
    return this.patchTask(id, (t) => ({ ...t, estimateMinutes: estimateAfterOverrun(t, p, extraMinutes) }));
  }

  async updateSettings(patch: Partial<SchedulerState["settings"]>) {
    const s = this.current();
    return this.commit({ ...s, settings: { ...s.settings, ...patch } });
  }

  async sync() {
    const s = this.current();
    return this.commit({ ...s, calendar: { ...s.calendar, lastSyncAt: this.clock().toISOString() } });
  }

  async moveEvent(id: string, deltaMinutes: number) {
    const s = this.current();
    const shift = (iso: string) => new Date(new Date(iso).getTime() + deltaMinutes * 60_000).toISOString();
    return this.commit({
      ...s,
      events: s.events.map((e) => (e.id === id ? { ...e, start: shift(e.start), end: shift(e.end) } : e)),
    });
  }

  async reset() {
    this.state = null;
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return this.commit(seededState(this.clock()));
  }
}
