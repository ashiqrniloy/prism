# Obscura browser engine

Optional `@arnilo/prism-obscura` support for a host-installed
[Obscura](https://github.com/h4ckf0r0day/obscura) headless browser. Obscura is never
bundled — install the binary (or use the `h4ckf0r0day/obscura` Docker image) and point
the package at it.

- Capability evidence: `docs/_evidence/phase39-obscura-capability-matrix.md`
  (pinned to Obscura `0.1.0` @ `f449e6f`).

## Install

```bash
npm install @arnilo/prism-obscura
```

## Process lifecycle (`spawnObscuraProcess`)

Runs a shell-free, bounded, ownership-tracked Obscura process. Configuration is
validated fail-closed: absolute NUL-free command, bounded argv/env, minimal default
environment (`PATH`, `HOME`), and insecure flags (`--allow-private-network`,
`--allow-file-access`, non-loopback `--host`) rejected unless `allowInsecureFlags`
is set explicitly.

```ts
import { spawnObscuraProcess } from "@arnilo/prism-obscura";

const obscura = spawnObscuraProcess({
  command: "/usr/local/bin/obscura",
  args: ["serve", "--host", "127.0.0.1", "--port", "9222"],
});
await obscura.waitReady(() => canConnect("ws://127.0.0.1:9222"));
await obscura.close(); // SIGTERM → SIGKILL after grace; process-group kill on POSIX
```

Docker works through the same argv seam — no Docker SDK:

```ts
const mcp = spawnObscuraProcess({
  command: "/usr/bin/docker",
  args: ["run", "--rm", "-i", "h4ckf0r0day/obscura", "mcp"],
});
```

Guarantees: argv byte-for-byte; capped stderr capture; errors never echo argv/env;
`close()` idempotent and kills only owned resources; abort signals kill owned
processes immediately.

## MCP tools (`createObscuraMcpTools`)

Connects to `obscura mcp` (stdio or Streamable HTTP) through
[`@arnilo/prism-mcp`](mcp-tools.md) and exposes **every advertised tool** — no static
allow-list, so future Obscura tools keep flowing through.

```ts
import { createObscuraMcpTools } from "@arnilo/prism-obscura";

const obscura = await createObscuraMcpTools({
  transport: { type: "stdio", command: "/usr/local/bin/obscura", args: ["mcp"] },
});
agent.tools = [...agent.tools, ...obscura.tools];
await obscura.close();
```

- Tool inventory at the pinned revision: 37 `browser_*` tools; render-enabled builds
  add `browser_screenshot` and `browser_pdf`.
- **`browser_search` is in-page text search**, not public-web search.
- Effects: read/diagnostic/waiter/capture tools are effect-free; navigation,
  interaction, evaluation, cookie/storage writes, tabs, and any unknown future tool
  are exclusive, serialized external mutations (Obscura keeps one live page).
- Naming: default `obscura_` prefix coexists with `@arnilo/prism-browser`;
  `namePrefix: ""` preserves native Obscura names.
- Transports: stdio configs are validated with the same fail-closed command policy;
  Streamable HTTP endpoints outside loopback require explicit `allowRemoteHttp` and
  remain subject to `@arnilo/prism-mcp` origin/transport security.

## CDP and Playwright (`connectObscuraCdp`)

Attach to a running Obscura CDP endpoint — or spawn `obscura serve` and attach once
it is ready (bounded, abortable readiness; no fixed post-start sleep) — through the
host's Playwright via `chromium.connectOverCDP`. `connect()` and browser launch are
never used; Prism never launches browsers.

```ts
import { connectObscuraCdp } from "@arnilo/prism-obscura";
import { createBrowserTools } from "@arnilo/prism-browser";

const session = await connectObscuraCdp({
  command: "/usr/local/bin/obscura",
  args: ["serve", "--host", "127.0.0.1", "--port", "9222"],
});
const tools = createBrowserTools({ browser: session.browser, networkPolicy });
// ... run ...
await session.close(); // browser first, then the owned process
```

- External mode: pass `endpoint` (`ws://`/`http://`) with no `command` — the server
  stays alive after `close()`; only resources this call created are terminated.
- Endpoints are loopback-only unless `allowRemoteEndpoint` is set; credentials in the
  URL are always rejected; remote plain `ws:`/`http:` is refused (no authentication —
  require an authenticated `wss:`/`https:` tunnel).
- The Playwright import is an optional exact `playwright-core@1.61.0` peer; supply
  `connectObscuraCdp({ playwright })` to inject a host-selected build.
- The returned browser composes with `createBrowserManager`/`createBrowserTools`:
  snapshots, actions, policy, checkpoints, and artifacts are Prism-owned. Raw CDP
  (screenshots, PDF, screencast) stays available through Playwright's CDP session
  APIs (`browser.newBrowserCDPSession()`, `context.newCDPSession(page)`); the package
  adds no CDP command allow-list.
- Concurrency limit: pages served by one Obscura worker share one V8 isolate —
  CPU-bound page JavaScript can delay sibling pages. Keep `@arnilo/prism-browser`
  limits authoritative; size Obscura's `--workers` for the host.
- Screenshots/PDF require a render-enabled Obscura build and still obey the browser
  package's artifact/byte policy.

## Web search, fetch, and scrape (`createObscuraWebTools`)

Bounded CLI-backed web tools built on short-lived `obscura fetch`/`obscura scrape`
child processes. Returns standard Prism `web_search`/`web_fetch` tools plus explicit
`obscura_fetch`/`obscura_scrape` (disable with `nativeTools: false`).

```ts
import { createObscuraWebTools } from "@arnilo/prism-obscura";

const web = createObscuraWebTools({ command: "/usr/local/bin/obscura" });
agent.tools = [...agent.tools, ...web.tools];
```

- **Search truth**: `web_search` runs public-web search through one replaceable HTML
  search profile (default: DuckDuckGo HTML endpoint). The extraction JavaScript is a
  constant — the query travels only URL-encoded inside the search URL, never inside
  evaluated source. Supply `searchProfile` to swap engines. Obscura's native
  `browser_search` is in-page text search and is **not** exposed by this package.
- **web_search / web_fetch** return the same normalized untrusted shapes as
  [`@arnilo/prism-web-tools`](web-tools.md) (`provider: "obscura"`, citations,
  `untrusted: true`); content is labeled untrusted external content.
- **obscura_fetch**: one URL, bounded dump mode (`html|text|links|markdown|original`),
  optional CSS selector (1-256 chars). No evaluation, screenshots, output paths, file
  URLs, or private-network access.
- **obscura_scrape**: batch of public URLs (deduplicated, capped) with a constant
  default expression; Obscura enforces `--concurrency` itself. Custom expressions
  require explicit `allowEval: true` and stay byte-capped. Input association is
  preserved by index; missing rows surface as `{ url, error }` entries.
- **Bounds**: query/result/batch/concurrency/output/eval byte caps, per-run timeout,
  and child-process kill on timeout/abort (`DEFAULT_OBSCURA_WEB_LIMITS`,
  `HARD_OBSCURA_WEB_LIMITS`). Malformed JSON, oversized output, and nonzero exits
  fail closed with redacted diagnostics; nothing is retried.
- **URL policy**: every URL is validated as a public HTTP(S) target (private/
  loopback/metadata and credentialed URLs denied) before any child process starts.
- Docker-style invocations work through `argsBefore` (e.g.
  `["run", "--rm", "-i", "h4ckf0r0day/obscura"]`).
- An opt-in live smoke test runs against a real installed binary with
  `npm run test:live -w @arnilo/prism-obscura` plus `PRISM_LIVE_OBSCURA=1` and
  `PRISM_OBSCURA_BIN=/path/to/obscura`.

## Host conformance (one generic integration)

`scripts/obscura-host-conformance.test.mjs` runs one shared fake-Obscura fixture —
the same `ToolDefinition[]` with one read tool (`web_fetch`) and one mutating tool
(`obscura_scrape`) — through every Prism host's public API: core agent/session
execution, the Prism MCP server, the `createPrismHandler` server lifecycle, AG-UI
MCP-tool injection, ACP fronting, workflow `toolNode`/`agentNode`s, supervisor
children, and Antigravity delegated MCP exposure. It verifies host authorization
and selection deny before execution, that no host needs an Obscura-specific branch,
and that an aborted in-flight call settles and kills the owned child. Composition
walkthrough: [`examples/obscura.ts`](../examples/obscura.ts).

## Security

Obscura's CDP and MCP HTTP endpoints have no built-in authentication. This package
binds or connects to loopback by default. For remote deployments use an
authenticating reverse proxy or network isolation
(see [host security](host-security.md)).

CLI-backed web tools land in a subsequent release
(see `plans/039-Obscura-Full-Host-Support-And-Changed-Package-Release.md`).