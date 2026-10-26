export type Priority = "low" | "medium" | "high" | "urgent";

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

export type TaskStatus = "open" | "done";

export interface Task {
  id: string;
  title: string;
  /** Current estimate of total effort. Grows when the user reports an overrun. */
  estimateMinutes: number;
  /** ISO instant. Null = no deadline. */
  deadline: string | null;
  /** ISO instant. The task must not start before this. */
  notBefore: string | null;
  priority: Priority;
  status: TaskStatus;
  /** Whether the task may be split over several blocks. */
  splittable: boolean;
  /** Smallest block worth scheduling when splitting. */
  minChunkMinutes: number;
  createdAt: string;
  /** Free-form origin, e.g. "manual", "seller-campaign:123" (reserved for auto-tasks). */
  source?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  /** Free (transparent) or declined events do not block time. */
  busy: boolean;
  allDay?: boolean;
  source: "google" | "demo";
}

export interface ScheduledBlock {
  id: string;
  taskId: string;
  start: string;
  end: string;
}

export interface TimeRange {
  /** "HH:mm" in the user's timezone. */
  start: string;
  end: string;
}

export interface Settings {
  timezone: string;
  /** Index 0 = Sunday … 6 = Saturday. */
  workingHours: TimeRange[][];
  /** Gap kept free before and after meetings. */
  bufferMinutes: number;
  /** How many days ahead to plan (extended automatically to cover deadlines, max 60). */
  horizonDays: number;
  /** Grid that block starts snap to. */
  slotMinutes: number;
  /** Extra time assumed when a task has used its whole estimate but is not done. */
  overrunExtensionMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: "Europe/Brussels",
  workingHours: [
    [],
    [{ start: "09:00", end: "17:00" }],
    [{ start: "09:00", end: "17:00" }],
    [{ start: "09:00", end: "17:00" }],
    [{ start: "09:00", end: "17:00" }],
    [{ start: "09:00", end: "17:00" }],
    [],
  ],
  bufferMinutes: 0,
  horizonDays: 14,
  slotMinutes: 15,
  overrunExtensionMinutes: 30,
};

export type TaskPlanStatus =
  | "on_track"
  | "late" // fully scheduled but finishes after its deadline
  | "unschedulable" // not enough free time within the planning horizon
  | "done";

export interface TaskPlan {
  taskId: string;
  status: TaskPlanStatus;
  /** Work already behind us (past blocks + elapsed part of the current block). */
  workedMinutes: number;
  /** Minutes still to place (after worked + locked in-progress time). */
  remainingMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  /** End of the last block for this task, if any. */
  finishAt: string | null;
  /** The task has consumed its estimate but is not marked done. */
  overrun: boolean;
  /** Deadline is already in the past and the task is open. */
  deadlinePassed: boolean;
  /** Human readable explanation shown in the UI. */
  reason: string | null;
}

export interface PlanInput {
  tasks: Task[];
  events: CalendarEvent[];
  /** Blocks from the previous plan; past ones are kept as history. */
  previousBlocks: ScheduledBlock[];
  settings: Settings;
  now: Date;
}

export interface PlanDiff {
  created: ScheduledBlock[];
  updated: ScheduledBlock[];
  deleted: ScheduledBlock[];
}

export interface PlanResult {
  /** History + locked + newly planned blocks, sorted by start. */
  blocks: ScheduledBlock[];
  plans: Record<string, TaskPlan>;
  diff: PlanDiff;
  computedAt: string;
  durationMs: number;
}
