import type { Settings } from "@/lib/scheduler/types";
import type { SchedulerClient, SchedulerState, TaskInput } from "./types";

/** Talks to the Next.js API. In the embed, a short-lived bearer token replaces cookies. */
export class ApiClient implements SchedulerClient {
  constructor(
    private readonly baseUrl = "",
    private readonly token: string | null = null,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<SchedulerState> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/api${path}`, { ...init, headers, credentials: "same-origin" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  }

  load() {
    return this.call("/state");
  }
  createTask(input: TaskInput) {
    return this.call("/tasks", { method: "POST", body: JSON.stringify(input) });
  }
  updateTask(id: string, patch: Partial<TaskInput>) {
    return this.call(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  deleteTask(id: string) {
    return this.call(`/tasks/${id}`, { method: "DELETE" });
  }
  setTaskDone(id: string, done: boolean) {
    return this.call(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: done ? "done" : "open" }) });
  }
  reportOverrun(id: string, extraMinutes: number) {
    return this.call(`/tasks/${id}/overrun`, { method: "POST", body: JSON.stringify({ extraMinutes }) });
  }
  updateSettings(patch: Partial<Settings>) {
    return this.call("/settings", { method: "PATCH", body: JSON.stringify(patch) });
  }
  sync() {
    return this.call("/sync", { method: "POST" });
  }
}
