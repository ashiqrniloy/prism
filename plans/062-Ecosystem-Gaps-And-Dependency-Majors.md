# Ecosystem Gaps and Dependency Majors

Source: `docs/_evidence/implementation-review-2026-09-03.md` §7 P1 (ecosystem gaps)
and §6 (deferred dependency majors, Impeccable ownership). Cleanup track after the
review's main sequence (plans 056–061).

## Objectives

- Close review §7 P1 gaps: reranker adapters, model-list discovery with provenance, capture middleware, cost/catalog host adapter, and the browser/edge profile decision (decide, not necessarily build).
- Execute deferred dependency majors safely: `@napi-rs/keyring` 2, `better-sqlite3` 13 (+types), `pdf-parse` 2 — each behind migration + test matrix, not blind bumps.
- Resolve Impeccable ownership: consume upstream package or own vendored snapshot with recorded upstream commit.

## Expected Outcome

- Each P1 gap either implemented with contract+adapter+conformance or explicitly rejected with rationale recorded here.
- Deferred majors upgraded with green full suites and Node 20/26 matrix evidence.
- One ownership model for Impeccable documented in `docs/_evidence/`.

## Tasks

- [ ] Reranker implementation adapters
  - Acceptance Criteria:
    - Functional: memory package's existing reranker **host contract** gains implementation adapters (OpenAI-compatible `rerank` route + one independent provider), exported from the owning package with conformance fake.
    - Performance: no adapter-side batching beyond provider limits.
    - Code Quality: reuse existing contract types verbatim — no contract changes.
    - Security: input caps; no document content logged.
  - Approach:
    - Documentation Reviewed: `packages/memory` reranker host contract (graft skeleton); provider rerank API shapes.
    - Options Considered: new core contract (rejected — contract exists) vs adapters on existing host contract (chosen).
    - Chosen Approach: adapters only.
    - API Notes and Examples:
      ```ts
      const ranked = await reranker.rerank({ query, documents, topK: 5 });
      ```
    - Files to Create/Edit: `packages/memory/src/…` or providers-family reranker modules (per existing contract location); tests.
    - References: review §7 P1 bullet 1.
  - Test Cases to Write: fake conformance (score ordering, caps, empty input).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new adapters.
    - Docs pages to create/edit: extend the memory/RAG docs page with adapter list.
    - `docs/index.md` update: no (existing page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Model-list/capability discovery result with provenance
  - Acceptance Criteria:
    - Functional: `listModels()` normalized result (id, context window, capabilities, pricing hint when provided) with `provenance` (provider, fetchedAt, source: api|catalog) and cache-TTL guidance; adapters for OpenAI-compatible `/v1/models` + one independent provider.
    - Performance: cached per provider with configurable TTL; no per-call network in loops.
    - Code Quality: conformance fake; capability fields merged from provider metadata + catalog overrides where hosts supply them.
    - Security: discovery request uses existing credential/egress seams.
  - Approach:
    - Documentation Reviewed: existing model metadata structures in `ModelConfig`/capabilities; OpenAI models list API.
    - Options Considered: hard-coded catalog in core (rejected by review) vs normalized passthrough + host catalog merge (chosen).
    - Chosen Approach: passthrough normalization; hosts own overrides.
    - API Notes and Examples:
      ```ts
      const { models, provenance } = await provider.listModels({ ttlMs: 3_600_000 });
      ```
    - Files to Create/Edit: contracts/models module; two adapters; tests.
    - References: review §7 P1 bullet 2.
  - Test Cases to Write: normalization fake (mixed capability sources), TTL honored, provider error typed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/models.md` (extend existing provider/model docs page if present).
    - `docs/index.md` update: no if extending existing page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Request/response capture middleware with privacy policy
  - Acceptance Criteria:
    - Functional: opt-in middleware capturing provider request/response events (already-normalized shapes, not raw HTTP) with explicit privacy policy field (`redact: "secrets"|"all"|"none"` default `secrets`) and replay-safe redaction (same redaction helpers as logging seams).
    - Performance: disabled by default with zero overhead; enabled path adds one event copy per round.
    - Code Quality: implemented on existing middleware/extension seam — no new seam.
    - Security: default redaction drops message content unless host opts in; captured buffers capped.
  - Approach:
    - Documentation Reviewed: existing extension/middleware seam (`docs/public-contracts.md` extension group); redaction helpers.
    - Options Considered: provider-level tap (couples to adapters) vs middleware on existing seam (chosen).
    - Chosen Approach: middleware + capped ring buffer export.
    - API Notes and Examples:
      ```ts
      const capture = createProviderCapture({ policy: { redact: "secrets", maxEvents: 100 } });
      agent.use(capture.middleware());
      ```
    - Files to Create/Edit: middleware module in owning package; tests.
    - References: review §7 P1 bullet 4.
  - Test Cases to Write: redaction drops secrets by default; opt-in content retained; buffer cap eviction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/observability.md` (extend existing telemetry/debug docs page).
    - `docs/index.md` update: no if extending.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Cost/catalog freshness as host adapter
  - Acceptance Criteria:
    - Functional: pricing lookup moves behind a host-supplied `CostCatalog` adapter (fetch by model id, TTL, currency); core ships no hard-coded pricing tables; usage-based cost computation consumes the adapter when present, otherwise reports usage only.
    - Performance: catalog lookups cached; absent catalog = zero cost code paths execute.
    - Code Quality: default adapter = none (usage-only), documented.
    - Security: catalog fetch through egress seam; failures degrade to usage-only.
  - Approach:
    - Documentation Reviewed: current pricing/usage reporting code paths; review §7 P1 bullet 5.
    - Options Considered: vendored pricing JSON in core (staleness liability, rejected) vs host adapter (chosen).
    - Chosen Approach: adapter contract + usage-only fallback.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({ /* … */, costCatalog: hostCatalog /* optional */ });
      ```
    - Files to Create/Edit: contracts module + wiring where usage is reported; tests.
    - References: review §7 P1 bullet 5.
  - Test Cases to Write: with catalog → cost fields present; without → usage only; stale catalog (TTL expired) degrades gracefully.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional config surface.
    - Docs pages to create/edit: `docs/cost-tracking.md` (create) or extend usage docs page.
    - `docs/index.md` update: yes if new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Browser/edge profile decision
  - Acceptance Criteria:
    - Functional: a recorded decision — either (a) rejected for now with rationale (Node-first runtime deps like sqlite/keyring make edge impractical today), or (b) accepted with a minimal subpath plan proposal; no half-built artifacts land.
    - Performance: n/a.
    - Code Quality: decision + evidence in `docs/_evidence/edge-profile-decision-<date>.md`; roadmap updated.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: dependency inventory (native/Node-only deps per package); review §7 P1 bullet 3.
    - Options Considered: full edge subpath (high cost, unproven demand) vs decision-defer (chosen default: reject-with-rationale unless user demand exists).
    - Chosen Approach: write the decision doc; revisit trigger = concrete user request for browser/worker targets.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `docs/_evidence/edge-profile-decision-<date>.md`; `roadmap.md` non-goals/lines update.
    - References: review §7 P1 bullet 3.
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence + roadmap.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Dependency major: `@napi-rs/keyring` 1.3 → 2.0
  - Acceptance Criteria:
    - Functional: keyring 2 integrated with credential store tests green on Linux/macOS/Windows CI legs where keyring is exercisable; behavior unchanged for hosts.
    - Performance: no credential-read latency regression.
    - Code Quality: migration notes in CHANGELOG; breaking upstream changes mapped (2.0 storage/API changes).
    - Security: keyring 2 migration is a credential-storage boundary — full credential suites + redaction checks must pass before merge.
  - Approach:
    - Documentation Reviewed: `@napi-rs/keyring` 2.0 release notes/changelog (migration section); `packages/prism-core/src/credentials` keyring adapter.
    - Options Considered: defer (carries audit surface) vs migrate behind adapter interface (chosen — adapter isolates upstream API changes).
    - Chosen Approach: update adapter only; add compatibility test that round-trips an entry per platform leg.
    - API Notes and Examples: n/a (adapter internals).
    - Files to Create/Edit: `packages/prism-core/src/credentials/node/keyring*` ; `package.json`s; CHANGELOG.
    - References: review §6 deferred table.
  - Test Cases to Write: round-trip per platform leg; graceful failure on keyring-absent environments (existing pattern).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal adapter).
    - Docs pages to create/edit: `docs/credentials.md` note if storage format changed upstream.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Dependency major: `better-sqlite3` 12 → 13 (+types)
  - Acceptance Criteria:
    - Functional: better-sqlite3 13 with `@types/better-sqlite3` 9 integrated; all sqlite session/enterprise suites green; prepared-statement reuse preserved.
    - Performance: persistence benchmarks non-regressed (±5%); no new sync I/O on hot paths.
    - Code Quality: native ABI requirements (Node matrix) documented in engines/CI; rebuild instructions for hosts in CHANGELOG.
    - Security: no SQL construction changes; existing injection tests green.
  - Approach:
    - Documentation Reviewed: better-sqlite3 13 release notes (Node support matrix); `packages/prism-core/src/sessions/sqlite/*`.
    - Options Considered: stay on 12 (receives no fixes eventually) vs migrate with matrix evidence (chosen).
    - Chosen Approach: bump + run Node 20/26 legs + packed-install smoke (native module must load from packed tarball).
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `package.json`s; any API deltas in sqlite adapter; CHANGELOG.
    - References: review §6 deferred table.
  - Test Cases to Write: existing sqlite suites + packed-install native-load smoke test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (runtime requirement change documented).
    - Docs pages to create/edit: `docs/release-and-install.md` Node/ABI matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Dependency major: `pdf-parse` 1.1 → 2.4
  - Acceptance Criteria:
    - Functional: pdf-parse 2 integrated into document-reader path; golden PDF fixtures (text, tables, scanned-error case) round-trip identically or deltas documented.
    - Performance: parse of 100-page fixture within existing reader budget.
    - Code Quality: engine constraints (2.x bundling) documented; no `require` of removed internals.
    - Security: untrusted-PDF caps preserved (size/page limits); fuzz smoke for malformed PDFs.
  - Approach:
    - Documentation Reviewed: pdf-parse 2 migration notes (API/engine constraints); current reader call sites.
    - Options Considered: defer (works today) vs migrate with golden deltas (chosen — parser CVE class argues for current).
    - Chosen Approach: migrate reader adapter; golden-corpus diff recorded.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: document-reader module; `package.json`s; golden fixtures if deltas accepted; CHANGELOG.
    - References: review §6 deferred table.
  - Test Cases to Write: golden PDF corpus tests (existing + any new malformed fixtures).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none` (reader internals).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Impeccable ownership decision
  - Acceptance Criteria:
    - Functional: one recorded model — consume upstream npm package (if publishable) or own vendored snapshot with upstream commit recorded in a PROVENANCE file; no third state.
    - Performance: n/a.
    - Code Quality: `docs/_evidence/impeccable-ownership-<date>.md` records decision + migration steps if any.
    - Security: if vendored, snapshot commit pinned and tracked for upstream security fixes.
  - Approach:
    - Documentation Reviewed: current Impeccable integration (source/skill files in coding-tools); upstream availability.
    - Options Considered: leave ambiguous (rejected — review flags it) vs decide + record (chosen).
    - Chosen Approach: prefer upstream package when it exists and matches; else vendored-with-provenance.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: evidence doc; PROVENANCE file or dependency entry depending on decision.
    - References: review §6 Impeccable paragraph.
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence doc.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
