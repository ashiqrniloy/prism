# Interop — ACP, AG-UI, A2A, MCP, server, CLI/RPC, workflows

External protocols, multi-agent patterns, server surface, CLI/RPC, workflow DAGs.

## Docs (current contracts)

- [acp.md](../../../../docs/acp.md): ACP v1 agent, capability advertisement, approvals, durability.
- [ag-ui.md](../../../../docs/ag-ui.md): AG-UI event mapping, A2UI middleware, MCP Apps adapters.
- [a2a.md](../../../../docs/a2a.md): A2A cards, durable task seams, verified client.
- [mcp-tools.md](../../../../docs/mcp-tools.md): SDK v2 client bridge/serving, OAuth transports.
- [multi-agent-patterns.md](../../../../docs/multi-agent-patterns.md): handoff/crew/supervisor/A2A decision table.
- [supervisors.md](../../../../docs/supervisors.md): child allow-lists, narrowing permissions, finite budgets.
- [server.md](../../../../docs/server.md): web-standard handler, SSE reconnect, webhook seams.
- [cli-rpc.md](../../../../docs/cli-rpc.md): print/json modes, LF-delimited RPC, `prism init`, provider scaffolding.

## Graft queries

- `graft ask "acp capability advertisement agent seams" --source`
- `graft ask "mcp oauth transport discovery pkce" --source`
- `graft callers createAcpEventMapper`

## Tests

- `packages/acp-agent`, `packages/ag-ui`, `packages/mcp` (workspace suites)
- `src/__tests__/rpc.test.ts`, `cli*.test.ts`, `delegated-agent-step.test.ts`, `crew-hierarchy-example.test.ts`

## Don't do

- Don't persist ACP modes/config from the agent side — host-owned seam, ownership-scoped.
- Don't widen protocol payloads beyond frozen caps (rich parts, replay chunks, titles).
- `workflows.md` (DAG orchestration, sagas, schedules) when the task names workflows.

Adjacent: `ag-ui-adoption.md` (matrix evaluation), `workflows.md`, `work-artifacts-and-review.md` (co-work events).
