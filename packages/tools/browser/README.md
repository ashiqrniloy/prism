# @arnilo/prism-tools-browser

The first-party browser automation tools as a Prism package. The default export is a
`definePackage` definition whose `setup` imports `playwright-core`, launches the run-owned
browser, and registers six exclusive model-facing tools into the session's tool registry.

## Install

```bash
prism add @arnilo/prism-tools-browser
bun add playwright-core@1.63.0
```

```jsonc
// manifest entry, with every config field that has no default
{
  "name": "@arnilo/prism-tools-browser",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": {
    "headless": true,
    "allowOrigins": ["https://example.com"],
    "containedProxy": { "proxyEndpoint": "http://127.0.0.1:3128", "denyDirectEgress": true }
  }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `headless` | `boolean` | `true` | Passed to `chromium.launch`. |
| `executablePath` | `string` | none | Absolute path to a host-pinned browser binary. |
| `channel` | `string` | none | Playwright channel (for example `"chromium"` or `"chrome"`). |
| `allowOrigins` | `string[]` | none | When set, navigation and subrequests to any other origin are hard-denied. |
| `containedProxy` | `{ proxyEndpoint, denyDirectEgress: true }` | none | Host attestation that egress is forced through an isolated proxy/firewall. Without it every external request is denied (fail closed). |
| `allowLoopback` | `boolean` | `false` | Allow loopback destinations. |
| `allowPrivateHosts` | `boolean` | `false` | Allow private/link-local/ULA destinations. |
| `uploadRoots` | `string[]` | none | Absolute roots uploads may read from (realpath-contained; symlink escapes rejected). |
| `quarantine` | `string` | none | Absolute quarantine directory; enables download support when set. |
| `cdp` | `"auto"` \| `"on"` \| `"off"` | `"auto"` | CDP capability gating for `browser_evaluate`, `browser_observe`, and the CDP actions. |

An unknown key fails `createAgent` with the kernel's config error naming the key. A missing
`playwright-core` (or a failed launch) registers nothing and writes a `warn` status note; it never
throws.

## What it changes

Registers tools with a declared `effects` annotation:

| tool | effects | notes |
| --- | --- | --- |
| `browser_open` | `["network"]` | opens/reuses the run-owned non-persistent context; optional absolute http(s) navigation |
| `browser_snapshot` | `["network"]` | bounded AI-mode accessibility snapshot with snapshot-scoped refs |
| `browser_act` | `["network", "write"]` | one ordered action: navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog/select_page/upload/screenshot/download_release plus CDP block_urls/unblock_urls/throttle/emulate |
| `browser_close` | `[]` | closes the run-owned context; idempotent; never the host Browser process |
| `browser_evaluate` | `["execute", "network"]` | bounded `Runtime.evaluate` in the page context (Chromium hosts) |
| `browser_observe` | `["network"]` | drains bounded console/network observations (never bodies, cookies, or auth headers) |

The host approval hook sees `effects`; there is no in-tool `ExecutionPolicy`. Blocked schemes,
loopback/private/link-local destinations, the `allowOrigins` allowlist, and upload-root containment
are enforced inside the manager, so they hold under any approval mode.

It also ships one skill, `browser-automation` (filling a field is not submitting it, do not type credentials you were not given, report what the snapshot shows). It declares `requiresTools: browser_open browser_snapshot browser_act`, so an agent whose `playwright-core` is missing or whose launch failed does not list it. Cost: one catalog line, and the body only when the model loads it; `disable: { skills: ["browser-automation"] }` removes it. Its effect is measured on one hazard (`browser-no-credentials`: 8/9 with the skill, 1/9 without) and not in the pooled score; targeting (role and label before refs) lives in the `browser_act` description. See [the evidence](../../../docs/_evidence/skill-evals/211/v3/browser-automation.preload.md).

## Capabilities

None. Setup registers tools and `onDispose` closes the manager and the browser it launched; it
touches no gated `PackageAPI` member.

## Cost, security, and failure behavior

- Import is inert. Importing the package loads no `playwright-core`; only `setup` imports it, and
  only when the package is listed.
- The package never downloads a browser binary. `playwright-core` is an optional exact peer
  (`1.63.0`); the host supplies the binary, image, and cache.
- Egress is fail-closed: without `containedProxy` every external request is denied. Playwright
  routing is defense in depth — production DNS/private egress is a host firewall/proxy.
- Uploads require absolute paths under `uploadRoots`; downloads quarantine with SHA-256/MIME
  metadata until a host `approveRelease` callback. Snapshots/page text are marked `untrusted_external`,
  so the kernel wraps them in its envelope (`docs/tools.md`).
- Missing peer or failed launch is a status note and an inert package, never a throw.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import toolsBrowser from "@arnilo/prism-tools-browser";

const agent = await createAgent({
  model,
  packages: [toolsBrowser({ headless: true, allowOrigins: ["https://example.com"] })],
});
```

The 0.12 factory names (`createBrowserTools`, `createBrowserManager`, `connectObscuraCdp` over
`@arnilo/prism-tools-web`, the limits/normalize/policy helpers, and the structural Playwright types)
stay exported for hosts that build tool lists by hand and supply their own browser.
