// Builds a single self-contained HTML file of the demo mode (no server, no credentials)
// into preview-dist/index.html. Used for the hosted preview and the e2e check.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  entryPoints: [path.join(root, "src/preview/main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  write: false,
  alias: { "@": path.join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile(path.join(root, "src/styles/app.css"), "utf8");
const head = `<title>AI Scheduler</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600;700&display=swap">
<style>${css}</style>`;
const body = `<div id="ai-scheduler-root"></div>
<script>${js}</script>`;
const out = path.join(root, "preview-dist");
await mkdir(out, { recursive: true });
// Hosted page: the host wraps it in a document skeleton.
await writeFile(path.join(out, "index.html"), `${head}\n${body}\n`);
// Standalone file for local viewing and the e2e check.
await writeFile(
  path.join(out, "standalone.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${head}</head><body>${body}</body></html>`,
);
console.log(`preview-dist/index.html ${((head.length + body.length) / 1024).toFixed(0)} KB`);
