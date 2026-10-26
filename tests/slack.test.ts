import { createHmac } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import { plan } from "@/lib/scheduler/engine";
import { buildSeed } from "@/lib/scheduler/seed";
import { DEFAULT_SETTINGS } from "@/lib/scheduler/types";
import type { SchedulerState } from "@/lib/client/types";
import { parseCommand, parseDuration } from "@/lib/slack/commands";
import { ACTION_DONE, alertMessage, diffAlerts, esc, planMessage } from "@/lib/slack/messages";
import { verifySlackSignature } from "@/lib/slack/signature";
import { signSlackLinkToken, verifySlackLinkToken } from "@/lib/server/embed-token";

const TZ = "Europe/Brussels";
const local = (y: number, m: number, d: number, h: number, mi = 0) => new Date(new TZDate(y, m - 1, d, h, mi, 0, TZ).getTime());
const NOW = local(2026, 10, 26, 8, 30); // Monday

describe("Slack request signatures", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const body = "token=x&team_id=T1&user_id=U1&command=%2Fplan&text=today";
  const ts = "1793000000";
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;

  it("accepts a valid, fresh signature", () => {
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: ts, signature: sig, nowSeconds: 1793000100 })).toBe(true);
  });
  it("rejects a tampered body, wrong secret, missing headers and replays", () => {
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body + "x", timestamp: ts, signature: sig, nowSeconds: 1793000100 })).toBe(false);
    expect(verifySlackSignature({ signingSecret: "other", rawBody: body, timestamp: ts, signature: sig, nowSeconds: 1793000100 })).toBe(false);
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: null, signature: sig })).toBe(false);
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: ts, signature: sig, nowSeconds: 1793000000 + 301 })).toBe(false);
  });
});

describe("/plan command parsing", () => {
  it("parses durations", () => {
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("1h")).toBe(60);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("leads")).toBeNull();
  });

  it("defaults to today and recognises subcommands", () => {
    expect(parseCommand("", TZ, NOW)).toEqual({ kind: "today" });
    expect(parseCommand("week", TZ, NOW)).toEqual({ kind: "week" });
    expect(parseCommand("risks", TZ, NOW)).toEqual({ kind: "risks" });
    expect(parseCommand("connect", TZ, NOW)).toEqual({ kind: "connect" });
    expect(parseCommand("dance", TZ, NOW).kind).toBe("error");
  });

  it("parses a full add command in the user's time zone", () => {
    const c = parseCommand("add Send quote to Smits 1h30 by fri 17:00 !high", TZ, NOW);
    expect(c).toEqual({
      kind: "add",
      input: {
        title: "Send quote to Smits",
        estimateMinutes: 90,
        deadline: local(2026, 10, 30, 17).toISOString(),
        notBefore: null,
        priority: "high",
        splittable: true,
        minChunkMinutes: 30,
      },
    });
  });

  it("supports after, dates, am/pm and default times", () => {
    const c = parseCommand("add Order tiles 45m after tomorrow by 30/10 5pm", TZ, NOW);
    expect(c.kind).toBe("add");
    if (c.kind !== "add") return;
    expect(c.input.notBefore).toBe(local(2026, 10, 27, 9).toISOString());
    expect(c.input.deadline).toBe(local(2026, 10, 30, 17).toISOString());
    const d = parseCommand("add Report 30m by 2026-11-02", TZ, NOW);
    expect(d.kind === "add" && d.input.deadline).toBe(local(2026, 11, 2, 17).toISOString());
  });

  it("rolls a weekday that already passed today over to next week", () => {
    const mondayEvening = local(2026, 10, 26, 18);
    const c = parseCommand("add Prep 30m by mon", TZ, mondayEvening);
    expect(c.kind === "add" && c.input.deadline).toBe(local(2026, 11, 2, 17).toISOString());
  });

  it("keeps 'by' in the title when no date follows", () => {
    const c = parseCommand("add Call by phone 30m", TZ, NOW);
    expect(c.kind === "add" && c.input.title).toBe("Call by phone");
  });

  it("explains what is missing", () => {
    expect(parseCommand("add Call leads", TZ, NOW)).toMatchObject({ kind: "error", message: expect.stringMatching(/duration/) });
    expect(parseCommand("add 30m", TZ, NOW)).toMatchObject({ kind: "error", message: expect.stringMatching(/name/) });
    expect(parseCommand("add Old thing 30m by 2026-10-01", TZ, NOW)).toMatchObject({ kind: "error", message: expect.stringMatching(/past/) });
    expect(parseCommand("add X 30m after fri by wed", TZ, NOW)).toMatchObject({ kind: "error", message: expect.stringMatching(/before the deadline/) });
  });
});

function seededState(): SchedulerState {
  const settings = { ...DEFAULT_SETTINGS, timezone: TZ };
  const seed = buildSeed(NOW, TZ);
  const r = plan({ ...seed, previousBlocks: [], settings, now: NOW });
  return {
    mode: "live",
    ...seed,
    blocks: r.blocks,
    plans: r.plans,
    settings,
    calendar: { provider: "google", connected: true, email: null, lastSyncAt: null, error: null },
    lastPlannedAt: r.computedAt,
    lastPlanMs: r.durationMs,
  };
}

describe("Slack messages and alerts", () => {
  const state = seededState();

  it("lists today's blocks with Done buttons and flags the at-risk task", () => {
    const m = planMessage(state, NOW, "today", "https://app.test");
    const json = JSON.stringify(m.blocks);
    expect(json).toContain("Call back inbound leads");
    expect(json).toContain(ACTION_DONE);
    expect(json).toContain("Full permit dossier (rush)");
    expect(m.text).toMatch(/1 at risk/);
    expect(m.blocks.length).toBeLessThanOrEqual(50); // Slack's limit
  });

  it("keeps the week view within Slack's block limit", () => {
    expect(planMessage(state, NOW, "week", "https://app.test").blocks.length).toBeLessThanOrEqual(50);
  });

  it("alerts once per task and status, and clears when back on track", () => {
    const first = diffAlerts(state, new Map());
    expect(first.send.map((s) => s.task.id)).toEqual(["t20"]);
    const again = diffAlerts(state, new Map([["t20", "late"]]));
    expect(again.send).toEqual([]);
    const resolved = { ...state, tasks: state.tasks.map((t) => (t.id === "t20" ? { ...t, status: "done" as const } : t)) };
    expect(diffAlerts(resolved, new Map([["t20", "late"]])).clear).toEqual(["t20"]);
  });

  it("escapes user text in messages", () => {
    expect(esc("<@channel> & co")).toBe("&lt;@channel&gt; &amp; co");
    const t = { ...state.tasks[0], title: "<!channel> ping" };
    const m = alertMessage([{ task: t, plan: state.plans.t20 }], TZ, "https://app.test");
    expect(JSON.stringify(m.blocks)).not.toContain("<!channel>");
  });
});

describe("Slack link tokens", () => {
  const secret = "s".repeat(40);
  it("round-trips the Slack identity and rejects other secrets / expiry", async () => {
    const t = await signSlackLinkToken({ teamId: "T1", slackUserId: "U1" }, secret);
    expect(await verifySlackLinkToken(t, secret)).toEqual({ teamId: "T1", slackUserId: "U1" });
    expect(await verifySlackLinkToken(t, "x".repeat(40))).toBeNull();
    expect(await verifySlackLinkToken(await signSlackLinkToken({ teamId: "T1", slackUserId: "U1" }, secret, -5), secret)).toBeNull();
  });
});
