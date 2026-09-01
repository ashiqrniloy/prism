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

- [x] Task 1 — Primitive Review and Record Fields
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

- [x] Task 2 — Importance Derivation From Existing Signals
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

- [x] Task 3 — Conformance and Release
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

Task 1 (implemented, tests pass):

- `importance` is a real additive record field persisted as nullable `importance REAL` (`ADD COLUMN IF NOT EXISTS`); legacy durable rows read NULL → neutral `1.0` at scoring time; `recency` is computed, never stored (from `createdAt` half-life).
- The shared pure re-rank (`rerankRecallHits`) lives in `recall()` in `memory.ts` — both memory and pgvector paths converge there; adapters only validate/clamp `importance` at upsert (`normalizeImportance`: finite required, `[0,1]` clamped, non-finite rejected).
- Absent `scoring` or all-zero weights → resolver returns `undefined` → no re-rank at all (single query, same topK, unchanged hit shape/p95); enabled path fetches `topK × 4` candidates, blends, cuts to `topK` (oversample `ponytail:` ceiling stands).
- Weight overshoot (`recencyWeight + importanceWeight > 1`) sum-normalizes down to similarity weight `0` instead of erroring; similarity keeps the remainder otherwise.

Task 2 (implemented, tests pass):

- Write surface: `MemoryEntryInput.importance?` (clamped `[0,1]`, wins over derivation) and `MemoryEntryInput.reflection?: JsonObject` (transient — not persisted); `CreateMemoryOptions.importanceFrom?: ImportanceFromReflection` is the documented hook seam in `scoring.ts` (no new package).
- Hook contract: runs once at write on the reflection **after secret redaction**; output clamped to `[0,1]`, non-finite fails the write; never invoked at recall (test-enforced: hook call count stays 1 after recalls). No default heuristic ships — recipe (mention count / supporting-observation count) documented as an example in `docs/working-and-semantic-memory.md`.
- Hook input typed `JsonObject` (redaction output shape); hosts spread typed OM reflections (`reflection: { ...reflection }`) — avoids adding observational-memory as a dependency for one type.

(Standing known ceiling: fixed oversample factor 4 for durable adapters — `ponytail: fixed oversample, adaptive fetch if recall quality drops`.)

Task 3 (implemented, tests pass; publish checks complete, nothing published):

- Conformance: `runMemoryConformance` now exercises scoring through every adapter (in-memory + live pgvector): write-time clamp, recency/importance ranking, numeric components only when enabled, disabled-component absence, and invalid half-life rejection. `packages/memory/src/__tests__/public-surface.test.ts` complements it with a public-entry-only seam (no private `src/**` imports) for resolver/weight normalization, clamp/hook precedence, tie-break, and docs tripwire (composite-scoring API names must appear in `docs/working-and-semantic-memory.md` or the suite fails).
- Release shape (Decision B changed-package cut vs parent `1171575`): `@arnilo/prism-memory` 0.3.1 → **0.3.2** (composite scoring), `@arnilo/prism-evals` 0.3.0 → **0.3.1** (plan-043 curation, first publishable cut of that surface), session-store trio 0.3.1 (plan 042), prompts stays at its initial 0.0.1 (publishes independently), and root `@arnilo/prism` 0.3.2 → **0.3.3** (tool-search + promptVersion plumbing + docs — root `@0.3.2` was already on the registry, so root had to move).
- Truth advancement (deliberate pin evolution, each test green): phase34 freeze BASELINE → `1171575` (+ `^0.3.2` added to the Decision B peer window), phase24 peer-window + docs.test current-line/tarball/peer pins → 0.3.3, phase27/30 version arrays + root `CHANGELOG`, phase26-freeze-manifest current-line markers → 0.3.3, `src/index.ts` built version literal → 0.3.3, package-truth + lockfile regenerated, budgets.json root tarball diet refreshed (970580/3290347/386 — tool-search dist + prompt-registry doc), docs/release-and-install.md current-line + 0.3.3 publish handoff (baseline, changed set, preflight commands), phase13 mtime ordering fixed by touching the older-file artifact to now.
- Verification (all green for the intended six-package candidate): `npm run release:gate`, `release:check --independent --baseline 1171575` (6/6 packages `available`), `release:publish --dry-run --allow-dirty --allow-untagged` (6/6 status `dry-run`, zero `failed`), release evidence 74 surfaces blocked=false (durable env recorded by name only), compat baselines additive-only reviewed (`version` literal + 2 pre-documented literal CHANGEDs), docs 146/146, memory `test:postgres` 40/40 against fresh live pgvector (shared scoring conformance + parity), evals 29, phase34/24/27/30/26/13, budget/tooling/benchmark gates, Biome lint zero diagnostics after formatting 21 files touched by plans 041-043.
- Deviations: `@arnilo/prism-prompts` is absent from the registry-detected changed set (untracked at the baseline commit → git-diff cannot see it); it publishes directly per plan 042's handoff (`npm view` 404 confirms the name is free). The pre-existing, unshipped `packages/prism-wiki/.wiki/log.md` edit makes generic changed-package detection demand an unrelated wiki bump; the verified six-package preflight/dry-run temporarily excluded that generated log. Keep/ship it as a separate wiki patch or restore it before the tagged publish. The field-policy perf-ratio test flakes under full-suite machine load (documented plan-041 precedent): isolated run green, file unchanged vs HEAD.

## Further Actions

- Operator handoff only (no publish ran this session): `node scripts/release.mjs publish --independent --baseline 1171575 --allow-dirty=false` on a clean tagged tree, or push the `<name>@<version>` package tags (`@arnilo/prism@0.3.3`, `@arnilo/prism-memory@0.3.2`, `@arnilo/prism-evals@0.3.1`, `@arnilo/prism-session-store-{codecs,sqlite,postgres}@0.3.1`, `@arnilo/prism-prompts@0.0.1` directly); `release.yml` runs deterministic publication with OIDC provenance.
- The field-policy perf-ratio guard could take the same deterministic-barrier treatment as the phase23 MCP-bridge fix if the full-suite flake recurs. Low priority — isolated runs are stable and the file is untouched since 0.2.7.