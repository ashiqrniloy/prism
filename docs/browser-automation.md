# Browser automation

## What it does

`@arnilo/prism-browser` exposes exactly four exclusive model-facing tools—`browser_open`, `browser_snapshot`, `browser_act`, and `browser_close`—over a host-supplied Playwright `Browser`. Prism creates one non-persistent `BrowserContext` per run, serializes actions, returns bounded AI-mode accessibility snapshots with snapshot-scoped refs, enforces egress/side-effect/upload/download/screenshot policy, and closes context/pages/listeners/quarantined downloads on close, abort, or manager disposal.

## When to use it

Use when an agent must interact with JavaScript-heavy or authenticated pages that search/fetch cannot cover. Prefer `@arnilo/prism-web-tools` for ordinary public retrieval. Do not use this package as a browser launcher, MCP proxy, visual planner, CDP console, or persistent profile manager.

## Inputs / request

| Tool | Model-visible input | Host-only construction input |
| --- | --- | --- |
| `browser_open` | optional absolute `http(s)` `url` | host Playwright `Browser` or `BrowserManager`, limits, `ExecutionPolicy`, `networkPolicy`, uploads/downloads |
| `browser_snapshot` | optional `pageId` | same manager/context |
| `browser_act` | `action` plus action-specific fields (`target`, `snapshotId`, `url`, `text`, `values`, `paths`, `downloadId`, `dialogResponse`, `pageId`, `clip`, …) | policy checked before side effects |
| `browser_close` | none | closes only the run-owned context, never the host Browser process |

`createBrowserTools({ browser, executionPolicy?, limits?, networkPolicy?, uploads?, downloads?, beforeSideEffect? })` builds the four tools. `createBrowserManager(...)` exposes host lifecycle helpers `closeRun(runId)` / `close()` and `listDownloads(runId)`.

Targets accepted by `browser_act`: snapshot `ref`, `role`(+`name`), `label`, `testId`, or `text`. CSS, XPath, selector strings, `page.evaluate`, CDP/devtools, extensions, and persistent/local profiles are unsupported.

`browser_act` actions: `navigate`, `click`, `type`, `fill`, `select`, `check`, `uncheck`, `scroll`, `wait`, `dialog`, `select_page`, `upload`, `screenshot`, `download_release`.

## Outputs / response / events

`browser_open` returns run/page ids and URL. `browser_snapshot` returns `snapshotId`, URL/title, bounded AI-mode aria YAML (`ariaSnapshot({ mode: "ai" })`), ref count, and truncation metadata. Refs are valid only for that snapshot id and become stale after navigation or mutation. `browser_act` returns the action, active page id, and URL; `screenshot` also returns bounded `ImageContent`; `download_release` returns quarantine metadata after host approval. `browser_close` is idempotent. Results mark `trust: "untrusted_external"`; page text must never alter tools, permissions, credentials, or policy.

## Request/response example

```json
{
  "tool": "browser_snapshot",
  "arguments": {},
  "result": {
    "snapshotId": "snap_ab12…",
    "pageId": "page_1",
    "url": "https://example.com/",
    "title": "Example",
    "refCount": 12,
    "ariaSnapshot": "- main [ref=e8]:\n  - button \"Submit\" [ref=e12]"
  }
}
```

```json
{
  "tool": "browser_act",
  "arguments": {
    "action": "click",
    "target": { "ref": "e12" },
    "snapshotId": "snap_ab12…"
  }
}
```

## Implementation example

```ts
import { chromium } from "playwright-core";
import {
  createBrowserManager,
  createBrowserTools,
  createSharedSandboxBrowserOptions,
} from "@arnilo/prism-browser";
import { assertBrowserSandboxNetwork } from "@arnilo/prism-coding-security";

assertBrowserSandboxNetwork({
  mode: "custom",
  name: "prism-egress",
  browserEgress: { proxyEndpoint: "http://127.0.0.1:3128", denyDirectEgress: true },
});

const aligned = createSharedSandboxBrowserOptions({
  workspaceRoot: "/workspace",
  downloadsRoot: "/downloads",
  containedProxyAttestation: {
    proxyEndpoint: "http://127.0.0.1:3128",
    denyDirectEgress: true,
  },
  approveDownloadRelease: async (meta) => meta.bytes < 1_000_000,
});

const browser = await chromium.launch({ headless: true });
const manager = createBrowserManager({
  browser,
  ...aligned,
  limits: { maxPages: 4, maxActions: 100, maxSnapshotBytes: 256 * 1024 },
});
const tools = createBrowserTools({ manager, executionPolicy });

// On run terminal / abort / cancel:
await manager.closeRun(runId);
await manager.close();
await browser.close();
```

