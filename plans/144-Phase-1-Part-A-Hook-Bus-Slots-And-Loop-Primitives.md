# Phase 1 Part A — Hook bus, slots, and loop primitives

## Objectives

- Build the kernel's single interception model: a typed hook bus with the four kinds (observe, transform, decide, around), the full §2.4 catalog, combination rules, priority and load ordering, registration ids, and a per-kind error policy.
- Build the slot registry for `loop`, `compaction`, `store`, and `credentials`, with kernel defaults, `provide` / `default`, and fail-closed conflict detection.
- Rewrite the default loop on a `RunController` whose primitives (`turn`, `executeTools`, `append`, `end`, `emit`) fire the hooks, so a replacement loop cannot bypass them.
- Implement `ask` in `executeTools`: an inline `host.ui` confirm when a UI is present, otherwise a suspension persisted through the `store` slot that survives a process restart.
- Add the `ToolDefinition.effects` annotation.
- Prove every catalog hook fires from the default loop and from a custom loop.

## Expected Outcome

- New kernel modules, following the §2.2 layout:
  - `src/hooks/`: the bus, catalog types, and error classes
  - `src/slots/`: the registry and the four slot contracts with their defaults
  - `src/loop/`: `LoopStrategy`, `RunController`, and `defaultLoop`
  - `src/host/`: `HostPort` and `HostUi`, limited to the `confirm` request kind
- `createAgent` accepts `hooks: (hooks: HookRegistrar) => void`, `slots: { loop?, compaction?, credentials? }`, and `host: HostPort`, as sketched in §2.3.
  - Host hooks register under the owner `host`. Their ids are `host:<hook>[#<id>]`.
  - `slots.store` is not added here. See the header paragraph.
- `AgentConfig.loop`, `RunOptions.loop`, `AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, and `generateValidateReviseLoop` are deleted. The kernel no longer ships `generate-validate-revise`; roadmap Phase 9 (`workflows`) brings it back as a loop strategy.
- `RunController` primitives fire every catalog hook in the §2.5 order. `src/__tests__/hook-catalog-coverage.test.ts` proves each hook fires from `defaultLoop` and from a custom `LoopStrategy`.
- A kernel-imports-no-package gate test exists and passes.
- `docs/next/` exists, is excluded from the docs index test and the root tarball, and holds `hooks.md`, `slots.md`, and `loop.md`.
- `examples/custom-loop.ts` runs under the execution gate.
- `CHANGELOG.md` `## [Unreleased]` records each change.
- The compat baseline is regenerated for every export change, and `node scripts/release.mjs gate` is green.

This plan implements roadmap **Phase 1 — Hook bus, slots, and loop primitives**, split in two:

- **Part A (this plan)** builds the new machinery and retires the old loop contract.
- **[Part B](145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md)** retires the remaining 0.12.1 interception mechanisms and freezes the catalog. Part B depends on this plan being complete.

Task 1 is the phase review. It covers both parts, because both change kernel contracts.

**Transitional overlap.** During Part A, the 0.12.1 mechanisms (`middleware`, `guardrails`, `permission`, `stopHooks`, and the rest) keep running at their existing call sites inside the primitives, next to the new hooks. Only `loop` retires here, because the loop slot replaces it directly. This is not a compatibility alias: there is no translation layer and no new public name for an old one. Part B deletes each old call site and config field, and Phase 1 is not done until Part B ends.

**Slot-input decisions** (Task 1 confirms these against source):

- `AgentConfig.store` stays the direct-implementation input of the `store` slot until roadmap Phase 3 reshapes `AgentConfig` to §2.3. `createAgent` has 193 callers; moving about 100 of them to `slots.store` in Phase 1 is churn that Phase 3's rewrite repeats.
- The `compaction` slot is consumed only from Part B Task 5, which retires `CompactionOptions.strategy` / `trigger` in the same change.
- The `credentials` slot has its contract and `env:` default here. Roadmap Phase 5 wires providers to it.

**What does not ship:**

- No version bump, publish, or `/docs` page change. Released `/docs` stays on 0.12.1.
- No `@arnilo/prism/testing` conformance suite. Phases 2 and 3 create that subpath, and the catalog-coverage harness in Task 6 is what Phase 2's loop conformance promotes.
- `HostUi` carries only `confirm`. Phase 3 adds the other request kinds and `unavailable` semantics beyond the ask path.

## Tasks

