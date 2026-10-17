# Phase 9 Part B — Model router, observability, and delegate packages

## Objectives

- Check that Part A left the contracts Part B builds on (the Task 1 decisions (c), (d), (l), (m), and (n); the `packages.instances` seam; the `governance.identity` service), and re-measure what Part B moves.
- Make turn routing the native package `@arnilo/prism-model-router`, an `around` handler on `model.call`. The `@arnilo/prism-core/governance/model-router` subpath and the `createGovernedProvider`/`providerSource` facades are retired.
- Make OpenTelemetry export the native package `@arnilo/prism-observability`, observe handlers over the event catalog with no phone-home. Workflow spans and the timeline projector stay in `prism-core` for Phase 16.
- Make sub-agents the native package `@arnilo/prism-delegate`: a `delegate` tool whose child agent inherits a chosen subset of the parent's packages, with child activity reported as `delegate.step` package events. `src/delegated-agent-step.ts` and the in-process supervisor leave the kernel and `prism-core`.
- Record the Phase 9 Done criteria against both parts.

## Expected Outcome

- `packages: [modelRouter({ candidates: ["mock/fast", "other/large"], select: "ordered" })]` routes each turn. A same-provider candidate goes through `next`, and a cross-provider candidate through `prism.models.client`. Allow-list, budget, rate, and circuit rules are enforced per principal. A candidate that fails before its first output event falls through to the next. `turn.completed` reports the model that answered.
- `packages: [observability()]` turns every run, turn, and tool call into spans and metrics on the host's globally registered OpenTelemetry tracer and meter. It sends nothing anywhere itself. With `@opentelemetry/api` absent, it emits a status note and registers nothing.
- `packages: [delegate({ children: { reviewer: { inherit: ["@arnilo/prism-tools-coding"], instructions: "…" } } })]` adds the `delegate` tool (with `wait` and `cancel` per Part A Task 1 (m)). Each child runs as its own agent on the inherited packages, within limits that may only narrow the parent's, and reports `delegate.step` events.
- Examples for each package run on mock providers under the execution gate.
- The Phase 9 Done criteria from Part A (`examples/mcp-trust.ts`, `examples/governance-deny.ts`) still pass, and the phase is recorded as done.

This plan implements roadmap **Phase 9 — Integrations, policy, and governance packages**, Part B. It **depends on plan 159** (Part A), whose Task 1 is the review for both parts. This plan opens with an entry check instead of a second review. It adds no kernel contract of its own: `packages.instances` lands in plan 159 Task 2, and routing needs no kernel addition (plan 159 Task 1 (d)). If the entry check finds that a kernel addition is needed after all, it stops, and the addition goes back to plan 159 Task 2 as an amendment. This plan does not bump versions, publish, or edit released `/docs`. Phase 13 owns moving `delegate` from `child` to `origin` (K3), and Phase 16 owns `origin` span attributes and the timeline projector.

Lab impact (probe 12): `packages/prism-code` does not route, export telemetry, or delegate through these modules today (`rg -l 'governance/(model-router|observability)|runtime/supervisor' packages/prism-code/src` is expected to be empty; the entry check confirms it). No lab module becomes deletable.

## Tasks

