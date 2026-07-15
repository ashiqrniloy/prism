# Prism 0.0.4 Integration and Release Readiness

## Objectives

- Integrate and verify every review finding and capability delivered by Plans 053-057.
- Absorb predecessor Further Actions from Plans 053-055 into executable release tasks (exclusive parallel dispatch, hung MCP fixture, performance recordings, `isMissingFile` cleanup, `prism-all` optional-package decision).
- Close documentation, maintainability, performance, security, compatibility, packaging, and dependency gaps.
- Produce clean, version-consistent 0.0.4 artifacts with safe deterministic publication automation.

## Expected Outcome

- `docs/review-coverage-2026-07-14.md` has no unresolved row inside frozen 0.0.4 scope; all 11 findings and 11 in-scope capability gaps link to shipped API/docs/tests. Interactive TUI (C-012) remains explicitly excluded by Plan 057's approved scope decision.
- Predecessor Further Actions from Plans 053-055 are either checked off via Tasks 1-5 here or explicitly recorded as post-0.0.4 work in this plan's Further Actions.
- Existing 0.0.3 use cases remain source compatible unless a documented migration is approved; new packages compose end to end.
- Every publishable package is 0.0.4 with consistent internal ranges, changelog, exports, provenance-ready tarball, and no registry collision.
- Real publication is the only remaining action.

## Frozen 0.0.4 Release Scope (2026-07-14)

- **Predecessors:** Plans 053-057 have no unchecked tasks. Their phase gates report 0 failures; Plan 057's latest aggregate evidence is 1,444 tests (1,419 pass, 25 credential-gated skips), all workspace builds/packs, and 0 audit vulnerabilities.
- **Review boundary:** All 11 review findings (R-001-R-011) and capabilities C-001-C-011 are in scope. R-012 release automation is a release blocker owned by Task 7. C-012 interactive TUI is excluded from 0.0.4 by Plan 057's approved scope decision; workflow control ships through APIs/RPC.
- **Publishable package set:** all 24 current manifests: root `@arnilo/prism`; six provider packages; two compaction packages; eight optional capability packages (`observability-opentelemetry`, `tool-validator-json-schema`, `mcp`, `coding-security`, `session-store-sqlite`, `session-store-postgres`, `credentials-node`, `workflows`); coding-agent; two family metas (`prism-providers`, `prism-compaction`); three profiles (`prism-base`, `prism-code`, `prism-sdk`); and `prism-all`. Task 7 owns version/range compatibility; Task 8 owns artifact verification.
- **Frozen public surface:** bounded provider transport/OpenAI/media subpaths; structured-output/model capability options; provider/tool telemetry metadata; tool argument validation and `toolConcurrency`; execution policy; audio/file/document content; persistence schema/run-ledger conformance; checkpoint/event-multiplexer/lease primitives; SQLite/PostgreSQL persistence; encrypted/keychain credentials; MCP, coding security, OpenTelemetry, and workflow APIs/RPC commands. Database/checkpoint/lease schema version 1 and credential envelope/vault version 1 are frozen. Task 1 owns source compatibility verification against 0.0.3.
- **Security boundary:** threat fixtures and documented host responsibilities are frozen in `docs/review-coverage-2026-07-14.md`; any failing SQL/SSRF/path/schema/OAuth/credential/MCP/terminal/redaction test blocks release through Tasks 1, 2, or 8.
- **Performance boundary:** existing SSE, telemetry, media, event, workflow, persistence pool, and timeout ceilings are frozen. Missing release measurements (ledger/JSONL, validator cache/parallel overlap, database/KDF) are release blockers owned by Task 2, not scope additions.
- **Predecessor follow-ups:** Plans 053-055 map to Tasks 1-5 exactly as recorded in their Further Actions. Plan 056 integration/measurement follow-ups map to Tasks 1-2; provider-side `resourceUri` resolution and append-sequence changes remain post-0.0.4 because shipped capability is explicit pre-resolution and current conformance is green. Plan 057 maps to Task 1; C-012 stays excluded.

## Tasks

