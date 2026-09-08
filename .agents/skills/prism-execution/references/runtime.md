# Runtime — session, run, loop, events, limits, usage

Session/run lifecycle, control loops, events, steer, run limits, usage accounting,
observability, durable resume.

## Docs (current contracts)

- [agent-session-runtime.md](../../../../docs/agent-session-runtime.md): create agents/sessions, `run`/`prompt`/`steer`/`stream`, durable resume.
- [agent-definitions.md](../../../../docs/agent-definitions.md): declarative `AgentDefinition` resolution, `AGENT.md` bundle discovery.
- [agent-loops.md](../../../../docs/agent-loops.md): replaceable control loops, tool rounds, durable revision/restore hooks.
- [guardrails.md](../../../../docs/guardrails.md): fail-closed input/output/tool checks.
- [agent-events.md](../../../../docs/agent-events.md): live + durable event sources, reconnect.
- [runs-and-usage.md](../../../../docs/runs-and-usage.md): run/event/usage persistence, `RunLimits`, `CostCatalog`.
- [observability.md](../../../../docs/observability.md): OTel GenAI spans, RAG span tree.
- [structured-output.md](../../../../docs/structured-output.md): `Artifact*` seam, `StructuredOutputOptions`.

## Graft queries

- `graft ask "how do run limits charge usage" --source`
- `graft ask "steer turn boundary softInterrupt" --source`
- `graft callers recordUsage`

## Tests

- `src/__tests__/agents*.test.ts`, `agent-loops.test.ts`, `agent-events.test.ts`
- `src/__tests__/run-limits.test.ts`, `agent-run-lifecycle.test.ts`, `agent-run-state.test.ts`
- `src/__tests__/stream-token-coalesce.test.ts`, `durable-loops.test.ts`

## Don't do

- Don't add a run-limit axis without `RunLimits` + `ResolvedRunLimits` + tracker + docs in one change.
- Don't emit events outside the normalized event shape; don't create spans from deltas.
- Don't read `docs/migration.md`/`docs/performance.md` for current behavior — graft covers it.

Adjacent: `customization.md` (SDK seam map), `evaluations.md` (scoring), `use-case-model-selection.md` (non-session LLM jobs).
