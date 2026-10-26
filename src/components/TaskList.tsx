"use client";

import { compareTasks } from "@/lib/scheduler/engine";
import type { ScheduledBlock, Settings, Task, TaskPlan } from "@/lib/scheduler/types";
import { fmtDateTime, fmtDuration } from "@/lib/format";

interface Props {
  tasks: Task[];
  plans: Record<string, TaskPlan>;
  blocks: ScheduledBlock[];
  settings: Settings;
  now: number;
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onToggleDone: (taskId: string, done: boolean) => void;
  onAdd: () => void;
}

export function needsAttention(plan: TaskPlan | undefined): boolean {
  return !!plan && (plan.status === "late" || plan.status === "unschedulable" || plan.overrun);
}

export function StatusChip({ plan }: { plan: TaskPlan | undefined }) {
  if (!plan) return null;
  if (plan.status === "done") return <span className="as-chip is-muted">Done</span>;
  if (plan.status === "unschedulable") return <span className="as-chip is-late">Doesn't fit</span>;
  if (plan.status === "late") return <span className="as-chip is-late">{plan.deadlinePassed ? "Overdue" : "Will miss deadline"}</span>;
  if (plan.overrun) return <span className="as-chip is-warn">Ran over</span>;
  return <span className="as-chip is-ok">On track</span>;
}

export function TaskList(props: Props) {
  const { tasks, plans, blocks, settings, now } = props;
  const tz = settings.timezone;
  const nextBlock = (taskId: string) =>
    blocks.filter((b) => b.taskId === taskId && +new Date(b.end) > now).sort((a, b) => +new Date(a.start) - +new Date(b.start))[0];

  const open = tasks.filter((t) => t.status === "open");
  const attention = open.filter((t) => needsAttention(plans[t.id])).sort(compareTasks);
  const planned = open
    .filter((t) => !needsAttention(plans[t.id]))
    .sort((a, b) => {
      const na = nextBlock(a.id);
      const nb = nextBlock(b.id);
      return (na ? +new Date(na.start) : Infinity) - (nb ? +new Date(nb.start) : Infinity) || compareTasks(a, b);
    });
  const done = tasks.filter((t) => t.status === "done");

  const row = (t: Task) => {
    const plan = plans[t.id];
    const next = nextBlock(t.id);
    const warn = plan?.overrun && plan.status === "on_track";
    return (
      <li
        key={t.id}
        className={`as-task${props.selectedTaskId === t.id ? " is-selected" : ""}${t.status === "done" ? " is-done" : ""}`}
        onClick={() => props.onSelect(t.id)}
        data-testid={`task-${t.id}`}
      >
        <input
          type="checkbox"
          className="as-done-box"
          checked={t.status === "done"}
          aria-label={`Mark "${t.title}" as done`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => props.onToggleDone(t.id, e.target.checked)}
        />
        <div style={{ minWidth: 0 }}>
          <div className="as-task-title">{t.title}</div>
          <div className="as-task-meta">
            {fmtDuration(t.estimateMinutes)}
            {t.deadline && <> · due {fmtDateTime(t.deadline, tz)}</>}
            {" · "}
            <span className={`as-prio is-${t.priority}`}>{t.priority}</span>
          </div>
          {t.status === "open" && (
            <div className="as-task-meta">
              {next ? <>Next: {fmtDateTime(next.start, tz)}</> : plan?.scheduledMinutes ? null : <>Not planned</>}
              {t.notBefore && +new Date(t.notBefore) > now && <> · not before {fmtDateTime(t.notBefore, tz)}</>}
            </div>
          )}
        </div>
        <StatusChip plan={plan} />
        {t.status === "open" && plan?.reason && <div className={`as-task-reason${warn ? " is-warn" : ""}`}>{plan.reason}</div>}
        {t.status === "open" && plan?.overrun && !plan.reason && (
          <div className="as-task-reason is-warn">Used its estimate; {fmtDuration(plan.remainingMinutes)} extra planned</div>
        )}
      </li>
    );
  };

  return (
    <section className="as-panel" aria-label="Tasks">
      <div className="as-section-head">
        <h2>Tasks</h2>
        <span className="as-hint">{open.length} open</span>
        <button className="as-btn is-primary" onClick={props.onAdd}>
          + Add task
        </button>
      </div>
      <ul className="as-tasks">
        {attention.length > 0 && (
          <>
            <li className="as-group-label" style={{ color: "var(--late)" }}>
              <span>Needs attention</span>
              <span>{attention.length}</span>
            </li>
            {attention.map(row)}
          </>
        )}
        <li className="as-group-label">
          <span>Planned</span>
          <span>{planned.length}</span>
        </li>
        {planned.length ? planned.map(row) : <li className="as-empty">No open tasks. Add one and it lands on your calendar.</li>}
        {done.length > 0 && (
          <>
            <li className="as-group-label">
              <span>Done</span>
              <span>{done.length}</span>
            </li>
            {done.map(row)}
          </>
        )}
      </ul>
    </section>
  );
}
