import { TZDate } from "@date-fns/tz";
import type { TaskInput } from "@/lib/client/types";
import type { Priority } from "@/lib/scheduler/types";

export type SlackCommand =
  | { kind: "today" }
  | { kind: "week" }
  | { kind: "risks" }
  | { kind: "help" }
  | { kind: "connect" }
  | { kind: "add"; input: TaskInput }
  | { kind: "error"; message: string };

export const ADD_EXAMPLE = "/plan add Send quote to Smits 1h30 by fri 17:00 !high";

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];

/** "90m", "45min", "1h", "1h30", "1.5h" → minutes. */
export function parseDuration(token: string): number | null {
  const t = token.toLowerCase();
  let m = /^(\d+(?:[.,]\d+)?)h(?:(\d{1,2})m?)?$/.exec(t);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 60 + (m[2] ? Number(m[2]) : 0));
  m = /^(\d+)(?:m|min|mins|minutes)$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/** "17:00", "9:30", "5pm", "9am" → [hours, minutes]. */
export function parseTime(token: string | undefined): [number, number] | null {
  if (!token) return null;
  const t = token.toLowerCase();
  let m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (m) return [Number(m[1]), Number(m[2])];
  m = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?(am|pm)$/.exec(t);
  if (m) {
    const h = (Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0);
    return [h, m[2] ? Number(m[2]) : 0];
  }
  return null;
}

/** "today", "tomorrow", "fri", "2026-10-30", "30/10", "30/10/2026" → local calendar date. */
export function parseDate(token: string | undefined, tz: string, now: Date): { y: number; m: number; d: number; weekday: boolean } | null {
  if (!token) return null;
  const t = token.toLowerCase();
  const today = new TZDate(now.getTime(), tz);
  const at = (offset: number, weekday = false) => {
    const d = new TZDate(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12, 0, 0, tz);
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), weekday };
  };
  if (t === "today") return at(0);
  if (t === "tomorrow") return at(1);
  if (t in WEEKDAYS) return at((WEEKDAYS[t] - today.getDay() + 7) % 7, true);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]), weekday: false };
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    // A day/month without a year that already passed means next year.
    if (!m[3] && new TZDate(year, month, day, 23, 59, 0, tz).getTime() < now.getTime()) year += 1;
    return { y: year, m: month, d: day, weekday: false };
  }
  return null;
}

function instant(date: { y: number; m: number; d: number }, time: [number, number], tz: string): Date {
  return new Date(new TZDate(date.y, date.m, date.d, time[0], time[1], 0, tz).getTime());
}

/** Parse the text after "/plan". Times are in the user's planner time zone. */
export function parseCommand(text: string, tz: string, now: Date): SlackCommand {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sub = (words[0] ?? "today").toLowerCase();
  if (sub === "today") return { kind: "today" };
  if (sub === "week") return { kind: "week" };
  if (sub === "risks" || sub === "risk") return { kind: "risks" };
  if (sub === "help") return { kind: "help" };
  if (sub === "connect" || sub === "link") return { kind: "connect" };
  if (sub !== "add") return { kind: "error", message: `Unknown command "${words[0]}". Try \`/plan help\`.` };

  const tokens = words.slice(1);
  const title: string[] = [];
  let estimate: number | null = null;
  let priority: Priority = "medium";
  let deadline: Date | null = null;
  let notBefore: Date | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();
    if (lower.startsWith("!") && PRIORITIES.includes(lower.slice(1) as Priority)) {
      priority = lower.slice(1) as Priority;
      continue;
    }
    if (lower === "by" || lower === "after") {
      const date = parseDate(tokens[i + 1], tz, now);
      if (date) {
        const time = parseTime(tokens[i + 2]);
        let value = instant(date, time ?? (lower === "by" ? [17, 0] : [9, 0]), tz);
        // "by fri" said on Friday evening means next Friday.
        if (date.weekday && value.getTime() <= now.getTime()) value = new Date(instant({ ...date, d: date.d + 7 }, time ?? (lower === "by" ? [17, 0] : [9, 0]), tz));
        if (lower === "by") deadline = value;
        else notBefore = value;
        i += time ? 2 : 1;
        continue;
      }
    }
    if (estimate === null) {
      const d = parseDuration(tok);
      if (d !== null) {
        estimate = d;
        continue;
      }
    }
    title.push(tok);
  }

  const name = title.join(" ").trim();
  if (!name) return { kind: "error", message: `Give the task a name. Example: \`${ADD_EXAMPLE}\`` };
  if (estimate === null) return { kind: "error", message: `How long will it take? Add a duration like \`45m\` or \`1h30\`. Example: \`${ADD_EXAMPLE}\`` };
  if (estimate < 5 || estimate > 10_000) return { kind: "error", message: "Duration must be between 5 minutes and about 160 hours." };
  if (deadline && deadline.getTime() <= now.getTime()) return { kind: "error", message: "That deadline is already in the past." };
  if (deadline && notBefore && notBefore >= deadline) return { kind: "error", message: "The \"after\" date must be before the deadline." };

  return {
    kind: "add",
    input: {
      title: name.slice(0, 300),
      estimateMinutes: estimate,
      deadline: deadline ? deadline.toISOString() : null,
      notBefore: notBefore ? notBefore.toISOString() : null,
      priority,
      splittable: true,
      minChunkMinutes: 30,
    },
  };
}
