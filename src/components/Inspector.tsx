"use client";

import type { CalendarEvent, ScheduledBlock, Settings, Task, TaskPlan } from "@/lib/scheduler/types";
import { fmtDateTime, fmtDuration, fmtTime } from "@/lib/format";
import { StatusChip } from "./TaskList";
import type { Selection } from "./CalendarView";

interface Props {
  selection: Selection;
  tasks: Task[];
  plans: Record<string, TaskPlan>;
  blocks: ScheduledBlock[];
  events: CalendarEvent[];
  settings: Settings;
  now: number;
  canMoveEvents: boolean;
  busy: boolean;
  onClose: () => void;
  onEdit: (taskId: string) => void;
  onDone: (taskId: string) => void;
  onOverrun: (taskId: string, extra: number) => void;
  onMoveEvent: (eventId: string, delta: number) => void;
}

export function Inspector(p: Props) {
  const tz = p.settings.timezone;

  if (p.selection.kind === "event") {
    const sel = p.selection;
    const e = p.events.find((x) => x.id === sel.id);
    if (!e) return null;
    return (
      <section className="as-panel as-inspector" aria-label="Meeting details">
        <div className="as-row">
          <span className="as-chip is-muted">{e.busy ? "Meeting" : "Free time"}</span>
          <button className="as-btn is-ghost is-small" style={{ marginLeft: "auto" }} onClick={p.onClose} aria-label="Close details">
            ✕
          </button>
        </div>
        <h3>{e.title}</h3>
        <dl>
          <dt>When</dt>
          <dd>
            {fmtDateTime(e.start, tz)}–{fmtTime(e.end, tz)}
          </dd>
          <dt>Source</dt>
          <dd>{e.source === "google" ? "Google Calendar" : "Sample calendar"}</dd>
        </dl>
        {p.canMoveEvents ? (
          <>
            <p className="as-hint" style={{ margin: 0 }}>
              Move this meeting to see the plan adjust around it.
            </p>
            <div className="as-row">
              {[
                [-60, "−1 h"],
                [-30, "−30 min"],
                [30, "+30 min"],
                [60, "+1 h"],
                [24 * 60, "Next day"],
              ].map(([d, label]) => (
                <button key={d} className="as-btn is-small" disabled={p.busy} onClick={() => p.onMoveEvent(e.id, d as number)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="as-hint" style={{ margin: 0 }}>
            Move or change meetings in Google Calendar; the plan updates on the next sync.
          </p>
        )}
      </section>
    );
  }

  const taskId = p.selection.taskId;
  const task = p.tasks.find((t) => t.id === taskId);
  const plan = p.plans[taskId];
  if (!task) return null;
  const block = p.selection.kind === "block" ? p.blocks.find((b) => b.id === (p.selection as { id: string }).id) : null;
  const taskBlocks = p.blocks.filter((b) => b.taskId === taskId && +new Date(b.end) > p.now);
  const blockStarted = block && +new Date(block.start) <= p.now;

  return (
    <section className="as-panel as-inspector" aria-label="Task details">
      <div className="as-row">
        <StatusChip plan={plan} />
        <button className="as-btn is-ghost is-small" style={{ marginLeft: "auto" }} onClick={p.onClose} aria-label="Close details">
          ✕
        </button>
      </div>
      <h3>{task.title}</h3>
      {plan?.reason && (
        <p style={{ margin: 0, color: plan.status === "on_track" ? "var(--warn)" : "var(--late)" }}>{plan.reason}</p>
      )}
      <dl>
        {block && (
          <>
            <dt>This block</dt>
            <dd>
              {fmtDateTime(block.start, tz)}–{fmtTime(block.end, tz)}
            </dd>
          </>
        )}
        <dt>Estimate</dt>
        <dd>{fmtDuration(task.estimateMinutes)}</dd>
        {plan && (
          <>
            <dt>Worked</dt>
            <dd>{fmtDuration(plan.workedMinutes)}</dd>
          </>
        )}
        <dt>Deadline</dt>
        <dd>{task.deadline ? fmtDateTime(task.deadline, tz) : "None"}</dd>
        {task.notBefore && (
          <>
            <dt>Not before</dt>
            <dd>{fmtDateTime(task.notBefore, tz)}</dd>
          </>
        )}
        {plan?.finishAt && task.status === "open" && (
          <>
            <dt>Finishes</dt>
            <dd>{fmtDateTime(plan.finishAt, tz)}</dd>
          </>
        )}
        <dt>Upcoming</dt>
        <dd>{taskBlocks.length ? `${taskBlocks.length} block${taskBlocks.length > 1 ? "s" : ""}` : "None"}</dd>
      </dl>
      {task.status === "open" && (
        <>
          <div className="as-row">
            <button className="as-btn is-primary" disabled={p.busy} onClick={() => p.onDone(task.id)}>
              Mark done
            </button>
            <button className="as-btn" onClick={() => p.onEdit(task.id)}>
              Edit
            </button>
          </div>
          <div className="as-row">
            <span className="as-hint">{blockStarted || plan?.overrun ? "Running over? Needs" : "Needs more time?"}</span>
            {[15, 30, 60, 120].map((m) => (
              <button key={m} className="as-btn is-small" disabled={p.busy} onClick={() => p.onOverrun(task.id, m)}>
                +{fmtDuration(m)}
              </button>
            ))}
          </div>
          <p className="as-hint" style={{ margin: 0 }}>
            Adds the time from now on and re-plans everything after it.
          </p>
        </>
      )}
    </section>
  );
}
