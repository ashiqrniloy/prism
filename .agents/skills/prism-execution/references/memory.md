# Memory — compaction slot, memory packages, context engineering

The kernel `compaction` slot and the `compaction.when` hook, plus the memory packages: `memory-observational`, `memory-compaction`, `memory-rag`, `memory-wiki`, and `memory-fabric`. Also covers `context-engineering` (context budget, tool-result fold, tool search, attention compiler).

## Target

- [roadmap.md](../../../../roadmap.md) §2.5 (slots), §2.9 (memory and context rows), §2.11 (the observational memory package example). Built in roadmap Phase 8. It depends on Phase 5 (`models.client`) and Phase 6 (persisted package state).
- **The observational memory package is the reference proof.** Everything below lives inside the package, and the host holds no memory logic:
  - separate observer and reflector models via `models.client`
  - the per-session toggle in `state.session`
  - `/om` and `/om:model` commands
  - a `recall` tool visible only when OM is on (`when`)
  - observations injected in `context.build`
  - background observation after `turn.completed` (`session.background`)
  - observation- and reflection-based compaction in the `compaction` slot
  - status events
- **Slot conflict:** installing both `memory-observational` and `memory-compaction` fails closed until the host or manifest assigns the slot owner.
- **Kernel default compaction** is deterministic, with no model call: it drops the oldest whole turns while keeping tool pairs, and writes a marker.
- **Stated cost:** every memory package states its extra model calls and is off by default.

## Today (0.12 code being replaced)

- Kernel parts:
  - `src/compaction.ts`, `src/contracts-core/compaction.ts` (`CompactionStrategy`, `CompactionTrigger`)
  - `src/context-budget.ts`, `src/tool-result-fold.ts`, `src/tool-search.ts`, `src/attention-compiler.ts`, all moving to `context-engineering`
- Packages:
  - `packages/memory/src/compaction/{llm,observational-memory}`
  - `packages/memory/src/{rag,wiki,fabric,scoped}`, plus `memory.ts` / `vector-memory.ts` / `postgres.ts`
- **Host coordinator being deleted:** `packages/prism-code/src/observational-memory.ts` (the `ObservationalMemoryCoordinator`, which wraps `session.run`), `compaction.ts`, `wiki.ts`, and the `/om*` handlers in `tui/commands.ts`. Its behavior is the acceptance spec for the package.
- Current docs (released contract): [compaction-and-retry.md](../../../../docs/compaction-and-retry.md), [compaction-llm.md](../../../../docs/compaction-llm.md), [compaction-observational-memory.md](../../../../docs/compaction-observational-memory.md), [working-and-semantic-memory.md](../../../../docs/working-and-semantic-memory.md), [memory-fabric.md](../../../../docs/memory-fabric.md), [rag.md](../../../../docs/rag.md), [wiki.md](../../../../docs/wiki.md), [attention-compiler.md](../../../../docs/attention-compiler.md), [input-and-prompt-assembly.md](../../../../docs/input-and-prompt-assembly.md).

## Graft queries

- `graft ask "observational memory attach observe reflect recall" --source`
- `graft ask "compaction strategy trigger threshold abort" --source`
- `graft callers createObservationalMemory --depth all`

## Tests

- `packages/memory/src/**/__tests__/` (run from the workspace directory)
- `src/__tests__/compaction.test.ts`, `context-budget.test.ts`, `input-pipeline.test.ts`
- `packages/prism-code/src/__tests__/` observational-memory and commands suites. Port their assertions into the package before deleting the coordinator.
- Target suite: compaction conformance (`@arnilo/prism/testing/compaction-conformance`)

## Rules

- Flat OM settings keys are rejected, and the error names the nested replacement.
- Token estimates (`ceil(len/4)`) are for context budgeting only and never pose as billing numbers.
- Summary generation uses the agent session id (for cache hits). OM workers use a derived `om:{session.id}`. Keep them separate.
- `context.build` changes only the provider view. The store keeps the full transcript until the compaction slot rewrites it.
- Never wrap `session.run` or `session.stream` from a package. If a behavior seems to need it, a hook or kernel primitive is missing; fix that instead.
