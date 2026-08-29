# 044 — Composite Memory Recall Scoring (Recency + Importance)

Adoption-list item #5 (CrewAI unified Memory parity: semantic + recency + importance).
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism-memory` **0.3.1**.
Target: optional composite recall scoring in the semantic-recall path — similarity remains the default; hosts opt into blending recency and importance. No LLM in the write path.

## Objectives

- Add optional `recency` (decay from record timestamp/sequence) and `importance` (host-supplied or observational-memory-derived weight) fields to memory records, and a host-suppliable composite scorer hook used at recall time.
- Default behavior unchanged: pure similarity + lexical scoring (compat).
- Importance derives from existing signals (observational-memory reflections, host feedback) — never from an extra LLM call in the write path.
- Keeps `MemoryVectorHit.score` semantics documented (composite score when enabled).

## Expected Outcome

- Hosts enable `recallScoring: { recencyWeight, importanceWeight, halfLifeMs }` on the memory package's recall config; hits ordered by blended score; hit records expose the components (`similarity`, `recency`, `importance`, `score`) for transparency.
- Stale-but-similar facts no longer outrank recent important ones (fixture-proven).
- No write-path cost change; no new dependency.

## Tasks

- [ ] Task 1 — Primitive Review and Record Fields
  - Acceptance Criteria:
    - Functional: inventory `packages/memory/src/types.ts` (`MemoryVectorRecord`, `MemoryVectorHit` — already carries `sequence`, timestamps), `vector-memory.ts` (cosine + lexical scoring paths), `postgres.ts` (pgvector/fts ordering — `ORDER BY score DESC, sequence ASC, id ASC` today), `packages/compaction-observational-memory` (reflections as importance source). Confirm additive fields are backward compatible with existing durable rows (nullable, default neutral `1.0` importance / no decay).
    - Performance: composite arithmetic per hit only (no extra queries); recall p95 unchanged within envelope when disabled.
    - Code Quality: scoring stays pure and exported for tests; weights validated finite in `[0,1]`, sum-normalized by the resolver.
    - Security: importance is host-trusted data; values clamped; no telemetry addition beyond existing hit shapes.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md` (recall semantics, embedder identity/generation pointers), `packages/memory/src/vector-memory.ts`, `packages/memory/src/postgres.ts` (score mapping `mapVectorRow`), `docs/compaction-observational-memory.md` (reflections).
    - Options Considered:
      - CrewAI-style LLM importance analysis on save: rejected — a model call per write (cost/latency/failure mode) contradicts Prism's write-path discipline; importance already computable from reflections/feedback.
      - Postgres-side ORDER BY composite: considered for the pgvector path; requires SQL expression — viable, but keeps adapter-specific logic; in-memory normalize instead, keep SQL unchanged. Chosen: in-TS re-ranking after bounded top-K fetch (fetch `k × oversample` candidates, blend, cut to k). `ponytail:` comment: oversample factor 4 fixed; adaptive fetch if recall quality measurably drops.
    - Chosen Approach:
      - Additive fields + optional composite scorer hook; both memory and postgres paths converge on the shared re-rank function.
    - API Notes and Examples:
      ```ts
      const recalled = await memory.recall({ query, topK: 8, scoring: {
        recencyWeight: 0.3, importanceWeight: 0.2, halfLifeMs: 7 * 24 * 3600 * 1000 } });
      // hit: { text, score, similarity, recency, importance, ... }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/types.ts` (additive fields + `RecallScoringOptions`), `packages/memory/src/scoring.ts` (new, pure), `packages/memory/src/vector-memory.ts`, `packages/memory/src/postgres.ts` (hook points).
  - Test Cases to Write:
    - Default compat: no scoring config → ordering identical to today (fixture replay).
    - Blend ordering: similar-similarity records → recent+important wins; stale similar fact demoted (the headline fixture).
    - Weight validation: non-finite/out-of-range rejected; weights normalized.
    - Postgres parity: same fixture through pgvector adapter yields same order as memory adapter (protected leg).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive recall options and hit fields.
    - Docs pages to create/edit: `docs/working-and-semantic-memory.md` — "Composite recall scoring" section (inputs table, example, security/perf notes).
    - `docs/index.md` update: yes — memory entry description extended.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — Importance Derivation From Existing Signals
  - Acceptance Criteria:
    - Functional: host-supplied importance at write (clamped `[0,1]`); optional host callback deriving importance from observational-memory reflections (input: reflection record; output: weight) — callback is host-owned, no default LLM use; document derivation recipe (frequency/prominence heuristics) as an example, not shipped default logic.
    - Performance: derivation happens at write/export time only; recall path never calls out.
    - Code Quality: derivation seam is a documented hook type in the package, not a new package.
    - Security: reflections pass through existing redaction before entering any callback.
  - Approach:
    - Documentation Reviewed: `docs/compaction-observational-memory.md` (reflection shapes, dual coverage), `packages/memory/src/types.ts`.
    - Options Considered: shipped heuristic default (e.g., mention-count) — rejected as YAGNI; hosts' domains differ wildly. Recipe documented instead.
    - Chosen Approach: hook + documented recipe.
    - API Notes and Examples:
      ```ts
      importanceFrom: (reflection) => clamp(reflection.mentions / 10)
      ```
    - Files to Create/Edit: `packages/memory/src/scoring.ts` (hook type), `docs/working-and-semantic-memory.md`.
  - Test Cases to Write:
    - Hook applied at write; absent hook → neutral importance; clamping enforced.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — write option.
    - Docs pages to create/edit: `docs/working-and-semantic-memory.md` derivation section.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Conformance and Release
  - Acceptance Criteria:
    - Functional: memory conformance (`packages/memory/src/conformance.ts`) extended with a scoring leg run by all adapters; package version bumped independently (0.3.2 or next per Decision B).
    - Performance: recall benchmarks show no regression with scoring disabled; scoring-enabled recall within +10% of disabled on same fixture (arithmetic only).
    - Code Quality: additive-only compat baseline; `ponytail:` ceiling comment on the fixed oversample factor.
    - Security: no new data flows; hit component fields redaction-safe (numbers only).
  - Approach:
    - Documentation Reviewed: `packages/memory/src/conformance.ts`, `docs/release-and-install.md`.
    - Options Considered / Chosen Approach: extend existing conformance; independent bump.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `packages/memory/src/conformance.ts`, `docs/migration.md` (additive note).
  - Test Cases to Write: conformance scoring leg; docs tripwire.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — conformance surface.
    - Docs pages to create/edit: `docs/working-and-semantic-memory.md` (limits/notes), `docs/migration.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass. (Known ceiling: fixed oversample factor 4 for durable adapters — `ponytail: fixed oversample, adaptive fetch if recall quality drops`.)

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.