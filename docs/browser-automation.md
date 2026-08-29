# Browser automation

## What it does

`@arnilo/prism-browser` exposes six exclusive model-facing tools—`browser_open`, `browser_snapshot`, `browser_act`, `browser_close`, `browser_evaluate`, and `browser_observe`—over a host-supplied Playwright `Browser`. Prism creates one non-persistent `BrowserContext` per run, serializes actions, returns bounded AI-mode accessibility snapshots with snapshot-scoped refs, enforces egress/side-effect/upload/download/screenshot policy, and closes context/pages/listeners/quarantined downloads on close, abort, or manager disposal. Since 0.1.4 the package also rides playwright-core's existing CDP transport for bounded page evaluation, console/network observation, and network/emulation control on Chromium hosts — zero new dependencies, Prism still never launches or downloads browsers.

## When to use it

Use when an agent must interact with JavaScript-heavy or authenticated pages that search/fetch cannot cover, or needs bounded page-context evaluation and console/network observation on Chromium. Prefer `@arnilo/prism-web-tools` for ordinary public retrieval. Do not use this package as a browser launcher, MCP proxy, visual planner, general-purpose CDP console (domains are allowlisted), or persistent profile manager.

## Inputs / request

| Tool | Model-visible input | Host-only construction input |
| --- | --- | --- |
| `browser_open` | optional absolute `http(s)` `url` | host Playwright `Browser` or `BrowserManager`, limits, `ExecutionPolicy`, `networkPolicy`, uploads/downloads |
| `browser_snapshot` | optional `pageId` | same manager/context |
| `browser_act` | `action` plus action-specific fields (`target`, `snapshotId`, `url`, `text`, `values`, `paths`, `downloadId`, `dialogResponse`, `pageId`, `clip`, `patterns`, `offline`, `latencyMs`, `downloadKbps`, `uploadKbps`, `reset`, `width`, `height`, `mobile`, `deviceScaleFactor`, `userAgent`, …) | policy checked before side effects |
| `browser_evaluate` | optional `pageId`, required `expression`, optional `awaitPromise`/`timeoutMs` | CDP `Runtime.evaluate` on a per-page session (Chromium hosts) |
| `browser_observe` | optional `pageId` | CDP Runtime/Network ring, drain-on-read |
| `browser_close` | none | closes only the run-owned context, never the host Browser process |

`createBrowserTools({ browser, executionPolicy?, limits?, networkPolicy?, uploads?, downloads?, beforeSideEffect?, cdp? })` builds the six tools. `createBrowserManager(...)` exposes host lifecycle helpers `closeRun(runId)` / `close()` and `listDownloads(runId)`.

Targets accepted by `browser_act`: snapshot `ref`, `role`(+`name`), `label`, `testId`, `text`, and (0.1.4) raw `{ css }` / `{ xpath }`. `selector` strings and `evaluate` target keys stay denied; page-context JS goes through the policy-gated `browser_evaluate`. Extensions and persistent/local profiles are unsupported.

`browser_act` actions: `navigate`, `click`, `type`, `fill`, `select`, `check`, `uncheck`, `scroll`, `wait`, `dialog`, `select_page`, `upload`, `screenshot`, `download_release`, and (0.1.4, CDP) `block_urls`, `unblock_urls`, `throttle`, `emulate`.

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
- Raw CSS/XPath: since 0.1.4 `{ css }` / `{ xpath }` targets resolve via Playwright's selector engine (`locator(css)` / `locator("xpath=…")`); ref resolution keeps the built-in `aria-ref=` selector with a package-owned snapshot ref table for staleness checks.
- CDP capabilities (0.1.4): `browser_evaluate` (bounded `Runtime.evaluate`), `browser_observe` (Runtime console/exception + Network request/response/failed events in a bounded ring with drain-on-read), and `block_urls`/`unblock_urls` (`Network.setBlockedURLs`), `throttle` (`Network.emulateNetworkConditions`), `emulate` (`Emulation.setDeviceMetricsOverride` + optional `setUserAgentOverride`). All CDP sessions are per-page via `context.newCDPSession(page)` and are detached on run close — network/emulation changes are run-scoped and reset with `browser_close`. `BrowserCdpOptions.mode` (`auto` | `on` | `off`, default `auto`) gates the surface: non-Chromium hosts or mode `off` return `ERR_PRISM_BROWSER_CDP_UNAVAILABLE` without affecting Playwright-only tools. Domains are limited to the Runtime/Network/Emulation allowlist — cookies, tracing, performance profiles, IndexedDB, and worker debugging are not exposed. CDP is not an egress bypass: page network still routes through the run's routing/blocking and `networkPolicy`.
- CDP bounds (0.1.4): evaluate expression ≤ `maxActionInputBytes` (64 KiB default / 256 KiB hard) and result capped at `maxEvaluateResultBytes` (64 KiB / 256 KiB) with truncation marking; `browser_observe` rings capped at `maxConsoleEntries` (200/500) and `maxNetworkRequests`; `block_urls` patterns ≤ `maxBlockedUrlPatterns` (32/128); throttle latency ≤ 120 s and throughput ≤ 1 Gbps; emulate dimensions ≤ 16 384 and scale ≤ 10, user agent ≤ 2 KiB. Evaluate is classified high-impact (arbitrary page-context code execution): `ExecutionPolicy` approval and the `beforeSideEffect` hook are mandatory, it charges the action budget, and results are marked `untrusted_external`. `browser_observe` is observation-only (no side-effect hook, no action charge) and **never captures request/response bodies, cookies, or auth headers** — only bounded URL/method/status/error-text/arg previews.
- Verified-state checkpoints (0.0.14): `createBrowserCheckpointLedger()` records navigation state — URL, a domain-state hash, and host-owned data refs — never serialized browser internals (cookies/storage/contexts), which are fragile and secret-bearing. Frozen caps: URL 8 KiB/16 KiB, domain-state hash 256 B/1 KiB, host-data ref 2 KiB/8 KiB (refs only, never bodies), 16/64 checkpoints per run (oldest evicted). After any resume/interruption `markResumed(runId)` marks state stale; `assertVerifiedBeforeSideEffect(runId)` fails closed until the host reloads + `verify()`s, so side effects never replay on stale state. Checkpoints are run-scoped: a conversation thread composes through the run it owns, reusing the manager's sandbox/egress/approval/limit policy above.

