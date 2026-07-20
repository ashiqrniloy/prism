# Phase 3 — Release 0.0.8: Production Telemetry, Evaluations, Protocols, and Web Research

## Objectives

- Implement only roadmap Phase 3: safe OpenTelemetry integration, trace-aware evaluations, bounded MCP/A2A interoperability, host-selected web research, and release supply-chain gates.
- Reuse core event, redaction, run-limit, persistence, checkpoint, tool, credential, resource, and SSRF primitives; preserve dependency-free core and explicit optional-package activation.
- Make every remote, durable, telemetry, and evaluation path finite, authorization-scoped, redacted, testable without network access, and documented before the 0.0.8 release candidate.

## Expected Outcome

- Optional OpenTelemetry instrumentation produces parented agent, inference, tool, guardrail, and delegation spans; exported metrics use only bounded low-cardinality dimensions and default to metadata-only telemetry.
- `@arnilo/prism-evals` supports bounded final-result and trace evaluation, deterministic and host-supplied model judges, pairwise reports, immutable datasets, threshold assertions, and CI gates.
- MCP and A2A expose only supported, pinned-spec capabilities with explicit host auth/credentials, durable task/session behavior, strict transport bounds, and conformance fixtures.
- New optional `@arnilo/prism-web-tools` supplies host-selected Brave/Exa discovery and Firecrawl fetch/extraction through three narrow, schema-validated, untrusted-content tools; no provider SDK, credential, browser, or arbitrary remote capability enters core.
- 0.0.8 artifacts, docs, SBOM/license policy, provenance attestations, scheduled restricted live canaries, and release evidence pass required gates before publication.

## Tasks