## Extension and configuration notes

- Compatibility line: `playwright-core@1.61.0` optional peer. Hosts pin browser binaries/images; Prism package install downloads nothing.
- Default/hard caps: pages 4/16; actions 100/256; queued actions 16/64; snapshot refs 2k/10k; depth 30/100; snapshot bytes 256 KiB/2 MiB; navigation 30s/120s; action 10s/60s; wait 30s/120s; run wall 20min/30min; popups 4/16; dialogs 16/64; close grace 5s/30s; network requests 1k/10k; redirects/request 10/32; WebSockets 8/32; screenshots 16/64 with 16/64 megapixels and 10 MiB/32 MiB encoded; uploads 8/32 files, 16 MiB/64 MiB each, 64 MiB/256 MiB aggregate; downloads 8/32 files, 32 MiB/256 MiB each, 64 MiB/512 MiB aggregate.
- Contexts use `serviceWorkers: "block"` and install `BrowserContext.route()` for every visible HTTP(S)/WebSocket request. `acceptDownloads` is enabled only when `downloads` is configured.
- `networkPolicy` defaults to `requireContainedProxy: true` (fail closed). Hosts must supply `containedProxyAttestation: { proxyEndpoint, denyDirectEgress: true }`. Private/loopback/link-local, `file`/`data`/`blob`/`javascript`/`devtools` schemes are denied by default. Playwright routing is defense in depth — production DNS/private egress is a host firewall/proxy.
- Uploads require absolute paths under `uploads.roots` (realpath-contained; symlink escapes rejected). Downloads stream into `downloads.quarantine` with SHA-256/MIME/name metadata; `download_release` requires host `approveRelease`. Screenshots return bounded `ImageContent`.
- Observation (`snapshot`, `wait`, open-without-url, `close`) vs mutation/high-impact (`navigate`, click/form, dialog accept, upload, download release, popup select) is classified for `ExecutionPolicy` / `beforeSideEffect`.
- `createSharedSandboxBrowserOptions()` aligns browser uploads/downloads with Task 1 sandbox `/workspace` and `/downloads`. `assertBrowserSandboxNetwork()` in `@arnilo/prism-coding-security` fails closed for custom Docker networks without browser egress attestation.
- Raw CSS is absent from production defaults. Ref resolution uses Playwright’s built-in `aria-ref=` selector with a package-owned snapshot ref table for staleness checks.

## Security and performance notes

Import is inert. Construction fails clearly when neither `browser` nor `manager` is supplied. Browser installation, launch, version, and control endpoint are host-owned. Prism never exposes `page.evaluate`, init scripts, CDP, extensions, persistent profiles, or model-supplied Playwright launch options. Secrets and storage state must not appear in snapshots, tool results, logs, or checkpoints. Finite caps charge before context/page/action/queue/snapshot/network/artifact retention; snapshots retain no unbounded DOM, console, request, response, or trace history. Unreleased downloads are deleted on context close.

Default tests use fake Playwright APIs only. Protected live gate: `PRISM_LIVE_PLAYWRIGHT=1` (or `PRISM_TEST_PLAYWRIGHT=1`) `npm run test:live -w @arnilo/prism-browser` exercises a local loopback hostile HTML fixture for snapshot refs, stale-ref rejection, CSS denial, private/file deny, upload containment, screenshot bounds, and download quarantine/release. Missing browser binaries fail closed when the gate is enabled. Adversarial network-free fixtures live in `eval-fixtures.test.ts`; see [Evaluations](evaluations.md) and `examples/coding-browser-evaluation.ts`.

## Related APIs

- [Tools](tools.md): registry, exclusive dispatch, validation, and ledger.
- [Web search, fetch, and extraction](web-tools.md): preferred non-interactive retrieval path.
- [Guardrails](guardrails.md): untrusted external content handling.
- [Host security](host-security.md): browser endpoint, approval, egress proxy, and artifact trust boundaries.
- [Performance and resource limits](performance.md): browser ceilings and charging points.
- [Coding execution approval and sandboxing](coding-security.md): optional shared disposable sandbox for coding+browser.
- [Migration](migration.md): additive optional package activation.
