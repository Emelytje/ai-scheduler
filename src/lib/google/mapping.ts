import { TZDate } from "@date-fns/tz";
import type { CalendarEvent, ScheduledBlock, Task } from "@/lib/scheduler/types";

/** Marker stored on events we create, so they are never treated as meetings. */
export const BLOCK_PROPERTY = "aiSchedulerBlockId";

/** Subset of the Google Calendar v3 Event resource that we read. */
export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  transparency?: "opaque" | "transparent";
  eventType?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

function dateToInstant(date: string, tz: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, tz).getTime()).toISOString();
}

/**
 * Convert a Google event to a calendar event for planning, or null when it should be ignored:
 * cancelled events, our own task blocks, and working-location markers.
 * Free (transparent) events and events the user declined do not block time.
 */
export function mapGoogleEvent(e: GoogleEvent, timezone: string): CalendarEvent | null {
  if (e.status === "cancelled") return null;
  if (e.extendedProperties?.private?.[BLOCK_PROPERTY]) return null;
  if (e.eventType === "workingLocation" || e.eventType === "birthday") return null;
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const start = e.start?.dateTime ?? (e.start?.date ? dateToInstant(e.start.date, timezone) : null);
  const end = e.end?.dateTime ?? (e.end?.date ? dateToInstant(e.end.date, timezone) : null);
  if (!start || !end) return null;
  const declined = e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
  return {
    id: e.id,
    title: e.summary ?? "(busy)",
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    busy: e.transparency !== "transparent" && !declined,
    allDay,
    source: "google",
  };
}

/** Body for creating/updating the calendar event that mirrors a planned block. */
export function blockToGoogleEvent(block: ScheduledBlock, task: Task | undefined, appUrl: string) {
  return {
    summary: task ? task.title : "Planned task",
    description: `Planned automatically by AI Scheduler. It moves when your plan changes.\n${appUrl}`,
    start: { dateTime: block.start },
    end: { dateTime: block.end },
    transparency: "opaque",
    colorId: "9",
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { [BLOCK_PROPERTY]: block.id } },
  };
}
