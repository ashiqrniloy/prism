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

## Today

- Integration packages (`packages/integrations/*`): `mcp` (client: `bridge.ts`, `auth.ts`, transports, elicitation, connected apps; project servers trust-gated through `host.ui`), `hooks-json` (`.agents/hooks.json` compiled onto the hook bus: `compile.ts`, `handlers/`, `matchers.ts`), `workflows` (graph engine, `agentNode`/`functionNode`/gates/fan-out, checkpoints and leases), `delegate` (sub-agents as a tool), `observability` (OpenTelemetry instrumentation and the timeline).
- Host libraries (`packages/hosts/*`): `acp` (`serveAcp`), `ag-ui`, `mcp-server` (`serve`, `serveTools`), `channels` (messaging channels and pairing), `evals`, `devtools` (local inspector), `remote` (`serveAgent`/`connectAgent`), `headless` (pending answers, resume, scheduler).
- Driver: `packages/drivers/process` (`prism-driver-process`, the generic external-agent driver) over the kernel driver kit (`src/driver-kit/`).
- In flight: plan 191 (release path step 7) changes the `delegate` config and result contract.
- Current docs: [hooks.md](../../../../docs/hooks.md), [drivers.md](../../../../docs/drivers.md); integration packages [`mcp`](../../../../packages/integrations/mcp/README.md), [`hooks-json`](../../../../packages/integrations/hooks-json/README.md), [`workflows`](../../../../packages/integrations/workflows/README.md), [`delegate`](../../../../packages/integrations/delegate/README.md), [`observability`](../../../../packages/integrations/observability/README.md); host libraries [`acp`](../../../../packages/hosts/acp/README.md), [`ag-ui`](../../../../packages/hosts/ag-ui/README.md), [`mcp-server`](../../../../packages/hosts/mcp-server/README.md), [`channels`](../../../../packages/hosts/channels/README.md), [`evals`](../../../../packages/hosts/evals/README.md), [`devtools`](../../../../packages/hosts/devtools/README.md), [`remote`](../../../../packages/hosts/remote/README.md), [`headless`](../../../../packages/hosts/headless/README.md).

## Graft queries

- `graft ask "acp capability advertisement permission request" --source`
- `graft ask "mcp client connect trust reconnect status" --source --in packages/integrations/mcp/`
- `graft ask "hooks json compile command handler decision" --source`
- `graft callers serveAcp --depth all`

## Tests

- `packages/integrations/<name>/src/__tests__/`, `packages/hosts/<name>/src/__tests__/`, `packages/drivers/process/src/__tests__/` (run from each package directory)
- Driver conformance: `@arnilo/prism/testing` `driverConformance`; the three reference adapters run in `release:gate` through `examples/adapters/conformance.ts`

## Rules

- A host library never constructs an agent outside `createAgent` and never imports kernel internals.
- Never persist ACP modes or config from the agent side. That seam is host-owned and ownership-scoped.
- Never widen protocol payloads beyond their frozen caps (rich parts, replay chunks, titles).
- An untrusted MCP server never spawns. A header ref is never echoed in status or errors.
- `serve` and `connect` are explicit host calls. `createAgent` opens no socket.
