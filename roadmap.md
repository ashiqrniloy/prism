# Prism 0.0.5 Roadmap

Updated: 2026-07-15

## Objectives

- Release Prism 0.0.5 only after closing every confirmed security, correctness, observability, accounting, API, and release-readiness issue from the 2026-07-15 Prism/Mastra review.
- Add the smallest useful versions of the recommended agent-platform capabilities while keeping Prism a lightweight, pluggable package rather than an application framework.
- Preserve explicit host ownership of providers, credentials, storage, tools, permissions, servers, memory, and deployment.
- Keep core dependency-free at runtime on Node.js 20; library-specific integrations belong in optional packages.
- Prefer existing Prism contracts, middleware, ledgers, checkpoints, leases, provider transport, and conformance suites over new parallel abstractions.

## Expected Outcome

- Known SSRF, execution-policy, approval-scope, sandbox-output, telemetry-span, usage-accounting, media-budget, and workflow-test defects have regression tests and are fixed at their shared boundaries.
- Agent runs have a direct result API and race-free integrated event streaming without duplicating execution logic.
- Optional, independently installable capabilities cover evaluations, AI SDK models, working/semantic memory, RAG, durable human approval, web serving, MCP serving, scheduling, workflow replay, feedback, supervisor delegation, and A2A.
- `prism init` creates a small project with one explicit provider and one passing offline test; it activates no database, telemetry, credential store, or network integration by default.
- Core still has zero runtime dependencies, hidden globals, automatic package discovery, built-in privileged tools, built-in secret persistence, or framework-specific server coupling.
- All 24 existing packages and any approved new optional packages build, test, pack, and install as version 0.0.5 with consistent internal ranges.
- 0.0.5 is published only after the final release gate passes; tagged but unpublished 0.0.4 is not published.

## Product Boundaries

- **Harness, not framework:** Prism supplies contracts and orchestration primitives. Hosts assemble applications.
- **Core stays small:** no runtime dependency is added to `@arnilo/prism` unless a native Node/Web API cannot provide a correct implementation and the release review explicitly approves the dependency.
- **Optional packages stay optional:** AI SDK, MCP, PostgreSQL/vector, server, memory, eval, RAG, supervisor, and A2A code must not load or activate when absent.
- **No hidden activation:** project discovery, credentials, persistence, telemetry, memory workers, schedules, servers, and remote agents require explicit host calls.
- **No platform clone:** 0.0.5 does not add Studio/editor/cloud services, browser automation, voice providers, chat-channel adapters, deployment-provider packages, an authentication-provider matrix, vendor-specific observability exporters, or a TUI.
- **No adapter zoo:** ship one reusable seam and at most one reference production adapter per new capability. Add more only from measured demand.
- **No central god object:** new capabilities compose through existing agent/session/workflow/package APIs, not a mandatory global `Prism` application container.
- **Security is not optional:** trust-boundary validation, ownership checks, abort propagation, resource bounds, redaction, and fail-closed behavior cannot be simplified away.

## Release Order and Gates

1. Phases 0-3 are mandatory foundations and run in order.
2. Phase 4 and later run consumers depend on the Phase 3 run-result contract.
3. Phase 7 precedes Phase 9 so RAG reuses memory embedding/vector primitives.
4. Phase 8 precedes Phase 10 resume endpoints and Phase 11 scheduled/replayed workflow behavior.
5. Phase 10 depends on Phases 1-3 and must not expose unfixed security/accounting behavior over HTTP or MCP.
6. Phase 12 depends on Phase 4 evaluation linkage; Phase 13 depends on result, memory, server, permission, cancellation, and budget primitives from earlier phases.
7. Phase 14 starts only when every earlier task is checked and its focused/full checks pass.
8. Any incompatible finding discovered during implementation reopens the owning phase; it is not deferred merely to preserve the target date.

## Tasks