- [x] Task 1: Phase 1 review — contract inventory, classification, and assumption checks (read-only)
  - Acceptance Criteria:
    - Functional: This task changes no code and creates no file outside this plan and Part B. It records a verdict in its Notes, and the Notes cover every item below with `file:line` citations.
      - **Inventory.** List every contract Phase 1 touches, with its roadmap section and its current code:
        - hooks and the event types their observe hooks mirror: §2.3 "Events" and §2.4 against `src/contracts-protocol.ts:459` (`AgentEvent`)
        - slots: §2.5 against `AgentConfig.store`, `compaction`, `loop` (`src/contracts-core/agent.ts:117,136,144`)
        - `RunController` primitives: §2.5 against `LoopContext` (`src/contracts-core/loop.ts:80-122`)
        - `ToolDefinition`: §2.6 "Tools" against `src/contracts-protocol.ts:492-502`
        - `HostUi`: §2.3 "Host port"
      - **Classification.** Classify each Phase 1 Scope bullet and each §2.4 "Replaces" entry as *expressible with what exists* or *needs a kernel addition*. For each addition, state:
        - its kind, payload, result, combination rule, and error policy
        - the primitive that fires it
        - the current call site it replaces
      - **Middleware mapping.** Map each of the 12 `MiddlewareHookName` members (`src/middleware.ts:4-16`) to its catalog hook, slot, or event, or to "deleted, no replacement", with a reason:
        - `beforeProviderTurn` → `model.call`
        - `provider_request` → `model.request`
        - `input_assembly` / `prompt_build` / `context` → `context.build` (or `run.input`)
        - `tool_call` / `tool_result` → `tool.call` / `tool.result`
        - `retry` → `model.call`, or kernel retry with no hook
        - `compaction_request` / `compaction` → `compaction.when` and the compaction slot
        - `session_start` / `session_shutdown` → observe on the session events
      - **Verify these assumptions and record each one as confirmed or refuted:**
        - (a) `src/` imports no `@arnilo/prism-*` package outside tests (the basis for Task 2's gate).
        - (b) Every family package resolves `@arnilo/prism` through the workspace symlink (`node_modules/@arnilo/prism -> ../..`). This means every retired field breaks their typecheck, and each retirement task must migrate their callers.
        - (c) `generateValidateReviseLoop` has no caller outside `src/` and `examples/` (`examples/host-artifact-loop.ts`).
        - (d) `AgentLoopStrategy` / `LoopContext` callers are limited to the files `graft callers` lists. Paste the list, including `packages/agent-sdk/src/{config,define-agent}.ts`, `packages/prism-code/src/limits.ts`, and `examples/{durable-loops-and-approvals,spawn-agent-tool}.ts`.
        - (e) The 0.12 durable-interrupt path: `runState.checkpoints` (`CheckpointStore`), `interruptBeforeTool`, `AgentRunSuspended` (`src/agent-approval.ts:280`), and `session.resumeDurable` (`src/agent-session/session.ts:424`). Decide which parts `ask` replaces in Task 5. The default: `interruptBeforeTool` retires, and every-turn checkpoints stay until roadmap Phase 3.
        - (f) The limit name: roadmap `limits.maxContinuations` versus current `maxStopContinuations` (`src/contracts-core/run-limits.ts:28`). The roadmap wins, and Part B Task 4 renames it.
        - (g) The existing `ToolDefinition.effect` (durable recovery declaration, `src/contracts-protocol.ts:500`) versus the new `effects` (capability kinds). Decide whether both names can coexist without confusion, or whether `effect` is renamed. A rename goes to Further Actions unless it is needed for Task 3.
        - (h) Observe hooks are keyed by the current `AgentEvent["type"]` names (`message_delta`, `tool_execution_started`, …). Roadmap Phase 3 freezes the dotted event names, and the observe hooks follow automatically. Record the §2.3 name → current name table.
        - (i) Released `/docs` pages are pinned to root exports that Phase 1 removes. `src/__tests__/docs.test.ts:2021-2056` pins `createMiddlewareRegistry` in `docs/middleware-hooks.md`. List every such pin, so each Part B retirement task drops its pin rows while leaving the released page untouched.
        - (j) `createSecureAgent` (`src/secure-agent.ts:34`) requires `permission.check`. Record how Part B Task 2 re-expresses its readiness check: it requires at least one registered `tool.call` hook.
        - (k) The durable fingerprint (`src/agent-run-state.ts:170-205`) includes guardrail names and revisions. Record what replaces them: hook registration ids and `LoopStrategy.revision`.
    - Functional: The verdict is one of:
      - *proceed as written*
      - *proceed with amendments*: the amendments are listed and applied to this plan or Part B in the same change
      - *stop and re-cut*: a finding invalidates the task structure
    - Performance: n/a — read-only.
    - Code Quality: Every claim cites `file:line` or a `graft callers` output. No improvised seams: a gap goes to a finding, never into a later task's approach.
    - Security: Confirm the §1.4 fail-closed list items that Phase 1 owns, and the error code each gets:
      - an unknown hook name
      - a slot conflict
      - a throwing gate hook (a deny)
      - a throwing transform or decide hook (a run failure that names the owner and hook)
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.2, §1.4, §2.1–§2.5, Phase 1–3 scopes, and Part 3 "In-flight work"
      - `PRODUCT.md`
      - `plans/142` Task 1 Notes, for the precedent of a review finding that rewrote a later task
    - Options Considered:
      - Skip the review, because the roadmap is detailed. Rejected: Phase 1 removes twelve config fields with callers in seven workspaces, and plan 142 showed that unverified assumptions (the duplicate-tool default) break later tasks.
      - One review per part. Rejected: Part B's classification depends on the same inventory. Part B Task 1 re-verifies only the caller map after Part A lands.
    - Chosen Approach:
      - Survey with `graft ask … --source` and `graft callers <symbol> --depth all` for every retiring symbol:
        - `MiddlewareRegistry`, `Guardrails`, `PermissionPolicy`, `StopHook`, `TurnPolicyOptions`
        - `ProviderRequestPolicy`, `InstructionInjector`, `ContextProvider`, `ToolNarrowing`
        - `InputBuilder`, `PromptBuilder`, `CompactionStrategy`, `CompactionTrigger`
        - `AgentLoopStrategy`, `LoopContext`
      - Record the findings as tables.
    - API Notes and Examples:
      ```bash
      graft callers AgentLoopStrategy --depth all
      grep -rnE "from ['\"]@arnilo/prism-" src --include='*.ts' | grep -v __tests__
      ```
    - Files to Create/Edit:
      - `plans/144-Phase-1-Part-A-Hook-Bus-Slots-And-Loop-Primitives.md`: Task 1 Notes, plus amendments if any.
      - `plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md`: amendments only, if any.
    - References:
      - `src/middleware.ts`, `src/guardrails.ts`, `src/agent-loops.ts`, `src/agent-session/session/{assemble,provider-round,tool-round}.ts`, `src/agent-approval.ts`, `src/extensions.ts:334-363`
  - Test Cases to Write:
    - n/a — read-only. The Notes are the deliverable.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. This is a read-only review.
    - Docs pages to create/edit: none. Findings live in the plan.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-09-30):
    - **Verdict: proceed with amendments.** Three amendments, applied below. No finding invalidates the task structure.

    - **Inventory** (contract → roadmap section → current code):

      | Contract | Roadmap | Current code |
      | --- | --- | --- |
      | `AgentEvent` / `AgentEventPayload` | §2.3 "Events", §2.4 observe | `src/contracts-protocol.ts:227` (payload union), `:459` (`AgentEvent`) |
      | Hook bus (four kinds, catalog) | §2.4 | none; `MiddlewareRegistry` (`src/middleware.ts:110-164`) is the nearest analogue |
      | `AgentConfig.store` | §2.5 slot `store` | `src/contracts-core/agent.ts:117`; `SessionStore` (`src/contracts-core/persistence.ts`) |
      | `AgentConfig.compaction` | §2.5 slot `compaction` | `src/contracts-core/agent.ts:136`; `CompactionStrategy`/`CompactionTrigger` (`src/contracts-core/compaction.ts:6-90`); default `src/compaction.ts:12` |
      | `AgentConfig.loop`, `RunOptions.loop`, `AgentDefinition.loop` | §2.5 loop slot | `src/contracts-core/agent.ts:35,144`; `src/contracts-protocol.ts:136` |
      | `AgentLoopStrategy` / `LoopContext` | §2.5 `RunController` | `src/contracts-core/loop.ts:77-134` |
      | `ToolDefinition` | §2.6 "Tools" | `src/contracts-protocol.ts:492-502` |
      | `HostPort` / `HostUi` | §2.3 "Host port" | none — kernel addition |
      | Durable interrupt | §2.4 ask path | `runState.checkpoints` (`src/contracts-core/persistence.ts:86`), `interruptBeforeTool` (`src/contracts-core/run-state.ts:217`), `AgentRunSuspended` (`src/agent-approval.ts:280`), `session.resumeDurable` (`src/agent-session/session.ts:424`) |

    - **Classification — §2.4 "Replaces" entries.** Every entry is *expressible* as a hook; the bus, slots, `RunController`, `HostUi`, and `effects` are the kernel additions (table below). No 0.12 mechanism needs a different seam than the one §2.4 names.

      | Replaces (0.12.1) | Catalog hook | Current call site |
      | --- | --- | --- |
      | input guardrails, `InputBuilder` | `run.input` | `src/agent-session/session/assemble.ts:368`; `src/input.ts` (`assembleProviderInput` reads `inputBuilder`) |
      | `TurnPolicyOptions.stop`, cost policy | `turn.before` | `src/agent-session/session/assemble.ts:239-265` (`evaluateTurnPolicy`), asserted `:724` |
      | `InstructionInjector` | `context.build` | `src/instruction-injection.ts`; consumed in `src/input.ts` |
      | `ContextProvider` | `context.build` | `src/input.ts:176` (`context` middleware) |
      | `ToolNarrowing` | `context.build` | `src/agent-session/session/assemble.ts:480,503-527` |
      | skills catalog | `context.build` (owner `kernel`) | `src/input.ts` skill disclosure |
      | `PromptBuilder` | `context.build` | `src/input.ts:371` (`prompt_build` middleware) |
      | `ProviderRequestPolicy`, `provider_request` middleware | `model.request` | `src/agent-session/session/assemble.ts:615-617` |
      | deterministic turns (`beforeProviderTurn`), routing, caching | `model.call` | `src/agent-session/session/provider-round.ts:246-292`; `src/middleware.ts:19-89` |
      | output guardrails | `model.response` | `src/agent-session/session/provider-round.ts:445-463` |
      | `PermissionPolicy`, tool-input guardrails, approval | `tool.call` | `src/agent-session/session/tool-round.ts:360-438` (`permission:` at `:431`); `src/agent-approval.ts` |
      | sandbox / remote execution wrappers | `tool.execute` | none in 0.12 — no call site to retire |
      | tool-output guardrails | `tool.result` | `src/agent-session/session/tool-round.ts:360` (`runGuardrails` tool stages) |
      | redaction extensions | `message.append` | none — redaction runs inside `appendMessage` |
      | `StopHook` | `run.end` | `src/agent-session/session/assemble.ts:139,669-698` |
      | `CompactionTrigger` | `compaction.when` | `src/agent-session/session.ts:874`; `CompactionTrigger` (`src/contracts-core/compaction.ts`) |
      | extension event bus, `forwardAgentEvents` | observe hooks | `src/extensions.ts:291`; `AGENT_EVENT_BRIDGE` `:275-280` |

    - **Kernel additions** (kind, payload → result, combination, error policy, firing primitive, call site replaced):

      | Hook | Kind | Payload → result | Combination | Error policy | Primitive | Replaces call site |
      | --- | --- | --- | --- | --- | --- | --- |
      | `run.input` | transform | input messages → messages \| reject | ordered | throw = `HookError`, run fails | `run` start, before loop | `assemble.ts:368` |
      | `turn.before` | decide | turn counters, usage → `{ stop }` | any stop | throw fails closed | `turn()` | `assemble.ts:239-265` |
      | `context.build` | transform | `ContextDraft` → draft | ordered | throw fails closed; `onError:"ignore"` opts out | `turn()` | `input.ts:176,317,340,350,371` |
      | `model.request` | transform | `ModelRequest` → request | ordered | throw fails closed | `turn()` | `assemble.ts:615-617` |
      | `model.call` | around | request, next → stream | nested by priority | throw fails the operation | `turn()` | `provider-round.ts:246-292` |
      | `model.response` | transform | assistant message → message \| reject | ordered | throw fails closed | `turn()` | `provider-round.ts:445-463` |
      | `tool.call` | decide | `{ name, args, effects, session }` → allow/deny/ask/rewrite/respond | deny > ask > rewrite > respond > allow | throw = deny naming owner+hook | `executeTools()` | `tool-round.ts:360-438` |
      | `tool.execute` | around | call, next → `ToolResult` | nested by priority | throw fails the operation | `executeTools()` | none |
      | `tool.result` | transform | `ToolResult` → result | ordered | throw fails closed | `executeTools()` | `tool-round.ts:360` |
      | `message.append` | transform | message → message | ordered | throw fails closed | `append()` / `turn()` / `executeTools()` | none |
      | `run.end` | decide | transcript view → `{ stop }` \| `{ continue }` | first continue wins, capped | throw fails closed | `end()` | `assemble.ts:139,669-698` |
      | `compaction.when` | decide | context estimate → `{ compact }` | any compact | throw fails closed | compaction check point | `session.ts:874` |
      | every `AgentEvent["type"]` | observe | event | fan-out | throw → `hook.error`, run continues | `emit()` sites | `extensions.ts:291` |

      Kernel additions with no 0.12 equivalent: the bus itself (`src/hooks/`), the slot registry and four contracts (`src/slots/`), `RunController` + `defaultLoop` (`src/loop/`), `HostPort`/`HostUi` (`src/host/`), and `ToolDefinition.effects`.

    - **Middleware mapping** (`src/middleware.ts:4-16`, 12 members):

      | `MiddlewareHookName` | Target | Current call site |
      | --- | --- | --- |
      | `beforeProviderTurn` | `model.call` (around, may skip `next`) | `provider-round.ts:248` |
      | `provider_request` | `model.request` | `assemble.ts:617` |
      | `input_assembly` | `context.build` (or `run.input`) | `input.ts:317,340,350` |
      | `prompt_build` | `context.build` | `input.ts:371` |
      | `context` | `context.build` | `input.ts:176` |
      | `tool_call` | **deleted, no replacement** — no kernel `.run("tool_call")` exists; only the `AGENT_EVENT_BRIDGE` notification (`extensions.ts:275`) | none |
      | `tool_result` | **deleted, no replacement** — same bridge notification (`extensions.ts:276`) | none |
      | `retry` | **deleted, no replacement** — kernel retry stays; `RetryPolicy` is not a hook | `provider-round.ts:328` |
      | `compaction_request` | `compaction.when` + `compaction` slot | `session.ts:874` |
      | `compaction` | `compaction` slot | `session.ts:877` |
      | `session_start` | observe on the session event | `session.ts:495` |
      | `session_shutdown` | observe on the session event | `session.ts:507` |

    - **Assumption checks:**
      - **(a) Confirmed.** `grep -rnE "from ['\"]@arnilo/prism-" src --include='*.ts' | grep -v __tests__` → no hits; no dynamic `import('@arnilo/prism-*')` either. 265 hits total, all in `__tests__`. Task 2's gate is sound; `src/testing/state-concurrency-conformance.ts` names packages only in comments.
      - **(b) Confirmed with a path correction.** The symlink is the repo-root `node_modules/@arnilo/prism -> ../..`, not a per-package one (`packages/*/node_modules/@arnilo/` is empty; Bun hoists). Effect holds: every family package compiles against the workspace kernel, so each retired field breaks their typecheck and must be migrated in the same task.
      - **(c) Confirmed for the function; refuted for the options form.** `generateValidateReviseLoop` has no caller outside `src/` and tests (`src/agent-loops.ts:96,408`; `src/__tests__/{agent-loops,durable-loops}.test.ts`). But the `generate-validate-revise` *options form* is also used by `examples/crew-hierarchy.ts:452`, which Task 4 did not list. Amendment 2 adds it.
      - **(d) Confirmed, list pasted.** Type/option callers: `packages/agent-sdk/src/define-agent.ts:5-6,86`; `packages/agent-sdk/src/config.ts:59,119,406,452-457` (string `loop` field); `packages/prism-code/src/limits.ts:1,60,172,234`; `examples/durable-loops-and-approvals.ts:2,20`; `examples/spawn-agent-tool.ts:119`; `examples/crew-hierarchy.ts:452`; `examples/host-artifact-loop.ts:225`; `src/{agent-loops,agent-run-state,structured-output,contracts-protocol,contracts-core/agent,contracts-core/resources,index}.ts`; `src/agent-session/helpers.ts:119`; `src/agent-session/session/types.ts:89,190,207`; `src/agent-session/session/{assemble,tool-round}.ts`; `scripts/phase17-freeze.test.mjs:88`; `packages/ag-ui/src/__tests__/acp-agent.test.ts`; `packages/agent-sdk/src/__tests__/define-agent.test.ts`.
      - **(e) Confirmed. Verdict stands.** `CheckpointStore` (`src/contracts-core/persistence.ts:86`) backs `runState.checkpoints`; `AgentRunSuspended` (`src/agent-approval.ts:280`) is thrown from `suspendGatedRound`/`suspendNested` (`tool-round.ts:241,287,484,579`) and caught in `assemble.ts:846`; `resumeDurable` (`session.ts:424`) re-enters `runInternal`. Task 5 retires `interruptBeforeTool` and keeps every-turn checkpoints + `runState.checkpoints` until roadmap Phase 3, as the default.
      - **(f) Confirmed.** Roadmap `limits.maxContinuations`; current `maxStopContinuations` (`src/contracts-core/run-limits.ts:28,45,49`; resolved `src/run-limits.ts:119-122`; capped `assemble.ts:674`). Roadmap wins; Part B Task 4 renames it with no alias.
      - **(g) Refuted — name collision.** `ToolEffectKind` already exists and is exported (`src/contracts-protocol.ts:461`, `"none" | "local_mutation" | "external_mutation"`; root `src/index.ts:234`; used in `src/contracts-run-state.ts:24,38`). Task 3's proposed `ToolEffectKind = "read" | …` collides. The recovery `effect` field and the new `effects` field can coexist; the *type name* cannot. Amendment 1 renames the new type.
      - **(h) Confirmed, with a gap.** Phase 1 observe hooks use the current `AgentEvent["type"]` names (35: `agent_started`, `agent_finished`, `agent_suspended`, `agent_resumed`, `agent_denied`, `turn_started`, `turn_finished`, `deterministic_turn`, `provider_turn_started`, `provider_turn_finished`, `message_started`, `message_delta`, `message_finished`, `tool_execution_{started,progress,finished,error,blocked}`, `tool_narrowing_clamped`, `guardrail_decision`, `run_limit_exceeded`, `budget_exhausted`, `queue_updated`, `steer_rejected`, `event_subscriber_overflow`, `compaction_{started,finished,failed}`, `attention_compiled`, `retry_scheduled`, `error`, `artifact_{validation_started,validation_finished,revision_started,finished,failed}`). The §2.3 dotted names map as: `turn.started`→`turn_started`, `message.delta`→`message_delta`, `compaction.started`→`compaction_started`; `session.opened`→`session_started` (currently on `AgentSessionEvent`, not `AgentEvent`); `session.closed`→`session_closed` (same); the rest (`run.started/completed/failed/suspended`, `turn.completed`, `message.completed`, `tool.started/progress/completed`, `decision.pending/resolved`, `compaction.completed`, `background.*`, `hook.error`, `package.status`, `package.event`) have **no** current `AgentEvent` type. Task 2 must add `hook.error` and `package.event` to `AgentEventPayload` (the bus emits `hook.error`; `emit()` emits `package.event`). The remaining dotted names land in roadmap Phase 3. Amendment 3.
      - **(i) Confirmed, pin list recorded.** Released `/docs` pages pinned to removed exports in `src/__tests__/docs.test.ts`:
        - **Part A Task 4 (loop):** `agent_loops_docs_cover_loop_strategies_and_artifact_contracts` (`:3762-3800`: barrel `singleShotLoop`, `generateValidateReviseLoop`, `resolveLoop`, `isAgentLoopOptions`; page `docs/agent-loops.md` `AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, `ArtifactValidation`, `ArtifactContext`, `ArtifactParser`, `ArtifactValidator`, `ArtifactRepairer`, `RunOptions.loop`, `AgentConfig.loop`, `generate-validate-revise`, `maxRevisions`; page `docs/public-contracts.md` `AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, `ArtifactValidation`, `ArtifactValidator`); `agent_events_docs_cover_artifact_variants` (`:3821-3822`: `docs/agent-events.md` `singleShotLoop`, `generateValidateReviseLoop`); `structured_output_docs_cover_parser_validator_repairer` (`:3833-3841`: `docs/structured-output.md` `Artifact*`, `generate-validate-revise`, `maxRevisions`); `docs/customization.md` block (`:2205-2206`: `singleShotLoop`, `generateValidateReviseLoop()`); `docs/multi-agent-patterns.md` block (`:1705`: `ArtifactValidator`).
        - **Part B Task 2 (tool gates):** `docs/tools.md` block (`:3664-3667`: `PermissionPolicy`, `toolNarrowing`, `allowHiddenToolCalls`); `docs/host-security.md` block (`:2242`, `:2258`: `createStaticPermissionPolicy`, "Permission checks happen before tool validation").
        - **Part B Task 3 (model path):** `documentedExports` row `["docs/input-and-prompt-assembly.md","createDefaultInputBuilder"]` (`:2042`); `docs/customization.md` block (`:2202-2203`: `createDefaultInputBuilder()`, `createDefaultPromptBuilder()`); `docs/extension-authoring.md` block (`:2304-2305`: `registerInputBuilder`, `registerPromptBuilder`); `docs/compaction-and-retry.md` block (`:2105`: `RetryMiddlewarePayload`); `docs/custom-builders` example assertions (`:3263-3266`).
        - **Part B Task 4 (context/run control):** `documentedExports` row `["docs/context-and-skills.md","resolveContextProviders"]` (`:2045`); `docs/customization.md` block (`:2199`, `:2204`: `resolveContextProviders()`, `resolveInstructionInjectors()`); `docs/extension-authoring.md` block (`:2302`: `registerContextProvider`); `docs/instruction-injection.md` block (`:3862-3871`: `InstructionInjector`, `registerInstructionInjector`, `resolveInstructionInjectors`, `AgentConfig.instructionInjectors`, `RunOptions.instructionInjectors`).
        - **Part B Task 5 (compaction / middleware):** `documentedExports` row `["docs/middleware-hooks.md","createMiddlewareRegistry"]` (`:2035`) and `["docs/compaction-and-retry.md","createDefaultCompactionStrategy"]` (`:2053`); `compaction and retry docs` block (`:2083`: `createDefaultCompactionStrategy`; `:2113`: middleware `invokes retry`); `docs_middleware_hooks_match_runtime_supported_hooks` (`:2946-2975`, pins `src/middleware.ts` + `docs/middleware-hooks.md`); `docs/extension-authoring.md` block (`:2306`: `registerCompactionStrategy`); `docs/customization.md` block (`:2207`: `createDefaultCompactionStrategy()`).
        Each task drops only its pin rows; the released pages stay untouched.
      - **(j) Confirmed.** `createSecureAgent` requires `options.permission.check` (`src/secure-agent.ts:35`); `host-composition.ts:270,348-349` reports the same readiness. Part B Task 2 re-expresses this as "at least one host `tool.call` registration", failing with `HostCompositionError` / `ERR_PRISM_HOST_COMPOSITION` (`host-composition.ts:11,383`).
      - **(k) Confirmed.** `agentFingerprint` includes `guardrails.map(({ name, stage, revision }))` and `loop: { name, revision }` (`src/agent-run-state.ts:196-205`). Replacement: hook registration ids (owner-scoped) and `LoopStrategy.name`/`revision`.

    - **Security — §1.4 fail-closed items Phase 1 owns:**
      - unknown hook name → `UnknownHookError` / `ERR_PRISM_UNKNOWN_HOOK` (Task 2).
      - unknown slot name → `ERR_PRISM_UNKNOWN_SLOT` (Task 4).
      - slot conflict → `SlotConflictError` / `ERR_PRISM_SLOT_CONFLICT`, naming both owners (Task 4).
      - throwing gate hook (a deny) → `tool.call` throw is returned as a deny naming owner+hook (Task 2).
      - throwing transform / decide → `HookError` naming owner+hook; decide throws fail closed (Task 2).
      - absent `HostUi` → `{ status: "unavailable" }` (Task 4).

    - **Amendments applied:**
      1. **Task 3 — type-name collision.** The new annotation type is `ToolCapabilityKind`, not `ToolEffectKind`, because the recovery type already owns that name (`src/contracts-protocol.ts:461`). The `effects` field, its values, and `resolveToolEffects` are unchanged.
      2. **Task 4 — caller/retirement list.** Add `examples/crew-hierarchy.ts`, `scripts/phase17-freeze.test.mjs`, `src/agent-session/helpers.ts`, `src/agent-session/session/types.ts`, `packages/ag-ui/src/__tests__/acp-agent.test.ts`, and `packages/agent-sdk/src/__tests__/define-agent.test.ts`; add `AgentDefinition.loop` (`src/contracts-core/agent.ts:35`) to the retirement list.
      3. **Task 2 — observe-hook naming.** Phase 1 observe hooks are the 35 current `AgentEvent["type"]` names; add `hook.error` and `package.event` to `AgentEventPayload` so the bus and `emit()` have a typed event. The §2.3 dotted names land in roadmap Phase 3.