- [x] 0. Confirm predecessor completion and freeze release scope
  - Acceptance Criteria:
    - Functional: Plans 053-057 have no unchecked implementation/verification tasks; every in-scope code-review finding, assessment debt item, and capability gap has implementation evidence or an explicit release-blocking owner. C-012 is the sole approved scope exclusion.
    - Performance: Every promised bound/benchmark has a recorded result or a release-blocking measurement owner and threshold; no unexplained regression may pass Tasks 2 or 8.
    - Code Quality: Scope inventory lists all public API families/packages/subpaths/events/options/migrations and identifies compatibility review owner.
    - Security: Every threat-model area has a test, documented host responsibility, or explicit release-blocking owner; no in-scope security work is deferred.
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-14.md`, `prism-bug-report.md`, Plans 053-057, `docs/review-coverage-2026-07-14.md`.
    - Options Considered:
      - Start release work with predecessor gaps: risks false readiness; rejected.
      - Block until matrix is complete: chosen.
    - Chosen Approach:
      - Audit row-by-row and reopen owning plan/task if implementation/evidence is missing; then freeze 0.0.4 scope. Map predecessor Further Actions into Tasks 1-5 of this plan.
    - API Notes and Examples:
      ```text
      Finding/capability → plan task → implementation → test → docs → package/version
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-14.md`: complete release traceability/status.
      - `plans/058-prism-0-0-4-integration-and-release-readiness.md`: record frozen package/API inventory during execution.
    - References:
      - Review priority table and missing-capability table.
      - Plans 053/054/055 `## Further Actions`.
  - Test Cases to Write:
    - `src/__tests__/docs.test.ts` validates frozen matrix owner/test/docs/status cells and fails on unchecked predecessor tasks.
  - Evidence (2026-07-14):
    - Plans 053-057 contain zero unchecked tasks; predecessor Further Actions were reconciled above.
    - `docs/review-coverage-2026-07-14.md` now contains frozen scope, package/API inventory, performance/blocker ownership, and security evidence.
    - Focused matrix validation passes via `node --test --test-name-pattern='release scope matrix' dist/__tests__/docs.test.js`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release governance.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-14.md`.
    - `docs/index.md` update: no new entry; verify existing review coverage entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 1. Run end-to-end integration and compatibility matrix
  - Acceptance Criteria:
    - Functional: Scenarios combine revision/redaction, native structured output/fallback, validated parallel local+MCP tools with approval, provider telemetry, SQLite/PostgreSQL resume, encrypted credentials, multimodal inputs, and workflow checkpoint/resume/cancel via public APIs or RPC commands (no TUI).
    - Functional (055 P1): One offline packed-install scenario runs `@arnilo/prism-tool-validator-json-schema` + `toolConcurrency > 1` + `@arnilo/prism-mcp` tools + `@arnilo/prism-coding-security` approval in a single agent turn and asserts ordered results.
    - Functional (055 P2 fixture): MCP hung-call fixture proves `callTimeoutMs` / abort returns an attributable tool error without hanging the suite.
    - Functional (054): Credential-gated live-provider smoke is present, skipped offline by default, and documented for operator-run release verification.
    - Performance: End-to-end scenarios respect all concurrency/memory/body/media/event bounds and complete under documented budgets with fake providers/services.
    - Code Quality: Tests use public package imports from packed installs; TypeScript compatibility fixtures cover 0.0.3 documented APIs and 0.0.4 additions.
    - Security: Canary secrets remain absent from terminal output, events, telemetry, stores, database rows where redaction applies, checkpoints, errors, logs, and snapshots.
  - Approach:
    - Documentation Reviewed:
      - All public docs added/changed in Plans 053-057; `docs/release-and-install.md`, migration/public contract docs; `docs/mcp-tools.md`, `docs/coding-security.md`, `docs/tool-execution-primitives.md`.
    - Options Considered:
      - Package-only tests: miss cross-package contracts.
      - Small compositional scenario matrix over packed packages: chosen.
    - Chosen Approach:
      - Add offline deterministic fixtures plus opt-in PostgreSQL/live-provider smoke; test Node 20 and Node 24 supported runtimes.
      - Include an explicit 055 composition fixture (JSON Schema validator + parallel dispatch + MCP bridge + coding approval) and an MCP hung-server timeout fixture using the SDK in-memory/transport test pair with a deliberately delayed tool handler.
    - API Notes and Examples:
      ```bash
      npm run test:integration
      npm run test:install
      # opt-in live providers (credentials required):
      PRISM_LIVE_PROVIDERS=1 npm run test:integration -- --grep live-provider
      ```
      ```ts
      // 055 composition sketch (packed imports)
      const validate = createJsonSchemaToolArgumentValidator();
      const mcp = await connectMcpTools({ serverId: "demo", transport });
      const policy = createCodingApprovalPolicy({ roots: [cwd], approve });
      const tools = [...localTools, ...mcp.tools];
      await session.run(input, { validate, loop: { strategy: "single-shot", toolConcurrency: 2 } });
      ```
    - Files to Create/Edit:
      - `src/__tests__/install-smoke.test.ts`: packed 055 composition consumer using public imports.
      - `src/__tests__/compatibility-0-0-3.test.ts`: compile/runtime compatibility fixture for documented 0.0.3 construction plus additive 0.0.4 options.
      - `packages/mcp/src/__tests__/bridge.test.ts`: delayed in-memory MCP timeout fixture.
      - `src/__tests__/checkpoint-event-primitives.test.ts`: raise lease fixture TTL to remove load-dependent expiry flake exposed by aggregate matrix.
      - `docs/review-coverage-2026-07-14.md`: record scenario matrix and results.
      - No root script/workflow or migration change: existing `sdk:ready`, PostgreSQL CI, live-provider gates, and documented APIs were sufficient; no compatibility difference surfaced.
    - References:
      - Plans 053-057 Expected Outcomes; Plan 055 Further Actions P1/P2; Plan 054 Further Actions live-provider smoke.
  - Test Cases to Write:
    - One complete offline user journey; each optional package pair; Node 20/24 imports; abort/failure cleanup; secret scan.
    - Packed-install 055 composition: schema validation blocks bad args; local+MCP+exclusive shell calls preserve order and serialize safely; approval allows shell and read-only policy denies write. Non-exclusive overlap is covered separately by the core loop fixture.
    - MCP hung-call: delayed tool exceeds `callTimeoutMs` → attributable tool error; suite finishes within bound.
    - Live-provider smoke: skipped without credentials; operator command documented for all six first-party providers.
  - Evidence (2026-07-14):
    - `npm run sdk:ready` passes: 1,448 tests (1,423 pass, 25 explicit credential-gated skips, 0 failures), strict typecheck, builds, fresh packed install/import/composition, packaging guard, nine offline workflow examples, and all 21 dry-run packs.
    - Packed consumer proves validator rejection before execution, deterministic persisted call order, MCP-mapped/local/coding-tool composition, shell approval, read-only write denial, and canary-free storage. Task 3 subsequently made the packed shell turn exclusive; non-exclusive overlap remains covered by the core loop fixture.
    - MCP linked in-memory delayed handler exceeds 10 ms timeout, returns attributable `mcp:hung:hang` error under 150 ms, and closes cleanly.
    - PostgreSQL and live-provider execution remained credential-gated: no `PRISM_TEST_POSTGRES_URL` or provider API keys were available. Existing CI PostgreSQL evidence from Plans 056-057 remains green; `PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present` is the documented operator gate.
    - Aggregate gate exposed a pre-existing 5 ms memory-lease test race; fixture TTL/wait changed to 100/110 ms, then full gate passed. No product behavior or public compatibility change was required.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; validates integrated behavior.
    - Docs pages to create/edit: `docs/migration.md`, `docs/release-and-install.md` for discovered compatibility notes; `docs/mcp-tools.md` only if hung-timeout operator notes need clarifying.
    - `docs/index.md` update: yes only if integration exposes missing navigation; otherwise verify unchanged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Complete maintainability, dependency, performance, and security release audit
  - Acceptance Criteria:
    - Functional: All package entry points, drivers, bins, optional dependencies, feature detection, and failure paths work on supported environments; no known TODO/no-op contradicts public docs.
    - Performance: Compare 0.0.3 baseline for SDK tests, stream throughput/memory, redaction, ledger, tool validation/parallelism, persistence, media, and workflows; regressions beyond task thresholds are fixed or release-blocking.
    - Performance (053/055): `docs/performance.md` records measured ledger serialization ceilings, JSONL append ceilings, JSON Schema validator compile-cache hit vs miss, and parallel-overlap latency for `toolConcurrency` 1 vs 2 with delayed independent calls.
    - Code Quality: Duplicate provider helper scan is clean/documented; touched `contracts.ts`/`agents.ts`/`agent-definitions.ts` domains are cohesive; brittle source-text tests touched by work are replaced; unused exports/deps/dead code removed; strict type/lint/docs checks pass.
    - Security: `npm audit` has zero high/critical findings, dependency licenses/provenance reviewed, SQL/SSRF/path/ANSI/schema/OAuth/credential/terminal threat tests pass, and secret scan covers source/tests/tarballs/runtime artifacts.
  - Approach:
    - Documentation Reviewed:
      - Review maintainability/performance/security assessments; package manifests; current release notes/migration docs for `@types/node`, `diff`, TypeScript, and every newly selected dependency; `docs/performance.md`.
    - Options Considered:
      - Upgrade every major during feature release: unnecessary risk.
      - Apply compatible patch/minor updates, evaluate majors with documented pass/defer decision based on test support/security: chosen.
    - Chosen Approach:
      - Run static scans, audit/outdated/license checks, benchmarks, test-quality review, and dependency-by-dependency compatibility/security assessment. Upgrade major only when required or low-risk with full matrix.
      - Publish the specific 053/055 measurement notes into `docs/performance.md` with methodology and release thresholds.
    - API Notes and Examples:
      ```bash
      npm audit --audit-level=high
      npm outdated --workspaces
      npm ls --all
      ```
    - Files to Create/Edit:
      - `package-lock.json`: compatible `@types/node` patch to 22.20.1; no runtime dependency update.
      - `docs/performance.md`: dated release measurements, methods, ceilings, and adapter boundaries.
      - `docs/host-security.md`: dependency/license/provenance/install-script/secret/threat audit and host terminal boundary.
      - `docs/release-and-install.md`: dependency update/defer decisions.
      - `docs/review-coverage-2026-07-14.md`: close Task 2 blockers and record audit matrix.
      - No hotspot source, root script, CI, or migration edits: scans found no release defect, and hardware timing is unsuitable as a deterministic CI assertion.
    - References:
      - Review duplicate helper, hotspot, source-test, dependency, performance, and security sections.
      - Plan 053 Further Actions (ledger/JSONL benchmarks); Plan 055 Further Actions (schema-cache / parallel-overlap notes).
  - Test Cases to Write:
    - Existing deterministic guards retained: ledger max append concurrency 1, tool worker cap/overlap/order, validator cache behavior, bounded transport/media/workflow/persistence/KDF malicious-input suites, packed entrypoint/bin checks.
    - Dated benchmark matrix records ledger serialization and JSONL append ceilings, schema-cache hit/miss, parallel concurrency 1/2, SQLite, redaction, KDF, workflow, and frozen SSE results; no wall-clock CI test added.
  - Evidence (2026-07-14):
    - `npm run sdk:ready` passes in 40.968 s: 1,448 tests (1,423 pass, 25 explicit live skips, 0 failures), strict typecheck, builds, examples, packed install/import/bin guards, and all 21 dry-run packs.
    - `npm audit --audit-level=high`: 0 vulnerabilities at all severities. `npm ls --all`: clean. All 162 registry lock records have `resolved` + integrity; locked third-party license metadata is permissive; only opt-in `better-sqlite3` has an install hook.
    - `npm outdated --workspaces`: patched `@types/node` 22.19.21 → 22.20.1. Deferred `diff` 9, TypeScript 7, and Node types 26 because they are unsupported-target/major compiler or runtime changes with no security driver.
    - Benchmark highlights: 500-delta ledger 1.19 ms with event concurrency 1; 500 JSONL appends 141.10 ms; validator warm 0.99 µs vs cold compile 2.50 ms; six delayed tools 121.12 ms sequential vs 60.92 ms at concurrency 2; SQLite 1,000 appends 31.84 ms; redaction 10,000 objects 4.79 ms; default scrypt/AES 48.09 ms; 1,000-node workflow fixture 27.68 ms.
    - Maintainability scan found no contradictory product TODO/no-op; provider packages share bounded transport/argument helpers. `contracts.ts` remains contract-only; `agents.ts` runtime orchestration; `agent-definitions.ts` node loader/validator. No touched brittle source-text test or evidence-based dead dependency/export justified release churn.
    - Common live-token/private-key scan returned no match. SQL/SSRF/path/shell/schema/OAuth/credential/MCP/redaction suites, packed canary, and tarball deny lists pass. ANSI/control sanitization is documented as host renderer responsibility because C-012 TUI is excluded and 0.0.4 exposes JSON-line RPC only.
    - `git diff --check` and focused performance/release-matrix docs tests pass. PostgreSQL/provider/keychain live tests remain explicit credential/OS gates; existing CI ownership is unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — only a compatible type-definition patch and audit documentation; no runtime/API/limit changed.
    - Docs pages edited: `docs/performance.md`, `docs/host-security.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-14.md`; no migration needed.
    - `docs/index.md` update: no — all edited pages were already linked with accurate descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Honor `ExecutionDecision.exclusive` in single-shot parallel dispatch
  - Acceptance Criteria:
    - Functional: When any tool call in a single-shot batch yields `ExecutionDecision.exclusive === true` (or a host-supplied exclusive marker before execution), that turn forces sequential dispatch for the exclusive call relative to siblings so shell/mutating work does not overlap concurrent reads/writes.
    - Performance: Non-exclusive batches with `toolConcurrency > 1` retain overlap; exclusive presence does not permanently lower the configured concurrency for later turns.
    - Code Quality: Prefer reading `exclusive` from execution-policy decisions already returned by coding tools / `ExecutionPolicy`; avoid a second ad-hoc exclusive registry unless a thin LoopContext hook is required for non-coding tools.
    - Security: Permission and argument validation still complete per call before side effects; exclusive serialization cannot be bypassed by raising `toolConcurrency`.
  - Approach:
    - Documentation Reviewed:
      - `docs/tool-execution-primitives.md` Task 2/4; `src/execution-policy.ts`; `src/agent-loops.ts` `dispatchToolCallsInOrder`; `packages/coding-security/src/approval.ts` (`exclusive: true` for shell).
    - Options Considered:
      - Keep exclusive advisory only; require hosts to set `toolConcurrency: 1`: simple but blocks read-only parallelism when one shell call is present.
      - Auto-serialize the whole turn when any exclusive call is present: chosen for safety and small API surface.
      - Per-call barrier only around exclusive slots while other calls stay parallel: more complex; defer unless benchmarks demand it.
    - Chosen Approach:
      - Add the pre-dispatch `ToolDefinition.exclusive` marker and a thin `LoopContext.isToolCallExclusive` resolver. `RuntimeAgentSession` resolves markers from the active registry; `dispatchToolCallsInOrder` clamps only the containing batch to concurrency `1`. Coding-agent shell definitions carry the marker, matching coding-security's shell `ExecutionDecision.exclusive` without running approval/policy twice.
    - API Notes and Examples:
      ```ts
      // coding-security already marks shell exclusive
      const decision = await policy.check({ kind: "shell", risk: "high", command, paths: [] });
      // decision.exclusive === true → single-shot turn runs sequentially
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: additive `ToolDefinition.exclusive` and optional loop resolver contract.
      - `src/agents.ts`, `src/agent-loops.ts`: active-registry marker resolution and per-turn concurrency clamp.
      - `src/execution-policy.ts`: clarify decision-to-marker contract.
      - `packages/coding-agent/src/shell.ts`: mark shell definitions exclusive.
      - `src/__tests__/agent-loops.test.ts`, `packages/coding-agent/src/__tests__/execution-policy.test.ts`, `src/__tests__/install-smoke.test.ts`: direct/runtime/packed safety checks.
      - `docs/agent-loops.md`, `docs/tools.md`, `docs/tool-execution-primitives.md`, `docs/coding-security.md`, `docs/index.md`, review matrix: shipped semantics and traceability.
    - References:
      - Plan 055 compromise (`ExecutionDecision.exclusive` advisory) and Further Action P2.
  - Test Cases to Write:
    - Direct batch with exclusive shell + read at `toolConcurrency: 2` has max concurrency 1; following unmarked batch restores max concurrency 2.
    - Runtime agent resolves `ToolDefinition.exclusive` from its active registry and serializes the turn.
    - Coding-agent shell factory exposes `exclusive: true`; packed local+MCP+shell composition never overlaps shell with siblings.
    - Existing abort fixture still discards unappended parallel results; non-exclusive worker-cap/order fixtures remain green.
  - Evidence (2026-07-14):
    - Focused direct and runtime exclusive tests pass; coding-agent shell marker test passes.
    - Fresh packed integration serializes local, MCP, and approved shell calls while preserving call-order transcript, validation, permission, redaction, and read-only denial behavior.
    - `npm run sdk:ready` passes: 1,450 tests (1,425 pass, 25 explicit live skips, 0 failures), strict typecheck, builds, examples, packed install, and all 21 dry-run packs.
    - No policy preflight or second approval was added. Custom tools with dynamic exclusive policy decisions must expose the static marker because serialization must be known before execution starts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — parallel dispatch semantics when exclusive decisions are present.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: exclusive serialization behavior.
      - `docs/tool-execution-primitives.md`: update Task 2/4 notes.
      - `docs/coding-security.md`: shell exclusive → sequential turn.
    - `docs/index.md` update: no new page; verify agent-loops / coding-security blurbs mention exclusive serialization.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. Deduplicate remaining `isMissingFile` helpers onto `isNodeErrorCode`
  - Acceptance Criteria:
    - Functional: `session-store-jsonl.ts` (and any other Plan-053-called duplicate) uses shared `isNodeErrorCode(error, "ENOENT")` or a single shared helper; missing-file behavior is unchanged.
    - Performance: No measurable load/resume regression; helper remains sync and allocation-free beyond existing checks.
    - Code Quality: Remove private duplicate `isMissingFile` where the Plan 053 further action called it out; prefer exporting one helper from `src/node/config.ts` if multiple node loaders still need the ENOENT predicate.
    - Security: Error-code checks remain strict (no stringified message matching); deceptive non-ENOENT errors still fail closed.
  - Approach:
    - Documentation Reviewed:
      - Plan 053 Further Actions; `src/node/config.ts` `isNodeErrorCode`; private `isMissingFile` in `session-store-jsonl.ts`, `contribution-discovery.ts`, `agent-definitions.ts`, `trust.ts`.
    - Options Considered:
      - Leave duplicates: rejected by Plan 053 follow-up.
      - Replace only `session-store-jsonl.ts`: incomplete if siblings remain.
      - Consolidate all node ENOENT predicates onto `isNodeErrorCode` (or one thin `isMissingFile` export): chosen.
    - Chosen Approach:
      - Replace every private duplicate with existing `isNodeErrorCode`; add no alias or public API. Core node modules import `./config.js`; coding-security imports the existing `@arnilo/prism/node/config` export.
    - API Notes and Examples:
      ```ts
      import { isNodeErrorCode } from "./config.js";
      if (isNodeErrorCode(error, "ENOENT")) return { entries: [], errors: [] };
      ```
    - Files to Create/Edit:
      - `src/node/session-store-jsonl.ts`, `src/node/contribution-discovery.ts`, `src/node/agent-definitions.ts`, `src/node/trust.ts`: use shared strict error-code predicate and delete private helpers.
      - `packages/coding-security/src/path-containment.ts`: remove the final workspace duplicate via the existing node/config subpath.
      - `src/__tests__/node-config.test.ts`: assert plain `{ code: "ENOENT" }` objects fail closed.
      - No `src/node/config.ts`, export-contract, or docs change: existing helper/export is sufficient.
    - References:
      - Plan 053 Further Actions P3.
  - Test Cases to Write:
    - JSONL missing file still returns empty entries; deceptive `{ code: "ENOENT" }` plain objects are rejected by `isNodeErrorCode`.
    - Contribution discovery, trust, agent-definition, and coding-security containment missing-path behavior stays unchanged.
  - Evidence (2026-07-14):
    - Workspace scan finds zero `isMissingFile` definitions or calls; every strict ENOENT branch now routes through `isNodeErrorCode`.
    - Focused core suites pass: 66 tests across node config, JSONL store, contribution discovery, agent definitions, and trust/security. Coding-security passes 10 tests.
    - `npm run sdk:ready` passes: 1,450 tests (1,425 pass, 25 explicit live skips, 0 failures), builds, packed install/import checks, and all 21 dry-run packs.
    - No alias, dependency, allocation, public API, or behavior was added; the existing `@arnilo/prism/node/config` subpath already exposes the helper.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: only if a new export is added; behavior otherwise internal.
    - Docs pages to create/edit: none unless a new public node helper is exported — then `docs/node-runtime.md` or equivalent node page.
    - `docs/index.md` update: no unless a new public helper page entry is required.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Consolidate first-party family/profile packaging and make `@arnilo/prism-all` complete
  - Acceptance Criteria:
    - Functional: Add manifest-only `@arnilo/prism-base`, `@arnilo/prism-code`, and `@arnilo/prism-sdk` profiles; retain provider/compaction families; make `@arnilo/prism-all` transitively install all 24 first-party manifests.
    - Performance: Record profile graph/tarball footprints; keep native database drivers out of base/code/sdk and accept heavy optional dependencies only in profiles that use them.
    - Code Quality: Exact dependency sets are release-gated; profiles have no exports/re-exports; README/release docs define atomic imports and profile boundaries. Task 6 owns consolidated 0.0.4 changelogs.
    - Security: Installation activates nothing; coding/MCP/telemetry/database capabilities still require explicit host registration, credentials, transports, roots, permissions, and approvals.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-all/package.json`, Plan 055 compromise (packages stay opt-in), `docs/release-and-install.md`, packaging/install-smoke ponytail lists.
    - Options Considered:
      - One ever-growing `prism-all`: poor graduated installs; rejected as the only entry point.
      - `prism-utils`: no coherent capability boundary; rejected.
      - Family packages plus base/code/sdk profiles and a true all-union: chosen.
    - Chosen Approach:
      - `base` = core + compaction + JSON Schema validation; `code` = base + coding tools/security + MCP; `sdk` = base + workflows + MCP + Node credentials + OpenTelemetry; providers stay orthogonal; SQLite/PostgreSQL stay explicit except in `all`; `all` = code + sdk + providers + both stores.
      - Keep every meta package manifest-only with exact hard dependencies. Consumers import atomic packages; no alias exports or activation side effects.
    - API Notes and Examples:
      ```bash
      npm install @arnilo/prism-code @arnilo/prism-provider-openai
      npm install @arnilo/prism-sdk @arnilo/prism-provider-openai @arnilo/prism-session-store-sqlite
      npm install @arnilo/prism-all
      ```
    - Files to Create/Edit:
      - `packages/prism-{base,code,sdk}/{package.json,README.md}`: new pure-manifest profiles.
      - `packages/prism-all/{package.json,README.md}`: complete union and inactive-by-default security boundary.
      - Root workspace/lockfile, packaging/install-smoke/docs tests: 24-package graph and exact dependency guards.
      - Root/package READMEs; workflow/observability docs; `docs/release-and-install.md`, `docs/index.md`, review matrix: profile guidance and corrected inclusion statements.
    - References:
      - Plan 055 Further Actions P3 and Compromises Made.
  - Test Cases to Write:
    - Packaging guard pins all six family/profile manifests, exact hard dependency sets, metadata, release-file tarballs, and 0.0.3 ranges.
    - Fresh consumer packs/installs all 24 tarballs together and imports every code-package/public core entrypoint.
    - Docs/release scope gates pin 24 publishable manifests and updated profile language.
  - Evidence (2026-07-14):
    - Profile closure: base 6 first-party/1 external root; code 10/3; sdk 11/3; all 24/6. Task 6 added shipped changelogs, bringing meta tarballs to 999 B base, 995 B code, 1,002 B sdk, and 1,394 B all.
    - Ajv is base safety validation; MCP SDK is limited to code/sdk; keyring to sdk; native better-sqlite3 and pg remain out of base/code/sdk and enter only all.
    - Focused packaging guard passes 124 tests, including exact dependencies and complete 24-package transitive closure. Fresh packed install covers all 24 manifests.
    - `npm run sdk:ready` passes: 1,466 tests (1,441 pass, 25 explicit live skips, 0 failures), builds, examples, packed install/import/composition, and all 24 dry-run packs. One unrelated 500 ms workflow coordinator timing fixture failed under an earlier aggregate run and passed on focused rerun plus final aggregate gate; product code was unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — three new install profiles and a complete `prism-all` graph; runtime APIs are unchanged.
    - Docs pages edited: `docs/release-and-install.md`, root/profile/family/affected package READMEs, workflow/observability pages, and review coverage.
    - `docs/index.md` update: yes — release/install entry now names profile choices.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Finalize complete 0.0.4 API documentation, examples, READMEs, and changelogs
  - Acceptance Criteria:
    - Functional: Every new/changed API, package, subpath, option, event, capability, protocol, persistence adapter, security boundary, workflow, and bin has accurate API-page sections and runnable example; support matrices match tests.
    - Performance: Docs state finite defaults/ceilings, benchmark context, production/development boundaries, and scaling guidance.
    - Code Quality: `docs/index.md` provides one non-duplicated functional entry per page; links/imports/examples are checked; package READMEs defer detailed material to `/docs` without drift.
    - Security: Docs identify trust boundaries, secret handling, permissions, transport/database/workflow-checkpoint risks, secure defaults, and host responsibilities without sample secrets.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; `docs/api-page-template.md`; all changed docs/READMEs/changelogs/examples.
    - Options Considered:
      - One release mega-page: hard to navigate.
      - Functional API pages + index + concise release/migration summaries: chosen.
    - Chosen Approach:
      - Audit every public export against docs and every docs import against packed packages; run all examples offline.
    - API Notes and Examples:
      ```bash
      npm run test:docs
      npm run test:examples
      ```
    - Files Created/Edited:
      - `docs/index.md`: exactly one functional navigation link per docs page, including explicit workflow/TUI scope; removed duplicate links.
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/mcp-tools.md`, `docs/tool-execution-primitives.md`: canonical wiki API headings, inputs/outputs/examples, configuration, limits, and trust boundaries.
      - `docs/migration.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-14.md`: additive 0.0.3 compatibility, first-party persistence migration, complete 24-package/profile graph, changelog/artifact rules, and Task 6 evidence.
      - Root/profile/family READMEs and `examples/README.md`: current package scope, inactive-by-install behavior, profile links, and all 39 examples.
      - Root + all 23 workspace `CHANGELOG.md` files: finalized 0.0.4 release sections; six family/profile packages now ship their changelogs.
      - `src/__tests__/docs.test.ts`, `src/__tests__/packaging.test.ts`: dynamic docs navigation/link/example/package/changelog and packed release-file guards.
    - References:
      - Wiki-required API page structure; public export contract tests.
  - Test Cases Written:
    - Every local shipped-markdown link resolves; every docs page has exactly one index navigation link.
    - All 59 API/provider pages satisfy required headings; every `examples/*.ts` file is listed; runnable demos finish offline without secret output.
    - Root + 23 workspace package docs exist, name their package, contain finalized 0.0.4 changelogs, ship changelogs, and appear in release docs.
    - Packaging guard verifies release files in every tarball; existing public export/import, support-matrix, security, and limits checks remain green.
  - Evidence (2026-07-14):
    - Documentation inventory: 70 docs markdown files, 59 API/provider pages under heading enforcement, 24 package READMEs/changelogs, and 39 TypeScript examples.
    - Focused `docs.test.ts`: 75 pass; focused `packaging.test.ts`: 124 pass; 0 failures.
    - `npm run sdk:ready`: 1,469 tests (1,444 pass, 25 explicit live skips, 0 failures), strict typecheck, all workspace builds/tests, offline runnable examples, fresh packed install/import/composition, and all 24 dry-run packs.
    - Meta packages now ship three release files (manifest, README, changelog); measured tarballs remain 999 B base, 995 B code, 1,002 B sdk, and 1,394 B all.
    - No runtime/API implementation changed in Task 6. Task 7 subsequently performed the coordinated 0.0.4 graph update.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task completes public documentation for entire release.
    - Docs pages to create/edit: all public API pages affected by Plans 053-057, plus index/release/migration pages.
    - `docs/index.md` update: yes — complete functional navigation for all new capabilities.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. Version all packages and make publication deterministic/resumable
  - Acceptance Criteria:
    - Functional: Every publishable root/workspace package is 0.0.4; all internal dependencies/peers and lockfile agree; tag must equal version; registry preflight rejects collisions; publish order satisfies dependencies; partial publication can resume safely.
    - Performance: Consistency checks derive workspace graph once and stay within seconds; registry calls occur only in release preflight/job.
    - Code Quality: One stdlib-only release checker replaces manual package lists; workflow uses explicit graph order and records published/skipped packages.
    - Security: npm provenance enabled, public access explicit, least workflow permissions used, no secrets logged, clean/tagged commit required, and artifacts/checksums retained.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, `.github/workflows/release.yml`.
      - npm CLI docs: publish dry-run/workspaces, lifecycle order, version collision, dist-tag, access, provenance; existing Context7 references `npm-publish.md` and `scripts.md`.
    - Options Considered:
      - `npm publish --workspaces` alone: no transaction/resume graph visibility.
      - Deterministic workspace graph checker/publisher around npm CLI: chosen.
      - Release-management dependency: unnecessary.
    - Chosen Approach:
      - Add stdlib script validating versions/tag/ranges/clean tree/registry availability, topologically ordering packages, supporting dry-run/resume, and invoking npm with provenance.
    - API Notes and Examples:
      ```bash
      npm run release:check -- --version 0.0.4
      npm run release:publish -- --version 0.0.4 --dry-run --allow-dirty --allow-untagged
      ```
    - Files Created/Edited:
      - Root/workspace `package.json`, `package-lock.json`, `src/index.ts`, `packages/mcp/src/bridge.ts`: all 24 package/runtime versions and internal published ranges set to 0.0.4; local workspace dev links preserved.
      - `scripts/release.mjs`: one stdlib-only graph validator, registry preflight, deterministic publisher, resume fingerprint, and incremental report.
      - `src/__tests__/release.test.ts` plus version assertions in package/install/boundary tests.
      - `.github/workflows/release.yml`: clean tag gate, OIDC provenance, least permissions, release artifacts/checksums, topological resume, retained reports.
      - `docs/release-and-install.md`, `docs/index.md`, `docs/review-coverage-2026-07-14.md`: operator commands, limitations, security model, and evidence.
    - References:
      - Review release-workflow P2 finding.
  - Test Cases Written:
    - Exact version/range/lock mismatch and deterministic dependency order.
    - Registry collision, unpublished package, matching resume, mismatched resume rejection, and simulated interruption with persisted report.
    - Dirty/untagged git rejection, explicit public/provenance/latest arguments, workspace path handling, and token-canary error redaction.
    - Packed/install filenames, peer/meta dependency pins, root runtime version, workflow least-permission/provenance/resume/checksum assertions.
  - Evidence (2026-07-15):
    - Public npm registry preflight: all 24 `@arnilo/*@0.0.4` versions available; 0 collisions; no publish performed.
    - Real npm CLI publication dry-run: all 24 packages completed in stable topological order; report has 24 `dry-run`, 0 failed.
    - Artifact rehearsal: 24 tarballs and 24 SHA-256 entries generated; workflow retains tarballs, pack manifests, checksums, and incremental publish report for 30 days.
    - `npm run sdk:ready`: 1,475 tests (1,450 pass, 25 explicit live skips, 0 failures), strict typecheck, all builds/tests, offline packed install/composition, and all 24 dry-run packs.
    - R-012 closed in `docs/review-coverage-2026-07-14.md`; no real package publication or release tag was created.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package versions and release process.
    - Docs pages to create/edit: `docs/release-and-install.md` with preflight/publish/resume/rollback limitations.
    - `docs/index.md` update: yes — release entry mentions deterministic resumable publishing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 8. Build and inspect clean 0.0.4 release-candidate artifacts
  - Acceptance Criteria:
    - Functional: Clean `npm ci`, typecheck, build, all core/workspace/conformance/integration/docs/example tests, Node 20/24 smoke, optional PostgreSQL CI integration, and every pack/install/bin smoke pass from clean checkout.
    - Performance: `npm test` and `sdk:ready` meet documented budgets; tarball sizes and benchmark results are recorded with justified changes.
    - Code Quality: `git diff --check`, package graph, exports/types, source maps policy, license/README/changelog inclusion, and generated-file cleanliness pass.
    - Security: Audit/license/secret scans pass; tarballs exclude tests, source, maps/internal reports/fixtures/credentials; SBOM/provenance metadata and checksums are generated/inspected.
  - Approach:
    - Documentation Reviewed:
      - Updated release checklist/workflow/package scripts and support matrix.
    - Options Considered:
      - Validate working tree only: can hide undeclared/generated dependencies.
      - Clean checkout/install and packed-consumer validation: chosen.
    - Chosen Approach:
      - Run CI-equivalent matrix, create all tarballs, install into isolated consumers, inspect contents/metadata/imports/bins, and retain release-candidate manifest/checksums.
    - API Notes and Examples:
      ```bash
      npm ci
      npm run sdk:ready
      npm run release:publish -- --version 0.0.4 --dry-run
      ```
    - Files Edited / Artifacts Generated:
      - `docs/release-and-install.md`: final clean-RC matrix, timings, artifact sizes, supply-chain checks, and provenance boundary.
      - `docs/review-coverage-2026-07-14.md`: close all Task 8 performance/artifact owners and record live PostgreSQL evidence.
      - `plans/058-prism-0-0-4-integration-and-release-readiness.md`: measured results and clean-snapshot method.
      - CI-style temporary artifacts only: 24 tarballs, core/workspace pack manifests, consolidated RC manifest, CycloneDX 1.5 SBOM, and `SHA256SUMS`; none committed.
    - References:
      - `.github/workflows/release.yml`; root package gates.
  - Test Cases Executed:
    - Fresh committed snapshot: clean `npm ci`, `npm test`, `sdk:ready`, generated-file status, graph/audit, and exact clean-tag release preflight/dry-run.
    - Node 20.20.2 and Node 24.18.0 build/public-root-import smokes.
    - Fresh `postgres:16` integration and exact-tarball offline consumer install/import/bin smoke.
    - Tar content/path/metadata/version/range/access scan; reproducibility comparison; checksum, SBOM/license, token/private-key, and provenance-configuration inspection.
  - Evidence (2026-07-15):
    - Clean method: copied the current tracked + untracked non-ignored release file set (excluding deleted paths and ignored build/dependency output) into a temporary Git repository, committed 641 files, then ran every gate with `git status` remaining empty. This tests the pending release as a clean checkout without altering the user's working tree.
    - `npm ci`: 1 s. `npm test`: 28.209 s. `npm run sdk:ready`: 51.500 s and 1,475 tests (1,450 pass, 25 explicit provider/keychain skips, 0 failures). The 60 s test budget and 5-minute SDK backstop hold.
    - Node 20.20.2 clean install/build imported all 20 root targets; Node 24.18.0 repeated 20/20. Fresh PostgreSQL 16 passed 15/15 integration tests with 0 skips.
    - Exact RC consumer installed all 24 tarballs offline, loaded 37 code-package/root-subpath imports (family/profile packages are intentionally manifest-only), and ran `prism --help` successfully.
    - Artifact inventory: 24 tarballs; 539,285 packed bytes / 2,044,155 unpacked bytes. Core 342,328 B; base/code/sdk/all 998/995/1,001/1,393 B. Zero forbidden/unsafe paths, source/tests/maps/internal reports/fixtures/credential files, or manifest/range/access mismatches.
    - Repacking from the same clean tag produced identical SHA-1 shasums for all 24 tarballs. All 28 SHA-256 entries re-verified.
    - `npm audit --audit-level=high`: 0 vulnerabilities; `npm ls --all`: clean. CycloneDX 1.5 SBOM contains root + 173 components with no missing/prohibited licenses. Source/artifact private-key/npm-token/API-key scan: 0 matches.
    - Clean exact `v0.0.4` registry preflight: 24 available. Provenance-enabled npm publication dry-run: 24/24. Signed npm attestation remains publication-time output because OIDC provenance cannot exist without real publication; workflow configuration and arguments are verified.
    - Task 2 benchmark values remain inside frozen ceilings; no implementation, API, dependency, or artifact-policy change was required.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `docs/release-and-install.md` only for discovered command drift.
    - `docs/index.md` update: no additional entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 9. Produce publish handoff and leave repository release-ready
  - Acceptance Criteria:
    - Functional: Release commit/tag instructions, exact publish command/workflow dispatch, package order, expected package list, registry preflight output, resume instructions, and post-publish smoke/rollback limitations are recorded; no real publish occurs in plan execution.
    - Performance: Post-publish smoke is bounded and checks representative root/all optional package imports/bins without expensive full retest.
    - Code Quality: All plan tasks are checked only after evidence passes; `Compromises Made` contains only actual deviations (none may leave review scope incomplete); `Further Actions` contains post-0.0.4 work, not deferred requested capabilities.
    - Security: Handoff contains no token/credential, requires protected clean tag/commit, verifies provenance/checksums/registry metadata after publication.
  - Approach:
    - Documentation Reviewed:
      - Final `docs/release-and-install.md`, release workflow, registry preflight, all plan evidence.
    - Options Considered:
      - Publish automatically during implementation: outside requested readiness boundary.
      - Stop with exact auditable handoff: chosen.
    - Chosen Approach:
      - Reconcile git status/diff, matrix, artifacts, and version graph; generate concise operator checklist and final go/no-go decision.
    - API Notes and Examples:
      ```bash
      git tag -s v0.0.4
      git push origin v0.0.4
      # workflow validates and publishes with provenance
      ```
    - Files Edited:
      - `docs/release-and-install.md`: GO decision, one-time authentication prerequisite, protected commit/tag commands, exact order/list, resume, bounded post-publish smoke, and rollback limitations.
      - `.github/workflows/release.yml`: existing `NPM_TOKEN` scoped only to publish; OIDC and provenance remain enabled.
      - `src/__tests__/docs.test.ts`: handoff/package-list/bootstrap/signature/rollback documentation guard.
      - Plans 053-057: reconcile absorbed work, stale packaging/exclusive/PostgreSQL compromises, and actual post-0.0.4 actions.
      - `docs/review-coverage-2026-07-14.md`: final `complete for publish handoff` status and Task 9 matrix.
      - `plans/058-prism-0-0-4-integration-and-release-readiness.md`: completion evidence, compromises, and further actions.
    - References:
      - User requirement: after plans execute, publication is only remaining action.
  - Test Cases Executed:
    - Live registry preflight and real npm CLI dry-run operator walkthrough over all 24 packages.
    - Existing `release.test.ts` partial failure/report/resume, collision/fingerprint, clean tag, ordering, provenance args, and secret-canary simulations.
    - `docs.test.ts` verifies GO/tag/dispatch/resume/signature/rollback instructions, all 24 expected names, and publish-step-only bootstrap secret reference.
    - Task 8 exact-tarball offline install/import/bin smoke is the local equivalent of the bounded post-publish consumer commands.
  - Evidence (2026-07-15):
    - Live registry preflight: all 24 `@0.0.4` versions available. Registry inventory: 13 existing packages remain at `latest=0.0.3`; 11 package names are unpublished.
    - Owner confirmed the existing GitHub `NPM_TOKEN` used by previous releases is already stored. Workflow exposes it only to the publish step as `NODE_AUTH_TOKEN`; OIDC remains enabled and every package still receives `--provenance` from GitHub Actions.
    - Publication dry-run completed 24/24 in the recorded topological order (`@arnilo/prism` first, `@arnilo/prism-all` last), with 0 failures and no real publish.
    - Final `npm run sdk:ready`: 45 s; 1,475 tests (1,450 pass, 25 explicit live skips, 0 failures). Focused release/docs gate: 81/81 pass. `git diff --check` passes.
    - Plans 053-058 contain no unchecked tasks. Review matrix status is `complete for publish handoff`; C-012 remains the sole approved scope exclusion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release handoff.
    - Docs pages to create/edit: `docs/release-and-install.md`, review coverage status.
    - `docs/index.md` update: no additional entry; final link check required.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Eleven 0.0.4 packages are first publications and cannot preconfigure package-level trusted publishing. The existing protected `NPM_TOKEN` handles them and is scoped only to the publish step; OIDC remains available for configured packages and GitHub provenance is still requested. No credential value is stored in git.
