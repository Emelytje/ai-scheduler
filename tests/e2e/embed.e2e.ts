import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";

// Needs a running app: E2E_URL=http://localhost:3100/ with EMBED_ALLOWED_ORIGINS containing http://localhost:3200.
const APP = process.env.E2E_URL;
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");

const hostPage = (app: string) => `<!doctype html><html><body>
<h1>Seller app</h1>
<div id="planner" data-ai-scheduler data-view="day"></div>
<script>
  window.planEvents = [];
  document.getElementById("planner").addEventListener("ai-scheduler:plan", (e) => window.planEvents.push(e.detail));
</script>
<script src="${new URL("/embed.js", app)}"></script>
</body></html>`;

describe.skipIf(!APP)("embed in a host application", () => {
  let browser: Browser;
  const servers: Server[] = [];
  const serve = (port: number) =>
    new Promise<void>((resolve) => {
      const s = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(hostPage(APP!)));
      servers.push(s);
      s.listen(port, resolve);
    });

  beforeAll(async () => {
    await serve(3200); // allowed origin
    await serve(3201); // not allowed
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    servers.forEach((s) => s.close());
  });

  it("renders inside an allowed host and reports plan health to it", async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.clock.setFixedTime(new Date("2026-10-26T07:30:00.000Z"));
    await page.goto("http://localhost:3200/");
    const frame = page.frameLocator("iframe");
    await frame.getByTestId("plan-stat").filter({ hasText: "Re-planned" }).waitFor({ timeout: 15000 });
    // Host asked for the day view via data-view.
    await expect.poll(() => frame.getByRole("button", { name: "Day", exact: true }).getAttribute("aria-pressed")).toBe("true");
    // Embed hides the app chrome (no brand header).
    expect(await frame.locator(".as-brand").count()).toBe(0);
    // Host page received the plan event with the at-risk task.
    await expect.poll(() => page.evaluate(() => (window as unknown as { planEvents: { atRisk: { title: string }[] }[] }).planEvents.length)).toBeGreaterThan(0);
    const detail = await page.evaluate(() => (window as unknown as { planEvents: { atRisk: { title: string }[] }[] }).planEvents.at(-1));
    expect(detail!.atRisk.map((t) => t.title)).toContain("Full permit dossier (rush)");
    // Resize messages adjust the iframe height to its content.
    await expect.poll(async () => Number((await page.locator("iframe").evaluate((f) => (f as HTMLIFrameElement).style.height)).replace("px", ""))).toBeGreaterThan(480);
    await page.close();
  });

  it("is blocked inside a host that is not on the allow-list", async () => {
    const page = await browser.newPage();
    await page.goto("http://localhost:3201/");
    await page.waitForTimeout(2000);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const rendered = frame ? await frame.locator("[data-testid=plan-stat]").count().catch(() => 0) : 0;
    expect(rendered).toBe(0);
    await page.close();
  });
});
