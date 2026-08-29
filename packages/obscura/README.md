# @arnilo/prism-obscura

Optional [Prism](https://github.com/ashiqrniloy/prism) support for a host-installed
[Obscura](https://github.com/h4ckf0r0day/obscura) headless browser. Obscura is never
bundled — install the binary (or use the `h4ckf0r0day/obscura` Docker image) yourself,
then point this package at it.

## Install

```bash
npm install @arnilo/prism-obscura
```

## Process lifecycle

`spawnObscuraProcess` runs a shell-free, bounded, ownership-tracked Obscura process
(the `obscura` binary, a Docker invocation, or any argv). Configuration is validated
fail-closed: absolute NUL-free command, bounded argv/env, and insecure flags
(`--allow-private-network`, `--allow-file-access`, non-loopback `--host`) are rejected
unless `allowInsecureFlags` is set explicitly.

```ts
import { spawnObscuraProcess } from "@arnilo/prism-obscura";

const obscura = spawnObscuraProcess({
  command: "/usr/local/bin/obscura",
  args: ["serve", "--host", "127.0.0.1", "--port", "9222"],
});

// Readiness is bounded and proven by a probe you supply (protocol connect, not log parsing).
await obscura.waitReady(() => canConnect("ws://127.0.0.1:9222"));
await obscura.close(); // SIGTERM → SIGKILL after grace period; process-group kill on POSIX
```

Docker works through the same seam — no Docker SDK:

```ts
const mcp = spawnObscuraProcess({
  command: "/usr/bin/docker",
  args: ["run", "--rm", "-i", "h4ckf0r0day/obscura", "mcp"],
});
```

Guarantees:

- Shell-free spawn; argv passed byte-for-byte.
- Minimal environment (`PATH`, `HOME`) unless an explicit `env` is provided.
- Capped stderr capture for post-mortem diagnostics; errors never echo argv or env values.
- `close()` is idempotent and kills only resources the package owns; external endpoints
  are never terminated.
- Abort signals kill owned processes immediately.

MCP tool bridging, CDP/Playwright composition, and CLI-backed web tools land in
subsequent releases (see `plans/039-Obscura-Full-Host-Support-And-Changed-Package-Release.md`).

## Web search, fetch, and scrape

`createObscuraWebTools` builds bounded CLI-backed web tools: standard
`web_search`/`web_fetch` (one replaceable HTML search profile, constant extraction
JavaScript, URL-encoded queries only) plus explicit `obscura_fetch`/`obscura_scrape`
for native dump modes and batch scrape with Obscura-enforced concurrency. Custom
scrape expressions and insecure flags are explicit opt-ins; every URL is validated
as a public HTTP(S) target before a child process starts, and all output is labeled
untrusted external content.

```ts
import { createObscuraWebTools } from "@arnilo/prism-obscura";

const web = createObscuraWebTools({ command: "/usr/local/bin/obscura" });
```

## CDP and Playwright

`connectObscuraCdp` spawns `obscura serve` (or attaches to an external endpoint) and
connects with the host's Playwright through `chromium.connectOverCDP` — never
`connect()`, never a browser launch.

```ts
import { connectObscuraCdp } from "@arnilo/prism-obscura";
import { createBrowserTools } from "@arnilo/prism-browser";

const session = await connectObscuraCdp({
  command: "/usr/local/bin/obscura",
  args: ["serve", "--host", "127.0.0.1", "--port", "9222"],
});
const tools = createBrowserTools({ browser: session.browser });
await session.close(); // browser first, then the owned process
```

Endpoints are loopback-only unless `allowRemoteEndpoint` is set, credentials in the
URL are always rejected, and remote plain `ws:`/`http:` is refused (Obscura CDP has
no authentication — use an authenticated tunnel). Raw CDP (screenshots, PDF,
screencast) stays available through Playwright's CDP session APIs. See
[docs/obscura.md](https://github.com/ashiqrniloy/prism/blob/main/docs/obscura.md).

## Security

Obscura's CDP and MCP HTTP endpoints have no built-in authentication. This package
binds or connects to loopback by default and refuses non-loopback binds without
explicit opt-in. For remote deployments, put Obscura behind an authenticating proxy
or network isolation.