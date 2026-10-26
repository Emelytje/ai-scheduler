import { ceilTo, MINUTE, normalize, overlaps, subtract, workingWindows, type Interval } from "./time";
import {
  PRIORITY_RANK,
  type PlanDiff,
  type PlanInput,
  type PlanResult,
  type ScheduledBlock,
  type Task,
  type TaskPlan,
} from "./types";

const MAX_HORIZON_DAYS = 60;

let idCounter = 0;
function newBlockId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  idCounter += 1;
  return `blk-${Date.now().toString(36)}-${idCounter}`;
}

const ms = (iso: string) => new Date(iso).getTime();
const iso = (t: number) => new Date(t).toISOString();

/**
 * Ordering used for placement: earliest deadline first, then higher priority,
 * then earliest "not before", then oldest. Fully deterministic.
 */
export function compareTasks(a: Task, b: Task): number {
  const da = a.deadline ? ms(a.deadline) : Infinity;
  const db = b.deadline ? ms(b.deadline) : Infinity;
  if (da !== db) return da - db;
  const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (pr !== 0) return pr;
  const na = a.notBefore ? ms(a.notBefore) : 0;
  const nb = b.notBefore ? ms(b.notBefore) : 0;
  if (na !== nb) return na - nb;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Placement {
  chunks: Interval[];
  free: Interval[];
  leftover: number;
}

/**
 * Place `minutes` of work for a task into `free` as early as possible, at or after
 * `earliest`. Returns the chunks and the new free list (input is not mutated).
 */
export function placeTask(
  task: Pick<Task, "splittable" | "minChunkMinutes">,
  minutes: number,
  free: Interval[],
  earliest: number,
  slotMinutes: number,
): Placement {
  let remaining = minutes * MINUTE;
  const minChunk = Math.max(1, task.minChunkMinutes) * MINUTE;
  const chunks: Interval[] = [];

  for (const f of free) {
    if (remaining <= 0) break;
    const start = ceilTo(Math.max(f.start, earliest), slotMinutes);
    const room = f.end - start;
    if (room <= 0) continue;
    if (!task.splittable) {
      if (room >= remaining) {
        chunks.push({ start, end: start + remaining });
        remaining = 0;
      }
      continue;
    }
    // A chunk must be at least minChunk long, unless what is left is smaller than that.
    const needed = Math.min(minChunk, remaining);
    if (room < needed) continue;
    let take = Math.min(room, remaining);
    // Never leave a tail shorter than minChunk: it would need its own undersized block.
    const tail = remaining - take;
    if (tail > 0 && tail < minChunk) take = remaining - minChunk;
    if (take < needed) continue;
    chunks.push({ start, end: start + take });
    remaining -= take;
  }

  return {
    chunks,
    free: chunks.length ? subtract(free, chunks) : free,
    leftover: Math.max(0, Math.round(remaining / MINUTE)),
  };
}

/**
 * Pure planning function. Keeps past blocks as history, locks the block in progress,
 * and (re)places all remaining work in free working time.
 */
export function plan(input: PlanInput): PlanResult {
  const t0 = performance.now();
  const { settings } = input;
  const now = input.now.getTime();
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));

  const busy: Interval[] = input.events
    .filter((e) => e.busy)
    .map((e) => ({
      start: ms(e.start) - settings.bufferMinutes * MINUTE,
      end: ms(e.end) + settings.bufferMinutes * MINUTE,
    }));
  const rawBusy: Interval[] = input.events.filter((e) => e.busy).map((e) => ({ start: ms(e.start), end: ms(e.end) }));

  // 1. Split previous blocks into history (kept), in-progress (locked) and future (replanned).
  const history: ScheduledBlock[] = [];
  const locked: ScheduledBlock[] = [];
  const previousFuture: ScheduledBlock[] = [];
  for (const b of input.previousBlocks) {
    const task = taskById.get(b.taskId);
    if (!task) continue;
    const s = ms(b.start);
    const e = ms(b.end);
    if (e <= now) history.push(b);
    else if (s < now) {
      if (task.status === "done") {
        history.push({ ...b, end: iso(now) });
        continue;
      }
      // A meeting moved onto the running block cuts it short at the meeting start.
      let end = e;
      for (const x of rawBusy) if (x.start >= now && x.start < end && x.end > now) end = x.start;
      if (rawBusy.some((x) => x.start <= now && x.end > now)) end = now;
      if (end > now) locked.push({ ...b, end: iso(end) });
      else history.push({ ...b, end: iso(now) });
    } else previousFuture.push(b);
  }

  const worked = new Map<string, number>();
  const lockedMin = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const b of history) add(worked, b.taskId, (ms(b.end) - ms(b.start)) / MINUTE);
  for (const b of locked) {
    add(worked, b.taskId, (now - ms(b.start)) / MINUTE);
    add(lockedMin, b.taskId, (ms(b.end) - now) / MINUTE);
  }

  // 2. Free time = working hours from now, minus busy events (with buffer), minus locked blocks.
  const openTasks = input.tasks.filter((t) => t.status === "open");
  const latestDeadline = Math.max(now, ...openTasks.map((t) => (t.deadline ? ms(t.deadline) : 0)));
  const horizonDays = Math.min(
    MAX_HORIZON_DAYS,
    Math.max(settings.horizonDays, Math.ceil((latestDeadline - now) / 86_400_000) + 7),
  );
  const startFrom = ceilTo(now, settings.slotMinutes);
  let free = subtract(workingWindows(settings, startFrom, horizonDays), [
    ...busy,
    ...locked.map((b) => ({ start: ms(b.start), end: ms(b.end) })),
  ]);

  // 3. Work out how much each open task still needs.
  const plans: Record<string, TaskPlan> = {};
  const need = new Map<string, number>();
  for (const t of input.tasks) {
    const w = Math.round(worked.get(t.id) ?? 0);
    const l = Math.round(lockedMin.get(t.id) ?? 0);
    let remaining = Math.max(0, t.estimateMinutes - w - l);
    let overrun = false;
    if (t.status === "open" && remaining === 0 && l === 0) {
      overrun = true;
      remaining = settings.overrunExtensionMinutes;
    }
    if (t.status === "done") remaining = 0;
    need.set(t.id, remaining);
    plans[t.id] = {
      taskId: t.id,
      status: t.status === "done" ? "done" : "on_track",
      workedMinutes: w,
      remainingMinutes: remaining,
      scheduledMinutes: 0,
      unscheduledMinutes: 0,
      finishAt: null,
      overrun,
      deadlinePassed: t.status === "open" && !!t.deadline && ms(t.deadline) < now,
      reason: null,
    };
  }

  // 4. Placement. Deadline tasks that can still be on time go first (EDF). Tasks that
  //    cannot make their deadline are deferred so they don't push on-time work late,
  //    then placed ASAP; tasks without a deadline fill what is left, by priority.
  const placed = new Map<string, Interval[]>();
  const sorted = [...openTasks].sort(compareTasks);
  const withDeadline = sorted.filter((t) => t.deadline);
  const withoutDeadline = sorted.filter((t) => !t.deadline);
  const deferred: Task[] = [];
  const earliestFor = (t: Task) => Math.max(startFrom, t.notBefore ? ms(t.notBefore) : 0);

  const commit = (t: Task, p: Placement) => {
    free = p.free;
    placed.set(t.id, p.chunks);
    const plan = plans[t.id];
    plan.scheduledMinutes = Math.round(p.chunks.reduce((s, c) => s + (c.end - c.start), 0) / MINUTE);
    plan.unscheduledMinutes = p.leftover;
  };

  for (const t of withDeadline) {
    const minutes = need.get(t.id) ?? 0;
    if (minutes === 0) continue;
    const p = placeTask(t, minutes, free, earliestFor(t), settings.slotMinutes);
    const finish = p.chunks.length ? p.chunks[p.chunks.length - 1].end : Infinity;
    if (p.leftover === 0 && finish <= ms(t.deadline!)) commit(t, p);
    else deferred.push(t);
  }
  for (const t of [...deferred, ...withoutDeadline]) {
    const minutes = need.get(t.id) ?? 0;
    if (minutes === 0) continue;
    commit(t, placeTask(t, minutes, free, earliestFor(t), settings.slotMinutes));
  }

  // 5. Status + reasons.
  const allBlocksFor = (id: string): Interval[] => [
    ...locked.filter((b) => b.taskId === id).map((b) => ({ start: ms(b.start), end: ms(b.end) })),
    ...(placed.get(id) ?? []),
  ];
  for (const t of openTasks) {
    const p = plans[t.id];
    const blocks = allBlocksFor(t.id);
    const finish = blocks.length ? Math.max(...blocks.map((b) => b.end)) : null;
    p.finishAt = finish ? iso(finish) : null;
    if (p.unscheduledMinutes > 0) {
      p.status = "unschedulable";
      p.reason = `${p.unscheduledMinutes} min don't fit in working hours within the next ${horizonDays} days`;
    } else if (t.deadline && finish !== null && finish > ms(t.deadline)) {
      p.status = "late";
      p.reason = p.deadlinePassed
        ? "Deadline has already passed"
        : "Not enough free working time before the deadline";
    } else if (p.deadlinePassed) {
      p.status = "late";
      p.reason = "Deadline has already passed";
    }
  }

  // 6. Turn placements into blocks, reusing ids of the previous future blocks per task
  //    so calendar write-back updates events instead of recreating them.
  const prevByTask = new Map<string, ScheduledBlock[]>();
  for (const b of [...previousFuture].sort((a, b) => ms(a.start) - ms(b.start))) {
    const list = prevByTask.get(b.taskId) ?? [];
    list.push(b);
    prevByTask.set(b.taskId, list);
  }
  const future: ScheduledBlock[] = [];
  const diff: PlanDiff = { created: [], updated: [], deleted: [] };
  for (const t of sorted) {
    const chunks = normalize(placed.get(t.id) ?? []);
    const prev = prevByTask.get(t.id) ?? [];
    chunks.forEach((c, i) => {
      const old = prev[i];
      const block: ScheduledBlock = { id: old?.id ?? newBlockId(), taskId: t.id, start: iso(c.start), end: iso(c.end) };
      future.push(block);
      if (!old) diff.created.push(block);
      else if (ms(old.start) !== c.start || ms(old.end) !== c.end) diff.updated.push(block);
    });
    prev.slice(chunks.length).forEach((b) => diff.deleted.push(b));
    prevByTask.delete(t.id);
  }
  for (const rest of prevByTask.values()) diff.deleted.push(...rest);

  const blocks = [...history, ...locked, ...future].sort((a, b) => ms(a.start) - ms(b.start));
  return {
    blocks,
    plans,
    diff,
    computedAt: iso(now),
    durationMs: performance.now() - t0,
  };
}

/** Sanity check used by tests and the API: returns human readable violations. */
export function findConflicts(result: PlanResult, input: PlanInput): string[] {
  const now = input.now.getTime();
  const issues: string[] = [];
  const future = result.blocks.filter((b) => ms(b.end) > now);
  const busy = input.events.filter((e) => e.busy).map((e) => ({ start: ms(e.start), end: ms(e.end), title: e.title }));
  for (const b of future) {
    const iv = { start: Math.max(ms(b.start), now), end: ms(b.end) };
    for (const e of busy) if (overlaps(iv, e)) issues.push(`block ${b.id} (${b.taskId}) overlaps "${e.title}"`);
  }
  const sorted = [...future].sort((a, b) => ms(a.start) - ms(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (ms(sorted[i].start) < ms(sorted[i - 1].end)) issues.push(`blocks ${sorted[i - 1].id} and ${sorted[i].id} overlap`);
  }
  return issues;
}
