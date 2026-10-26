import type { SchedulerState } from "@/lib/client/types";
import type { Task, TaskPlan } from "@/lib/scheduler/types";
import { addLocalDays, fmtDateTime, fmtDay, fmtDuration, fmtTime, startOfLocalDay } from "@/lib/format";
import { ADD_EXAMPLE } from "./commands";

/* Minimal Block Kit types for what we send. */
type Text = { type: "mrkdwn" | "plain_text"; text: string; emoji?: boolean };
type Button = { type: "button"; text: Text; action_id: string; value?: string; url?: string; style?: "primary" | "danger" };
export type Block =
  | { type: "section"; text: Text; accessory?: Button }
  | { type: "context"; elements: Text[] }
  | { type: "actions"; elements: Button[] }
  | { type: "divider" }
  | { type: "header"; text: Text };
export interface SlackMessage {
  text: string;
  blocks: Block[];
}

export const ACTION_DONE = "task_done";
export const ACTION_MORE_30 = "task_more_30";
export const ACTION_OPEN = "open_planner";

const md = (text: string): Text => ({ type: "mrkdwn", text });
const plain = (text: string): Text => ({ type: "plain_text", text, emoji: true });
/** Escape user text for mrkdwn (Slack only needs &, < and >). */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MAX_ROWS = 20;

export const isAtRisk = (p: TaskPlan | undefined) => !!p && (p.status === "late" || p.status === "unschedulable");

function riskLine(t: Task, p: TaskPlan, tz: string): string {
  const due = t.deadline ? `due ${fmtDateTime(t.deadline, tz)}` : "no deadline";
  const finish = p.status === "unschedulable" ? "doesn't fit in your working hours" : p.finishAt ? `earliest finish ${fmtDateTime(p.finishAt, tz)}` : "";
  return `:warning: *${esc(t.title)}* · ${due} · ${finish}`;
}

function openButton(appUrl: string): Button {
  return { type: "button", text: plain("Open planner"), action_id: ACTION_OPEN, url: appUrl };
}

/** "/plan today" and "/plan week". */
export function planMessage(state: SchedulerState, now: Date, range: "today" | "week", appUrl: string): SlackMessage {
  const tz = state.settings.timezone;
  const taskById = new Map(state.tasks.map((t) => [t.id, t]));
  const risks = state.tasks.filter((t) => t.status === "open" && isAtRisk(state.plans[t.id]));
  const blocks: Block[] = [];

  const dayStart = startOfLocalDay(now.getTime(), tz);
  const days = range === "today" ? 1 : 7;
  const end = addLocalDays(dayStart, days, tz);
  const upcoming = state.blocks
    .filter((b) => +new Date(b.end) > now.getTime() && +new Date(b.start) < end && taskById.get(b.taskId)?.status === "open")
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));

  blocks.push({ type: "header", text: plain(range === "today" ? `Your plan for ${fmtDay(now.getTime(), tz)}` : "Your next 7 days") });
  if (risks.length) {
    blocks.push({ type: "section", text: md(`*${risks.length} task${risks.length > 1 ? "s" : ""} will miss the deadline*`) });
    for (const t of risks.slice(0, 5)) blocks.push({ type: "section", text: md(riskLine(t, state.plans[t.id], tz)) });
    blocks.push({ type: "divider" });
  }
  if (!upcoming.length) {
    blocks.push({ type: "section", text: md(range === "today" ? "Nothing planned for the rest of today." : "Nothing planned in the next 7 days.") });
  }
  let lastDay = "";
  for (const b of upcoming.slice(0, MAX_ROWS)) {
    const t = taskById.get(b.taskId)!;
    const day = fmtDay(b.start, tz);
    if (range === "week" && day !== lastDay) {
      blocks.push({ type: "context", elements: [md(`*${day}*`)] });
      lastDay = day;
    }
    const running = +new Date(b.start) <= now.getTime();
    const line = md(`\`${fmtTime(b.start, tz)}–${fmtTime(b.end, tz)}\`  ${esc(t.title)}${running ? "  _(now)_" : ""}${isAtRisk(state.plans[t.id]) ? "  :warning:" : ""}`);
    const done: Button = { type: "button", text: plain("Done"), action_id: ACTION_DONE, value: t.id };
    if (running) {
      // The block in progress also offers "needs more time".
      blocks.push({ type: "section", text: line });
      blocks.push({ type: "actions", elements: [done, { type: "button", text: plain("+30 min"), action_id: ACTION_MORE_30, value: t.id }] });
    } else blocks.push({ type: "section", text: line, accessory: done });
  }
  if (upcoming.length > MAX_ROWS) blocks.push({ type: "context", elements: [md(`…and ${upcoming.length - MAX_ROWS} more blocks.`)] });
  blocks.push({ type: "actions", elements: [openButton(appUrl)] });

  const text = `${upcoming.length} planned block${upcoming.length === 1 ? "" : "s"}${risks.length ? `, ${risks.length} at risk` : ""}`;
  return { text, blocks };
}

