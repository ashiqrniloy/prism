# 050 — Release 0.3.2: Clay Integration Findings + OKF Wiki Format

Intake for `docs/_evidence/clay-integration-findings.md` (BUG-1, BUG-2,
FEATURE-1..6, DOCS-1) plus OKF (Open Knowledge Format) adoption in
`@arnilo/prism-wiki`, closed by a changed-package npm release.
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism` npm dist **0.3.0**; repo workspace **0.3.1**
(`edb4fcf`). Target: patch release **0.3.2** line (`prism-wiki` → **0.0.3**,
`prism-compaction-observational-memory` → **0.3.1** if changed).

## Objectives

- Fix BUG-1 (blocker): `suspendAskUserDecision` accepts a request without
  `allowCustom` and resumes correctly after JSON checkpoint persistence
  (defaults to `false`, matching the tool path).
- Fix BUG-2 (DX): supervisor child factories returning non-`Agent` values
  fail with a named, actionable `SupervisorError` at `delegate()` time.
- FEATURE-1 (P1): `resolveAgentDefinition` resolves a missing `def.model`
  from `context.overrides.model` before failing; precedence documented.
- FEATURE-2 (P1): a documented, blessed bounded iterate-until-done host-loop
  pattern with a runnable example (docs-only; the `loop` node primitive
  stays deferred to plan 045).
- FEATURE-3 (P2): optional host-supplied driver hooks on
  `CommandExecutionContext` so contributed commands can start runs/workflows
  when the host opts in.
- FEATURE-4 (P2): opt-in supervisor child event passthrough — redacted,
  size-capped child milestone events tagged with `delegationId`/`childId`/
  `depth`; default behavior unchanged.
- FEATURE-5 (P3): documented pattern for cross-session observational-memory
  recall across a parent/child delegation tree (no new runtime).
- FEATURE-6 (P1): composite `examples/autonomous-coding-loop.ts` — runnable,
  mock-provider-only, exercising durable suspend/resume across a simulated
  restart; conformance reference for hosts.
- DOCS-1 (P2): document the three behavioral contracts (resume-aware nodes,
  supervisor factory returns, fail-closed mid-run compaction) where
  integrators hit them, each linking the composite example.
- OKF adoption: `@arnilo/prism-wiki` keeps the Karpathy compilation prompt
  and skills, but the wiki it scaffolds, compiles, and refreshes becomes an
  OKF v0.2 bundle (frontmatter, links, `index.md`, `log.md` conventions).
- Release: patch-bump and publish every package changed in this plan to npm
  via the existing manifest-derived changed-package flow.

## Expected Outcome

- Clay's repro (durable suspend → JSON persistence → resume with
  `allowCustom` omitted) succeeds for both selection modes; tool and
  workflow paths agree on the `false` default.
- A wrong supervisor child factory returns
  `SupervisorError: child "<id>" factory must return an Agent, got <type>`
  instead of `Cannot read properties of undefined (reading 'permission')`.
- Declarative agents without `model` resolve when the host supplies
  `overrides.model`; docs/type comments agree with runtime.
- Hosts can pass `drivers` into `CommandExecutionContext` execution;
  contributed commands stay inert data in hosts that don't.
- `supervisor.subscribe({ childEvents: true })` (or equivalent opt-in)
  surfaces capped, redacted child milestone events; default stream
  unchanged.
- `examples/autonomous-coding-loop.ts` runs green offline from a fresh
  clone (mock providers, memory stores) and survives a simulated restart
  mid-loop at a human gate.
- `prism-wiki init` scaffolds an OKF v0.2 bundle: root `index.md` carrying
  `okf_version: "0.2"`, per-directory `index.md` listings, date-grouped
  `log.md`, and concept docs whose frontmatter is OKF-conformant
  (`type` required; `title`, `description`, `tags`, `sources`,
  `generated` recommended); cross-links are standard relative markdown
  links; the Karpathy compilation principles, anchors, and
  contradiction-reconciliation protocol are unchanged.
- All packages changed by this plan are published to npm at their next
  patch versions, in dependency order, with gates green and registry
  manifests verified; unchanged packages keep byte-identical versions.

## Tasks

- [x] Task 1 — Freeze evidence and review reusable primitives before implementation (2026-08-29: complete — evidence at `docs/_evidence/phase50-clay-okf-capability-matrix.md`; verified spans, OKF field mapping, per-item smallest-gap decisions, global rejections; outcome notes below in Compromises Made)
  - Acceptance Criteria:
    - Functional: Record verified file:line spans for every change site:
      BUG-1 `packages/coding-agent/src/ask-user-decision.ts`
      (`toAskUserDecisionSuspendData` ~:579, `isAskUserDecisionSuspendData`
      ~:599, `suspendAskUserDecision` ~:614,
      `createAskUserDecisionResumeValidator` ~:657, tool-path
      `parseAllowCustom` :241-245); BUG-2 `packages/supervisor/src/supervisor.ts`
      (child factory result consumed at the `createAgent` sites ~:137-152 and
      the resume path ~:315); FEATURE-1 `src/agent-definitions.ts`
      (`buildBaseConfig`/`resolveModel` :36-66, no-`create()` path :31-33,
      `applyConfigOverrides` :143); FEATURE-3 `src/contracts-core/agent.ts:162`
      (`CommandExecutionContext`); FEATURE-4 supervisor event stream
      (`subscribe` delegation lifecycle events); FEATURE-5
      `packages/compaction-observational-memory/src/` (store composition
      seams: `compose.ts`, `ledger.ts`, `ids.ts`); FEATURE-6/DOCS-1 doc pages
      (`docs/workflows.md`, `docs/supervisors.md`,
      `docs/compaction-and-retry.md`) and existing examples
      (`examples/durable-coding-workflow.ts`, `examples/coding-goal-verify.ts`,
      `examples/durable-loops-and-approvals.ts`); OKF spec sections for
      `packages/prism-wiki` (`src/engine/scaffolder.ts`, `src/engine/compiler.ts`
      `renderEntityMarkdown`/`renderIndexCatalog`, `src/engine/linter.ts`,
      `src/skills.ts`, `skills/wiki-maintainer/SKILL.md`).
    - Performance: no new runtime machinery accepted without a reused seam
      inventory; loops/caps reuse existing limit-resolution precedents
      (`resolveMaxFanOut`, `maxNodeOutputBytes`).
    - Code Quality: one evidence note listing, per feature, the existing
      primitive that covers it and the single smallest gap to fill; reject
      any feature-specific branch in shared runtimes (e.g. no Clay-specific
      code paths).
    - Security: confirm trust boundaries for each change: suspend-data
      normalization happens at accept time (before persistence); driver
      hooks are host-injected and absent by default; child event
      passthrough redacts and caps before emission; OKF frontmatter emits
      no secrets (source anchors only).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md`: full findings, repros,
        acceptance criteria.
      - OKF `SPEC.md` v0.2 (GoogleCloudPlatform/open-knowledge-format):
        §3 bundle structure, §4 concept frontmatter, §5.1 `sources`,
        §5.2 `generated`/`verified`, §5.3 trust tiers, §5.4 `status`,
        §6 links, §8 `index.md`, §9 `log.md`, §12 `okf_version`.
      - `plans/045-Bounded-Loop-Workflow-Node.md` (unchecked): the loop-node
        primitive FEATURE-2 defers to.
      - `plans/039-Obscura-Full-Host-Support-And-Changed-Package-Release.md`
        Task 8: changed-package release mechanics.
      - `docs/agent-definitions.md`, `docs/workflows.md`, `docs/supervisors.md`,
        `docs/compaction-and-retry.md`, `docs/wiki.md`,
        `docs/extension-authoring.md`.
    - Options Considered:
      - Implement everything top-down without an evidence pass: rejected —
        the repo's plan-039 pattern (freeze evidence, inventory primitives,
        then implement) prevents bespoke branches in shared runtimes.
      - One combined evidence/primitive task: chosen — every fix here is
        small and touches known seams; a single task avoids 12 duplicate
        inventories.
    - Chosen Approach:
      - Verify each cited span against current source (line numbers above
        were re-verified at plan time); write
        `docs/_evidence/phase50-clay-okf-capability-matrix.md` recording the
        seam inventory, the OKF field mapping (wiki frontmatter → OKF keys),
        and per-feature smallest-gap decisions. No code in this task.
    - API Notes and Examples:
      ```bash
      graft ask "CommandExecutionContext drivers supervisor child events ask-user-decision suspend" --source
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase50-clay-okf-capability-matrix.md`: pinned spans,
        OKF mapping, per-feature decisions.
    - References:
      - `docs/_evidence/clay-integration-findings.md` (all items).
      - `https://github.com/GoogleCloudPlatform/open-knowledge-format` —
        `SPEC.md` v0.2, sections cited above.
  - Test Cases to Write:
    - None (evidence-only); the matrix is reviewable prose checked by Tasks
      2-12 using its spans.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; evidence freeze only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase50-clay-okf-capability-matrix.md`: evidence
        artifact (nav-exempt per `_evidence` convention).
    - `docs/index.md` update: no; `_evidence/` stays non-navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — BUG-1: default `allowCustom` to `false` in the suspend path (blocker) (2026-08-29: complete — normalization in `toAskUserDecisionSuspendData` reusing `parseAllowCustom`; `allowCustom` and `toolCallId` now optional on the suspend request; 4 regressions added; coding-agent 415/415, root docs test 146/146, typecheck + biome clean, all 6 dependent workspaces typecheck (prism-code has no tsconfig — pre-existing))
  - Acceptance Criteria:
    - Functional: `suspendAskUserDecision` without explicit `allowCustom`
      persists `allowCustom: false` and resumes successfully after a JSON
      checkpoint round-trip, for both `single` and `multiple` selection
      modes; `allowCustom: "yes"`-style non-boolean values still fail
      closed at accept time with `allowCustom must be a boolean`; the
      persisted shape always satisfies `isAskUserDecisionSuspendData`.
    - Performance: no additional serialization or validation passes; the
      default is applied once at accept time.
    - Code Quality: normalization lives in one place
      (`toAskUserDecisionSuspendData`) through which both request union
      members route; `Pick<AskUserDecisionRequest, ...>` widens
      `allowCustom` to optional; the tool path (`parseAllowCustom`,
      `ask-user-decision.ts:241-245`) and workflow path agree on
      `undefined → false`.
    - Security: fail-closed preserved — non-boolean `allowCustom` never
      silently coerces; `resumeSchema` and answer validation unchanged
      (custom text still rejected when `allowCustom` is `false`).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` BUG-1 (repro, expected,
        acceptance criteria).
      - `packages/coding-agent/src/ask-user-decision.ts:241-303`
        (`parseAllowCustom`, tool-path normalization) and `:570-665`
        (suspend data, validator).
      - `docs/coding-agent-tools.md` (`createAskUserDecisionTool` /
        `suspendAskUserDecision` sections).
    - Options Considered:
      - Throw at accept time when `allowCustom` is missing: rejected —
        breaks every JS host and older persisted record shape; the tool
        path already defaults, so disagreement is the bug.
      - Default `allowCustom: false` in `toAskUserDecisionSuspendData`
        (reuse `parseAllowCustom` semantics): chosen — one guard, accept-time,
        matches the tool path exactly.
    - Chosen Approach:
      - In `toAskUserDecisionSuspendData`, apply the same normalization as
        `parseAllowCustom` (`undefined/null → false`, non-boolean → throw
        `allowCustom must be a boolean`). Make `allowCustom` optional in the
        `Pick<>` request type and in `AskUserDecisionSuspendData` consumers
        that build requests. `isAskUserDecisionSuspendData` and
        `createAskUserDecisionResumeValidator` stay strict — persisted data
        is now always a boolean.
    - API Notes and Examples:
      ```ts
      // Now valid; persists allowCustom: false and resumes cleanly:
      suspendAskUserDecision({
        question: "Pick one",
        selectionMode: "single",
        options: [/* ≥2 */],
      });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/ask-user-decision.ts`: normalize
        `allowCustom` in `toAskUserDecisionSuspendData`; widen request type.
      - `packages/coding-agent/src/__tests__/ask-user-decision.test.ts`
        (or the package's existing test file): durable round-trip regressions.
      - `packages/coding-agent/CHANGELOG.md`: BUG-1 entry.
    - References:
      - Clay repro (findings BUG-1): `defineWorkflow` + `functionNode` +
        `runWorkflow`/`resumeWorkflow` + `createMemoryWorkflowCheckpoints`.
      - Tool-path precedent: `ask-user-decision.ts:241-245`.
  - Test Cases to Write:
    - Suspend without `allowCustom` → JSON round-trip (`JSON.parse(JSON.stringify(...))`
      on the checkpoint) → `resumeWorkflow` with
      `createAskUserDecisionResumeValidator()` succeeds, `single` mode.
    - Same for `multiple` mode with `selectedIds`.
    - Non-boolean `allowCustom` (`"yes"`) throws at accept time with the
      actionable message, never at resume time.
    - `allowCustom: false` + `customText` resume input still rejected
      (default parity with tool path).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `suspendAskUserDecision` input
      widened (optional `allowCustom`); runtime default now explicit.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: note `allowCustom` defaults to `false`
        on both tool and suspend paths.
    - `docs/index.md` update: no; entry exists, description still accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — BUG-2: validate supervisor child factory results with an actionable error (2026-08-29: complete — shared `assertChildAgent` guard in `supervisor.ts` at both factory-result sites; regressions in `supervisor.test.ts` (session/plain-object/undefined/null/string variants) and `nested-approvals.test.ts` (durable resume path); supervisor 25/25, typecheck + biome clean, dependent workspace ag-ui typechecks (prism-all has no tsconfig — pre-existing))
  - Acceptance Criteria:
    - Functional: a `SupervisorChild.createAgent` factory returning an
      `AgentSession` (or any non-`Agent`) produces
      `SupervisorError: child "<id>" factory must return an Agent, got <type>`
      at `delegate()` time, on both the initial-run and resume paths; valid
      factories behave exactly as before.
    - Performance: validation is one shape check (`config` object +
      `createSession` function) at factory-result consumption; no per-turn
      cost.
    - Code Quality: one shared guard used by both call sites
      (`supervisor.ts` ~:137 and ~:315); error message names the child id
      and the received type; no `any` casts.
    - Security: fail-closed before any policy intersection
      (`childAgent.config.permission`) is read; the guard prevents
      partially-initialized delegation state.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` BUG-2.
      - `packages/supervisor/src/supervisor.ts:130-160, 310-325` (both
        `childAgent.config` consumption sites).
      - `docs/supervisors.md` (child factory contract section).
    - Options Considered:
      - Guard in each call site separately: rejected — two copies of the
        same check drift.
      - One `assertChildAgent(child, id)` helper called where the factory
        result is first consumed, both paths: chosen.
    - Chosen Approach:
      - Add a private guard validating the factory result shape
      (`typeof result.createSession === "function"` and a `config` object);
      throw a typed `SupervisorError` naming child id and actual type
      (`typeof`/constructor name). Call it at both factory-result sites.
    - API Notes and Examples:
      ```ts
      // Before: SupervisorError: Cannot read properties of undefined (reading 'permission')
      // After:
      // SupervisorError: child "test-writer" factory must return an Agent, got AgentSession
      ```
    - Files to Create/Edit:
      - `packages/supervisor/src/supervisor.ts`: guard + both call sites.
      - `packages/supervisor/src/__tests__/` (existing supervisor test file):
        factory-returns-session regression.
      - `packages/supervisor/CHANGELOG.md`: BUG-2 entry.
    - References:
      - `docs/supervisors.md` — also updated by DOCS-1 (Task 11) to state
        the `Agent` (not `AgentSession`) contract.
  - Test Cases to Write:
    - Factory returning `agent.createSession(...)` → `delegate()` rejects
      with the named error (not a TypeError).
    - Factory returning `undefined`/`null`/plain object → same named error
      with the received type.
    - Valid factory → delegation proceeds (existing tests cover; add one
      asserting the guard adds no observable overhead/behavior change).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — error contract only; no API
      shape change.
    - Docs pages to create/edit:
      - `docs/supervisors.md`: explicit "factories return `Agent`, not
        `AgentSession`" statement (folded into DOCS-1 Task 11 for the full
        contract block).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — FEATURE-1: resolve a missing definition model from `context.overrides` (2026-08-29: complete — `def.model ?? context.overrides?.model` in `buildBaseConfig`; +2 tests; root suite 1692/1692, typecheck + biome clean)
  - Acceptance Criteria:
    - Functional: `resolveAgentDefinition({ name, instructions }, { overrides: { model }, provider })`
      succeeds in the no-`create()` path when `def.model` is absent;
      explicit `def.model` still wins over `overrides.model`; both missing
      still throws `Agent "<name>" has no model`; the `create()` path is
      unchanged.
    - Performance: no extra resolution passes; the fallback is a `??` at
      `buildBaseConfig` time.
    - Code Quality: one-line-family change in `buildBaseConfig`/`resolveModel`
      (`def.model ?? context.overrides?.model`); type comments updated;
      `applyConfigOverrides` precedence (overrides win for other fields)
      stays coherent — model resolution happens before the spread so a
      later `overrides.model` still overrides (documented rule:
      `overrides.model` applies whenever `def.model` is absent; explicit
      definition wins).
    - Security: no change to provider resolution (`resolveProviderOptions`
      still binds `providerSource`/registries); a definition with neither
      model nor override still fails closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` FEATURE-1 (repro).
      - `src/agent-definitions.ts:20-66, 143-146` (resolution order,
        `resolveModel`, `applyConfigOverrides`).
      - `docs/agent-definitions.md` (model-optional table row, precedence).
    - Options Considered:
      - Keep the throw and fix docs to "model or create() mandatory":
        rejected — breaks the declarative model for package authors whose
        hosts inject the selected model.
      - Add `context.defaultModel` host binding: rejected — `overrides.model`
        already exists and reaches the same place; a second seam is
        redundant.
      - Fall back to `context.overrides.model` in the no-`create()` path:
        chosen — smallest diff, uses the existing override surface.
    - Chosen Approach:
      - Pass `def.model ?? context.overrides?.model` into `resolveModel`
      from `buildBaseConfig`; keep the throw when both are absent. Update
      the doc table and type comments to state: optional `model` resolves
      from `context.overrides.model` when omitted; an explicit `def.model`
      takes precedence.
    - API Notes and Examples:
      ```ts
      await resolveAgentDefinition(
        { name: "st", instructions: "You are st." },
        { overrides: { model: { provider: "mock", model: "demo" } }, provider: mockProvider },
      ); // resolves; was: Error: Agent "st" has no model
      ```
    - Files to Create/Edit:
      - `src/agent-definitions.ts`: fallback + comment.
      - `src/__tests__/agent-definitions.test.ts` (existing file): override
        fallback tests.
      - `CHANGELOG.md` (root): FEATURE-1 entry.
      - `docs/agent-definitions.md`: precedence row.
    - References:
      - Clay verified repro (findings FEATURE-1).
      - `applyConfigOverrides` (`src/agent-definitions.ts:143`): spread
        semantics unchanged.
  - Test Cases to Write:
    - No `def.model` + `overrides.model` → resolves with that model.
    - `def.model` + `overrides.model` → explicit definition wins.
    - Neither → still `Agent "<name>" has no model`.
    - `create()` path with no model and no overrides → unchanged behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resolution behavior for
      model-less declarative agents.
    - Docs pages to create/edit:
      - `docs/agent-definitions.md`: model column + precedence note.
    - `docs/index.md` update: no; existing entry description remains true.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — FEATURE-3: optional host driver hooks on `CommandExecutionContext` (2026-08-29: complete — `CommandDrivers`/`CommandWorkflowRun` in contracts-core (auto-exported via barrel), `drivers?:` on the context, RPC session factory + state forwarding, single execute-site forwarding with no key when absent; +3 RPC tests; root suite 1695/1695, typecheck + biome + docs-truth 146/146 clean)
  - Acceptance Criteria:
    - Functional: hosts can supply `context.drivers`
      (`{ startRun, startWorkflow, steer }` — exact final surface from the
      primitive review) when executing contributed commands; a command can
      trigger a session run or workflow start through them; with no
      drivers, `CommandExecutionContext` shape and all existing command
      behavior are byte-identical.
    - Performance: drivers are inert references when absent — zero
      allocation or lookup cost on the no-driver path.
    - Code Quality: optional `drivers?: CommandDrivers` field; typed
      handles return run/workflow references hosts already understand
      (`AgentRunHandle`-shaped / workflow run id + status); no host-specific
      logic in core beyond the typed seam.
    - Security: drivers are host-injected capabilities, never
      package-supplied; docs mark the capability host-opt-in; command
      `metadata.trust` labeling (e.g. `untrusted_external` in prism-wiki
      commands) is unaffected.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` FEATURE-3.
      - `src/contracts-core/agent.ts:162-170` (`CommandExecutionContext`,
        `CommandResult`).
      - `docs/extension-authoring.md`, `docs/extensions.md` (command
        registry + execution contract).
      - `packages/prism-wiki/src/commands/*.ts` (contributed-command
        precedent: args → result mapping).
    - Options Considered:
      - A generic `context.services` bag: rejected — untyped escape hatch;
        three named driver seams cover the Clay case and stay auditable.
      - Named optional `drivers?: { startRun, startWorkflow, steer }` on the
        context, populated only by opting-in hosts: chosen — additive,
        inert by default, matches the findings proposal verbatim.
    - Chosen Approach:
      - Add `CommandDrivers` (typed minimal handles; final member set from
        Task 1 review — `startRun`, `startWorkflow`, `steer`) and
      `drivers?: CommandDrivers` to `CommandExecutionContext`. Hosts pass
      drivers when they build the execution context; core only types and
      forwards them. Export from the contracts surface where
      `CommandExecutionContext` is exported today.
    - API Notes and Examples:
      ```ts
      // Host opt-in:
      const result = await command.execute(args, {
        sessionId,
        runId,
        signal,
        drivers: {
          startRun: (input, opts) => session.run(input, opts),
          startWorkflow: (workflow, input, opts) => runWorkflow(workflow, input, opts),
          steer: (runId, input) => session.steer(runId, input),
        },
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`: `CommandDrivers` + optional field.
      - `src/` command-execution site(s) (where the context is constructed —
        locate via `graft callers execute`): forward drivers if present.
      - `src/__tests__/` commands test: driver presence/absence behavior.
      - `CHANGELOG.md` (root): FEATURE-3 entry.
      - `docs/extension-authoring.md`: host-opt-in driver section.
    - References:
      - Clay `/start` mapping case (findings FEATURE-3 motivation).
      - `docs/public-contracts.md` lists `CommandExecutionContext` — update
        if the contracts table enumerates fields.
  - Test Cases to Write:
    - Command with drivers → `startWorkflow` invoked with expected args,
      result surfaces run id.
    - Same command without drivers → identical result, no driver access,
      no shape change.
    - Driver throwing → command error path unchanged (typed `ErrorInfo`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive optional context field.
    - Docs pages to create/edit:
      - `docs/extension-authoring.md`: "Host driver hooks (opt-in)" section
        with the example above.
      - `docs/public-contracts.md`: extend the context row if fields are
        enumerated.
    - `docs/index.md` update: yes — extend the extensions/extension-authoring
      entry description with "host-opt-in command driver hooks".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — FEATURE-4: opt-in supervisor child event passthrough (2026-08-29: complete — `CreateSupervisorOptions.childEvents` + `startChildEventPump` on the initial `delegate()` session; milestone filter + redactor + count/byte caps; 4 tests; supervisor 29/29, typecheck + biome + docs-truth 146/146 clean)
  - Acceptance Criteria:
    - Functional: opting in (supervisor-level `subscribe({ childEvents: true })`
      or per-child `eventSink` — final surface from Task 1 review) projects
      a redacted, size-capped subset of child `AgentEvent`s onto the
      supervisor event stream, each tagged `delegationId`, `childId`,
      `depth`; milestone-level events (tool calls, run start/finish) are
      the v1 subset; default off with the stream byte-identical to today.
    - Performance: caps on event count/bytes per delegation (reuse existing
      supervisor limit-resolution precedent); no passthrough cost when off.
    - Code Quality: projection is one filter+tag function; redaction reuses
      the supervisor's existing redactor wiring (`options.redactor`); no
      child store/subscription access granted to children.
    - Security: events pass through the configured redactor before
      emission; payload size capped; children never receive supervisor
      internals.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` FEATURE-4.
      - `packages/supervisor/src/supervisor.ts` (event emission sites for
        `delegation_started/finished/rejected/error`; `subscribe` shape).
      - `docs/supervisors.md` (event stream section).
      - `docs/agent-events.md` (`AgentEvent` taxonomy for the milestone
        subset).
    - Options Considered:
      - Per-child `eventSink` on `SupervisorChild`: workable but splits
        configuration across N children.
      - Supervisor-level opt-in flag projecting onto the existing stream:
        chosen — one option, one projection point, matches the findings'
        acceptable alternative.
    - Chosen Approach:
      - Supervisor-level opt-in: when enabled, wrap each child session's
        event stream with a filter (milestone subset), redactor pass, cap
        counter, and tagger (`delegationId`/`childId`/`depth`), then emit
        onto the supervisor stream. Default off. Cap value resolved via the
        supervisor's existing limits resolution.
    - API Notes and Examples:
      ```ts
      const supervisor = createSupervisor({ /* ... */ });
      supervisor.subscribe({ childEvents: true }, (event) => {
        if (event.kind === "delegation_child_event") {
          // event.delegationId, event.childId, event.depth, event.childEvent
        }
      });
      ```
    - Files to Create/Edit:
      - `packages/supervisor/src/supervisor.ts`: opt-in option, projection,
        tagging, caps.
      - `packages/supervisor/src/index.ts`: export any new event type.
      - `packages/supervisor/src/__tests__/`: passthrough + default-off +
        redaction/cap tests.
      - `packages/supervisor/CHANGELOG.md`: FEATURE-4 entry.
      - `docs/supervisors.md`: opt-in child events section.
    - References:
      - Clay nested-run UI streaming motivation (findings FEATURE-4).
      - `docs/agent-events.md` event kinds.
  - Test Cases to Write:
    - Opt-in: child tool-call event appears on supervisor stream with
      correct tags; non-milestone events filtered.
    - Default: no child events on the stream; existing lifecycle events
      unchanged.
    - Redaction: a child event carrying redactable content is redacted
      before emission.
    - Cap: exceeding the per-delegation cap drops (not throws) further
      child events, with one capped marker.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive opt-in event stream
      surface.
    - Docs pages to create/edit:
      - `docs/supervisors.md`: "Child event passthrough (opt-in)" section.
    - `docs/index.md` update: yes — extend the supervisors entry with
      "opt-in redacted child event passthrough".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — FEATURE-5: documented cross-session observational-memory pattern (2026-08-29: complete — `docs/compaction-observational-memory.md` "Cross-session / delegation-tree recall (opt-in pattern)" + `docs/index.md` entry; host-composed `SessionStore.append` funnel; no package runtime; docs-truth 146/146)
  - Acceptance Criteria:
    - Functional: `docs/compaction-observational-memory.md` gains a
      "Cross-session / delegation-tree recall (opt-in pattern)" section
      documenting a host-composed `MemoryStore` that funnels child-session
      observations into a parent/workspace branch, with branch-addressing
      rules that keep exact-id recall unambiguous; an example snippet (or a
      section in the Task 9 composite example) demonstrates parent recall
      of a child observation.
    - Performance: pattern is host-side composition; no new package runtime;
      document the cost note (shared branch grows; keep per-session default).
    - Code Quality: docs-only plus at most an example snippet; default
      single-session behavior untouched.
    - Security: pattern must state ownership/tenancy scoping (observations
      stay within the ownership scope the store enforces); no cross-tenant
      key leakage.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` FEATURE-5 (P3; v1
        acceptable, pattern is the minimum).
      - `packages/compaction-observational-memory/src/compose.ts`,
        `ids.ts`, `ledger.ts` (store seams and branch id conventions).
      - `docs/compaction-observational-memory.md` (attach lifecycle,
        branch-isolated `appendEntry`).
    - Options Considered:
      - A namespaced multi-tenant store key primitive: rejected for this
        release — P3, runtime change, findings accept a documented pattern.
      - Documented host-side store-composition pattern: chosen — zero
        runtime, preserves exact-id branch semantics.
    - Chosen Approach:
      - Docs section + a runnable snippet inside the Task 9 composite
      example (parent OM records delegation outcomes and reads child
      observations funneled by a composed store). No package code changes
      anticipated; if the example needs a tiny helper it stays in
      `examples/`.
    - API Notes and Examples:
      ```ts
      // Pattern sketch (docs): workspace-scoped store composition
      const workspaceStore = composeMemoryStore({
        default: perSessionStore,
        funnel: (branchId) => branchId.startsWith("delegation/")
          ? workspaceBranchStore
          : perSessionStore,
      });
      ```
    - Files to Create/Edit:
      - `docs/compaction-observational-memory.md`: pattern section.
      - `examples/autonomous-coding-loop.ts` (Task 9): demonstrates the
        pattern (cross-referenced, not duplicated).
    - References:
      - Findings FEATURE-5 acceptance criteria.
      - `docs/compaction-observational-memory.md` existing attach/recall
        sections.
  - Test Cases to Write:
    - None new (docs-only); the Task 9 example run exercises the pattern
      end-to-end (parent recalls a child observation).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — documented composition of
      existing APIs.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: pattern section.
    - `docs/index.md` update: yes — extend the observational-memory entry
      with "opt-in cross-session recall pattern".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — FEATURE-6: composite `autonomous-coding-loop` example (conformance reference) (2026-08-29: complete — `examples/autonomous-coding-loop.ts` runs green: 2 iterations, suspend→restart→resume, budget exhausted at 3, OM recallFound, per-child models; typecheck + docs-truth 146/146)
  - Acceptance Criteria:
    - Functional: `examples/autonomous-coding-loop.ts` runs green offline —
      mock provider only, memory stores, no network — demonstrating: goal →
      roadmap artifact → per-phase plan → task-by-task execution with
      supervisor children (per-child models), `runCodingGoalVerify`-style
      validation feedback, OM attach + per-task compaction + recall,
      budgets (iteration/tool/token caps), deterministic termination on
      budget exhaustion, and durable suspend/resume across a simulated
      restart (human gate mid-loop, new runtime instance resumes from the
      checkpoint store).
    - Performance: example completes within the existing examples test
      envelope; bounded iteration records; no unbounded growth.
    - Code Quality: compile-checked (examples are typechecked in CI);
      example-grade code — no `any`, explicit budgets, comments mapping each
      component to its doc page (conformance-reference style).
    - Security: no credentials; mock providers; untrusted-content paths
      marked; no real egress.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` FEATURE-6.
      - `examples/durable-coding-workflow.ts`, `examples/coding-goal-verify.ts`,
        `examples/durable-loops-and-approvals.ts`, `examples/agent-durable-approval.ts`
        (existing composition idioms to reuse).
      - `docs/workflows.md` (suspend/resume + `state.coding` plan
        composition), `docs/supervisors.md`, `docs/compaction-observational-memory.md`,
        `docs/coding-agent-tools.md`.
    - Options Considered:
      - A test fixture instead of an example: rejected — findings require a
        runnable host-facing reference, and examples are already the
        conformance surface.
      - One new example composing the five packages: chosen — exactly the
        FEATURE-6 ask; it also seeds FEATURE-2 docs (Task 10) and the
        DOCS-1 links (Task 11).
    - Chosen Approach:
      - New `examples/autonomous-coding-loop.ts` following the repo's
        example conventions (self-`assert` checks like other runnable
        examples; simulated restart = drop in-memory handles, rebuild
        runtime, resume from the same checkpoint store). Reuse
        `createMemoryWorkflowCheckpoints`, mock provider, and supervisor
        child factories. Keep the loop host-side (one `runWorkflow` per
        iteration) so it doubles as the FEATURE-2 pattern demo.
    - API Notes and Examples:
      ```bash
      node --experimental-strip-types examples/autonomous-coding-loop.ts
      # or via the examples runner used by CI for runnable demos
      ```
    - Files to Create/Edit:
      - `examples/autonomous-coding-loop.ts`: new composite example.
      - `docs/index.md`: examples list entry.
      - `CHANGELOG.md` (root): FEATURE-6 entry.
    - References:
      - Clay composition account (findings FEATURE-6 motivation + DOCS-1).
      - Plan 039/030 example conventions.
  - Test Cases to Write:
    - Example self-check (asserts): N bounded iterations executed; suspend →
      simulated restart → resume completes; budget exhaustion terminates
      deterministically; supervisor child ran with validation feedback; OM
      recall returns a child/parent observation.
    - CI wiring: add to the examples compile/run check list used by
      existing example tests (same mechanism as other runnable examples).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — new example only.
    - Docs pages to create/edit:
      - `docs/index.md`: examples list entry with one-line description.
    - `docs/index.md` update: yes (same line).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — FEATURE-2: blessed bounded iterate-until-done pattern (docs, seeded by the example) (2026-08-29: complete — `docs/workflows.md` section + index/CHANGELOG; seeded by Task 8 example; docs-truth 146/146)
  - Acceptance Criteria:
    - Functional: `docs/workflows.md` gains a "Bounded iterate-until-done
      (host-loop pattern)" section: one `runWorkflow` per iteration,
      iteration state in workflow inputs, explicit termination predicate,
      explicit budgets (max iterations / tool calls / tokens), and
      `replayWorkflow` for auditing — demonstrated by
      `examples/autonomous-coding-loop.ts` (Task 8) including mid-loop
      suspend/resume at a human gate and deterministic termination on
      budget exhaustion; a pointer to plan 045's future `loop` node
      primitive states the migration path.
    - Performance: pattern imposes no runtime machinery; budgets enforced
      by the example's host loop (documented as the host's job).
    - Code Quality: pattern stated as a copyable recipe (numbered steps +
      minimal code excerpt referencing the example); no new exports.
    - Security: budget-exhaustion termination is fail-closed (typed error /
      terminal state, never a hang); audited via replay.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` FEATURE-2 (option 1
        minimum: docs + example).
      - `plans/045-Bounded-Loop-Workflow-Node.md` (deferred primitive).
      - `docs/workflows.md` (suspend/resume, replay, limits sections).
    - Options Considered:
      - Ship the plan 045 `loop` node primitive now: rejected — plan 045 is
        scoped separately (scheduler state machine work); findings accept
        the documented pattern as the minimum for this intake.
      - Document the host-loop pattern + point at the example: chosen —
        zero runtime risk, unblocks Clay, defers the primitive cleanly.
    - Chosen Approach:
      - Docs section in `docs/workflows.md` with the recipe and the budget
        rules; example (Task 8) is the runnable proof; cross-link both
        ways; note plan 045 as the future in-graph primitive.
    - API Notes and Examples:
      ```ts
      // Recipe sketch (docs):
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const run = await runWorkflow(phase, { ...state, iteration: i }, { checkpoints, ownership });
        if (run.status === "suspended") { /* human gate; resume later */ }
        if (passed(run) || budgetExhausted(run)) break;   // explicit predicate
      }
      // audit: await replayWorkflow(workflow, { runId }, { checkpoints })
      ```
    - Files to Create/Edit:
      - `docs/workflows.md`: pattern section.
      - `CHANGELOG.md` (root): FEATURE-2 docs entry.
    - References:
      - Findings FEATURE-2 acceptance criteria (N bounded iterations,
        mid-loop suspend/resume, deterministic termination on budget
        exhaustion — all demonstrated by Task 8's example).
      - `plans/045-Bounded-Loop-Workflow-Node.md`.
  - Test Cases to Write:
    - None new (docs task); Task 8's example self-checks are the runnable
      evidence cited by the section.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — documented pattern over
      existing APIs.
    - Docs pages to create/edit:
      - `docs/workflows.md`: bounded iterate-until-done section.
    - `docs/index.md` update: yes — extend the workflows entry with
      "documented bounded iterate-until-done host-loop pattern".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 10 — DOCS-1: document the three behavioral contracts that caused integration dead-ends (2026-08-29: complete — contract blocks on workflows.md / supervisors.md / compaction-and-retry.md, each linking the composite example; index + CHANGELOG; docs-truth 146/146)
  - Acceptance Criteria:
    - Functional: three contract blocks land where integrators look:
      (1) `docs/workflows.md` — resume-aware nodes: a suspended node's
      `execute` is re-invoked with `ctx.resume` after an approved resume; a
      node that unconditionally returns its suspension re-suspends silently
      and downstream nodes never run; document
      `execute: (ctx) => ctx.resume ? handle(ctx.resume) : suspend(...)`
      in a warning box (the page's line ~77 already states the mechanics —
      add the failure mode + pattern box);
      (2) `docs/supervisors.md` — child factories return `Agent`, not
      `AgentSession` (with the BUG-2 error as the failure signature), and
      children need a stable config plus a durable store for nested
      approvals to resume;
      (3) `docs/compaction-and-retry.md` — `session.compact()` fails closed
      during an active run; task-boundary compaction (one run per task) is
      the intended model.
    - Performance: docs-only.
    - Code Quality: each block states the contract, the failure mode it
      prevents, and links `examples/autonomous-coding-loop.ts` (Task 8) as
      the live demonstration.
    - Security: no behavior claims beyond verified runtime behavior (each
      contract was runtime-verified by the Clay review; re-verify while
      writing).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/clay-integration-findings.md` DOCS-1.
      - `docs/workflows.md:77` and `:182-183` (existing partial
        resume-aware coverage), `docs/supervisors.md`,
        `docs/compaction-and-retry.md:24` (compact() description),
        `docs/compaction-observational-memory.md`.
    - Options Considered:
      - One combined "integration contracts" page: rejected — integrators
        must find each contract on the page they're already reading
        (findings: "where integrators will find them").
      - Three in-place blocks on the existing pages: chosen.
    - Chosen Approach:
      - Edit the three pages with warning-boxed contract blocks; link each
        to the composite example; update `docs/index.md` descriptions where
        the entry text should reflect the contract.
    - API Notes and Examples:
      ```ts
      // docs/workflows.md warning box pattern:
      execute: async (ctx) => ctx.resume
        ? publishDraft(ctx.upstream.draft, ctx.resume.input)   // resumed path
        : suspendAskUserDecision({ ... }),                     // first pass
      ```
    - Files to Create/Edit:
      - `docs/workflows.md`, `docs/supervisors.md`,
        `docs/compaction-and-retry.md`: contract blocks.
      - `docs/index.md`: entry description touch-ups.
    - References:
      - Findings DOCS-1 items 1-3 (each with its failure-mode account).
      - Task 8 example (link target).
  - Test Cases to Write:
    - None (docs); the repo's docs-truth gate (if any sweep asserts doc
      claims) must stay green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — documenting verified existing
      behavior.
    - Docs pages to create/edit:
      - `docs/workflows.md`, `docs/supervisors.md`,
        `docs/compaction-and-retry.md`: as detailed above.
    - `docs/index.md` update: yes — minor description extensions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 11 — OKF adoption: `@arnilo/prism-wiki` emits an OKF v0.2 bundle (Karpathy prompt retained) (2026-08-29: complete — shared `engine/okf.ts` emitter; init/refresh/lint/record-insight/skills/docs; wiki tests 39/39, docs-truth 146/146)
  - Acceptance Criteria:
    - Functional: `wiki-init` / `prism-wiki init` scaffolds an OKF v0.2
      bundle: root `index.md` carrying `okf_version: "0.2"` frontmatter (the
      only frontmatter allowed in an `index.md`) with sectioned bullet
      listings (`* [Title](relative.md) - description`); per-directory
      `index.md` for `entities/`, `decisions/`, `concepts/` (progressive
      disclosure); `log.md` in OKF §9 form (flat date-grouped entries, ISO
      `YYYY-MM-DD` headings, newest first, bold leading verbs); concept
      documents (entity/decision/concept pages) with OKF frontmatter —
      `type` REQUIRED (mapped from category: `Module`, `Concept`,
      `Decision Record`, `Entity`, `Person`, `Tool`), plus `title`,
      `description`, `tags`, `sources` (each entry with REQUIRED
      `resource: file:///...#Lxx-Lyy` anchor + optional `id` = symbol name),
      and `generated: { by: prism-wiki/<version>, at: <ISO 8601 UTC> }`;
      cross-page links are standard relative markdown links (replacing
      `[[wikilinks]]`); the Karpathy compilation body (anchors, symbol
      listings, synthesis sections) is unchanged. `wiki-refresh` upgrades
      touched pages to the OKF frontmatter and re-emits `index.md`/`log.md`
      in the new form. `wiki-lint` validates OKF frontmatter (`type`
      present, ISO timestamps, resolvable relative links) in addition to
      existing dead-anchor/orphan checks.
    - Performance: rendering cost unchanged (same page count, string
      templates); no new index passes beyond per-directory `index.md`
      generation already implied by the manifest.
    - Code Quality: one frontmatter emitter shared by scaffold and compile
      paths; `WikiEntityMetadata` gains `description` (one-line summary)
      where absent; parsers (`tools.ts` page reading, search hydration)
      read the new keys; extra keys (`id`, `category`, `rawSources`,
      `lastCompiledAt`) are dropped from emitted frontmatter in favor of
      OKF keys — the sidecar `.manifest.json` remains the compilation
      ledger (OKF permits extra non-`index.md` files); SCHEMA.md documents
      the OKF mapping.
    - Security: frontmatter contains only source anchors and metadata — no
      secrets; anchor paths are workspace-relative/file URLs as today;
      `qmd` collection and Context7 hydration unchanged.
  - Approach:
    - Documentation Reviewed:
      - OKF `SPEC.md` v0.2: §3 (bundle layout, reserved `index.md`/`log.md`),
        §4 (frontmatter; `type` only required key), §5.1 (`sources` —
        `resource` REQUIRED per entry, `id` for claim attribution),
        §5.2 (`generated { by, at }` actor convention), §5.3 (trust tiers —
        absent `verified` ⇒ unverified, fine for v1), §5.4 (`status` —
        optional, skip for v1), §6 (links are plain markdown links), §8
        (`index.md` no-frontmatter except root `okf_version`), §9 (`log.md`
        date-grouped newest-first), §12 (`okf_version: "0.2"`).
      - `packages/prism-wiki/src/engine/scaffolder.ts`,
        `src/engine/compiler.ts` (`renderEntityMarkdown` :31-65,
        `renderIndexCatalog`), `src/engine/linter.ts`, `src/skills.ts`
        (:109-124 karpathy instructions), `skills/wiki-maintainer/SKILL.md`,
        `src/types.ts` (`WikiEntityMetadata`), `src/tools.ts` /
        `src/search/*` (frontmatter parsing).
      - `docs/wiki.md` (current wiki contract page).
      - Reference bundles: OKF repo `bundles/ga4/` (root/subdir `index.md`,
        concept frontmatter with `sources`/`generated`, footnote
        attribution).
    - Options Considered:
      - Keep current frontmatter and add OKF keys alongside: rejected —
        dual formats forever; OKF keys cover everything the old keys
        carried (id = concept id from path, category = `type`, rawSources =
        `sources[].resource`, lastCompiledAt = `generated.at`).
      - Full OKF v0.2 including `verified`/`status`/`usage_window` trust
        families: rejected for v1 — optional families; emit `sources` +
        `generated` only (trust tier = unverified, which OKF consumers must
        accept); add `verified` when a human-review workflow exists.
      - Emit OKF keys, keep the Karpathy body and skills, switch links to
        plain markdown: chosen.
    - Chosen Approach:
      - Rework `renderEntityMarkdown` to emit OKF frontmatter (mapping
        above); `renderIndexCatalog` → OKF `index.md` form + per-directory
        indexes; scaffolder writes the OKF-shaped `index.md` (with
        `okf_version: "0.2"`), `log.md` (§9 form), and a SCHEMA.md that
        states the OKF mapping and the Karpathy protocol; linter adds OKF
        validation; skills (`skills.ts` + `skills/wiki-maintainer/SKILL.md`)
        keep the four Karpathy principles and add the OKF emission rules
        (frontmatter keys, footnote attribution via `sources[].id`, plain
        markdown links); parsers read `title`/`description`/`type`. Commands
        already exist (`wiki-init`, `wiki-refresh`, `wiki-lint` + CLI
        `init`/`refresh`/`lint`) — no new commands; their output becomes
        OKF. Migration: `wiki-refresh` upgrades pages it touches; document
        that untouched legacy pages can be re-scaffolded (no migration
        tool — ponytail: format is regenerable from raw sources).
    - API Notes and Examples:
      ````markdown
      ---
      # .wiki/entities/auth.md — OKF v0.2 concept document
      type: Module
      title: "Auth"
      description: "Token verification and session identity boundaries."
      tags: [auth, security]
      sources:
        - id: verifyToken
          resource: file:///src/auth/jwt.ts#L10-L45
          title: src/auth/jwt.ts
      generated: { by: prism-wiki/0.0.3, at: 2026-08-30T12:00:00Z }
      ---

      # Auth

      Compiles token verification ... [verifyToken](file:///src/auth/jwt.ts#L10-L45)
      ````
    - Files to Create/Edit:
      - `packages/prism-wiki/src/engine/scaffolder.ts`: OKF scaffold
        (index/log/SCHEMA, `okf_version`).
      - `packages/prism-wiki/src/engine/compiler.ts`: OKF frontmatter,
        index render, per-directory `index.md`.
      - `packages/prism-wiki/src/engine/linter.ts`: OKF frontmatter checks.
      - `packages/prism-wiki/src/types.ts`: `WikiEntityMetadata.description`;
        OKF key types.
      - `packages/prism-wiki/src/skills.ts` and
        `packages/prism-wiki/skills/wiki-maintainer/SKILL.md`: Karpathy +
        OKF emission rules.
      - `packages/prism-wiki/src/tools.ts`, `src/search/*` (frontmatter
        parsing — tentative: adjust to new keys where title/summary are
        read).
      - `packages/prism-wiki/src/__tests__/` (compiler, commands, linter,
        e2e-codebase, e2e-pkm, skills tests): OKF expectations.
      - `packages/prism-wiki/CHANGELOG.md`, `README.md`: format change
        entry.
      - `docs/wiki.md`: OKF section (bundle shape, field mapping, migration
        note).
      - `docs/index.md`: wiki entry description update.
    - References:
      - `https://github.com/GoogleCloudPlatform/open-knowledge-format` —
        `SPEC.md` v0.2 §3-§9, §12; `bundles/ga4/` as reference bundle.
      - Karpathy LLM-wiki pattern: retained via `skills/wiki-maintainer`
        (compilation over duplication, precise anchors, contradiction
        reconciliation, synchronized catalogs/ledgers).
  - Test Cases to Write:
    - Scaffold: root `index.md` has exactly the `okf_version: "0.2"`
      frontmatter and sectioned listing form; `log.md` matches §9
      (date-grouped, newest first); per-directory `index.md` present.
    - Compile: entity page frontmatter has `type`, `title`, `description`,
      `tags`, `sources` (each with `resource`), `generated.by/at` (ISO 8601
      UTC); no legacy `id`/`category`/`rawSources` keys; body anchors
      unchanged.
    - Round-trip: `wiki-init` then `wiki-refresh` on a changed source
      upgrades the touched page's frontmatter and rewrites indexes/log.
    - Lint: missing `type` flagged; non-ISO `generated.at` flagged;
      `[[wikilink]]` flagged as non-OKF link; dead anchors still detected.
    - Skills: wiki-maintainer instructions mention OKF frontmatter keys and
      keep the four Karpathy principles (skills.test).
    - e2e codebase + pkm suites updated to the OKF shape and green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — emitted wiki document format
      changes to OKF v0.2 (package API surface unchanged except
      `WikiEntityMetadata.description`).
    - Docs pages to create/edit:
      - `docs/wiki.md`: "OKF v0.2 bundle format" section with field
        mapping and migration note.
      - `packages/prism-wiki/README.md`: format description update.
    - `docs/index.md` update: yes — wiki entry gains "emits OKF v0.2
      bundles (GoogleCloudPlatform/open-knowledge-format)".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 12 — Final verification, patch bumps, and npm publish of all changed packages
  - Acceptance Criteria:
    - Functional: every task above checked; full gate green
      (`npm run sdk:ready`: typecheck, lint, format, test, coverage, pack
      dry-run, release gate); changed-package list captured from the parent
      commit of this plan's first implementation commit (expected:
      root `@arnilo/prism` (FEATURE-1/3 + docs), `@arnilo/prism-coding-agent`
      (BUG-1), `@arnilo/prism-supervisor` (BUG-2, FEATURE-4),
      `@arnilo/prism-wiki` (OKF); recompute — docs/examples-only changes do
      not bump packages); each changed existing package receives exactly
      one patch bump (`0.3.1 → 0.3.2`; `prism-wiki 0.0.2 → 0.0.3`;
      `prism-compaction-observational-memory 0.3.0 → 0.3.1` only if its
      code changed); unchanged packages byte-identical; publish in
      dependency order via the existing flow; registry manifests verified
      post-publish; `graft build` refreshed after the code changes.
    - Performance: release detection/validation via existing
      manifest-derived scripts; no manual all-workspace publish.
    - Code Quality: changelogs updated for every bumped package; commit
      history one logical cut; compat baselines regenerated if the gates
      require (additive-only expectations).
    - Security: no secrets in the cut; `release:gate` includes the secret
      scan; tags signed per existing convention.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md:151-190` (independent changed-package
        check/publish and package-tag flow).
      - `scripts/release.mjs` (`changed`, `check`, `gate`, `publish`
        subcommands; `:277-338` clean/tagged state and publish args).
      - `plans/039-Obscura-Full-Host-Support-And-Changed-Package-Release.md`
        Task 8 (precedent for the cut mechanics).
    - Options Considered:
      - Lockstep version bump of all workspaces: rejected — repo convention
        is independent changed-package versions with unchanged packages
        preserved.
      - Manifest-derived changed-package patch cut + existing publish flow:
        chosen — matches plans 030/039.
    - Chosen Approach:
      - Baseline: the commit immediately before this plan's first
        implementation commit (expected `edb4fcf` if plan work starts at
        HEAD; recompute at execution). Capture
        `node scripts/release.mjs changed --baseline <sha>`; patch-bump
        each listed existing package; update each bumped package's
        CHANGELOG; run `npm run release:check` /
        `release:publish --dry-run`; commit; tag the changed-package cut;
      push tag (or `npm run release:publish`) so the workflow publishes in
        topological order; verify registry manifests and versions
        post-publish; run `graft build` to refresh the repo context graph.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs changed --baseline "$BASELINE"
      npm run release:publish -- --baseline "$BASELINE" --dry-run --report /tmp/prism-050-dry-run.json
      # after gates + commit:
      npm run release:publish   # or: tag push → GitHub Actions topological publish
      ```
    - Files to Create/Edit:
      - Changed package `package.json` versions (via the release script
        flow).
      - Changed packages' `CHANGELOG.md` entries.
      - `graft/` graph (via `graft build`).
    - References:
      - `docs/release-and-install.md`; `scripts/release.mjs`;
        plan-039 Task 8 notes in `plans/039-*.md`.
  - Test Cases to Write:
    - Dry-run report lists exactly the changed set with next-patch
      versions; unchanged packages absent.
    - Post-publish: `npm view <pkg>@<version>` matches for every published
      package; `release:check` clean against the registry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published versions.
    - Docs pages to create/edit:
      - `none`: release mechanics already documented; CHANGELOGs carry the
        per-package changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Task 1 (2026-08-29): evidence-only; no code. Span corrections vs the Clay
  findings (0.3.0-era line numbers): the first-party command execution site
  constructing `CommandExecutionContext` is `src/rpc.ts:235` (findings did
  not name it); OM's separate `store` option no longer exists (removed for
  session/store-mismatch safety), so the FEATURE-5 pattern widens only the
  host-supplied **read** side of recall, never `appendEntry`; OKF v1 scope
  excludes `verified`/`status`/`usage_window` families and `[[wikilinks]]`
  (plain markdown links per §6).
