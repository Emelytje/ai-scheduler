"use client";

import { useMemo } from "react";
import type { CalendarEvent, ScheduledBlock, Settings, Task, TaskPlan } from "@/lib/scheduler/types";
import { parseHHMM } from "@/lib/scheduler/time";
import {
  addLocalDays,
  fmtDay,
  fmtDayNum,
  fmtMonth,
  fmtTime,
  fmtWeekday,
  localMinutes,
  localWeekday,
  startOfLocalDay,
  startOfLocalWeek,
} from "@/lib/format";

export type CalendarMode = "day" | "week";
export type Selection = { kind: "block"; id: string; taskId: string } | { kind: "event"; id: string } | { kind: "task"; taskId: string };

interface Props {
  mode: CalendarMode;
  onModeChange: (m: CalendarMode) => void;
  anchor: number;
  onAnchorChange: (t: number) => void;
  now: number;
  settings: Settings;
  events: CalendarEvent[];
  blocks: ScheduledBlock[];
  tasks: Task[];
  plans: Record<string, TaskPlan>;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
}

interface Placed {
  key: string;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  kind: "meeting" | "block";
  title: string;
  className: string;
  selection: Selection;
  label: string;
}

const HOUR_PX = 56;

export function CalendarView(props: Props) {
  const { mode, anchor, now, settings, events, blocks, tasks, plans, selection } = props;
  const tz = settings.timezone;
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const days = useMemo(() => {
    if (mode === "day") return [startOfLocalDay(anchor, tz)];
    const monday = startOfLocalWeek(anchor, tz);
    const all = Array.from({ length: 7 }, (_, i) => startOfLocalDay(addLocalDays(monday, i, tz), tz));
    // Hide weekend columns unless they hold working hours or events.
    return all.filter((d) => {
      const wd = localWeekday(d, tz);
      if (wd !== 0 && wd !== 6) return true;
      if ((settings.workingHours[wd] ?? []).length) return true;
      const end = addLocalDays(d, 1, tz);
      return events.some((e) => +new Date(e.start) < end && +new Date(e.end) > d);
    });
  }, [mode, anchor, tz, settings.workingHours, events]);

  // Visible hour range: working hours ±1 h, widened to include any timed event shown.
  const [fromHour, toHour] = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    for (const day of settings.workingHours)
      for (const r of day) {
        const [sh, sm] = parseHHMM(r.start);
        const [eh, em] = parseHHMM(r.end);
        lo = Math.min(lo, sh * 60 + sm);
        hi = Math.max(hi, eh * 60 + em);
      }
    if (lo >= hi) [lo, hi] = [8 * 60, 18 * 60];
    const first = days[0];
    const last = addLocalDays(days[days.length - 1], 1, tz);
    for (const e of events) {
      const s = +new Date(e.start);
      const en = +new Date(e.end);
      if (e.allDay || en <= first || s >= last) continue;
      lo = Math.min(lo, localMinutes(s, tz));
      hi = Math.max(hi, localMinutes(en - 1, tz) + 1);
    }
    return [Math.max(0, Math.floor(lo / 60) - 1), Math.min(24, Math.ceil(hi / 60) + 1)];
  }, [settings.workingHours, events, days, tz]);

  const pxPerMin = HOUR_PX / 60;
  const height = (toHour - fromHour) * HOUR_PX;

  const columns = useMemo(
    () =>
      days.map((day) => {
        const dayEnd = addLocalDays(day, 1, tz);
        const items: Omit<Placed, "lane" | "lanes">[] = [];
        for (const e of events) {
          const s = +new Date(e.start);
          const en = +new Date(e.end);
          if (e.allDay || en <= day || s >= dayEnd) continue;
          items.push({
            key: `e-${e.id}`,
            start: Math.max(s, day),
            end: Math.min(en, dayEnd),
            kind: "meeting",
            title: e.title,
            className: `as-item is-meeting${e.busy ? "" : " is-free"}`,
            selection: { kind: "event", id: e.id },
            label: `${e.title}, ${fmtTime(s, tz)} to ${fmtTime(en, tz)}${e.busy ? "" : " (free)"}`,
          });
        }
        for (const b of blocks) {
          const s = +new Date(b.start);
          const en = +new Date(b.end);
          if (en <= day || s >= dayEnd) continue;
          const task = taskById.get(b.taskId);
          const plan = plans[b.taskId];
          if (!task) continue;
          const state =
            plan?.status === "late" || plan?.status === "unschedulable" ? " is-late" : plan?.overrun ? " is-overrun" : "";
          items.push({
            key: `b-${b.id}`,
            start: Math.max(s, day),
            end: Math.min(en, dayEnd),
            kind: "block",
            title: task.title,
            className: `as-item is-block${state}${en <= now ? " is-past" : ""}`,
            selection: { kind: "block", id: b.id, taskId: b.taskId },
            label: `${task.title}, planned ${fmtTime(s, tz)} to ${fmtTime(en, tz)}`,
          });
        }
        return { day, items: layoutLanes(items) };
      }),
    [days, events, blocks, taskById, plans, now, tz],
  );

  const offRanges = (day: number) => {
    const ranges = (settings.workingHours[localWeekday(day, tz)] ?? [])
      .map((r) => {
        const [sh, sm] = parseHHMM(r.start);
        const [eh, em] = parseHHMM(r.end);
        return [sh * 60 + sm, eh * 60 + em] as const;
      })
      .sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let cursor = fromHour * 60;
    for (const [s, e] of ranges) {
      if (s > cursor) out.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < toHour * 60) out.push([cursor, toHour * 60]);
    return out;
  };

  const step = mode === "day" ? 1 : 7;
  const title = mode === "day" ? fmtDay(anchor, tz) : fmtMonth(days[0], tz);
  const selectedTaskId = selection && selection.kind !== "event" ? selection.taskId : null;

  return (
    <section className="as-panel as-cal" aria-label="Calendar">
      <div className="as-cal-toolbar">
        <button className="as-btn" onClick={() => props.onAnchorChange(now)}>
          Today
        </button>
        <div className="as-row">
          <button className="as-btn is-ghost" aria-label={`Previous ${mode}`} onClick={() => props.onAnchorChange(addLocalDays(anchor, -step, tz))}>
            ‹
          </button>
          <button className="as-btn is-ghost" aria-label={`Next ${mode}`} onClick={() => props.onAnchorChange(addLocalDays(anchor, step, tz))}>
            ›
          </button>
        </div>
        <h2>{title}</h2>
        <div className="as-seg" role="group" aria-label="Calendar view">
          <button aria-pressed={mode === "day"} onClick={() => props.onModeChange("day")}>
            Day
          </button>
          <button aria-pressed={mode === "week"} onClick={() => props.onModeChange("week")}>
            Week
          </button>
        </div>
      </div>
      <div className="as-cal-scroll">
        <div
          className="as-cal-grid"
          style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(${mode === "day" ? 0 : 92}px, 1fr))` }}
        >
          <div className="as-cal-head" />
          {days.map((d) => {
            const wd = localWeekday(d, tz);
            const off = !(settings.workingHours[wd] ?? []).length;
            return (
              <div key={d} className={`as-cal-head${startOfLocalDay(now, tz) === d ? " is-today" : ""}${off ? " is-offday" : ""}`}>
                {fmtWeekday(d, tz)}
                <b>{fmtDayNum(d, tz)}</b>
              </div>
            );
          })}
          <div className="as-cal-hours" style={{ height }}>
            {Array.from({ length: toHour - fromHour - 1 }, (_, i) => (
              <span key={i} style={{ top: (i + 1) * HOUR_PX }}>
                {String(fromHour + i + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {columns.map(({ day, items }) => (
            <div
              key={day}
              className="as-cal-day"
              style={{ height, ["--hour-h" as string]: `${HOUR_PX}px`, backgroundPositionY: 0 }}
              onClick={(e) => e.target === e.currentTarget && props.onSelect(null)}
            >
              {offRanges(day).map(([s, e]) => (
                <div key={s} className="as-cal-off" style={{ top: (s - fromHour * 60) * pxPerMin, height: (e - s) * pxPerMin }} />
              ))}
              {items.map((it) => {
                const top = (localMinutes(it.start, tz) - fromHour * 60) * pxPerMin;
                const h = Math.max(13, ((it.end - it.start) / 60_000) * pxPerMin - 2);
                const width = 100 / it.lanes;
                const isSelected =
                  (selection?.kind === "block" && it.selection.kind === "block" && selection.id === it.selection.id) ||
                  (selection?.kind === "event" && it.selection.kind === "event" && selection.id === it.selection.id);
                const dimmed = selectedTaskId && it.kind === "block" && (it.selection as { taskId: string }).taskId !== selectedTaskId;
                const highlight = selectedTaskId && it.kind === "block" && (it.selection as { taskId: string }).taskId === selectedTaskId;
                return (
                  <button
                    key={it.key}
                    type="button"
                    data-kind={it.kind}
                    data-testid={it.key}
                    aria-label={it.label}
                    className={`${it.className}${h < 24 ? " is-short" : ""}${isSelected || highlight ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}`}
                    style={{
                      top,
                      height: h,
                      left: `calc(${it.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    }}
                    onClick={() => props.onSelect(it.selection)}
                  >
                    {h >= 30 && (
                      <span className="as-item-time">
                        {fmtTime(it.start, tz)}–{fmtTime(it.end, tz)}
                      </span>
                    )}
                    <span className="as-item-title">{it.title}</span>
                  </button>
                );
              })}
              {now >= day && now < addLocalDays(day, 1, tz) && (
                <div className="as-now" style={{ top: (localMinutes(now, tz) - fromHour * 60) * pxPerMin }} aria-hidden />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Assign overlapping items to side-by-side lanes. */
function layoutLanes(items: Omit<Placed, "lane" | "lanes">[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.end);
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}
