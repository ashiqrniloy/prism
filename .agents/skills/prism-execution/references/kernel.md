# Kernel — agent, session, loop, hooks, slots, events, host port

The core of `@arnilo/prism`: `createAgent`, `Agent`, `Session`, the loop slot, `RunController`, the hook bus, slots, events, limits, suspend/resume, and `HostUi`.

## Target

- [roadmap.md](../../../../roadmap.md) §2.3 (host API), §2.4 (hooks), §2.5 (loop primitives and slots). Built in roadmap Phases 1 and 3.
- Kernel pages live in `/docs`: [agent.md](../../../../docs/agent.md), [hooks.md](../../../../docs/hooks.md), [slots.md](../../../../docs/slots.md), [loop.md](../../../../docs/loop.md), [events.md](../../../../docs/events.md), [host.md](../../../../docs/host.md). Edit the matching page in the task that changes the contract.
- Must hold:
  - every catalog hook is tested firing from the default loop **and** from a custom loop
  - deny wins
  - the first `run.end` continue wins and is capped by `limits.maxContinuations`
  - observer throws never fail a run
  - transform and decide throws fail closed, naming the package and hook
  - suspended runs resume in a new process through the store slot

## Today

- Entry and contracts: `src/agents.ts` and `src/agent-session/create-agent.ts` (`createAgent`), `src/agent/{inspect,models,sessions,views}.ts` (the `Agent` surface), `src/contracts-core/{agent,session,loop}.ts`, `src/contracts-run-state.ts`.
- Session engine: `src/agent-session/session.ts` and `src/agent-session/session/{assemble,provider-round,tool-round,persist}.ts`; session state and background work in `src/session/{state,background,external-state}.ts`.
- Loop: `src/loop/run-controller.ts` (`createRunController`: the primitives, where every gate fires), `src/loop/default-loop.ts` (`defaultLoop`), `src/loop/dispatch.ts` (ordered and exclusive tool dispatch).
- Hooks: `src/hooks/catalog.ts` (the frozen catalog), `src/hooks/bus.ts` (`createHookBus`), `src/hooks/{types,emit,errors,ask}.ts`.
- Slots: `src/slots/{registry,defaults,types}.ts` (`loop`, `compaction`, `store`, `credentials`).
- Host port: `src/host/types.ts` (`HostPort`, `HostUi`).
- Limits and durability: `src/run-limits.ts`, `src/agent-run-state.ts`, `src/agent-run-restore.ts`, `src/suspended-run.ts`, `src/agent-approval.ts`. The guardrail stage runner stays in the kernel (`src/guardrails.ts`); packs live in `@arnilo/prism-guardrail-packs`.
- Current docs: [agent.md](../../../../docs/agent.md), [loop.md](../../../../docs/loop.md), [hooks.md](../../../../docs/hooks.md), [events.md](../../../../docs/events.md), [slots.md](../../../../docs/slots.md), [host.md](../../../../docs/host.md).

## Graft queries

- `graft ask "run.end continue decision maxContinuations" --source`
- `graft ask "executeTools tool.call gate rewrite ask" --source`
- `graft ask "RunController turn context.build provider request" --source`
- `graft callers createAgent --depth 2` (blast radius of an `AgentConfig` change)

## Tests

- `src/__tests__/agents.test.ts`, `run-controller.test.ts`, `loop-dispatch.test.ts`, `durable-loops.test.ts`
- Hooks: `hook-bus.test.ts`, `hook-invariants.test.ts`, `hook-catalog-coverage.test.ts`, `hook-catalog-freeze.test.ts`
- Slots, host, sessions: `slot-registry.test.ts`, `host-ui.test.ts`, `session-resume.test.ts`, `session-state-background.test.ts`, `resume-gate-integrity.test.ts`, `tool-gate-integrity.test.ts`
- Limits and durability: `run-limits.test.ts`, `agent-run-state.test.ts`
- Published conformance: `loopConformance` and `assertGateIntegrity` from `@arnilo/prism/testing` (run them against any custom loop)

## Rules

- Hooks fire inside `RunController` primitives. Never add a gate to a loop strategy.
- A new hook needs a catalog entry (kind, payload, result, combination, error policy), a row in [hooks.md](../../../../docs/hooks.md), and tests from both loops. No untyped string hook names.
- Replacing a mechanism means deleting its config field, registry, and exports in the same task: no aliases, baseline regenerated, retired names swept.
- `message.delta` observers are synchronous and must not block.
- The limits floor only narrows per run. Adding a limit axis updates `Limits`, its resolution, its tracker, and its docs together.
- The kernel synthesizes no identity. `principal` is opaque.
- Do not read `docs/migration.md` or `docs/performance.md` for current behavior. Graft and the `/docs` kernel pages cover it.

Adjacent: [core-0.12.md](../../../../docs/history/core-0.12.md) (archived 0.12 runtime page; open it only for a 0.12.1 bug fix).