- [x] 0. Freeze Phase 3 capability, primitive, and web-research contracts before implementation
  - Acceptance Criteria:
    - Functional: map every Phase 3 roadmap criterion to an existing primitive, minimum gap, owning task, test matrix, docs page, and release gate; record exact pinned MCP/A2A/OTel/vendor documentation revisions and SDK compatibility before changing public APIs.
    - Performance: freeze finite default/hard caps and charging points for telemetry buffering, evaluation datasets/judges, MCP resources/prompts/sessions, A2A task/artifact streams, web requests, and batch flushes before allocation or remote I/O.
    - Code Quality: inventory `AgentEvent`, `RunLedger`, `ProductionPersistenceStore`, `RunLimits`, guardrails, durable agent/workflow state, `ResourceLoader`, `CredentialResolver`, bounded provider/media transports, and all OTel/eval/MCP/A2A callers; introduce a core primitive only when at least two Phase 3 surfaces need it.
    - Security: freeze no-content-by-default telemetry; exact origin/session/ownership rules; explicit credential resolution; untrusted external-content handling; private-network denial; no automatic OAuth/token forwarding; and no browser/MCP passthrough fallback.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3, release gates, product boundaries, and Phase Planning Workflow; `docs/observability.md`, `docs/evaluations.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/runs-and-usage.md`, `docs/run-ledger-conformance.md`, `docs/performance.md`, `docs/host-security.md`, and `docs/release-and-install.md`.
      - Existing implementation: `src/agents.ts`, `src/contracts.ts`, `src/content.ts`, `src/providers/transport.ts`, `src/agent-run-state.ts`, `src/tools.ts`; OTel/evals/MCP/supervisor packages; SQLite/PostgreSQL persistence; and `.github/workflows/release.yml`.
      - Current OpenTelemetry GenAI semantic-convention repository: <https://github.com/open-telemetry/semantic-conventions-genai/tree/main/docs/gen-ai>. GenAI spans/metrics/events remain development-status; prompts, inputs, outputs, tool arguments/results, and evaluation explanations are opt-in/sensitive.
      - MCP 2025-11-25 transports, roots, resources, prompts, sampling, elicitation, and authorization: <https://modelcontextprotocol.io/specification/2025-11-25>. Context7 resolved `@modelcontextprotocol/sdk` v1.29.0 as `/modelcontextprotocol/typescript-sdk/v1.29.0`; it exposes declared client capabilities, roots handlers, server capabilities, and Streamable HTTP transport. Task 4 must record the exact compatible SDK version selected for 0.0.8.
      - A2A 1.0 specification and async/streaming guidance: <https://a2a-protocol.org/v1.0.0/specification> and <https://a2a-protocol.org/latest/topics/streaming-and-async/>. The current spec defines task get/list/cancel/subscribe, rich `text`/`raw`/`url`/`data` parts, ordered task events, authenticated push hooks, and `A2A-Version` negotiation.
      - Vendor research: Exa Search/Contents (<https://exa.ai/docs/reference/search>, <https://exa.ai/docs/reference/get-contents>), Brave Search API (<https://api.search.brave.com/app/documentation/web-search/get-started>), and Firecrawl Search/Scrape/Extract (<https://docs.firecrawl.dev/features/search>, <https://docs.firecrawl.dev/features/scrape>, <https://docs.firecrawl.dev/features/extract>). Firecrawl supports Markdown and JSON-schema output, but schema/prompt output stays untrusted and provider response/cost behavior must be bounded by Prism.
      - GitHub dependency review, SBOM, secret scanning, and attestation guidance: <https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review>, <https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-software-bill-of-materials>, <https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning>, and <https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds>.
    - Options Considered:
      - Build an observability backend, universal protocol proxy, vendor client framework, or a second durable task runtime: rejected; each duplicates host-owned infrastructure or existing Prism boundaries.
      - Add new core protocol/web vocabulary before inspecting existing seams: rejected; it risks generic abstractions with one implementation.
      - Freeze a traceability/cap matrix, use package-local adapters over existing primitives, and generalize only proven shared bounded transport/ledger/context seams: chosen.
    - Chosen Approach:
      - Create a checked-in Phase 3 evidence matrix containing exact source revisions, supported/unsupported protocol capability tables, primitive/caller disposition, default/hard-cap matrix, provider request/response normalization table, and each acceptance item’s owner.
      - Freeze these non-goals: hosted observability, automatic exporter registration, prompt/content telemetry by default, generic remote MCP exposure, arbitrary OAuth/token forwarding, MCP server discovery, gRPC/REST A2A bindings, browser automation, vendor SDK dependencies, vendor selection by model, and automatic live tests.
      - Require every later task to preserve core’s dependency-free runtime, explicit activation, redaction-before-persistence/export, and network-free default suite.
    - API Notes and Examples:
      ```text
      roadmap criterion -> current caller -> shared primitive -> minimal gap -> test -> docs -> release gate

      Capability not declared by peer or pinned SDK -> explicit unsupported error; never silent fallback.
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-19-phase-3.md` (new): source/capability/primitive/limit and release-gate matrix.
      - `docs/index.md`: link the Phase 3 review evidence under Release and install/maintenance.
      - `plans/070-release-0-0-8-production-telemetry-evaluations-protocols-web-research.md`: append finalized capability and cap evidence while executing this task.
    - References:
      - `packages/observability-opentelemetry/src/instrumentation.ts` currently creates independent event-derived spans.
      - `packages/evals` currently scores `AgentRunResult` only; `traceId` is a passive optional string.
      - `packages/mcp` bridges only tools and currently constructs stateless JSON-response Streamable HTTP transport; `packages/supervisor` implements text-only A2A 1.0 subset.
  - Test Cases to Write:
    - Traceability check: every roadmap criterion has one owner; no Phase 4 browser/coding/Office capability is required.
    - Capability/cap matrix check: each external operation has finite count/byte/time/concurrency defaults and hard caps, a credential owner, a redaction point, and explicit unsupported behavior.
    - Caller inventory check: every new generic primitive has at least two identified consumers; otherwise it stays package-local.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this task freezes evidence and scope before public implementation.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-19-phase-3.md`: implementation evidence and current documentation/source references.
    - `docs/index.md` update: yes; add the Phase 3 review coverage entry under Release and install/maintenance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Added `docs/review-coverage-2026-07-19-phase-3.md`, freezing Prism `6048e82db212303f4f072ff70539830b779f35cf`, OTel GenAI `c26a2c21d1ee70d5231bd440c7b48d3c94ee506a`, A2A v1.0.0 `173695755607e884aa9acf8ce4feed90e32727a1`, MCP SDK 1.29.0 lock integrity, canonical MCP/A2A/vendor/security sources, and retrieval date where vendor docs lack immutable revisions.
    - Mapped every Phase 3 roadmap criterion to its owner, current primitive/minimum gap, fake/live proof, docs, and release gate; froze supported/unsupported protocol and web boundaries, three conditional-only core primitive candidates, exact network/credential rules, and default/hard caps with charging points.
    - Verified current callers/contracts in core, OTel, evals, MCP, and supervisor; Context7 verified SDK 1.29.0 capability/roots/Streamable HTTP behavior; vendor docs confirmed Brave result constraints and Firecrawl v2 search/scrape behavior. Default tests remain network-free.

- [x] 1. Implement standards-based OpenTelemetry hierarchy, context propagation, and safe evaluation linkage
  - Acceptance Criteria:
    - Functional: one run creates a true agent parent span with provider inference, tool execution, guardrail, and delegation child spans or explicit documented links when a remote boundary prevents parenting; ambient/host context propagates through supported async paths and terminal/detach/error paths close spans exactly once.
    - Functional: map applicable current GenAI/MCP semantic conventions (`gen_ai.invoke_agent`, inference, `execute_tool`, MCP client/server) and emit a trace reference suitable for existing evaluation `traceId` linkage; unsupported semantics are absent rather than invented.
    - Performance: disabled instrumentation allocates no spans; enabled span state is bounded per active run/call and produces no delta span; metrics use stable low-cardinality dimensions only and exporter failure cannot delay, fail, or retain a run.
    - Code Quality: preserve the optional adapter boundary; use OTel API context/span primitives only in `@arnilo/prism-observability-opentelemetry` and add a dependency-free core carrier only if Task 0 proves multiple non-OTel consumers need it.
    - Security: default spans/events/metrics exclude prompts, messages, instructions, tool arguments/results, comments, arbitrary metadata, credentials, session/run/request/call IDs in metric labels, and evaluation explanations; any future content capture remains separately opt-in, bounded, redacted, and off by default.
  - Approach:
    - Documentation Reviewed:
      - OTel GenAI spans, metrics, events, agent spans, and MCP conventions from the source revisions frozen in Task 0; in particular, inference/tool content fields are sensitive opt-in, `gen_ai.evaluation.result` is parented to evaluated operation when possible, and metric label values must be controlled.
      - `docs/observability.md`, `docs/agent-events.md`, `docs/guardrails.md`, `docs/supervisors.md`, `docs/runs-and-usage.md`; `src/agents.ts` event/ledger lifecycle; `src/guardrails.ts`; `src/tools.ts`; `packages/supervisor/src/supervisor.ts`; existing adapter tests.
    - Options Considered:
      - Keep independent event-derived `prism.*` spans: cannot represent the required hierarchy or OTel GenAI conventions; rejected.
      - Put OpenTelemetry API/exporter dependencies or global registration in core: violates dependency-free/host-controlled boundaries; rejected.
      - Extend the optional adapter with explicit host context and package-owned span parenting, adding only a small generic carrier if the caller audit proves necessary: chosen.
    - Chosen Approach:
      - Replace event-name-only span mapping with an active run tree and a documented semantic mapping table; create parent spans at run/delegation entry rather than after a child has already completed.
      - Map provider attempts to inference spans, central tool dispatch to tool spans, and guardrail decisions to bounded child spans/events. Use delegation IDs only for internal association or span attributes, never metric labels.
      - Offer an explicit trace-reference callback/lookup to let hosts pass the generated trace ID into `scoreRun`/experiments; do not persist exporter-specific objects or trace context in durable run state.
      - Retain `createInMemoryTelemetry()` as conformance fixture and retain isolated exporter-error behavior.
    - API Notes and Examples:
      ```ts
      const telemetry = createOpenTelemetryInstrumentation({ tracer, meter });
      const result = await telemetry.run(session, "research", { traceParent });
      await scoreRun({ result, traceId: telemetry.traceId(result.runId), scorers: [citationScore] });
      ```
    - Files to Create/Edit:
      - `packages/observability-opentelemetry/src/instrumentation.ts`, `index.ts`, `src/__tests__/instrumentation.test.ts`: hierarchy, context, semantic mapping, lifecycle cleanup, and safe trace-reference API.
      - `packages/observability-opentelemetry/package.json`, `README.md`, `CHANGELOG.md`: exact optional OTel API peer/adapter contract selected by Task 0.
      - `src/contracts.ts`, `src/agents.ts`, `src/guardrails.ts`, `src/tools.ts`, `packages/supervisor/src/types.ts`, `supervisor.ts`: only if Task 0 proves a dependency-free context/delegation carrier is needed across these callers; otherwise no core/supervisor public type change.
      - `src/__tests__/agent-events.test.ts`, guardrail/tool/supervisor tests: only for any new generic carrier/event propagation.
      - `docs/observability.md`, `docs/evaluations.md`, `docs/agent-events.md`, `docs/guardrails.md`, `docs/supervisors.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Current adapter has separate `prism.agent.run`, `prism.provider.turn`, and `prism.tool.execute` spans keyed from events and no parent/context abstraction.
      - `AgentEvent` already gives bounded timing/usage and redacted event ordering; it remains the source of terminal state, not a second telemetry runtime.
  - Test Cases to Write:
    - Parentage matrix: agent → provider retry/tool/guardrail and supervisor delegation traces; validate context propagation and terminal error/abort/detach cleanup without double-end.
    - Semantic matrix: expected span names/kinds/required attributes and safe OTel metric instruments; unknown/unsupported convention fields are absent.
    - Safety matrix: prompt, tool arguments/results, secret canary, comments, IDs, and evaluation explanation never appear in metric labels or default span/event attributes; optional exporter failures do not affect result, ledger, or evaluation.
    - Performance matrix: disabled path starts no spans; high-delta stream creates no per-delta spans; active-map cleanup occurs after terminal/detach.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; OTel hierarchy/context/trace-reference APIs and semantic output change.
    - Docs pages to create/edit:
      - `docs/observability.md`: API shape, semantic map, context propagation, content default/opt-in policy, labels, exporter isolation, and performance limits.
      - `docs/evaluations.md`, `docs/agent-events.md`, `docs/guardrails.md`, `docs/supervisors.md`, `docs/host-security.md`, `docs/migration.md`: linkage and affected event/security behavior.
    - `docs/index.md` update: yes; update Observability, Evaluations, Agent/session runtime, and Security descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Reworked `@arnilo/prism-observability-opentelemetry` in place: `invoke_agent prism` now parents GenAI `chat {model}`, `execute_tool {tool}`, bounded guardrail, and explicit delegation spans; native OTel wrapping accepts host/ambient context and maps `INTERNAL`/`CLIENT` kinds without adding OTel to core.
    - Added `onTraceReference` plus bounded `traceId(runId)` lookup (1,024 default/10,000 hard), `gen_ai.evaluation.result`, seconds/token semantic instruments, terminal/detach exact-once cleanup, exporter callback isolation, and metadata-only controlled labels. No prompt/message/tool payload, guardrail reason/metadata, evaluation explanation, or high-cardinality ID enters metrics.
    - Expanded in-memory conformance records with trace/span/parent IDs and added network-free hierarchy, context, delegation, guardrail canary, error, detach, semantic metric, trace-link, disabled, and exporter-failure checks. Updated package README/changelog and Observability/Evaluations/Agent events/Guardrails/Supervisor/Security/Migration/index docs; no core or supervisor dependency/type change was needed.
    - Verification passed: package build/typecheck, 12/12 focused tests, package dry-run, repository typecheck, docs suite 84/84, repository tests 1,113/1,113 after updating numbered-plan count, and `git diff --check`.

- [x] 2. Extend evaluations to bounded trace grading, model judges, pairwise reports, and release thresholds
  - Acceptance Criteria:
    - Functional: datasets remain immutable/versioned; evaluators can score final `AgentRunResult` or a bounded complete trace resolved from explicit host/persistence inputs; deterministic function scorers remain the zero-dependency base.
    - Functional: optional model judges are explicit host-provided, rubric/version-attributed evaluators with finite request/response/time/attempt limits and redacted records; pairwise evaluation compares named candidate outputs deterministically and records ties/failures without silently selecting a winner.
    - Functional: experiment/comparison reports expose per-scorer aggregates, dataset/version/candidate attribution, trace/run links, and threshold assertion helpers suitable for a checked-in CI gate; failures use stable errors and non-zero command status.
    - Performance: trace pages, events, tool calls, usage, scorer concurrency, evaluator output, dataset items, comparison candidates, and report serialization all have finite defaults/hard caps; deterministic report ordering is preserved under parallel execution.
    - Code Quality: reuse `EvaluationStore`, redaction, `AgentRunResult`, `ProductionPersistenceStore` cursor queries, `RunLedger` record shapes, `RunLimits`, and existing experiment worker pool; do not make an LLM judge mandatory or create an evaluation database schema in core.
    - Security: trace resolution enforces exact supplied ownership and redacts/bounds before scorers/judges; judges receive no credential resolver/tool/workspace; model judge errors/reasons/prompts and threshold artifacts never expose secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/evaluations.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/database-persistence.md`, `docs/run-ledger-conformance.md`, `docs/guardrails.md`, and current `packages/evals` dataset/scorer/score/experiment/store implementation.
      - OTel `gen_ai.evaluation.result` convention from Task 1; its explanation is sensitive and never becomes a metric label.
    - Options Considered:
      - Score only final text forever: simple but cannot detect unsafe tool choice, blocked output, approvals, or handoffs; rejected.
      - Add an eval-specific SQL schema/service and mandatory judge provider: duplicates host persistence/provider ownership; rejected.
      - Add package-local bounded trace resolver/evaluator contracts, function scorers first, optional host-supplied model judge, and report threshold helper: chosen.
    - Chosen Approach:
      - Define a bounded `EvaluationTarget`/trace snapshot containing only necessary redacted run, event, tool-call, and usage records; resolve it through explicitly supplied owner-scoped persistence/trace reader rather than searching arbitrary ledgers.
      - Add evaluator metadata (`kind`, stable rubric/version, candidate) and pairwise scoring without changing existing `Scorer` compatibility; make judges an opt-in adapter over host-selected model execution and structured result validation.
      - Add `assertEvaluationThreshold()` and a small JSON report command/helper for deterministic offline gates; live model-judge gates remain separate and credential-gated.
    - API Notes and Examples:
      ```ts
      const report = await runComparison({
        dataset,
        candidates: { baseline, candidate },
        scorers: [exactMatch, pairwisePreference],
        traceResolver,
      });
      await assertEvaluationThreshold(report, { minimumMean: 0.9, maximumFailures: 0 });
      ```
    - Files to Create/Edit:
      - `packages/evals/src/types.ts`, `limits.ts`, `score.ts`, `experiment.ts`, `store.ts`, `util.ts`, `index.ts`: trace target/resolver, evaluator/judge, comparison, limits, threshold/report contracts.
      - `packages/evals/src/trace.ts`, `judge.ts`, `comparison.ts`, `threshold.ts` (new) and `src/__tests__/evals.test.ts`, `trace.test.ts`, `judge.test.ts`, `comparison.test.ts`, `threshold.test.ts` (new as applicable).
      - `packages/evals/package.json`, `README.md`, `CHANGELOG.md`; `examples/evaluation-gate.ts` (new) and `examples/README.md`.
      - `src/contracts.ts`, `src/testing/run-ledger-conformance.ts`, SQLite/PostgreSQL query tests only if the primitive review identifies a shared missing bounded read contract; otherwise use existing `ProductionPersistenceStore` queries unchanged.
      - `docs/evaluations.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/host-security.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/index.md`.
    - References:
      - `ScoreRunOptions` already carries `traceId`; `EvaluationStore` is intentionally package-local and in-memory by default.
      - `ProductionPersistenceStore.queryEvents/queryToolCalls/queryUsage` supplies the existing cursor-paginated trace source when hosts select it.
  - Test Cases to Write:
    - Trace scorer matrix: final result plus ordered provider/tool/guardrail/approval/delegation trace; exact ownership, missing cursor, redaction, aggregate byte cap, and abort behavior.
    - Judge matrix: deterministic fake judge, valid/invalid structured outcome, rubric version, timeout/abort/retry limit, sampling, redacted failure, and no provider/credential leakage.
    - Pairwise matrix: stable candidate order, win/loss/tie, missing/failed candidate, concurrent scoring determinism, and aggregate math.
    - Gate matrix: exact/minimum threshold, regression failure exits non-zero, JSON report is bounded and secret-free; default suite remains network-free.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; trace evaluators, judges, comparison reports, threshold gates, and evaluator result metadata are new optional package APIs.
    - Docs pages to create/edit:
      - `docs/evaluations.md`: target/judge/comparison/gate inputs, outputs, examples, bounds, redaction, and live-gate policy.
      - `docs/observability.md`, `docs/runs-and-usage.md`, `docs/host-security.md`, `docs/performance.md`, `docs/release-and-install.md`: trace linkage, storage, security, benchmarks, and CI usage.
    - `docs/index.md` update: yes; expand Evaluations and update Observability, Runs/usage, Performance, and Release entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Added package-local `EvaluationTarget`/`EvaluationTrace` and `createPersistenceTraceResolver()` over existing `ProductionPersistenceStore` queries. Resolution requires exact owner/session/run identity, detects repeated/missing pagination completion, preserves ordered rows, applies host redaction, and enforces exported page/aggregate-byte defaults and hard caps without changing core persistence contracts.
    - Added explicit `createModelJudge()` adapters with stable rubric/version attribution, abort/timeout, finite attempt/rubric/input/output limits, structured `[0,1]` validation, and redacted failed evaluation records. Judges receive only rubric/version, bounded target/item, and `AbortSignal`; no provider, credential, tool, or workspace capability is passed.
    - Added deterministic `runComparison()` over sorted named candidates and stable item/pair/scorer order, recording win/loss/tie/failure with candidate/scorer byte caps; added experiment/comparison `assertEvaluationThreshold()` gates and bounded redacted `serializeEvaluationReport()` artifacts. Immutable datasets now have a 10,000-item hard cap.
    - Updated package exports/README/changelog/description, Evaluations/Observability/Runs/Security/Performance/Release/index docs, and added network-free `examples/evaluation-gate.ts`. No eval-specific database schema, core API, mandatory judge provider, or live-network default gate was added.
    - Verification passed: eval package build/typecheck, 12/12 focused tests, package dry-run, repository typecheck including examples, docs suite 84/84, full network-free repository/workspace tests, and `git diff --check`.

- [x] 3. Add explicit run-ledger batching, session snapshot caching, and reproducible performance evidence
  - Acceptance Criteria:
    - Functional: an opt-in batched ledger adapter preserves per-run record order, distinguishes accepted/buffered/flushed durability, flushes/acknowledges terminal records according to declared policy, propagates flush failure, and documents crash-before-flush loss semantics; strict write-through remains default.
    - Functional: session context/summaries are cached per stable run/leaf and invalidated after successful append, compaction, branch change, and resume so provider assembly sees current history without repeated identical persistence reads.
    - Performance: batching has finite entry/byte/delay/in-flight limits and backpressure; cache has finite lifetime/size and no stale cross-run/branch result; PostgreSQL/provider/MCP/A2A/web benchmark scenarios publish throughput, p95 latency, memory, disk, cost metadata, and backpressure observations without becoming flaky CI time gates.
    - Code Quality: keep `RunLedger` write contract and serialized runtime ordering intact; add only a reusable optional flush/batch seam, not duplicate package-specific queues; reuse `branchReader`/`rebuildSessionContext` rather than a second session cache.
    - Security: buffered records are redacted before enqueue, disposal/abort leaves no secret-bearing queue retained, flush errors are bounded/redacted, and cached snapshots never cross session/ownership/leaf boundaries.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md`, `docs/run-ledger-conformance.md`, `docs/performance.md`, persistence pages, and current `RuntimeAgentSession.emit()`/`drainLedger()` ordering.
      - `src/contracts.ts` `RunLedger` and `ProductionPersistenceStore`; `src/agents.ts` repeated `snapshot()` reads; SQLite/PostgreSQL append/query implementations and existing conformance suites.
    - Options Considered:
      - Make every ledger write asynchronous without acknowledgement: improves latency but silently weakens durability; rejected.
      - Add batching independently to each persistence adapter: duplicated queues and incompatible semantics; rejected.
      - Keep write-through default and offer one explicit bounded adapter with terminal flush/ack semantics plus an in-session leaf cache: chosen.
    - Chosen Approach:
      - Define a minimal optional flushable/batched ledger contract and adapter only after Task 0 confirms it can wrap memory, SQLite, PostgreSQL, and host ledgers unchanged; runtime detects and awaits terminal flush only when selected.
      - Cache the canonical rebuilt snapshot by current branch leaf/run generation, invalidate only after committed state transitions, and retain no unbounded transcript copy beyond current runtime history.
      - Add a reproducible local benchmark script and publish dated environment/result tables; correctness/bounds remain CI gates, not hardware timing thresholds.
    - API Notes and Examples:
      ```ts
      const ledger = createBatchedRunLedger(store, {
        maxBatchEntries: 128,
        maxBatchBytes: 512 * 1024,
        maxDelayMs: 25,
        durability: "flush_on_terminal",
      });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`, `src/agents.ts`, `src/index.ts`, `src/__tests__/run-ledger.test.ts`, `src/__tests__/agents.test.ts`: optional flush/batch integration and snapshot-cache invalidation.
      - `src/run-ledger.ts` and `src/__tests__/run-ledger-batching.test.ts` (new): bounded adapter, limits, order, acknowledgement, and crash semantics.
      - `packages/session-store-sqlite/src/persistence.ts`, `packages/session-store-postgres/src/persistence.ts`, and their tests only for adapter integration/conformance proven necessary; do not alter their default write-through behavior.
      - `scripts/benchmark-0.0.8.mjs` (new), `docs/performance.md`, `docs/runs-and-usage.md`, `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/host-security.md`, `docs/index.md`.
    - References:
      - Current `RunLedger` has four ordered append methods; runtime serializes event appends and drains before final result.
      - `RuntimeAgentSession.snapshot()` rebuilds branch context on every call, including repeated provider assembly/compaction paths.
  - Test Cases to Write:
    - Ledger matrix: write-through compatibility; batch order across record kinds; batch byte/count/delay boundary; backpressure; terminal flush; abort; exporter/store rejection; crash-before-flush documented loss; no post-terminal append.
    - Cache matrix: same leaf uses one persistence read; append/compaction/branch/resume invalidates; failed append does not advance cache; independent sessions/branches never share snapshots.
    - Benchmark matrix: repeatable local synthetic provider/ledger/session/MCP/A2A/web-load scenarios emit p50/p95/throughput/memory/disk/cost fields and do not require credentials/network in default runs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; optional batched ledger/flush policy and session snapshot behavior are public operational contracts.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`, `docs/run-ledger-conformance.md`, `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/performance.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; update Runs/usage, Persistence, and Performance descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Added core `FlushableRunLedger`/durability/status contracts and `createBatchedRunLedger()` as one reusable wrapper over any existing ledger. Direct write-through remains default; wrapper preserves FIFO across all record kinds, exposes accepted/flushed/buffered counts, bounds batch/buffer count/bytes/delay, applies enqueue backpressure, retains failed head records, propagates explicit/terminal flush failures, and documents `buffered` crash/discard loss.
    - Runtime explicitly flushes `flush_on_terminal` ledgers after terminal run append. SQLite/PostgreSQL adapters remain unchanged and write-through; docs describe optional wrapping rather than duplicate adapter queues.
    - Added one-entry, session-local snapshot cache keyed by leaf plus mutation generation with a one-second lifetime. Successful append, compaction append, checkout, and durable resume invalidate; failed append leaves leaf/cache unchanged; forks create independent runtime caches.
    - Added `scripts/benchmark-0.0.8.mjs`, a bounded network/credential-free synthetic provider/PostgreSQL-ledger-shaped/MCP/A2A/web workload emitting environment, throughput, p50/p95, heap, disk, cost, and backpressure fields. Published dated Node 24/Linux x64/1,000-operation evidence in `docs/performance.md` and explicitly deferred live-system claims to Task 8.
    - Added batching/runtime/cache/export contract tests; updated core changelog and Runs/ledger conformance/Database/SQLite/PostgreSQL/Performance/Security/index docs. Verification passed: focused 216/216 tests, docs 84/84, repository/workspace typecheck and full tests, benchmark schema check, all-package dry-run packing, and `git diff --check`.

- [x] 4. Complete bounded MCP capabilities, Streamable HTTP sessions, and host-owned authorization integration
  - Acceptance Criteria:
    - Functional: client/server support tools, resources, prompts, roots, sampling, elicitation, capability/list-change notifications, and Streamable HTTP session lifecycle only when the pinned SDK/protocol supports each surface; every unselected or unavailable capability fails with a stable explicit unsupported error.
    - Functional: resources/prompts/roots/sampling/elicitation map to narrow host-provided Prism contracts; remote resources/prompt outputs are bounded/untrusted; server sampling and elicitation never select models, credentials, roots, or user consent on the host’s behalf.
    - Functional: Streamable HTTP preserves negotiated protocol/session headers, GET/POST/DELETE/SSE semantics, reconnect/replay rules where supported, exact authorization binding to origin/session/ownership, and host-provided OAuth/auth resolution; no access/refresh token enters model content, result, telemetry, or logs.
    - Performance: bound pages/items/cursors/schemas/resource bytes/prompt args/sampling messages/tools/elicitation schemas/requests/responses/sessions/concurrency/reconnects/wall time before SDK retention or schema compilation.
    - Code Quality: use pinned official SDK transport/handlers and existing MCP bounded JSON/SSRF/dispatch primitives; no custom JSON-RPC engine, generic remote command proxy, or MCP branch in core.
    - Security: require exact HTTPS origin/session policy, reject redirects/private/rebound targets, derive identity from validated host auth on every request, scope resources/prompts/tasks by ownership, enforce root consent/boundaries, validate nested client requests, and require explicit human interaction for URL elicitation.
  - Approach:
    - Documentation Reviewed:
      - Current MCP spec sections and Context7 SDK results recorded in Task 0; Streamable HTTP requires origin validation/authentication and defines `MCP-Session-Id`, negotiated protocol headers, SSE reconnect/replay, and session termination.
      - `docs/mcp-tools.md`, `docs/host-security.md`, `docs/tools.md`, `docs/resource-loading.md`, `docs/credential-storage.md`; `packages/mcp/src/bridge.ts`, `transport.ts`, `server.ts`, `limits.ts`, `json-bounds.ts`, and all bridge/server tests.
    - Options Considered:
      - Keep tool-only bridge and advertise broad MCP support: incorrect interoperability contract; rejected.
      - Expose raw SDK request/callback/command APIs to models: bypasses schemas, permission, ownership, and bounds; rejected.
      - Select a compatible SDK/spec version, implement only its declared capability surfaces behind explicit host contracts, and reject all others: chosen.
    - Chosen Approach:
      - First pin/update the SDK only after a compatibility test matrix proves API names and protocol version; record the package version, lockfile integrity, and excluded capabilities in docs/migration notes.
      - Extend the bridge with separate resource/prompt/capability facades rather than converting non-tool protocol operations into `ToolDefinition`; reuse `ResourceLoader` only where its load/list semantics fit.
      - Make Streamable HTTP stateful only through a host-selected session/authorization resolver; preserve existing bounded stateless mode as an explicit option if it remains supported.
      - Model roots, sampling, and elicitation as host callbacks with capability declarations and finite result validation; URL elicitation displays/returns an approved URL but never fetches or opens it automatically.
    - API Notes and Examples:
      ```ts
      const bridge = await connectMcpCapabilities({
        serverId: "research",
        transport: { type: "streamable-http", url, allowedOrigins: [origin] },
        roots: () => [{ uri: "file:///workspace", name: "workspace" }],
        sampling: hostSampling,
        elicitation: hostElicitation,
      });
      // Absent capability: ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY
      ```
    - Files to Create/Edit:
      - `packages/mcp/package.json`, root `package-lock.json`: exact MCP SDK version selected by compatibility matrix.
      - `packages/mcp/src/types.ts`, `limits.ts`, `bridge.ts`, `transport.ts`, `server.ts`, `content.ts`, `json-bounds.ts`, `index.ts`: capability contracts, bounded protocol mapping, session/auth lifecycle, and explicit errors.
      - `packages/mcp/src/resources.ts`, `prompts.ts`, `capabilities.ts`, `sessions.ts` and matching `src/__tests__/*.test.ts` (new as needed).
      - `src/contracts.ts`, `src/resources.ts`, `src/credentials.ts`, `src/content.ts`, and core tests only if a generic resource/credential/SSRF primitive is demonstrably reused by MCP and web tools; otherwise keep MCP-specific types package-local.
      - `packages/mcp/README.md`, `CHANGELOG.md`; `docs/mcp-tools.md`, `docs/resource-loading.md`, `docs/tools.md`, `docs/credential-storage.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Current bridge intentionally uses raw `tools/list` to bound untrusted schemas before SDK compilation and preserves last good tool array on failed refresh.
      - Current server helper creates stateless JSON-response `WebStandardStreamableHTTPServerTransport`; it does not advertise resources/prompts/sampling/elicitation.
  - Test Cases to Write:
    - Capability matrix: declared/undeclared tools/resources/prompts/roots/sampling/elicitation/notifications; every unsupported path returns stable error without remote side effect.
    - Streamable HTTP matrix: initialize/header negotiation, session create/reuse/delete/404 reset, POST/GET SSE, `Last-Event-ID` replay/reconnect when enabled, timeout/abort, origin/redirect/rebinding/private-host denial, and exact session-owner mismatch.
    - Host callback matrix: root validation/consent, bounded resource/prompt pagination and content, sampling tool-result balance/limits, form and URL elicitation accept/decline/cancel, URL non-fetch, OAuth/auth credential redaction.
    - Regression matrix: hostile cursors/schema/result/resource/prompt/elicitation payloads, concurrent session/call caps, dispatcher permission/guardrail/validator preservation, and network-free fake SDK/server conformance.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; MCP capability, session, auth, resource/prompt/root/sampling/elicitation APIs and unsupported behavior expand.
    - Docs pages to create/edit:
      - `docs/mcp-tools.md`: exact pinned protocol/SDK support table, session/auth lifecycle, host callbacks, limit table, unsupported matrix, and migration guidance.
      - `docs/resource-loading.md`, `docs/tools.md`, `docs/credential-storage.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update MCP, Tools, Resource loading, Credentials, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Pinned official `@modelcontextprotocol/sdk` 1.29.0 exactly in the MCP package/lockfile. Added `connectMcpCapabilities()`/`attachMcpCapabilities()` over official SDK clients: tools remain Prism `ToolDefinition`s, while resources/prompts remain separate bounded host facades; roots, sampling, and form/URL elicitation are declared only with explicit host callbacks.
    - Added stable `McpUnsupportedCapabilityError` (`ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY`), bounded resource/prompt pages/items/results, bounded root/sampling/elicitation input/results, file-root validation, server resource/prompt count/name/URI/argument/result bounds, and official list-change declarations. No MCP branch or new resource/credential primitive was added to core.
    - Extended `createPrismMcpServer()` with explicitly selected resource/prompt registrations. Every read/get invokes existing host `authorize` with SDK auth/session metadata; returned protocol objects are known-secret-redacted and byte/depth/property bounded. Sampling/model/provider/credential selection, roots, and consent remain host-owned; accepted elicitation requires a stripped host-only `humanInteraction: true` marker, and URL elicitation never opens or fetches a URL.
    - Extended official Web-standard Streamable HTTP handling with opt-in `MCP-Session-Id` lifecycle. Stateless JSON mode remains default. Stateful mode requires exact origins, host auth resolution, and `resolveIdentity`; every POST/GET/DELETE/SSE request is rebound to one validated non-secret principal, mismatches return non-disclosing 404, sessions/concurrency/body/response/time are bounded, and SDK protocol/session headers are preserved. SDK 1.29.0 event replay remains explicitly unsupported rather than custom-built.
    - Added network-free SDK in-memory capability tests for resources/prompts/roots/sampling/elicitation/unsupported paths plus stateful principal-binding regression coverage; existing secure HTTP tests continue covering origin, redirects, private/rebound DNS, GET/POST/DELETE, response bounds, and abort.
    - Updated MCP README/changelog and MCP/Resources/Tools/Credentials/Security/Migration/index docs with support matrix, limits, auth/session lifecycle, token boundary, and exclusions. Verification passed: MCP 38/38 tests, docs 84/84, workspace typecheck, full repository tests, MCP dry-run pack, benchmark schema check, and `git diff --check`.

- [x] 5. Complete A2A 1.0 durable task, rich-part, reconnect, and push-hook interoperability
  - Acceptance Criteria:
    - Functional: A2A supports authenticated durable task status/get/list/cancel/subscribe through existing host-selected agent/workflow lifecycle and persistence seams; no new worker, queue, agent engine, or mandatory schema is introduced.
    - Functional: message/artifact parts validate and bound text, raw file bytes, file URLs, and structured data; outgoing data maps to Prism content/resource artifacts without automatically dereferencing remote URLs, and incoming remote content remains untrusted/redacted.
    - Functional: streams emit ordered task/status/artifact updates, handle interrupted `INPUT_REQUIRED`/`AUTH_REQUIRED` states, reconnect through `SubscribeToTask`, and retain/replay only bounded authorized events; optional push hooks are capability-gated and host-owned.
    - Functional: Agent Cards/JSON-RPC map current A2A 1.0 protocol/version/error/capability semantics, preserve explicit card verification, and distinguish unavailable/unauthorized/not-found without foreign-task disclosure.
    - Performance: bound task/history pages, IDs, messages, parts, base64/data bytes, artifacts, event/replay buffer, push configs/retries, webhook output, concurrent requests/subscriptions, and timeout; canceled/terminal tasks release streams/timers/active slots.
    - Code Quality: extend the existing supervisor package and A2A client/server/card validators; adapt `AgentRunLifecycle`, workflow status/cancel, checkpoints, run ledgers, content bounds, and SSRF primitives only through narrow adapters.
    - Security: authenticate/authorize every task and push operation with exact owner scope; validate signed/pinned cards; never auto-fetch card keys/URLs; deny SSRF/private/rebound/redirected push or file URLs absent host policy; redact secrets from parts/errors/events; treat push credentials as secrets and process deliveries idempotently.
  - Approach:
    - Documentation Reviewed:
      - A2A 1.0 task, part, task-update, push-notification, JSON-RPC, Agent Card, and security requirements frozen in Task 0.
      - `docs/a2a.md`, `docs/supervisors.md`, `docs/agent-session-runtime.md`, `docs/workflows.md`, `docs/host-security.md`, and current supervisor A2A/card/client/server implementation/tests.
    - Options Considered:
      - Extend the current one-request text handler with an in-memory task map: loses restart/owner correctness and creates a second runtime; rejected.
      - Implement every A2A binding, discovery registry, and automatic JWK fetch: broad, unsafe scope; rejected.
      - Keep JSON-RPC/HTTPS binding, add an explicit package-owned task-lifecycle adapter over existing durable host primitives, and expose only declared capabilities: chosen.
    - Chosen Approach:
      - Introduce a narrow `A2ATaskLifecycle`/task-store contract supplied by a host or existing Prism adapter; it starts, gets, lists, cancels, and subscribes to existing run/workflow work with exact owner authorization and safe public snapshots.
      - Make synchronous text invocation backward-compatible while durable operations require the lifecycle adapter and correctly change Agent Card capabilities.
      - Parse/serialize current A2A one-of parts and stream responses under aggregate bounds; preserve text-only safe default unless host explicitly enables raw/data/url artifact policy.
      - Model push as host-provided delivery/verification policy with explicit capability, strict URL/egress bounds, no retries beyond configured finite limits, and no hidden background sender.
    - API Notes and Examples:
      ```ts
      const handler = createA2AHandler({
        card,
        authorize,
        tasks: createA2ATaskLifecycle({ agentRuns, workflows, persistence }),
        push: { deliver: hostWebhookDelivery, networkPolicy },
      });
      // No tasks/push option: card omits those capabilities and calls fail explicitly.
      ```
    - Files to Create/Edit:
      - `packages/supervisor/src/a2a-types.ts`, `a2a-card.ts`, `a2a-client.ts`, `a2a-server.ts`, `index.ts`, `errors.ts`, and A2A tests.
      - `packages/supervisor/src/a2a-tasks.ts`, `a2a-parts.ts`, `a2a-push.ts` (new): bounded lifecycle/part/push adapters and protocol errors.
      - `packages/supervisor/src/types.ts`, `supervisor.ts` only if Task 1 requires a generic delegation trace carrier; do not couple A2A task execution to local supervisor planning.
      - `src/agent-run-lifecycle.ts`, workflows status/cancel exports, `src/content.ts`, persistence tests only for proven adapter gaps; no mandatory persistence migration/table.
      - `packages/supervisor/README.md`, `CHANGELOG.md`; `docs/a2a.md`, `docs/supervisors.md`, `docs/agent-session-runtime.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`.
    - References:
      - Current A2A path only accepts text parts and maps each request to an immediate session run; its client exposes only `getCard`, `send`, and text `stream`.
      - Existing card JWS verification pins explicit trusted keys and must not regress into automatic remote key discovery.
  - Test Cases to Write:
    - Durable task matrix: start/restart/get/list/page/cancel/subscribe; wrong/missing owner; duplicate/stale cancel; terminal/interrupted states; status ordering; task/stream cleanup.
    - Part/artifact matrix: text/raw/url/data valid boundaries, malformed one-of/base64/JSON/mime, aggregate overflow, URL non-fetch/SSRF denial, redaction, and untrusted-content markers.
    - Reconnect matrix: stream disconnect/re-subscribe/replay cursor, ordered status/artifact events, terminal close, duplicate delivery/idempotency, and no cross-task replay.
    - Card/push matrix: version/capability/error mapping, signature/card tamper/expiry, omitted capability rejection, exact owner, webhook authentication/replay/URL policy/retry/timeout/abort, and fake-server conformance without public network.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; A2A durable task, rich-part, subscription/replay, push, and capability contracts change.
    - Docs pages to create/edit:
      - `docs/a2a.md`: supported binding/version/capability table, task lifecycle, parts/artifacts, reconnect/replay, push policy, ownership, bounds, and errors.
      - `docs/supervisors.md`, `docs/agent-session-runtime.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update A2A, Supervisor, Agent/session runtime, Workflow, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Extended existing JSON-RPC/HTTPS implementation to A2A 1.0 `GetTask`, `ListTasks`, `CancelTask`, and `SubscribeToTask` through host-supplied `A2ATaskLifecycle`. Every call carries validated `A2AAuthorization` and abort signal; missing/foreign tasks share `-32001`, absent lifecycle/push/extended-card surfaces use `-32004`, version mismatch uses `-32009`, and no worker, queue, task cache, persistence schema, or core API was added.
    - Added exact-one-of text/raw/URL/data parts, rich messages/artifacts/history, all current task states including `INPUT_REQUIRED`, `AUTH_REQUIRED`, and `REJECTED`, and full task/status/artifact stream events. Text stays default; raw/data/URL require explicit policy, strict base64/finite JSON/depth/property/byte checks, and credential-free HTTPS URL validation that never dereferences content.
    - Added ordered SSE event IDs, bounded cursor replay through `SubscribeToTask`, duplicate suppression/rejection, interrupted-state closure, terminal subscription rejection, iterator/abort/timer/active-slot cleanup, and client `sendMessage/getTask/listTasks/cancelTask/subscribeToTask` APIs while preserving existing text `send/stream` behavior.
    - Added capability-matched push notification config create/get/list/delete on handler/client through host `A2APushProvider`. Config IDs/pages/bytes/URLs are bounded and owner-scoped by adapter; tokens/auth credentials are removed from responses. Explicit `deliverA2APushEvent()` bounds attempts/time and forwards stable event IDs as idempotency keys; delivery transport, SSRF/rebinding checks per attempt, authentication, idempotent processing, and persistence remain host-owned with no hidden background sender.
    - Preserved explicit host-pinned ES256 Agent Card verification and added card collection/byte bounds plus exact push-capability/adapter matching to avoid invalid signed-card mutation or false advertisement. Consolidated shared part/limit validation in `a2a-parts.ts` and kept push delivery to one explicit `a2a-push.ts` helper instead of speculative task/store classes; existing durable agent/workflow/checkpoint seams adapt through the narrow lifecycle contract without package coupling.
    - Added network-free durable owner/list/cancel/rich-part/depth/base64/reconnect/replay/push/version/capability tests alongside existing signature, UTF-8/SSE, auth, abort, and transport-bound tests. Updated package README/changelog/description and A2A/Supervisor/Agent runtime/Workflow/Security/Migration/index docs with support matrix, limits, host responsibilities, errors, and unsupported bindings. Verification passed: supervisor 14/14 tests, docs 84/84, workspace typecheck, full repository/workspace tests, supervisor dry-run pack, benchmark schema check, and `git diff --check`.

- [x] 6. Create optional bounded `@arnilo/prism-web-tools` for host-selected search, fetch, and extraction
  - Acceptance Criteria:
    - Functional: `web_search`, `web_fetch`, and `web_extract` are separate `ToolDefinition`s with narrow schemas; hosts explicitly choose Brave or Exa discovery and Firecrawl fetch/extraction adapters, credential resolution, allowed origins, SSRF policy, concurrency, and limits at construction time.
    - Functional: normalized search results retain title, canonical URL, snippet/highlights, source/provider result ID, publication/retrieval time, cost/rate metadata when available, and a stable citation identity; fetch/extract returns bounded Markdown or JSON-schema-validated data marked as untrusted external content.
    - Functional: Firecrawl schema extraction uses host-provided JSON Schema and validates both request and returned value before tool output; provider/model selection remains host-owned and browser automation is never invoked or installed.
    - Performance: cap query bytes, result count, URL count, redirects, response/Markdown/extract/schema/aggregate bytes, JSON depth/properties, retries, rate-limit delay, request concurrency, polling attempts, and wall time; expose bounded cost/rate metadata without inventing provider billing.
    - Code Quality: use native `fetch`, existing bounded-response/SSRF/redaction primitives where their contract fits, and small provider adapters over a common normalized public result contract; add no Exa/Brave/Firecrawl SDK dependency and no vendor code to core.
    - Security: API credentials resolve late through host-owned resolver/callback and never enter prompts, tool results, telemetry, errors, URLs, or command output; exact provider API origins and every redirect are policy-checked; private/internal targets require explicit host policy; fetched text/data is prompt-injection-capable untrusted input and never changes system instructions/tool permissions.
  - Approach:
    - Documentation Reviewed:
      - Vendor sources recorded in Task 0. Firecrawl supports search, Markdown scrape, and JSON-schema extraction; its cache/freshness, rate/cost behavior is provider-specific and must be surfaced only when returned.
      - `docs/tools.md`, `docs/resource-loading.md`, `docs/multimodal-content.md`, `docs/host-security.md`, `docs/credential-storage.md`, `docs/provider-primitives.md`; `src/content.ts` SSRF/pinned-request helpers, `src/providers/transport.ts`, `src/credentials.ts`, `src/tools.ts`, and MCP transport limits.
    - Options Considered:
      - One mega web/browser tool or official remote MCP server as production path: coarse permissions, provider/credential leakage, and arbitrary remote capability; rejected.
      - Vendor SDKs: unnecessary dependency/load surface for simple HTTP APIs; rejected unless Task 0 documents an unrepresentable required safety behavior.
      - One optional package with three narrow tools, native fetch, host-selected adapters, and official MCP servers documented only as hardened-bridge prototypes: chosen.
    - Chosen Approach:
      - Define package-local search/document/extraction/citation/limit contracts; normalize only public result fields common to providers and retain provider-specific facts under bounded metadata.
      - Reuse/genericize a core bounded fetch primitive only if Task 0 proves both media and web consumers need identical pinned-DNS/SSRF behavior; otherwise keep API-origin transport package-local.
      - Separate discovery from fetch/extraction so hosts control credit/context use. Brave is conventional discovery, Exa semantic/research discovery, Firecrawl JavaScript/PDF-aware Markdown or named-schema extraction; no model may switch adapter or obtain credentials.
      - Return untrusted content as a typed/documented result and tool-role payload with explicit source/citation metadata; do not parse instructions from it or elevate it into host prompts/configuration.
    - API Notes and Examples:
      ```ts
      const tools = createWebTools({
        search: createBraveSearch({ credentials, allowedOrigins: ["https://api.search.brave.com"] }),
        fetch: createFirecrawlFetch({ credentials }),
        extract: createFirecrawlExtractor({ credentials }),
        limits: { maxResults: 10, maxUrls: 5, maxMarkdownBytes: 1_000_000 },
      });
      // createExaSearch(...) is substituted by the host, never selected by the model.
      ```
    - Files to Create/Edit:
      - `packages/web-tools/package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md` (new optional package).
      - `packages/web-tools/src/types.ts`, `limits.ts`, `transport.ts`, `normalize.ts`, `tools.ts`, `exa.ts`, `brave.ts`, `firecrawl.ts`, `index.ts`, and `src/__tests__/*` (new): contracts, bounded direct adapters, tools, and fake-server conformance.
      - Root `package.json`, `package-lock.json`, `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, and selected profile manifests (`packages/prism-all` plus another profile only if Task 0’s size/adoption review supports it): workspace/package graph and offline consumer coverage.
      - `src/content.ts`, `src/credentials.ts`, `src/contracts.ts`, and core tests only if a generic shared bounded fetch/credential primitive is proven necessary; otherwise no core change.
      - `examples/web-research.ts` (new), `examples/README.md`, `docs/web-tools.md` (new), `docs/tools.md`, `docs/host-security.md`, `docs/credential-storage.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/index.md`.
    - References:
      - Product boundary in `roadmap.md`: cheapest path is search → bounded fetch/extraction → browser; Phase 3 explicitly excludes browser automation.
      - Existing media resolver already has finite bytes/time and SSRF policy but is media-shaped; reuse must be justified rather than forcing web semantics into it.
  - Test Cases to Write:
    - Search normalization matrix: Brave/Exa fake responses, canonical URL/citation identity, title/snippet/highlight/date/provider mapping, missing fields, duplicates, cost/rate metadata, result/query limits, retries, abort, and redaction.
    - Fetch/extract matrix: Firecrawl Markdown/JSON-schema response, invalid schema/value, async/polling status, cache/freshness metadata, response/aggregate overflow, JSON depth, timeout/abort, and tool schema validation.
    - Remote-boundary matrix: exact provider origin, redirect/private/loopback/rebinding denial, explicit host-private allow, credential canary absence, hostile HTML/JSON/Markdown, and untrusted-content marker/prompt-injection fixtures.
    - Integration matrix: search→host-selected fetch/extract routing, no browser import/invocation, network-free fake-server conformance, and restricted credential-gated Exa/Brave/Firecrawl live smoke suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package, adapters, tool names/schemas, normalized result/citation contract, limits, and credential configuration are public.
    - Docs pages to create/edit:
      - `docs/web-tools.md`: API pages for search/fetch/extract, adapter selection, results/citations, limits, untrusted content, credentials, SSRF, costs, and live-test policy.
      - `docs/tools.md`, `docs/host-security.md`, `docs/credential-storage.md`, `docs/performance.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes; add Tools → Web search, fetch, and extraction; update Security, Credentials, Performance, and Release entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Added optional zero-vendor-SDK `@arnilo/prism-web-tools` with root and atomic Brave/Exa/Firecrawl subpaths. `createWebTools()` returns only selected `web_search`, `web_fetch`, and `web_extract` definitions; provider, API origin, credential, target policy, extraction schema/validator, and limits are fixed by host construction and absent from model arguments.
    - Added direct native-fetch Brave `GET /res/v1/web/search`, Exa `POST /search` with bounded contents, Firecrawl v2 `POST /scrape`, and asynchronous `POST/GET /extract` adapters. Search normalization preserves bounded public title/URL/snippet/highlight/date/provider ID and returned request/cost/rate facts, removes duplicate canonical URLs, and derives stable `web:<provider>:<id-or-sha256>` citation identities without guessing missing billing/freshness.
    - Added host-schema validation before Firecrawl extraction dispatch and host `ToolArgumentValidator` validation after response/polling. Markdown/JSON/search results are aggregate-bounded and marked `untrusted: true`; tool results add `trust: "untrusted_external"` plus a data-only warning. No browser, HTML execution, generic web proxy, provider routing, vendor SDK, or core API was added.
    - Added package-local exact HTTPS provider-origin validation, redirect denial, late credential resolution with sanitized failures, bounded streaming response decode, JSON depth/property/key/finite-number checks, request/response/Markdown/extract/schema/aggregate caps, semaphore concurrency, finite retries/rate delays/polling/wall time, abort cleanup, and target URL SSRF policy. Firecrawl handoff validates URL syntax/private literals and optional host DNS/egress policy but explicitly makes no post-handoff DNS-pinning claim.
    - Added network-free fake-fetch conformance for Brave/Exa normalization, citations/deduplication/cost/rate metadata, late credentials/canary absence, query/origin/response/retry/abort/concurrency limits, Firecrawl Markdown/prompt-injection data, private/rebound/explicit-private target policy, async extraction/schema mismatch/remote-ref/poll caps, and separate tool contracts. Restricted `PRISM_LIVE_WEB=1` Brave/Exa/Firecrawl smokes skip safely without provider credentials.
    - Added package/profile graph and lockfile membership (`@arnilo/prism-all` only), package/install-smoke guards, offline `examples/web-research.ts`, package README/changelog, structured `docs/web-tools.md`, and Tools/MCP/Credentials/Security/Performance/Release/Migration/index docs. No second profile gained web tools and no generic core transport was extracted because API-origin JSON transport is not identical to core media DNS-pinned byte retrieval.
    - Verification passed: web-tools 5/5 focused tests, 3/3 live tests safely skipped without gates, docs 84/84, packaging 159/159, packed offline install 6/6, workspace typecheck including example, full repository/workspace tests, web package dry-run pack, benchmark schema check, and `git diff --check`.

- [x] 7. Add supply-chain security automation and restricted live-canary release gates
  - Acceptance Criteria:
    - Functional: CI runs SAST, PR dependency review, source/tarball secret scanning, SPDX SBOM generation, allow/deny license policy, package-artifact attestation, and scheduled dependency updates; failures are required before publish where repository/service capabilities permit.
    - Functional: scheduled/manual live canaries exercise least-privilege provider/MCP/A2A/web credentials separately from `sdk:ready`; each test has explicit environment gate, timeout, cleanup, cost cap, secret redaction, and no artifact/log secret leakage.
    - Performance: default `npm test` and `npm run sdk:ready` remain network-free within existing time backstops; security scans and canaries have finite job/step timeouts, artifact-size/retention caps, and isolated concurrency.
    - Code Quality: prefer GitHub-native security/dependency/SBOM/attestation features and Node/npm scripts over an application dependency or custom security platform; pin Actions by immutable revision and minimize workflow token permissions.
    - Security: no `pull_request_target`; untrusted PR code never receives secrets/OIDC publish credentials; publish retains exact tag/version/provenance checks; scanners reject real credential material and CI artifacts contain only redacted reports/SBOM/checksums/tarballs allowed by packaging policy.
  - Approach:
    - Documentation Reviewed:
      - Current release workflow and release scripts; `docs/release-and-install.md`; GitHub supply-chain references frozen in Task 0.
    - Options Considered:
      - Rely only on `npm audit` and npm publish provenance: misses source secrets, PR dependency/license policy, static analysis, and release artifact attestations; rejected.
      - Add a hosted security product/runtime agent: unnecessary operational scope; rejected.
      - Compose native GitHub security features, pinned actions, npm SPDX output, small Node policy checks, Dependabot, and isolated credential-gated jobs: chosen.
    - Chosen Approach:
      - Add separate least-privilege workflows for PR security analysis and scheduled/manual canaries; keep `release.yml` as final pack/attest/publish orchestrator after required checks.
      - Generate SBOM from locked install, validate license policy with a checked-in declarative list and small Node script, attach SBOM/checksums to release artifacts, and attest built tarballs/SBOM via GitHub OIDC.
      - Use environment-scoped secrets for canaries; never echo requests/responses/headers, retain only redacted aggregate status, and cancel superseded scheduled runs.
    - API Notes and Examples:
      ```yaml
      permissions: { contents: read, security-events: write }
      # Pinned action revisions are selected and recorded during implementation.
      # Live API keys exist only in a protected environment-scoped scheduled job.
      ```
    - Files to Create/Edit:
      - `.github/workflows/security.yml`, `.github/workflows/live-canaries.yml` (new), `.github/workflows/release.yml`: SAST/dependency/secret/SBOM/license/attestation/canary gates and least permissions.
      - `.github/dependabot.yml` (new): scheduled npm/GitHub Actions dependency updates.
      - `scripts/verify-sbom.mjs`, `scripts/live-canary.mjs` (new) and focused tests/fixtures: policy/report/canary bounds and redaction.
      - `.github/codeql/*`, `.github/secret-scanning*`, `.github/dependency-review*`, license policy file(s) as selected by the native-action configuration.
      - `docs/release-and-install.md`, `docs/host-security.md`, `docs/performance.md`, `docs/index.md`.
    - References:
      - Current workflow performs SDK readiness, Node 20 import, PostgreSQL integration, tarball checksums, and npm provenance publish but lacks the complete Phase 3 security matrix.
  - Test Cases to Write:
    - Workflow/policy tests: source checks pin minimal permissions, no `pull_request_target`, immutable action revisions, required job dependencies, SBOM license allow/deny behavior, attestation subject paths, and artifact retention/size policy.
    - Secret-negative tests: generated temporary canary credentials/redacted errors are absent from scripts, reports, tarball manifests, logs, and uploaded artifact paths; scanner configuration catches representative non-live patterns without committing secrets.
    - Canary tests: missing gate/key skips safely, invalid credential fails redacted, fake endpoint honors timeout/abort/cost cap, and public network cannot run from default suite.
    - Release regression: tag/version/range/publish/provenance checks remain deterministic and Phase 3 package is included in package/install/profile validation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; supported release/security gate behavior, package attestations, SBOM/license policy, and live-canary prerequisites change.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: required CI checks, SBOM/license/attestation artifacts, canary environment prerequisites, and operator handoff.
      - `docs/host-security.md`, `docs/performance.md`: secret/credential, artifact, and resource-budget guidance.
    - `docs/index.md` update: yes; update Release and install and Security/auth/trust entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Added `.github/workflows/security.yml`: JavaScript/TypeScript CodeQL, PR-only dependency review, high-severity npm audit, npm-generated SPDX 2.3 SBOM, exact checked-in license allow/deny policy, tracked-source and unpacked-public-tarball high-confidence secret scans, 128-MiB aggregate artifact ceiling, and seven-day SBOM retention. Added bounded weekly npm/GitHub Actions Dependabot updates and CodeQL path exclusions.
    - Reworked `.github/workflows/release.yml` so tag publication needs SDK readiness, Node 20 imports, PostgreSQL, tag-only CodeQL, and supply-chain jobs. Before npm publish it verifies SPDX/licenses, scans unpacked tarballs, emits SHA-256 checksums, and creates GitHub OIDC attestations for all package tarballs and the SBOM; npm provenance and deterministic resumable exact-tag publication remain intact. Only publish receives `NPM_TOKEN`, `id-token: write`, and `attestations: write`.
    - Pinned every third-party action to verified full commit revisions: checkout `93cb6ef`, setup-node `a0853c2`, upload-artifact `b7c566a`, dependency review `a1d282b`, CodeQL `7188fc3`, and dereferenced attest-build-provenance v4.1.1 commit `0f67c3f`. No workflow uses `pull_request_target`; default workflow permissions are `contents: read`, with write grants scoped to CodeQL or tag attestation jobs.
    - Added `scripts/verify-sbom.mjs` (16-MiB/10,000-package SPDX bounds and exact license policy) and `scripts/scan-secrets.mjs` (100,000-file/16-MiB-per-file limits, no matched-value output). Current npm SPDX contained 183 packages/eight approved expressions; `npm audit --audit-level=high` returned zero vulnerabilities; tracked source and all 31 unpacked package tarballs scanned with zero findings (783 public files, 858,073 packed bytes).
    - Added scheduled/manual `.github/workflows/live-canaries.yml` with protected `live-canaries` environment, no PR trigger/npm install/OIDC, isolated concurrency, five-minute job/three-minute step timeout, and seven-day aggregate status retention. `scripts/live-canary.mjs` skips before network unless `PRISM_LIVE_CANARIES=1`, requires all protected endpoint/credential inputs when enabled, performs one-token provider, MCP initialize plus optional bounded DELETE cleanup, A2A card, and one-result Brave probes, caps each response at 64 KiB and request at 15 seconds (30-second hard cap), follows no redirects, and emits no endpoints/headers/bodies/credentials/session IDs. Dollar quotas remain provider-account policy and are explicitly documented.
    - Added network-free `supply-chain-security.test.ts` coverage for SPDX allow/deny/missing licenses, generated credential detection without echo, disabled/missing canary gates, four successful fake endpoint probes plus MCP cleanup, invalid-credential redaction, abort timeout, immutable action revisions, no `pull_request_target`, minimal permissions, release dependencies/attestation subjects, artifact caps, protected environment, and retention. GitHub secret scanning/push protection and required-check enforcement were documented as repository settings because GitHub has no checked-in workflow switch for them; no ineffective pseudo-config was added.
    - Updated root changelog and release, host-security, performance, and docs-index guidance with required branch checks, action/dependency update policy, SBOM/license/secret boundaries, attestation handoff, protected canary credentials/account quotas, report exclusions, and finite scan/canary/artifact backstops.
    - Verification passed: focused supply-chain/release/network-free tests 13/13, docs plus supply-chain 89/89, full workspace typecheck, full repository/workspace tests, all 31 dry-run packs, real npm SPDX/license verification, zero-vulnerability audit, source/tarball secret scans, benchmark schema check, and `git diff --check`. Restricted public-network canaries were intentionally not run because protected credentials/endpoints are release-host prerequisites.

- [x] 8. Publish Phase 3 documentation, package graph, benchmarks, and 0.0.8 release-candidate evidence
  - Acceptance Criteria:
    - Functional: all public APIs, capability/unsupported matrices, limits, host responsibilities, examples, migration notes, changelogs, profile manifests, and package exports describe actual Phase 3 behavior; official Exa/Firecrawl MCP servers are documented only as hardened-bridge prototypes.
    - Functional: all publishable manifests, peer/internal dependencies, lockfile, release tests, install smoke, package/profile membership, and release scripts form exact 0.0.8 graph including `@arnilo/prism-web-tools`; no tag or publish occurs without operator authorization.
    - Performance: publish dated benchmark results for ledger/snapshot/OTel, PostgreSQL/provider/MCP/A2A/web workload scenarios and preserve existing offline test/CI time budgets; any ceiling change has measured rationale.
    - Code Quality: `sdk:ready`, Node 20/current compatibility, packed offline consumer, docs/export/package guards, SAST/dependency/secret/SBOM/license checks, and relevant package conformance all pass from the release-candidate tree.
    - Security: audit is clean at selected severity, tarball/artifact review finds no source/tests/maps/secrets, live suites use least privilege and pass or remain explicit documented release-host prerequisites; roadmap marks Phase 3 complete only after evidence is recorded.
  - Approach:
    - Documentation Reviewed:
      - Every page/README/changelog/example changed by Tasks 1–7; `docs/index.md` API page requirements; `docs/release-and-install.md`; `docs/performance.md`; `docs/migration.md`; package/export/install/release meta-tests.
    - Options Considered:
      - Publish immediately after feature tests: misses cross-package/profile, consumer, docs, supply-chain, and live evidence; rejected.
      - Fold every test into default network-free CI: would require external credentials and make release health nondeterministic; rejected.
      - Maintain strict offline gate plus separate protected live canaries and release-host prerequisites: chosen.
    - Chosen Approach:
      - Run focused task suites first, then complete deterministic package/docs/security matrix, then restricted live matrices; record actual commands/results/deviations in this plan and roadmap only after success.
      - Update docs navigation and API-page structure as code is finalized, add runnable network-free examples, and use performance tables as dated evidence rather than portability claims.
      - Version all 0.0.8 manifests together, validate fresh packed imports/profile install, perform release preflight/publish dry-run, and leave signing/tag/publication to the authorized release operator.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      npm run release:check -- --version 0.0.8
      npm run release:publish -- --version 0.0.8 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Root and every publishable `package.json`, `package-lock.json`, package `README.md`/`CHANGELOG.md`, profile manifests, release/package/install/export/docs tests, and release scripts/workflows required by Tasks 1–7.
      - `docs/index.md`, `docs/observability.md`, `docs/evaluations.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/web-tools.md`, `docs/performance.md`, persistence pages, `docs/release-and-install.md`, `docs/host-security.md`, `docs/migration.md`, and Phase 3 review coverage.
      - `examples/evaluation-gate.ts`, `examples/web-research.ts`, and any focused protocol/telemetry examples selected during execution; `examples/README.md`.
      - `roadmap.md`: mark Phase 3 complete and add only actual completion evidence after every release criterion passes.
      - `plans/070-release-0-0-8-production-telemetry-evaluations-protocols-web-research.md`: check tasks and append actual completion evidence, compromises, and further actions.
    - References:
      - Roadmap global release gate: `sdk:ready`, Node 20/current compatibility, packed-install check, dependency audit, relevant live suites, secret scan, tarball review, and `git diff --check`.
  - Test Cases to Write:
    - Full deterministic matrix: typecheck/build, default network-free tests, docs/export/package/install smoke, all workspace packs, Node 20 public imports, PostgreSQL/persistence conformance, audit, `git diff --check`, SAST/dependency/secret/SBOM/license policy.
    - Protocol/web matrix: MCP/A2A fake-server conformance and web adapter fake-server suite; all remain network-free.
    - Restricted live matrix: credential-gated Exa/Brave/Firecrawl, configured MCP/A2A endpoint, provider, PostgreSQL, and keychain smoke; publish exact skips/prerequisites if release host cannot provision one.
    - Release matrix: exact 0.0.8 workspace graph, profile membership, offline packed consumer import/example journey, tarball deny list/secret scan, registry preflight, provenance/attestation dry-run, and deterministic publish order.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; 0.0.8 package graph, public optional packages/protocols/tools, release gates, and migration guidance are released behavior.
    - Docs pages to create/edit:
      - All Task 1–7 API/security/release/performance pages listed above; retain only actual implemented behavior and concrete 0.0.8 compatibility guidance.
    - `docs/index.md` update: yes; verify each changed/new page has a functional description and link under Observability, Evaluations, Tools, MCP, A2A, Persistence, Security, Performance, and Release.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-20):
    - Versioned root plus all 30 workspaces, exact internal peer/dependency ranges, lockfile records, runtime/MCP client/server version metadata, release/package/install/version tests, and all 31 shipped changelogs to `0.0.8`. `validateRelease()` resolves one exact 31-package graph with `@arnilo/prism-web-tools` at dependency-order position 21 and `@arnilo/prism-all` last; package/profile membership and fresh packed imports passed.
    - Finalized root/package changelogs, migration overview, release/operator handoff, navigation, security policy, and benchmark documentation. Every Task 1–7 API page remains indexed and docs tests verify required headings/links, actual exports, examples, package names, current changelog date, release commands/order, unsupported protocol behavior, and vendor MCP prototype boundary. Roadmap Phase 3 is checked only with this evidence.
    - Replaced the five-envelope benchmark with eight reproducible scenarios: actual `createBatchedRunLedger` enqueue/flush, one-entry snapshot-cache lookup, actual in-memory OTel span lifecycle, plus provider/PostgreSQL-file/MCP/A2A/web bounded envelope shapes. Published the dated Node v24.18.0/Linux x64/1,000-operation table in `docs/performance.md`, including p50/p95/throughput/heap/disk/cost/backpressure and explicit non-live/provider-billing caveats.
    - `npm run sdk:ready` passed in 87 seconds: 1,814 tests (1,789 pass, 25 explicit live skips, 0 fail), full build/typecheck/examples, docs/export/package/install smoke, all workspace conformance, and 31 dry-run packs. Separate Docker Node 20.20.1 locked install/build imported all 21 core exports. Disposable `pgvector/pgvector:pg16` passed 17/17 session-store/persistence and 14/14 memory/pgvector checks; host keychain passed 27/27.
    - Supply-chain evidence passed: `npm audit --audit-level=high` found zero vulnerabilities; `npm ls --all --depth=0` was clean; npm SPDX contained 183 packages/eight approved license expressions; tracked source scan covered 2,229 files with zero findings; unpacked tarball scan covered 783 public files with zero findings; immutable-action/minimal-permission/no-`pull_request_target`/attestation policy tests passed. Local SAST is intentionally not substituted for protected GitHub CodeQL.
    - Public-registry `release:check` found all 31 `@arnilo/*@0.0.8` versions available. `release:publish --dry-run --allow-dirty --allow-untagged` completed deterministic 31/31 explicit public/latest/provenance invocations and wrote a complete dry-run report; no package was published. Final packed review measured 859,670 bytes compressed/3,283,647 unpacked/783 files; core measured 490,241 bytes compressed/1,735,130 unpacked/245 files. Unpacked-artifact scanning found zero credential patterns.
    - Restricted evidence was explicit: three web-provider live tests skipped without provider keys; `scripts/live-canary.mjs` skipped before network with gate disabled; provider/MCP/A2A endpoints and credentials were unavailable. Actual protected canaries, CodeQL/dependency review, environment approval, OIDC attestations, clean signed commit/tag, and publication remain release-host gates, not fabricated local successes. No commit, tag, attestation, or publication was created.
    - Addendum (2026-07-20, plan 071): the unpublished 0.0.8 release candidate absorbed four defect fixes without a version bump, per `plans/071-release-0-0-8-opencode-go-route-fixes-and-kimi-alignment.md`: OpenCode Go Anthropic-route provider-owned `x-api-key`/`anthropic-version` headers (fixes HTTP 401), verified-only `structuredOutput: "json_schema"` (fixes HTTP 400 on `deepseek-v4-pro`), truncated-stream terminal `error` instead of false `done` on both OpenCode Go and both Kimi routes, and `generateValidateReviseLoop` routing artifact parse failures through the revision budget. Kimi alignment corrected Coding `k3` default `reasoning_effort` to `"high"`, exact `262_144` context windows, expanded the featured Moonshot catalog (`kimi-k2.7-code-highspeed`/`kimi-k2.6`/`kimi-k2.5`), stopped routing keys leaking into wire bodies, and added Coding dual-auth headers. Root and both provider changelogs, `docs/migration.md`, and provider/agent-loop/event docs were amended; `npm run sdk:ready` re-passed with zero failures. Release-host re-verification (dry-run publish, live provider checks with real credentials) remains a P0 gate before tag authorization.

## Compromises Made

- Public provider/MCP/A2A/web timings and billing could not be measured without protected endpoints/least-privilege credentials. Published rows clearly separate actual local batching/OTel/cache work from serialization/file envelopes; protected live canaries remain mandatory before tag authorization.
- GitHub CodeQL, dependency review, branch protection, environment approval, and OIDC attestations cannot execute faithfully from a dirty local tree. Checked-in immutable workflows and network-free policy tests passed, but protected GitHub checks remain operator prerequisites.
- `@arnilo/prism-web-tools` entered only `@arnilo/prism-all`; smaller profiles remain unchanged to avoid silently adding remote research capability.
- MCP SDK 1.29.0 provides no selected event-store replay path in Prism; stateful sessions are principal-bound, but `Last-Event-ID` replay remains explicitly unsupported rather than custom implemented.
- npm publication was not attempted. Package versions are immutable, so release evidence stops at public-registry availability and 31/31 provenance dry-run until an authorized clean signed-tag workflow runs.

## Further Actions

- P0 before publication: merge through protected branch; require release verify, Node 20, PostgreSQL, CodeQL, dependency review, supply-chain, and environment approval; provision low-quota canary credentials/endpoints; run protected canaries; then create/verify/push signed `v0.0.8` exactly as `docs/release-and-install.md` specifies.
- P0 after publication: verify `SHA256SUMS`, GitHub artifact attestations, npm signatures/provenance, all 31 exact versions/latest tags/integrity records, complete-profile install/import, CLI startup, and resumable publication report before declaring public release complete.
- P1: retain dated live latency/cost results from provider, MCP, A2A, web, and PostgreSQL production-shaped hosts; update `docs/performance.md` without converting hardware/provider values into flaky CI thresholds.
- P2: remove the PostgreSQL client's concurrent-query deprecation warning before adopting `pg` 9; current pg16 integration correctness passes, but the warning identifies a future compatibility ceiling.
- P2: reconsider wider profile membership or a generic shared web/media transport only after measured adoption proves current explicit `@arnilo/prism-web-tools` installation or package-local transports insufficient.
