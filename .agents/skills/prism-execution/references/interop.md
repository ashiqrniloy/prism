# Interop — integration packages and host libraries

This reference covers two groups:

- **Integration packages:** `mcp` (client), `hooks-json`, `workflows`, `delegate`, `observability`.
- **Host libraries** (not packages): `acp`, `ag-ui`, `mcp-server`, `channels`, `evals`, `devtools`, plus the thin ACP binary.

## Target

- [roadmap.md](../../../../roadmap.md) §2.8 (surfaces are host libraries), §2.9 (integration rows and the host library table). `hooks-json` lands in Phase 2 as the first native package; the other integrations in Phase 9; host libraries in Phase 10.
- **`mcp`:**
  - transports: stdio, URL, or raw
  - `allow` stays fail-closed
  - a connect failure is status, never a failed `createAgent`
  - project server trust goes through `host.ui`, and with no answer the server stays disabled
  - header values are credential refs
  - status, reconnect, and close are exposed as commands and events
- **`workflows`** owns the `loop` slot and hosts `generate-validate-revise`. `approval` and other `tool.call` gates still apply to it.
- **`delegate`** creates sub-agents through `createAgent` with a chosen subset of packages.
- **Host libraries:**
  - `serveAcp(agent, …)`, `createAgUiHandler(agent)`, `serveMcp(agent, …)`, `connectTelegram(agent, …)`
  - each maps `HostUi` onto its protocol (ACP maps `confirm` to a permission request) and uses only the public API
  - `packages/acp-agent` becomes a thin binary over `serveAcp` plus a manifest

## Today (0.12 code being replaced)

- `packages/mcp/src/`: the client (`bridge.ts`, `auth.ts`, `transport.ts`) → `mcp`; the server (`server.ts`) → `mcp-server`.
- `packages/agent-sdk/src/planes/mcp.ts` and the lab's `packages/prism-code/src/mcp.ts` (the trust file) → `mcp` via `host.ui`.
- `packages/hooks/src/` → `hooks-json`.
- `packages/ag-ui/src/` (AG-UI mapper, `acp/`, `renderer/`), `packages/acp-agent/src/`, `packages/prism-code/src/acp.ts` → host libraries.
- `packages/prism-channels/src/` → `channels`.
- `packages/prism-core/src/runtime/{workflows,server,supervisor,realtime.ts}`, `src/delegated-agent-step.ts`, `packages/prism-core/src/governance/{observability,evals}`, and `packages/prism-coding-tools/src/dev` → `workflows`, host libraries, `delegate`, `observability`, `evals`, and `devtools`.
- Current docs (released contract): [mcp-tools.md](../../../../docs/mcp-tools.md), [hooks.md](../../../../docs/hooks.md), [acp.md](../../../../docs/acp.md), [ag-ui.md](../../../../docs/ag-ui.md), [a2a.md](../../../../docs/a2a.md), [messaging-channels.md](../../../../docs/messaging-channels.md), [workflows.md](../../../../docs/workflows.md), [multi-agent-patterns.md](../../../../docs/multi-agent-patterns.md), [supervisors.md](../../../../docs/supervisors.md), [server.md](../../../../docs/server.md), [observability.md](../../../../docs/observability.md), [evaluations.md](../../../../docs/evaluations.md), [dev-inspector.md](../../../../docs/dev-inspector.md).

## Graft queries

- `graft ask "acp capability advertisement permission request" --source`
- `graft ask "mcp plane connect timeout allow reconnect status" --source`
- `graft ask "hooks json compile guardrail stop hook instruction" --source`
- `graft callers createPrismAcpAgent --depth all`

## Tests

- `packages/mcp`, `packages/hooks`, `packages/ag-ui`, `packages/acp-agent`, `packages/prism-channels` suites (run from each workspace directory)
- `src/__tests__/rpc.test.ts`, `cli*.test.ts`, `delegated-agent-step.test.ts`

## Rules

- A host library never constructs an agent outside `createAgent` and never imports kernel internals.
- Never persist ACP modes or config from the agent side. That seam is host-owned and ownership-scoped.
- Never widen protocol payloads beyond their frozen caps (rich parts, replay chunks, titles).
- An untrusted MCP server never spawns. A header ref is never echoed in status or errors.
- `serve` and `connect` are explicit host calls. `createAgent` opens no socket.