- [x] Task 2: Hook bus and catalog types, the kernel import gate, and the `docs/next/` bootstrap
  - Acceptance Criteria:
    - Functional: `src/hooks/` provides a kernel-internal `createHookBus()` and the public types `HookRegistrar`, `HookName`, `HookCatalog`, `HookOptions`, `HookRegistrationInfo`, and the per-hook payload and result types.
      - **Registration.** `on(name, handler, { priority?, id?, onError? })`.
      - **Ids.** Each registration id is `<owner>:<hook>[#<id>]`.
      - **Ordering.** Higher `priority` runs first. Ties run in registration (load) order.
      - **observe.** Handlers are invoked synchronously, in order, and never awaited. A throw, or a rejected returned promise, becomes a `hook.error` event, and the run continues. This covers the `message_delta` hot path.
      - **transform.** Handlers run in order. Returning `undefined` keeps the current value. Returning `ctx.reject(reason)` stops the chain with `HookRejectedError`. A throw fails with `HookError`, which names the owner and hook. `onError: "ignore"` downgrades a throw to a `hook.error` event and keeps the value.
      - **decide.** Each hook uses its catalog combination rule:
        - `turn.before`: any `{ stop }` stops.
        - `tool.call`: the first deny short-circuits; otherwise any ask wins; otherwise rewrites apply in order; otherwise the first respond wins; otherwise allow.
        - `run.end`: the first `{ continue }` wins.
        - `compaction.when`: any `{ compact: true }` triggers.
        - A throw fails closed (`HookError`). For `tool.call`, a throw is returned as a deny whose reason names the owner and hook.
      - **around.** Handlers nest by priority, with the highest priority outermost. `next` may be called zero or one times. A second call throws `HookError` with code `ERR_PRISM_HOOK_NEXT_REENTRY`.
    - Functional: Fail-closed cases, each with its own code:
      - an unknown hook name: `UnknownHookError` / `ERR_PRISM_UNKNOWN_HOOK`
      - a duplicate registration id: `ERR_PRISM_HOOK_DUPLICATE_ID`
      - `onError` on a non-transform hook: `ERR_PRISM_HOOK_OPTION`
      - a non-function handler: `ERR_PRISM_HOOK_OPTION`
      - a non-finite priority: `ERR_PRISM_HOOK_OPTION`
    - Functional: The catalog holds exactly the §2.4 hooks plus one observe hook per `AgentEvent["type"]`, using the names recorded in Task 1(h). It is exported as a frozen `HOOK_CATALOG` table of `{ name, kind }`.
      - `hook.error` and `package.event` are added to `AgentEventPayload` in this task (Task 1(h)): the bus emits `hook.error`, and `RunController.emit()` emits `package.event`. The remaining §2.3 dotted names land in roadmap Phase 3.
    - Functional: `src/__tests__/kernel-imports-no-package.test.ts` scans `src/**/*.ts`, excluding `src/__tests__/`. It fails on any `import`, `export … from`, or dynamic `import()` of `@arnilo/prism-*`.
    - Functional: The first `docs/next/` plan chores (prism-wiki.md), all in this task:
      - `docs/next/**` is excluded from the "index links point to existing local markdown files" and every-page-is-indexed checks in `src/__tests__/docs.test.ts`.
      - `!docs/next` is added to the root `package.json` `files` list.
      - `packaging.test.ts` asserts that `docs/next` is absent from `npm pack --dry-run`.
    - Performance:
      - Registering hooks is O(1) per registration, and handler lists sort once at first dispatch.
      - Dispatch with zero handlers allocates nothing. A benchmark-free test asserts that `observe` with no handlers returns synchronously.
      - Observe handlers never delay the run.
    - Code Quality:
      - Kernel placement (§2.1 "Hooks"). This is the roadmap's named kernel addition, so no further proof is needed.
      - No runtime dependency is added.
      - Payload and result types are derived from `HookCatalog[name]`, with no `any` in public signatures.
      - `createHookBus` is not exported from the root. Hosts reach the bus only through `AgentConfig.hooks` (Task 4).
    - Security:
      - Error messages and `hook.error` events pass through the existing redactor (`src/redaction.ts`). A test registers a throwing handler whose message contains a known secret and asserts the secret does not appear in the event or the error.
      - Owner names are strings the kernel sets. A handler cannot choose its owner.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (kinds, catalog, ordering, ids) and §1.4 (fail closed)
      - `src/middleware.ts:110-164`: the current ordered-middleware runner. Its `next` chaining is reused as the idea for `around`.
      - `src/redaction.ts`: the redactor used for error text.
      - `src/__tests__/docs.test.ts:250,268`: the index and page scans to amend.
    - Options Considered:
      - Extend `MiddlewareRegistry` into the bus. Rejected: its single `(value, next)` shape cannot express decide combination or never-awaited observers, and Part B deletes it.
      - Make hook names open strings, validated at runtime. Rejected: §2.4 requires the payload and result types to come from the name. An open string loses that and admits typos until runtime.
      - Run observe handlers asynchronously in a microtask. Rejected: §2.4 requires `message.delta` observers to run synchronously. Synchronous invocation without awaiting satisfies both rules.
    - Chosen Approach:
      - A typed catalog interface keyed by hook name, a single bus with one dispatch function per kind, and the per-hook combination rules in a table beside the catalog, so Part B and Phase 2 extend data rather than control flow.
    - API Notes and Examples:
      ```ts
      export interface HookRegistrar {
        on<N extends HookName>(name: N, handler: HookHandler<N>, options?: HookOptions): void;
      }
      export interface HookOptions { readonly priority?: number; readonly id?: string; readonly onError?: "ignore" }
      // transform: (value, ctx) => value | undefined | ctx.reject("reason")
      // decide (tool.call): (call, ctx) => "allow" | { deny: string } | { ask: string } | { rewrite: JsonObject } | { respond: ToolResult } | undefined
      // around (model.call): (request, next, ctx) => AsyncIterable<ProviderEvent>
      ```
    - Files to Create/Edit:
      - `src/hooks/{bus,catalog,types,errors,index}.ts`: new.
      - `src/contracts-protocol.ts`: export `AgentEventPayload`; add the `hook.error` and `package.event` members; define `ToolCapabilityKind` (the `tool.call` payload's capability type; Task 3 adds the `ToolDefinition.effects` field that carries it).
      - `src/index.ts`: export the public hook types, `HOOK_CATALOG`, `HookError`, `HookRejectedError`, and `UnknownHookError`.
      - `src/__tests__/{hook-bus,kernel-imports-no-package}.test.ts`: new.
      - `src/__tests__/agent-event-source.test.ts`: classify the two new event types in the exhaustive terminal table.
      - `src/__tests__/public-export-contract.test.ts`: add the new names to the frozen lists deliberately.
      - `src/__tests__/docs.test.ts`: `docs/next/` exclusions.
      - `src/__tests__/packaging.test.ts`: assert `docs/next` is not packed.
      - `package.json`: `files` gains `!docs/next`.
      - `docs/next/hooks.md`: new.
      - `CHANGELOG.md`: `## [Unreleased]` entry.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerated.
      - `scripts/e2e-coverage.json`: add the two new suites under `@arnilo/prism` `.`.
    - References:
      - `roadmap.md` §2.4
      - `.agents/skills/create-plan/references/prism-wiki.md` ("first plan that creates `docs/next/`")
  - Test Cases to Write:
    - `hook_bus_orders_by_priority_then_load_order`: fails if ties reorder or priority is inverted.
    - `observe_throw_emits_hook_error_and_never_fails`: fails if a throwing observer rejects the dispatch.
    - `observe_is_synchronous_and_not_awaited`: a handler that returns a never-resolving promise does not block dispatch.
    - `transform_undefined_keeps_value_and_reject_stops_chain`
    - `transform_throw_fails_closed_naming_owner_and_hook`: asserts `HookError.owner` and `.hook`.
    - `transform_on_error_ignore_keeps_value`
    - `decide_tool_call_deny_wins_over_ask_and_allow`: a deny at low priority still wins over an earlier ask.
    - `decide_tool_call_throw_is_deny`
    - `decide_tool_call_rewrites_apply_in_order_then_first_respond`
    - `decide_run_end_first_continue_wins`
    - `decide_turn_before_any_stop_stops` and `decide_compaction_when_any_compact`
    - `around_nests_highest_priority_outermost`, `around_may_skip_next`, and `around_next_twice_throws`
    - `unknown_hook_and_bad_options_fail_closed`: one assertion per code.
    - `hook_error_text_is_redacted`
    - `kernel_imports_no_package`: fails if any non-test `src/` file imports `@arnilo/prism-*`.
    - `docs_next_is_not_packed_and_not_indexed`: `package.json` excludes `docs/next`, the page is not indexed, and `packaging.test.ts` asserts it is not packed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New kernel types and error classes.
    - Docs pages to create/edit:
      - `docs/next/hooks.md`: API page structure. It includes the kinds table, the full catalog (payload → result, combination, error policy), ordering, ids, and the security notes (redaction, fail closed).
      - `CHANGELOG.md`: an Unreleased "Added" entry.
    - `docs/index.md` update: no (`docs/next/` pages are not indexed during the train).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: run `node scripts/release.mjs gate --update-baseline`. Paste the `scripts/compat-baseline/arnilo__prism.txt` diff in the task note. Additions are attributed to this plan; removals are expected to be none, and any that appear are listed as inherited. Then `node scripts/release.mjs gate` exits 0.
  - Notes (executed 2026-09-30):
    - **What changed.** New `src/hooks/{types,catalog,errors,bus,index}.ts`: a typed four-kind bus (`observe`/`transform`/`decide`/`around`), the frozen `HOOK_CATALOG` (12 named hooks + 39 observe hooks, one per `AgentEvent["type"]`), a `HOOK_COMBINATION` rule table, and `HookError` / `HookRejectedError` / `UnknownHookError`. `AgentEventPayload` is now exported and gains `hook.error` and `package.event` (both carry `sessionId`/`runId`). `ToolCapabilityKind` is defined beside `ToolEffectKind`. Root exports the public hook types, `HOOK_CATALOG`, and the error classes; `createHookBus` stays module-internal. New tests: `hook-bus.test.ts` (18 cases) and `kernel-imports-no-package.test.ts`. `docs/next/hooks.md` is staged and excluded from indexing, link-checking, and the tarball.
    - **Findings affecting later tasks.**
      - `ToolCapabilityKind` landed in Task 2 (the `tool.call` payload needs it); Task 3 now only adds the `ToolDefinition.effects` field and validation.
      - Every `AgentEvent` now includes `hook.error` and `package.event`. The only exhaustive consumer was the terminal table in `agent-event-source.test.ts`; both are classified non-terminal there.
      - `HOOK_CATALOG` is a frozen `Record<HookName, { kind }>` keyed by name (the name is the key), not an array of `{ name, kind }`.
      - Unnamed registrations of one hook may repeat (one owner can register several handlers); `ERR_PRISM_HOOK_DUPLICATE_ID` applies only to an explicit `id`.
      - `delegated_agent_step` was the 37th event type; with the two new members the observe catalog holds 39 hooks.
    - **Baseline diff (`arnilo__prism.txt`, +45).** Added values: `HOOK_CATALOG`, `HOOK_COMBINATION`, `HOOK_KINDS`, `OBSERVE_HOOK_NAMES`, `HookError`, `HookRejectedError`, `UnknownHookError`, `createHookBus`. Added types: `AroundHook`, `AroundHookName`, `CompactionWhenDecision`, `CompactionWhenPayload`, `ContextDraft`, `DecideCombination`, `DecideHook`, `DecideHookName`, `HookBus`, `HookBusOptions`, `HookCatalog`, `HookCatalogEntry`, `HookContext`, `HookDecision`, `HookHandler`, `HookKind`, `HookKindOf`, `HookName`, `HookOptions`, `HookPayload`, `HookRegistrar`, `HookRegistrationInfo`, `HookRejection`, `HookResult`, `NamedHookCatalog`, `NamedHookName`, `ObserveHook`, `ObserveHookName`, `RunEndDecision`, `RunEndPayload`, `ToolCallDecision`, `ToolCallHookPayload`, `ToolExecuteHookPayload`, `TransformHook`, `TransformHookName`, `TurnBeforeDecision`, `TurnBeforePayload`. `createHookBus`/`HookBus*` appear only because the extractor walks every `dist/**.d.ts`; they are not root-index exports. Removals: none.
    - **Inherited baseline churn.** `arnilo__prism-agent-sdk.txt` (+21/-5) and `arnilo__prism-code.txt` (+1/-1) were regenerated from the in-flight plan-142 source (`AgentSdkDefinition` → `Agent`, re-exported prism types); not this task.
    - **Pre-existing red (not this task).** `packaging.test.ts > @arnilo/prism-agent-sdk > makes @arnilo/prism a required (non-optional) peer dependency` fails because the in-flight agent-sdk manifest moved `@arnilo/prism` into `dependencies`.
    - **Checks.** `bunx tsc --noEmit -p tsconfig.json` clean; workspace typechecks and `tsc -p examples --noEmit` clean; `hook-bus`, `kernel-imports-no-package`, `docs`, `public-export-contract`, `agent-event-source`, `agent-event-bridge`, `core-boundaries`, `runtime-redaction`, `attention-compiler-events`, and the `scripts/*` release/coverage suites pass; `node scripts/release.mjs gate` exits 0.

- [x] Task 3: `ToolDefinition.effects` annotation
  - Acceptance Criteria:
    - Functional:
      - `ToolDefinition.effects?: readonly ToolCapabilityKind[]`, where `ToolCapabilityKind = "read" | "write" | "execute" | "network" | "external"`. The type landed in Task 2 (`src/contracts-protocol.ts`, beside `ToolEffectKind`); this task adds the field that carries it and the validation.
      - Registry validation rejects an unknown kind, a duplicate kind, or a non-array value, with `ToolDefinitionError` / `ERR_PRISM_TOOL_EFFECTS`.
      - A tool with no `effects` is reported to hooks as all five kinds. This is fail-closed: an effects-based deny matches an unannotated tool.
      - The field is independent of the recovery `effect` declaration (Task 1(g)).
    - Functional: Add `effects` to the kernel's own tools:
      - `load_skill` is `["read"]`.
      - `search_tools` is `["read"]`.
      - Any other kernel-registered tool that `graft grep "registerTool\|createLoadSkillTool"` finds is annotated too.
    - Performance: Validation runs once, at registration. There is no per-call cost.
    - Code Quality:
      - Kernel placement (§2.1 "Tools": "effect annotations").
      - The type lives beside `ToolDefinition` in `src/contracts-protocol.ts` (defined in Task 2).
      - Family-package tools are not annotated here. That happens when each moves to its native package (roadmap Phase 7).
    - Security: The all-kinds default for unannotated tools means a missing annotation never widens what an effects-based policy allows. `tool_effects_default_is_all_kinds` proves this.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 "Tools" and §2.9 (`approval` decides from effects)
      - `src/contracts-protocol.ts:492-502` (`ToolDefinition`)
      - `src/tools.ts` (registry validation)
    - Options Considered:
      - Default an unannotated tool to `[]`. Rejected: it fails open, because a "deny network" policy would allow an unannotated fetch tool.
      - Make `effects` required. Rejected: that breaks every family-package and test tool in one task, with no safety gain over the all-kinds default. Roadmap Phase 7 annotates the native tools.
    - Chosen Approach:
      - Optional, validated, with a fail-closed all-kinds default applied where the `tool.call` payload is built (Task 4).
    - API Notes and Examples:
      ```ts
      const fetchTool: ToolDefinition = { name: "fetch", parameters: {...}, effects: ["network"], execute };
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts`: the field and `ToolCapabilityKind`.
      - `src/tools.ts`: validation plus the exported `resolveToolEffects(tool)` helper.
      - `src/skill-load.ts` and `src/tool-search.ts`: annotate kernel tools.
      - `src/index.ts`: exports.
      - `src/__tests__/tool-effects-annotation.test.ts`: new.
      - `src/__tests__/public-export-contract.test.ts`
      - `docs/next/tools.md`: new.
      - `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism.txt`
      - `scripts/e2e-coverage.json`
    - References:
      - `src/tool-effects.ts` (recovery effects: a different concept; do not merge)
  - Test Cases to Write:
    - `tool_effects_rejects_unknown_duplicate_and_non_array`
    - `tool_effects_default_is_all_kinds`: fails if an unannotated tool resolves to `[]`.
    - `kernel_tools_declare_effects`: `load_skill` and `search_tools` resolve to `["read"]`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new `ToolDefinition` field.
    - Docs pages to create/edit:
      - `docs/next/tools.md`: API page covering `ToolDefinition` including `effects`, and the all-kinds default.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: `node scripts/release.mjs gate --update-baseline`. Paste the `arnilo__prism.txt` diff (additions: `resolveToolEffects` and the `effects` field) in the note.
  - Notes (executed 2026-09-30):
    - **What changed.** `ToolDefinition` gains `effects?: readonly ToolCapabilityKind[]`, independent of the recovery `effect` declaration. `src/tools.ts` adds `ToolDefinitionError` (`ERR_PRISM_TOOL_EFFECTS`), a registration-time `assertToolEffects`, and `resolveToolEffects(tool)`, which returns the annotation or a frozen all-kinds fallback. `createToolRegistry.register` is the only validation point. Kernel tools `load_skill` and `search_tools` are annotated `["read"]`. New test `src/__tests__/tool-effects-annotation.test.ts` (3 cases); staged API page `docs/next/tools.md`.
    - **Findings / corrections.**
      - The baseline additions are three names — `ToolCapabilityKind`, `ToolDefinitionError`, `resolveToolEffects` — not "`resolveToolEffects` and the `effects` field". The extractor captures only `export declare` locals and named re-exports, not interface members, so a new field on `ToolDefinition` does not appear in `arnilo__prism.txt`. The gate stayed clean (additions only, no `changed`).
      - `ToolCapabilityKind` was defined in Task 2 but deliberately not root-exported; it is now exported through its own `export type { ToolCapabilityKind } from "./contracts.js";` statement. Adding it to the existing large contracts re-export block would have changed that statement's signature and flagged every name it exports as `changed`.
      - `resolveToolEffects` is a pure default and does not re-validate, so there is no per-call cost (plan requirement). A tool that bypasses `createToolRegistry` still reports its declared array; registration is the trust boundary.
      - The only other `ToolDefinition`-shaped objects in `src/` (`descriptorTool` in `contributions.ts`, `toolDescriptor` in `node/agent-definitions.ts`) are descriptor-only — `execute` throws — and are not registered kernel tools, so they are left unannotated (they resolve to all kinds).
    - **Checks.** `bunx tsc --noEmit -p tsconfig.json` clean; workspace typechecks and `tsc -p examples --noEmit` clean; `tool-effects-annotation`, `public-export-contract`, `docs`, `kernel-imports-no-package`, `tools`, `tool-search`, `tool-effects`, `skill-load`, `skills`, `skill-disclosure` suites pass; `node scripts/release.mjs gate` exits 0.

- [x] Task 4: Slot registry, `RunController`, `defaultLoop`, and agent wiring; retire the 0.12 loop contract
  - Acceptance Criteria:
    - Functional (slots): `src/slots/` provides a kernel-internal registry with exactly four slots.
      | Slot | Contract | Kernel default |
      | --- | --- | --- |
      | `loop` | `LoopStrategy` | `defaultLoop` |
      | `compaction` | `Compactor { compact(ctx): Promise<CompactionResult> }` | wraps `createDefaultCompactionStrategy` (`src/compaction.ts:12`); consumed from Part B Task 5 |
      | `store` | `SessionStore` | in-memory; the input is `AgentConfig.store` (header decision) |
      | `credentials` | `CredentialResolver { resolve(ref, ctx) }` | `env:NAME` only; a non-`env:` ref resolves `undefined` |
      - Each slot exposes `provide(impl)` and `default`.
      - Registering two providers for one slot, with no assignment, fails `createAgent` with `SlotConflictError` / `ERR_PRISM_SLOT_CONFLICT`, naming both owners.
      - An unknown slot name fails with `ERR_PRISM_UNKNOWN_SLOT`.
      - A direct implementation in `AgentConfig.slots` always wins over providers.
      - Until Phase 2, the only registrants are the kernel (defaults) and `host` (via `AgentConfig.slots`). Conflict detection is tested on the registry with two synthetic owners.
    - Functional (agent config):
      - `AgentConfig.hooks?: (hooks: HookRegistrar) => void` is called once in `createAgent` with an owner-`host` registrar. A throw fails `createAgent` closed.
      - `AgentConfig.slots?: { loop?: LoopStrategy; compaction?: Compactor; credentials?: CredentialResolver }`
      - `AgentConfig.host?: HostPort`, where `HostPort { ui?: HostUi }` and `HostUi.request({ kind: "confirm", title, detail? })` resolves to `{ status: "answered", value: boolean } | { status: "dismissed" } | { status: "unavailable" }`.
    - Functional (loop): `LoopStrategy { name; revision; run(run: RunController): Promise<void>; snapshot?(); restore?() }`.
      - `RunController` exposes `session`, `input`, `signal`, `limits`, `turn()`, `executeTools()`, `append()`, `end()`, and `emit()`, with exactly the §2.5 signatures.
      - `turn()` fires `turn.before`, then `context.build`, `model.request`, `model.call`, `model.response`, and `message.append`. `turn({ tools: false })` sends no tools. `turn({ tools: [...] })` narrows to that list.
      - `executeTools()` fires, for each call: `tool.call`, then `tool.execute`, `tool.result`, and `message.append`. Task 5 covers `ask` and suspension.
      - `append()` fires `message.append`. `end()` fires `run.end`. `emit()` emits a `package.event`-shaped event with owner `host` or `kernel`. `emit` is the only new event here; Phase 3 freezes the full catalog.
      - `run.input` fires once, at run start, before the loop.
      - `compaction.when` fires at the existing auto-compaction check point. Until Part B Task 5 it replaces the configured trigger while a handler is registered (the configured trigger is the fallback when no handler is registered).
    - Functional: `defaultLoop` is the §2.5 loop and preserves the 0.12 single-shot behavior. The existing agent-session suites pass unchanged, except for tests of retired loop options, which are deleted or rewritten onto `LoopStrategy`.
    - Functional: A custom `LoopStrategy` cannot run a tool except through `executeTools`. `RunController` exposes no dispatch, registry, or provider handle, and a test asserts the controller's own keys.
    - Functional: `turn.before` `{ stop }` ends the run cleanly with `stopReason: "hook_stop"` and a resumable state. `run.end` `{ continue }` re-enters, capped by the continuation limit (Task 1(f)). Past the cap, the run stops with `stopReason: "hook_limit"`.
    - Functional (retirement): delete these in this task, with no alias:
      - `AgentConfig.loop`, `RunOptions.loop`, and `AgentDefinition.loop`
      - `AgentLoopStrategy`, `AgentLoopOptions`, and `LoopContext`
      - `generateValidateReviseLoop`, `isAgentLoopOptions`, and `resolveLoop` (`src/agent-loops.ts`)
      - `ArtifactValidator`, `ArtifactParser`, and `ArtifactRepairer`, unless Task 1 finds another kernel user
      - `resolveToolConcurrency`'s loop-option input. The concurrency option moves to `executeTools(calls, { concurrency })`.
      - `examples/host-artifact-loop.ts` and its `examples/README.md` and `scripts/e2e-coverage.json` rows
    - Functional (callers): update every caller from Task 1(d) in this task:
      - `packages/agent-sdk/src/{config,define-agent}.ts`: its `loop` plane maps onto `slots.loop`.
      - `packages/prism-code/src/limits.ts`
      - `examples/{durable-loops-and-approvals,spawn-agent-tool,crew-hierarchy}.ts`
      - the family-package tests listed in Task 1(d): `packages/ag-ui/src/__tests__/acp-agent.test.ts` and `packages/agent-sdk/src/__tests__/define-agent.test.ts`
      - `src/run-bundle.ts`, `src/structured-output.ts`, `src/agent-session/helpers.ts` (`isDurableLoop`), and `src/agent-session/session/types.ts`
      - `scripts/phase17-freeze.test.mjs` (`LoopContext` module pin)
      - The durable fingerprint takes `LoopStrategy.name` and `revision`.
    - Functional (sweep): `grep -rnE "AgentLoopStrategy|AgentLoopOptions|LoopContext|generateValidateReviseLoop|generate-validate-revise|single-shot" src packages scripts examples docs --include='*.ts' --include='*.mjs' --include='*.json'`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, and released `/docs` pages. The only hits allowed are released `/docs` prose (for example `docs/agent-loops.md`). Drop the `docs.test.ts` pin rows that tie a released page to a removed export (Task 1(i)), and leave the page itself untouched.
    - Performance: No extra provider request, store write, or allocation per turn when no hooks are registered. `turn()` wraps the existing `assemble` → `generateWithRetry` → append path (`src/agent-session/session/{assemble,provider-round}.ts`) instead of duplicating it. The existing turn-latency and prefix-stability suites stay green.
    - Code Quality:
      - Kernel placement (§2.1 "Loop", "Slots").
      - `src/loop/` owns `RunController` and `defaultLoop`. `src/agent-loops.ts` is deleted, or reduced to the tool-ordering helpers `RunController.executeTools` uses, moved into `src/loop/`.
      - Old mechanism call sites inside the primitives stay as they are (see the header's transitional overlap). There is no adapter layer.
    - Security:
      - The loop slot cannot bypass gates. `executeTools` is the only path to `dispatchToolCall`, and `turn` is the only path to provider generation, both asserted by test.
      - `HostUi` is optional. Without it, a `confirm` resolves `{ status: "unavailable" }`.
      - Slot conflicts fail closed.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.5 (primitives, default loop, slots) and §2.3 (`hooks`, `slots`, `host`)
      - `src/contracts-core/loop.ts:80-138`
      - `src/agent-loops.ts:38-79` (single-shot run) and `:304-363` (ordered dispatch)
      - `src/agent-session/session/assemble.ts:669-698` (`runLoopWithStopHooks`)
      - `src/agent-session/session/tool-round.ts:397-505` (`bindDispatchToolCall`)
      - `src/compaction.ts:12`
      - `src/credentials.ts:75`
    - Options Considered:
      - Keep `LoopContext` and add hooks inside it. Rejected: `LoopContext` exposes `dispatchToolCall` and `generate` directly, which is exactly the bypass §1.4 forbids.
      - Split the slot registry into its own task before the loop. Rejected: the only slot consumed in Part A is `loop`, and a registry without its consumer cannot be tested end to end. The other three contracts are small and land here so the registry and conflict rules are complete in one change.
      - Move `AgentConfig.store` to `slots.store` now. Rejected: about 100 caller files churn, and roadmap Phase 3 rewrites `createAgent` anyway (header decision).
    - Chosen Approach:
      - Build `RunController` over the existing session internals, so each primitive is a thin, hook-firing wrapper around code that already passes the runtime suites. Then express `defaultLoop` on it, and replace `AgentConfig.loop` with the slot in the same change.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({
        model,
        hooks: (hooks) => hooks.on("tool.call", (call) => (call.effects.includes("network") ? { deny: "offline" } : undefined)),
        slots: {
          loop: {
            name: "plan-then-act",
            revision: "1",
            async run(run) {
              await run.turn({ tools: false, system: "Plan." });
              for (;;) {
                const t = await run.turn();
                if (t.stopped || t.toolCalls.length === 0) return;
                await run.executeTools(t.toolCalls);
              }
            },
          },
        },
      });
      ```
    - Files to Create/Edit:
      - `src/slots/{registry,contracts,defaults,index}.ts`: new.
      - `src/loop/{types,run-controller,default-loop,index}.ts`: new.
      - `src/host/{types,index}.ts`: new.
      - `src/contracts-core/agent.ts`: add `hooks`, `slots`, and `host`; remove `loop`.
      - `src/contracts-protocol.ts`: remove `RunOptions.loop`.
      - `src/contracts-core/loop.ts`: delete the retired types. Keep the `TurnPolicy*` and `StopHook*` types until Part B Task 4.
      - `src/agent-loops.ts`: delete, or move its helpers into `src/loop/`.
      - `src/agent-session/session.ts` and `src/agent-session/session/{assemble,tool-round,provider-round,types}.ts`: route runs through the loop slot and `RunController`.
      - `src/agent-run-state.ts`: fingerprint from `LoopStrategy`.
      - `src/run-bundle.ts` and `src/structured-output.ts`: drop loop-option reads.
      - `src/index.ts`: exports.
      - `packages/agent-sdk/src/{config,define-agent}.ts` and its tests.
      - `packages/prism-code/src/limits.ts` and its tests.
      - `examples/{durable-loops-and-approvals,spawn-agent-tool}.ts`
      - Delete `examples/host-artifact-loop.ts`.
      - `examples/README.md`
      - `scripts/e2e-coverage.json`
      - `src/__tests__/{agent-loops,durable-loops}.test.ts`: rewrite onto `LoopStrategy`, or delete the generate-validate-revise cases.
      - `src/__tests__/{slot-registry,run-controller}.test.ts`: new.
      - `src/__tests__/public-export-contract.test.ts`
      - `src/__tests__/docs.test.ts`: pin rows per Task 1(i).
      - `docs/next/{slots,loop}.md`: new.
      - `CHANGELOG.md`
      - `scripts/compat-baseline/{arnilo__prism,arnilo__prism-agent-sdk,arnilo__prism-code}.txt`, plus any other file the regeneration rewrites.
      - Tentative: `packages/prism-core/src/runtime/supervisor/*` and `packages/prism-core/src/runtime/workflows/*`, if Task 1(d) lists them.
    - References:
      - `plans/142` Task 6: the caller-migration precedent in the same workspaces.
  - Test Cases to Write:
    - `slot_conflict_fails_closed_naming_both_owners`
    - `slot_direct_implementation_wins`
    - `unknown_slot_fails_closed`
    - `slot_default_exposed_for_delegation`
    - `credentials_default_resolves_env_only`
    - `run_controller_exposes_only_primitives`: fails if a dispatch or provider handle leaks.
    - `turn_fires_hooks_in_documented_order`: records the handler order across all six turn hooks.
    - `execute_tools_fires_hooks_in_documented_order`
    - `turn_tools_false_sends_no_tools` and `turn_tools_list_narrows`
    - `default_loop_matches_single_shot_behavior`: the existing agent-session suites, plus one explicit multi-tool-round case.
    - `turn_before_stop_is_clean_and_resumable`
    - `run_end_continue_capped`
    - `host_hooks_register_under_host_owner` and `host_hooks_throw_fails_create_agent`
    - `host_ui_absent_confirm_is_unavailable`
    - Sweep test: the Task 1(i) pin rows are gone, and `docs.test.ts` stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New `AgentConfig` fields and the loop contract. The `loop` option and `generate-validate-revise` are removed.
    - Docs pages to create/edit:
      - `docs/next/slots.md`: the four slot contracts, defaults, `provide` / `default`, and conflict rules.
      - `docs/next/loop.md`: `LoopStrategy`, `RunController` with the per-primitive hook order, the `defaultLoop` source, and a custom-loop example.
      - `CHANGELOG.md`: Unreleased "Added" and "Removed" entries. "Removed" names `AgentConfig.loop`, `RunOptions.loop`, and `generate-validate-revise`, with a pointer to the Phase 9 `workflows` package.
      - The released `docs/agent-loops.md` is untouched.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: run `node scripts/release.mjs gate --update-baseline`. The note pastes the diffs for `arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`, `arnilo__prism-code.txt`, and any other rewritten file. This plan's removals are the loop types and functions above; any other removal is listed as inherited, with its plan. Then `node scripts/release.mjs gate` exits 0.
  - Lab impact: `packages/prism-code/src/limits.ts` keeps its limit mapping and loses only loop-option wiring. No lab module becomes deletable here. Roadmap Phase 12 deletes the assembler.
  - Done (executed 2026-09-30) — **Task 4a, 4b, and 4c all landed.**
    - **Landed (4a: primitives, green).** `src/loop/{types,dispatch,run-controller,default-loop,index}.ts`, `src/slots/{types,registry,defaults,index}.ts`, `src/host/{types,index}.ts`. `LoopStrategy`/`RunController`/`defaultLoop` implement roadmap §2.5; `RunController`'s own keys are exactly the nine primitives. `createSlotRegistry`/`createSlotDefaults` cover the four slots with fail-closed conflicts and the `env:NAME` credential default. `HostPort`/`HostUi` (all six request kinds) define the host contract. `AgentFinishReason` gains `hook_stop` (and the ag-ui `STOP_REASON` table maps it). Public exports added; staged `docs/next/{slots,loop}.md`; `CHANGELOG`; baseline +43; new suites `run-controller.test.ts`, `slot-registry.test.ts` (12 cases). Tests, workspace typechecks, examples, and `release.mjs gate` are green.
    - **Landed (4b: session wiring).** `AgentConfig.{hooks,slots,host}`; `createAgent` builds a per-agent hook bus (owner `host`, `hook.error`/`emit` routed to the emitting session) and slot registry, and calls `config.hooks` once (throw fails closed). `RuntimeAgentSession` exposes `hooks()`/`slots()`. `assembleRoundContext` resolves the loop slot (`defaultLoop` when no 0.12 loop is configured) and builds a `RunController` over the existing `LoopContext` internals; `runLoopUntilSettled` calls `ctx.loop.run(ctx.runController)`. `turn()` fires `turn.before`, `context.build`, `model.request`, `model.response`, `message.append` and preserves the soft-interrupt re-entry and the tool-round `turn_limit`; `provider-round.ts` fires `model.call` around the provider stream; `executeTools` fires `tool.call`/`tool.execute`/`tool.result`; `run.end` continuation is capped by `limits.maxStopContinuations`; `run.input` transforms run-start messages. `AgentFinishReason.hook_stop` ends the run cleanly. `isDurableLoop`, `agentFingerprint`, and `run-bundle` read the slot loop (default identity `default`/`1`). 0.12 `AgentLoopStrategy`/`AgentLoopOptions` still run through a transitional `legacyLoopStrategy` adapter (deleted in 4c). New suite `agent-hooks.test.ts` (8 cases); `run-bundle.test.ts` re-pinned for the `default`/`1` identity. Baseline regenerated; gate exits 0.
    - **Landed (4c: retirement).** Deleted `AgentConfig.loop`, `RunOptions.loop`, `AgentDefinition.loop`, `AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, `singleShotLoop`, `generateValidateReviseLoop`, `isAgentLoopOptions`, `resolveLoop`, `resolveToolConcurrency`, `legacyLoopStrategy`, `ArtifactValidator`, `ArtifactParser`, `ArtifactRepairer`, `ArtifactContext`, `ArtifactParseResult`, and `assertArtifactOutcome`; deleted `src/agent-loops.ts` and `examples/host-artifact-loop.ts`. `src/agent-session/session/assemble.ts` keeps a private `LoopInternals` type and reaches tools through a new `RoundContext.dispatchToolCall`; `runLoopWithStopHooks` re-enters the same controller (no continuation context). `RunController.executeTools` takes `{ concurrency }` (default 1). Migrated `packages/{agent-sdk,prism-code,ag-ui,prism-core}` (agent-sdk `loop` plane → `slots.loop`; prism-code `resolvePrismCodeLoop` returns `LoopStrategy | undefined`), `examples/{durable-loops-and-approvals,spawn-agent-tool,crew-hierarchy}`, `src/{run-bundle,structured-output,agent-run-state,agent-session/helpers,agent-session/session/types}`, `scripts/phase8-conformance.test.mjs`, and the `docs.test.ts`/`public-export-contract.test.ts` pin rows. Deleted `src/__tests__/agent-loops.test.ts` and replaced its dispatch coverage with `src/__tests__/loop-dispatch.test.ts`. Added `docs/next/loop.md`/`slots.md` notes, CHANGELOG "Removed", `biome.json` allowlist entry removal, and `budgets.json` rebaseline. All three compat baselines regenerated (root: removed `generateValidateReviseLoop`/`isAgentLoopOptions`/`resolveLoop`/`resolveToolConcurrency`/`singleShotLoop`; changed `bindChargeToolRound`/`bindDispatchToolCall`/`isDurableLoop`/`resolveRunProviderOptions`); `release.mjs gate` exits 0.
    - **Known inherited failures (not this task).** `packages/prism-code/src/tui/index.ts` has one non-null assertion outside the budget allowlist (plan 142 in-flight), the agent-sdk packaging peer test fails (plan 142), and the field-policy microbenchmark is a perf flake. `scripts/tooling-gate.test.mjs`'s two `git ls-files` scans fail with ENOENT on deleted-but-uncommitted paths (the plan-142 `.agents/skills/*` deletions predate this task); they clear once the deletions are committed. `scripts/sweep-unused.test.mjs`'s 5 s spawn timeout is too tight on this host (the sweep takes ~15 s).
    - **Why split.** 4b rewrites the run path that ~2000 existing tests exercise, and 4c migrates ~15 test files and three packages; each is a self-contained, independently verifiable increment, and landing the primitives first keeps the tree green while the wiring lands behind them.

- [x] Task 5: `ask` resolution: inline `host.ui` confirm, or suspension through the `store` slot
  - Acceptance Criteria:
    - Functional: When `tool.call` combines to `{ ask: reason }` and `AgentConfig.host.ui` is present, `executeTools` sends `{ kind: "confirm", title, detail }`, where the title names the tool and the detail carries the reason and a redacted argument preview.
      - `answered: true` executes the call.
      - `answered: false` or `dismissed` produces a denied tool result.
      - `unavailable` falls through to suspension.
    - Functional: With no UI (or `unavailable`), the run suspends.
      - The run result has `status: "suspended"` and a `pending` list of decisions.
      - The kernel writes a `suspended_run` entry through the `store` slot. The entry holds the pending decisions, the loop's `snapshot()` when the loop declares one, the hook registration-id fingerprint, and `LoopStrategy.name` / `revision`.
      - A custom loop without `snapshot` / `restore` that reaches an ask fails with `AgentLoopStateError` / `ERR_PRISM_LOOP_NOT_DURABLE` before any tool runs.
    - Functional: The existing resume entry point (`session.resumeDurable`, `src/agent-session/session.ts:424`) continues a suspended run from the `suspended_run` entry in a new `createAgent` / session over the same store.
      - A fingerprint drift fails closed: a changed loop revision or a changed hook-id set is `ERR_PRISM_LOOP_REVISION`, or its Task 1(e) successor.
      - Roadmap Phase 3 replaces the entry point with `session.resume(decisions)`.
    - Functional (retirement): `AgentRunStateOptions.interruptBeforeTool` is deleted. It is re-expressed as a host `tool.call` hook returning `{ ask }`.
      - Its callers from `graft callers` are migrated in this task: `src/secure-agent.ts`, `examples/durable-loops-and-approvals.ts`, and tests.
      - Grep sweep for `interruptBeforeTool` over `src/ packages/ apps/ scripts/ examples/ docs/`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, and released `/docs` prose.
      - The rest of the durable-run path (every-turn checkpoints, `runState.checkpoints`) follows Task 1(e)'s verdict.
    - Performance: No store write unless a run actually suspends. An inline confirm adds one `host.ui` round trip per asked call, and nothing otherwise.
    - Code Quality:
      - `suspended_run` is a new `SessionEntry` kind in `src/contracts-core/persistence.ts`, validated by the persistence schema.
      - The existing `src/testing/session-store-conformance.ts` gains a round-trip case for it, so every store (including the family stores) must preserve it.
      - Family store packages that fail that case are fixed in this task. Roadmap Phase 6 owns their native ports.
    - Security:
      - Arguments in the confirm detail and in the persisted entry pass through the redactor. A test asserts that a secret-bearing argument does not appear in the `host.ui` request, the stored entry, or events.
      - Resume revalidates rewritten arguments against the tool schema (reusing `validateModifiedArguments`, `src/agent-approval.ts:222`).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 ("How an `ask` decision is resolved")
      - `src/agent-approval.ts:141-273,280-344`
      - `src/agent-session/session/tool-round.ts:91-139,227-251,357-376`
      - `src/contracts-run-state.ts:201-225`
      - `src/testing/session-store-conformance.ts`
    - Options Considered:
      - Keep suspensions in `CheckpointStore`. Rejected: Phase 1 requires "a suspended run survives a process restart through the store slot", and a second persistence contract is what §2.1 folds into the store.
      - Answer `ask` with deny when there is no UI. Rejected: §2.4 requires suspension, and deny-without-UI is the headless-deny mechanism being replaced.
    - Chosen Approach:
      - Reuse the 0.12 pending-decision, revalidation, and resume machinery, re-anchored on a store entry and triggered only by `tool.call` ask.
    - API Notes and Examples:
      ```ts
      const result = await session.run("delete the tmp dir");
      // result.status === "suspended"; result.pending[0].toolName === "shell"
      // later, new process, same store:
      await session.resumeDurable({ decisions: [{ approvalId: result.pending[0].approvalId, decision: "approve" }] });
      ```
    - Files to Create/Edit:
      - `src/loop/run-controller.ts`: ask path.
      - `src/host/types.ts`
      - `src/contracts-core/persistence.ts`: the `suspended_run` entry kind.
      - `src/session-stores.ts`: the memory store.
      - `src/testing/{session-store-conformance,persistence-schema}.ts`
      - `src/agent-approval.ts`, `src/agent-session/session/tool-round.ts`, and `src/agent-session/session.ts`: resume from the store entry.
      - `src/contracts-run-state.ts`: remove `interruptBeforeTool`.
      - `src/secure-agent.ts`
      - `src/node/session-store-jsonl.ts`
      - `examples/durable-loops-and-approvals.ts`
      - `src/__tests__/ask-resolution.test.ts`: new.
      - `src/__tests__/public-export-contract.test.ts`
      - `docs/next/loop.md`: the ask section.
      - `CHANGELOG.md`
      - `scripts/compat-baseline/*.txt`: regenerated.
      - Tentative: `packages/prism-core/src/sessions/*` and the Postgres/SQLite/NATS stores, if the conformance case fails there.
    - References:
      - `plans/092` and `plans/104` (guardrail-pack ask and decision revalidation)
  - Test Cases to Write:
    - `ask_with_ui_confirm_true_executes`
    - `ask_with_ui_false_or_dismissed_denies`
    - `ask_with_ui_unavailable_suspends`
    - `ask_without_ui_suspends_with_pending`
    - `suspended_run_survives_process_restart_through_store_slot`: a new agent over the same JSONL store in a subprocess resumes and completes.
    - `custom_loop_without_snapshot_fails_before_tool_on_ask`
    - `resume_fails_closed_on_hook_or_loop_revision_drift`
    - `ask_detail_and_entry_redact_secrets`
    - `store_conformance_suspended_run_round_trip`
    - Sweep: `interruptBeforeTool` has zero hits in the swept tree.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. The ask semantics, the `suspended_run` entry, and the removed `interruptBeforeTool`.
    - Docs pages to create/edit:
      - `docs/next/loop.md`: the "Ask, confirm, and suspension" section.
      - `docs/next/slots.md`: the store slot must round-trip `suspended_run`.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: `node scripts/release.mjs gate --update-baseline`. Paste every rewritten baseline diff. The removal attributed to this plan is `interruptBeforeTool`.
  - Done (executed 2026-09-30) — **all acceptance criteria landed.**
    - **What changed.** `tool.call` `{ ask }` is now resolved by the kernel. `src/loop/run-controller.ts` evaluates every `tool.call` in a round before dispatching, so a round with several asks collects into one suspension; `src/agent-session/session/assemble.ts` `resolveAskDecisions` answers each ask inline through `AgentConfig.host.ui` (`confirm`; `answered:true` executes, `answered:false`/`dismissed` returns a `hook_denied` tool result, `unavailable` suspends), and `stageAskDecisions` (`src/agent-session/session/tool-round.ts`) stages the unresolved calls as pending decisions so the round's allowed calls still run and `suspendGatedRound` throws at the next turn boundary / loop end. A sticky `allow_for_run`/`reject_for_run` short-circuits the ask without re-prompting; `tool.call` still fires. The new `suspended_run` `SessionEntry` (`src/suspended-run.ts`, `SessionEntryKind` + `SESSION_ENTRY_KINDS` in `src/contracts-core/session.ts`) is written by `suspendDurable` through the store slot and carries the pending decisions, loop snapshot/name/revision, hook registration-id set, and full run state; `loadSuspendedRunEntry`/`parseSuspendedRunEntry`/`SuspendedRunEntryData`/`SuspendedRunLoopRef`/`SUSPENDED_RUN_ENTRY_SCHEMA_VERSION` are root-exported. `session.resumeDurable` re-validates the agent fingerprint (`agentFingerprint` now includes the sorted hook registration ids via `agentHookIds` in the new leaf `src/agent-session/runtime-registry.ts`) and `executeRun` re-checks the loop revision, so hook-id or loop-revision drift fails closed. `AgentRunStateOptions.interruptBeforeTool` and `StoredAgentRunState.interruptBeforeTool` are deleted; `askEveryTool()` (`src/hooks/ask.ts`) is the host every-tool registrar, used by `createSecureAgent`, the supervisor's durable child agents, and the ACP/Prism Code hosts.
    - **Callers migrated.** `src/secure-agent.ts`, `src/agent-run-lifecycle.ts`, `src/agent-session/session/{persist,tool-round,assemble}.ts`, `packages/{acp-agent,prism-code,prism-core}/src`, `examples/{agent-durable-approval,durable-loops-and-approvals,ag-ui-server}.ts`, `scripts/{phase8-conformance,phase20-security,phase40-security}.test.mjs`, `scripts/fixtures/{e2e-enterprise-journey,e2e-070-host-completeness-journey,phase12-restart-worker,phase26-coding-journey}.mjs`, `scripts/benchmark-scenarios/phase8-loops-hitl.mjs`, and ~30 test files across `src/` and the packages. `docs/next/{loop,slots}.md` document the ask path; `CHANGELOG` gains an Added and a Removed entry.
    - **Findings affecting later tasks.** (1) The suspension is staged and thrown at the turn boundary / loop end, not inside `executeTools`, so a custom loop body that runs after `executeTools` completes before the suspension — matching the retired charge-time gate and keeping the enterprise-journey fixture's event-append logic intact. (2) A host `tool.call` hook is agent-scoped, so it gates non-durable runs too; the supervisor only registers `askEveryTool()` when `checkpoints` is configured, and `createSecureAgent` always does. (3) The `suspended_run` entry carries the full `StoredAgentRunState`, so a resume from the entry needs no `CheckpointStore` read, though `runState.checkpoints` stays for every-turn crash recovery (Task 1(e)). (4) The `suspended_run` entry is appended directly to `session.store`, not through the branch, so it never enters history. (5) `docs/next/loop.md` is the ask API page.
    - **Baseline diff (`arnilo__prism.txt`, Task 5 slice).** Added values: `askEveryTool`, `SUSPENDED_RUN_ENTRY_SCHEMA_VERSION`, `loadSuspendedRunEntry`, `parseSuspendedRunEntry`, `createSuspendedRunEntry`, `stageAskDecisions`, `persistDurableRaw`, `agentRuntime`, `tryAgentRuntime`, `registerAgentRuntime`, `agentHookIds`; added types: `AskRequest`, `AskResolution`, `SuspendedRunEntryData`, `SuspendedRunLoopRef`, `AgentRuntime`. Changed: `RunControllerInternals` (the `ask`/`suspendAsks` seams). Removed: `suspendAsk` (added and removed within this task; never released). The regenerated file also carries every earlier plan-144 addition because the committed baseline is still 0.12.1. `budgets.json` exportCounts `@arnilo/prism` rebaselined 1550 → 1563 with a dated reason.
    - **Sweep.** `grep -rn "interruptBeforeTool" src packages scripts examples templates apps docs` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, released `/docs`) leaves only historical comments naming the retired option and two synthetic strings in `scripts/plan-review-gate.test.mjs`. `SESSION_ENTRY_KINDS` and the JSONL validator gained `suspended_run`; the shared `assertSessionStoreConforms` gains a `suspended_run` round-trip case.
    - **Checks.** Root `tsc`, every workspace `tsc`, and `tsc -p examples` clean; `release.mjs gate` exits 0 after regenerating all three baselines. Green: the new `ask-resolution.test.ts` (9 cases) plus `run-decisions`, `agent-run-*`, `durable-*`, `guardrail-pack-*`, `run-limits`, `tool-effects`, `run-tool-names`, `run-controller`, `agent-hooks`, `loop-dispatch`, `session-stores`, `public-export-contract`, `docs`, `e2e-coverage`, `phase8/9/10/11-conformance`, `phase20/40-security`, `e2e-enterprise-journey`, `e2e-070`, `budget-gate`, `release-gate`, `package-truth`, `truth-current`, `phase54-package-map`, `live-doc-check`; packages agent-sdk 88, prism-code 342 (1 pre-existing TUI perf flake), ag-ui 478, prism-core 734, acp-agent 20, mcp 106, prism-channels 93, prism-coding-tools 656 (spawn flakes under parallel load, green in isolation).
    - **Inherited red (not this task).** plan-142: `packages/prism-code/src/tui/index.ts` non-null assertion outside the budget allowlist, and the agent-sdk packaging peer test. `scripts/tooling-gate.test.mjs`'s two `git ls-files` scans ENOENT on deleted-but-uncommitted paths. `scripts/sweep-unused.test.mjs` 5 s spawn timeout. `docs > examples_demos_run_to_completion` and several spawn-heavy suites need a timeout above the 5 s default on this host.
    - **Fixes beyond the plan.** `packages/prism-channels/src/__tests__/recovery.test.ts` gained a `waitFor(() => calls.count === 1)` before `gate.resolve()`: the test raced the provider's own `new Promise` and the 4c default-loop hook dispatch widened the window.

- [x] Task 6: Catalog coverage from both loops, the Phase 1 invariants, and `examples/custom-loop.ts`
  - Acceptance Criteria:
    - Functional: `src/__tests__/hook-catalog-coverage.test.ts` iterates `HOOK_CATALOG`. For every non-observe hook, and for a representative observe hook per event family, it asserts the hook fires both from `defaultLoop` and from a custom `LoopStrategy`, on the mock provider.
      - A catalog entry with no coverage case fails the test. Adding a hook without coverage is impossible.
    - Functional: Invariant tests, each named:
      - a custom loop cannot run a tool without `tool.call` firing
      - deny wins over allow and ask
      - the first `run.end` continue wins and is capped
      - an observer throw never fails a run
      - a transform or decide throw fails closed and names the owner and hook
      - a suspended run survives a process restart through the store slot (reuses the Task 5 harness)
      - `context.build` mutations never reach the store: a handler that appends a system message and a user message leaves `session.messages()` and the store entries unchanged
    - Functional: `examples/custom-loop.ts`, on the mock provider:
      - supplies a plan-then-act `LoopStrategy` through `slots.loop`
      - registers a host `tool.call` hook that denies a `network` tool
      - shows the denial reaching the model as a tool result
      - prints no secret
      - is listed in `examples/README.md` and `scripts/e2e-coverage.json`, and passes `examples_demos_run_to_completion_and_emit_no_secret`
    - Performance: The coverage suite uses the mock provider only. There are no network or subprocess calls, except the one restart case from Task 5.
    - Code Quality: The coverage harness is a test helper (`src/__tests__/helpers/hook-harness.ts`). It is written so roadmap Phase 2 can promote it into `@arnilo/prism/testing` as loop conformance without rewriting: it takes a `LoopStrategy` and returns results.
    - Security: The invariants above are the security proof. The example uses no credential.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 "Invariant tests" and "Done"
      - `src/mock-provider.ts`
      - `src/__tests__/docs.test.ts:3445` (the example gate)
    - Options Considered:
      - One test per hook written by hand. Rejected: nothing stops a later catalog addition from skipping coverage. Iterating the catalog makes coverage enforced.
    - Chosen Approach:
      - A table-driven harness keyed by catalog name, with a scripted mock provider that produces the tool calls and stops each hook needs.
    - API Notes and Examples:
      ```ts
      for (const { name } of HOOK_CATALOG) {
        it(`${name} fires from default and custom loop`, async () => { await assertFires(name, defaultLoop); await assertFires(name, planThenAct); });
      }
      ```
    - Files to Create/Edit:
      - `src/__tests__/hook-catalog-coverage.test.ts`: new.
      - `src/__tests__/hook-invariants.test.ts`: new.
      - `src/__tests__/helpers/hook-harness.ts`: new.
      - `examples/custom-loop.ts`: new.
      - `examples/README.md`
      - `scripts/e2e-coverage.json`
      - `docs/next/loop.md`: link the example.
      - `CHANGELOG.md`
    - References:
      - Task 2–5 tests.
  - Test Cases to Write:
    - `every_catalog_hook_fires_from_default_and_custom_loop`: fails when a hook stops firing from either loop, or when a catalog entry has no case.
    - The seven invariant tests named above.
    - `examples_demos_run_to_completion_and_emit_no_secret`: an existing test, gaining the new example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API. It is proof plus an example.
    - Docs pages to create/edit:
      - `docs/next/loop.md`: the example link.
      - `examples/README.md`: one line.
      - `CHANGELOG.md`: note the example.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Done (executed 2026-10-01) — **all acceptance criteria landed.**
    - **What changed.** `RuntimeAgentSession.emit` now dispatches the event as an `observe` hook (`hookBusInstance.observe(event.type, redacted)`) after the subscriber push, so every `AgentEvent` is a live observe hook; a re-entry flag drops a `hook.error` that is itself produced while dispatching a `hook.error`, so a throwing observer can never recurse. `compaction.when` now fires at the auto-compaction check point: `RuntimeAgentSession.resolveAutoCompact` (shared by `autoCompact` and `autoCompactTurn`) consults the hook whenever a handler is registered — the handler then owns the decision, and an abstaining handler (`undefined`) means no compaction — and falls back to the configured `trigger`/`thresholdEntries` only when no handler is registered. `{ compact: true }` forces compaction from the context estimate. A new `HookBus.has(name)` gives the per-turn gate an allocation-free registration check, so a hook-less run pays nothing. This is the Part B shape (plan 145 Task 5): the config trigger becomes a kernel-registered default handler.
    - **New files.** `src/__tests__/helpers/hook-harness.ts` (a `LoopStrategy`-in / `{ result, events, fired }`-out harness; registers a correctly-shaped firing probe for every `HOOK_CATALOG` entry unless `probe: false`, exposes `twoTurnProvider`/`textProvider`/`echoTool`, and returns the agent and session for entry inspection). `src/__tests__/hook-catalog-coverage.test.ts` (iterates `HOOK_CATALOG`; the twelve named hooks each have a `…_fires_from_defaultLoop` / `…_fires_from_customLoop` case; every observe hook is fired from both loops, both by a real kernel scenario per emit family and by an exhaustive synthetic emission of every observe type via `HookContext.emit`; `every_catalog_hook_has_a_coverage_case` fails when a named hook is added without a case). `src/__tests__/hook-invariants.test.ts` (the seven named invariants). `examples/custom-loop.ts` (plan-then-act `LoopStrategy` through `slots.loop`, host `tool.call` gate denying `fetch_url`, denial observed as a tool result on the next provider turn, `read_file` still executes).
    - **Findings.** (1) The kernel never dispatched observe hooks before this task — `HookBus.observe` existed but no call site did; the coverage test is what forced the wiring. (2) A `compaction.when` hook that forces compaction every turn is bounded by the existing “branch just compacted” guard. (3) Every observe event shares the one `emit` → `observe` dispatch path, so the suite fires every observe type through `HookContext.emit` in addition to the real per-family scenarios. (4) `AgentRunError` wraps a thrown `HookError`, so the invariant test unwraps `cause`. (5) `HookBus.registrations()` allocates; the per-turn compaction gate uses the new allocation-free `HookBus.has(name)`.
    - **Baseline diff.** None: no root export changed, so `arnilo__prism.txt` and the other baselines are untouched. `budgets.json` `exportCounts['@arnilo/prism']` was rebaselined 1563 → 1569 with a dated reason for the six harness exports (the counter measures all of `src`, tests included).
    - **Checks.** `tsc` root and `tsc -p examples` clean; all eight workspace typechecks clean; `release.mjs gate` exits 0. Green: `hook-catalog-coverage` (29), `hook-invariants` (9), `docs` (163, including the example gate), `e2e-coverage`, `budget-gate` (only the inherited plan-142 non-null failure), `examples-execution` (10), `phase8-conformance`. Root `src/__tests__` sweep leaves only the four known pre-existing flakes (bin-spawn stdio ×2, packaging agent-sdk peer, protected real-provider stdio). prism-core 765, ag-ui 239, prism-channels 93 — all green.
    - **Inherited red (not this task).** plan-142 non-null assertion at `packages/prism-code/src/tui/index.ts:330` and the agent-sdk packaging peer test; the spawn-heavy stdio suites need a timeout above the 5 s default on this host.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 dist/__tests__/hook-bus.test.js dist/__tests__/slot-registry.test.js dist/__tests__/run-controller.test.js dist/__tests__/ask-resolution.test.js dist/__tests__/hook-catalog-coverage.test.js dist/__tests__/hook-invariants.test.js dist/__tests__/kernel-imports-no-package.test.js`
- `bun run --filter @arnilo/prism-agent-sdk build && bun run --filter @arnilo/prism-agent-sdk test`
- `bun run --filter @arnilo/prism-code build && bun run --filter @arnilo/prism-code test`
- `bun run test` (every workspace, because the family packages compile against the kernel)
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `node scripts/release.mjs gate`

## Compromises Made

- **Observe hooks are fired two ways.** The plan asks for “a representative observe hook per event family”, which the coverage suite proves with a real kernel scenario per family (`run`, `turn`, `provider`, `message`, `tool`, `compaction`, `error`, `limits`). It also fires *every* observe type from both loops by emitting each through `HookContext.emit` — the same `emit` → `observe` dispatch path the kernel uses — which covers events with no base-scenario trigger (`artifact_*`, `delegated_agent_step`, `retry_scheduled`, `attention_compiled`, …) and the host-only `package.event`. The `artifact_*` events have no kernel emission site since the generate-validate-revise loop was retired in Task 4; they stay in the catalog as host/package-emittable events and are covered synthetically.
- **The `hook.error` re-entry guard drops nested `hook.error` events.** A `hook.error` produced while dispatching a `hook.error` is not itself observed. This is the fail-safe that makes a throwing `hook.error` observer terminate; the cost is that a host cannot observe the failure of a `hook.error` observer.
- **Test-helper exports count against the repo-wide export ceiling.** `budgets.json` `exportCounts['@arnilo/prism']` measures all of `src`, so the six harness exports were folded into the baseline rather than excluded. The counter is intentionally repo-wide; fixing it to exclude `__tests__` is out of scope for this plan.

## Further Actions

- **Promote the loop conformance harness into `@arnilo/prism/testing` (priority: medium, Phase 2).** `src/__tests__/helpers/hook-harness.ts` already has the intended shape (a `LoopStrategy` in, `{ result, events, fired }` out, probes for every catalog entry, and an `emitEvents` escape hatch for host-only event types); Phase 2's `@arnilo/prism/testing` can move it under a public subpath without rewriting.
- **Decide the fate of the retired-loop artifact events (priority: medium, Part B / plan 145).** `artifact_validation_started/finished`, `artifact_revision_started`, `artifact_finished`, and `artifact_failed` have no kernel emission site after the generate-validate-revise loop was retired in Task 4; they are only reachable if a host or package emits them. Part B should either retire the five `AgentEventPayload` variants (a breaking `AgentEventType` change) or leave them as the package-emittable contract and document that.
- **Fire `compaction.when` from the compaction slot, not the session (priority: low, Phase 2/3).** Today the hook is consulted in `session.ts` next to the config trigger; once the `compaction` slot owns the decision, the hook belongs beside the slot’s default so a package compactor gets the same seam.
- **Exclude `__tests__` from the export-count budget (priority: low).** The ceiling is meant to bound the public surface; counting test helpers makes every new harness a rebaseline. `scripts/budget-gates.mjs measureExportCounts` could skip `**/__tests__/**`.
- **Task 7/8 (0.12 docs migration and the `defineAgent` example) are out of scope for Part A.** Part B (plan 145) retires the 0.12 interception mechanisms; the Phase 1 wiki pages under `docs/next/` become current in the Phase 3 docs pass.
