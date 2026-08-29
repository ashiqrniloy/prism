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

- Hosts can `putPromptVersion` / `listPromptVersions` / `resolvePromptVersion` through memory or durable adapters (SQLite/Postgres via existing `session-store-codecs` persistence primitives).
- Run ledger records carry the prompt version ref (additive field), rendered through existing redaction.
- `assertPromptPromotion` helper runs a `runComparison` between two versions against a dataset and returns a pass/fail verdict with per-scorer aggregates — reusable in CI.
- Package publishes independently at `0.0.1`; no core changes required for the store itself; run-ledger provenance field is a core additive seam.

## Tasks

- [ ] Task 1 — Primitive Review: Prompt Store as Contract, Not Layering Change
  - Acceptance Criteria:
    - Functional: inventory `src/system-prompts.ts` (explicit user/package/app/run layers), `src/run-ledger.ts` (record shape, where additive fields are tolerated), `packages/evals/src/comparison.ts` (`runComparison` candidates), `packages/session-store-codecs` (shared persistence codecs), `packages/policy` audit envelope signing (provenance precedent). Confirm: registry is a new store contract; core needs only one additive provenance field (or a metadata pass-through already present — record which).
    - Performance: resolve-version is a map lookup (memory) / indexed read (durable); no scan on the hot path.
    - Code Quality: no changes to `resolveSystemPrompt` layering order; versioned bodies compose as one layer input the host already controls.
    - Security: prompt bodies are host-authored but may contain rendered untrusted fragments — storage treats them as data (bounded size caps), never evaluated; version records immutable + content-hashed (SHA-256, reusing existing hashing patterns).
  - Approach:
    - Documentation Reviewed:
      - `docs/system-prompts.md`, `docs/runs-and-usage.md`, `docs/evaluations.md`, `docs/session-store-codecs` surfaces (`packages/session-store-codecs/`), `docs/audit-export.md` (RFC 8785 + SHA-256 chain precedent for immutable records).
    - Options Considered:
      - Extend `src/system-prompts.ts` with versioning: rejected — prompt layering is runtime composition; versioning is asset lifecycle. Mixing them couples every host to a store.
      - New optional `@arnilo/prism-prompts` package with a `PromptStore` contract: chosen — mirrors `RunFeedbackStore`/`EvaluationStore` precedent (contract + memory + durable adapters).
    - Chosen Approach:
      - Contract-first package; memory adapter in-package; SQLite/Postgres adapters via the shared codecs package pattern (same split as session stores).
    - API Notes and Examples:
      ```ts
      import { createMemoryPromptStore, putPromptVersion } from "@arnilo/prism-prompts";
      const store = createMemoryPromptStore();
      const v7 = await putPromptVersion(store, { name: "support-agent", body: "...", labels: ["app"] });
      const resolved = await store.resolve({ name: "support-agent" }); // latest
      ```
    - Files to Create/Edit:
      - `packages/prompts/package.json` (`@arnilo/prism-prompts` 0.0.1, peer `^0.3.0`), `packages/prompts/src/types.ts`, `packages/prompts/src/store.ts`, `packages/prompts/src/index.ts`.
  - Test Cases to Write:
    - Immutability: second put with same version id is rejected; records content-hashed; tamper check fails loud.
    - Resolve: latest/by-version/by-label ordering deterministic.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package.
    - Docs pages to create/edit: `docs/prompt-registry.md` (full API-page structure).
    - `docs/index.md` update: yes — under "Input, prompt, and context assembly".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — Store Contract, Memory Adapter, Durable Adapters
  - Acceptance Criteria:
    - Functional: `PromptStore`: `put` (new version), `list` (cursor-paged, name-filtered), `resolve({ name, version? , label? })`, `diff(a, b)` (bounded line diff), ownership scoping like every Prism store. SQLite adapter (better-sqlite3, mirroring `packages/session-store-sqlite` migration-checksum pattern) and Postgres adapter (pooled `pg`, mirroring `packages/session-store-postgres`).
    - Performance: p95 resolve < existing session-read envelope; list pages bounded (frozen caps per `limits.ts` pattern).
    - Code Quality: adapters pass a `prompt-store-conformance` helper (new, in `src/testing/` or package-local per existing conformance placement rules); SQL dialect lives in adapters, shared shapes in `session-store-codecs` only if ≥2 adapters need them (they do).
    - Security: ownership filter on every read/write (tenant boundary); bounded body bytes (fail-closed `ERR_PRISM_PROMPT_*`); no secret-scan hits in fixtures; durable adapters validate checksummed migrations (migration refusal tested).
  - Approach:
    - Documentation Reviewed:
      - `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `packages/session-store-sqlite/src/`, `packages/session-store-postgres/src/` (advisory-locked checksummed migrations).
      - `docs/agent-identity.md` — ownership scoping precedent.
    - Options Considered:
      - Filesystem-only store: rejected — ownership scoping and tenant boundaries need the same rigor as other durable state; filesystem is a dev convenience not a contract.
      - Reuse session-store tables: rejected — different lifecycle (immutable, app-versioned).
    - Chosen Approach: contract + memory + SQLite + Postgres, conformance helper, frozen caps.
    - API Notes and Examples:
      ```ts
      const diff = await store.diff("support-agent", 6, 7); // bounded line diff for side-by-side
      ```
    - Files to Create/Edit:
      - `packages/prompts/src/memory.ts`, `packages/prompts/src/sqlite.ts`, `packages/prompts/src/postgres.ts`, `packages/prompts/src/conformance.ts`, `packages/prompts/src/errors.ts`, `packages/prompts/src/limits.ts`.
  - Test Cases to Write:
    - Conformance leg run against all three adapters (memory in `npm test`; sqlite in-package; postgres in `test:postgres` protected profile).
    - Ownership: cross-tenant resolve/list rejected.
    - Migration: stale checksum refused (sqlite/postgres precedent).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — adapters + conformance.
    - Docs pages to create/edit: `docs/prompt-registry.md` adapters section; `docs/database-persistence.md` cross-link.
    - `docs/index.md` update: no (Task 1 entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Run-Ledger Prompt Provenance (Additive Core Seam)
  - Acceptance Criteria:
    - Functional: host-supplied `promptVersion` ref (name, version, content hash) recorded on the run ledger record when provided; absent by default (zero behavior change); rendered in ledger reads and OTel attributes only as opaque refs (redaction-safe).
    - Performance: no measurable run-path cost when unset (single optional field write).
    - Code Quality: additive-only verified by compat baseline; typed optional field; migration guide additive note.
    - Security: refs are opaque ids + hashes — never prompt bodies in telemetry; ledger export respects existing field-policy redaction.
  - Approach:
    - Documentation Reviewed: `src/run-ledger.ts`, `docs/runs-and-usage.md`, `docs/observability.md` (attribute policy), `docs/migration.md` additive precedent.
    - Options Considered:
      - Full prompt body capture in ledger: rejected — bodies can be large and may contain untrusted fragments; provenance needs identity, not content (content is recoverable via store hash).
      - Opaque version ref + hash: chosen.
    - Chosen Approach: optional typed field on run records; store lookup for body retrieval stays host-side.
    - API Notes and Examples:
      ```ts
      await session.run("Hi", { promptVersion: { name: "support-agent", version: 7, hash: "sha256:..." } });
      ```
    - Files to Create/Edit:
      - `src/run-ledger.ts` (additive field), `src/agent-session.ts` (pass-through, per current module layout after the 0.2.5 split).
  - Test Cases to Write:
    - Ledger round-trip: ref persisted and re-read identical; absent field stays absent (compat).
    - Redaction: ledger export with field policy denies body-shaped values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive run option.
    - Docs pages to create/edit: `docs/runs-and-usage.md`, `docs/prompt-registry.md` provenance section, `docs/migration.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4 — Eval-Gated Promotion Helper
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

- [ ] Task 5 — Release and Docs Truth
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

- To be filled after tasks are completed and tests pass. (Known ceiling: no prompt playground UI in this plan — dev inspector (plan 040) covers interactive testing later.)

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.