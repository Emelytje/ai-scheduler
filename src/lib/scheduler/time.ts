import { TZDate } from "@date-fns/tz";
import type { Settings } from "./types";

export const MINUTE = 60_000;

export interface Interval {
  start: number;
  end: number;
}

export function parseHHMM(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [h, m];
}

/** Working windows (absolute ms) from `fromMs` for `days` days, in the user's timezone. */
export function workingWindows(settings: Settings, fromMs: number, days: number): Interval[] {
  const tz = settings.timezone;
  const today = new TZDate(fromMs, tz);
  const y = today.getFullYear();
  const mo = today.getMonth();
  const d = today.getDate();
  const out: Interval[] = [];
  for (let i = 0; i <= days; i++) {
    const day = new TZDate(y, mo, d + i, 0, 0, 0, tz);
    const ranges = settings.workingHours[day.getDay()] ?? [];
    for (const r of ranges) {
      const [sh, sm] = parseHHMM(r.start);
      const [eh, em] = parseHHMM(r.end);
      const start = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm, 0, tz).getTime();
      const end = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), eh, em, 0, tz).getTime();
      if (end > start && end > fromMs) out.push({ start: Math.max(start, fromMs), end });
    }
  }
  return normalize(out);
}

/** Sort and merge overlapping/adjacent intervals. */
export function normalize(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** free − busy. Both inputs may be unsorted. */
export function subtract(free: Interval[], busy: Interval[]): Interval[] {
  const b = normalize(busy);
  const out: Interval[] = [];
  for (const f of normalize(free)) {
    let cursor = f.start;
    for (const x of b) {
      if (x.end <= cursor) continue;
      if (x.start >= f.end) break;
      if (x.start > cursor) out.push({ start: cursor, end: x.start });
      cursor = Math.max(cursor, x.end);
      if (cursor >= f.end) break;
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function ceilTo(ms: number, stepMinutes: number): number {
  const step = stepMinutes * MINUTE;
  return Math.ceil(ms / step) * step;
}
