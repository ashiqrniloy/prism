# Phase 39 — Obscura capability matrix and Prism primitive review

Evidence file for plan 039 Task 1 ("Freeze Obscura capability evidence and review
reusable Prism primitives first"). Reviewed 2026-08-28. All Obscura facts are pinned to
upstream revision `f449e6fb3183138eb3e80f11fe44af31cefe0fae` (crate version `0.1.0`,
repo `h4ckf0r0day/obscura`); any future Obscura upgrade re-runs this review before the
tool bridge changes its classification table.

## 1. Upstream capability inventory (Obscura `0.1.0` @ `f449e6f`)

### 1.1 CLI modes (`docs/CLI-reference.md`)

| Mode | Purpose | Key flags | Notes |
| --- | --- | --- | --- |
| `obscura fetch <URL>` | One-shot load + dump/eval | `--dump html\|text\|links\|markdown\|original\|assets\|cookies`, `--selector`, `--wait`, `--timeout` (default 30 s), `--wait-until`, `--eval`, `-o`, `-s` | `--screenshot` needs render build; 1280×720 default viewport; not available in batch mode. Adaptive settle when `--wait` omitted (5 s ceiling). |
| `obscura serve` | CDP server over WebSocket | `--host` (default `127.0.0.1`), `--port` (default 9222), `--workers N` (default 1), `--allow-file-access`, `--allow-private-network`, `--storage-dir` | Default endpoint `ws://127.0.0.1:9222`. |
| `obscura scrape [URLS]...` / stdin `-` | Parallel JS eval across URLs | `-e`, `--concurrency` (default 10), `--format json`, `--timeout` (default 60 s) | Requires `obscura-worker` next to `obscura` in `PATH`. |
| `obscura mcp` | MCP server, stdio default | `--http`, `--host` (default `127.0.0.1`, HTTP only), `--port` (default 3000) | Render builds add screenshot/PDF tools. |

Global flags (before or after any subcommand): `--proxy`, `--stealth`, `--user-agent`,
`--obey-robots`, `--storage-dir`, `--allow-private-network`, `--v8-flags`, `-v`, `-q`.

### 1.2 MCP tool surface (`crates/obscura-mcp/src/lib.rs`, `docs/Use-the-MCP-server.md`)

37 unique `browser_*` tools advertised over `tools/list`; server keeps one live
session — tools act on the current page, not a per-call URL.

- Navigation/lifecycle (5): `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`, `browser_close`.
- Read (12): `browser_snapshot`, `browser_markdown`, `browser_links`, `browser_extract`, `browser_interactive_elements`, `browser_detect_forms`, `browser_get_attribute`, `browser_count`, `browser_search`, `browser_console_messages`, `browser_network_requests`, `browser_wait_for`/`browser_wait_for_text` (waiters counted below).
- Interact (7): `browser_click`, `browser_fill`, `browser_fill_form`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_scroll`.
- Wait/JS (2): `browser_wait_for`, `browser_wait_for_text`; JS eval: `browser_evaluate`.
- Cookies/storage (5): `browser_get_cookies`, `browser_set_cookie`, `browser_clear_cookies`, `browser_storage_state`, `browser_set_storage_state`.
- Tabs (4): `browser_tab_new`, `browser_tab_list`, `browser_tab_switch`, `browser_tab_close`.
- Render-only, `cfg(feature = "render")` (2): `browser_screenshot` (`image/png` content block, bounded capture), `browser_pdf` (embedded `application/pdf` resource; raster-backed, text not selectable).

**Truth note:** `browser_search` is an in-page substring search over visible text
(`query`, `case_sensitive`, `limit`, `context_chars`). It is **not** public-web search.
Public-web search in Prism must come from a real provider (host search recipe, or the
Obscura CLI-backed adapter planned in Task 5).

Element references describe rendered state and go stale after navigation/interaction;
take a fresh `browser_snapshot` before acting.

### 1.3 CDP / Playwright (`docs/Connect-Puppeteer-or-Playwright.md`)

- Connect with Playwright `chromium.connectOverCDP(endpoint)` — **not** `connect`
  (Obscura does not implement Playwright's own protocol). Puppeteer: `puppeteer-core`
  `puppeteer.connect({ browserWSEndpoint })`.
- Supported: goto/reload/back/forward, evaluate(+Handle), click/type/fill/focus,
  waitForSelector/Function/Navigation, cookies, request interception, exposeFunction,
  content/title/url, viewport/full-page screenshot, raster PDF, raw CDP
  `Page.startScreencast` with frame acks (`context.newCDPSession(page)` in Playwright).
- DOM-agent support: `DOMSnapshot.captureSnapshot`, `Target.targetInfoChanged`, `DOM.focus`.
- `waitUntil` defaults `domcontentloaded`; `load`/`networkidle2`/`networkidle0` supported.

### 1.4 Limits, timeouts, env vars (`docs/Run-in-production-at-scale.md`, `docs/Environment-variables.md`)

- Pages in one worker share one V8 isolate; CPU-bound JS on one page can delay others.
- V8 heap default 4 GB (64-bit); young-gen `--max-semi-space-size=4`, `--optimize-for-size`;
  override with `--v8-flags` (user flag wins by last-value rule).
- Engine hardening: V8 watchdog on runaway scripts/microtask storms, panic-safe DOM ops,
  cyclic-DOM rejection, per-CDP-command budget termination, timeout-bounded scripted
  fetch/XHR and navigation.
- Env bounds: `OBSCURA_NAV_TIMEOUT_MS` (30 000), `OBSCURA_SCRIPT_DEADLINE_MS` (30 000),
  `OBSCURA_MODULE_BUDGET_MS` (3 000), `OBSCURA_CDP_COMMAND_TIMEOUT_MS` (60 000, `0`
  disables), `OBSCURA_FETCH_TIMEOUT_MS` (30 000). Others: `OBSCURA_MCP_ALLOWED_ORIGINS`,
  `OBSCURA_ALLOW_PRIVATE_NETWORK`, `OBSCURA_PROXY`, `OBSCURA_PROFILE`,
  `OBSCURA_ROTATE_PROFILE`, `OBSCURA_TIMEZONE`, `OBSCURA_GEOLOCATION`.
- Workers: `--workers N`, one per core, sticky sessions.
- MCP HTTP: 16 MiB request-body cap; `OBSCURA_MCP_ALLOWED_ORIGINS` origin allowlist
  (403 on unlisted browser origins; native clients send no `Origin` and pass).

### 1.5 Security posture

- **CDP and MCP HTTP have no built-in auth.** Anyone reaching the port drives the browser.
  Default binds are loopback (`serve --host 127.0.0.1`, `mcp --http` default `127.0.0.1`).
- Remote exposure requires reverse proxy with auth or network isolation;
  `0.0.0.0` on a public IP is explicitly warned against upstream.
- `--allow-private-network` (loopback/RFC1918/link-local egress) and
  `--allow-file-access` (file:// navigation) are opt-in and must stay off by default.
- Docker: `h4ckf0r0day/obscura`, default CMD `serve`; `docker run --rm -i ... mcp` for
  stdio MCP; resource caps via `--memory`/`--cpus`.

### 1.6 Reproduce upstream facts

```bash
git clone https://github.com/h4ckf0r0day/obscura
cd obscura && git checkout f449e6fb3183138eb3e80f11fe44af31cefe0fae
grep -o '"browser_[a-z_]*"' crates/obscura-mcp/src/lib.rs | sort -u   # tool list
```

## 2. Prism primitive inventory (what already exists)

| Primitive | Location | Reuse verdict |
| --- | --- | --- |
| `connectMcpTools` (stdio + Streamable HTTP transports, bounds, refresh, abort, `namePrefix`) | `packages/mcp/src/bridge.ts:47-77`, `packages/mcp/src/transport.ts:10-34`, `packages/mcp/src/types.ts:22-29` | **Reuse directly.** Obscura MCP bridging is transport config + effect annotation only. |
| `McpStdioTransport` (`command`/`args`/`env`/`cwd`/`stderr`, shell-free spawn) | `packages/mcp/src/types.ts:22-29` | **Reuse.** Docker argv (`docker run --rm -i … mcp`) passes through unchanged. |
| Effect-classification precedent (read vs exclusive external mutation, mutation queue) | `packages/computer-use-linux/src/create.ts:55-121` | **Reuse pattern**, not code: obscura needs its own classification table (different tool names), same conservative default. |
| `createBrowserManager` / `createBrowserTools` over host-supplied Playwright `Browser` | `packages/browser/src/manager.ts`, `packages/browser/src/index.ts` | **Reuse.** Obscura's `connectOverCDP` browser is exactly the "host-supplied browser" seam. |
| `classifyBrowserUrl` / `classifyHost` / `BrowserNetworkPolicy` (scheme, userinfo, loopback/private/link-local/ULA, `allowLoopback`/`allowPrivateHosts` defaults off) | `packages/browser/src/network.ts:57-122`, exported `packages/browser/src/index.ts:120-132` | **Reuse** for CDP/WebSocket endpoint validation and web-tool URL policy. |
| `createWebTools` + `WebSearchProvider`/fetch/extract seams, `canonicalUrl`, `citation`, `DEFAULT_WEB_LIMITS` | `packages/web-tools/src/tools.ts:5-37`, `packages/web-tools/src/index.ts` | **Reuse.** Obscura CLI adapters plug in as a provider/fetch implementation. |
| `createCliRunner`, `assertSafeArgv`, `collectOutput`, bounded JSON parsers | `packages/work-tools/src/cli.ts:24-34,154-343` | **Pattern only.** Hardwired to `WorkLimits` (pagination/attachment keys) and a mandatory absolute `configDir`; wrong dependency direction and wrong limits for obscura. Mirror the techniques (argv null-check, capped single-concat output collector, minimal `baseEnv`) in a small private obscura runner. |
| Owned child-process lifecycle precedents (spawn + abort + kill, init handshake, unexpected-exit rejection) | `packages/coding-agent/src/language/client.ts:229-295` (LSP), `packages/coding-agent/src/shell.ts`, `packages/coding-security/src/docker-cli.ts` | **Pattern only**; each is protocol-specific. No generic exportable process primitive exists — confirming plan 039's decision to keep a minimal private lifecycle in `packages/obscura`. |
| Tool effect/`ToolResult`/artifact/redaction conventions, run limits | core `@arnilo/prism` (`ToolDefinition`, `ToolExecutionContext`, effect metadata) | **Reuse.** |
| Host composition (every host already accepts generic `ToolDefinition[]`; MCP server dispatch, AG-UI/ACP tool selection, delegated exposure) | `packages/mcp/src/server.ts:40-339`, `packages/ag-ui/src/mcp.ts:40-91`, `packages/antigravity-agent/src/mcp.ts:37-160` | **Reuse.** No host branch needed (verified again in §3). |

## 3. Gap analysis

**Already achievable with existing primitives:** MCP bridging (any transport),
browser composition over a `connectOverCDP` Playwright browser, URL/host egress
classification, web-tool result normalization, host composition. Zero host-code or
core-code changes are required for Obscura tools to flow through every host.

**Gaps that the new package must fill (all private to `@arnilo/prism-obscura`):**

1. Owned-process lifecycle for `obscura serve` / `obscura mcp` stdio when the package
   owns the process (readiness proven by protocol connect, not log parsing; ownership-
   aware close). MCP's `StdioClientTransport` covers the pure-stdio MCP case; the gap
   is only the managed CDP server and shared command validation.
2. Known-tool effect classification table for Obscura's 37 tool names with a
   conservative unknown-tool default (exclusive external mutation).
3. Bounded CLI argv runner for `fetch`/`scrape` + search-profile extraction (no new
   dependency; mirror work-tools techniques).
4. Optional Playwright connection helper (`connectOverCDP` with retry/abort/deadline)
   and Prism browser composition.

**Explicitly rejected:** reimplementing MCP/CDP protocols; static tool allow-list
(hides future upstream tools); Puppeteer support; Docker SDK; adding `prism-all`
inclusion while the binary/image is not supplied by installation.

## 4. Test fixtures derivable from this matrix

- Fake MCP server advertising the 37 tools (render-disabled fixture) plus a
  render-enabled variant adding `browser_screenshot`/`browser_pdf`.
- Fake Playwright exposing only `connectOverCDP` (asserts `connect`/launch never called).
- Fake `obscura` executable script for CLI-runner argv/output/abort tests; opt-in
  `PRISM_LIVE_OBSCURA=1` live leg pinned to the revision above.
## 5. Task 7 final verification matrix (2026-08-29)

| Gate | Result |
| --- | --- |
| Obscura package suite | 55 tests: 54 pass, 1 protected live skip (uninformed default), 0 fail |
| Host conformance (`scripts/obscura-host-conformance.test.mjs`) | 9/9 pass, wired into `npm test` |
| Full `npm test` | green across core + every workspace suite (freezes/truth/gates included), 0 fail |
| typecheck / lint / format | clean (root + examples) |
| Coverage | core gate 60/70/75 green; `@arnilo/prism-obscura` lines 94.61 / branches 86.36 / functions 90.28 vs its evidence threshold; `coverage-summary.json` belowThreshold empty |
| Threat suites (`security:threat-suites`) | 59/59 pass |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| Package truth / install smoke / compat baseline | green (obscura baseline: 40 public declarations, no test leakage) |
| Deterministic pack | 60 tarballs; two full `pack:dry-run` runs byte-identical; obscura tarball 34.4 kB / 16 files, excludes tests/maps/sources/binaries |
| `release:gate` | blocked only by the pre-existing protected `PRISM_TEST_POSTGRES_URL` leg (missing prerequisite fails loudly, never a passing skip); obscura surface `pass`, no new blocked names |
| Startup/search/close medians vs ceilings | 0.02/0.01/0.02 ms vs 250; 19.6–21.1 ms vs 100; 0.5–0.6 ms vs 250 (`node scripts/benchmark-obscura.mjs`, 3 runs × 3, artifact `scripts/benchmark-obscura.json`) |
| Concurrent-caps / abort-storm evidence | behavioral: mutation serialization presents one live page; abort legs settle in-flight calls and kill owned children (host conformance abort test; process/web timeout+abort tests) — no leak committed to a timing gate |
| Enabled-but-missing live leg fails loudly | `PRISM_LIVE_OBSCURA=1` without `PRISM_OBSCURA_BIN` throws (never silent pass); unset env keeps the skip |
| Protected live legs blocked evidence | no Obscura binary/credentials on this machine: Docker/binary/Playwright legs remain named protected rows with `PRISM_LIVE_OBSCURA` requiredEnv in `scripts/release-skip-manifest.mjs` and the optional leg in `.github/workflows/sandbox-browser.yml`; missing prerequisites never degrade to pass |
