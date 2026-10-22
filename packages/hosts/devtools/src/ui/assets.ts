/**
 * Static UI assets for the devtools page.
 *
 * One page and one browser module, served from this origin with no external fetches. The module is
 * `inspector.ts`, transpiled by Bun on first request and cached: the package ships source, so there is
 * no build step and no `dist/`. Every response carries a strict CSP (scripts, styles, and connections
 * to this origin only).
 */
import { readFileSync } from "node:fs";

/** Strict CSP for the served page: scripts, styles, and connections to this origin only. */
export const UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CSP_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": UI_CSP,
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

let cachedScript: string | undefined;

/** The browser module, transpiled from `inspector.ts` and cached for the process. */
export function getInspectorScript(): string {
  if (cachedScript === undefined) {
    const source = readFileSync(new URL("./inspector.ts", import.meta.url), "utf8");
    cachedScript = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(source);
  }
  return cachedScript;
}

/** The served page: one static document with the layout and the stylesheet inline. */
export function inspectorPageResponse(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>prism devtools</title>
<style>
:root { color-scheme: light dark; font: 14px/1.45 ui-monospace, monospace; }
body { margin: 0 auto; max-width: 1200px; padding: 1rem; }
h1 { font-size: 1.1rem; margin: 0 0 .25rem; } h2 { font-size: .95rem; margin: 1rem 0 .35rem; }
.hint { color: gray; margin: .1rem 0 .75rem; font-size: .85rem; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
pre { margin: .2rem 0 0; padding: .4rem; background: color-mix(in srgb, currentColor 7%, transparent); overflow: auto; max-height: 18rem; white-space: pre-wrap; word-break: break-word; }
button { font: inherit; cursor: pointer; margin: .3rem .3rem 0 0; }
button:disabled { opacity: .5; cursor: default; }
textarea { width: 100%; box-sizing: border-box; font: inherit; min-height: 6rem; }
ul { list-style: none; margin: 0; padding: 0; max-height: 14rem; overflow-y: auto; }
li { padding: .2rem .4rem; border-radius: 4px; cursor: pointer; }
li.selected { background: color-mix(in srgb, highlight 30%, transparent); }
.feed { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; padding: .35rem; max-height: 22rem; overflow-y: auto; }
.feed div { padding: .15rem .4rem; margin: .1rem 0; border-left: 3px solid gray; white-space: pre-wrap; word-break: break-word; }
.status { color: gray; font-size: .85rem; min-height: 1.2rem; }
.error { color: crimson; }
@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
</style>
<script type="module" src="/assets/inspector.js"></script>
</head>
<body>
<h1>prism devtools</h1>
<p class="hint">read-only over this agent; payloads are host-redacted</p>
<div class="layout">
  <section>
    <h2>Inspection</h2>
    <div id="inspect-summary" class="status"></div>
    <pre id="inspect"></pre>
    <h2>Sessions</h2>
    <button id="sessions-refresh">Refresh</button>
    <button id="sessions-more" disabled>More</button>
    <div id="sessions-status" class="status"></div>
    <ul id="sessions"></ul>
    <h2>Compare</h2>
    <textarea id="compare-input" spellcheck="false">{"left":{"summary":{"durationMs":120,"errorCount":0,"toolCallCount":1,"status":"completed"}},"right":{"summary":{"durationMs":90,"errorCount":0,"toolCallCount":1,"status":"completed"}}}</textarea>
    <button id="compare-run">Compare</button>
    <pre id="compare-out"></pre>
  </section>
  <section>
    <h2>Entries <span id="replay-title" class="status"></span></h2>
    <button id="replay-more" disabled>Next page</button>
    <div id="replay-status" class="status"></div>
    <div id="replay" class="feed"></div>
    <h2>Live events</h2>
    <div id="live-status" class="status">select a session to follow its events</div>
    <div id="live" class="feed"></div>
  </section>
</div>
</body>
</html>
`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...CSP_HEADERS } });
}

/** The browser module. */
export function inspectorScriptResponse(): Response {
  return new Response(getInspectorScript(), {
    status: 200,
    headers: { "content-type": "text/javascript; charset=utf-8", ...CSP_HEADERS },
  });
}
