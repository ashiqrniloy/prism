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
| `browser_act` | Ordered navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog/select_page/upload/screenshot/download_release |
| `browser_close` | Close the run context, pages, listeners, quarantined downloads, and snapshot state |

All four tools set `exclusive: true`. The manager also serializes actions per run.

## Host lifecycle

```ts
import { createBrowserManager } from "@arnilo/prism-browser";

const manager = createBrowserManager({ browser, ...aligned });
await manager.closeRun(runId); // terminal/abort/cancel
await manager.close();         // dispose every run
```

## Safety

- Import is inert: no browser launch, download, or network.
- Targets: snapshot refs, role/name, label, testId, text. No CSS/XPath/evaluate/CDP.
- Refs require the current `snapshotId` and invalidate after mutation/navigation.
- Egress defaults to require contained-proxy attestation; private/loopback/file/data/blob/devtools denied. Playwright routing is defense in depth.
- Uploads are realpath-contained; downloads quarantine until host `approveRelease`; screenshots return bounded `ImageContent`.
- Observation vs mutation/high-impact actions map to `ExecutionPolicy` / `beforeSideEffect`.
- `playwright-core@1.61.0` is an optional peer; construction fails clearly when no browser/manager is supplied.
- Default tests use fakes only, including network-free adversarial eval fixtures. Protected live gate: `PRISM_LIVE_PLAYWRIGHT=1` (or `PRISM_TEST_PLAYWRIGHT=1`) `npm run test:live`.

See [Browser automation](../../docs/browser-automation.md).