- Interactive TUI (C-012) remains the sole approved 0.0.4 scope exclusion; workflow start/status/cancel/resume ships through public APIs and RPC commands.
- Live provider and OS-keychain tests remain credential/host-gated. Deterministic provider fixtures and fresh PostgreSQL integration pass; absence of release credentials did not weaken default offline gates.
- Task 8 used a clean committed snapshot of the pending 641-file release set because the user's working tree intentionally contains the unreleased implementation. Generated outputs stayed clean; operator still creates/merges the protected release commit before tagging.

## Further Actions

- **Publication follow-up / immediate:** after 24/24 publish, verify checksums plus `npm audit signatures --include-attestations` and run the bounded consumer smoke. Optionally migrate all package settings to OIDC-only trusted publishing later.
- **Post-0.0.4 / P3:** add subscriber-side OpenTelemetry event filtering only if a measured high-frequency in-memory workload exceeds the documented burst ceiling.
- **Post-0.0.4 / P3:** consider provider-owned `resourceUri` resolution/upload only if hosts need provider I/O; retain explicit pre-resolution by default.
- **Post-0.0.4 / P3:** add explicit persistence append-sequence columns only if measured VACUUM/rewrite workloads invalidate current `ctid`/`rowid` ordering.
- **Post-0.0.4 / low:** revisit optional interactive TUI package only when a terminal host is requested.
- **Post-0.0.4 / medium:** evaluate `diff` 9 and TypeScript 7 separately; keep Node types aligned with the supported Node 20 baseline.