/** "/plan risks". */
export function risksMessage(state: SchedulerState, appUrl: string): SlackMessage {
  const tz = state.settings.timezone;
  const risks = state.tasks.filter((t) => t.status === "open" && isAtRisk(state.plans[t.id]));
  if (!risks.length) return { text: "Everything is on track.", blocks: [{ type: "section", text: md(":white_check_mark: Everything is on track. No task will miss its deadline.") }] };
  return alertMessage(risks.map((t) => ({ task: t, plan: state.plans[t.id] })), tz, appUrl);
}

/** DM sent when tasks start to miss their deadline. */
export function alertMessage(items: { task: Task; plan: TaskPlan }[], tz: string, appUrl: string): SlackMessage {
  const blocks: Block[] = [
    { type: "section", text: md(`*${items.length} task${items.length > 1 ? "s" : ""} will miss the deadline.* The rest of your week is re-planned around ${items.length > 1 ? "them" : "it"}.`) },
  ];
  for (const { task, plan } of items.slice(0, 10)) {
    blocks.push({ type: "section", text: md(`${riskLine(task, plan, tz)}${plan.reason ? `\n_${esc(plan.reason)}_` : ""}`) });
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: plain("Done"), action_id: ACTION_DONE, value: task.id }],
    });
  }
  blocks.push({ type: "context", elements: [md("Move a deadline, drop a task or free up time in the planner, and this updates automatically.")] });
  blocks.push({ type: "actions", elements: [openButton(appUrl)] });
  const text = `${items.length} task${items.length > 1 ? "s" : ""} will miss the deadline: ${items.map((i) => i.task.title).join(", ")}`;
  return { text, blocks };
}

export function addedMessage(task: Task, plan: TaskPlan | undefined, tz: string): SlackMessage {
  const when = plan?.status === "unschedulable"
    ? "It doesn't fit in your working hours yet."
    : plan?.finishAt
      ? `Planned, finishing ${fmtDateTime(plan.finishAt, tz)}.`
      : "Planned.";
  const risk = isAtRisk(plan) ? `\n:warning: ${esc(plan!.reason ?? "This one will miss its deadline.")}` : "";
  const due = task.deadline ? ` · due ${fmtDateTime(task.deadline, tz)}` : "";
  return {
    text: `Added "${task.title}". ${when}`,
    blocks: [{ type: "section", text: md(`:white_check_mark: Added *${esc(task.title)}* (${fmtDuration(task.estimateMinutes)}${due}, ${task.priority}). ${when}${risk}`) }],
  };
}

export function helpMessage(): SlackMessage {
  const lines = [
    "*AI Scheduler in Slack*",
    "`/plan` or `/plan today`: what's planned for the rest of today",
    "`/plan week`: the next 7 days",
    "`/plan risks`: tasks that will miss their deadline",
    `\`/plan add <task> <duration> [by <day> [time]] [after <day> [time]] [!urgent|!high|!low]\`\n   e.g. \`${ADD_EXAMPLE}\``,
    "   days: `today`, `tomorrow`, `mon`–`sun`, `30/10`, `2026-10-30`; times: `17:00`, `5pm`",
    "`/plan connect`: link this Slack account to your planner",
  ];
  return { text: "AI Scheduler commands", blocks: [{ type: "section", text: md(lines.join("\n")) }] };
}

export function connectMessage(linkUrl: string): SlackMessage {
  return {
    text: "Link your Slack account to the planner",
    blocks: [
      { type: "section", text: md("Link this Slack account to your planner to see and add tasks from here. The link works for 15 minutes.") },
      { type: "actions", elements: [{ type: "button", text: plain("Link my account"), action_id: "link_account", url: linkUrl, style: "primary" }] },
    ],
  };
}

/**
 * Which deadline alerts to send: open tasks that are at risk now and were not already
 * alerted with the same status. Tasks back on track (or done/deleted) are cleared so a
 * later relapse alerts again.
 */
export function diffAlerts(state: Pick<SchedulerState, "tasks" | "plans">, alerted: Map<string, string>) {
  const send: { task: Task; plan: TaskPlan }[] = [];
  const atRiskIds = new Set<string>();
  for (const t of state.tasks) {
    const p = state.plans[t.id];
    if (t.status !== "open" || !isAtRisk(p)) continue;
    atRiskIds.add(t.id);
    if (alerted.get(t.id) !== p.status) send.push({ task: t, plan: p });
  }
  const clear = [...alerted.keys()].filter((id) => !atRiskIds.has(id));
  return { send, clear };
}
