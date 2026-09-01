# 042 — Versioned Prompt Registry with Eval-Gated Promotion

Adoption-list item #3 (parity with LangSmith Prompts / LangChain Hub).
Roadmap phase: **0.3.x** (demand-gated).
Baseline: `@arnilo/prism` **0.3.0**+.
Target: `@arnilo/prism-prompts` **0.0.1** (peer `@arnilo/prism` `^0.3.0`) — immutable versioned prompt records, store contract, memory + SQLite/PostgreSQL adapters, and eval-gated promotion wired to existing `runComparison`.

## Objectives

- Ship a `PromptStore` contract: immutable, versioned prompt records (body, labels/layers, metadata), with append-new-version and resolve-latest/version semantics — never in-place mutation.
- Record the resolved prompt version id on the run ledger so every run answers "which prompt version produced this output" (prompt provenance for audit).
- Wire promotion to the existing `@arnilo/prism-evals` `runComparison` (2–8 named candidates) so "ship v7 only if it beats v6 on our dataset" is one call.
- Keep Prism's system-prompt layering (`src/system-prompts.ts`) untouched — the registry stores prompt assets; layering behavior stays where it is.

## Expected Outcome

- Hosts can call `store.put` / `store.list` / `store.resolve` through memory or durable adapters (SQLite/Postgres via the existing session-store persistence pattern).
- Run ledger records carry the prompt version ref (additive field), rendered through existing redaction.
- `assertPromptPromotion` helper runs a `runComparison` between two versions against a dataset and returns a pass/fail verdict with per-scorer aggregates — reusable in CI.
- Package publishes independently at `0.0.1`; no core changes required for the store itself; run-ledger provenance field is a core additive seam.

## Tasks

