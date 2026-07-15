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

- [ ] Phase 0 — Freeze the 0.0.5 scope and review existing primitives before implementation
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
    - Roadmap/review matrix consistency check: every in-scope item has one owner and no unresolved release-blocking row.
    - Baseline script/check: records reproducible commands and environment without introducing timing assertions into normal CI.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this phase freezes scope and evidence.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-15.md`: scope, primitive inventory, threat model, and ownership.
      - `docs/performance.md`: baseline measurements.
    - `docs/index.md` update: yes; add the 0.0.5 review-coverage entry under Release and install.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 1 — Close release-blocking security defects
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
      - `src/content.ts`: normalized IP classification and secure bounded fetch path.
      - `src/contracts.ts` or existing execution context types: run/session identity only if not already available at policy boundary.
      - `packages/coding-agent/src/index.ts`: shared policy propagation.
      - `packages/coding-agent/src/read.ts`, `shell.ts`, `write.ts`, `edit.ts`: pass existing execution identity if required.
      - `packages/coding-security/src/approval.ts`: correct default and scoped keys.
      - Relevant existing test files under `src/__tests__`, `packages/coding-agent/src/__tests__`, and `packages/coding-security/src/__tests__`.
    - References:
      - Confirmed reproductions: bracketed `::1`, `fe80::1`, `fc00::1`, `::ffff:127.0.0.1`; read-only policy check count `0`; two default-scope approvals invoking the callback once.
  - Test Cases to Write:
    - Literal matrix: blocked IPv4/IPv6 ranges, mixed-case/encoded hosts, IPv4-mapped IPv6, explicit allowed hostname, and public IP.
    - DNS matrix with injected resolver/requester: private-only, mixed public/private, rebinding attempt, timeout, abort, lookup failure, and public pinned connection.
    - Read-only aggregator denial: denied read never reaches filesystem operations.
    - Approval scope matrix: default prompts every time; run cache reuses only within run; session cache reuses only within session; parallel identical requests do not accidentally cross scope.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; SSRF behavior, tool option propagation, execution metadata, and approval defaults change.
    - Docs pages to create/edit:
      - `docs/multimodal-content.md`: exact literal/DNS/allow-list guarantees and host-injected fetch responsibility.
      - `docs/coding-agent-tools.md`: aggregator policy propagation.
      - `docs/coding-security.md`: default and run/session cache semantics.
      - `docs/host-security.md`: network and approval threat model.
    - `docs/index.md` update: no new page; update existing entry descriptions only if behavior summaries change materially.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 2 — Fix runtime output, telemetry, usage, media, and workflow-test correctness
  - Acceptance Criteria:
    - Functional: sandboxed shell stdout/stderr reaches the shell tool's normal output path in order and remains abort-aware.
    - Functional: successful, failed, and aborted agent/provider/tool spans end exactly once; detaching instrumentation closes attributable outstanding spans.
    - Functional: every provider turn has attributable usage and the run result contains the aggregate of all turns; persisted and metric records distinguish provider-turn values from run totals so summing cannot double bill.
    - Functional: item count, total bytes, per-item bytes, MIME, audio-duration, and model-capability checks run once over the complete media request before upload/provider I/O.
    - Functional: workflow coordinator concurrency test is deterministic under loaded CI and retains the production concurrency assertion.
    - Performance: streaming remains streaming; output/media fixes do not materialize unbounded data, telemetry maps release terminal entries, and aggregate usage is O(number of turns).
    - Code Quality: one usage accumulator and one media-request validation path replace per-caller patches; timing flakes use explicit gates rather than larger arbitrary sleeps.
    - Security: sandbox output is redacted/sanitized at existing boundaries; media validation occurs before side effects; telemetry and usage metadata contain no prompt, tool result, or secret payloads.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/multimodal-content.md`, `docs/workflows.md`.
      - `packages/coding-security/src/sandbox.ts`, `packages/observability-opentelemetry/src/instrumentation.ts`, `src/agents.ts`, `src/content.ts`, provider media serializers, and workflow coordinator tests.
      - OpenTelemetry API 1.9 semantics through the package's existing peer/dev dependency and local type declarations.
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
      - Replace coordinator timeout polling with promise gates/signals representing claimed and released jobs.
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
      - `packages/coding-security/src/sandbox.ts` and tests.
      - `packages/observability-opentelemetry/src/instrumentation.ts` and tests.
      - `src/agents.ts`, `src/agent-loops.ts`, `src/contracts.ts`, run-ledger adapters/schema/migrations as required.
      - `src/content.ts`, `src/providers/media.ts`, provider request serializers, and media tests.
      - `packages/workflows/src/__tests__/coordinator.test.ts`.
    - References:
      - Runtime evidence: sandbox chunks remained empty; failed `prism.agent.run` span had `ended: false`; one-turn usage created duplicate rows; multi-turn final usage reported only the last turn.
  - Test Cases to Write:
    - Sandboxed shell emits interleaved stdout/stderr, aborts, and respects output bounds.
    - Failed and aborted runs leave zero active spans and every in-memory span ends once.
    - Two-turn tool run persists two provider-turn records and one aggregate record with total 33; billing query/metric path counts one scope only.
    - Four individually valid media blocks exceeding the request total fail before any provider fetch/upload; 33 items fail before serialization.
    - Coordinator cap remains two with deterministic gates and no wall-clock race.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; sandbox adapter, usage records/metrics, media request enforcement, and terminal telemetry change.
    - Docs pages to create/edit:
      - `docs/coding-security.md`, `docs/observability.md`, `docs/runs-and-usage.md`, `docs/multimodal-content.md`, `docs/performance.md`.
      - Persistence docs/migration pages if usage schema changes.
    - `docs/index.md` update: no new page; update usage/observability descriptions if new scope fields are public.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 3 — Simplify the public agent API and remove inert/fragile surfaces
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; core session return/stream APIs and AgentConfig change.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/customization.md`, `docs/cli-rpc.md`, `docs/workflows.md`, `docs/migration.md`.
      - Relevant examples and README quick start.
    - `docs/index.md` update: yes; update the Agent/session runtime entry to advertise direct results and integrated streaming.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 4 — Add optional evaluations, scorers, datasets, and batch experiments
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package and possible persistence records.
    - Docs pages to create/edit:
      - `docs/evaluations.md`: scorers, sampling, datasets, experiments, persistence, security, and examples.
      - `docs/observability.md` and persistence docs for score linkage.
    - `docs/index.md` update: yes; add an Evaluations and quality section or entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 5 — Add a minimal `prism init` project scaffold
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; CLI gains an init command and generated-project contract.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: init command and flags.
      - `docs/release-and-install.md`: generated-project install flow and size expectations.
      - `README.md`: real-provider quick start with passing test.
    - `docs/index.md` update: yes; update CLI and Release/install entry descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 6 — Add optional AI SDK model interoperability
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new provider package and compatibility contract.
    - Docs pages to create/edit:
      - `docs/providers/ai-sdk.md`: supported specification, mapping, limitations, examples, security, and migration policy.
      - `docs/provider-packages.md` and `docs/provider-conformance.md`.
    - `docs/index.md` update: yes; add AI SDK adapter under Provider and model connection.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 7 — Add optional working memory and semantic recall primitives
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional memory package, contracts, and persistence behavior.
    - Docs pages to create/edit:
      - `docs/working-and-semantic-memory.md`: complete API page.
      - `docs/compaction-observational-memory.md`: distinction and composition guidance.
      - PostgreSQL and context/input docs for adapter/injection behavior.
    - `docs/index.md` update: yes; add working/semantic memory under Compaction/session memory.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 8 — Add durable human-in-the-loop suspend and resume
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; workflow statuses, checkpoint payloads, commands, and approval behavior change.
    - Docs pages to create/edit:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, `docs/coding-security.md`, `docs/cli-rpc.md`, database persistence docs.
    - `docs/index.md` update: yes; update workflow entry to mention durable human approval.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 9 — Add a small optional RAG package
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional RAG package.
    - Docs pages to create/edit:
      - `docs/rag.md`: chunking, indexing, retrieval, citations, limits, security, and examples.
      - `docs/working-and-semantic-memory.md` and context docs for shared primitives.
    - `docs/index.md` update: yes; add RAG under Input, prompt, and context assembly.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 10 — Add web-standard serving and MCP server exposure
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new server package and MCP server API.
    - Docs pages to create/edit:
      - `docs/server.md`: handler, routes, auth callbacks, streaming, deployment adaptation, limits.
      - `docs/mcp-tools.md`: client/server distinction and exposure policy.
      - `docs/host-security.md`: remote boundary checklist.
    - `docs/index.md` update: yes; add Server/API section and update MCP entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 11 — Extend workflows with schedules, background execution, composition, state, and replay
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; workflow node/status/state/schedule/replay APIs, persistence, commands, and events change.
    - Docs pages to create/edit:
      - `docs/workflows.md`, `docs/workflow-orchestration-primitives.md`, database persistence pages, `docs/cli-rpc.md`, `docs/server.md`.
    - `docs/index.md` update: yes; workflow entry must mention schedules, composition, state, and replay.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 12 — Add trace/run feedback and evaluation linkage
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; feedback persistence/query and telemetry behavior are new.
    - Docs pages to create/edit:
      - `docs/observability.md`, `docs/runs-and-usage.md`, `docs/evaluations.md`, database persistence pages.
    - `docs/index.md` update: no new page; update Observability and Evaluations descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 13 — Add optional supervisor delegation and A2A interoperability
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; optional supervisor and A2A APIs/protocol mapping.
    - Docs pages to create/edit:
      - `docs/supervisors.md`: delegation, budgets, isolation, workflows comparison, examples.
      - `docs/a2a.md`: protocol version, agent cards, auth, streaming, limits, security.
      - `docs/host-security.md`, memory and server docs for cross-references.
    - `docs/index.md` update: yes; add Multi-agent and interoperability entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Phase 14 — Complete maintainability, documentation, packaging, and 0.0.5 release validation
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this is the complete 0.0.5 documentation and release gate.
    - Docs pages to create/edit:
      - All Phase 1-13 pages, `README.md`, `CHANGELOG.md`, package READMEs/changelogs, `docs/migration.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-15.md`.
    - `docs/index.md` update: yes; verify every public API/package/config/event/protocol page is linked with an accurate functional description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## 0.0.5 Release Checklist

- [ ] Every phase above is checked with dated evidence and no unresolved release blocker.
- [ ] Core runtime dependencies remain zero and Node.js 20 compatibility passes.
- [ ] `npm run sdk:ready` passes within the approved budget.
- [ ] PostgreSQL live integration passes in CI.
- [ ] Optional live provider/A2A checks are run when credentials/endpoints are available; offline conformance remains authoritative by default.
- [ ] `npm audit --audit-level=high` reports zero high/critical vulnerabilities.
- [ ] `npm ls --all` is clean.
- [ ] All source/tests/docs/examples/generated projects and tarballs pass secret scanning.
- [ ] All packages, lock entries, and internal dependency ranges are exactly 0.0.5.
- [ ] Every tarball passes fresh-install public import and documented-example smoke tests.
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

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with measured improvements, rationale, and priority.
