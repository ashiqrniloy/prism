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

- [x] Reranker implementation adapters (done 2026-09-04: `createOpenAiCompatibleReranker` (Cohere-shaped `{results:[{index,relevance_score}]}` route — Jina/vLLM/SiliconFlow/Together) + `createVoyageReranker` (independent provider, `{data:[…]}` envelope, required Bearer key) + `createFakeReranker` + `runRerankerConformance` exported from `@arnilo/prism-memory/rag`; shared HTTP core extracted to `rag/rerank-shared.ts` and TEI adapter refactored onto it (behavior unchanged, its suite green); no `top_k` sent — retrieval seam owns top-K; one request per rerank (no adapter-side batching); `docs/rag.md` extended; full memory suite 302 pass / 0 fail, workspace typecheck green.)
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

- [x] Model-list/capability discovery result with provenance (done 2026-09-04: `ModelDiscovery`/`ModelDiscoveryResult`/`ModelDiscoveryProvenance` contract types next to `ModelConfig` in core `@arnilo/prism` (auto-exported via the contracts barrel, no contract changes to existing types); adapters in `@arnilo/prism-providers/model-discovery` — `createOpenAiCompatibleModelDiscovery` (`GET <baseUrl>/models` → `{data:[{id}]}`) + `createGoogleModelDiscovery` as the independent provider (`/v1beta/models`, `x-goog-api-key`, `nextPageToken` pagination) + `createFakeModelDiscovery` + `mergeModelCatalog` + `runModelDiscoveryConformance`; per-instance TTL cache (default 3,600,000 ms, `ttlMs: 0` forces refresh) so loops do no network; typed `ModelDiscoveryError` with credential redaction; requests ride `CredentialValueSource` + bounded transport; 7 new tests green, providers suite 511 pass / 0 fail, workspace typecheck green, `docs/model-registry.md` extended.)
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

- [x] Request/response capture middleware with privacy policy (done 2026-09-04: `createProviderCapture()` in core `@arnilo/prism` (src/capture.ts, exported from the root barrel) — request side rides the existing `provider_request` middleware hook as a pass-through observer, response side rides the existing subscriber-event seam (`capture.observeEvent(provider_turn_finished)` fed from `session.subscribe()`); no new seam, per the middleware-hooks doc rule that output observation belongs to subscriber events. Policy `redact: "secrets"|"all"|"none"` default `secrets` drops message content unless the host opts in; secret redaction via the shared logging helpers is unconditional (replay-safe in every mode); options/headers never captured; capped FIFO ring buffer (`maxEvents`, default 100, hard cap 10,000) exported via `capture.events()`. Disabled by default with zero overhead; enabled path adds one entry per round. 7 tests green (redaction drops secrets by default, opt-in content retained, buffer-cap eviction, pass-through identity, response entries, inert-when-unregistered, maxEvents validation); root suite 1633 pass / 0 fail; docs/observability.md extended.)
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