- [x] Phase 0 — Freeze the 0.0.5 scope and review existing primitives before implementation
  - Acceptance Criteria:
    - Functional: Every confirmed review finding and recommended feature maps to exactly one phase, package owner, public surface, test owner, and documentation owner; already-shipped Prism functionality is not planned again.
    - Performance: Baselines record current test duration, package/tarball sizes, generated-project install size, and representative stream/tool/workflow measurements before code changes.
    - Code Quality: Existing contracts, middleware, events, persistence records, checkpoints, leases, package exports, and testing helpers are inventoried; new primitives are proposed only where no reusable seam exists.
    - Security: Threat boundaries for media fetch, tools, approvals, remote serving, memory tenancy, workflow resume, supervisor delegation, and A2A are documented before implementation.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md`, `docs/public-contracts.md`, `docs/agent-session-runtime.md`, `docs/agent-loops.md`, `docs/runs-and-usage.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/release-and-install.md`.
      - `docs/review-coverage-2026-07-14.md`, Plans 053-058, and the 2026-07-15 Prism/Mastra review evidence.
      - Mastra repository commit `2745031d1d4a4978f037092da371428c32e2842a` and current Mastra docs for agents, memory, RAG, workflows, evals, observability, supervisors, A2A, server, and scheduling.
    - Options Considered:
      - Copy Mastra's integrated application architecture: broad but conflicts with Prism's host-owned package model; rejected.
      - Add only confirmed defects and defer all capabilities: safest release, but does not satisfy the agreed 0.0.5 target; rejected.
      - Reuse Prism primitives and add narrow optional packages: chosen.
    - Chosen Approach:
      - Produce a traceability matrix before changing contracts. Each new package must state which core primitives it consumes, why those primitives are insufficient, and the minimum generic addition required.
      - Keep package names below tentative until the primitive review confirms a package is necessary; adding behavior to an existing optional package is preferred.
    - API Notes and Examples:
      ```text
      review item → existing primitive → minimal gap → owning phase/package → focused test → docs → release gate
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-15.md`: 0.0.5 traceability and threat matrix.
      - `docs/performance.md`: dated pre-change baselines.
      - `roadmap.md`: execution evidence and checkbox updates only as phases complete.
      - `plans/`: no duplicate implementation plan is required unless a phase is split during execution.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - Current source hotspots: `src/contracts.ts`, `src/agents.ts`, `packages/workflows/src/run.ts`.
  - Test Cases to Write:
    - Roadmap/review matrix consistency check: every in-scope item has one owner and no unowned or ambiguously owned release-blocking row.
    - Baseline script/check: records reproducible commands and environment without introducing timing assertions into normal CI.
  - Completion Evidence (2026-07-15):
    - Frozen at `f5128a816ae204c52f3e2f089de71c99bd5de6d4`; `docs/review-coverage-2026-07-15.md` maps 14 unique findings and 12 accepted capabilities to one phase/package/surface/test/docs owner each.
    - Primitive review confirms agent loops/events, context/middleware, provider transport, tool policy, redaction, persistence, checkpoints, leases, workflow DAG/coordinator, MCP client, CLI/RPC, and seven conformance helpers are reused; permitted gaps are listed per phase.
    - Threat matrix covers media fetch, tools, approval/resume, remote HTTP/MCP, memory/RAG, workflows, eval/feedback, supervisors, and A2A.
    - Pre-change baseline: `npm test` passed 1,475 tests (1,450 pass, 25 explicit live skips, 0 fail) in 25.750 s; `npm run sdk:ready` passed in 54.341 s. Post-documentation verification also passed all tests and 24 dry-run packs (`sdk:ready` 57.764 s).
    - Seven-run warm medians: 5,000-delta run 3.78 ms; six 20 ms tools 121.05 ms at concurrency 1 and 60.65 ms at 2; 1,000-node workflow 9.66 ms.
    - Package baseline: 542,993 packed / 2,084,900 unpacked aggregate bytes; root 346.0 kB / 1.3 MB; workspace `node_modules` 72 MiB. Prism has no generator before Phase 5, so generated-project size is recorded as not applicable; Mastra comparator remains 439 MB install / 300 MB build.
    - Pre-freeze workflow coordinator test correction at `f5128a8` passed five consecutive focused runs and the full suite; removed from Phase 2 instead of planning duplicate work.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this phase freezes scope and evidence.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-15.md`: scope, primitive inventory, threat model, and ownership.
      - `docs/performance.md`: baseline measurements.
    - `docs/index.md` update: yes; add the 0.0.5 review-coverage entry under Release and install.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 1 — Close release-blocking security defects
  - Acceptance Criteria:
    - Functional: Media URL validation rejects IPv4 and IPv6 loopback, private, link-local, unique-local, unspecified, multicast, and IPv4-mapped private literals; configured public/allowed hosts still work.
    - Functional: `createReadOnlyTools()` applies the shared `executionPolicy` exactly as `createCodingTools()` does.
    - Functional: approval caching defaults to `none`; explicit `run` and `session` scopes include real run/session identity and never reuse a decision outside that scope.
    - Performance: SSRF checks and approval keying remain bounded; DNS/network validation does not add unbounded lookups, redirects, retries, or response buffering.
    - Code Quality: URL classification is centralized, uses Node standard-library parsing where possible, and all tool aggregators share one option-merging helper.
    - Security: DNS resolution/rebinding behavior is explicit and tested; no approval, denial, path, command, hostname, or credential value leaks across tenants, sessions, or runs.
  - Approach:
    - Documentation Reviewed:
      - `docs/multimodal-content.md`, `docs/host-security.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`.
      - `src/content.ts`, `packages/coding-agent/src/index.ts`, `packages/coding-security/src/approval.ts` and all callers.
      - Node.js `node:net`, `node:dns`, `node:http`, `node:https`, URL, AbortSignal, and Web Fetch APIs for the supported Node 20 runtime.
    - Options Considered:
      - Strip IPv6 brackets only: fixes demonstrated literals but leaves DNS/private-resolution bypasses; insufficient.
      - DNS preflight followed by ordinary `fetch`: small but vulnerable to time-of-check/time-of-use rebinding; insufficient for a deny-by-default claim.
      - Resolve, classify, and pin the selected public address in a bounded Node requester while retaining injected `fetch`/loader seams for hosts: chosen, subject to primitive review.
      - Keep approval cache global and document it: unsafe; rejected.
    - Chosen Approach:
      - Normalize URL hostnames before IP classification, use `net.isIP()`, cover IPv4-mapped IPv6, preserve redirect rejection, and make default remote-media fetching connect only to a classified public address. Host allow-lists remain the simplest trusted path.
      - Route both coding-tool aggregators through `withSharedExecutionPolicy`.
      - Resolve cache scope as `options.approvalCacheScope ?? "none"`; add run/session IDs to execution metadata and the selected scope key. Remove a scope mode rather than pretending it is isolated if identity cannot be passed safely.
    - API Notes and Examples:
      ```ts
      createReadOnlyTools(cwd, { executionPolicy });

      createCodingApprovalPolicy({
        approve,
        approvalCacheScope: "run",
      }); // key includes executionContext.runId
      ```
    - Files to Create/Edit:
      - `src/content.ts`, `src/index.ts`: normalized IP classification, DNS resolver/pinned requester seams, secure bounded default transport, and public types.
      - `packages/coding-agent/src/index.ts`: shared policy propagation.
      - `packages/coding-agent/src/read.ts`, `shell.ts`, `write.ts`, `edit.ts`: pass existing run/session identity in execution metadata.
      - `packages/coding-security/src/approval.ts`: correct default, timeout, and scoped keys.
      - `src/__tests__/content.test.ts`, `src/__tests__/public-export-contract.test.ts`, `packages/coding-agent/src/__tests__/aggregators.test.ts`, `packages/coding-security/src/__tests__/approval.test.ts`.
      - `docs/multimodal-content.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/index.md`, and both affected package READMEs.
    - References:
      - Confirmed reproductions: bracketed `::1`, `fe80::1`, `fc00::1`, `::ffff:127.0.0.1`; read-only policy check count `0`; two default-scope approvals invoking the callback once.
  - Test Cases to Write:
    - Literal matrix: blocked IPv4/IPv6 ranges, mixed-case/encoded hosts, IPv4-mapped IPv6, explicit allowed hostname, and public IP.
    - DNS matrix with injected resolver/requester: private-only, mixed public/private, rebinding attempt, timeout, abort, lookup failure, and public pinned connection.
    - Read-only aggregator denial: denied read never reaches filesystem operations.
    - Approval scope matrix: default prompts every time; run cache reuses only within run; session cache reuses only within session; parallel identical requests do not accidentally cross scope.
  - Completion Evidence (2026-07-15):
    - `assertSsrfAllowedUrl()` now normalizes bracketed/trailing-dot hosts through WHATWG `URL`, classifies IPv4/IPv6 with `node:net`, and blocks loopback, private/shared, link/site-local, unique-local, unspecified, multicast/reserved, documentation, and IPv4-mapped private literals by default.
    - Default media loading uses bounded `dns.lookup(..., { all: true, verbatim: true })`, rejects private-only and mixed public/private answers, then disables socket pooling and pins one validated address through native `http.request()`/`https.request()` lookup while retaining original Host/TLS identity. Redirects, lookup/connection/body timeout, abort, and byte bounds remain enforced.
    - Exported `MediaHostnameResolver`/`MediaUrlRequester` seams make DNS/private/mixed/pinned cases deterministic. Existing custom `fetch` remains a documented trusted compatibility seam whose host owns DNS/rebinding/proxy policy; explicit host allow-lists remain intentional trust overrides.
    - `createReadOnlyTools()` now uses the same shared-policy merge as full/all aggregators; denial regression proves no filesystem operation occurs. All four coding tools pass `sessionId`/`runId` from `ToolExecutionContext` into execution metadata.
    - Approval cache resolves `approvalCacheScope ?? "none"`; `run` and `session` keys require their matching identity, missing identity disables caching, different identities never share decisions, fixed-size SHA-256 keys retain no raw action text, caches evict oldest entries above 1,000 decisions, and approval waits honor the documented 30-second default timeout.
    - Focused SSRF/coding-agent/coding-security suites passed. Final `npm test`: 1,479 tests, 1,454 pass, 25 explicit live skips, 0 fail in 26.544 s. Final `npm run sdk:ready`: pass in 56.691 s with all 24 dry-run packs. `npm audit --audit-level=high --omit=dev`: 0 vulnerabilities.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; SSRF behavior, tool option propagation, execution metadata, and approval defaults change.
    - Docs pages to create/edit:
      - `docs/multimodal-content.md`: exact literal/DNS/allow-list guarantees and host-injected fetch responsibility.
      - `docs/coding-agent-tools.md`: aggregator policy propagation.
      - `docs/coding-security.md`: default and run/session cache semantics.
      - `docs/host-security.md`: network and approval threat model.
    - `docs/index.md` update: no new page; update existing entry descriptions only if behavior summaries change materially.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 2 — Fix runtime output, telemetry, usage, and media correctness
  - Acceptance Criteria:
    - Functional: sandboxed shell stdout/stderr reaches the shell tool's normal output path in order and remains abort-aware.
    - Functional: successful, failed, and aborted agent/provider/tool spans end exactly once; detaching instrumentation closes attributable outstanding spans.
    - Functional: every provider turn has attributable usage and the run result contains the aggregate of all turns; persisted and metric records distinguish provider-turn values from run totals so summing cannot double bill.
    - Functional: item count, total bytes, per-item bytes, MIME, audio-duration, and model-capability checks run once over the complete media request before upload/provider I/O.
    - Performance: streaming remains streaming; output/media fixes do not materialize unbounded data, telemetry maps release terminal entries, and aggregate usage is O(number of turns).
    - Code Quality: one usage accumulator and one media-request validation path replace per-caller patches.
    - Security: sandbox output is redacted/sanitized at existing boundaries; media validation occurs before side effects; telemetry and usage metadata contain no prompt, tool result, or secret payloads.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/multimodal-content.md`.
      - `packages/coding-security/src/sandbox.ts`, `packages/observability-opentelemetry/src/instrumentation.ts`, `src/agents.ts`, `src/content.ts`, and provider media serializers.
      - OpenTelemetry JS current tracing/metrics docs and source retrieved from Context7 `/open-telemetry/opentelemetry-js` on 2026-07-15: spans export on `end()`, `recordException()` does not set error status, and counters use `add(value, attributes)`.
    - Options Considered:
      - Return buffered stdout/stderr from sandbox execution: easy but loses progressive output and increases memory; rejected.
      - Add `onData` to `SandboxExecRequest` and forward the existing shell callback: chosen.
      - Keep duplicate usage rows and document query filters: retains a billing trap; rejected.
      - Validate media in every serializer: duplicates policy and still risks partial side effects; rejected.
    - Chosen Approach:
      - Extend the sandbox request with the existing output callback shape.
      - Treat `error` and abort as terminal agent-span signals; retain provider/tool-specific terminal handling and close remaining session-owned spans on detach.
      - Add an internal usage accumulator. Persist records with explicit scope/turn/attempt fields; keep `prism.provider.tokens` for provider-turn tokens and use a distinct run-total metric if needed.
      - Resolve all media blocks first within bounded per-item reads, validate the complete collection, then serialize/upload.
    - API Notes and Examples:
      ```ts
      interface SandboxExecRequest {
        command: string;
        onData?: (chunk: string, stream: "stdout" | "stderr") => void;
      }

      interface UsageRecord {
        scope: "provider_turn" | "run_total";
        turn?: number;
        attempt?: number;
      }
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox.ts`, its README, docs, and approval/sandbox tests.
      - `packages/observability-opentelemetry/src/instrumentation.ts`, README, tests, and observability docs.
      - `src/agents.ts`, `src/contracts.ts`, run-ledger tests/conformance, and usage/event/loop/public-contract docs.
      - `src/testing/persistence-schema.ts`; SQLite/PostgreSQL DDL, migration, mapper, persistence, and adapter tests; database/migration docs.
      - `src/content.ts`, `src/providers/media.ts`, `src/index.ts`, OpenAI/Kimi/OpenCode Go serializers, and core/provider media tests.
      - `docs/performance.md`, `docs/index.md`, and `docs/review-coverage-2026-07-15.md`.
    - References:
      - Runtime evidence: sandbox chunks remained empty; failed `prism.agent.run` span had `ended: false`; one-turn usage created duplicate rows; multi-turn final usage reported only the last turn.
  - Test Cases to Write:
    - Sandboxed shell emits interleaved stdout/stderr, aborts, and respects output bounds.
    - Failed and aborted runs leave zero active spans and every in-memory span ends once.
    - Two-turn tool run persists two provider-turn records and one aggregate record with total 33; billing query/metric path counts one scope only.
    - Four individually valid media blocks exceeding the request total fail before any provider fetch/upload; 33 items fail before serialization.
  - Completion Evidence (2026-07-15):
    - `SandboxExecRequest.onData` now forwards each adapter chunk directly into coding-agent's existing combined, bounded `OutputAccumulator`; signal/timeout forwarding and wrapped adapter errors remain intact. Regression covers ordered stdout/stderr and abort-signal identity.
    - OpenTelemetry active entries carry session/run ownership, tool keys include run IDs, all terminal/error/detach paths delete before ending, duplicate terminal events are idempotent, and failed/aborted integration runs leave zero active spans. OpenTelemetry status handling follows current JS API semantics.
    - `prism.provider.tokens` now records provider-turn values only; aggregate values use distinct `prism.run.tokens`. Both retain low-cardinality labels and omit unreported token kinds instead of recording synthetic zeroes.
    - One O(turns) runtime accumulator records each usage-bearing provider attempt once, emits/persists the aggregate, and reports multi-turn total 33 for 11 + 22. `UsageRecord`/`UsageQuery` expose `scope`, `turn`, and `attempt`; billing filters `provider_turn`, summaries read `run_total`.
    - Persistence schema version 2 adds additive `002_usage_scope` for SQLite/PostgreSQL plus `(session_id, scope, recorded_at)` indexing. Shared conformance preserves scope/turn/attempt; SQLite regression proves query scopes cannot mix source and aggregate rows; PostgreSQL DDL/schema tests pass offline.
    - `resolveMediaContentBlocks()` and `resolveProviderMediaMessages()` provide one complete-request path: model/item/count/inline checks precede resolution, exact decoded totals follow bounded sequential reads, and OpenAI/Kimi/OpenCode Go resolve all media before serialization/upload. Tests reject 33 items before DNS/upload/provider fetch and reject four-item aggregate overflow before caller-side provider work.
    - Final `npm test`: 1,485 tests, 1,460 pass, 25 explicit live skips, 0 fail in 27.992 s. Final `npm run sdk:ready`: pass in 55.598 s with all 24 dry-run packs. `npm audit --audit-level=high --omit=dev`: 0 vulnerabilities; `npm ls --all`: clean.
    - Seven-run medians remain within baseline: 5,000 deltas 3.54 ms; six 20 ms tools 121.22 ms at concurrency 1 and 60.63 ms at 2; 1,000-node workflow 10.31 ms. Root pack is 361.2 kB / 1.3 MB, 197 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; sandbox adapter, usage records/metrics, media request enforcement, and terminal telemetry change.
    - Docs pages to create/edit:
      - `docs/coding-security.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/multimodal-content.md`, `docs/performance.md`.
      - Persistence docs/migration pages if usage schema changes.
    - `docs/index.md` update: no new page; update usage/observability descriptions if new scope fields are public.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 3 — Simplify the public agent API and remove inert/fragile surfaces
  - Acceptance Criteria:
    - Functional: `session.run(input)` returns an `AgentRunResult` containing run/session IDs, status, final assistant content/text, aggregate usage, and terminal metadata; callers ignoring the return remain valid.
    - Functional: `session.stream(input)` subscribes before execution, starts exactly one run, yields its correlated events, and terminates on success/failure/abort without a subscription race.
    - Functional: runtime-inert `AgentConfig.extensions`, `settings`, and `credentials` are removed or moved to an explicit host composition type; no field remains documented as agent behavior when runtime ignores it.
    - Performance: direct runs do not buffer the full event stream; streaming uses existing bounded subscriber queues and adds no second provider/tool execution.
    - Code Quality: `run`, `prompt`, CLI, RPC, workflows, evals, and server paths share one execution implementation; touched source-text tests become behavior/type/export tests; hotspots split only along proven domains required by this change.
    - Security: returned results and stream events pass existing redaction; stream cancellation aborts only the owned run and cleans subscriptions.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/cli-rpc.md`, `docs/workflows.md`, `docs/customization.md`.
      - `src/contracts.ts`, `src/agents.ts`, `src/agent-loops.ts`, CLI/RPC callers, workflow agent nodes, and all `session.run` callers.
      - Mastra `Agent.generate()`/`stream()` behavior for ergonomic comparison only; Prism retains its own event/result contracts.
    - Options Considered:
      - Add separate `generate`, `run`, `prompt`, and `stream` engines: duplicate behavior; rejected.
      - Change `run()` to return a result and add one integrated `stream()` wrapper over the same engine: chosen.
      - Keep inert fields for compatibility: misleading at 0.0.x; rejected unless a real runtime owner is identified during caller audit.
    - Chosen Approach:
      - Extract the minimum internal execution primitive returning `AgentRunResult`; existing `run` and `prompt` delegate to it. `stream` creates the bounded subscription first and filters by owned run ID.
      - Keep extension/settings/credential composition outside `AgentConfig`; provide a tiny explicit host helper only if removing fields otherwise forces repeated wiring in real callers.
      - Replace implementation-string assertions encountered in changed files. Do not perform a speculative whole-repo class/file split.
    - API Notes and Examples:
      ```ts
      const result = await session.run("Summarize this");
      console.log(result.text, result.usage.totalTokens);

      for await (const event of session.stream("Summarize this")) {
        render(event);
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: `AgentRunResult` and stream signature.
      - `src/agents.ts`, `src/agent-loops.ts`: shared execution/result assembly.
      - `src/cli-runner.ts`, RPC, workflows, examples, and tests using current run semantics.
      - `src/__tests__/*`: remove touched source-text assertions.
      - `plans/README.md` or an archive index only if completed-plan discoverability needs improvement; do not rewrite historical plans.
    - References:
      - Current `AgentSession.run(): Promise<void>` and explicit tests proving `extensions/settings/credentials` are inert.
  - Test Cases to Write:
    - Single-turn, tool-turn, structured-output, failed, and aborted run result shapes.
    - Stream starts without an external subscriber race, yields only owned-run events, and cleans up after early consumer return.
    - CLI/RPC/workflow behavior remains unchanged except for consuming the returned result.
    - Compile fixture documents migration from inert AgentConfig fields to explicit host wiring.
  - Completion Evidence (2026-07-15):
    - `session.run()` / `session.prompt()` now return `AgentRunResult` (`sessionId`, `runId`, `status`, `text`, `content`, optional `message`/`usage`/`leafId`/`error`/`abortReason`). Callers ignoring the return remain valid.
    - Failed and aborted runs reject with `AgentRunError` whose `.result` carries the terminal shape; success still resolves normally.
    - `session.stream()` subscribes first, starts exactly one run, filters by owned `runId`, terminates with the run, and aborts/releases the session on early consumer return.
    - Removed inert `AgentConfig.extensions` / `settings` / `credentials`. Hosts wire extensions via `createExtensionKernel()`, settings in-process, and credentials at the provider edge. Compile fixture `agent-config.types.test.ts` documents the migration.
    - Workflows consume `AgentRunResult` for default agent-node output; CLI/RPC keep event-pump behavior unchanged.
    - Docs/README/index/migration/review-coverage updated for the new result/stream surface and field removal.
    - Final `npm test`: 1,490 tests, 1,465 pass, 25 explicit live skips, 0 fail. Final `npm run sdk:ready`: pass with all 24 dry-run packs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; core session return/stream APIs and AgentConfig change.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/customization.md`, `docs/cli-rpc.md`, `docs/workflows.md`, `docs/migration.md`.
      - Relevant examples and README quick start.
    - `docs/index.md` update: yes; update the Agent/session runtime entry to advertise direct results and integrated streaming.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 4 — Add optional evaluations, scorers, datasets, and batch experiments
  - Acceptance Criteria:
    - Functional: an optional eval package runs deterministic scorers against `AgentRunResult`, stores scores from 0-1 with reason/metadata, supports explicit sampling, and links every evaluation to run/session/trace IDs.
    - Functional: a minimal dataset is a typed, immutable collection of input/expected-value items; a batch runner executes a pinned dataset snapshot and returns per-item plus aggregate results.
    - Functional: live post-run scoring can run asynchronously without changing the agent result; scoring failure is attributable and does not corrupt the run.
    - Performance: concurrency and sample rate are bounded; scorer input can reference persisted traces/results without duplicating unbounded event payloads.
    - Code Quality: function scorers are the base primitive; no mandatory LLM judge, dashboard, experiment service, or schema library is introduced.
    - Security: scorer/dataset persistence is tenant-scoped and redacted; untrusted scorer code receives no credentials, tools, or workspace access unless the host explicitly supplies them.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/runs-and-usage.md`, `docs/observability.md`, persistence contracts and conformance docs.
      - Mastra scorer, live evaluation, datasets, and experiments docs/source for capability comparison.
    - Options Considered:
      - Put scorers in core agent execution: couples quality policy to every run; rejected.
      - Optional package subscribing to results/events and using a small persistence contract: chosen.
      - Recreate Mastra's visual dataset/versioning platform: out of scope.
    - Chosen Approach:
      - Create a narrow optional package, tentatively `@arnilo/prism-evals`, with `Scorer`, `EvaluationRecord`, `DatasetItem`, and bounded `runExperiment` APIs.
      - Add only the generic ledger/query extension required to persist evaluation records; in-memory operation must work without a database.
    - API Notes and Examples:
      ```ts
      const scorer = defineScorer({
        id: "contains-citation",
        score: ({ result }) => ({ score: result.text.includes("[") ? 1 : 0 }),
      });

      const report = await runExperiment({ agent, dataset, scorers: [scorer], concurrency: 2 });
      ```
    - Files to Create/Edit:
      - `packages/evals/` (tentative): contracts, runner, package metadata, README, tests.
      - Core/persistence record contracts only where evaluation linkage cannot remain package-local.
      - SQLite/PostgreSQL adapters and migrations only if durable score queries are approved.
      - `examples/evals.ts`.
    - References:
      - Existing `RunLedger`, `ProductionPersistenceStore`, `AgentRunResult`, run IDs, trace IDs, and event metadata.
  - Test Cases to Write:
    - Deterministic function scorer success/failure; score bounds validation; sampled skip; scorer abort/timeout.
    - Batch concurrency cap, stable item/result ordering, aggregate calculation, and immutable dataset snapshot.
    - Tenant/run ownership rejection and canary-secret redaction.
    - Packed install works without database or model credentials.
  - Completion Evidence (2026-07-15):
    - Added optional `@arnilo/prism-evals` with `defineScorer`, `defineDataset`, `scoreRun` / `scoreRunLive`, `runExperiment`, and `createMemoryEvaluationStore`.
    - Scores are finite `[0, 1]` with reason/metadata; sampleRate is explicit; failed scorers become attributable `failed` records without mutating `AgentRunResult`.
    - Experiments bound concurrency (default 1, cap 32), preserve dataset item order, and aggregate mean scores per scorer.
    - Evaluation records are ownership-scoped and redacted before persistence; in-memory store works without a database. Package stays out of profile bundles pending size/use review.
    - Docs: `docs/evaluations.md`, index/release/observability/migration updates, `examples/evals.ts`. Publishable graph is now 25 packages (evals stays out of profile bundles pending size/use review).
    - Final `npm test` / `npm run sdk:ready`: 1,503 tests, 1,478 pass, 25 explicit live skips, 0 fail; all 25 dry-run packs successful.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package and possible persistence records.
    - Docs pages to create/edit:
      - `docs/evaluations.md`: scorers, sampling, datasets, experiments, persistence, security, and examples.
      - `docs/observability.md` and persistence docs for score linkage.
    - `docs/index.md` update: yes; add an Evaluations and quality section or entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 5 — Add a minimal `prism init` project scaffold
  - Acceptance Criteria:
    - Functional: `prism init <dir>` creates a TypeScript project with one selected provider, one agent, environment example, one passing offline mock test, build/typecheck/test scripts, and concise README.
    - Functional: flags select provider and optional workflows/evals; rerunning refuses to overwrite files unless an explicit force flag is supplied.
    - Performance: default generated install/build remains small and is measured against the Mastra baseline; no storage, telemetry, eval, memory, server, or workflow dependency is installed unless selected.
    - Code Quality: implementation uses Node standard-library filesystem/path APIs and checked-in tiny templates; no interactive-prompt or template-engine dependency is added.
    - Security: generated `.gitignore` excludes credentials and local stores; `.env.example` contains placeholders only; no command executes downloaded code beyond the user's normal package install.
  - Approach:
    - Documentation Reviewed:
      - `README.md`, `docs/release-and-install.md`, provider package docs, current compile-checked examples, root CLI implementation.
      - Mastra `create-mastra` options and generated weather project for onboarding comparison.
    - Options Considered:
      - Publish a separate scaffold CLI immediately: another package/release surface; rejected unless root CLI cannot support the command cleanly.
      - Add `prism init` to existing CLI with deterministic flags: chosen.
      - Add interactive prompts: extra dependency and harder testing; defer.
    - Chosen Approach:
      - Copy the smallest existing real-provider and mock-test examples into a target directory with token replacement. Keep generated provider wiring explicit and package-specific.
    - API Notes and Examples:
      ```bash
      npx prism init my-agent --provider openai
      npx prism init my-agent --provider openrouter --with-workflows
      cd my-agent && npm install && npm test
      ```
    - Files to Create/Edit:
      - Existing CLI command parser/runner files.
      - `templates/init/` or equivalent minimal checked-in templates.
      - CLI tests and packed-install smoke tests.
      - README quick-start instructions.
    - References:
      - Existing `examples/`, package exports, provider docs, and root bin.
  - Test Cases to Write:
    - Generate into empty temp dir, install from packed tarballs, typecheck, test, and import.
    - Provider flag matrix; optional feature dependency matrix; unknown flag/provider errors.
    - Existing/non-empty destination refusal, force behavior, path traversal, and placeholder secret scan.
    - Size report for default generated project.
  - Completion Evidence (2026-07-15):
    - Added `prism init <dir>` to the existing CLI (`src/cli-init.ts`) with `--provider`, `--with-workflows`, `--with-evals`, and `--force`.
    - Checked-in templates under `templates/init/` (plus `providers.json` catalog) ship in the core tarball; generation uses Node stdlib path/fs APIs and token replacement only — no interactive prompts or template engine.
    - Default project depends on `@arnilo/prism` only (mock provider + offline mock test). Real providers add exactly one `@arnilo/prism-provider-*` package; workflows/evals are opt-in; storage/telemetry stay absent unless selected later.
    - Measured default sources ~3.3 KB / 8 files; clean consumer install ~27.5 MB vs Mastra 439 MB. `.env.example` placeholders only; `.gitignore` excludes credentials/local stores.
    - Docs/README/index/release/performance/review-coverage/migration updated for the init contract.
    - Final `npm test` / `npm run sdk:ready`: 1,512 tests, 1,487 pass, 25 explicit live skips, 0 fail; all 25 dry-run packs successful. Core tarball 372.8 kB packed / 1.4 MB unpacked / 211 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; CLI gains an init command and generated-project contract.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: init command and flags.
      - `docs/release-and-install.md`: generated-project install flow and size expectations.
      - `README.md`: real-provider quick start with passing test.
    - `docs/index.md` update: yes; update CLI and Release/install entry descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 6 — Add optional AI SDK model interoperability
  - Acceptance Criteria:
    - Functional: an optional adapter accepts a supported AI SDK `LanguageModel` and maps text, reasoning, tool-call input deltas/final calls, finish reason, usage, provider metadata, structured-output options, errors, and abort signals to Prism provider events.
    - Functional: Prism message/tool definitions map to AI SDK call options without silently dropping supported content; unsupported content fails before model invocation.
    - Performance: stream parts are translated incrementally using existing Prism bounds; no full-response buffering or duplicate model call occurs.
    - Code Quality: support is isolated in one optional package with one documented AI SDK specification-major compatibility range; first-party provider packages remain independent.
    - Security: provider metadata and errors pass redaction, host credentials remain owned by the supplied AI SDK model, and adapter options cannot override Prism abort/resource limits silently.
  - Approach:
    - Documentation Reviewed:
      - Current AI SDK documentation from Context7 library `/websites/ai-sdk_dev`, especially custom `LanguageModelV4`, `doStream`, stream lifecycle/tool/usage parts, structured responses, and abort behavior.
      - AI SDK v5 migration material showing stream-part lifecycle changes; implementation must follow the installed/supported specification, not stale V3 examples.
      - Prism provider conformance, provider primitives, structured output, multimodal, and provider event docs.
    - Options Considered:
      - Add many first-party model providers: high maintenance; rejected.
      - Depend on high-level `streamText`: simpler but may duplicate agent/tool-loop behavior; rejected.
      - Adapt the lower-level AI SDK language-model interface to `AIProvider`: chosen.
    - Chosen Approach:
      - Create `@arnilo/prism-provider-ai-sdk` (tentative) with `createAiSdkProvider({ model })`. Use `@ai-sdk/provider` as an optional package peer/dev dependency pinned to supported specification major; core receives no dependency.
      - Reuse Prism's provider conformance and fake AI SDK models; no live provider test is required by default.
    - API Notes and Examples:
      ```ts
      import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";

      const provider = createAiSdkProvider({ model: hostCreatedAiSdkModel });
      const agent = createAgent({ provider, model: { provider: provider.id, model: "host-model" } });
      ```
    - Files to Create/Edit:
      - `packages/provider-ai-sdk/` (tentative): adapter, serializers, tests, README, manifest.
      - Provider conformance tests only if a generic assertion is missing.
      - Bundle packages only after explicit size/dependency review; do not add to lightweight profiles automatically.
    - References:
      - AI SDK current `LanguageModelV4` custom-provider docs retrieved 2026-07-15.
      - `docs/provider-conformance.md`, `src/testing/provider-conformance.ts`.
  - Test Cases to Write:
    - Fake stream covering text/reasoning start-delta-end, fragmented tool input, finish, usage, metadata, warning, error, and abort.
    - Structured-output request mapping and unsupported schema/content rejection.
    - Multi-turn Prism tool replay through the adapter.
    - Packed optional install with supported AI SDK peer; core install remains unchanged.
  - Completion Evidence (2026-07-15):
    - Added optional `@arnilo/prism-provider-ai-sdk` with `createAiSdkProvider({ model })` adapting AI SDK `LanguageModelV4` (`@ai-sdk/provider@^4`) to Prism `AIProvider` streams.
    - Maps Prism messages/tools/structured-output/parameters/headers/abort into `doStream` call options; unsupported content fails closed before model invocation.
    - Translates text/reasoning/tool-input deltas, final tool calls, usage, finish, abort, and model errors incrementally with no full-response buffering and no duplicate model call.
    - Host credentials remain inside the supplied AI SDK model; Prism `request.signal` always owns abort/resource limits; provider metadata/warnings are not emitted as content.
    - Package stays out of `@arnilo/prism-providers` and profile bundles pending size/use review. Publishable graph is now 26 packages.
    - Docs/example/migration/index/release/review-coverage/performance updated; focused adapter suite covers fake stream, structured-output mapping, unsupported content, multi-turn tool replay, abort/error, and non-v4 rejection.
    - Final `npm run sdk:ready`: 1,522 tests, 1,497 pass, 25 explicit live skips, 0 fail; all 26 dry-run packs successful. `@arnilo/prism-provider-ai-sdk` dry-run tarball 6.5 kB packed / 22.5 kB unpacked / 16 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new provider package and compatibility contract.
    - Docs pages to create/edit:
      - `docs/providers/ai-sdk.md`: supported specification, mapping, limitations, examples, security, and migration policy.
      - `docs/provider-packages.md` and `docs/provider-conformance.md`.
    - `docs/index.md` update: yes; add AI SDK adapter under Provider and model connection.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 7 — Add optional working memory and semantic recall primitives
  - Acceptance Criteria:
    - Functional: hosts can persist schema/template-backed working memory per tenant/resource/thread and update it explicitly or through an opt-in processor.
    - Functional: semantic recall embeds a query, performs tenant-scoped top-K search, optionally includes adjacent session entries, and injects selected memories through existing context/input seams.
    - Functional: in-memory reference adapters and one PostgreSQL/pgvector production path pass shared conformance; no vector backend is required for ordinary Prism sessions.
    - Performance: top-K, candidate count, adjacent range, embedding batch size, payload bytes, and injected tokens are bounded; indexing may run asynchronously without blocking agent completion by default.
    - Code Quality: `Embedder` and `VectorStore` are narrow package-owned contracts reused by RAG; no generic database framework or provider-specific core behavior is added.
    - Security: tenant/resource scope is mandatory on every write/query/delete; memory text/metadata is redacted and cannot cross threads or delegated-agent resource IDs.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores.md`, database persistence docs, context/input docs, observational-memory docs, middleware docs.
      - Mastra working memory, semantic recall, memory processors, and resource/thread isolation docs/source.
    - Options Considered:
      - Add semantic search to `SessionStore`: overloads a history contract and every adapter; rejected.
      - Optional memory package with narrow embed/vector contracts and middleware/context contributions: chosen.
      - Ship many vector adapters: rejected; one in-memory and one PostgreSQL reference are enough for 0.0.5.
    - Chosen Approach:
      - Create a tentative `@arnilo/prism-memory` package. Reuse Standard JSON Schema-compatible validation hooks for working-memory shape without requiring Zod.
      - Keep existing observational memory unchanged: it compresses and recalls source-backed observations; semantic memory retrieves embeddings and working memory stores current structured profile/state.
    - API Notes and Examples:
      ```ts
      const memory = createMemory({ store, embedder, tenantId, resourceId, threadId });
      await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
      const recalled = await memory.recall("preferred response format", { topK: 5, messageRange: 1 });
      ```
    - Files to Create/Edit:
      - `packages/memory/` (tentative): contracts, in-memory adapters, processors/context provider, conformance, tests, README.
      - PostgreSQL adapter/migration in the package or existing PostgreSQL package after dependency review.
      - Examples for working and semantic memory.
    - References:
      - Existing `ContextProvider`, middleware, `SessionEntry`, resource/branch ownership, and optional PostgreSQL pool primitives.
  - Test Cases to Write:
    - Working-memory schema validation, merge/replace semantics, concurrent update conflict, and thread isolation.
    - Semantic top-K ordering, adjacent range, empty result, embedding failure, abort, limits, and deterministic in-memory conformance.
    - Cross-tenant query/write/delete denial and canary-secret redaction.
    - PostgreSQL live suite behind explicit environment variable; default suite remains network-free.
  - Completion Evidence (2026-07-15):
    - Added optional `@arnilo/prism-memory` with `createMemory`, package-owned `Embedder`/`VectorStore`/`WorkingMemoryStore`, hash embedder, in-memory adapters, context provider, opt-in working-memory processor, and `runMemoryConformance`.
    - Working memory supports schema/host validation, merge/replace, version conflicts, templates, and mandatory tenant/resource scope (thread optional for resource-level state).
    - Semantic recall embeds queries, returns tenant/thread-scoped top-K hits with optional adjacent range, redacts secrets, and injects inert context through existing `ContextProvider` seams.
    - Default `remember()` indexes asynchronously; limits bound top-K, messageRange, embed batch, payload bytes, injected tokens, and dimensions.
    - PostgreSQL/pgvector adapter ships in-package (`createPostgresMemoryStores`); live suite is env-gated and included in root `test:postgres`; CI uses `pgvector/pgvector:pg16`.
    - Observational memory remains unchanged; package stays out of profile bundles pending size/use review. Publishable graph is now 27 packages.
    - Docs/example/migration/index/release/review-coverage/performance updated; focused suite covers schema, isolation, top-K/adjacent, redaction, abort, context injection, processor, and offline factory validation.
    - Final `npm run sdk:ready`: 1,538 tests, 1,513 pass, 25 explicit live skips, 0 fail; all 27 dry-run packs successful. `@arnilo/prism-memory` dry-run tarball 17.9 kB packed / 76.6 kB unpacked / 32 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional memory package, contracts, and persistence behavior.
    - Docs pages to create/edit:
      - `docs/working-and-semantic-memory.md`: complete API page.
      - `docs/compaction-observational-memory.md`: distinction and composition guidance.
      - PostgreSQL and context/input docs for adapter/injection behavior.
    - `docs/index.md` update: yes; add working/semantic memory under Compaction/session memory.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 8 — Add durable human-in-the-loop suspend and resume
  - Acceptance Criteria:
    - Functional: workflows and opted-in tool approvals can persist a `suspended` state with typed/validated suspend data, later resume with validated input, and continue exactly once from the durable checkpoint.
    - Functional: restart/reconnect can list and resume suspended runs; denial/cancellation is a terminal attributable outcome.
    - Performance: suspension consumes no worker slot or polling loop; resume uses existing checkpoint/lease/fencing primitives and remains bounded under contention.
    - Code Quality: suspend/resume extends the current workflow state machine and checkpoint schema; it does not introduce a second durable-run engine.
    - Security: resume requires run ownership/authorization, respects fencing tokens and idempotency, redacts payloads, and re-evaluates permissions instead of trusting stale in-memory approval state.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, checkpoint/lease/public contract docs, coding approval docs.
      - Mastra workflow/tool suspend, resume schema, durable storage, and approval behavior for comparison.
    - Options Considered:
      - Keep callback-only approvals: cannot survive process exit; rejected.
      - Model suspension as an ordinary failure and restart the workflow: loses exact continuation; rejected.
      - Add a first-class suspended checkpoint state and resume command: chosen.
    - Chosen Approach:
      - Extend workflow node/result status and versioned checkpoint data with suspend descriptor and resume cursor. Validate payloads through existing optional validator hooks/JSON Schema package.
      - Bridge durable tool approval through workflow suspension; ordinary non-durable agent callbacks remain supported.
    - API Notes and Examples:
      ```ts
      return suspend({ reason: "publish", data: { artifactId }, resumeSchema });

      await workflow.resume(runId, { approved: true }, { ownerId, expectedVersion });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/types.ts`, `run.ts`, checkpoint serialization, commands, coordinator, tests.
      - SQLite/PostgreSQL checkpoint migrations only if schema storage needs additive columns.
      - `packages/coding-security` bridge types/helpers if durable approval is exposed there.
    - References:
      - Existing `CheckpointStore`, `LeaseStore`, fencing tokens, `workflow.resume`, cancel records, and execution policies.
  - Test Cases to Write:
    - Suspend, process restart, authorized resume, exact-once continuation, second-resume conflict, denial, cancel, and abort.
    - Invalid suspend/resume payload; stale fencing token; wrong owner/tenant; redaction.
    - SQLite/PostgreSQL multi-process race; local in-memory parity.
    - Tool approval suspends before side effect and rechecks policy on resume.
  - Completion Evidence (2026-07-15):
    - Extended existing workflow state/checkpoint JSON with `suspended` and terminal `denied`, persisted `WorkflowSuspensionDescriptor`/`WorkflowResumeRecord`, `workflow_suspended`/`workflow_resumed` events, and exported typed `suspend()`.
    - `resumeWorkflow()` requires reviewer-visible `expectedVersion`, validates ownership/definition/schema and optional resume payload before the first checkpoint CAS claim, and rejects stale/duplicate resumes before node execution.
    - Approved nodes receive `ctx.resume`; denied nodes never execute. Concurrent suspension requests serialize behind one durable review cursor instead of losing node state.
    - `toolNode({ approval })` suspends before side effects. Approved resume recomputes args/action and rechecks current `ExecutionPolicy`; callback approval/cache behavior remains process-local and cannot grant stale permissions.
    - Suspension/resume data is byte-bounded and redacted in events/results/checkpoints while node logic receives validated runtime input. Cancellation works for local, orphaned, and fenced coordinator-created suspended records.
    - Coordinators poll only `queued`/`running`; suspension retains no worker, lease, timer, or polling loop. Existing in-memory/SQLite/PostgreSQL generic checkpoint category+JSON storage needed no migration or new package.
    - Docs, package README/changelog, migration/index/review/performance pages, and `examples/workflow-tool-approval.ts` updated.
    - Focused workflow suite: 43 pass, 0 fail. Final `npm run sdk:ready`: 1,547 tests, 1,522 pass, 25 explicit live skips, 0 fail; all 27 dry-run packs successful. Workflow tarball: 25.7 kB packed / 121.6 kB unpacked / 34 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; workflow statuses, checkpoint payloads, commands, and approval behavior change.
    - Docs pages to create/edit:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/coding-security.md`, `docs/cli-rpc.md`, database persistence docs.
    - `docs/index.md` update: yes; update workflow entry to mention durable human approval.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 9 — Add a small optional RAG package
  - Acceptance Criteria:
    - Functional: plain text and Markdown can be chunked with configured size/overlap, embedded in batches, upserted with source metadata, retrieved by bounded top-K/filter, and rendered with stable source/citation IDs.
    - Functional: RAG uses the Phase 7 `Embedder`/`VectorStore` contracts and can contribute retrieved context to an agent without changing core input assembly.
    - Performance: chunk count, chunk bytes/tokens, overlap, batch size, query candidates, result bytes, and context tokens are bounded; indexing and retrieval honor abort signals.
    - Code Quality: text/Markdown use a small deterministic implementation and standard APIs; PDF/HTML/LaTeX/semantic chunking, GraphRAG, reranker pipelines, and extraction-agent frameworks are out of scope.
    - Security: source IDs/metadata are tenant-scoped, remote content still uses Phase 1 media/resource policies, and retrieved text cannot grant tools or permissions.
  - Approach:
    - Documentation Reviewed:
      - `docs/multimodal-content.md`, `docs/resource-loading.md`, context/input docs, Phase 7 memory/vector docs when completed.
      - Mastra MDocument chunking, embedding, vector query, metadata extraction, and GraphRAG docs for feature selection only.
    - Options Considered:
      - Add chunking/retrieval to core: unrelated to invariant agent mechanics; rejected.
      - Optional package reusing memory vector contracts: chosen.
      - Depend on a large document framework: rejected for initial text/Markdown scope.
    - Chosen Approach:
      - Create tentative `@arnilo/prism-rag` with deterministic recursive/character chunking, an indexing helper, retrieval context provider, and citation renderer.
    - API Notes and Examples:
      ```ts
      const chunks = chunkText(markdown, { size: 1_000, overlap: 100, sourceId: "guide" });
      await indexChunks({ chunks, embedder, store, scope });
      const context = await retrieveContext("How do approvals work?", { topK: 4, scope });
      ```
    - Files to Create/Edit:
      - `packages/rag/` (tentative): chunking, indexing, retrieval, tests, README.
      - Shared memory conformance only if RAG exposes a missing generic requirement.
      - RAG example using mock embedder/vector store.
    - References:
      - Existing `ResourceLoader`, `ContextProvider`, content bounds, and Phase 7 primitives.
  - Test Cases to Write:
    - Deterministic text/Markdown boundaries, overlap, stable IDs, empty/oversized inputs, abort, and limits.
    - Batch embedding/upsert, metadata filter, top-K citation rendering, duplicate source idempotency.
    - Tenant isolation, prompt-injection text remains inert context, secret redaction, and remote-resource policy reuse.
  - Completion Evidence (2026-07-16):
    - Added optional `@arnilo/prism-rag`, reusing Phase 7 `Embedder`/`VectorStore` and core `ContextProvider`; no core runtime change, parser/document-framework dependency, new vector abstraction, remote loader, or profile activation.
    - `chunkText()` and `chunkMarkdown()` provide deterministic boundary-aware character chunks, configured overlap, stable URL-safe source/citation IDs, source metadata, and hard document/chunk/count/metadata ceilings.
    - `indexChunks()` validates scope/chunks/vectors, redacts before external embedding/persistence, batches at default 32 / hard 128, propagates abort, and upserts stable IDs idempotently into in-memory or pgvector-backed Phase 7 stores.
    - `retrieveContext()` performs exact tenant/resource/corpus-scoped bounded candidate search, shallow JSON metadata filtering, top-K selection, UTF-8 result/context budgets, stable citation rendering, secret redaction, abort propagation, and malformed/cross-scope hit rejection.
    - `createRagContextProvider()` uses latest user text or a host query callback and contributes retrieved text as explicit inert context; source loading remains host-owned under existing resource/media trust policies.
    - Added 9 focused package tests, API README/page, offline `examples/rag.ts`, package/install/pack/docs/profile enrollment, migration/release/review/performance cross-links, and plan `061-small-optional-rag-package.md`.
    - Final `npm run sdk:ready`: 1,561 tests, 1,536 pass, 25 explicit live skips, 0 fail; all 28 dry-run packs successful; npm audit reports 0 vulnerabilities. RAG tarball: 9.0 kB packed / 34.6 kB unpacked / 22 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional RAG package.
    - Docs pages to create/edit:
      - `docs/rag.md`: chunking, indexing, retrieval, citations, limits, security, and examples.
      - `docs/working-and-semantic-memory.md` and context docs for shared primitives.
    - `docs/index.md` update: yes; add RAG under Input, prompt, and context assembly.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 10 — Add web-standard serving and MCP server exposure
  - Acceptance Criteria:
    - Functional: an optional server package exposes selected agents and workflows through a Web `Request -> Response` handler with direct result, bounded event streaming, abort, status, and resume endpoints.
    - Functional: the existing MCP package can expose selected Prism tools and approved workflow/agent operations using the installed MCP SDK server APIs; existing client behavior remains unchanged.
    - Functional: hosts supply authentication/authorization callbacks and route selection; Prism provides no user database or auth-provider integration.
    - Performance: request bodies, response/error bodies, SSE events, concurrent runs, timeouts, and subscriber queues are bounded; disconnect aborts owned work when configured.
    - Code Quality: one web-standard handler supports Node/serverless/framework wrappers; no Express/Fastify/Hono/Koa/Nest/Next dependency enters Prism server code.
    - Security: all routes fail closed, validate ownership and content type, apply CORS/host/origin policy only when explicitly configured, redact errors, and expose no tool/agent/workflow by default.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/cli-rpc.md`, `docs/workflows.md`, `docs/host-security.md`, event and transport bounds.
      - Installed `@modelcontextprotocol/sdk@1.29.0` declarations for `McpServer.registerTool`, server ownership, and web-standard/Streamable HTTP transports.
      - Mastra server/client/MCP surfaces for endpoint selection only.
    - Options Considered:
      - Add framework-specific adapters: maintenance multiplication; rejected.
      - Put HTTP server startup in core: hidden deployment policy; rejected.
      - Optional pure handler plus host-owned listener/framework bridge: chosen.
    - Chosen Approach:
      - Create tentative `@arnilo/prism-server` using Web `Request`, `Response`, `ReadableStream`, and `AbortSignal` APIs. A tiny Node listener example may adapt requests but is not mandatory runtime.
      - Extend `@arnilo/prism-mcp` using SDK `McpServer` registration methods. Default transport examples use SDK-provided stdio/web-standard transports; Prism maps only explicitly selected capabilities.
    - API Notes and Examples:
      ```ts
      const handler = createPrismHandler({
        agents: { support: agent },
        workflows: { publish: workflow },
        authorize: async ({ request, capability }) => hostPolicy(request, capability),
      });

      const mcp = createPrismMcpServer({ tools: approvedTools });
      await mcp.connect(transport);
      ```
    - Files to Create/Edit:
      - `packages/server/` (tentative): handler, routing, streaming, tests, README.
      - `packages/mcp/src/server.ts`, exports, tests, README.
      - Examples for native Node adaptation and MCP in-memory transport.
    - References:
      - Existing bounded SSE/event multiplexer, run result/stream APIs, workflow commands, MCP client bridge, and host security policy seams.
  - Test Cases to Write:
    - Result/stream/status/resume routes, disconnect abort, malformed/body overflow, unknown capability, auth deny, ownership mismatch, and redacted error.
    - MCP list/call selected tool, unknown/denied tool, tool error, abort, list-changed notification, workflow operation allow-list.
    - Web-standard handler runs without framework dependency; packed server and MCP package imports.
    - Concurrency/body/event limit tests and secret scan.
  - Completion Evidence (2026-07-16):
    - Added optional `@arnilo/prism-server` with one framework-free `createPrismHandler()` over Web `Request`, `Response`, and `ReadableStream`; no core change, listener, framework, auth provider, user database, route discovery, or hidden activation.
    - Handler exposes only selected agent/workflow IDs: direct and bounded SSE agent runs; direct/SSE workflow starts; ownership-scoped durable workflow status, cancellation, and Phase 8 approve/deny CAS resume.
    - Every matched operation requires host `authorize()` returning non-empty ownership; request identity is never trusted. Exact host/origin/CORS policy is opt-in. JSON content type, route IDs, body/result/event/stream/queue/concurrency/timeouts, abort/disconnect, generic errors, and known-secret redaction are bounded/fail closed.
    - Extended `@arnilo/prism-mcp` with `createPrismMcpServer()` for explicit `ToolDefinition`/`CommandDefinition` registration through SDK v1.29 `McpServer.registerTool`; JSON Schema converts through direct Zod v4, tools retain core dispatch permission/validator/redactor gates, and per-call authorization is mandatory.
    - Added `createPrismMcpWebHandler()` using SDK `WebStandardStreamableHTTPServerTransport` with bounded pre-parsed JSON, bounded response/concurrency/timeout, optional host authentication mapping, and explicit SDK host/origin rebinding policy. Existing MCP client bridge behavior remains unchanged.
    - Added 6 focused Web-handler tests and 4 MCP-server tests covering direct/stream/status/resume/cancel, auth/ownership/routing/content/host/origin denial, disconnect, concurrency/timeouts/result/event bounds, redaction, in-memory list/call, validation/permission, unknown/duplicate capabilities, and Web transport. Existing 12 MCP client tests remain green.
    - Added package/API docs, `examples/web-standard-server.ts`, `examples/mcp-server.ts`, release/install/migration/security/review/performance cross-links, and plan `062-web-server-and-mcp-exposure.md`. Publishable graph is 29 packages; server remains outside profile bundles pending size/use review.
    - Final `npm run sdk:ready`: 1,576 tests, 1,551 pass, 25 explicit live skips, 0 fail; all 29 dry-run packs successful; npm audit reports 0 vulnerabilities. Server tarball: 8.4 kB packed / 34.4 kB unpacked / 12 files; MCP tarball: 11.6 kB packed / 45.0 kB unpacked / 20 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new server package and MCP server API.
    - Docs pages to create/edit:
      - `docs/server.md`: handler, routes, auth callbacks, streaming, deployment adaptation, limits.
      - `docs/mcp-tools.md`: client/server distinction and exposure policy.
      - `docs/host-security.md`: remote boundary checklist.
    - `docs/index.md` update: yes; add Server/API section and update MCP entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 11 — Extend workflows with schedules, background execution, composition, state, and replay
  - Acceptance Criteria:
    - Functional: hosts can create, list, pause, resume, trigger, and delete durable one-time/interval schedules that enqueue workflow runs idempotently through the existing coordinator.
    - Functional: a workflow can be used as a node, share typed/validated state, and replay from an eligible completed node while preserving original-run lineage and immutable prior evidence.
    - Functional: active/background runs can be observed by run ID after reconnect; process restart does not duplicate scheduled fire or completed steps.
    - Performance: scheduler polling, claimed schedules, run concurrency, nested depth, replay fan-out, state bytes, and history are bounded; idle schedules consume no busy loop.
    - Code Quality: scheduler and replay reuse workflow checkpoints, leases, fencing, node runners, and event multiplexer; no second queue or durable-agent engine is added.
    - Security: schedule/replay operations enforce owner/tenant authorization, nested workflows cannot broaden tools/credentials, and replay never reuses stale approval without Phase 8 resume checks.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md`, workflow primitives, database persistence, CLI/RPC, and Phase 8 suspend/resume docs.
      - Mastra schedules, workflow composition/state, background/durable runs, restart, and time-travel docs/source for capability comparison.
    - Options Considered:
      - Implement a full cron parser in core: unnecessary parser/security surface; rejected.
      - Support one-time `nextRunAt`, fixed interval, and host-supplied schedule calculator; chosen. A cron adapter can be optional later.
      - Copy entire checkpoints for replay and mutate lineage: storage-heavy/confusing; rejected.
    - Chosen Approach:
      - Add schedule records to the workflows package and production persistence adapters, claimed with existing leases/idempotency keys.
      - Model nested workflows as a node adapter over the same runner. Store state in versioned bounded checkpoint data. Replay creates a new run referencing source run/node/checkpoint and reuses only validated immutable predecessor outputs.
    - API Notes and Examples:
      ```ts
      await schedules.create({ workflowId: "cleanup", intervalMs: 86_400_000, input, ownerId });
      const replay = await workflow.replay({ sourceRunId, fromNodeId: "review", ownerId });
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/schedules.ts` (tentative), types, runner/node composition, replay/state logic, commands, tests.
      - SQLite/PostgreSQL persistence schema/migrations and conformance.
      - Server/RPC bindings for approved operations.
    - References:
      - Existing workflow coordinator, `CheckpointStore`, `LeaseStore`, fencing tokens, cancel/resume, fan-out/join, and production persistence.
  - Test Cases to Write:
    - One-time/interval create, due fire, duplicate poll, pause/resume/manual trigger/delete, restart, and concurrent coordinators.
    - Nested workflow success/failure/suspend/cancel, max depth, state validation/size bound.
    - Replay lineage, eligible/ineligible node, unchanged prior evidence, new downstream side effects only, authorization, and approval recheck.
    - SQLite/PostgreSQL live coordination plus deterministic network-free in-memory tests.
  - Completion Evidence (2026-07-16):
    - Added `createWorkflowSchedules()` inside `@arnilo/prism-workflows`: mandatory tenant + account/user scope; create/get/list/pause/resume/idempotent-trigger/delete; one-time, fixed interval, and explicit host calculator IDs; abortable `pollOnce()`/`run()`; bounded input/page/claims/poll/lease settings. No scheduler starts on import or construction.
    - Schedule records use core `CheckpointStore` namespace `prism.workflow.schedule`; administrative/fire operations share `LeaseStore` exclusion, record updates use CAS, and deterministic run IDs make enqueue-before-advance crash retry idempotent. Due work enters existing `enqueueWorkflow()`/`createWorkflowCoordinator()`; `startWorkflowBackground` is the explicit enqueue alias. SQLite/PostgreSQL generic checkpoint/lease adapters need no migration.
    - Added `workflowNode()` composition through the same runner. Child workflows inherit ownership, agents/tools, `ExecutionPolicy`, redactor, abort, checkpoints, metadata, event bus, and an inherited nested-depth ceiling. Child state returns to parent; child suspension/approval/denial bubbles without leaving an orphaned suspended child.
    - Added bounded shared JSON state: `state.initial`/`schema`, `ctx.state`/`stateVersion`/async `updateState(merge|replace)`, host `validateState`, redaction, byte/history bounds, state snapshots in existing checkpoint JSON, and final `WorkflowRunResult.state`.
    - Added `replayWorkflow()`: succeeded source/node checks, ownership + definition hash checks, new checkpoint/run identity, strict downstream rerun, selected-node pre-state restoration, immutable `{ sourceRunId, fromNodeId, rootRunId, depth }` lineage, replay-depth cap, and rejection when copied evidence contains a prior tool/nested approval so Phase 8 approval executes fresh.
    - `createWorkflowCommands()` now exposes `workflow.enqueue`/`workflow.replay`; six `schedule.*` commands appear only when a schedule service is selected. `@arnilo/prism-server` adds authorized enqueue/replay and optional authorization-selected ownership-scoped schedule routes. MCP exposure remains explicit by passing these command definitions.
    - Added 11 focused workflow behavior tests and 2 server-route tests covering concurrent/restarted schedule firing, coordinator background execution, pause/resume/trigger/delete/calculator/redaction/ownership/bounds/abort, nested state/suspension/denial/depth, replay state/lineage/source immutability/approval/ownership, commands, and Web routes. Focused totals: 54 workflow + 8 server tests pass.
    - Updated workflow/API/security/persistence/CLI/MCP/server/index/migration/release/review/performance docs, package READMEs/changelogs, and runnable `examples/workflow-schedules-replay.ts`; completed plan `063-workflow-schedules-composition-state-replay.md`.
    - Final `npm run sdk:ready`: 1,589 tests, 1,564 pass, 25 explicit live skips, 0 fail; all 29 dry-run packs successful; npm audit reports 0 vulnerabilities. Workflow tarball: 34.7 kB packed / 171.5 kB unpacked / 38 files; server tarball: 9.9 kB packed / 45.2 kB unpacked / 12 files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; workflow node/status/state/schedule/replay APIs, persistence, commands, and events change.
    - Docs pages to create/edit:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, database persistence pages, `docs/cli-rpc.md`, `docs/server.md`.
    - `docs/index.md` update: yes; workflow entry must mention schedules, composition, state, and replay.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 12 — Add trace/run feedback and evaluation linkage
  - Acceptance Criteria:
    - Functional: hosts can attach rating, comment, tags, and optional scorer/evaluation IDs to a run/trace; records are queryable and immutable or versioned according to documented semantics.
    - Functional: OpenTelemetry instrumentation emits metadata-only feedback/evaluation events or attributes without embedding unrestricted comments in metric labels.
    - Performance: feedback payload/tag counts and query pages are bounded; high-cardinality values never become metric attributes by default.
    - Code Quality: feedback uses existing persistence/query and OTel seams; no first-party Datadog, Langfuse, LangSmith, Arize, Braintrust, Sentry, or PostHog adapter is added.
    - Security: ownership checks, redaction, retention, deletion, and tenant isolation apply to comments/tags; exporter failures never break agent runs.
  - Approach:
    - Documentation Reviewed:
      - `docs/observability.md`, `docs/runs-and-usage.md`, production persistence/query docs, Phase 4 eval docs.
      - Mastra observability feedback, trace scoring, storage exporter, and vendor integration docs for data-model comparison.
    - Options Considered:
      - Encode feedback only as OTel span events: difficult to update/query after span export; rejected.
      - Persist a small Prism record and optionally mirror safe metadata to OTel: chosen.
      - Build vendor exporters: use OTLP and host SDKs instead; rejected.
    - Chosen Approach:
      - Add a bounded `RunFeedbackRecord`/query contract, in-memory and database implementations, and optional OTel handling. Link evaluation records by ID rather than copying scorer payloads.
    - API Notes and Examples:
      ```ts
      await feedback.append({
        runId,
        ownerId,
        rating: 1,
        comment: "Useful and cited",
        tags: ["reviewed"],
        evaluationIds: [evaluation.id],
      });
      ```
    - Files to Create/Edit:
      - Core/package persistence contracts and query types as approved.
      - SQLite/PostgreSQL migrations/adapters/conformance.
      - `packages/observability-opentelemetry` feedback handling and tests.
      - Phase 4 eval package linkage.
    - References:
      - Existing run/trace IDs, metadata-only telemetry policy, cursor pagination, retention, and redaction.
  - Test Cases to Write:
    - Append/query/version/delete or tombstone behavior, pagination, bounds, and missing run.
    - Cross-owner denial, canary redaction, retention, exporter failure isolation.
    - OTel test verifies only safe low-cardinality fields become attributes/events.
  - Completion Evidence (2026-07-16):
    - Added core `RunFeedbackRecord`, append/query/delete contracts, `RunFeedbackStore`, mandatory exact ownership (tenant plus account/user), `createMemoryRunFeedbackStore()`, bounded/redacted validation, abort handling, and optional `ProductionPersistenceStore.feedback`. Records are immutable; correction appends a new ID and owned deletion handles privacy/retention.
    - Bounds: finite rating `[-1,1]`; comment 4/16 KiB; tags 16/64; scorer/evaluation links 16/64; metadata 16/64 KiB; page 100/500 default/hard; tag/ID lengths 64/128. Run resolution occurs before redaction/persistence and missing/cross-owned runs fail with the same not-found result.
    - Added `@arnilo/prism/testing/feedback` conformance plus SQLite/PostgreSQL schema migration `003_run_feedback`: dedicated run-FK table, cascade deletion, owner/run/trace creation indexes, parameterized exact-owner append/query/delete, reopen behavior, and optional adapter `feedbackRedactor`. Shared schema version is 3; PostgreSQL migration remains advisory-lock serialized and live tests remain env-gated.
    - Added `appendEvaluationFeedback()` in `@arnilo/prism-evals`: resolves 1–64 unique IDs from `EvaluationStore`, rejects missing/mismatched run/trace/ownership, and copies only evaluation/scorer IDs — never score, reason, error, or metadata payloads.
    - Extended `@arnilo/prism-observability-opentelemetry` with `handleRunFeedback()`/`handleEvaluation()`: safe scalar metadata becomes active-run span events or short post-run spans; counters use fixed rating/link/status vocabularies. Comments, tag values, scorer/evaluation IDs, arbitrary metadata, and run/trace IDs never become metric labels. Disabled/exporter-failing instrumentation remains isolated.
    - Added focused tests for immutable memory append/query/delete, bounds/abort/redaction/missing and cross-owned runs, evaluation resolution/link mismatch/unknown IDs, SQLite migration/reopen/tenant isolation/redaction, PostgreSQL DDL/live conformance, and safe/failing OTel projection. Added runnable `examples/run-feedback.ts`.
    - Updated runs/evaluations/observability/public-contract/persistence/migration/security/performance/navigation docs, package READMEs/changelogs, release subpath inventory, review coverage, and completed plan `064-trace-run-feedback-evaluation-linkage.md`.
    - Final `npm run sdk:ready`: 1,600 tests, 1,575 pass, 25 explicit live skips, 0 fail; all 29 dry-run packs pass; npm audit reports 0 vulnerabilities. Core 398.1 kB packed / 1.4 MB unpacked / 219 files; evals 9.8/38.4 kB; OTel 6.3/26.5 kB; SQLite 17.7/89.8 kB; PostgreSQL 18.1/89.8 kB.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; feedback persistence/query and telemetry behavior are new.
    - Docs pages to create/edit:
      - `docs/observability.md`, `docs/runs-and-usage.md`, `docs/evaluations.md`, database persistence pages.
    - `docs/index.md` update: no new page; update Observability and Evaluations descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 13 — Add optional supervisor delegation and A2A interoperability
  - Acceptance Criteria:
    - Functional: an optional supervisor can delegate to an explicit allow-list of local child agents, return child results, isolate child resource/thread IDs, propagate cancellation, and enforce per-delegation step/token/time/tool budgets.
    - Functional: hooks can approve, reject, narrow, or modify a delegation and inspect completion without granting broader permissions than the parent.
    - Functional: selected agents can be exposed through the current A2A protocol with host-provided authentication/authorization and signed agent cards where required; remote agents can be invoked through an explicit client adapter.
    - Performance: maximum delegation depth, active children, message bytes, budgets, remote timeouts, and stream buffers are bounded; cycles fail before execution.
    - Code Quality: supervisor and A2A are optional packages built on `AgentRunResult`, memory scope, server handler, and event primitives; deterministic workflows remain the preferred orchestration tool for known graphs.
    - Security: child permissions only narrow, credentials are resolved in the owning child/remote boundary, memory is isolated, cards/signatures are verified, remote content is untrusted, and abort/ownership propagate through the full chain.
  - Approach:
    - Documentation Reviewed:
      - Prism agent definitions, loops, workflows, memory, server, execution policy, credentials, events, and host security docs produced in earlier phases.
      - Mastra supervisor/delegation, task-completion, memory isolation, durable/background, and A2A docs/source for behavioral comparison.
      - Current A2A protocol specification and security guidance must be rechecked at implementation time; do not copy Mastra wire types as Prism contracts.
    - Options Considered:
      - Put dynamic delegation into core `createAgent`: broadens invariant runtime and permission surface; rejected.
      - Model every delegation as a static workflow: safe but cannot cover dynamic supervisor decisions; retain as preferred deterministic option.
      - Optional supervisor package plus optional A2A adapter over server primitives: chosen.
    - Chosen Approach:
      - Create tentative `@arnilo/prism-supervisor` using explicit child descriptors and host hooks. Use unique derived resource IDs and run-result/event forwarding with bounded filters.
      - Add A2A to the optional server/interoperability package or a separate package only if protocol dependencies justify it. Use WebCrypto/Node crypto for ES256 rather than a new signing abstraction when sufficient.
    - API Notes and Examples:
      ```ts
      const supervisor = createSupervisor({
        agent,
        children: { researcher: { agent: researchAgent, permissions: readOnlyPolicy } },
        limits: { maxDepth: 2, maxActiveChildren: 2, maxTokens: 20_000 },
      });
      ```
    - Files to Create/Edit:
      - `packages/supervisor/` (tentative): delegation, hooks, budgets, tests, README.
      - Server/A2A package files, protocol mapping, signing/verification, tests.
      - Memory/resource scoping helpers only if existing APIs cannot express child isolation.
    - References:
      - Existing agent definitions, provider/tool budgets, execution policies, abort signals, event streams, and Phase 7/10 primitives.
  - Test Cases to Write:
    - Local delegation success/reject/modify, child failure, abort, depth/cycle/concurrency/token/time/tool limits, and completion hook.
    - Parent/child memory isolation, permission narrowing, credential ownership, and secret redaction.
    - A2A card sign/verify/tamper/expiry, unauthorized invoke, malformed/oversized stream, timeout, abort, and remote error.
    - Deterministic workflow path remains unaffected and no supervisor package is loaded by core.
  - Completion Evidence (2026-07-16):
    - Added independently installable zero-runtime-dependency `@arnilo/prism-supervisor` as the 30th publishable package. Core, `createAgent()`, workflows, server, and profile bundles have no supervisor/A2A import or activation; package stays profile-excluded pending Phase 14 review.
    - `createSupervisor()` delegates only to explicit child descriptors. Child factories receive exact ownership, immutable path/depth, package-derived unique resource/thread IDs, AND-composed parent/child/hook/returned-agent/tool-budget permission, cooperative abort, and bounded nested `delegate()`. They receive no credentials; provider/credential/memory construction remains child-owned.
    - Before hooks can reject, redact/modify input, or narrow policy/limits; after hooks observe redacted terminal summaries and cannot change settled results. Bounded metadata events cover start/finish/reject/error. Cycles, depth, active-child overflow, oversized input, timeout, excess tool side effects, and terminal token overage fail closed.
    - Local defaults/hard caps: depth 4/16, active children 4/32, message 64 KiB/1 MiB, tool rounds 8/64, tool calls 32/256, tokens 20k/1m, timeout 60s/30m, event queue 128/4096. Token enforcement uses provider-reported terminal aggregate and may overshoot by one provider turn; no result beyond limit is returned.
    - Implemented current A2A protocol 1.0 text subset from `a2a-protocol.org/latest`: validated HTTPS `JSONRPC` Agent Cards and `/.well-known/agent-card.json`, `SendMessage`, `SendStreamingMessage`, `GetExtendedAgentCard`, task/artifact mapping, and backpressure-driven SSE.
    - Added WebCrypto ES256 JWS card sign/verify with canonical unsigned-card payload, algorithm/key/issued/expiry/max-age pinning, tamper rejection, and no automatic `jku` retrieval. Handler authorization is host-provided per method; ordinary Prism server routes remain unchanged.
    - Added explicit remote client with exact HTTPS origin allow-list checked before fetch, redirect rejection, card endpoint/interface/version verification, optional pinned signature verifier, post-serialization auth callback, bounded JSON/SSE parsing, terminal task validation, timeout/abort/concurrency limits, redaction, and no credential forwarding/discovery.
    - A2A defaults/hard caps: request/card/event 64 KiB/1 MiB, response 1/8 MiB, stream 10/64 MiB and 10k/100k events, concurrency 16/256, timeout 120s/30m. Only text parts ship; file/data parts, push notifications, durable remote tasks, gRPC/HTTP+JSON, and automatic key/endpoint discovery fail closed or remain absent.
    - Added 11 focused tests covering local success/reject/modify/failure/abort, scope isolation, narrowing permissions, cycle/depth/concurrency/input/tool/token/time ceilings, redaction, card sign/verify/tamper/expiry, authorization, malformed/oversized protocol input, SSE, origin rejection, remote mapping, timeout/abort, and offline handler/client composition. Added runnable `examples/supervisor-a2a.ts`.
    - Registered package across workspace, pack/install/profile/docs/release/example maps; added package README/changelog, `docs/supervisors.md`, `docs/a2a.md`, host-security/memory/server/workflow/migration cross-links, navigation, review coverage, and plan `065-supervisor-delegation-and-a2a.md`.
    - Synthetic Node v24.18.0 mock run: 100 local delegations 11.83 ms; 100 card-discovery + in-process A2A JSON-RPC round trips 34.17 ms. Tarball: 15.3 kB packed / 69.4 kB unpacked / 22 files.
    - Final `npm run sdk:ready`: 1,616 tests, 1,591 pass, 25 explicit live skips, 0 fail; all 30 dry-run packs pass; npm audit reports 0 vulnerabilities; `git diff --check` clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; optional supervisor and A2A APIs/protocol mapping.
    - Docs pages to create/edit:
      - `docs/supervisors.md`: delegation, budgets, isolation, workflows comparison, examples.
      - `docs/a2a.md`: protocol version, agent cards, auth, streaming, limits, security.
      - `docs/host-security.md`, memory and server docs for cross-references.
    - `docs/index.md` update: yes; add Multi-agent and interoperability entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Phase 14 — Complete maintainability, documentation, packaging, and 0.0.5 release validation
  - Acceptance Criteria:
    - Functional: all 0.0.5 features compose through public packed imports; examples and generated projects work without workspace-relative paths; optional packages remain independently installable.
    - Functional: every package manifest, lockfile entry, internal dependency/peer range, changelog, migration note, bundle/profile decision, tarball, provenance report, and release artifact consistently targets 0.0.5.
    - Performance: default network-free test budget remains under 60 seconds on the documented reference environment or a measured, justified new budget is approved; core/generated-project/package size regressions are reported and reduced where unnecessary.
    - Code Quality: touched source-text tests are replaced; dead exports/dependencies and contradictory docs are removed; `contracts.ts`, `agents.ts`, and workflow runner are split only where completed feature work proves a cohesive boundary; completed plans are indexed/archived without rewriting history.
    - Security: full SSRF/tool/approval/redaction/OAuth/persistence/media/server/MCP/memory/workflow/supervisor/A2A threat suites pass; audit has zero high/critical findings; secret scan covers source, fixtures, logs, databases, checkpoints, generated projects, and tarballs.
  - Approach:
    - Documentation Reviewed:
      - Every page changed/created by Phases 1-13, `README.md`, `CHANGELOG.md`, `docs/migration.md`, `docs/release-and-install.md`, package READMEs/manifests, release workflow/script.
      - Node 20/24 compatibility, npm provenance/publish behavior, dependency release notes for every selected optional integration.
    - Options Considered:
      - Publish 0.0.4 after fixes: conflicts with immutable tagged review state; rejected.
      - Publish 0.0.5 from one deterministic dependency-ordered release after all gates: chosen.
      - Add every new optional package to `prism-all`/profiles automatically: rejected; bundle inclusion requires explicit dependency/size/use-case review.
    - Chosen Approach:
      - Run focused phase checks continuously, then one packed-install integration matrix and release dry-run. Upgrade only dependencies required by implemented APIs/security; do not combine unrelated TypeScript/Node major upgrades with 0.0.5.
      - Keep old numbered plans immutable. Add an index/archive marker rather than retaining another giant historical narrative in this roadmap after release.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      npm ls --all
      npm run test:postgres
      npm run release:check -- --version 0.0.5
      npm run release:publish -- --version 0.0.5 --dry-run --allow-untagged
      ```
    - Files to Create/Edit:
      - Root/workspace `package.json` files and `package-lock.json`.
      - `CHANGELOG.md`, package changelogs/READMEs, `README.md`, `docs/migration.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-15.md`.
      - `.github/workflows/release.yml`, `scripts/release.mjs`, release tests only if new package graph exposes a gap.
      - `plans/README.md` or archive index for completed plans; historical plan bodies remain unchanged.
    - References:
      - Existing deterministic/resumable release script, Node 20/24 CI, PostgreSQL service job, pack/install smoke tests, public export contract, and 0.0.4 package graph.
  - Test Cases to Write:
    - Full typecheck/build/network-free suite; Node 20/24 public import matrix; all docs/examples; generated-project test.
    - Packed cross-package journey combining result streaming, eval, AI SDK fake model, memory/RAG, durable approval/workflow, server/MCP, schedule/replay, feedback, and supervisor without live credentials.
    - PostgreSQL live adapter suite and optional credential-gated provider/A2A smoke commands documented and operator-run where credentials exist.
    - Tarball allow/deny lists, fresh install, dependency graph, version/range/tag checks, provenance dry-run, secret scan, audit/license/install-script review.
    - Release assertion: npm has no `@arnilo/*@0.0.5` collision and all 0.0.4 packages remain unpublished unless already externally present.
  - Completion Evidence (2026-07-16):
    - Retargeted all 30 publishable manifests, lockfile workspace entries, internal runtime/optional/peer ranges, runtime identities, generated scaffolds, tests, docs, changelogs, and tarball assertions to exact 0.0.5. Core retains zero runtime dependencies and Node >=20.
    - Finalized root + 29 package changelogs; updated migration/release/navigation/review docs; indexed all 67 immutable numbered plans in `plans/README.md`. Reviewed 1,562-line contracts, 881-line agent runtime, and 1,248-line workflow runner; no cohesive low-risk release-time split justified.
    - Follow-up profile review includes AI SDK interoperability in `prism-providers` and all six Phase 4-13 capability packages in `prism-all`. Base/code/SDK remain unchanged; direct packages remain independently installable and every capability remains inert until host wiring. Exact dependency and transitive-completeness gates pass; final `sdk:ready` remains 1,618 tests / 1,593 pass / 25 skipped / 0 fail with all 30 packs successful. No dead runtime dependency/export or workspace install script was found; no unrelated major upgrade was taken.
    - Extended fresh-tarball validation across all 30 packages and 44 built exports. Packed public composition now exercises streaming result, fake AI SDK, eval+feedback, working/semantic memory, RAG, durable approval, schedule/replay, server/MCP, and supervisor/A2A without live credentials or workspace-relative imports. Generated `prism init` output installs packed core, typechecks, and tests.
    - Final Node 24 matrix: `npm test` 32.247 s; `npm run sdk:ready` 70.560 s; 1,618 tests / 1,593 pass / 25 explicit live skips / 0 fail; all 30 packs pass. Node 20.20.2 imports all 44 built export targets.
    - Fresh `pgvector/pgvector:pg16` live matrix passes 29/29 session/run/feedback/checkpoint/lease/memory/vector checks. Audit and dependency tree are clean; SBOM has 181 permissively licensed components; `better-sqlite3` is the sole install-script dependency and remains opt-in.
    - Release artifacts: 30 tarballs, 689,687 packed / 2,636,449 unpacked bytes / 699 files; core 402,985 / 1,456,420 bytes / 221 files. All SHA-256 checksums verify; artifact token/private-key scan has zero hits; production TypeScript strict scan and `git diff --check` pass.
    - npm registry preflight reports 30/30 exact 0.0.5 versions available. Dependency-ordered `npm publish --dry-run` completes 30/30 with public/latest/provenance arguments and retained JSON report. No package was published and no tag was created.
    - Release verdict: GO after protected clean-branch CI, npm authentication, signed `v0.0.5` tag, OIDC publication, and post-publish latest/integrity verification. Provider/keychain/external-A2A live smokes remain unrun because credentials/endpoints were unavailable; offline conformance is authoritative.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this is the complete 0.0.5 documentation and release gate.
    - Docs pages to create/edit:
      - All Phase 1-13 pages, `README.md`, `CHANGELOG.md`, package READMEs/changelogs, `docs/migration.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-15.md`.
    - `docs/index.md` update: yes; verify every public API/package/config/event/protocol page is linked with an accurate functional description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## 0.0.5 Release Checklist

- [x] Every phase above is checked with dated evidence and no unresolved implementation/release-candidate blocker.
- [x] Core runtime dependencies remain zero and Node.js 20 compatibility passes.
- [x] `npm run sdk:ready` passes within the approved budget.
- [x] PostgreSQL live integration passes locally and is required in CI.
- [x] Optional live provider/A2A checks are run when credentials/endpoints are available; none were configured, so offline conformance remains authoritative.
- [x] `npm audit --audit-level=high` reports zero high/critical vulnerabilities.
- [x] `npm ls --all` is clean.
- [x] Source/tests/docs/examples/generated projects and extracted tarballs pass layered secret/canary scanning.
- [x] All packages, lock entries, and internal dependency ranges are exactly 0.0.5.
- [x] Every tarball passes fresh-install public import and packed cross-capability smoke tests.
- [ ] `npm run release:check -- --version 0.0.5` confirms registry availability and tagged clean state at publication time.
- [ ] Release artifacts/checksums/report are retained and publication uses dependency order, resume support, and provenance.
- [ ] npm `latest` points to 0.0.5 only after every package publishes successfully.

## Explicitly Deferred Beyond 0.0.5

- Studio, visual editor, playground UI, hosted cloud, and managed observability service.
- Browser automation and workspace/filesystem/LSP provider ecosystem beyond existing coding tools/sandbox seam.
- Voice/STT/TTS provider packages and Slack/chat-channel adapters.
- Framework-specific HTTP adapters and authentication-provider packages.
- Additional vector databases beyond in-memory and the one approved PostgreSQL reference adapter.
- Advanced document parsers, semantic chunking, metadata-extraction agents, rerankers, and GraphRAG.
- Vendor-specific observability exporters; OTLP remains the interoperability path.
- Cron-expression parser unless a concrete host cannot provide next-run calculation.
- TUI and application UI.
- Automatic provider/package/credential discovery or automatic activation.
- A mandatory central application container.

## Compromises Made

- Release completion means validated release candidate and deterministic handoff, not an in-session immutable npm publication. Clean signed tag, OIDC attestation, `latest`, and post-publish integrity remain operator/workflow-only gates.
- `prism-all` now installs every first-party package and `prism-providers` installs all seven provider adapters. Focused base/code/SDK profiles stay unchanged; installation never activates evaluation, memory, server, provider, or delegation behavior.
- Large contracts/agent/workflow files remain intact. Their state and public-type changes are cross-cutting; release-time splitting offered churn without deletion or ownership isolation.
- Historical source/docs boundary tests were not mass-rewritten. Touched runtime assertions use behavior/types/exports; manifest/docs/absence tests still inspect artifacts because text is their contract.
- Provider, OS-keychain, and external-A2A live smokes were unavailable. Offline conformance plus live PostgreSQL/pgvector are the release authority.
- Token and private-key scanning uses bounded known-pattern/canary checks, not a new scanner dependency; CI artifact allow/deny lists and redaction threat suites provide complementary coverage.

## Further Actions

- Priority high, release operator: merge through protected CI, confirm npm token/OIDC permissions, create signed `v0.0.5`, retain artifacts/report, verify all 30 `latest`/integrity/attestations.
- Priority medium: split contracts/agent/workflow hotspots only in dedicated compatibility-preserving refactors with measurable conflict reduction.
- Priority medium: replace remaining historical implementation-source assertions when their owning APIs next change; do not churn stable boundary tests solely for style.
- Priority medium: run credentialed provider, keychain, and external A2A interoperability smokes before 1.x or when deployment credentials/endpoints exist.
- Priority low: use adoption/install data to decide whether future capabilities belong only in `prism-all` or justify another existing focused profile; do not create new profile families speculatively.
- Priority low: evaluate a dedicated secret-scanner/SBOM policy tool only if CI's stdlib scans and npm audit cease meeting compliance needs.
