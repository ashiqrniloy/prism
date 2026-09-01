/**
 * Static UI assets for the dev inspector (plan 040 Task 3).
 *
 * Single static bundle, served from the package with no external fetches
 * (offline-capable): the page HTML is inlined here; the browser module is the
 * package's own tsc-emitted `inspector.js` (zero runtime imports), read once
 * from disk and cached. Every asset ships a strict CSP — scripts from this
 * origin only, no eval, styles inline (kept: the page's stylesheet is part of
 * the bundle), connections to this origin only.
 */

import { readFileSync } from "node:fs";

/** Strict CSP for the served UI (scripts/styles/connect: this origin only). */
export const UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

let cachedScript: string | undefined;

/** The compiled browser module (sibling emitted by the package's tsc). */
export function getInspectorScript(): string {
  cachedScript ??= readFileSync(new URL("./inspector.js", import.meta.url), "utf8");
  return cachedScript;
}

const CSP_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": UI_CSP,
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

/** The served page (plan 040 Task 3 contract): one static document. */
export function inspectorPageResponse(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>prism dev inspector</title>
<style>
:root { color-scheme: light dark; font: 14px/1.45 ui-monospace, monospace; }
body { margin: 0 auto; max-width: 1200px; padding: 1rem; }
h1 { font-size: 1.1rem; margin: 0 0 .25rem; } h2 { font-size: .95rem; margin: 1rem 0 .35rem; }
.hint { color: gray; margin: .1rem 0 .75rem; font-size: .85rem; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 1rem; }
textarea { width: 100%; box-sizing: border-box; font: inherit; }
button { font: inherit; cursor: pointer; margin-top: .35rem; }
button:disabled { opacity: .5; cursor: default; }
.prompt { display: flex; flex-direction: column; }
.usage { color: gray; font-size: .85rem; min-height: 1.2rem; }
.timeline { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; padding: .35rem; max-height: 70vh; overflow-y: auto; }
.evt { padding: .15rem .5rem; margin: .15rem 0; border-left: 3px solid gray; white-space: pre-wrap; word-break: break-word; }
.evt.message { border-left-color: steelblue; }
.evt.tool { border-left-color: darkorange; }
.evt.tool.ok { border-left-color: seagreen; }
.evt.tool.error, .evt.note.error { border-left-color: crimson; color: inherit; }
.evt.tool.blocked { border-left-color: purple; }
.evt.turn, .hidden-note { color: gray; border-left-color: transparent; font-size: .8rem; }
.evt summary { cursor: pointer; }
.evt pre { margin: .2rem 0 0; padding: .3rem; background: color-mix(in srgb, currentColor 7%, transparent); overflow-x: auto; max-height: 16rem; }
.note.warn { border-left-color: goldenrod; }
.note.error { color: inherit; }
.decisions { margin: .5rem 0; display: flex; flex-direction: column; gap: .4rem; }
.decision { border: 1px solid goldenrod; border-radius: 6px; padding: .4rem .6rem; display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.decision .reason { color: gray; flex-basis: 100%; }
.decision button { margin: 0; }
.decision button.error { color: crimson; }
.side h2 { margin-top: 0; }
.runs { list-style: none; margin: 0 0 .5rem; padding: 0; max-height: 40vh; overflow-y: auto; }
.runs li { padding: .2rem .4rem; border-radius: 4px; cursor: pointer; }
.runs li.selected { background: color-mix(in srgb, highlight 30%, transparent); }
.runs li.hint { cursor: default; color: gray; }
#load-run { width: 100%; box-sizing: border-box; }
@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
</style>
<script type="module" src="/assets/inspector.js"></script>
</head>
<body>
<div id="app"></div>
</body>
</html>
`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...CSP_HEADERS } });
}

/** The browser module bundle. */
export function inspectorScriptResponse(): Response {
  return new Response(getInspectorScript(), {
    status: 200,
    headers: { "content-type": "text/javascript; charset=utf-8", ...CSP_HEADERS },
  });
}

/** Same-origin bootstrap config for the page (`GET /config`). */
export function inspectorConfigResponse(basePath: string, agentId: string): Response {
  return new Response(JSON.stringify({ basePath, agentId }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
