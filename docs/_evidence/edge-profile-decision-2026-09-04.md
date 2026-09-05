# Edge/browser profile decision — plan 062 (2026-09-04)

**Decision: rejected for now.** No edge/worker subpath ships in 0.5.x. Revisit trigger: a concrete host/user request for browser or workerd targets (per plan 062 §7 P1 bullet 3, defer-unless-demand).

## Evidence: dependency inventory (workspace scan, 2026-09-04)

### 1. Native addons in the core dependency chain (hard blockers)

`@arnilo/prism-core` depends on two native addons that cannot execute in edge/workerd/browser runtimes and have no polyfill path:

- `better-sqlite3` — sessions SQLite persistence (`src/sessions/sqlite/*`), prompt-store SQLite (`src/governance/prompts/sqlite.ts`)
- `@napi-rs/keyring` — OS keychain credential store (`src/credentials/node/keychain-store.ts`)

These are not leaf niceties: they sit on the durability and credential seams the framework's documented story is built on. An edge profile would need host-supplied replacements for both seams, not a filtered export map.

### 2. Node built-ins across the core barrel (not a subpath-shaped problem)

Files importing `node:*` built-ins (non-test):

| Package | Files with `node:` imports |
| --- | --- |
| `@arnilo/prism` (root, core loop) | 26 — including `retry.ts`, `content.ts`, `ids.ts`, `pinned-fetch.ts`, `tool-effects.ts`, `agent-run-state.ts`, `agent-approval.ts`, `providers/media.ts` |
| `@arnilo/prism-core` | 43 |
| `@arnilo/prism-coding-tools` | 58 |
| `@arnilo/prism-providers` | 6 — `ai-sdk/provider.ts`, `bedrock/sigv4.ts` (crypto), `openai/oauth.ts`, `openai/realtime.ts`, `model-discovery/index.ts` |

The root barrel itself is not edge-clean: core loop files (retry/backoff, content, id generation, pinned fetch, tool effects) import `node:` built-ins. An edge profile is therefore a parallel build graph with seam-by-seam extraction, not an `exports`-map condition.

### 3. Node-only dependencies are load-bearing on runtime seams

- `pg` (core, memory): Postgres run ledgers — durability story
- `@nats-io/transport-node` / `@nats-io/jetstream` (core): event backbone
- `@modelcontextprotocol/sdk` (mcp), `playwright-core` (office, web-tools), `mammoth`/`pdf-parse` (coding-tools), `@office-open/*`, `diff`, `@nanonets/graft` (memory)

Even the most edge-plausible package, `@arnilo/prism-providers` (pure fetch transport in most adapters), carries `node:crypto` in the Bedrock SigV4 signer and `node:*` in the OpenAI OAuth/Realtime seams — and the plan 062 discovery/cost adapters deliberately delegate egress + credentials to the host, which on edge means re-providing those seams per runtime.

### 4. Demand signal

None observed. No host, issue, or integration request targets browser/worker execution. The framework's positioning (agents with durable sessions, ledgers, tool effects, and OS-integrated coding tools) is server-side by construction.

## Options considered

1. **Full edge subpath now** — rejected: high cost (parallel build graph, seam extraction across ~130 `node:`-importing files, native-addon replacements), unproven demand.
2. **Reject with rationale, defer until demand** — chosen.
3. **Half-built edge subpath** (some packages edge-tagged) — rejected explicitly by the task: lands misleading artifacts; a package that imports the core barrel is only as edge-clean as its worst transitive import.

## Revisit trigger

Re-evaluate when **both** hold:
1. A concrete user/host request for browser or workerd targets (not speculative), and
2. The root core loop (`retry.ts`, `content.ts`, `ids.ts`, `pinned-fetch.ts`, `tool-effects.ts`) is `node:`-free or its seams are host-injectable, so a subpath is a build-config change rather than a porting project.

## Companion work that keeps the door open (no action now)

Keeping provider adapters on plain `fetch` (they already are, minus sigv4/oauth/realtime) and routing new seams through injected transports (`options.fetch`, credential resolvers) preserves the option value of a future edge profile without paying for it today.