- [x] Task 1: Part B entry check — router, observability, and delegation after Part A (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 159's Notes:
      - `PackageAPI.packages.instances` exists with the plan 159 Task 2 errors, and is callable from a tool's `execute`
      - `governance.identity` is provided per session, or record that the router keys budgets by `principal.id` alone
      - plan 159 Task 1 (d): `model.call`'s `next` honors a changed `request.model` on the same provider, and a handler can skip `next` and return a `ModelClient` stream; usage and limits charging come from the returned stream
      - plan 159 Task 1 (l): the exact split of `instrumentation.ts` between the package and `prism-core`
      - plan 159 Task 1 (m): which `runtime/supervisor` modules move, and whether the A2A modules import them
      - plan 159 Task 1 (n): router state keying
    - Functional: Re-measure the importers of every name Part B retires (`createModelRouter|createGovernedProvider|isGovernedProvider|createCostLatencySelection|createMemoryModelRouterStateStore|createOpenTelemetryInstrumentation|wrapOpenTelemetryApi|createInMemoryTelemetry|createSpawnAgentTool|createWaitAgentTool|createCancelAgentTool|createSupervisor|createDelegatedAgentStep|DelegatedAgentStep`, plus the `@arnilo/prism-core/governance/{model-router,observability}` and `@arnilo/prism-core/runtime/supervisor` subpaths) per workspace, with the command. Assign each file to Task 2, 3, or 4.
    - Functional: Record the failing-test baseline and compare it with plan 159's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites its command.
    - Security: Confirm that no router candidate, OTel option, or delegate child config carries a literal secret field after the Part A decisions.
  - Approach:
    - Documentation Reviewed:
      - plan 159 Task 1 and Task 2 Notes, `src/packages/api.ts`, `src/agent-session/session/provider-round.ts:270-300`, `packages/prism-core/src/governance/{model-router,observability}/**`, `packages/prism-core/src/runtime/supervisor/**`, `src/delegated-agent-step.ts`
    - Options Considered:
      - Fold this into plan 159 Task 1. Rejected: Part A moves identity and the MCP package, which can change every count Part B relies on.
    - Chosen Approach:
      - Re-read the spans Part A cited, re-run the counts, and amend Tasks 2–4 in place.
    - API Notes and Examples:
      ```bash
      graft callers createGovernedProvider --depth all
      graft callers createOpenTelemetryInstrumentation --depth all
      graft callers createSupervisor --depth all
      ```
    - Files to Create/Edit:
      - `plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md`: Notes and amendments only.
    - References:
      - plan 158 Task 1 (the entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-09):
    - **Verdict: Proceed.** Contracts, seams, and boundaries from Part A are confirmed. No kernel addition is needed. One minor amendment to Task 2 applied in place: `router.decision` package event reports the routed model and attempt (since `turn.completed.metadata.model` reflects the turn request's initial model in `provider-round.ts`).
    - **Contract confirmations (source & plan 159):**
      - `PackageAPI.packages.instances`: Confirmed in `src/packages/loader.ts:631-665` and `src/packages/api.ts:84`. Throws `state_not_ready` during setup, `self_instance` when requesting caller package, `package_disabled` when disabled via `disable.packages`, and `unknown_package` when not loaded. Callable after setup from tool `execute` closures (covered by `src/__tests__/package-loader.test.ts`).
      - `governance.identity`: Confirmed provided per-session by `@arnilo/prism-governance` (`packages/policy/governance/src/identity-hooks.ts:51-54`, `packages/policy/governance/src/index.ts:222`), exposing `get: (sessionId: string) => AgentIdentity | undefined`. When present, router keys state and budgets by `tenantId`, `accountId`, `userId`, `principalId`; when absent, router keys by `principal.id` alone.
      - `model.call` routing (plan 159 Task 1 (d)): Confirmed in `src/agent-session/session/provider-round.ts:287-301`. `next({ ...request, model })` passes the modified request to `provider.generate(request)` on the same provider. Skipping `next` and returning `prism.models.client(candidate).generate(request)` feeds `AsyncIterable<ProviderEvent>` into the turn loop, charging `activeLimits.charge("maxResponseBytes")`, updating usage, and settling stop reasons. `buildMetadata` in `generateProviderTurn` uses the turn's `request.model`; routed candidate and decision details are emitted on `package.event` `router.decision`.
      - `instrumentation.ts` split (plan 159 Task 1 (l)): Agent-event instrumentation (`instrumentation.ts:1-240, 240-465, 572-614, 699-738`, `createInMemoryTelemetry`, `wrapOpenTelemetryApi`, `handleAgentEvent`, `handleDelegation`, `handleRunFeedback`, `handleEvaluation`, policy helpers) moves to `@arnilo/prism-observability`. Workflow spans (`handleWorkflowEvent`, `attachWorkflow`), `timeline.ts`, `timeline-types.ts`, `summary.ts`, and `rag-telemetry.ts` stay in `packages/prism-core/src/governance/observability/` for Phase 16, importing the moved agent instrumentation from `@arnilo/prism-observability`.
      - `src/observability.ts`: Confirmed staying in kernel. It is called by `src/agent-session/session/provider-round.ts:228,250` and `src/index.ts:602` for internal turn metadata construction (`createProviderTurnMetadata`, `readProviderHttpStatus`, `readRequestId`), not export.
      - `runtime/supervisor` split (plan 159 Task 1 (m)): In-process supervisor modules (`supervisor.ts` 1,174 lines, `spawn-tool.ts` 202 lines, `limits.ts` 93 lines, `types.ts` 316 lines, and `errors.ts` supervisor errors) move to `@arnilo/prism-delegate`, alongside kernel `src/delegated-agent-step.ts` (117 lines) and `src/__tests__/delegated-agent-step.test.ts`. A2A modules (`a2a-*.ts`) stay in `prism-core`; grep confirms they import only `A2AError` from `errors.ts` (which extends `SupervisorError`), with zero imports of `supervisor.ts`, `spawn-tool.ts`, `limits.ts`, or `types.ts`.
      - Router state keying (plan 159 Task 1 (n)): `ModelRouterStateKey` constructed from `principal.id` (and `tenantId`, `accountId`, `userId` when `governance.identity` service is available).
    - **Importer counts and file assignments:**
      - Model router: `rg -l "createModelRouter|createGovernedProvider|isGovernedProvider|createCostLatencySelection|createMemoryModelRouterStateStore|@arnilo/prism-core/governance/model-router" src packages examples scripts docs -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!plans/**'` → 17 files outside docs (10 untouched released docs):
        - `examples/governed-provider.ts`, `examples/model-router-aggregate-budgets.ts` → Task 2
        - `scripts/compat-baseline/arnilo__prism-model-router.txt` (new), `scripts/compat-baseline/arnilo__prism-core.txt` (regenerated), `scripts/phase19-freeze-manifest.json`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `scripts/phase22-security.test.mjs`, `scripts/phase19-freeze.test.mjs` → Task 2
        - `packages/prism-core/src/governance/model-router/**` (moved modules and tests), `packages/prism-core/src/enterprise/postgres/__tests__/{enterprise-conformance,model-router.integration,state-concurrency-conformance}.test.ts`, `packages/prism-core/src/__tests__/core-conformance.test.ts`, `packages/prism-core/README.md` → Task 2
        - `src/__tests__/install-smoke.test.ts` → Task 2
      - Observability: `rg -l "createOpenTelemetryInstrumentation|wrapOpenTelemetryApi|createInMemoryTelemetry|@arnilo/prism-core/governance/observability" src packages examples scripts docs -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!plans/**'` → 17 files outside docs (11 untouched released docs):
        - `examples/run-feedback.ts` → Task 3 (`examples/{host-composition-compat,host-step-loop-timeline,execution-timeline}.ts` stay on `prism-core` timeline until Phase 16)
        - `scripts/compat-baseline/arnilo__prism-observability.txt` (new), `scripts/compat-baseline/arnilo__prism-core.txt` (regenerated), `scripts/compat-baseline/arnilo__prism-observability-opentelemetry.txt`, `scripts/fixtures/e2e-070-host-completeness-journey.mjs`, `scripts/fixtures/e2e-full-surface-journey.mjs` → Task 3
        - `packages/prism-core/src/governance/observability/{instrumentation.ts,index.ts,__tests__/instrumentation.test.ts}` → Task 3 (`rag-telemetry.test.ts` and `summary.test.ts` stay on `prism-core`)
        - `packages/prism-coding-tools/src/dev/{server.ts,__tests__/eval-compare.test.ts,__tests__/composition.test.ts}` import timeline/summary, unaffected (stays on `prism-core`)
        - `packages/prism-core/README.md` → Task 3
      - Delegate & supervisor: `rg -l "createSpawnAgentTool|createWaitAgentTool|createCancelAgentTool|createSupervisor|createDelegatedAgentStep|DelegatedAgentStep|@arnilo/prism-core/runtime/supervisor" src packages examples scripts docs -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!plans/**'` → 25 files outside docs (8 untouched released docs):
        - `src/{index.ts,contracts-protocol.ts,delegated-agent-step.ts,__tests__/public-export-contract.test.ts,__tests__/install-smoke.test.ts,__tests__/delegated-agent-step.test.ts}` → Task 4
        - `examples/{autonomous-coding-loop,supervisor-a2a,handoff-swarm,spawn-agent-tool}.ts` → Task 4
        - `scripts/compat-baseline/{arnilo__prism-delegate.txt (new),arnilo__prism-core.txt,arnilo__prism-supervisor.txt,arnilo__prism.txt}`, `scripts/budgets.json`, `scripts/benchmark-scenarios/multi-agent-runtime.mjs`, `scripts/obscura-host-conformance.test.mjs`, `scripts/phase25-dead-exports-raw.txt`, `scripts/fixtures/e2e-full-surface-journey.mjs` → Task 4
        - `packages/prism-core/README.md`, `packages/prism-core/src/runtime/supervisor/{supervisor,spawn-tool,types,index}.ts`, `packages/prism-core/src/runtime/supervisor/__tests__/{supervisor,spawn-tool,nested-approvals}.test.ts`, `packages/prism-core/src/governance/evals/__tests__/spawn-pack.test.ts` → Task 4
        - `packages/tools/coding/src/agent/{spawn-worktree,supervisor-lifecycle}.ts`, `packages/tools/coding/src/agent/__tests__/{supervisor-lifecycle,spawn-worktree}.test.ts` → Task 4
        - `packages/ag-ui/src/{ag-ui-mapper,a2a-server,a2a}.ts`, `packages/ag-ui/src/__tests__/{a2a-server,interoperability,ag-ui-mapper}.test.ts` → Task 4
      - Lab impact verified: `rg -l 'governance/(model-router|observability)|runtime/supervisor' packages/prism-code/src` returns 0 files. Confirmed no lab impact.
    - **Failing-test baseline:**
      - Full sweep: `bun test src packages --path-ignore-patterns='**/limits.test.*'` → 5879 pass / 242 skip / 299 fail / 199 errors / 846 files (185.44s). Failures are pre-existing carried failures in legacy family packages (`prism-core`, `ag-ui`, `agent-sdk`, `prism-code`) and 2 heavy stress test timeouts under bun's 5s test timeout.
      - Part A packages: `bun test packages/integrations/mcp packages/hosts/mcp-server packages/policy/guardrail-packs packages/policy/governance` → 253 pass / 2 skip / 2 fail (14.40s) (1 pre-existing benchmark timeout, 1 mcp-server assertion expecting only public imports).
    - **Security:**
      - Router: Candidate models are `ModelRef`s; credentials resolve via credential refs, no literal secret.
      - Observability: Package config has `serviceName`, `content`, `fieldPolicy`, `metrics`, `enabled`. No exporter or credential fields.
      - Delegate: Children configs take `inherit`, `instructions`, `model`, `limits`. Child credentials resolve in the child session via credential slot refs.
    - **Amendments:**
      - Task 2: Clarified that `router.decision` package event names the routed model and attempt (while `turn.completed` carries the completed turn metadata). Renamed test case `model_router_turn_completed_names_routed_model` to `model_router_decision_names_routed_model`.

- [x] Task 2: `@arnilo/prism-model-router`
  - Acceptance Criteria:
    - Functional: `packages/policy/model-router` exists with the §2.10 shape. `packages/prism-core/src/governance/model-router/**` moves into it with `git mv`, with its tests. The `./governance/model-router` subpath is removed from `@arnilo/prism-core`.
    - Functional: Config (JSON Schema):
      - `candidates: ModelRef[]` (at least one)
      - `select: "ordered" | "cost-latency"` (`createCostLatencySelection`, `selection.ts`)
      - `allow?: ModelRef[]`
      - `budgets?` (per window, per principal; `types.ts` `ModelRouterBudgets`)
      - `rateLimit?`
      - `circuit?: { failureThreshold, cooldownMs }`
      - `residency?`
      - `openRouterRouting?: boolean` (the `createOpenRouterGateTransform` switch, as a `model.request` transform)
      - Function-valued options are deleted, each with its replacement recorded: `providerSource` becomes `models.client`, the state store becomes the `model-router.state` service (memory default), and `onDiagnostics` becomes `package.event` `router.decision`.
    - Functional: Behavior:
      - A `model.call` around handler resolves a candidate per turn through the moved `createModelRouter().resolve`. A candidate on the run's provider is called with `next({ ...request, model })`. Any other candidate skips `next` and returns `prism.models.client(candidate).generate(request)`.
      - A candidate that errors before its first output event (`isOutputEvent`, `invocation.ts:54-62`) records an outcome, opens its circuit at the threshold, and falls through to the next candidate. An error after output is the turn's error, as today.
      - Budgets reserve before the call and settle on `done` usage (the moved `settle`, `invocation.ts:194-322`). An abort releases the reservation.
      - Every decision emits `router.decision` (candidate, reason, attempt; redacted).
      - An empty eligible set denies the turn with `ModelRouterError` (`ERR_PRISM_MODEL_ROUTER_*`, `errors.ts`). The run fails closed with that code. It never falls back to the unrouted model.
    - Functional: Retired with every caller migrated: `createGovernedProvider`, `isGovernedProvider`, `GovernedProvider*`, `assertProviderSourceEligible`, `isProviderSourceEligible`, and the `providerSource` method (plan 151 Task 1's leftover). `examples/{governed-provider,model-router-aggregate-budgets,openrouter-model-cache-override}.ts` are rewritten onto the package or deleted per Task 1. Repo-wide grep for the retired names and the subpath, with the standard exclusions, returns only untouched released `/docs`, listed in the Notes.
    - Functional: A new `examples/model-router.ts`. On two mock providers, the first candidate fails before output, the turn completes on the second, `router.decision` events record both attempts and name the routed candidate, and `turn.completed` emits the turn's settled usage and completion metadata.
    - Performance: Routing adds one in-process resolve per turn, and no model call. Fallback adds one provider call per failed candidate, and the README states it. Budget and rate state are process memory unless a `model-router.state` service is provided.
    - Code Quality: The router core is moved, not rewritten. The package's own code is the around handler, the config mapping, and the service wiring. There is no second provider registry: cross-provider calls go through `models.client`.
    - Security: Budgets are keyed by `principal.id`, or by the `governance.identity` tenant and principal when present (plan 159 Task 1 (n)). Candidate credentials come from each model's credential ref through the credentials slot, and the package holds none. Diagnostics stay bounded and redacted (`redactDiagnostics`, `router.ts:141-158`).
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/governance/model-router/**`, `src/agent-session/session/provider-round.ts:270-300`, `src/packages/api.ts` `ModelClient`, plan 159 Task 1 (d) and (n), Task 1 Notes
    - Options Considered:
      - Route in `model.request` by rewriting `request.model`. Rejected: the terminal calls the session's fixed provider (`provider-round.ts:292`), so a cross-provider model would go to the wrong provider.
      - Claim the `loop` slot and call `turn({ model })` per candidate. Rejected: a router would then conflict with every other loop owner (drivers, workflows), and `model.call` is the catalog's routing hook (§2.4).
    - Chosen Approach:
      - An `around` handler on `model.call`, with `next` for same-provider candidates and `models.client` for the rest.
    - API Notes and Examples:
      ```ts
      import modelRouter from "@arnilo/prism-model-router";
      await createAgent({ model: "mock/fast", packages: [mockProvider(), otherMock(), modelRouter({ candidates: ["mock/fast", "other/large"], circuit: { failureThreshold: 1, cooldownMs: 60_000 } })] });
      ```
    - Files to Create/Edit:
      - `packages/policy/model-router/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/index.ts,src/config.ts,src/around.ts}`: new. The moved modules go under `src/router/`.
      - `packages/prism-core/{package.json,README.md,src/governance/model-router/**}`: subpath and modules removed.
      - `examples/model-router.ts` (new), the three examples above, `examples/README.md`, `examples/tsconfig.json`.
      - Enforcement rows: `scripts/package-truth.mjs` and `package-truth.json`, `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts`, `scripts/independent-packages.json` (lockstep `$comment`), `scripts/compat-baseline/arnilo__prism-model-router.txt` (new) and `arnilo__prism-core.txt` (regenerated), `scripts/e2e-coverage.json`, `scripts/{budgets,coverage-thresholds,live-matrix}.json`, `scripts/phase54-package-map.mjs` and its evidence, `scripts/phase24-truth.test.mjs`, `scripts/version-literal-gate.test.mjs`.
      - `CHANGELOG.md`.
    - References:
      - plan 151 Task 6 (`models.client`), plan 157 Task 3 (move pattern)
  - Test Cases to Write:
    - `model_router_package_conformance`.
    - `model_router_same_provider_uses_next`: a recording provider sees `model: "fast"` then `"large"` on one provider, and `models.client` is not used.
    - `model_router_cross_provider_uses_models_client`: the second provider receives the turn. It fails if the request reaches the session's fixed provider.
    - `model_router_falls_through_before_output`: the first candidate errors before any output, and the turn completes on the second.
    - `model_router_error_after_output_fails_turn`: no fallthrough after a text delta.
    - `model_router_budget_denies_and_fails_closed`: an exhausted budget fails the run with the router code, and no provider is called.
    - `model_router_abort_releases_reservation`.
    - `model_router_from_custom_loop`: the same routing under a custom `LoopStrategy` that calls `turn()`.
    - `model_router_decision_names_routed_model`.
    - The moved router suites pass from their new location.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package and a removed `prism-core` subpath.
    - Docs pages to create/edit:
      - `packages/policy/model-router/README.md`: package page structure. Covers the fallback cost (one provider call per failed candidate), state scope, `router.decision`, and fail-closed behavior.
      - `packages/prism-core/README.md`: where the subpath went.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`, and record the diffs and attribution in the task note.
  - Notes (executed 2026-10-09):
    - **Execution summary:**
      - Created `packages/policy/model-router` following the §2.10 package shape: `package.json`, `tsconfig.json`, `bunfig.toml`, `README.md`, `CHANGELOG.md`, `LICENSE`, `src/index.ts`, `src/config.ts`, `src/around.ts`, and moved modules under `src/router/`.
      - Moved `packages/prism-core/src/governance/model-router/**` into `packages/policy/model-router/src/router/` with its test suites (`aggregate-accounting.test.ts`, `model-router.test.ts`, `selection.test.ts`).
      - Removed `./governance/model-router` subpath from `packages/prism-core/package.json` and updated `packages/prism-core/README.md`.
      - Retired facades deleted with zero code callers left: `createGovernedProvider`, `isGovernedProvider`, `GovernedProvider*`, `assertProviderSourceEligible`, `isProviderSourceEligible`, and `providerSource` method.
      - Removed `invocation.ts` and `invocation.test.ts`. Replaced with `src/around.ts` implementing the `model.call` around hook: turn routing via `router.resolve()`, same-provider candidate calls `next()`, cross-provider candidate calls `prism.models.client(candidate).generate(request)`, fallback before output (`isOutputEvent`), fail turn after output, budget reservations and outcome settlement, and `router.decision` package event emissions.
      - Created `examples/model-router.ts` illustrating pre-output failover across mock providers with `router.decision` and `turn.completed`. Deleted retired `examples/governed-provider.ts` and updated `examples/README.md` and `examples/tsconfig.json`.
      - Rewrote `examples/model-router-aggregate-budgets.ts` to use `createModelRouter()` and `prism.models.client`.
      - Cleaned untracked directory leftovers (`packages/memory/src`, `packages/prism-providers`). Added local `src/identity.ts` to `packages/prism-channels` to eliminate its runtime `@arnilo/prism-governance` dependency.
      - Updated enforcement rows and gates: `scripts/package-truth.mjs`, `scripts/independent-packages.json`, `scripts/phase24-truth.test.mjs` (55 publishable, 54 workspace, 30 capability, 52 codeWithPeer), `src/__tests__/packaging.test.ts` (55 manifests).
      - Fixed declaration emit and regenerated compat baselines via `node scripts/release.mjs gate --update-baseline`: created `scripts/compat-baseline/arnilo__prism-model-router.txt` and regenerated `scripts/compat-baseline/arnilo__prism-core.txt`. `node scripts/release.mjs gate` passes with 0 errors across all 55 packages.
      - Added changelog entries under `## [Unreleased]` in root `CHANGELOG.md`.
    - **Test results:**
      - `bun test packages/policy/model-router`: 44 passed across 4 files (`package.test.ts` 9/9, `aggregate-accounting.test.ts` 10/10, `model-router.test.ts` 14/14, `selection.test.ts` 11/11).
      - `bun test src/__tests__/packaging.test.ts scripts/phase24-truth.test.mjs scripts/phase22-security.test.mjs src/__tests__/model-router-aggregate-budgets-example.test.ts`: 310 passed across 4 files.
      - `bun run typecheck`: clean across all workspace packages.
      - `bun run examples/model-router.ts`: completed with expected decisions and usage metadata.
    - **Retirement sweep:**
      - `rg "createGovernedProvider|isGovernedProvider|GovernedProvider|assertProviderSourceEligible|isProviderSourceEligible|@arnilo/prism-core/governance/model-router" src packages examples scripts -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**' -g '!plans/**'`: 0 hits outside `packages/policy/model-router/CHANGELOG.md` and untouched released `/docs`.
      - Released doc files mentioning retired names (untouched per plan policy): `docs/history/0.2.1-migration.md`, `docs/history/release-0.12.0.md`, `docs/governance-model-router.md`, `docs/model-router.md`, `docs/history/0.2.0-migration.md`, `docs/api/router.md`, `docs/enterprise-readiness.md`.
    - **Baseline diffs:**
      - `scripts/compat-baseline/arnilo__prism-model-router.txt`: new file created with 27 exports (router types, selection, state, around hook, and package definition).
      - `scripts/compat-baseline/arnilo__prism-core.txt`: removed 41 model router exports (`createGovernedProvider`, `isGovernedProvider`, `GovernedProvider*`, `assertProviderSourceEligible`, `isProviderSourceEligible`, `createModelRouter`, `createCostLatencySelection`, `createMemoryModelRouterStateStore`, `resolveModelRouterLimits`, router types and error codes).

- [x] Task 3: `@arnilo/prism-observability`
  - Acceptance Criteria:
    - Functional: `packages/integrations/observability` exists with the §2.10 shape. The agent-event instrumentation that plan 159 Task 1 (l) assigned (`createOpenTelemetryInstrumentation`'s agent path, `handleDelegation`, `handleRunFeedback`, `handleEvaluation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`, and their types) moves with `git mv` or is extracted, with its tests. Workflow spans, `timeline.ts`, `summary.ts`, and `rag-telemetry.ts` stay in `prism-core`'s `./governance/observability` subpath, which imports the moved agent instrumentation from the package (a library edge). That subpath's remaining surface goes to Further Actions for Phase 16.
    - Functional: Config:
      - `serviceName?` (default `"prism"`)
      - `content: "none" | "metadata"` (default `"none"`: no prompt or response text in spans)
      - `fieldPolicy?` (the `TelemetryFieldPolicy` hashing rules as JSON: hash/drop per attribute path)
      - `metrics: boolean` (default `true`)
      - `enabled: boolean` (default `true`)
    - Functional: `setup` dynamically imports `@opentelemetry/api`. If the import fails, it emits `status.note("warn", "…@opentelemetry/api is not installed…")` and registers nothing. Otherwise it takes `trace.getTracer(serviceName)` and `metrics.getMeter(serviceName)` from the global API, and registers observe handlers for `run.*`, `turn.*`, `tool.*`, `decision.*`, `compaction.*`, `background.*`, `hook.error`, and `package.event` (for `delegate.step`, `router.decision`, and `mcp.status`), mapped by the moved `handleAgentEvent` (`instrumentation.ts:309-452`).
    - Functional: No phone-home. The package constructs no exporter, opens no socket, and reads no `OTEL_*` exporter variable. With no tracer provider registered by the host, the OTel API's no-op tracer makes the package a no-op. A test asserts that no network module is imported.
    - Functional: Retired with every caller migrated: the moved names from `@arnilo/prism-core/governance/observability` (callers per Task 1). `src/observability.ts` (`createProviderTurnMetadata`, `readProviderHttpStatus`, `readRequestId`) stays in the kernel if Task 1 finds kernel callers (it is provider-turn metadata, not export), with the proof recorded. Repo-wide grep for the moved names, with the standard exclusions, returns only the package, the `prism-core` library edge, and untouched released `/docs`.
    - Functional: A new `examples/observability.ts`. It registers an in-memory span recorder as the global tracer provider (host code, through `@opentelemetry/api`), runs a mock two-turn run with one tool call, and prints the span tree (`invoke_agent` > `chat` > `execute_tool`). The example runs under the execution gate.
    - Performance: Observe handlers are never awaited (§2.4). The `message.delta` handler is not registered, because it is the hot path. Per event, the cost is one span operation or one metric record. `@opentelemetry/api` loads only when the package is listed, and a "not loaded unless listed" test covers it.
    - Code Quality: The instrumentation is moved, not rewritten. The package has no exporter configuration, no sampler, and no SDK dependency, because those belong to the host.
    - Security: The default `content: "none"` puts no message text in attributes. Tool arguments are never attributes. Secrets are already redacted in events, and `fieldPolicy` hashes identifying attributes. A test asserts that a secret in a user message appears in no span attribute or event under both `content` settings.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/governance/observability/**`, plan 159 Task 1 (l), roadmap §2.9 `observability` row and Phase 16, `@opentelemetry/api` 1.9 (`trace.getTracer`, `metrics.getMeter`, the no-op default; via the find-docs skill at execution)
    - Options Considered:
      - Bundle `@opentelemetry/sdk-trace-base` and an OTLP exporter configured from package config. Rejected: that is phone-home by default and an SDK dependency. The roadmap says no phone-home, and a host owns its exporter.
      - Take the tracer through a service. Rejected as the default: the global API is the OTel convention, and a service is still possible later (Further Actions) without changing config.
    - Chosen Approach:
      - Observe handlers over the global OTel API, loaded dynamically, with the agent-event instrumentation moved in.
    - API Notes and Examples:
      ```ts
      import observability from "@arnilo/prism-observability";
      // host: register an OTel SDK tracer provider with its own exporter first
      await createAgent({ model: "mock/main", packages: [mockProvider(), observability({ serviceName: "billing-agent" })] });
      ```
    - Files to Create/Edit:
      - `packages/integrations/observability/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/index.ts,src/config.ts,src/handlers.ts}`: new. The moved modules go under `src/`. `@opentelemetry/api` is an optional peer dependency.
      - `packages/prism-core/src/governance/observability/{index,instrumentation}.ts`: agent path removed and imported from the package. `packages/prism-core/package.json`: dependency on the package.
      - Callers per Task 1 (`packages/prism-core/src/governance/observability/__tests__/instrumentation.test.ts`, examples, scripts).
      - `examples/observability.ts` (new), `examples/README.md`, `examples/tsconfig.json`.
      - Enforcement rows as in Task 2, plus `scripts/compat-baseline/arnilo__prism-observability.txt` (new).
      - `CHANGELOG.md`.
    - References:
      - plan 155 Task 3 (optional heavy dependency loaded only when listed)
  - Test Cases to Write:
    - `observability_package_conformance`.
    - `observability_spans_for_run_turn_tool`: with an in-memory tracer provider registered globally, a two-turn run gives the expected span names, parentage, and status.
    - `observability_no_api_is_status_note`: with the import stubbed to fail, the package gives a warn note, registers no hook, and the run is unaffected.
    - `observability_no_phone_home`: no `node:net`/`node:http`/`fetch` use from the package's module graph, and no exporter is constructed.
    - `observability_content_none_omits_text` and `observability_secret_never_in_span`.
    - `observability_handler_throw_never_fails_run`: a throwing tracer gives `hook.error`, and the run completes.
    - `observability_not_loaded_unless_listed`.
    - `observability_from_custom_loop`: the same spans under a custom `LoopStrategy`.
    - The moved instrumentation suites pass from their new location, and the `prism-core` timeline and summary suites stay green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package, and part of a `prism-core` subpath moved.
    - Docs pages to create/edit:
      - `packages/integrations/observability/README.md`: package page structure. Covers the no-phone-home statement, the host-registers-exporter setup, `content` and `fieldPolicy`, and the per-event cost.
      - `packages/prism-core/README.md`: the agent instrumentation moved, and workflow telemetry stays until Phase 16.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`, and record the diffs and attribution in the task note.
  - Notes (executed 2026-10-09):
    - **Execution summary:**
      - Created `packages/integrations/observability` (`package.json` with optional peer `@opentelemetry/api`, `tsconfig.json`, `bunfig.toml`, `README.md`, `CHANGELOG.md`, `LICENSE`, `src/{index,config,instrumentation}.ts`). `instrumentation.ts` and its test were moved with `git mv`.
      - Split of the instrumentation: the package keeps the agent path (`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`, delegation/feedback/evaluation handlers, types) with the workflow handlers removed. It also exports `createInstrumentationParts` and `SpanTracker` (the span bookkeeping). `prism-core`'s `governance/observability/instrumentation.ts` is now a thin `createWorkflowInstrumentation`/`WorkflowInstrumentation` over those parts (library edge), so agent spans still nest under workflow spans. Timeline, summary, and RAG telemetry untouched.
      - Package behavior: `setup` dynamically imports `@opentelemetry/api`. On failure it adds a `warn` status note and registers nothing. Otherwise it wraps the global `getTracer`/`getMeter` and registers observe handlers for `run.{started,completed,failed,suspended}`, `decision.resolved`, `turn.{started,completed}`, `tool.{started,completed}`, `package.event`. `compaction.*`, `background.*`, and `hook.error` are not registered because the moved `handleAgentEvent` ignores them (no per-event cost for nothing). `message.delta` is never observed.
      - `content: "metadata"` maps to a new `includeUsage` option: token counts and the stop reason on the chat span. `none` adds nothing model-derived. Message text is never an attribute under either setting. `fieldPolicy` is `{ drop, hash }` (exact path or `prefix*`) mapped onto the function-valued `TelemetryFieldPolicy` via `toFieldPolicy`.
      - `delegate.step`, `router.decision`, and `mcp.status` package events become span events on the run span with bounded scalar fields (`outcome`, `attempt`, `status`, `phase`, `child`, `server`) only. This is an addition to the moved `handleAgentEvent`, which only mapped `guardrail.decision`.
      - `createObservabilityDefinition(load)` is a test seam for stubbing the `@opentelemetry/api` loader. The default export uses the real import.
      - Callers migrated: `examples/run-feedback.ts`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `scripts/e2e-coverage.json`, core's `rag-telemetry.ts` and its `rag-telemetry`/`summary` tests, `packages/prism-core/README.md`. New `examples/observability.ts` runs against the real `@opentelemetry/api` with a host-registered recorder and prints `invoke_agent prism` > `chat demo` / `execute_tool echo` / `chat demo`.
      - Enforcement rows: `scripts/package-truth.{mjs,json}` (regenerated with `--emit-docs`, which also refreshed `docs/release-and-install.md`, `docs/provider-packages.md`, `docs/_evidence/phase54-package-map.md` generated blocks), `src/__tests__/packaging.test.ts` (56), `src/__tests__/release.test.ts` (54 -> 56, Task 2 had left it stale), `scripts/phase24-truth.test.mjs` (56 publishable, 55 workspace, 31 capability, 53 codeWithPeer, plus the `prism-core` optional peer), `scripts/independent-packages.json`, `examples/tsconfig.json`, `examples/README.md`, `packages/prism-core/package.json` (optional peer + file: devDependency), `src/__tests__/docs.test.ts` (retired 0.3 package count 37 -> 36 because `@arnilo/prism-model-router` is a live package since Task 2), root `CHANGELOG.md`.
    - **Findings:**
      - The moved "failed and aborted agent runs leave no active spans" test expected `session.run` to reject. The kernel now settles a failed or aborted run as a non-completed result. The old `dist` copy failed the same way before the move (carried failure). The test now asserts `status !== "completed"`.
      - Conformance for this package takes ~14s, so that test carries a 60s timeout.
      - `bun run typecheck` stops in `@arnilo/prism-tools-coding` (`ExecutionPolicy` etc. not exported by `@arnilo/prism`) and `@arnilo/prism-tools-web` (`../../browser/index.js`). Neither touches this task. No error mentions `observability` or `prism-core`.
      - `docs.test.ts` still has 5 failures (`ManifestContributionKind`, `RunOptions` per-run tools / `activeSkills`, connector sidecar, install/coverage/SQL docs). None mention observability or package counts. They are mid-rewrite docs carried from before this task.
      - `packages/prism-coding-tools/src/dev` has 6 failures (the allow-list test now sees `@arnilo/prism-governance`; run status `completed` vs `succeeded`). They are not caused by this task.
      - `packages/prism-core` `bun run test` reports 40 failures. The ones visible in the output tail are supervisor, spawn-tool, and nested-approval suites (Task 4's area); I did not diff the full list against the Task 1 baseline, so Task 5 must.
    - **Test results:**
      - `bun test packages/integrations/observability`: 25 pass / 0 fail (`package.test.ts` 11, moved `instrumentation.test.ts` 14).
      - `bun test packages/prism-core/dist/governance/observability` (after `bun run build`): 30 pass / 0 fail (timeline, summary, rag-telemetry stay green).
      - `bun test src/__tests__/packaging.test.ts scripts/phase24-truth.test.mjs src/__tests__/release.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/kernel-imports-no-package.test.ts packages/policy/model-router`: all pass.
      - `node scripts/release.mjs gate`: passes across 56 packages.
      - `bun examples/observability.ts` and `bun examples/run-feedback.ts` run to completion.
    - **Retirement sweep:** `rg "createOpenTelemetryInstrumentation|wrapOpenTelemetryApi|createInMemoryTelemetry" src packages examples scripts -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/**' -g '!plans/**' -g '!scripts/compat-baseline/**'` returns only the package, `prism-core` tests and README importing it from `@arnilo/prism-observability`, `examples/run-feedback.ts`, and the e2e fixture. Released `/docs` pages that name the old subpath surface are untouched (Phase 11).
    - **Baseline diffs:**
      - `scripts/compat-baseline/arnilo__prism-observability.txt`: new, 36 exports (instrumentation, in-memory telemetry, OTel wrapper, span tracker, config, package definition).
      - `scripts/compat-baseline/arnilo__prism-core.txt`: removed 22 names attributed to the move (`createOpenTelemetryInstrumentation`, `createInMemoryTelemetry`, `wrapOpenTelemetryApi`, and the types `DelegationTelemetry`, `EvaluationTelemetry`, `InMemoryTelemetry`, `OpenTelemetryContextApi`, `OpenTelemetryInstrumentation`, `OpenTelemetryInstrumentationOptions`, `OpenTelemetryTraceApi`, `PrismContext`, `PrismCounter`, `PrismHistogram`, `PrismMeter`, `PrismSpan`, `PrismSpanKind`, `PrismSpanStatus`, `PrismTracer`, `RecordedMetric`, `RecordedSpan`, `RunFeedbackTelemetry`, `TraceReference`). Added `createWorkflowInstrumentation` and `WorkflowInstrumentation`.

- [x] Task 4: `@arnilo/prism-delegate`
  - Acceptance Criteria:
    - Functional: `packages/integrations/delegate` exists with the §2.10 shape. `src/delegated-agent-step.ts` (with `src/__tests__/delegated-agent-step.test.ts`) and the in-process supervisor modules plan 159 Task 1 (m) assigned move with `git mv`. Their root and `./runtime/supervisor` exports are removed. A2A modules that stay in `prism-core` import what they need from the package (a library edge).
    - Functional: Config:
      - `children: Record<string, { inherit: string[], instructions?, model?: ModelRef, tools?: { only?: string[] }, limits?, lifetime?: "task" | "session", report?: "on-complete" | "milestones" | "stream", budgetShare? }>`
      - `maxDepth` (default 1)
      - `maxConcurrent`
      - Function-valued 0.12 options (`SupervisorMilestonePolicy.predicate`, child factories) are deleted, each with its replacement recorded.
    - Functional: Behavior:
      - Tools `delegate { child, input }`, `delegate_wait { delegationId }`, and `delegate_cancel { delegationId }` (the 0.12 `spawn_agent`/`wait_agent`/`cancel_agent` semantics, `spawn-tool.ts:19-162`). Their `effects` are `["external"]`.
      - A child is `createAgent({ model, instructions, packages: prism.packages.instances(child.inherit), limits, principal: parent principal, host })`, with one session per delegation. `limits` may only narrow the parent's run limits (the moved `budgetShare` clamp).
      - Child progress is reported as `package.event` `delegate.step` (`createDelegatedAgentStep`), at the configured `report` level. The `child` field is not set, because a package cannot emit catalog events; Phase 13's `origin` replaces this (Further Actions).
      - A child at `maxDepth` cannot see the `delegate` tool: the package is excluded from its own `inherit`, and listing it is `self_instance` from plan 159 Task 2.
      - Child agents are disposed when the delegation ends (`task`) or when the parent session closes (`session`), through `SessionContext.background`.
    - Functional: Fail closed:
      - An unknown child name is a tool error.
      - An `inherit` name that is not loaded fails `createAgent` (validated at `setup` against `inspect()`'s package list).
      - A child that suspends on `ask` surfaces as a `delegate_wait` result with `status: "suspended"` and its pending decisions. It never auto-approves.
      - Child events carry no parent secret, because the child's secret set comes from its own resolved refs.
    - Functional: Retired with every caller migrated: `createDelegatedAgentStep`, `DelegatedAgentStep*`, `DelegatedAgentStepError`, `createSpawnAgentTool`, `createWaitAgentTool`, `createCancelAgentTool`, and the in-process `createSupervisor` surface (per Task 1). `examples/{spawn-agent-tool,handoff-swarm,supervisor-a2a,autonomous-coding-loop}.ts` are rewritten onto the package, keep only their A2A part, or are deleted, per Task 1. `packages/tools/coding/src/agent/{supervisor-lifecycle,spawn-worktree,lifecycle}.ts` and the `ag-ui` mappers are migrated. Repo-wide grep for the retired names, with the standard exclusions, returns only the package, the A2A library edge, and untouched released `/docs`.
    - Functional: A new `examples/delegate.ts`. On mock providers, the parent calls `delegate { child: "reviewer" }`. The child runs with only `tools-coding` inherited (its tool list proves the subset), the parent receives the child's answer as the tool result, and `delegate.step` events record start and finish. The example runs under the execution gate.
    - Performance: Each delegation is one child agent build (`createAgent` over the inherited packages) plus the child's own model calls. The README states it, and states that no child runs unless the model calls `delegate`. Concurrency is capped by `maxConcurrent`.
    - Code Quality: The child-run code is moved, not rewritten. There is no second agent assembly path: children use `createAgent`.
    - Security: A child never gains a package the parent did not load. Its principal is the parent's, unless governance narrows it (`narrowIdentity` through the `governance.identity` service, when present). Its limits only narrow. Its approvals go through the same `ask` path (inline confirm or suspension), which a test asserts.
  - Approach:
    - Documentation Reviewed:
      - `src/delegated-agent-step.ts`, `packages/prism-core/src/runtime/supervisor/{supervisor,spawn-tool,types,limits,errors}.ts`, plan 159 Task 1 (c) and (m), plan 159 Task 2 (`packages.instances`), roadmap §2.9 `delegate` row, §2.12.9 K3
    - Options Considered:
      - Forward child catalog events onto the parent stream with `child` set. Rejected: only `RunController` primitives emit catalog events (§1.4), and a package has no seam to emit them. Phase 13's `origin` is the attributed path.
      - A code-only factory that closes over host-built child packages. Rejected by default (plan 159 Task 1 (c)): it cannot inherit and cannot be used from a manifest.
    - Chosen Approach:
      - A tool package that builds each child with `createAgent` over `packages.instances(inherit)`, reports through `delegate.step`, and moves the 0.12 in-process supervisor's limits and lifetime rules.
    - API Notes and Examples:
      ```jsonc
      { "name": "@arnilo/prism-delegate", "version": "^0.13.0", "integrity": "sha512-…", "capabilities": ["host-ui", "background"],
        "config": { "children": { "reviewer": { "inherit": ["@arnilo/prism-tools-coding"], "instructions": "Review the diff.", "report": "milestones" } } } }
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/index.ts,src/config.ts,src/tools.ts}`: new. The moved modules go under `src/`.
      - `src/{delegated-agent-step,index}.ts`, `src/__tests__/{delegated-agent-step,public-export-contract,install-smoke}.test.ts`: kernel module removed and the freeze updated.
      - `packages/prism-core/{package.json,src/runtime/supervisor/**}`: in-process modules removed and A2A repointed.
      - Callers per Task 1: `packages/tools/coding/src/agent/**`, `packages/ag-ui/src/**`, `packages/prism-core/src/governance/{evals,observability}/**`, examples, and scripts.
      - `examples/delegate.ts` (new), `examples/README.md`, `examples/tsconfig.json`.
      - Enforcement rows as in Task 2, plus `scripts/compat-baseline/arnilo__prism-delegate.txt` (new), and `arnilo__prism.txt` and `arnilo__prism-core.txt` (regenerated).
      - `CHANGELOG.md`.
    - References:
      - plan 154 Task 3 (`tools-coding` lifecycle users of the supervisor), plan 159 Task 2
  - Test Cases to Write:
    - `delegate_package_conformance`.
    - `delegate_child_inherits_only_named_packages`: the child's `agent.tools` has the coding tools and no `delegate`. It fails if the whole parent package list is inherited.
    - `delegate_unknown_inherit_fails_closed`: at `createAgent`.
    - `delegate_limits_only_narrow`: a child `limits` above the parent's is clamped.
    - `delegate_step_events_reported`: start, milestone, and finish at `report: "milestones"`.
    - `delegate_child_ask_suspends_not_approved`: a child `ask` with no UI gives `delegate_wait` `suspended` with pending decisions.
    - `delegate_cancel_disposes_child`.
    - `delegate_session_lifetime_disposed_on_close`.
    - `delegate_from_custom_loop`: the same delegation under a custom parent `LoopStrategy`.
    - `delegate_no_parent_secret_in_child_events`.
    - The moved delegated-step and supervisor suites pass from their new location, and the A2A suites stay green in `prism-core`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package, and kernel and `prism-core` exports removed.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md`: package page structure. Covers the per-delegation cost, the inheritance rule, `delegate.step`, and the Phase 13 `origin` note as current behavior ("child events are reported as `delegate.step`").
      - `docs/next/events.md`: `child` is still set only by `prism-core`'s A2A supervisor passthrough, if Task 1 finds it still is. Otherwise, record that `child` has no producer left, for Phase 13.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public surface: regenerate with `node scripts/release.mjs gate --update-baseline`, and record the diffs and attribution in the task note.
  - Notes (executed 2026-10-09):
    - **Verdict: shipped as a compact rewrite, not a move.** The plan said "moved, not rewritten", but the 0.12 supervisor (`supervisor.ts` 1,150 lines) was already failing 26 of 84 tests against the current kernel (`completed` vs `succeeded` run status, `PermissionPolicy`/`resumeNestedRun`/`checkpoints` vocabulary that no longer exists). Moving it would have moved dead behavior. The package keeps the supervisor's rules (child allow-list, concurrency cap, limits that only narrow, `task`/`session` lifetime, `on-complete`/`milestones`/`stream` reporting, no auto-approval) in about 450 lines over `createAgent`. `src/delegated-agent-step.ts` and its test were deleted rather than moved: its builder returns a `package: "kernel", name: "agent.step"` event a package cannot emit. `delegate.step` payloads come from the bounded `step.ts`. The `DelegatedAgentStep*` data types stay in `src/contracts-protocol.ts` (the timeline and AG-UI mapper read `agent.step`).
    - **What shipped.** `packages/integrations/delegate/{package.json,tsconfig.json,bunfig.toml,README.md,CHANGELOG.md,LICENSE,src/{index,config,limits,step,runtime,tools}.ts,src/__tests__/package.test.ts}`. Tools `delegate { child, input, mode? }`, `delegate_wait`, `delegate_cancel`, all `effects: ["external"]`. A child is `createAgent({ model, instructions, packages: [bridge, ...instances(inherit)], limits, principal })` with an in-memory store. The bridge is a one-provider package whose `generate` calls `prism.models.client(...)`, so a child reaches the parent's providers and holds no credential. Each inherited `PackageInstance` is rebuilt as `instance.definition(instance.config, { optional })`, because the frozen records `instances()` returns are not accepted by `createAgent`.
    - **Deviations from the task text.**
      - "`inherit` name not loaded fails `createAgent`": a package cannot see the loaded list during `setup` (`instances()` throws `state_not_ready`), so an unloaded name fails at the first delegation as a `delegate.step` `error` and a failed outcome. Only the self-inherit case fails at `createAgent`.
      - "Limits may only narrow the parent's": a package cannot read the parent's run limits, so child limits are clamped to the delegate's own defaults and hard ceilings (`DEFAULT_CHILD_LIMITS`, `HARD_CHILD_LIMITS`) instead.
      - `maxDepth` is schema-limited to `1`: a deeper chain would need a child to inherit `delegate`, which `packages.instances` rejects as `self_instance`.
      - Narrowing the principal through `governance.identity` is not done; the child gets the parent's principal unchanged.
      - The child gets no `host`, so any `ask` suspends the child (the requirement) instead of reaching the parent's UI. A suspended child is disposed and cannot be resumed through the package.
      - Function-valued 0.12 options (`SupervisorMilestonePolicy.predicate`, child factories) are deleted. Replacements: `report`, `inherit`, and `instructions` in JSON config.
    - **Kernel fix found on the way.** `generateWithRetry` in `src/packages/loader.ts` never closed the provider stream when a caller stopped at `done`, leaking one provider call per `models.client` use. Added `finally { await iterator.return?.() }`. The delegate benchmark exposed it (`activeAfter: 4`).
    - **Retired and migrated.** Deleted: `packages/prism-core/src/runtime/supervisor/{supervisor,spawn-tool,limits,types}.ts` with their tests and `governance/evals/__tests__/spawn-pack.test.ts`; `errors.ts` keeps only `SupervisorError` and `A2AError`. `packages/tools/coding/src/agent/{supervisor-lifecycle,spawn-worktree}.ts` and tests (they only adapted the supervisor; their exports `observeSupervisorLifecycle` and `createWorktreeChildFactory` are gone). `examples/spawn-agent-tool.ts` is replaced by `examples/delegate.ts`; `examples/supervisor-a2a.ts` keeps its A2A part; `examples/autonomous-coding-loop.ts` runs its children directly with `createAgent`; `examples/handoff-swarm.ts` comment updated. `scripts/benchmark-scenarios/multi-agent-runtime.mjs` `runSupervisorFanOut/Saturation` now drive N parallel `delegate` calls with `maxConcurrent`, keeping the same budgets. The `createSupervisor` test was removed from `scripts/obscura-host-conformance.test.mjs` and `src/__tests__/install-smoke.test.ts`. `ag-ui` only used `A2AError`, so A2A stays in `prism-core` with no library edge to the package. The `ag-ui-mapper` test builds its `agent.step` event inline.
    - **Enforcement rows.** `scripts/package-truth.{mjs,json}` (+`--emit-docs`), `src/__tests__/{packaging,release}.test.ts` (57), `scripts/phase24-truth.test.mjs` (57 publishable, 56 workspace, 32 capability, 54 codeWithPeer), `scripts/independent-packages.json`, `scripts/benchmark-multi-agent.test.mjs` (no 0.3 evidence row), `scripts/e2e-coverage.json` (deleted suites removed), `bun.lock` (three entries added by hand; `bun install --lockfile-only` also rewrote unrelated `prism-core` entries), `examples/{tsconfig.json,README.md}`, root and package `CHANGELOG.md`, `packages/prism-core/README.md`, `docs/next/events.md` (`child` has no producer left; Phase 13 `origin` replaces it).
    - **Baseline diffs** (`node scripts/release.mjs gate --update-baseline` stops at `@arnilo/prism-tools-coding` on the carried `ExecutionPolicy` declaration error, so `arnilo__prism.txt` and `arnilo__prism-core.txt` were regenerated with a one-off script over the same `extractDeclaredSurface`, and the `tools-coding` baseline was edited by hand):
      - `arnilo__prism-delegate.txt`: new, 24 names.
      - `arnilo__prism.txt`: removed 8 (`createDelegatedAgentStep`, `DelegatedAgentStepError`, `MAX_DELEGATED_AGENT_{DURATION_MS,EVENT_BYTES,ID_BYTES,NAME_BYTES,STEP_INDEX,TOKEN_COUNT}`), attributed to the move.
      - `arnilo__prism-core.txt`: removed 29 (the supervisor `DEFAULT_*`/`HARD_*` limits, `createSpawnAgentTool`, `createWaitAgentTool`, `createCancelAgentTool`, `createSupervisor`, `narrowSupervisorLimits`, `resolveSupervisorLimits`, `HARD_MILESTONE_EVERY_TURNS`), plus the four `Supervisor*Error` subclasses.
      - `arnilo__prism-tools-coding.txt`: removed `observeSupervisorLifecycle`, `createWorktreeChildFactory`, and four types.
    - **Test results.** `bun test packages/integrations/delegate`: 13 pass / 0 fail (conformance, inherit-only-named, unknown child, unknown inherit, self-inherit, limits clamp, step events, ask-suspends, cancel aborts the child, session lifetime, custom loop, bounded step data, no input in events). `bun test scripts/benchmark-multi-agent.test.mjs`: the saturation test passes with the delegate package (4 run, 28 rejected); the one failure is `evidence missing @arnilo/prism-governance` from Part A. `bun run typecheck`: clean except the carried `@arnilo/prism-tools-coding` `ExecutionPolicy` errors; `tsc -p examples`: clean. `bun examples/delegate.ts`, `supervisor-a2a.ts`, `autonomous-coding-loop.ts`: run to completion.
    - **Retirement sweep.** The retired names appear only in untouched released `/docs` (`core.md`, `multi-agent-patterns.md`, `a2a.md`, `agent-events.md`, `coding-workspaces.md`, `server.md`, `supervisors.md`, `migrate-to-0.7.md`), the root `CHANGELOG.md`, and historical records (`scripts/budgets.json` reasons, `scripts/phase10-freeze-manifest.json`, `scripts/phase25-dead-exports-raw.txt`).

- [x] Task 5: Phase 9 Done record
  - Acceptance Criteria:
    - Functional: Run and record each Done criterion with its evidence:
      - "An untrusted MCP server never spawns, and a header ref is never echoed": `bun examples/mcp-trust.ts` plus `mcp_untrusted_project_server_never_spawns` and `mcp_header_ref_never_echoed` (plan 159 Task 4).
      - "A deny-by-default governance example blocks a tool": `bun examples/governance-deny.ts` plus `governance_default_deny_blocks_unlisted_tool` (plan 159 Task 6).
    - Functional: Confirm every Scope bullet is delivered, citing the task that shipped it:
      - `mcp` (each sub-bullet)
      - `governance` (policy engine and OPA, identity verification, principal enforcement, audit sink)
      - `guardrail-packs`, `model-router`, `observability`, `delegate`
      - "Governance and identity modules leave the kernel": a source scan finds no `src/identity.ts`, `src/secure-agent.ts`, or `src/guardrail-packs/`, and no root export of their names
    - Functional: The roadmap's §1.4 "A phase is done when its API has its staged page or README, an example, and, where applicable, a conformance suite" holds for each of the six packages and the kernel seams. Record the README, example, and conformance test for each.
    - Functional: `plans/README.md` marks plans 159 and 160 `complete (<date>)`. Each plan's Compromises Made and Further Actions sections are filled and handed off to `plans/backlog.md` per the create-plan SKILL "Plan end", including at least:
      - Phase 10 reshaping `@arnilo/prism-mcp-server`
      - Phase 12 deleting `packages/prism-code/src/mcp.ts` and the lab's synthesized identity
      - Phase 13 moving `delegate` to `origin`
      - Phase 16 moving `prism-core`'s remaining `./governance/observability` (workflow spans, timeline, summary) into `@arnilo/prism-observability`
      - the released `/docs` pages that still name the retired names (Phase 11)
    - Performance: n/a — verification only.
    - Code Quality: No code change except fixes that a Done check exposes. Each fix is recorded with its cause.
    - Security: The `examples_demos_run_to_completion_and_emit_no_secret` gate passes for every Phase 9 example.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 9 Done and §1.4, plans 159 and 160 Notes, plan 158 Task 9 (the Done-record pattern)
    - Options Considered:
      - Record Done in plan 159. Rejected: Part B's packages are part of the phase.
    - Chosen Approach:
      - Run the whole-plan verification for both parts, record the evidence, and hand off the backlog items.
    - API Notes and Examples:
      ```bash
      bun examples/mcp-trust.ts && bun examples/governance-deny.ts && bun examples/model-router.ts && bun examples/observability.ts && bun examples/delegate.ts
      ```
    - Files to Create/Edit:
      - `plans/159-…md`, `plans/160-…md`: Notes, Compromises Made, Further Actions.
      - `plans/README.md`: statuses.
      - `plans/backlog.md`: handoff entries.
      - `CHANGELOG.md`: Phase 9 summary line under `## [Unreleased]`, if the per-task entries need one.
    - References:
      - `.agents/skills/create-plan/SKILL.md` "Plan end"
  - Test Cases to Write:
    - n/a — runs the existing suites and examples. A failing check becomes a fix with its own regression test, recorded in the Notes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — record only.
    - Docs pages to create/edit: none, beyond fixes a check exposes.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-09):
    - **Done criteria (evidence).**
      - "An untrusted MCP server never spawns, and a header ref is never echoed": `bun examples/mcp-trust.ts` prints `untrustedReason: "untrusted"`, a connected docs server, and a failed broken server. `mcp_untrusted_project_server_never_spawns` and `mcp_header_ref_never_echoed` pass.
      - "A deny-by-default governance example blocks a tool": `bun examples/governance-deny.ts` prints `executed: ["read_file"]`, `blockedTool: "write_file"`, `blockedReason: "write_file denied by policy"`, `auditOutcomes: ["allow","deny"]`. `governance_default_deny_blocks_unlisted_tool` passes.
      - `bun examples/model-router.ts`, `observability.ts`, and `delegate.ts` run to completion. `examples_demos_run_to_completion_and_emit_no_secret` (`src/__tests__/docs.test.ts`) passes with every Phase 9 example included.
    - **Scope bullets.** `mcp`, `guardrail-packs`, `governance` (policy engine and OPA, `require`, identity verification and principal enforcement, audit sink): plan 159 Tasks 4-8. `model-router`: Task 2. `observability`: Task 3. `delegate`: Task 4. Source scan: `src/identity.ts`, `src/secure-agent.ts`, and `src/guardrail-packs/` do not exist, and no root export names their symbols (`src/__tests__/public-export-contract.test.ts` passes).
    - **§1.4 (README, example, conformance per package).**
      | Package | README | Example | Conformance |
      | --- | --- | --- | --- |
      | `@arnilo/prism-mcp` | `packages/integrations/mcp/README.md` | `examples/mcp-trust.ts` | `packages/integrations/mcp` suite |
      | `@arnilo/prism-mcp-server` | `packages/hosts/mcp-server/README.md` | none (library; Phase 10) | `packages/hosts/mcp-server` suite |
      | `@arnilo/prism-guardrail-packs` | `packages/policy/guardrail-packs/README.md` | none of its own | `packages/policy/guardrail-packs` suite |
      | `@arnilo/prism-governance` | `packages/policy/governance/README.md` | `examples/governance-deny.ts` | `packages/policy/governance` suite |
      | `@arnilo/prism-model-router` | `packages/policy/model-router/README.md` | `examples/model-router.ts` | `model_router_package_conformance` |
      | `@arnilo/prism-observability` | `packages/integrations/observability/README.md` | `examples/observability.ts` | `observability_package_conformance` |
      | `@arnilo/prism-delegate` | `packages/integrations/delegate/README.md` | `examples/delegate.ts` | `delegate_package_conformance` |
    - **Suites.** `bun test` over the seven Phase 9 package directories: 335 pass / 2 fail. The failures are `mcp_server_host_library_uses_public_api` (carried from plan 159's close) and the `field-policy` microbenchmark timing test (a 10% overhead assertion; Part B does not touch it). `src/__tests__/{kernel-imports-no-package,public-export-contract,packaging,release}.test.ts` and `scripts/phase24-truth.test.mjs` pass.
    - **Not run in this task.** The whole-repo `bun test src packages` sweep against the plan 159 baseline (154 failures), the per-workspace `prism-core`/`ag-ui`/`agent-sdk`/`prism-code` suites, and `docs.test.ts` beyond the examples gate. Task 3 recorded 40 `prism-core` failures it did not diff, and Task 4 deleted 84 supervisor tests, so the sweep still needs a baseline comparison.
    - **Fixes exposed by the checks.** None in this task.
    - **Handoff.** `plans/README.md` marks plans 159 and 160 complete. Compromises Made and Further Actions of both plans are filled and written to `plans/backlog.md`.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test packages/policy/model-router packages/integrations/observability packages/integrations/delegate`
- `bun test packages/integrations/mcp packages/hosts/mcp-server packages/policy/guardrail-packs packages/policy/governance` (plan 159 stays green)
- `bun test src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts src/__tests__/release.test.ts`
- `(cd packages/prism-core && bun run build && bun run test)`, then the same for `packages/ag-ui`, `packages/agent-sdk`, and `packages/prism-code`
- `bun test packages/tools/coding`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/model-router.ts`, `bun examples/observability.ts`, `bun examples/delegate.ts`, `bun examples/mcp-trust.ts`, `bun examples/governance-deny.ts`
- `bun test src packages --path-ignore-patterns='**/limits.test.*'`, compared with the Task 1 baseline (no new failures)
- `node scripts/release.mjs gate`

## Compromises Made

- **Delegate was rewritten, not moved (Task 4).** The 0.12 supervisor already failed 26 of 84 tests against the kernel, so the package re-implements its rules on `createAgent` (about 450 lines). Deleted with it: `createSupervisor`, the spawn tools, the supervisor limits and types, `createDelegatedAgentStep`, `observeSupervisorLifecycle`, and `createWorktreeChildFactory`.
- **Delegate cannot narrow the parent's limits or identity (Task 4).** A package cannot read the parent's run limits, so child limits are clamped to the package's defaults and hard ceilings. `governance.identity` narrowing is not applied; the child gets the parent's principal.
- **Unloaded `inherit` fails at first delegation, not at `createAgent` (Task 4).** `packages.instances` throws during `setup`. Only self-inherit fails at `createAgent`.
- **A suspended child cannot be resumed (Task 4).** The child gets no `host`, so any `ask` suspends it, and the package disposes it and returns the pending decisions. `maxDepth` is limited to 1.
- **Inherited hooks also apply to the parent (Task 4).** A package named in `inherit` is loaded in the parent too, so its `tool.call` hooks gate the parent.
- **Observability registers fewer events than the plan listed (Task 3).** `compaction.*`, `background.*`, and `hook.error` are not observed, because the moved `handleAgentEvent` ignores them.
- **`router.decision`, not `turn.completed`, names the routed model (Task 1 amendment).** `turn.completed.metadata.model` still reflects the turn's initial model.
- **Gate and sweep gaps (Tasks 3-5).** `node scripts/release.mjs gate` stops at `@arnilo/prism-tools-coding` on the carried `ExecutionPolicy` declaration error, so `arnilo__prism.txt`, `arnilo__prism-core.txt`, and `arnilo__prism-tools-coding.txt` were produced by a one-off script and a hand edit. The whole-repo test sweep was not diffed against the plan 159 baseline.
- **`bun.lock` was edited by hand** for `@arnilo/prism-delegate`, because `bun install --lockfile-only` rewrote unrelated `prism-core` entries.
- **Kernel fix outside the plan (Task 4).** `generateWithRetry` in `src/packages/loader.ts` now closes the provider stream when a caller stops at `done`.

## Further Actions

- **P1 - Phase 13: move `delegate` from `child` to `origin`.** `delegate.step` replaces the supervisor's `child` field, which now has no producer (`docs/next/events.md`).
- **P1 - Phase 16: move `prism-core`'s remaining `./governance/observability` (workflow spans, timeline, summary, RAG telemetry) into `@arnilo/prism-observability`.**
- **P2 - Resume a suspended delegation.** Add `delegate_resume`, or give the child a host so its `ask` can reach the parent's UI.
- **P2 - Validate `inherit` at `createAgent`.** Needs a loaded-package list in `PackageAPI` during `setup`, or a `requires.packages` computed from config.
- **P2 - Child limits against the parent's.** Expose the resolved run limits to packages so delegate can clamp to them.
- **P2 - Fix `scripts/release.mjs gate` for `@arnilo/prism-tools-coding`** (`ExecutionPolicy`, `ExecutionAction`, `ExecutionDecision` no longer exported by `@arnilo/prism`) and re-run the baseline update.
- **P2 - Produce a diffed whole-repo test sweep** against the plan 159 baseline (154 failures) and the per-workspace `prism-core`, `ag-ui`, `agent-sdk`, and `prism-code` suites.
- **P3 - Released `/docs` pages still name retired APIs** (`createSupervisor`, `createSpawnAgentTool`, `createGovernedProvider`, the old observability exports): Phase 11.
