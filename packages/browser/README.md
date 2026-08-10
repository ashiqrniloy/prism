# @arnilo/prism-browser

Optional Playwright browser tools for Prism. Hosts supply a pinned Playwright `Browser`; Prism never downloads or launches browsers on import.

```ts
import { chromium } from "playwright-core";
import { createBrowserTools, createSharedSandboxBrowserOptions } from "@arnilo/prism-browser";

const aligned = createSharedSandboxBrowserOptions({
  workspaceRoot: "/workspace",
  downloadsRoot: "/downloads",
  containedProxyAttestation: {
    proxyEndpoint: "http://127.0.0.1:3128",
    denyDirectEgress: true,
  },
  approveDownloadRelease: async () => true,
});

const browser = await chromium.launch({ headless: true });
const tools = createBrowserTools({
  browser,
  ...aligned,
  limits: { maxPages: 4, maxActions: 100, maxSnapshotBytes: 256 * 1024 },
});
// browser_open / browser_snapshot / browser_act / browser_close
```

## Model tools

| Tool | Purpose |
| --- | --- |
| `browser_open` | Create/reuse one non-persistent `BrowserContext` for the current run; optional http(s) navigation |
| `browser_snapshot` | Bounded AI-mode accessibility YAML with snapshot-scoped refs |
| `browser_act` | Ordered navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog/select_page/upload/screenshot/download_release, plus CDP block_urls/unblock_urls/throttle/emulate; raw `{ css }` / `{ xpath }` targets |
| `browser_close` | Close the run context, pages, listeners, quarantined downloads, and snapshot state |
| `browser_evaluate` | Bounded page-context JS via CDP `Runtime.evaluate` (Chromium hosts; execution-policy gated) |
| `browser_observe` | Drain bounded console + network observations since the last call (CDP Runtime/Network; no body capture) |

All six tools set `exclusive: true`. The manager also serializes actions per run.

## Chrome DevTools Protocol (CDP) capabilities

Since 0.1.4, `@arnilo/prism-browser` rides playwright-core's existing CDP transport — `browser_evaluate`, `browser_observe`, and the `block_urls`/`unblock_urls`/`throttle`/`emulate` act actions. **Hosts still supply the Playwright Browser; Prism never launches or downloads browsers.** CDP requires a **Chromium-based** host browser (Playwright exposes `context.newCDPSession(page)` only for Chromium). Gating: `createBrowserTools({ browser, cdp: { mode: "auto" } })` — `auto` (default) uses CDP when available, `on` requires it, `off` disables CDP tools; unavailable CDP returns `ERR_PRISM_BROWSER_CDP_UNAVAILABLE` without affecting the Playwright-only tools.

Safety: `browser_evaluate` is arbitrary page-context code execution — it is classified high-impact and requires `ExecutionPolicy` approval plus the `beforeSideEffect` hook, like other mutations; results are JSON-serializable and capped (`maxEvaluateResultBytes`, expression capped by `maxActionInputBytes`). `browser_observe` never captures request/response bodies, cookies, or auth headers; console and network entries are bounded rings (`maxConsoleEntries`, `maxNetworkRequests`) with drain-on-read semantics. `block_urls`/`throttle`/`emulate` are run-scoped (reset on `browser_close`) with capped inputs. CDP domains are limited to Runtime, Network, and Emulation — cookies, tracing, IndexedDB, and worker debugging are not exposed.

## Host lifecycle

```ts
import { createBrowserManager } from "@arnilo/prism-browser";

const manager = createBrowserManager({ browser, ...aligned });
await manager.closeRun(runId); // terminal/abort/cancel
await manager.close();         // dispose every run
```

## Safety

- Import is inert: no browser launch, download, or network.
- Targets: snapshot refs, role/name, label, testId, text, and (0.1.4) raw `{ css }` / `{ xpath }`. `selector`/`evaluate` target keys stay denied; page-context JS goes through the policy-gated `browser_evaluate`.
- Refs require the current `snapshotId` and invalidate after mutation/navigation.
- Egress defaults to require contained-proxy attestation; private/loopback/file/data/blob/devtools denied. Playwright routing is defense in depth.
- Uploads are realpath-contained; downloads quarantine until host `approveRelease`; screenshots return bounded `ImageContent`.
- Observation vs mutation/high-impact actions map to `ExecutionPolicy` / `beforeSideEffect`.
- Verified-state checkpoints (0.0.14, `createBrowserCheckpointLedger()`): store URL + domain-state hash + host data refs only — never serialized browser internals. After resume/interruption, `assertVerifiedBeforeSideEffect()` fails closed until reload + `verify()`, so side effects never replay on stale state.
- `playwright-core@1.61.0` is an optional peer; construction fails clearly when no browser/manager is supplied.
- Default tests use fakes only, including network-free adversarial eval fixtures. Protected live gate: `PRISM_LIVE_PLAYWRIGHT=1` (or `PRISM_TEST_PLAYWRIGHT=1`) `npm run test:live`.

See [Browser automation](../../docs/browser-automation.md).
