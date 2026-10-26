import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { findConflicts } from "@/lib/scheduler/engine";
import type { SchedulerState } from "@/lib/client/types";

// Uses the Playwright + Chromium preinstalled on the machine (see README).
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
const FILE = `file://${path.resolve(__dirname, "../../preview-dist/standalone.html")}`;
const SHOTS = process.env.E2E_SCREENSHOTS;

let browser: Browser;
let page: Page;

async function readState(p: Page): Promise<SchedulerState> {
  return p.evaluate(() => JSON.parse(localStorage.getItem("ai-scheduler:demo:v1")!));
}

function expectNoConflicts(s: SchedulerState, now: Date) {
  const result = { blocks: s.blocks, plans: s.plans, diff: { created: [], updated: [], deleted: [] }, computedAt: "", durationMs: 0 };
  expect(findConflicts(result, { tasks: s.tasks, events: s.events, previousBlocks: [], settings: s.settings, now })).toEqual([]);
}

// Monday 26 Oct 2026, 08:30 in Brussels.
const NOW = new Date("2026-10-26T07:30:00.000Z");

describe("demo preview (real browser)", () => {
  beforeAll(async () => {
    browser = await chromium.launch();
    const context = await browser.newContext({ timezoneId: "Europe/Brussels", viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(FILE);
    await page.getByTestId("plan-stat").filter({ hasText: "Re-planned" }).waitFor();
    expect(errors).toEqual([]);
  });
  afterAll(async () => browser?.close());

  it("plans the seeded week: 20 tasks, no overlaps, one flagged task", async () => {
    const s = await readState(page);
    expect(s.tasks).toHaveLength(20);
    expectNoConflicts(s, NOW);
    const flagged = s.tasks.filter((t) => s.plans[t.id].status !== "on_track").map((t) => t.id);
    expect(flagged).toEqual(["t20"]);
    await expect.poll(() => page.getByTestId("attention-count").textContent()).toBe("1 needs attention");
    expect(await page.locator('[data-kind="block"]').count()).toBeGreaterThan(15);
    expect(await page.locator('[data-kind="meeting"]').count()).toBeGreaterThan(10);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/week-light.png` });
  });

  it("moving a meeting re-plans in under 5 seconds with no overlaps", async () => {
    const before = await readState(page);
    await page.getByTestId("e-m-planning").click();
    const started = Date.now();
    await page.getByRole("button", { name: "+1 h" }).click();
    await page.getByRole("status").filter({ hasText: "Meeting moved" }).waitFor({ timeout: 5000 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5000);

    const after = await readState(page);
    const moved = after.events.find((e) => e.id === "m-planning")!;
    const original = before.events.find((e) => e.id === "m-planning")!;
    expect(new Date(moved.start).getTime() - new Date(original.start).getTime()).toBe(60 * 60_000);
    expectNoConflicts(after, NOW);
    expect(JSON.stringify(after.blocks)).not.toEqual(JSON.stringify(before.blocks));
    console.log(`meeting move → re-plan visible in ${elapsed} ms`);
  });

  it("reporting an overrun adds time and re-plans", async () => {
    const block = page.locator('[data-testid^="b-"]').first();
    await block.click();
    const before = await readState(page);
    await page.getByRole("button", { name: "+30 min" }).click();
    await page.getByRole("status").filter({ hasText: "Added 30 min" }).waitFor();
    const after = await readState(page);
    const changed = after.tasks.filter((t) => t.estimateMinutes !== before.tasks.find((b) => b.id === t.id)!.estimateMinutes);
    expect(changed).toHaveLength(1);
    expect(changed[0].estimateMinutes - before.tasks.find((t) => t.id === changed[0].id)!.estimateMinutes).toBe(30);
    expectNoConflicts(after, NOW);
  });

  it("adds a task through the form and plans it", async () => {
    await page.getByRole("button", { name: "+ Add task" }).click();
    await page.locator("#task-title").fill("Call supplier about tiles");
    await page.locator("#task-hours").fill("0");
    await page.locator("#task-minutes").fill("45");
    await page.locator("#task-deadline").fill("2026-10-30T17:00");
    await page.getByRole("button", { name: "Add and plan" }).click();
    await page.getByRole("status").filter({ hasText: "planned" }).waitFor();
    const s = await readState(page);
    const t = s.tasks.find((x) => x.title === "Call supplier about tiles")!;
    expect(t.deadline).toBe("2026-10-30T16:00:00.000Z");
    expect(s.plans[t.id].scheduledMinutes).toBe(45);
    expect(s.plans[t.id].status).toBe("on_track");
    expectNoConflicts(s, NOW);
  });

  it("marking a task done releases its time", async () => {
    const before = await readState(page);
    const t = before.tasks.find((x) => x.title === "Call supplier about tiles")!;
    await page.getByRole("checkbox", { name: `Mark "${t.title}" as done` }).check();
    await page.getByRole("status").filter({ hasText: "Marked done" }).waitFor();
    const after = await readState(page);
    expect(after.blocks.filter((b) => b.taskId === t.id)).toHaveLength(0);
  });

  it("works at phone width in dark mode", async () => {
    const ctx = await browser.newContext({ timezoneId: "Europe/Brussels", viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(NOW);
    await p.goto(FILE);
    await p.getByTestId("plan-stat").filter({ hasText: "Re-planned" }).waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/day-dark-mobile.png`, fullPage: false });
    await ctx.close();
  });
});