Observation tools declare `kind: none`; mutations are `external_mutation`/`unsupported` and fail closed on stale checkpoint state. See [tool effects](tool-effects.md).

## Security and performance notes

Import is inert. Construction fails clearly when neither `browser` nor `manager` is supplied. Browser installation, launch, version, and control endpoint are host-owned. Prism never exposes init scripts, extensions, persistent profiles, or model-supplied Playwright launch options; CDP exposure is limited to the allowlisted Runtime/Network/Emulation surface above (evaluate is policy-gated arbitrary code execution — treat results as untrusted). Secrets and storage state must not appear in snapshots, tool results, logs, or checkpoints. Finite caps charge before context/page/action/queue/snapshot/network/artifact retention; snapshots retain no unbounded DOM, console, request, response, or trace history. Unreleased downloads are deleted on context close.

Default tests use fake Playwright APIs only. Protected live gate: `PRISM_LIVE_PLAYWRIGHT=1` (or `PRISM_TEST_PLAYWRIGHT=1`) `npm run test:live -w @arnilo/prism-browser` exercises a local loopback hostile HTML fixture for snapshot refs, stale-ref rejection, css/xpath targets, private/file deny, upload containment, screenshot bounds, download quarantine/release, and the CDP leg (real evaluate, observe, and emulate). Missing browser binaries fail closed when the gate is enabled. The protected coding journey (0.2.6, plan 026 Task 7) additionally runs a real browser inspection leg (local loopback fixture page, snapshot text assertion, run-owned context closed before the host browser) inside the packed consumer as part of scripts/phase26-coding-journey.test.mjs, gated by PRISM_LIVE_PLAYWRIGHT with the pinned playwright-core installed into the consumer; browser storage never appears in the retained report. Adversarial network-free fixtures live in `eval-fixtures.test.ts`; see [Evaluations](evaluations.md) and `examples/coding-browser-evaluation.ts`.

## Related APIs

- [Obscura browser engine](obscura.md): optional host-installed Obscura headless browser connected with `chromium.connectOverCDP` through `connectObscuraCdp` — its returned browser plugs directly into `createBrowserTools`/`createBrowserManager` as the host-supplied Playwright browser; pages on one Obscura worker share one V8 isolate, and screenshots/PDF need a render-enabled build.
- [Tools](tools.md): registry, exclusive dispatch, validation, and ledger.
- [Web search, fetch, and extraction](web-tools.md): preferred non-interactive retrieval path.
- [Guardrails](guardrails.md): untrusted external content handling.
- [Host security](host-security.md): browser endpoint, approval, egress proxy, and artifact trust boundaries.
- [Performance and resource limits](performance.md): browser ceilings and charging points.
- [Coding execution approval and sandboxing](coding-security.md): optional shared disposable sandbox for coding+browser.
- [Conversations](conversations.md): durable threads that own the runs browser checkpoints scope to.
- [Device adapters](device-adapters.md): deny-by-default voice/desktop-control contracts (no vendor package in 0.0.14).
- [Migration](migration.md): additive optional package activation.