- [x] Cost/catalog freshness as host adapter (done 2026-09-04: `CostCatalog` interface in core `contracts-core/content.ts` — `get(modelId)` resolves a `ModelCost` quote or `undefined`; reuses `ModelCost`/`Usage` verbatim, no new pricing shapes. Wired via `AgentConfig.costCatalog` (per the plan's `createAgent({ costCatalog })` note): `recordProviderUsage` enriches turn usage when the provider reported no cost, before limit charging, run-total aggregation, and the ledger write, so cost flows everywhere usage does. Defaults: no catalog configured = zero cost code paths; stale/unknown quote → `undefined` → usage-only; throwing catalog → usage-only; non-`per_million_tokens` unit quotes ignored (conservative money path). Provider-reported cost always wins — catalog not consulted. Core ships no pricing tables. 6 tests green (catalog → cost present, absent → usage only, stale TTL degrades, failure degrades, unit mismatch ignored, provider cost precedence); root suite 1639 pass / 0 fail; docs/runs-and-usage.md extended with a Cost/catalog freshness section.)
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

- [x] Browser/edge profile decision (done 2026-09-04: **rejected for now** — decision + evidence in docs/_evidence/edge-profile-decision-2026-09-04.md. Hard blockers: native addons on core seams (better-sqlite3 sessions/prompt-store, @napi-rs/keyring credentials) and `node:` built-ins across the core barrel (26 files in root @arnilo/prism incl. retry/content/ids/pinned-fetch/tool-effects, 43 in prism-core, 58 in coding-tools, 6 in providers incl. Bedrock SigV4 crypto) — an edge profile is a parallel build graph with seam extraction, not an exports-map condition. No demand signal; half-built subpath explicitly rejected. Revisit trigger: concrete browser/worker request AND node:-free (host-injectable) core loop. roadmap.md Non-Goals updated. No code artifacts landed.)
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

- [x] Dependency major: `@napi-rs/keyring` 1.3 → 2.0 (done 2026-09-04: bumped to `^2.0.0`; upstream 2.0 changes error reporting only — reads/deletes now reject on locked stores instead of silently resolving `undefined`/`false`; missing-credential and success paths unchanged. Adapter needed zero code changes: every native call already routes through `runKeychainOperation` → typed-error mapping, and the new rejections flow into `CredentialStoreLockedError`/`CredentialStoreUnavailableError` — strictly safer semantics: a locked keychain no longer masquerades as an empty vault (1.x could cause a `set()` to overwrite the real vault). Async signatures (signal params, binary getSecret, AsyncEntry) unchanged. Evidence: credential-node suite 75/75 green; live Secret Service round-trip (credential + OAuth set/get/delete) green on Linux under keyring 2.0.0 via the existing `PRISM_TEST_KEYCHAIN=1` gate; macOS/Windows CI legs do not exist (all legs ubuntu) so the gated round-trip test is the per-platform exercisable surface; root suite 1639 pass / 0 fail; migration notes in CHANGELOG.)
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

- [x] Dependency major: `better-sqlite3` 12 → 13 (+types) (done 2026-09-04: `^12.11.1` → `^13.0.3`, `@types/better-sqlite3` → `^9.6.0`. Upstream 13 is an N-API rewrite — no removed/changed APIs, only additions (`db.explain()`, `statement.toString()`) + `SqliteError` cross-realm fix; zero adapter code changes needed (statements remain hoisted `db.prepare` consts, no SQL construction touched). Packaging change recorded for hosts: 13 bundles prebuilt N-API binaries in-package (one binary across Node versions, `prebuild-install` removed; unsupported arch compiles from source as before). Evidence: sqlite session/enterprise + prompt-store suites 34 pass / 1 env-gated skip; packed-tarball fresh-install smoke — `npm i better-sqlite3@13.0.3` into a clean dir → native load + insert/select round-trip green, prebuilts verified in `build/Release/*.node`; benchmark gate tests (medians, ±5%) green in full root run 1639/1639; engines `node >=20` already documented in prism-core manifest and CI legs run Node 20/24.)
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

- [x] Dependency major: `pdf-parse` 1.1 → 2.4 (done 2026-09-04: `^1.1.1` → `^2.4.5`; adapter rewritten for the v2 `PDFParse` class — `new PDFParse({ data, isEvalSupported: false })` → `getText({ pageJoiner: "" })` → `destroy()` in `finally`; page count now `result.total` (was `numpages`); `isEvalSupported: false` additionally hard-disables pdf.js `eval` of PDF functions, closing a script-execution gap v1 left open. Golden fixtures round-trip byte-identically modulo trailing `\n` (page markers suppressed); 1000-page budget fixture ~223ms vs 2000ms ceiling (v1 ~162ms — no regression); new fuzz smoke proves a `%PDF-`-magic garbage buffer rejects within the ceiling instead of hanging. Optional peers (`pdf-parse`, `mammoth`) added as explicit devDependencies so the fixture suites actually execute in-repo (they self-skipped via `PEERS_OK` before). Coding-tools suite 646 pass / 0 fail + root suite + typecheck green. Engine constraints (worker-thread parse, TypedArray transfer, Node ≥20.16, CJS/ESM/browser builds) documented in CHANGELOG.)
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

- [x] Impeccable ownership decision (done 2026-09-04: **host-owned vendored snapshot, pinned** — decision + evidence in docs/_evidence/impeccable-ownership-2026-09-04.md. Consume-from-npm rejected with evidence: `npm pack impeccable@3.6.1` ships the detector CLI only — zero SKILL.md files; the skill tree lives in dot-dirs (`.agent/skills/impeccable/`) which npm publish excludes, so the published artifact is structurally the wrong one (matches the seam's long-standing error message). Vendor-in-repo rejected (package policy: Prism does not vendor skill bodies; the fixture is a <1 KiB test stand-in, not a snapshot). Landed: optional `expectedSnapshotDigest` (sha256 of the resolved SKILL.md bytes) on `ImpeccableExtensionOptions` — when set, `kernel.load` fails closed on drift before any registration; when absent, behavior unchanged (one model, no third state). Upstream commit at decision time recorded: `695df68a5860da4d25cd629fc3727ec8f3c0991b`. Tests added (pin match loads, pin drift fails closed with zero registrations; suite 10/10 green), docs/impeccable.md updated with the pin + provenance convention; coding-tools suite 648/0, typecheck clean.)
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

- Reranker adapters (done): Voyage chosen as the independent provider for its distinct `data` response envelope (verified against its published OpenAPI schema); Jina/Cohere-shaped vendors are covered by the single OpenAI-compatible adapter instead of one adapter per vendor. Shared rerank HTTP core (`rag/rerank-shared.ts`) is internal (not a public export) — only adapters + fake + conformance are public surface. Conformance suite covers network-free invariants (empty input, permutation + reference identity, determinism); HTTP adapters additionally run it through injected transports, with loopback-server suites covering wire-level failure modes.
- Remaining tasks pending — more entries as they complete.
- Model discovery (done): Google chosen as the independent provider (documented distinct envelope `{models:[…]}` + `x-goog-api-key` + pagination vs the OpenAI-compatible `{data:[…]}` route); OpenAI `/v1/models` carries only ids, so normalized entries stay bare and capability/limits/cost detail comes from host catalog overrides (per the plan's "hosts own overrides" decision). Contract types live beside `ModelConfig` in core `content.ts` rather than a new module — no new export surface mechanics. Google pagination hard-capped at 10 pages of 1000 (raise `MAX_DISCOVERY_PAGES` when a listing grows beyond that).
- Capture middleware (done): no `provider_response` middleware hook exists (docs/middleware-hooks.md: "observing provider output belongs to the provider adapter or subscriber events"), so response capture rides `provider_turn_finished` via `capture.observeEvent()` on the existing subscriber seam instead of inventing a new hook. Secret redaction is unconditional even under `redact: "none"` — the policy governs content retention only, so captured buffers stay replay-safe by construction. Options/headers are never captured (headers are where credentials ride) rather than redacted-in-place.
- Cost/catalog freshness (done): `CostCatalog` reuses the existing `ModelCost` shape instead of a bespoke quote type — every in-repo pricing mapper already emits `per_million_tokens`, so unit guard + reuse costs nothing. TTL lives in the adapter (staleness contract: expired → `undefined`), not in core — core has no clock over host data. Enrichment sits in `recordProviderUsage` (single choke point before limits, run-total accumulator, and ledger), so provider-reported cost precedence and no-double-billing aggregation are inherited, not re-implemented.
- Edge profile (done): rejected-with-rationale per the plan's default — evidence-first (dep inventory showed native addons on the durability/credential seams + `node:` built-ins in the core barrel itself, so this is a porting project, not a build flag). Decision doc records a two-condition revisit trigger so the rejection is falsifiable, not permanent. Kept companion note: new seams stay on injected `fetch`/credential resolvers to preserve option value for free.
- Keyring 2 (done): upstream breaking change lands entirely inside the existing adapter error boundary, so the lazy migration is a version bump + evidence, zero adapter code. Known ceiling: macOS/Windows round-trip evidence is deferred to hosts/CI legs that can exercise those keychains (the `PRISM_TEST_KEYCHAIN=1` gate is the hook); cross-OS CI legs are an infrastructure ask, not a code ask.
- better-sqlite3 13 (done): N-API rewrite turned the feared native-ABI migration into a version bump — no API deltas, so the adapter diff is zero and the evidence is suites + a fresh-install native-load smoke. The real host-facing change is packaging (prebuilts bundled in-package, no per-Node rebuild), recorded in CHANGELOG; performance non-regression is enforced by the existing benchmark gate medians in the root suite rather than a new ad-hoc harness.
- pdf-parse 2.4 (done): the v2 API swap (`PDFParse` class, total-vs-numpages) was the minimum adapter diff; flight-mileage caught a doc/registry drift — the README's `getRaw()` (advertised as the v1-compat path) does not exist in the shipped 2.4.5 ESM build, so the adapter uses `getText({ pageJoiner: "" })` instead. Known ceiling: `isEvalSupported: false` also disables legit PDF function shading on exotic documents (spurious parse failures possible) — the doc-reader's literal-text contract prefers that trade; re-enable only with an allow-list if a real document regresses. The 646-pass suite now actually exercises pdf-parse (peers are devDeps), so future upgrades get real golden coverage.
- Impeccable ownership (done): the decision is a verified negative (npm package is the CLI, not the skill tree) plus a small seam affordance — an optional digest pin that makes the host-owned-snapshot model enforceable. Known ceiling: the pin is content-addressed (sha256 of SKILL.md), not a git SHA — deliberately, because compiled provider output (`dist/universal/impeccable`) has no `.git`, and content-pinning is what the seam can actually check; hosts that want commit-level provenance keep it in their own checkout.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
