# Open Connector sidecar (example only)

[Open Connector](https://github.com/oomol-lab/open-connector) (OpenConnector, `oomol-lab`) is an
open-source connector gateway in front of 1,000+ providers. This directory shows how a Prism host can
use it **as a sibling process over MCP** without Prism depending on it.

Out of core, by design: no workspace package depends on `@oomol-lab/open-connector` or `oomol`, no OC
source is vendored, and no OC catalog entry becomes a first-class Prism tool. A 12th publishable
package was rejected; this is a recipe plus a network-free mock.

- `docker-compose.yml` — operator recipe (loopback, pinned tag). CI never pulls it.
- [`../open-connector-sidecar.ts`](../open-connector-sidecar.ts) — network-free `demo()` that mocks the
  five MCP tools and exercises Prism admission, allowlisting, and effect classification.

## Run the sidecar

```bash
cd examples/open-connector-sidecar
export OOMOL_CONNECT_ENCRYPTION_KEY=$(openssl rand -base64 32)
export OOMOL_CONNECT_ADMIN_TOKEN=$(openssl rand -base64 32)
export OOMOL_CONNECT_RUNTIME_TOKEN=$(openssl rand -base64 32)
OPEN_CONNECTOR_VERSION=<release-tag> docker compose up
```

Then connect provider accounts in the console at `http://127.0.0.1:3000`.

- **Pin an immutable release tag.** Do not track `main` (`tip`) and do not deploy `latest`; both move
  without review. Use the same tag for the image and every `migrate` run.
- The runtime listens on port `3000`, keeps state in `/app/data`, and exposes MCP at
  `http://127.0.0.1:3000/mcp` — stateless JSON-RPC `POST`, no long-lived SSE stream.
- Keep the published port on loopback. The compose file binds `127.0.0.1`; Prism only admits
  loopback plaintext through `allowLoopbackHttp` and still checks a pinned DNS answer.
- Every caller sends `Authorization: Bearer <runtime-token>`; the token is host input, never model
  input.

## Wire it into Prism

```ts
import { createConnectedAppSession } from "@arnilo/prism-mcp";

const origin = "http://127.0.0.1:3000";
const apps = createConnectedAppSession({
  identity, // verified, one per end user / tenant
  select: ({ transport }) =>
    transport.type === "streamable-http" &&
    transport.allowLoopbackHttp === true &&
    transport.allowedOrigins.includes(origin),
  // Reads are observations. `execute_action` is deliberately left unclassified.
  effect: ({ remoteName }) => (remoteName === "execute_action" ? undefined : { kind: "none", idempotency: "none" }),
});
await apps.bind({
  appId: "open-connector",
  serverId: "oc",
  transport: {
    type: "streamable-http",
    url: `${origin}/mcp`,
    allowedOrigins: [origin],
    allowLoopbackHttp: true,
    requestInit: { headers: { authorization: `Bearer ${process.env.OOMOL_CONNECT_RUNTIME_TOKEN}` } },
  },
  allowTools: ["search_actions", "get_action_guide", "execute_action"],
});
```

`allowTools` is required in practice: without it the bridge exposes everything the sidecar lists.

## Tool surface and effects

| MCP tool | Purpose | Prism effect |
| --- | --- | --- |
| `list_apps` | provider names/default connection identity | `none` if allowlisted |
| `list_connections` | connected accounts (safe labels only) | `none` if allowlisted |
| `search_actions` | search hosted Action contracts | `none` |
| `get_action_guide` | request/response schema + scopes guide | `none` |
| `execute_action` | run an Action against a connection | **`external_mutation` / `unsupported` (unclassified)** |

Prism never reads effect hints from remote tool descriptions; anything the host does not classify
stays `external_mutation` with `idempotency: "unsupported"`, which blocks automatic retry.

## Writes, idempotency, and identity

- MCP `execute_action` **does not accept an `Idempotency-Key`**. For retry-safe writes, call the HTTP
  runtime API directly — `POST /v1/actions/:actionId` with an `Idempotency-Key` header — from host
  code, or keep the write behind Prism's draft/approve lifecycle (see [work tools](../../docs/work-tools.md)).
- **Prism identity ↔ Open Connector connection mapping is host glue.** OC identifies connections by
  opaque id or alias (`connectionName`, `x-oo-connector-alias`); it has no Prism identity concept.
  Resolve the alias from the verified `AgentIdentity` in host code before the tool call, and issue
  one runtime token (or runtime-token policy) per tenant/end user — never share a token across
  identities.
- Do not put the provider catalog on the model. `search_actions`/`get_action_guide` give the model
  contract text for admitted actions only; the 1,000+ provider (1,511 at the time of writing) index
  plus `list_apps`/`list_connections` stay host-side or allowlist-gated. Narrow the runtime too with
  `OOMOL_CONNECT_ALLOWED_ACTIONS`.

## Security warnings

- **`skipDnsValidation` is incompatible with Prism's `pinnedFetch`.** Some OC provider executors set
  `skipDnsValidation: true` for their own egress; OC's provider-proxy path
  (`OOMOL_CONNECT_ALLOWED_PROXIES`, `allowedProxies`) is likewise OC-internal. Do not wrap that path
  in Prism's `pinnedFetch`-based HTTP clients (or the work HTTP adapters) and expect proxy parity:
  Prism pins one validated DNS answer and rejects redirects, while `skipDnsValidation` accepts any
  answer. Reach OC only through MCP, and let OC own its provider egress.
- Treat the sidecar as untrusted input: bound responses (`maxResponseBytes`), keep `allowTools` exact,
  and never let the model choose the transport, URL, origin, or token.
- The sidecar stores provider credentials. Back up `OOMOL_CONNECT_ENCRYPTION_KEY`; losing it makes
  `/app/data` unrecoverable.

## Verify without the sidecar

```bash
npx tsc -p examples --noEmit
node --experimental-strip-types examples/open-connector-sidecar.ts
```

The demo prints the exposed tool names, `execute_action`'s effect/idempotency, and proof that a
`select` policy which does not admit the loopback origin refuses the bind. No network, no container.
