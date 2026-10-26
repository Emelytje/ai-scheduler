import { TZDate } from "@date-fns/tz";
import type { CalendarEvent, Priority, Task } from "./types";

/**
 * Deterministic demo data: five working days of meetings and 20 tasks. Day 0 is the local
 * date of `anchor` (should be a weekday); later days skip weekends. Used by the demo mode
 * and the acceptance tests.
 */
export function buildSeed(anchor: Date, timezone: string): { events: CalendarEvent[]; tasks: Task[] } {
  const local = new TZDate(anchor.getTime(), timezone);
  const dates: TZDate[] = [];
  for (let i = 0; dates.length < 5; i++) {
    const d = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + i, 0, 0, 0, timezone);
    if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(d);
  }
  const at = (day: number, hhmm: string) => {
    const [h, mi] = hhmm.split(":").map(Number);
    const d = dates[day];
    return new Date(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, 0, timezone).getTime()).toISOString();
  };

  const events: CalendarEvent[] = [];
  const ev = (id: string, title: string, day: number, start: string, end: string) =>
    events.push({ id, title, start: at(day, start), end: at(day, end), busy: true, source: "demo" });

  for (let day = 0; day < 5; day++) {
    ev(`standup-${day}`, "Team stand-up", day, "09:30", "09:45");
    ev(`lunch-${day}`, "Lunch", day, "12:00", "12:45");
  }
  ev("m-planning", "Sprint planning", 0, "10:00", "11:30");
  ev("m-client-a", "Client call — renovation Smits", 0, "14:00", "15:00");
  ev("m-site", "Site visit", 1, "13:00", "15:30");
  ev("m-pipeline", "Pipeline review", 1, "16:00", "16:45");
  ev("m-1on1", "1:1 with manager", 2, "11:00", "11:30");
  ev("m-demo", "Product demo for prospect", 2, "15:00", "16:00");
  ev("m-supplier", "Supplier negotiation", 3, "10:00", "11:00");
  ev("m-all-hands", "All hands", 3, "16:00", "17:00");
  ev("m-retro", "Retro", 4, "14:00", "15:00");
  events.push({
    id: "m-optional",
    title: "Optional webinar (marked free)",
    start: at(2, "13:00"),
    end: at(2, "14:00"),
    busy: false,
    source: "demo",
  });

  const createdAt = at(0, "08:00");
  const task = (
    id: string,
    title: string,
    estimateMinutes: number,
    priority: Priority,
    deadline: string | null,
    extra: Partial<Task> = {},
  ): Task => ({
    id,
    title,
    estimateMinutes,
    priority,
    deadline,
    notBefore: null,
    status: "open",
    splittable: true,
    minChunkMinutes: 30,
    createdAt,
    source: "seed",
    ...extra,
  });

  const tasks: Task[] = [
    task("t01", "Send quote to Smits renovation", 60, "urgent", at(0, "17:00")),
    task("t02", "Follow up 10 warm leads", 90, "high", at(1, "12:00")),
    task("t03", "Order materials for kitchen job", 45, "high", at(1, "17:00")),
    task("t04", "Prepare prospect demo deck", 120, "high", at(2, "15:00")),
    task("t05", "Update CRM after site visit", 30, "medium", at(1, "17:00"), { notBefore: at(1, "15:30") }),
    task("t06", "Draft outreach sequence for Q4 campaign", 150, "medium", at(3, "17:00")),
    task("t07", "Review subcontractor invoices", 60, "medium", at(2, "17:00")),
    task("t08", "Write supplier negotiation brief", 60, "high", at(3, "10:00")),
    task("t09", "Call back inbound leads", 30, "urgent", at(0, "12:00")),
    task("t10", "Safety checklist for site", 30, "high", at(1, "13:00"), { splittable: false }),
    task("t11", "Plan next week's crew schedule", 90, "medium", at(4, "12:00")),
    task("t12", "LinkedIn outreach batch", 60, "low", at(4, "17:00")),
    task("t13", "Prepare all-hands update", 45, "medium", at(3, "16:00"), { notBefore: at(3, "08:00") }),
    task("t14", "Budget reconciliation", 120, "medium", at(4, "17:00"), { splittable: false }),
    task("t15", "Clean up pipeline stages", 60, "low", null),
    task("t16", "Research new tile supplier", 90, "low", null),
    task("t17", "Retro notes and actions", 30, "medium", at(4, "17:00"), { notBefore: at(4, "15:00") }),
    task("t18", "Proposal for Janssens extension", 180, "high", at(2, "12:00")),
    task("t19", "Weekly report to management", 45, "medium", at(4, "16:00")),
    // Intentionally impossible: a full day of work due at 11:00 on day 0.
    task("t20", "Full permit dossier (rush)", 480, "urgent", at(0, "11:00")),
  ];

  return { events, tasks };
}
