# @arnilo/prism-dev

Loopback-only **dev inspector** for an already-configured Prism agent — `prism dev`'s engine (CLI composition lands with plan 040 Task 4). Peer range: `@arnilo/prism` `^0.3.0`.

## Boundary: composition, not runtime

This package is a **composition-only consumer**. It adds **zero core primitives** and imports **no core internals** (`src/`); every capability is an existing public seam consumed verbatim, exactly like `@arnilo/prism-acp-agent` mirrors the ACP packaging precedent. It is a thin packaging of already-public contracts — no hosted service, no second protocol, no new runtime behavior in Prism.

### Seams consumed (exact public exports)

| Seam | Exports consumed | Role in the inspector |
| --- | --- | --- |
| `@arnilo/prism-server` | `createPrismHandler`, `createPrismAgentEventReplay`, `PrismAgentExposure`, `PrismAgentEventResolutionInput`, `PrismRequestHandler`, `PrismServerError`, `PrismServerAuthorizer`, `PrismServerAuthorization`, `PrismServerLimits` | Direct `POST …/runs` + SSE `POST …/stream` agent routes, authorization, ownership propagation, bounded SSE, `Last-Event-ID` durable event route when an exposure carries `events` + `resolveRun`, and the paged replay adapter. |
| `@arnilo/prism` (peer) | `AgentEventSource` contract (`page`/`subscribe`/`append`/`cleanup`), `Agent`, `AgentRunRef`, `SecretRedactor`, `createAgentRunLifecycle`, `CheckpointStore`, `assertIdentityActive`, `assertIdentityMatchesOwnership`, `isLoopbackAddress`, `isLoopbackHostname` | Durable replay/reconnect contract; run-identity and redaction types; the lifecycle seam composed over the host's own checkpoint store; the loopback bind guards. |
| `@arnilo/prism-ag-ui` (peer) | `@arnilo/prism-ag-ui/renderer` subpath (`createA2UiRenderer`, `reduceA2UiOps`, …) | Event projection for the served UI page (plan 040 Task 3). |
| Run ledger (via host) | `RunLedger`, `RunRecord`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord` | Touched only indirectly: the host configures ledger/event-source on its agent; the inspector renders what the server seams surface. The package never opens a ledger. |
| Pending decisions (via server) | `PendingDecision`/`RunDecision` types, `agent.resume` route over `createAgentRunLifecycle` (`agentRuns` exposure) | HITL resume reuses the server's fail-closed decision validation; the inspector adds none (plan 040 Task 2). |

## Loopback policy

- Default bind: `127.0.0.1:4311`. `createPrismDevInspector` **fails closed** on a non-loopback `host`.
- A non-loopback bind requires **both**: an explicit `remoteAuthorize` callback that resolves `true` (consulted by `listen()`), and a real `authorize` callback — the single-local-user default is loopback-only.
- The inspector stores no secrets and never reads credentials: host agent config owns credentials; a `redactor` may be passed through to the server handler so rendered tool args/results are host-redacted.
- Authorization default for loopback: one synthetic local user (`local`); no request JSON can widen ownership (enforced by the server seam).

## Usage

```ts
import { createPrismDevInspector } from "@arnilo/prism-dev";

const inspector = createPrismDevInspector({
  agent, // host-built agent (mock or provider-backed)
  eventSource, // optional durable AgentEventSource for replay
  host: "127.0.0.1",
  port: 4311,
});
await inspector.listen(); // serves the agent routes over loopback only
```

Per-task surface (plan 040): Task 1 wires agent routes + bind policy; Task 2 (shipped) adds the HTTP surface below; Task 3 (shipped) serves the static UI page (`/` + `/assets/inspector.js` + `/config`) with a strict CSP and windowed 1k-event timeline; Task 4 (shipped) adds the `prism-dev` bin (`runDevCli`) behind `prism dev` delegation, booted against the `prism init` scaffold contract (`dist/agent.js` → `createAppAgent()`; scaffold `package.json` gains `"dev": "prism dev"`); Task 5 (shipped) ships the release cut — independent `0.0.1`, umbrella-omitted, dev-inspector leg in `security:threat-suites`, publish dry-run evidence (`scripts/phase40-release-dry-run.mjs` → `docs/_evidence/phase40-dev-inspector-publish-dry-run.json`).

## HTTP surface (plan 040 Task 2)

Data-defined routes over the server seam (`POST /prompt`, `GET /events?runId=…` with `Last-Event-ID` reconnect, `GET /runs/:id/replay?cursor=…` paged durable replay without re-execution, `POST /runs/:runId/decisions/:decisionId` with `{ outcome, expectedVersion? }` fail-closed HITL resume). Full details in `docs/dev-inspector.md`. Unmatched requests forward unchanged to the raw `/{basePath}/*` server surface, whose status/resume routes require wiring the host's `checkpoints` option.

## Status: dev-only, omitted from umbrellas

Deliberately **not** included in `@arnilo/prism-all`/profile packages: this is a developer-time surface, not a production dependency. It publishes independently at `0.0.1` (validated by `validateReleaseIndependent` / `satisfiesInternalRange` in `scripts/release.mjs`).