"use client";

import { useState } from "react";
import type { TaskInput } from "@/lib/client/types";
import type { Priority, Task } from "@/lib/scheduler/types";
import { fromLocalInput, toLocalInput } from "@/lib/format";

interface Props {
  timezone: string;
  initial?: Task;
  onSubmit: (input: TaskInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function TaskForm({ timezone, initial, onSubmit, onCancel, onDelete }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hours, setHours] = useState(String(Math.floor((initial?.estimateMinutes ?? 60) / 60)));
  const [minutes, setMinutes] = useState(String((initial?.estimateMinutes ?? 60) % 60));
  const [deadline, setDeadline] = useState(toLocalInput(initial?.deadline ?? null, timezone));
  const [notBefore, setNotBefore] = useState(toLocalInput(initial?.notBefore ?? null, timezone));
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "medium");
  const [splittable, setSplittable] = useState(initial?.splittable ?? true);
  const [minChunk, setMinChunk] = useState(String(initial?.minChunkMinutes ?? 30));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const estimate = Number(hours || 0) * 60 + Number(minutes || 0);
    if (!title.trim()) return setError("Give the task a name.");
    if (!Number.isFinite(estimate) || estimate < 5) return setError("Duration must be at least 5 minutes.");
    const dl = deadline ? fromLocalInput(deadline, timezone) : null;
    const nb = notBefore ? fromLocalInput(notBefore, timezone) : null;
    if (dl && nb && new Date(nb) >= new Date(dl)) return setError("“Not before” must be earlier than the deadline.");
    onSubmit({
      title: title.trim(),
      estimateMinutes: estimate,
      deadline: dl,
      notBefore: nb,
      priority,
      splittable,
      minChunkMinutes: Math.max(5, Number(minChunk) || 30),
    });
  };

  return (
    <form className="as-panel as-form" onSubmit={submit} aria-label={initial ? "Edit task" : "New task"}>
      <label className="as-field is-wide">
        <span>Task</span>
        <input id="task-title" className="as-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send quote to client" autoFocus />
      </label>
      <label className="as-field">
        <span>Hours</span>
        <input id="task-hours" className="as-input" type="number" min={0} max={40} value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <label className="as-field">
        <span>Minutes</span>
        <input id="task-minutes" className="as-input" type="number" min={0} max={59} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <label className="as-field">
        <span>Deadline</span>
        <input id="task-deadline" className="as-input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <label className="as-field">
        <span>Not before</span>
        <input id="task-not-before" className="as-input" type="datetime-local" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} />
      </label>
      <label className="as-field">
        <span>Priority</span>
        <select id="task-priority" className="as-input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label className="as-field">
        <span>Shortest block (min)</span>
        <input id="task-min-chunk" className="as-input" type="number" min={5} step={5} value={minChunk} disabled={!splittable} onChange={(e) => setMinChunk(e.target.value)} />
      </label>
      <label className="as-check is-wide">
        <input id="task-splittable" type="checkbox" checked={splittable} onChange={(e) => setSplittable(e.target.checked)} />
        Can be split over several blocks
      </label>
      {error && (
        <p className="is-wide" role="alert" style={{ color: "var(--late)", margin: 0 }}>
          {error}
        </p>
      )}
      <div className="as-form-actions">
        {onDelete &&
          (confirmDelete ? (
            <>
              <span className="as-hint" style={{ marginRight: "auto" }}>Delete this task?</span>
              <button type="button" className="as-btn is-danger" onClick={onDelete}>
                Delete
              </button>
              <button type="button" className="as-btn" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="as-btn is-ghost" style={{ marginRight: "auto", color: "var(--late)" }} onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          ))}
        <button type="button" className="as-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="as-btn is-primary">
          {initial ? "Save and re-plan" : "Add and plan"}
        </button>
      </div>
    </form>
  );
}
