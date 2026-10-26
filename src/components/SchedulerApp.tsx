"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SchedulerClient, SchedulerState, TaskInput } from "@/lib/client/types";
import type { Settings } from "@/lib/scheduler/types";
import { fmtDuration, fmtTime } from "@/lib/format";
import { CalendarView, type CalendarMode, type Selection } from "./CalendarView";
import { Inspector } from "./Inspector";
import { SettingsPanel } from "./SettingsPanel";
import { TaskForm } from "./TaskForm";
import { TaskList, needsAttention } from "./TaskList";

export interface SchedulerAppProps {
  client: SchedulerClient;
  variant?: "full" | "embed";
  /** Starts Google OAuth (live mode). */
  connectUrl?: string;
  onDisconnect?: () => Promise<void>;
  /** Re-load interval; each load re-plans against the current time and calendar. */
  refreshMs?: number;
  title?: string;
  /** Extra controls at the end of the top bar (e.g. account links). */
  headerExtra?: React.ReactNode;
}

type Rail = "tasks" | "settings";
type FormState = null | { mode: "new" } | { mode: "edit"; taskId: string };

export function SchedulerApp({ client, variant = "full", connectUrl, onDisconnect, refreshMs = 60_000, title = "AI Scheduler", headerExtra }: SchedulerAppProps) {
  const [state, setState] = useState<SchedulerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<CalendarMode>("week");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rail, setRail] = useState<Rail>("tasks");
  const [form, setForm] = useState<FormState>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const embed = variant === "embed";

  const run = useCallback(
    async (action: () => Promise<SchedulerState>, message?: string) => {
      setBusy(true);
      const t0 = performance.now();
      try {
        const next = await action();
        setState(next);
        setRoundTripMs(performance.now() - t0);
        setNow(Date.now());
        setError(null);
        if (message) setToast(message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 700) setMode("day");
    run(() => client.load());
  }, [client, run]);

  // Keep the plan current: re-plan periodically and when the tab regains focus.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") run(() => client.load());
    }, refreshMs);
    const onFocus = () => run(() => client.load());
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [client, run, refreshMs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Embed: tell the host page our height and plan health; accept view commands.
  useEffect(() => {
    if (!embed || typeof window === "undefined" || window.parent === window) return;
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => window.parent.postMessage({ type: "ai-scheduler:resize", height: el.scrollHeight }, "*"));
    ro.observe(el);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
      if (e.data.type === "ai-scheduler:set-view" && (e.data.view === "day" || e.data.view === "week")) setMode(e.data.view);
    };
    window.addEventListener("message", onMessage);
    return () => {
      ro.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, [embed]);

  useEffect(() => {
    if (!embed || !state || typeof window === "undefined" || window.parent === window) return;
    const atRisk = state.tasks.filter((t) => t.status === "open" && needsAttention(state.plans[t.id])).map((t) => ({ id: t.id, title: t.title, status: state.plans[t.id].status }));
    window.parent.postMessage({ type: "ai-scheduler:plan", atRisk, plannedAt: state.lastPlannedAt }, "*");
  }, [embed, state]);

  if (!state) {
    return (
      <div className={`as-app${embed ? " is-embed" : ""}`} ref={rootRef}>
        {error ? (
          <div className="as-banner is-error" role="alert">
            {error}
            <button className="as-btn is-small" onClick={() => run(() => client.load())}>
              Try again
            </button>
          </div>
        ) : (
          <p className="as-hint">Loading your plan…</p>
        )}
      </div>
    );
  }

  const tz = state.settings.timezone;
  const attention = state.tasks.filter((t) => t.status === "open" && needsAttention(state.plans[t.id]));
  const selectedTaskId = selection && selection.kind !== "event" ? selection.taskId : null;
  const editingTask = form?.mode === "edit" ? state.tasks.find((t) => t.id === form.taskId) : undefined;

  const submitTask = (input: TaskInput) => {
    if (form?.mode === "edit") run(() => client.updateTask(form.taskId, input), "Task updated, plan adjusted");
    else run(() => client.createTask(input), `“${input.title}” planned`);
    setForm(null);
  };

  return (
    <div className={`as-app${embed ? " is-embed" : ""}`} ref={rootRef}>
      <header className="as-topbar">
        {!embed && (
          <div className="as-brand">
            <span className="as-mark" aria-hidden />
            <h1>{title}</h1>
          </div>
        )}
        <span className="as-planstat" aria-live="polite" data-testid="plan-stat" style={embed ? { marginRight: "auto" } : undefined}>
          {state.lastPlannedAt ? `Re-planned ${fmtTime(state.lastPlannedAt, tz)}` : "Not planned yet"}
          {state.lastPlanMs !== null && ` · engine ${state.lastPlanMs.toFixed(state.lastPlanMs < 10 ? 1 : 0)} ms`}
          {roundTripMs !== null && ` · total ${Math.round(roundTripMs)} ms`}
        </span>
        {attention.length > 0 && (
          <button className="as-chip is-late" style={{ cursor: "pointer" }} onClick={() => setRail("tasks")} data-testid="attention-count">
            {attention.length} need{attention.length === 1 ? "s" : ""} attention
          </button>
        )}
        <button className="as-btn" disabled={busy} onClick={() => run(() => client.sync(), "Calendar synced, plan updated")}>
          {busy ? "Planning…" : state.mode === "demo" ? "Re-plan" : "Sync now"}
        </button>
        <div className="as-seg" role="tablist" aria-label="Side panel">
          <button role="tab" aria-selected={rail === "tasks"} aria-pressed={rail === "tasks"} onClick={() => setRail("tasks")}>
            Tasks
          </button>
          <button role="tab" aria-selected={rail === "settings"} aria-pressed={rail === "settings"} onClick={() => setRail("settings")}>
            Settings
          </button>
        </div>
        {headerExtra}
      </header>

      {state.mode === "demo" && !embed && (
        <div className="as-banner">
          <strong>Demo workspace.</strong> Sample meetings and 20 tasks, stored only in this browser. Click a meeting and move it to watch the
          week re-plan; click a task block to report that it is running over.
        </div>
      )}
      {state.calendar.error && <div className="as-banner is-error">{state.calendar.error}</div>}
      {error && (
        <div className="as-banner is-error" role="alert">
          {error}
          <button className="as-btn is-small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="as-main">
        <CalendarView
          mode={mode}
          onModeChange={setMode}
          anchor={anchor}
          onAnchorChange={setAnchor}
          now={now}
          settings={state.settings}
          events={state.events}
          blocks={state.blocks}
          tasks={state.tasks}
          plans={state.plans}
          selection={selection}
          onSelect={setSelection}
        />
        <div className="as-rail">
          {form && (
            <TaskForm
              key={form.mode === "edit" ? form.taskId : "new"}
              timezone={tz}
              initial={editingTask}
              onSubmit={submitTask}
              onCancel={() => setForm(null)}
              onDelete={
                form.mode === "edit"
                  ? () => {
                      run(() => client.deleteTask(form.taskId), "Task deleted");
                      setForm(null);
                      setSelection(null);
                    }
                  : undefined
              }
            />
          )}
          {selection && !form && (
            <Inspector
              selection={selection}
              tasks={state.tasks}
              plans={state.plans}
              blocks={state.blocks}
              events={state.events}
              settings={state.settings}
              now={now}
              canMoveEvents={!!client.moveEvent}
              busy={busy}
              onClose={() => setSelection(null)}
              onEdit={(taskId) => setForm({ mode: "edit", taskId })}
              onDone={(taskId) => {
                run(() => client.setTaskDone(taskId, true), "Marked done, time released");
                setSelection(null);
              }}
              onOverrun={(taskId, extra) => run(() => client.reportOverrun(taskId, extra), `Added ${fmtDuration(extra)}, rest of the week re-planned`)}
              onMoveEvent={(id, delta) => client.moveEvent && run(() => client.moveEvent!(id, delta), "Meeting moved, plan updated")}
            />
          )}
          {rail === "tasks" ? (
            <TaskList
              tasks={state.tasks}
              plans={state.plans}
              blocks={state.blocks}
              settings={state.settings}
              now={now}
              selectedTaskId={selectedTaskId}
              onSelect={(taskId) => {
                setSelection({ kind: "task", taskId });
                const next = state.blocks.find((b) => b.taskId === taskId && +new Date(b.end) > now);
                if (next) setAnchor(+new Date(next.start));
              }}
              onToggleDone={(taskId, done) => run(() => client.setTaskDone(taskId, done), done ? "Marked done, time released" : "Reopened and planned")}
              onAdd={() => setForm({ mode: "new" })}
            />
          ) : (
            <SettingsPanel
              key={JSON.stringify(state.settings)}
              settings={state.settings}
              calendar={state.calendar}
              mode={state.mode}
              busy={busy}
              onSave={(patch: Partial<Settings>) => run(() => client.updateSettings(patch), "Settings saved, plan updated")}
              onReset={client.reset ? () => run(() => client.reset!(), "Sample data restored") : undefined}
              connectUrl={connectUrl}
              onDisconnect={onDisconnect ? () => run(async () => (await onDisconnect(), client.load()), "Google Calendar disconnected") : undefined}
            />
          )}
        </div>
      </div>
      {toast && (
        <div className="as-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