- [x] Task 1 — Primitive Review: Prompt Store as Contract, Not Layering Change (2026-08-30)
  - **Completion Evidence (2026-08-30):**
    - **Layering boundary:** `composeSystemPrompt` (`src/system-prompts.ts:L18-L69`) is the existing composition primitive. It sorts `user` → `package` → unknown custom sources → `app` → `run`, applies `append`/`prepend`/`replace`/`disable`, and receives `AgentConfig.instructions` as its separate base. `loadSystemPromptFiles` (`src/node/system-project-prompts.ts:L35-L49`) only adapts `SYSTEM.md`/`AGENTS.md` into contributions; extension registration is inert until the host selects a contribution. A registry must therefore return prompt data, not call or alter layering.
    - **Prompt metadata is not provenance:** `SystemPromptContribution.metadata` is caller data ignored by composition, and no prompt layer is emitted or stored by core. It cannot replace a run-level provenance field.
    - **Run-ledger boundary:** record shapes live in `RunRecord` (`src/contracts-protocol.ts:L462-L477`); `src/run-ledger.ts:L55-L156` is only the optional batching wrapper. `RunRecord` already has optional `metadata`, but `runInternal` builds merged metadata for guardrails/provider policies/context (`src/agent-session/session.ts:L360-L373`) and omits it from both start and finish `RunRecord`s (`src/agent-session/session.ts:L390-L404`, `L1090-L1111`). `RunLedger` is write-only and records are redacted before append. **Decision:** no metadata pass-through exists; Task 3 needs one typed optional `promptVersion` ref carried from `RunOptions` to `RunRecord`, shaped as `{ name, version, hash }`, with `version` bounded and `hash` an opaque `sha256:<64 lowercase hex>` value.
    - **Persistence boundary:** `@arnilo/prism-session-store-codecs` maps existing flat session/run/event/tool/usage rows and JSON metadata; it exposes no generic prompt-record contract. Reuse its ownership, cursor, JSON, and immutability patterns where useful, but keep prompt records and SQL dialects package-owned. Existing `RunRow`/`prism_runs.metadata` does not make the typed prompt ref durable automatically. **Decision:** Task 3 adds a nullable `prompt_version` JSON column to first-party run rows (plus one additive checked migration and row-codec/schema updates), rather than hiding the ref in free-form metadata; legacy rows remain `undefined`.
    - **Evaluation boundary:** `runComparison` (`packages/evals/src/comparison.ts:L15-L114`) sorts named candidates, runs each once per dataset item, scores every stable pair, and returns wins/ties/failures without selecting a winner. Defaults are 2–8 candidates (`DEFAULT_COMPARISON_CANDIDATES = 8`); the hard ceiling is 32. Task 4 should resolve prompt versions and close over host candidate runners, composing `runComparison`/`assertEvaluationThreshold` without changing either API.
    - **Integrity boundary:** policy audit export canonicalizes signed manifests and hashes tenant/sequence/prior-digest-bound record envelopes with SHA-256 (`packages/policy/src/audit-export.ts:L178-L264,L579-L684`). Prompt content hashing can reuse the same `node:crypto` SHA-256 pattern over exact UTF-8 body bytes; it does not need a dependency on `@arnilo/prism-policy` or canonical-JSON layering for a plain string.
    - **Contract decision:** create optional `@arnilo/prism-prompts` as an independent asset store. `put` appends an immutable, bounded, content-hashed record; `resolve` returns data for the host to inject as one already-controlled system-prompt contribution. Memory resolve is a map lookup; durable resolve is an indexed `(owner, name, version/label)` read. No registry operation evaluates, renders, discovers, or implicitly applies prompt text.
  - Acceptance Criteria:
    - Functional: inventory `src/system-prompts.ts` (explicit user/package/app/run layers), `src/contracts-protocol.ts` plus `src/agent-session/session.ts` (ledger record shape and additive-field path), `packages/evals/src/comparison.ts` (`runComparison` candidates), `packages/session-store-codecs` (shared persistence codecs), `packages/policy` audit envelope signing (provenance precedent). Confirm: registry is a new store contract; core needs only one additive provenance field (or a metadata pass-through already present — record which).
    - Performance: resolve-version is a map lookup (memory) / indexed read (durable); no scan on the hot path.
    - Code Quality: no changes to `composeSystemPrompt` layering order; versioned bodies compose as one layer input the host already controls.
    - Security: prompt bodies are host-authored but may contain rendered untrusted fragments — storage treats them as data (bounded size caps), never evaluated; version records immutable + content-hashed (SHA-256, reusing existing hashing patterns).
  - Approach:
    - Documentation Reviewed:
      - `docs/system-prompts.md`, `docs/runs-and-usage.md`, `docs/evaluations.md`, `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `packages/session-store-codecs/README.md`, `docs/audit-export.md` (RFC 8785 + SHA-256 chain precedent for immutable records).
      - `src/system-prompts.ts:L18-L69`, `src/node/system-project-prompts.ts:L7-L71`, `src/contracts-core/extensions.ts:L160-L171` (layer ranks, file adapters, contribution shape).
      - `src/contracts-protocol.ts:L62-L101,L462-L601`, `src/agent-session/session.ts:L360-L404,L457-L493,L1090-L1111`, `src/redaction.ts:L17-L80` (run options, ledger records, append/redaction path).
      - `packages/evals/src/comparison.ts:L15-L114`, `packages/evals/src/types.ts:L209-L259`, `packages/evals/src/threshold.ts:L13-L58` (bounded pairwise comparison and threshold gates).
      - `packages/session-store-codecs/src/index.ts:L1-L426`, `src/contracts-core/persistence.ts:L25-L413`, `packages/policy/src/audit-export.ts:L178-L264,L579-L684` (row codecs, ownership/persistence seams, canonical SHA-256 integrity).
    - Options Considered:
      - Extend `src/system-prompts.ts` with versioning: rejected — prompt layering is runtime composition; versioning is asset lifecycle. Mixing them couples every host to a store.
      - New optional `@arnilo/prism-prompts` package with a `PromptStore` contract: chosen — mirrors `RunFeedbackStore`/`EvaluationStore` precedent (contract + memory + durable adapters).
    - Chosen Approach:
      - Contract-first package; memory adapter in-package; SQLite/Postgres adapters via the shared codecs package pattern (same split as session stores). The host remains responsible for choosing and injecting a resolved version; the registry never becomes a second prompt-layering engine.
    - API Notes and Examples:
      ```ts
      import { createMemoryPromptStore } from "@arnilo/prism-prompts";
      const store = createMemoryPromptStore();
      const v7 = await store.put({ name: "support-agent", body: "...", labels: ["app"] });
      const resolved = await store.resolve({ name: "support-agent" }); // latest
      ```
    - Files to Create/Edit:
      - `plans/042-Prompt-Registry-Versioned-Prompts-And-Eval-Gated-Promotion.md`: this review record only; package files remain implementation work in Task 2.
  - Test Cases to Write:
    - None (read-only review; immutability and deterministic resolve cases carried to Task 2).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — this task records decisions only; the package surface is deferred to Task 2.
    - Docs pages to create/edit: none for this review; Task 2 owns `docs/prompt-registry.md`.
    - `docs/index.md` update: no — navigation changes wait for the package surface.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Store Contract, Memory Adapter, Durable Adapters (2026-08-30)
  - **Completion Evidence (2026-08-30):**
    - **Contract:** `@arnilo/prism-prompts` now exports immutable `PromptStore` records and refs, append-only `put`, ownership-scoped cursor `list`, latest/exact/label `resolve`, bounded `diff`, finite limits, typed errors, and package-local conformance helpers.
    - **Memory adapter:** per-scope/name version maps assign monotonic versions, freeze nested metadata/labels, verify body hashes, and resolve without a scan.
    - **Durable adapters:** SQLite and PostgreSQL persist `prism_prompts` plus normalized `prism_prompt_labels`; both use exact ownership predicates, indexed name/version and label reads, bound values, and checked `001_init` migration histories. SQLite uses transactional writes; PostgreSQL serializes version allocation with a transaction advisory lock.
    - **Validation:** body/name/label/metadata/page/cursor/diff caps fail closed with `ERR_PRISM_PROMPT_*`; stored body/hash mismatches fail closed. Omitted ownership is normalized to a separate local scope, never treated as a wildcard.
    - **Checks:** `npm run build --workspace @arnilo/prism-prompts`, `npm run typecheck`, `npx biome check packages/prompts`, package tests (memory/SQLite/migration drift; 4 pass, PostgreSQL leg skipped because `PRISM_TEST_POSTGRES_URL` is unset), root `npm run typecheck`, `node --test scripts/phase24-truth.test.mjs`, and package `pack:dry-run` pass. Full root `npm test` reaches later historical phase13–30 freeze assertions that still pin the pre-registry package/dependency graph, plus two pre-existing Biome diagnostics in unrelated user-modified files; those remain Task 5 rebaseline work.
  - Acceptance Criteria:
    - Functional: `PromptStore`: `put` (new version), `list` (cursor-paged, name-filtered), `resolve({ name, version? , label? })`, `diff(a, b)` (bounded line diff), ownership scoping like every Prism store. SQLite adapter (better-sqlite3, mirroring `packages/session-store-sqlite` migration-checksum pattern) and Postgres adapter (pooled `pg`, mirroring `packages/session-store-postgres`).
    - Performance: p95 resolve < existing session-read envelope; list pages bounded (frozen caps per `limits.ts` pattern).
    - Code Quality: adapters pass package-local `runPromptStoreConformance`; SQL dialect lives in adapters, while shared prompt validation/row decoding stays package-local because `session-store-codecs` is session/run-only and cannot depend back on the independent prompt package.
    - Security: ownership filter on every read/write (tenant boundary); bounded body bytes (fail-closed `ERR_PRISM_PROMPT_*`); no secret-scan hits in fixtures; durable adapters validate checksummed migrations (migration refusal tested).
  - Approach:
    - Documentation Reviewed:
      - `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `packages/session-store-sqlite/src/`, `packages/session-store-postgres/src/` (advisory-locked checksummed migrations).
      - `docs/agent-identity.md` — ownership scoping precedent.
    - Options Considered:
      - Filesystem-only store: rejected — ownership scoping and tenant boundaries need the same rigor as other durable state; filesystem is a dev convenience not a contract.
      - Reuse session-store tables: rejected — different lifecycle (immutable, app-versioned).
    - Chosen Approach: contract + memory + SQLite + Postgres, package-local conformance/validation/row helpers, normalized label table for indexed label resolution, checked package-owned migrations, and frozen caps.
    - API Notes and Examples:
      ```ts
      const diff = await store.diff("support-agent", 6, 7); // bounded line diff for side-by-side
      ```
    - Files to Create/Edit:
      - `package.json`, `package-lock.json`: register the independent workspace.
      - `packages/prompts/package.json`, `packages/prompts/tsconfig.json`, `packages/prompts/README.md`, `packages/prompts/CHANGELOG.md`, `packages/prompts/LICENSE`: package metadata, install/API surface, and release license.
      - `packages/prompts/src/{types,store,memory,conformance,errors,limits,util,pagination,diff,index}.ts`: contract, memory adapter, shared validation, cursors, diff, exports, and conformance.
      - `packages/prompts/src/{sqlite,sqlite-ddl,sqlite-migrations,postgres,postgres-ddl,postgres-identifiers,postgres-migrations}.ts`: SQLite/PostgreSQL adapters, ownership-scoped schema, checked migrations, and identifier handling.
      - `packages/prompts/src/__tests__/prompts.test.ts`: memory/SQLite conformance, reopen, migration checksum refusal, bounds, and protected PostgreSQL leg.
      - `docs/prompt-registry.md`, `docs/index.md`, `docs/database-persistence.md`: public API, navigation, and independent schema/migration documentation.
      - `scripts/package-truth.json`, `scripts/phase24-truth.test.mjs`: workspace/package omission truth and gate accounting.
      - `README.md`, `docs/release-and-install.md`, `docs/_evidence/phase35-ai-runtime-package-matrix.md`, `scripts/benchmark-multi-agent.test.mjs`, `src/__tests__/docs.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts`: current package catalog, omission wording, manifest evidence, and packaging/release tripwires.
  - Test Cases to Write:
    - Conformance leg run against all three adapters (memory/SQLite in package tests; PostgreSQL in `test:postgres` when `PRISM_TEST_POSTGRES_URL` is set).
    - Ownership: cross-tenant resolve/list rejected.
    - Migration: stale checksum refused (SQLite unit leg; PostgreSQL uses the same checked contract under the protected integration profile).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — adapters + conformance.
    - Docs pages to create/edit: `docs/prompt-registry.md` adapters section; `docs/database-persistence.md` cross-link.
    - `docs/index.md` update: yes — add the package under "Input, prompt, and context assembly"; Task 1 is review-only.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Run-Ledger Prompt Provenance (Additive Core Seam) (2026-08-30)
  - **Completion Evidence (2026-08-30):**
    - **Typed ref:** `PromptVersionRef` (`{ name, version, hash }`) added in `src/contracts-protocol.ts`; optional `promptVersion` on both `RunOptions` and `RunRecord`. `name` bounded to 1–256 UTF-8 bytes (matches the prompt registry's default name cap), `version` an integer in `[1, 2147483647]`, `hash` exactly `sha256:` + 64 lowercase hex.
    - **Run path:** `runInternal` validates the ref fail-closed (`assertPromptVersionRef`, plain `TypeError`) before any session mutation, stores it on a new run-scoped `activePromptVersion` field cleared in the run's `finally` block, and copies it onto both start and finish `RunRecord`s via conditional spread — absent refs add no field, so unset behavior is byte-identical. Secure-agent per-run guards are untouched (`promptVersion` is benign host data, not a policy seam).
    - **Durable shape:** shared persistence schema model bumped 8 → 9 with a nullable `prompt_version` JSON column on `prism_runs` and checked migration `009_run_prompt_version` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on PostgreSQL, plain `ALTER TABLE ... ADD COLUMN` on SQLite — no backfill needed). SQLite `upsertRun` statement and PostgreSQL insert/update both bind the row value; legacy rows stay `NULL` and decode as `undefined`.
    - **Codecs:** `@arnilo/prism-session-store-codecs` `RunRow` carries `prompt_version`; `runRecordToRow`/`rowToRunRecord` stringify/parse it like every other JSON column. Adapter packages are the only `RunRow` consumers.
    - **Testing:** core round-trip through an in-memory ledger (ref on start + finish, absent when unset, malformed refs rejected before any ledger write — bad hash, `version: 0`, empty/oversize name, non-object), field-policy export deny (`promptVersion` path → `[DENIED]`) plus secret-redactor rewrite inside a ref (`[REDACTED]`); SQLite adapter round-trip incl. reopen; PostgreSQL adapter round-trip verified against a live throwaway server (`docker run postgres:16`, `PRISM_TEST_POSTGRES_URL` set) — the full protected suite passes 32/32, not just the skip path.
    - **Additive-only evidence:** `scripts/phase25-compat-diff.mjs` shows zero REMOVED; the only Task 3 delta is the `PERSISTENCE_SCHEMA_VERSION` literal 8 → 9 (deliberate schema-version bump); no interface-member removals. `PromptVersionRef` added to `FROZEN_TYPE_EXPORTS` (frozen-surface test updated deliberately).
    - **Docs:** `docs/runs-and-usage.md` "Prompt provenance" section, `docs/prompt-registry.md` "Run provenance" section, `docs/database-persistence.md` migration-009 run-column note, `docs/migration.md` additive entry (schema version 9, forward-only).
    - **OTel decision:** spans carry no prompt attribute by construction (the instrumentation maps `AgentEvent`s, which never contain refs or bodies), so no OTel change was needed — "only as opaque refs" holds because the durable ledger record is the provenance of record and any host-added attribute would flow through `policyAttrs` field-policy screening. Recorded here to keep the seam additive-minimal.
  - Acceptance Criteria:
    - Functional: host-supplied `promptVersion` ref (name, version, content hash) is accepted by `RunOptions`, copied to start/finish `RunRecord`s when provided, and round-trips through first-party SQLite/Postgres ledgers; absent by default (zero behavior change); rendered in ledger reads and OTel attributes only as opaque refs (redaction-safe).
    - Performance: no measurable run-path cost when unset (single optional field write).
    - Code Quality: additive-only verified by compat baseline; typed optional field; migration guide additive note.
    - Security: refs are opaque ids + hashes — never prompt bodies in telemetry; ledger export respects existing field-policy redaction.
  - Approach:
    - Documentation Reviewed: `src/contracts-protocol.ts`, `src/agent-session/session.ts`, `docs/runs-and-usage.md`, `docs/observability.md` (attribute policy), `docs/migration.md` additive precedent.
    - Options Considered:
      - Full prompt body capture in ledger: rejected — bodies can be large and may contain untrusted fragments; provenance needs identity, not content (content is recoverable via store hash).
      - Reserved key inside free-form `RunRecord.metadata`: rejected — metadata is host-owned and unvalidated, so collisions and body-shaped payloads would weaken the provenance contract.
      - Opaque version ref + hash in a nullable run column: chosen — explicit typing, no metadata collision, additive migration keeps legacy rows valid.
    - Chosen Approach: optional typed field on `RunOptions` and `RunRecord`; first-party SQLite/Postgres adapters persist it as nullable `prompt_version` JSON, while store lookup for body retrieval stays host-side.
    - API Notes and Examples:
      ```ts
      await session.run("Hi", { promptVersion: { name: "support-agent", version: 7, hash: "sha256:..." } });
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts` (typed `RunOptions.promptVersion` and `RunRecord.promptVersion` fields), `src/agent-session/session.ts` (copy the ref into start/finish records).
      - `src/testing/persistence-schema.ts` (schema model/migration contract), `packages/session-store-codecs/src/index.ts` (row mapping), `packages/session-store-sqlite/src/{ddl,migrations,persistence}.ts`, `packages/session-store-postgres/src/{ddl,migrations,persistence}.ts` (nullable `prompt_version` column and additive checked migration).
  - Test Cases to Write:
    - Ledger round-trip: ref persisted and re-read identical; absent field stays absent (compat).
    - Redaction: ledger export with field policy denies body-shaped values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive run option.
    - Docs pages to create/edit: `docs/runs-and-usage.md`, `docs/prompt-registry.md` provenance section, `docs/database-persistence.md` run-column note, `docs/migration.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Eval-Gated Promotion Helper (2026-08-30)
  - **Completion Evidence (2026-08-30):**
    - **Implementation:** `packages/prompts/src/promotion.ts` — `assertPromptPromotion` resolves candidate + baseline versions read-only (`resolve` only; verified by a version-count assertion in the read-only test), runs them head-to-head through `runComparison` (candidates `{ candidate, baseline }`; host supplies the body→runner bridge), and returns a typed `PromptPromotionVerdict` (`promote`/`hold`, per-scorer `wins/losses/ties/failures` aggregates, `winRate`, raw `ComparisonReport`, bounded redacted `reportJson` via `serializeEvaluationReport`, `reasons` on hold).
    - **Gates:** default gate = candidate must win strictly more scored comparisons than baseline; optional `minimumWinRate` (finite `[0,1]` — threshold equality passes) and `thresholds` forwarded to `assertEvaluationThreshold` verbatim (e.g. `minimumCandidateWins`, `maximumFailures`) — no duplicate scoring logic.
    - **Optional peer pattern:** `@arnilo/prism-evals` declared as an optional peer (`peerDependenciesMeta.optional`, devDependency `file:../evals`) with dynamic `import()` + fail-closed `ERR_PRISM_PROMPT_EVALS_PEER` naming the install step — mirrors the `document-reader` optional-parser precedent; type-only imports keep the evals load out of the store adapters entirely.
    - **Fixed during testing:** initial helper had no default majority gate — a candidate that lost every comparison still returned `promote` when no explicit gates were set; added the strict-win-majority default and a regression test ("holds when the candidate loses"). Package `test` script widened to `dist/__tests__/*.test.js` so the new suite actually runs.
    - **Tests:** `packages/prompts/src/__tests__/promotion.test.ts` — deterministic mock agent + marker scorer: promote (4–0, read-only store assertion), hold (0–4 with parsed bounded `reportJson`), **boundary at threshold equality** (`minimumWinRate: 0.5` with 2 wins + 2 ties promotes; `0.6` holds), threshold forwarding (`minimumCandidateWins` → hold with gate message), same-version rejection, label-based resolution. 10 pass, 0 fail.
    - **Docs:** `docs/prompt-registry.md` "Eval-gated promotion" section (verdict shape, gates, host-applies-the-promotion note), `docs/evaluations.md` cross-link, `packages/prompts/README.md` usage section.
    - **Checks:** root suite 1725 pass / 0 fail; `@arnilo/prism-prompts` 10 pass / 1 protected-skip; Biome clean; compat diff unchanged from Task 3 (zero REMOVED — optional peer is not an API delta).
  - Acceptance Criteria:
    - Functional: `assertPromptPromotion({ store, dataset, candidates: { current, candidate }, scorers, thresholds })` wraps `runComparison` and returns a typed verdict (promote/hold) with per-scorer aggregates; failure carries the bounded report (`serializeEvaluationReport` reuse).
    - Performance: bounded by existing experiment concurrency caps.
    - Code Quality: no duplicated scoring logic — thin composition over `runComparison` + `assertEvaluationThreshold`.
    - Security: candidate resolution is read-only on the store; no writes during evaluation.
  - Approach:
    - Documentation Reviewed: `packages/evals/src/comparison.ts`, `packages/evals/src/threshold.ts`, `docs/evaluations.md`.
    - Options Considered: copy LangSmith's "deploy automatically on win": rejected — promotion is a host decision; Prism returns verdicts.
    - Chosen Approach: assert-style helper, no automatic anything.
    - API Notes and Examples:
      ```ts
      const verdict = await assertPromptPromotion({ store, dataset, name: "support-agent",
        candidateVersion: 7, baselineVersion: 6, scorers, threshold: 0.8 });
      ```
    - Files to Create/Edit: `packages/prompts/src/promotion.ts`.
  - Test Cases to Write:
    - Promotion pass/fail with mock agent + deterministic scorers; boundary at threshold equality.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package export.
    - Docs pages to create/edit: `docs/prompt-registry.md` promotion section; `docs/evaluations.md` cross-link.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Release and Docs Truth (2026-08-30)
  - **Completion Evidence (2026-08-30):**
    - **Manifest truth:** `scripts/package-truth.json` regenerated (62 publishable / 61 workspace / 34 capability / 55 codeWithPeer); release truth gates updated for the new package following the established post-baseline package pattern (`scripts/phase27-release.test.mjs`, `phase29-freeze`, `phase30-freeze`, `phase24-truth` secondPeers map now pins `@arnilo/prism-prompts: ["@arnilo/prism-evals"]` as its only non-core peer); earlier Task 2 updates already cover `packaging.test.ts`, `docs.test.ts`, `release-and-install.md`, `README.md`, `docs/index.md`.
    - **Umbrella decision recorded (default taken):** `@arnilo/prism-prompts` is deliberately outside `@arnilo/prism-all` and every profile package — explicit host opt-in like `@arnilo/prism-computer-use-linux`, unlike `@arnilo/prism-memory`/`@arnilo/prism-rag` (umbrella members). Recorded in `docs/release-and-install.md` line-20 membership passage and the frozen omission sets (`packaging.test.ts` optOutOfAll, README). Independent publish at reviewed initial `0.0.1`.
    - **Changed-package cut (Decision B):** the Task 3 source changes to `@arnilo/prism-session-store-codecs`, `@arnilo/prism-session-store-sqlite`, and `@arnilo/prism-session-store-postgres` require base+patch per the phase34 version-derivation freeze — all three bumped `0.3.0` → `0.3.1` with CHANGELOG entries describing the additive prompt-provenance support; internal ranges stay `^0.3.0`; root stays `0.3.2` (already post-baseline). Lockfile + package-truth regenerated.
    - **Historical freeze remediations:** `phase12-freeze-manifest.json` `schemaVersion` 8 → 9 with `$comment` recording the plan 042 Task 3 additive migration; release/freeze tests that enumerate the live filesystem gained `prompts` exclusions exactly where post-baseline packages were already excluded (phase13-21, incl. dependency-name fingerprints and the phase16 lockfile name-set); `phase13-baseline.json` mtime re-stamped after the freeze-manifest edit per the phase-ordering check.
    - **Lint gate:** fixed the two pre-existing Biome diagnostics in plan 041 files (`tool-search.test.ts` unused `intended` param dropped at declaration + call; `tool-conformance.ts` `!text || text.type !== "text"` → optional-chain `text?.type !== "text"`); `biome lint .` now exits 0 for the phase23 gate.
    - **Live-verified protected legs (throwaway pgvector/pgvector:pg16, the frozen CI image family):** `@arnilo/prism-session-store-postgres` 32/32, core `phase12-restart-recovery` 4/4 (schema v9 under restart/fencing), and `@arnilo/prism-prompts` **11/11 — which caught a real latent Task 2 defect**: `buildPromptMigration001Ddl` emitted schema-qualified `CREATE INDEX IF NOT EXISTS "schema"."index"`, a PostgreSQL syntax error (`syntax error at or near "."`) invisible to the skipped protected leg; fixed to an unqualified index name (indexes live in the table's schema; readiness probe already matched by schemaname+indexname). Verified green after the fix.
    - **Tarball + audit + secret-scan:** `npm pack --dry-run` for `@arnilo/prism-prompts` ships dist/README/CHANGELOG/LICENSE/package.json, 40 files, 19.4 kB (within budget gates); `npm audit --omit=dev` 0 vulnerabilities (moderate threshold met); phase27 secret scan clean across source/docs/scripts.
    - **Checks:** full `npm test` green end to end — root dist 1725/1725, all script gates (incl. phase12/13-21/23/24/25/26/27/29/30/34) zero failures, workspace tests pass, zero ✖ lines in the complete log; Biome clean on all touched files; compat baseline unchanged (zero REMOVED).
  - Acceptance Criteria:
    - Functional: independent publish at `0.0.1`; manifest-count tripwires regenerated; included in `prism-all` umbrella only if umbrella membership review approves (default: not in umbrellas, mirrors memory/RAG optional precedent — record decision).
    - Performance: tarball within budget gates.
    - Code Quality: `npm test` green incl. new suites; audit/secret-scan clean.
    - Security: threat note: registry is host-trusted data; untrusted prompt injection defense stays at the existing untrusted-content boundaries.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`, `scripts/release.mjs`.
    - Options Considered / Chosen Approach: independent 0.0.1; umbrella decision recorded in plan closeout.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `docs/release-and-install.md`, `docs/index.md`, `docs/prompt-registry.md` final review.
  - Test Cases to Write: docs tripwire for new package consistency.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — catalog addition.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- No prompt playground UI in this plan — dev inspector (plan 040) covers interactive testing later. (Known ceiling.)
- Promotion verdicts are return values, not thrown assertions: the plan's API note (`const verdict = await assertPromptPromotion(...)`) chose report-style over fail-the-process style; hosts wanting CI-fail-closed wrap it and throw with `verdict.reportJson`.
- The default promotion gate is a strict win-majority (candidate must win strictly more scored comparisons than the baseline); hosts wanting rate-based gates set `minimumWinRate` explicitly. Documented in `docs/prompt-registry.md`.
- Prompt provenance travels only on start/finish `RunRecord`s (durable ledger is the provenance of record); OTel spans carry no prompt attribute — any host-added span attribute flows through the existing field-policy redaction.
- `assertPromptPromotion` resolves at most two versions per run (candidate/baseline), not per-item versions — a sweep over many candidate versions is the host's loop.
- Umbrella membership: `@arnilo/prism-prompts` deliberately outside `@arnilo/prism-all` and profile packages (explicit host opt-in, Task 5).

## Further Actions

- Release cut when convenient: publish `@arnilo/prism-prompts@0.0.1` independently plus the three `0.3.1` store packages (`session-store-codecs`, `session-store-sqlite`, `session-store-postgres`) from this plan's changes; `npm run release:gate` on a clean tree.
- Host-side helper worth adding later: a `run`-bridge factory that wires a resolved prompt body into a standard agent (`hostRunnerFactory(prompt.body)`) — deliberately left to hosts because composition is host-specific (system-prompt layer, templates, attachments).
- Postgres prompt-store protected leg is skip-gated in the default run (`PRISM_TEST_POSTGRES_URL`); consider adding it to a CI protected matrix like the session-store postgres leg (plan 056 pattern).
- Eval-gated labels (auto-relabel `production` after N green verdicts) remain a non-goal — promotion is a host decision; revisit only if a workflow demands it.