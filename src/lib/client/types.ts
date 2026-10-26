import type { CalendarEvent, Priority, ScheduledBlock, Settings, Task, TaskPlan } from "@/lib/scheduler/types";

export interface CalendarConnection {
  provider: "google" | "demo" | null;
  connected: boolean;
  email: string | null;
  lastSyncAt: string | null;
  /** Problem with the connection the user needs to act on, e.g. a revoked token. */
  error: string | null;
}

export interface SchedulerState {
  mode: "demo" | "live";
  tasks: Task[];
  events: CalendarEvent[];
  blocks: ScheduledBlock[];
  plans: Record<string, TaskPlan>;
  settings: Settings;
  calendar: CalendarConnection;
  lastPlannedAt: string | null;
  /** Time the last re-plan took end to end on the server or in the browser. */
  lastPlanMs: number | null;
}

export interface TaskInput {
  title: string;
  estimateMinutes: number;
  deadline: string | null;
  notBefore: string | null;
  priority: Priority;
  splittable: boolean;
  minChunkMinutes: number;
}

export interface SchedulerClient {
  load(): Promise<SchedulerState>;
  createTask(input: TaskInput): Promise<SchedulerState>;
  updateTask(id: string, patch: Partial<TaskInput>): Promise<SchedulerState>;
  deleteTask(id: string): Promise<SchedulerState>;
  setTaskDone(id: string, done: boolean): Promise<SchedulerState>;
  /** The task needs `extraMinutes` more from now on. */
  reportOverrun(id: string, extraMinutes: number): Promise<SchedulerState>;
  updateSettings(patch: Partial<Settings>): Promise<SchedulerState>;
  /** Pull calendar changes and re-plan. */
  sync(): Promise<SchedulerState>;
  /** Demo only: simulate a meeting being moved in the calendar. */
  moveEvent?(id: string, deltaMinutes: number): Promise<SchedulerState>;
  /** Demo only: start over with the seeded data. */
  reset?(): Promise<SchedulerState>;
}
