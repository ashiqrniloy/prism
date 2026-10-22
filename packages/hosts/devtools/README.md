# @arnilo/prism-devtools

A loopback developer inspector over one Prism `Agent`. It reads the agent's own surface, `inspect()`,
`sessions`, `session.entries()`, and `subscribe()`, and serves it as a page and a small JSON API. It
starts no run, builds no agent, and imports only the public `@arnilo/prism` surface
([allow-list](../../../scripts/host-surface-allowlist.json)).

## Use

```ts
import { createAgent } from "@arnilo/prism";
import { serveDevtools } from "@arnilo/prism-devtools";

const agent = await createAgent({ model, packages });
const devtools = serveDevtools(agent, {
  port: 4311,
  // Optional host/origin overrides (defaults to bound loopback pairs):
  // allowedHosts: ["127.0.0.1:4311", "localhost:4311", "[::1]:4311"],
  // allowedOrigins: ["http://127.0.0.1:4311", "http://localhost:4311", "http://[::1]:4311"],
});
console.log(devtools.url); // http://127.0.0.1:4311
```

`serveDevtools` is synchronous and returns `{ url, hostname, port, close() }`. `close()` ends the live
event streams and the listener.

The `prism-devtools` bin serves a manifest-built agent:

```bash
prism-devtools --model anthropic/claude-sonnet-4-5 --root . [--trust-project] [--port 4311]
```

`--model` is `provider/model`. The project scope loads only with `--trust-project` (roadmap §2.7). The
bin binds loopback only; a remote bind is a programmatic `serveDevtools(agent, { hostname, token })` call.

## Routes

| Route | Answers with |
| --- | --- |
| `GET /` | the page (strict CSP; no inline script) |
| `GET /api/inspect` | `agent.inspect()`, redacted |
| `GET /api/sessions?limit&cursor` | `agent.sessions.list()`, one page (`limit` 1–200) |
| `GET /api/sessions/:id` | `agent.sessions.get(id)`, or 404 |
| `GET /api/sessions/:id/entries` | `session.entries()` for the stored session, or 404 |
| `GET /api/replay?session&cursor&limit` | one page of the session's stored entries (`limit` 1–500); starts no run |
| `GET /api/events?session=` | server-sent events: `agent` for `agent.subscribe()`, and `session` for the session's `subscribe()` |
| `POST /api/compare` | `{ left, right }` metadata compared: winners and the invariant block |

Unknown sessions answer 404 with `ERR_PRISM_DEVTOOLS_NOT_FOUND`. A malformed query answers 400 with
`ERR_PRISM_DEVTOOLS_QUERY`. Errors never carry an internal message.

## What is not here

- **No prompt, decision, or run routes.** The inspector observes; it does not drive a run or resolve an
  approval. Those belong to the host that owns the session.
- **No timeline panel.** The page renders raw entries and events. The timeline projector stays in
  the 0.12 family package until Phase 16 moves it to `@arnilo/prism-observability`.
- **The session feed sees its own session object.** A `Session`'s subscribers belong to the instance that
  emitted the events. The `?session=` feed follows the `Session` the route opened (`acrossRuns: true`), so a
  run driven through a different instance of the same id is not visible through the public API. The agent
  feed still carries `session.opened` and `session.closed`. A cross-instance session feed is a kernel
  change, not a host one.
- **A session with no entries is not stored**, so it has no entries to replay and no stream route for it
  until it has run once.

## Security

- **Loopback by default.** `hostname` defaults to `127.0.0.1`. Any non-loopback `hostname` throws
  `ERR_PRISM_DEVTOOLS_REMOTE_BIND` unless `token` is set, before a listener exists.
- **Host and Origin gate.** Every route validates the `Host` and `Origin` headers. By default, only bound loopback addresses (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`) and loopback origins are allowed, blocking DNS-rebinding attacks from browser pages against loopback inspectors. Mismatched `Host` headers return 403 `ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST`, and untrusted `Origin` headers return 403 `ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN`. `ServeDevtoolsOptions.allowedHosts` and `allowedOrigins` override the defaults for custom network topologies.
- **Tokens are refs.** `token` takes `env:NAME`, read from the environment at serve time. A literal token
  throws `ERR_PRISM_DEVTOOLS_TOKEN_LITERAL`, and an unset ref throws `ERR_PRISM_DEVTOOLS_TOKEN_UNSET`.
- **Every route is guarded when a token is set**, the page included. The header is `Authorization: Bearer
  <token>`, compared in constant time. A browser cannot send that header from the page, so a token-guarded
  server is for programmatic clients; the page is for loopback use.
- **Redacted output.** Every JSON body and every SSE event passes the agent's redactor on the way out. A
  secret the agent holds is not in any route's body; `devtools_entries_redacted` asserts this.

## Bounds

- Replay pages are at most 500 entries; the page shows 100 at a time.
- The live feed keeps the newest 500 rows on screen. Each subscription uses the agent's bounded queue
  (`SubscribeOptions.maxQueuedEvents`, default 1024).
- The browser module is transpiled once per process and cached. The package ships source, so there is no
  build step and no `dist/`.

## Tests

`bun test src` from this package covers the routes, the redaction, the token and loopback rules, the
replay paging, the bin serving a manifest-built agent, and the host-surface scan.