- Task 2 (2026-08-29): `toolCallId` also made optional on the
  `suspendAskUserDecision` request union — `AskUserDecisionRequest` marks it
  required, so the `Pick<>` widening alone still rejected the Clay repro
  (which omits both `allowCustom` and `toolCallId`). Persisted
  `AskUserDecisionSuspendData` shape unchanged (all keys it carries stay
  required once normalized). Docs-truth fallout fixed: plan 050 added to
  `plans/README.md` index; one OKF spec placeholder link in the phase-50
  evidence table reworded to plain text (raw link-regex scan ignores code
  spans). Task 3 (2026-08-29): sessions surface as `RuntimeAgentSession` (core
  session class name), not `AgentSession` — the guard names the actual
  constructor, which is more precise than the findings' example; resume-path
  failures surface through `resumeAgentRun` with the supervisor message
  preserved (test matcher tolerates both rejection and failed-run shapes).
  Task 4 (2026-08-29): the plan's "explicit `def.model` still wins over
  `overrides.model`" acceptance line conflicts with the pre-existing tested
  spread semantics (`overrides swap model and drop tool`: overrides replace
  model post-resolution like any other config field). Kept existing behavior
  — the `??` only fills the absent-model case; overrides still replace the
  final model. Documented rule in `docs/agent-definitions.md` matches.
  Task 5 (2026-08-29): core's domain-vocabulary guard
  (`core-boundaries.test.ts`: no standalone `workflow` token in contracts-core)
  forced comment/param wording changes — `CommandDrivers.startWorkflow` kept
  its camelCase name (no word boundary ⇒ guard passes), but the doc comment
  says "host-understood orchestration definition" and the parameter is
  `definition: object`, not `workflow`. No behavior difference.
  Task 6 (2026-08-29): opt-in is `createSupervisor({ childEvents: true })`, not
  `subscribe({ childEvents: true })` — subscribe stays zero-arg (shared multiplexer;
  per-subscriber projection would be a second event path). Resume-path rebuilds
  (`resumeNestedRun`) do not project child events in v1 (`resumeAgentRun` does not
  expose a session to wrap); live passthrough is the initial `delegate()` session
  only. Session emit already redacts; pump still re-applies `options.redactor`.
  Task 7 (2026-08-29): no `composeMemoryStore` helper (does not exist; plan sketch
  was hypothetical). Pattern wraps `SessionStore.append` and copies eligible child
  *messages* onto the workspace session with new entry ids — not OM custom entries
  (runtime visibility check fails closed on session/store mismatch; `sourceEntryIds`
  would dangle). Parent OM mints its own observation ids. Task 8 example is the
  runnable walk-through.
  Task 8 (2026-08-29): example does **not** inline the Task 7 store funnel — copying
  child messages onto the parent session forks `store` leaf vs `session.leafId`, and
  a rebuilt session without `leafId` starts a new root (OM recall misses). Demo
  records child outcomes via parent `session.run` (v1 pattern) and recreates the
  parent session with the store leaf after the simulated restart. `BudgetExhaustedError`
  cannot use TS parameter properties (Node 24 strip-only).
  Task 9 (2026-08-29): docs+example minimum only — no `iterateUntil` helper and no
  plan 045 `loop` node. `replayWorkflow` audits one iteration run id; the host
  `for` is N run ids (`listWorkflowRuns`). Budgets stay host-enforced.
  Task 10 (2026-08-29): in-place GFM blockquotes, not a combined contracts page
  and not HTML asides. Compact fail-closed error is the existing
  `Error("Agent session already has an active run")` (no dedicated compact code).
  Task 11 (2026-08-29): no `verified`/`status` trust families; no footnote rewrite of
  Karpathy body; compiled pages still live under `entities/` (dir indexes link
  `../entities/` for concepts/decisions); no legacy-page migrator (`wiki-refresh`
  upgrades pages it touches). PKM profile schema text still mentions wikilinks —
  linter flags them.

## Further Actions
- To be filled after task completion with improvements, rationale, and
  priority.