# Kernel — agent, session, loop, hooks, slots, events, host port

The core of `@arnilo/prism`: `createAgent`, `Agent`, `Session`, the loop slot, `RunController`, the hook bus, slots, events, limits, suspend/resume, and `HostUi`.

## Target

- [roadmap.md](../../../../roadmap.md) §2.3 (host API), §2.4 (hooks), §2.5 (loop primitives and slots). Built in roadmap Phases 1 and 3.
- Kernel pages are staged in `docs/next/` (agent and session, hooks, slots, loop, events, host port) as each API lands.
- Must hold:
  - every catalog hook is tested firing from the default loop **and** from a custom loop
  - deny wins
  - the first `run.end` continue wins and is capped by `limits.maxContinuations`
  - observer throws never fail a run
  - transform and decide throws fail closed, naming the package and hook
  - suspended runs resume in a new process through the store slot

## Today (0.12 code being replaced)

- Contracts: `src/contracts-core/agent.ts` (`AgentConfig`, `Agent`, `AgentSessionConfig`), `src/contracts-core/loop.ts` (`LoopContext`, `AgentLoopStrategy`, `StopHook`, `TurnPolicyOptions`), `src/contracts-run-state.ts` (`AgentSession`, `AgentRunResult`).
- Session engine: `src/agent-session/session.ts` (`RuntimeAgentSession`), `src/agent-session/session/{assemble,provider-round,tool-round,persist}.ts`.
- Loops: `src/agent-loops.ts` (`singleShotLoop`, `generateValidateReviseLoop`).
- Interception to collapse into hooks:
  - `src/middleware.ts`: middleware runs at `input.ts:176,317,371`, `assemble.ts:617`, `session.ts:495,507,874`, and `provider-round.ts:328`. The `tool_call` / `tool_result` names are declared but never run.
  - `src/guardrails.ts`
  - `src/provider-request-policy.ts`
  - `src/instruction-injection.ts`
- Limits and durability: `src/run-limits.ts`, `src/agent-run-state.ts`, `src/agent-run-lifecycle.ts`, `src/agent-approval.ts`.
- Current docs (released contract): [agent-session-runtime.md](../../../../docs/agent-session-runtime.md), [agent-loops.md](../../../../docs/agent-loops.md), [middleware-hooks.md](../../../../docs/middleware-hooks.md), [guardrails.md](../../../../docs/guardrails.md), [agent-events.md](../../../../docs/agent-events.md), [runs-and-usage.md](../../../../docs/runs-and-usage.md), [durable-runs.md](../../../../docs/durable-runs.md).

## Graft queries

- `graft ask "stop hook continuation run end steer" --source`
- `graft ask "tool round dispatch permission guardrail interrupt" --source`
- `graft ask "loop context assemble generate dispatchToolCall" --source`
- `graft callers createAgent --depth 2` (blast radius of an `AgentConfig` change)

## Tests

- `src/__tests__/agents*.test.ts`, `agent-loops.test.ts`, `agent-event-source.test.ts`, `agent-event-bridge.test.ts`, `durable-loops.test.ts`
- `src/__tests__/run-limits.test.ts`, `agent-run-lifecycle.test.ts`, `agent-run-state.test.ts`, `middleware.test.ts`, `guardrails.test.ts`
- Target suites: hook-catalog invariants and the loop conformance suite in `@arnilo/prism/testing`

## Rules

- Hooks fire inside `RunController` primitives. Never add a gate to a loop strategy.
- A new hook needs a catalog entry (kind, payload, result, combination, error policy), a `docs/next/` row, and tests from both loops. No untyped string hook names.
- Replacing a 0.12 mechanism means deleting its config field, registry, and exports in the same task: no aliases, baseline regenerated, retired names swept.
- `message.delta` observers are synchronous and must not block.
- The limits floor only narrows per run. Adding a limit axis updates `Limits`, its resolution, its tracker, and its docs together.
- The kernel synthesizes no identity. `principal` is opaque.
- Do not read `docs/migration.md` or `docs/performance.md` for current behavior. Graft covers it.

Adjacent: [customization.md](../../../../docs/customization.md) (0.12 seam map), [structured-output.md](../../../../docs/structured-output.md) (moves with `generate-validate-revise` to `workflows`).
