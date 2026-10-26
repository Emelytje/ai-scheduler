import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import { estimateAfterOverrun, findConflicts, placeTask, plan } from "@/lib/scheduler/engine";
import { buildSeed } from "@/lib/scheduler/seed";
import { MINUTE, subtract, workingWindows } from "@/lib/scheduler/time";
import {
  DEFAULT_SETTINGS,
  type CalendarEvent,
  type PlanInput,
  type PlanResult,
  type Settings,
  type Task,
} from "@/lib/scheduler/types";

const TZ = "Europe/Brussels";
const settings: Settings = { ...DEFAULT_SETTINGS, timezone: TZ };
const local = (y: number, m: number, d: number, h: number, mi = 0) =>
  new Date(new TZDate(y, m - 1, d, h, mi, 0, TZ).getTime());
// Monday 26 Oct 2026, 08:30 local (the day after the autumn DST switch).
const MONDAY_0830 = local(2026, 10, 26, 8, 30);
const ms = (s: string) => new Date(s).getTime();

function task(id: string, estimateMinutes: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    estimateMinutes,
    deadline: null,
    notBefore: null,
    priority: "medium",
    status: "open",
    splittable: true,
    minChunkMinutes: 30,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

function meeting(id: string, start: Date, end: Date, busy = true): CalendarEvent {
  return { id, title: id, start: start.toISOString(), end: end.toISOString(), busy, source: "demo" };
}

const blocksOf = (r: PlanResult, id: string) => r.blocks.filter((b) => b.taskId === id);

/** Every future block must sit inside a working window. */
function outsideWorkingHours(r: PlanResult, input: PlanInput): string[] {
  const now = input.now.getTime();
  const windows = workingWindows(input.settings, now - 86_400_000, 70);
  return r.blocks
    .filter((b) => ms(b.end) > now)
    .filter((b) => !windows.some((w) => ms(b.start) >= w.start && ms(b.end) <= w.end))
    .map((b) => `${b.taskId} ${b.start}–${b.end}`);
}

describe("conflicts", () => {
  const seed = buildSeed(MONDAY_0830, TZ);
  const input: PlanInput = { ...seed, previousBlocks: [], settings, now: MONDAY_0830 };
  const result = plan(input);

  it("seed has 20 tasks and the full week of meetings", () => {
    expect(seed.tasks).toHaveLength(20);
    expect(seed.events.length).toBeGreaterThanOrEqual(19);
  });

  it("never overlaps a meeting or another block", () => {
    expect(findConflicts(result, input)).toEqual([]);
  });

  it("only places work inside working hours", () => {
    expect(outsideWorkingHours(result, input)).toEqual([]);
  });

  it("schedules every task that fits", () => {
    for (const t of seed.tasks) {
      const p = result.plans[t.id];
      expect(p.unscheduledMinutes, t.id).toBe(0);
      expect(p.scheduledMinutes, t.id).toBe(t.estimateMinutes);
    }
  });

  it("uses time covered by events marked as free", () => {
    const now = local(2026, 10, 28, 13, 0); // Wednesday 13:00
    const r = plan({
      tasks: [task("a", 60)],
      events: [meeting("webinar", now, local(2026, 10, 28, 14, 0), false)],
      previousBlocks: [],
      settings,
      now,
    });
    expect(blocksOf(r, "a")[0].start).toBe(now.toISOString());
  });

  it("keeps the configured buffer around meetings", () => {
    const now = local(2026, 10, 26, 9, 0);
    const r = plan({
      tasks: [task("a", 60)],
      events: [meeting("m", local(2026, 10, 26, 9, 0), local(2026, 10, 26, 10, 0))],
      previousBlocks: [],
      settings: { ...settings, bufferMinutes: 15 },
      now,
    });
    expect(blocksOf(r, "a")[0].start).toBe(local(2026, 10, 26, 10, 15).toISOString());
  });

  it("respects not-before dates", () => {
    for (const t of seed.tasks.filter((t) => t.notBefore)) {
      for (const b of blocksOf(result, t.id)) expect(ms(b.start), t.id).toBeGreaterThanOrEqual(ms(t.notBefore!));
    }
  });

  it("keeps non-splittable tasks in one contiguous block", () => {
    for (const t of seed.tasks.filter((t) => !t.splittable)) {
      const bs = blocksOf(result, t.id);
      expect(bs, t.id).toHaveLength(1);
      expect((ms(bs[0].end) - ms(bs[0].start)) / MINUTE).toBe(t.estimateMinutes);
    }
  });

  it("does not create chunks smaller than the minimum (unless the task is smaller)", () => {
    for (const t of seed.tasks) {
      for (const b of blocksOf(result, t.id)) {
        const len = (ms(b.end) - ms(b.start)) / MINUTE;
        expect(len, t.id).toBeGreaterThanOrEqual(Math.min(t.minChunkMinutes, t.estimateMinutes));
      }
    }
  });

  it("splits a task around a meeting instead of overlapping it", () => {
    const now = local(2026, 10, 26, 9, 0);
    const r = plan({
      tasks: [task("a", 120)],
      events: [meeting("m", local(2026, 10, 26, 10, 0), local(2026, 10, 26, 11, 0))],
      previousBlocks: [],
      settings,
      now,
    });
    expect(blocksOf(r, "a").map((b) => [b.start, b.end])).toEqual([
      [local(2026, 10, 26, 9, 0).toISOString(), local(2026, 10, 26, 10, 0).toISOString()],
      [local(2026, 10, 26, 11, 0).toISOString(), local(2026, 10, 26, 12, 0).toISOString()],
    ]);
  });

  it("follows local working hours across a DST change", () => {
    // Friday 27 March 2026; DST starts Sunday 29 March in Brussels.
    const now = local(2026, 3, 27, 16, 0);
    const r = plan({ tasks: [task("a", 120, { splittable: false })], events: [], previousBlocks: [], settings, now });
    const b = blocksOf(r, "a")[0];
    expect(new TZDate(ms(b.start), TZ).getHours()).toBe(9);
    expect(new TZDate(ms(b.start), TZ).getDate()).toBe(30);
  });
});

describe("deadlines", () => {
  const seed = buildSeed(MONDAY_0830, TZ);
  const input: PlanInput = { ...seed, previousBlocks: [], settings, now: MONDAY_0830 };
  const result = plan(input);

  it("finishes every feasible task before its deadline", () => {
    for (const t of seed.tasks.filter((t) => t.deadline && t.id !== "t20")) {
      const p = result.plans[t.id];
      expect(p.status, t.id).toBe("on_track");
      expect(ms(p.finishAt!), t.id).toBeLessThanOrEqual(ms(t.deadline!));
    }
  });

  it("flags the task that cannot meet its deadline", () => {
    const p = result.plans.t20;
    expect(p.status).toBe("late");
    expect(p.reason).toMatch(/not enough free working time/i);
  });

  it("never places a task after its deadline when there was room before (acceptance)", () => {
    expectLateTasksJustified(result, input);
  });

  it("places the earlier deadline first", () => {
    const now = local(2026, 10, 26, 9, 0);
    const r = plan({
      tasks: [
        task("later", 60, { deadline: local(2026, 10, 30, 17).toISOString(), priority: "urgent" }),
        task("sooner", 60, { deadline: local(2026, 10, 27, 17).toISOString(), priority: "low" }),
      ],
      events: [],
      previousBlocks: [],
      settings,
      now,
    });
    expect(ms(blocksOf(r, "sooner")[0].start)).toBeLessThan(ms(blocksOf(r, "later")[0].start));
  });

  it("uses priority to break ties between equal deadlines", () => {
    const now = local(2026, 10, 26, 9, 0);
    const deadline = local(2026, 10, 30, 17).toISOString();
    const r = plan({
      tasks: [task("low", 60, { deadline, priority: "low" }), task("high", 60, { deadline, priority: "high" })],
      events: [],
      previousBlocks: [],
      settings,
      now,
    });
    expect(ms(blocksOf(r, "high")[0].start)).toBeLessThan(ms(blocksOf(r, "low")[0].start));
  });

  it("does not let a hopeless task push on-time tasks past their deadline", () => {
    const now = local(2026, 10, 26, 9, 0);
    const r = plan({
      tasks: [
        task("hopeless", 600, { deadline: local(2026, 10, 26, 17).toISOString() }),
        task("feasible", 240, { deadline: local(2026, 10, 26, 17).toISOString() }),
      ],
      events: [],
      previousBlocks: [],
      settings,
      now,
    });
    expect(r.plans.feasible.status).toBe("on_track");
    expect(r.plans.hopeless.status).toBe("late");
  });

  it("flags a deadline that already passed", () => {
    const now = local(2026, 10, 28, 9, 0);
    const r = plan({
      tasks: [task("a", 30, { deadline: local(2026, 10, 27, 17).toISOString() })],
      events: [],
      previousBlocks: [],
      settings,
      now,
    });
    expect(r.plans.a.status).toBe("late");
    expect(r.plans.a.deadlinePassed).toBe(true);
  });

  it("flags work that does not fit in the planning horizon", () => {
    const now = local(2026, 10, 26, 9, 0);
    const r = plan({
      tasks: [task("huge", 8 * 60 * 80)],
      events: [],
      previousBlocks: [],
      settings,
      now,
    });
    expect(r.plans.huge.status).toBe("unschedulable");
    expect(r.plans.huge.unscheduledMinutes).toBeGreaterThan(0);
  });

  it("flags a non-splittable task that is longer than any working day", () => {
    const r = plan({
      tasks: [task("block", 9 * 60, { splittable: false })],
      events: [],
      previousBlocks: [],
      settings,
      now: MONDAY_0830,
    });
    expect(r.plans.block.status).toBe("unschedulable");
  });

  it("holds the scheduling rules on 200 random calendars", () => {
    let rnd = 42;
    const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    for (let run = 0; run < 200; run++) {
      const now = local(2026, 10, 26, 8 + Math.floor(rand() * 8), pick([0, 15, 30, 45]));
      const events: CalendarEvent[] = [];
      for (let i = 0; i < 15; i++) {
        const day = 26 + Math.floor(rand() * 5);
        const h = 8 + Math.floor(rand() * 9);
        const start = local(2026, 10, day, h, pick([0, 10, 30, 45]));
        events.push(meeting(`m${i}`, start, new Date(start.getTime() + pick([15, 30, 60, 90]) * MINUTE)));
      }
      const tasks: Task[] = [];
      for (let i = 0; i < 20; i++) {
        const hasDeadline = rand() < 0.8;
        const notBefore = rand() < 0.2 ? local(2026, 10, 26 + Math.floor(rand() * 4), 12).toISOString() : null;
        tasks.push(
          task(`t${i}`, pick([15, 30, 45, 60, 90, 120, 180]), {
            priority: pick(["low", "medium", "high", "urgent"] as const),
            deadline: hasDeadline ? local(2026, 10, 26 + Math.floor(rand() * 7), pick([11, 13, 17])).toISOString() : null,
            notBefore,
            splittable: rand() < 0.8,
          }),
        );
      }
      const input: PlanInput = { tasks, events, previousBlocks: [], settings, now };
      const r = plan(input);
      expect(findConflicts(r, input), `run ${run}`).toEqual([]);
      expect(outsideWorkingHours(r, input), `run ${run}`).toEqual([]);
      for (const t of tasks.filter((t) => t.notBefore)) {
        for (const b of blocksOf(r, t.id)) expect(ms(b.start)).toBeGreaterThanOrEqual(ms(t.notBefore!));
      }
      expectLateTasksJustified(r, input);
    }
  });
});

/**
 * For every task that ends after its deadline, prove there was no room for it before the
 * deadline: even ignoring all tasks with a later deadline (and tasks without one), the
 * remaining free time could not fit it.
 */
function expectLateTasksJustified(r: PlanResult, input: PlanInput) {
  const now = input.now.getTime();
  for (const t of input.tasks) {
    const p = r.plans[t.id];
    if (p.status !== "late" && p.status !== "unschedulable") continue;
    if (!t.deadline || p.deadlinePassed) continue;
    const deadline = ms(t.deadline);
    const earlierOnTime = input.tasks.filter(
      (o) => o.id !== t.id && o.deadline && ms(o.deadline) <= deadline && r.plans[o.id].status === "on_track",
    );
    const occupied = r.blocks
      .filter((b) => earlierOnTime.some((o) => o.id === b.taskId))
      .map((b) => ({ start: ms(b.start), end: ms(b.end) }));
    const busy = input.events.filter((e) => e.busy).map((e) => ({
      start: ms(e.start) - input.settings.bufferMinutes * MINUTE,
      end: ms(e.end) + input.settings.bufferMinutes * MINUTE,
    }));
    const free = subtract(workingWindows(input.settings, now, 60), [...busy, ...occupied]).filter(
      (f) => f.start < deadline,
    ).map((f) => ({ start: f.start, end: Math.min(f.end, deadline) }));
    const earliest = Math.max(now, t.notBefore ? ms(t.notBefore) : 0);
    const attempt = placeTask(t, p.remainingMinutes, free, earliest, input.settings.slotMinutes);
    expect(attempt.leftover, `${t.id} is late although it fits before its deadline`).toBeGreaterThan(0);
  }
}

describe("replanning", () => {
  const seed = buildSeed(MONDAY_0830, TZ);
  const settingsSeed = settings;

  it("moves blocks when a meeting moves onto them, under 5 seconds (acceptance)", () => {
    const first = plan({ ...seed, previousBlocks: [], settings: settingsSeed, now: MONDAY_0830 });
    // Move Tuesday's site visit to Monday morning 08:45–12:00 — on top of planned work.
    const moved = seed.events.map((e) =>
      e.id === "m-site"
        ? { ...e, start: local(2026, 10, 26, 8, 45).toISOString(), end: local(2026, 10, 26, 12, 0).toISOString() }
        : e,
    );
    const input: PlanInput = { tasks: seed.tasks, events: moved, previousBlocks: first.blocks, settings, now: MONDAY_0830 };
    const started = performance.now();
    const second = plan(input);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(5000);
    expect(findConflicts(second, input)).toEqual([]);
    expect(second.diff.updated.length + second.diff.created.length).toBeGreaterThan(0);
    expectLateTasksJustified(second, input);
    // Freed Tuesday afternoon is now usable.
    const tuesdayAfternoon = second.blocks.filter(
      (b) => ms(b.start) >= local(2026, 10, 27, 13).getTime() && ms(b.end) <= local(2026, 10, 27, 15, 30).getTime(),
    );
    expect(tuesdayAfternoon.length).toBeGreaterThan(0);
  });

  it("produces no changes when nothing changed", () => {
    const first = plan({ ...seed, previousBlocks: [], settings, now: MONDAY_0830 });
    const again = plan({ ...seed, previousBlocks: first.blocks, settings, now: MONDAY_0830 });
    expect(again.diff).toEqual({ created: [], updated: [], deleted: [] });
    expect(again.blocks).toEqual(first.blocks);
  });

  it("re-plans the rest of the week when a task overruns", () => {
    const now = local(2026, 10, 26, 9, 0);
    const tasks = [
      task("a", 60, { deadline: local(2026, 10, 26, 17).toISOString() }),
      task("b", 60, { deadline: local(2026, 10, 26, 17).toISOString() }),
    ];
    const first = plan({ tasks, events: [], previousBlocks: [], settings, now });
    expect(blocksOf(first, "a")[0].start).toBe(local(2026, 10, 26, 9).toISOString());

    // 10:00: a's block is over but a is not done. b is running 10:00–11:00.
    const later = local(2026, 10, 26, 10, 30);
    const r = plan({ tasks, events: [], previousBlocks: first.blocks, settings, now: later });
    expect(r.plans.a.overrun).toBe(true);
    expect(r.plans.a.remainingMinutes).toBe(settings.overrunExtensionMinutes);
    // a's extension comes after b's locked block, and no overlap.
    const aFuture = blocksOf(r, "a").filter((b) => ms(b.start) >= later.getTime());
    expect(aFuture[0].start).toBe(local(2026, 10, 26, 11).toISOString());
    expect(findConflicts(r, { tasks, events: [], previousBlocks: first.blocks, settings, now: later })).toEqual([]);
  });

  it("flags an overrunning task as late without pushing on-time work past its deadline", () => {
    const now = local(2026, 10, 26, 9, 0);
    const tasks = [
      task("a", 240, { deadline: local(2026, 10, 26, 13).toISOString() }),
      task("b", 240, { deadline: local(2026, 10, 26, 17).toISOString() }),
    ];
    const first = plan({ tasks, events: [], previousBlocks: [], settings, now });
    // At 12:00 the user reports a needs 1h more than planned (estimate 240 -> 300).
    const updated = tasks.map((t) => (t.id === "a" ? { ...t, estimateMinutes: 300 } : t));
    const r = plan({ tasks: updated, events: [], previousBlocks: first.blocks, settings, now: local(2026, 10, 26, 12) });
    expect(r.plans.a.status).toBe("late");
    expect(r.plans.a.reason).toMatch(/not enough free working time/i);
    expect(r.plans.b.status).toBe("on_track");
    expect(blocksOf(r, "b")[0].start).toBe(local(2026, 10, 26, 13).toISOString());
  });

  it("pushes the following tasks later when a reported overrun takes their slot", () => {
    const now = local(2026, 10, 26, 9, 0);
    const tasks = [
      task("a", 240, { deadline: local(2026, 10, 26, 17).toISOString() }),
      task("b", 240, { deadline: local(2026, 10, 27, 17).toISOString() }),
    ];
    const first = plan({ tasks, events: [], previousBlocks: [], settings, now });
    expect(blocksOf(first, "b")[0].start).toBe(local(2026, 10, 26, 13).toISOString());
    const updated = tasks.map((t) => (t.id === "a" ? { ...t, estimateMinutes: 300 } : t));
    const r = plan({ tasks: updated, events: [], previousBlocks: first.blocks, settings, now: local(2026, 10, 26, 12) });
    expect(blocksOf(r, "a").at(-1)!.end).toBe(local(2026, 10, 26, 14).toISOString());
    expect(blocksOf(r, "b")[0].start).toBe(local(2026, 10, 26, 14).toISOString());
    expect(r.plans.a.status).toBe("on_track");
    expect(r.plans.b.status).toBe("on_track");
    expect(r.diff.updated.length).toBeGreaterThan(0);
  });

  it("adds reported extra time on top of the plan, before or after the estimate is used up", () => {
    const now = local(2026, 10, 26, 9, 0);
    const a = task("a", 60);
    const notStarted = plan({ tasks: [a], events: [], previousBlocks: [], settings, now });
    expect(estimateAfterOverrun(a, notStarted.plans.a, 30)).toBe(90);
    // At 10:30 the 09:00–10:00 block is over and a is not done: the overrun allowance is replaced.
    const overran = plan({ tasks: [a], events: [], previousBlocks: notStarted.blocks, settings, now: local(2026, 10, 26, 10, 30) });
    expect(overran.plans.a.overrun).toBe(true);
    expect(estimateAfterOverrun(a, overran.plans.a, 45)).toBe(105);
  });

  it("keeps the block in progress and the past as history", () => {
    const now = local(2026, 10, 26, 9, 0);
    const tasks = [task("a", 120), task("b", 60)];
    const first = plan({ tasks, events: [], previousBlocks: [], settings, now });
    const later = local(2026, 10, 26, 10, 0);
    const lunchMoved = [meeting("new", local(2026, 10, 26, 11, 0), local(2026, 10, 26, 12, 0))];
    const r = plan({ tasks, events: lunchMoved, previousBlocks: first.blocks, settings, now: later });
    const a = blocksOf(r, "a");
    expect(a[0].start).toBe(local(2026, 10, 26, 9).toISOString());
    expect(a[0].end).toBe(local(2026, 10, 26, 11).toISOString());
    expect(blocksOf(r, "b")[0].start).toBe(local(2026, 10, 26, 12).toISOString());
  });

  it("cuts the running block short when a meeting is moved onto it", () => {
    const now = local(2026, 10, 26, 9, 0);
    const tasks = [task("a", 120)];
    const first = plan({ tasks, events: [], previousBlocks: [], settings, now });
    const r = plan({
      tasks,
      events: [meeting("urgent", local(2026, 10, 26, 10, 0), local(2026, 10, 26, 10, 30))],
      previousBlocks: first.blocks,
      settings,
      now: local(2026, 10, 26, 9, 30),
    });
    const input = {
      tasks,
      events: [meeting("urgent", local(2026, 10, 26, 10, 0), local(2026, 10, 26, 10, 30))],
      previousBlocks: first.blocks,
      settings,
      now: local(2026, 10, 26, 9, 30),
    };
    expect(findConflicts(r, input)).toEqual([]);
    const total = blocksOf(r, "a").reduce((s, b) => s + (ms(b.end) - ms(b.start)) / MINUTE, 0);
    expect(total).toBe(120);
  });

  it("drops future blocks of completed tasks", () => {
    const now = local(2026, 10, 26, 9, 0);
    const tasks = [task("a", 60), task("b", 60)];
    const first = plan({ tasks, events: [], previousBlocks: [], settings, now });
    const done = tasks.map((t) => (t.id === "b" ? { ...t, status: "done" as const } : t));
    const r = plan({ tasks: done, events: [], previousBlocks: first.blocks, settings, now });
    expect(blocksOf(r, "b")).toHaveLength(0);
    expect(r.diff.deleted.map((b) => b.taskId)).toEqual(["b"]);
  });

  it("re-plans 20 tasks after every one of the seeded meetings is moved, each under 5 s", () => {
    let blocks = plan({ ...seed, previousBlocks: [], settings, now: MONDAY_0830 }).blocks;
    let events = seed.events;
    for (const e of seed.events) {
      events = events.map((x) =>
        x.id === e.id
          ? { ...x, start: new Date(ms(x.start) + 60 * MINUTE).toISOString(), end: new Date(ms(x.end) + 60 * MINUTE).toISOString() }
          : x,
      );
      const input: PlanInput = { tasks: seed.tasks, events, previousBlocks: blocks, settings, now: MONDAY_0830 };
      const r = plan(input);
      expect(r.durationMs).toBeLessThan(5000);
      expect(findConflicts(r, input)).toEqual([]);
      blocks = r.blocks;
    }
  });
});
