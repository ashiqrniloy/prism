# Memory — compaction slot, memory packages, context engineering

The kernel `compaction` slot and the `compaction.when` hook, plus the memory packages (`memory-compaction`, `memory-core`, `memory-system` — session tiers and long-term memory, the former `memory-observational` and `memory-fabric`) and the knowledge packages outside memory (`rag`, `wiki`, under `packages/knowledge/`). Also covers `context-engineering` (context budget, tool-result fold, tool search, attention compiler).

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
- **Memory model (owner decision 2026-11-08, plan 216):** one memory system modelled on human memory (STM → WM → Rehearsal → LTM, plus Sleep; `@arnilo/prism-memory-system` from plan 216 Task 4). The ontology is **not** memory: `@arnilo/prism-wiki` (`packages/knowledge/wiki`) keeps concepts, claims, subject bindings and sources in its own store, reads LTM only through the read-only `memory.ltm` service (no write member), and cascades deletions from memory's deletion feed plus an open-time liveness read. The fabric has no `concept` kind, no `memory.fabric` service and no ontology code. Never reintroduce a concept kind in memory, a write path from the wiki into memory, or a wiki dependency on a memory package (the wiki runs without memory; `memory-core` is the shared library).

## Today

- Kernel: the `compaction` slot contract (`src/contracts-core/compaction.ts`), the deterministic default (`src/compaction.ts`), the `compaction.when` hook, and `input.ts` assembly (where `context.build` handlers compose the provider view).
- Packages (`packages/memory/*`, `packages/context/engineering`): `compaction` (LLM summary strategy), `core` (vector memory, scoring, the SQLite, Postgres and markdown stores), `system` (`src/session`: the session tiers — ledger, STM/WM/rehearsal workers, `memory:session` commands; `src/ltm`: long-term memory, the former fabric — typed notes, consolidation, recall; `memorySystem({ ltm })`), `rag` (`packages/knowledge/rag`: chunking, embedders, fusion, connectors), `wiki` (`packages/knowledge/wiki`; was the 0.12-era compiler, `.wiki/` store, `qmd` search and `prism-wiki` CLI; plan 207 Task 5 retires them and re-scopes the package as the ontology tier), and `context-engineering` (attention compiler, context budget, tool-result fold, tool search).
- In flight, strictly one plan after another: plan 202 Tasks 1–17 (17b) → plan 207 (17c: the ontology tier) → plan 208 (17d: three-tier criteria and ontology dev screen) → plan 209 (17e: standing rules, tool steps, lessons, work-outcome suite and dev screen) → plan 210 (17f: feature audit and removals, then the one held-out acceptance and the preset revision, defaults and claims) → 184 → 185. No held-out partition is read before plan 210 Task 9. Read the active plan's tasks and plan 202's "Structure decision" (with its 2026-10-31 amendment) before touching OM, memory-core, fabric or wiki. Do not add a memory feature without a named measurement: plan 210 removes what has none.
- Current docs: [slots.md](../../../../docs/slots.md) (compaction slot); [`compaction`](../../../../packages/memory/compaction/README.md), [`system`](../../../../packages/memory/system/README.md), [`core`](../../../../packages/memory/core/README.md), [`rag`](../../../../packages/knowledge/rag/README.md), [`wiki`](../../../../packages/knowledge/wiki/README.md), [`engineering`](../../../../packages/context/engineering/README.md).

## Graft queries

- `graft ask "observational memory attach observe reflect recall" --source`
- `graft ask "compaction strategy trigger threshold abort" --source`
- `graft callers createObservationalMemoryCompactor --depth all`

## Tests

- `packages/memory/<name>/src/__tests__/` and `packages/context/engineering/src/__tests__/` (run from each package directory)
- Kernel: `src/__tests__/compaction.test.ts`, `compaction-trigger.test.ts`, `input-pipeline.test.ts`
- Published conformance: `@arnilo/prism/testing/compaction-conformance` (any compaction slot owner)

## Rules

- Flat OM settings keys are rejected, and the error names the nested replacement.
- Token estimates (`ceil(len/4)`) are for context budgeting only and never pose as billing numbers.
- Summary generation uses the agent session id (for cache hits). Session-memory workers use a derived `memory.session:{session.id}`. Keep them separate.
- `context.build` changes only the provider view. The store keeps the full transcript until the compaction slot rewrites it.
- Never wrap `session.run` or `session.stream` from a package. If a behavior seems to need it, a hook or kernel primitive is missing; fix that instead.
