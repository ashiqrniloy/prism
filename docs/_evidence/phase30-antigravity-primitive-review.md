# Plan 031 Task 1 — Antigravity primitive review

Recorded: 2026-08-20  
Scope: bounded delegated-step event, AG-UI projection, and executable official CLI/MCP protocol proof.

## Verdict

One additive generic event shape and one bounded constructor are required. No delegated-agent framework, provider abstraction, credential adapter, or new transport is required.

The proof composes existing MCP and event primitives:

- `createPrismMcpServer` owns tool selection, authorization, ownership, dispatch, redaction, and result bounds;
- the official MCP SDK stdio transports carry the workspace server;
- `AgentEvent` is the existing normalized stream and `redactAgentEvent` remains the redaction boundary;
- `AgentEventSource` already enforces redacted records, 64 KiB default event bounds, ordered replay, and existing subscriber overflow policy;
- `createAgUiEventMapper` and `AgUiProjection` already validate and bound activity/custom output;
- the probe uses child-process bounds already represented by the coding process-session seam in the later package task; it does not add a second runtime.

## Existing primitive inventory

| Need | Existing seam | Decision |
| --- | --- | --- |
| Delegated timeline persistence | `AgentEvent` + `AgentEventSource` | Add one `delegated_agent_step` union member; reuse source unchanged. |
| Secret handling | `redactAgentEvent(event, redactor)` | Reuse before subscription, projection, and persistence. |
| Event byte/queue limits | `AgentEventSource` 64 KiB default and subscriber overflow policy | Reuse; constructor caps external IDs at 512 UTF-8 bytes and event serialization at 64 KiB. |
| UI activity/custom mapping | `createAgUiEventMapper`, `projectAgUiJson`, `AgUiProjection` | Default safe activity; optional named custom event; raw/tool details remain explicit projection only. |
| Prism MCP exposure | `createPrismMcpServer` | Reuse actual server in probe; no fake authorization path. |
| Official MCP transport | `StdioServerTransport` / `StdioClientTransport` | Use documented workspace stdio configuration in probe. |
| Process lifecycle | host-owned process boundary | Task 1 probe uses bounded `spawn`; package Task 3 must use existing `createProcessSessions`, not expand core. |

## New primitive justified

`src/delegated-agent-step.ts` provides `createDelegatedAgentStep` and frozen caps only because external CLI fields need a single fail-closed normalization point before becoming a public `AgentEvent`:

- unknown `step_type` becomes `kind: "unknown"`;
- state, index, duration, token counters, identifier sizes, and serialized event size are bounded;
- output is allow-listed, so raw arguments, results, paths, URIs, log bodies, and arbitrary provider fields cannot enter the core event;
- `thinkingTokens` is a number only; no thought-text field exists.

This is an event constructor, not a generic delegated-agent framework. Adapter-specific Antigravity NDJSON parsing stays in the future package/probe boundary.

## Executable proof

`scripts/phase30-antigravity-probe.mjs` has two modes:

```bash
node scripts/phase30-antigravity-probe.mjs --fixture
node scripts/phase30-antigravity-probe.mjs --fixture --unauthenticated
node scripts/phase30-antigravity-probe.mjs --live
```

Fixture mode launches a fake CLI, but the MCP child is the real `createPrismMcpServer` over official SDK stdio transport. It proves:

1. workspace `.agents/mcp_config.json` is sufficient to discover the `prism` server;
2. `init`, `step_update`, and terminal `result` NDJSON are bounded and parsed;
3. `prism_echo` authorizes and executes exactly once;
4. output becomes safe delegated-step metadata without raw tool payloads;
5. only a temporary workspace is created and documented global MCP config remains byte-identical;
6. unauthenticated behavior returns setup guidance without OAuth/callback/token automation.

Live mode launches only the host-provided `agy` binary with `-p`, `--output-format stream-json`, `--print-timeout 5m`, and a workspace agent. On this host (`agy` 1.1.16), bounded `init`/`step_update`/`result` output was observed and the requested `prism/prism_echo` MCP target was reached, but the global permission engine auto-denied the unconfigured MCP call. The probe never reads credentials, starts OAuth, uses `--dangerously-skip-permissions`, or edits global config. A host owner must explicitly configure a narrow official permission rule before an authorized live MCP call can be proven.

## Deferred alternatives

- direct Antigravity OAuth/session reuse — forbidden;
- private service protocol or credential-file adapter — forbidden;
- raw hidden-thought/log/workspace URI projection — forbidden by default;
- a second delegated-agent abstraction — defer until a second official adapter proves a shared contract;
- global MCP config mutation — rejected; workspace-only temp config is sufficient;
- custom MCP implementation — rejected; actual Prism MCP server plus official SDK stdio is sufficient.
