# Phase 1 Part B — Retire the 0.12 interception mechanisms

## Objectives

- Re-express every 0.12.1 interception mechanism as a hook or slot, following the "Replaces" column in roadmap §2.4.
- Remove the old config fields and registries without aliases: `middleware`, `guardrails`, `stopHooks`, `turnPolicy`, `providerRequestPolicies`, `instructionInjectors`, `context`, `toolNarrowing`, `inputBuilder`, `promptBuilder`, and `permission`. The `loop` options were already retired in Part A Task 4.
- Migrate every caller in every workspace, in the same task that removes its field, so the tree is green after every task.
- Freeze the hook catalog and slot contracts for roadmap Phase 2.

## Expected Outcome

- `AgentConfig` and `RunOptions` no longer carry any of the eleven fields above.
- The interception types and registries are deleted:
  - `MiddlewareRegistry`, `createMiddlewareRegistry`, and `src/middleware.ts`
  - `Guardrails` and its stage runner
  - `StopHook`, `TurnPolicyOptions`, and `ProviderRequestPolicy`
  - `InstructionInjector`, `ContextProvider`, `ToolNarrowing`, `InputBuilder`, and `PromptBuilder`
  - `CompactionStrategy` and `CompactionTrigger`, replaced by the `compaction` slot and `compaction.when`
- The matching `ExtensionAPI.register*` methods and `activateKernel` fields are deleted, because nothing consumes them. Roadmap Phase 2 removes the rest of `ExtensionAPI`.
- Every caller is migrated onto `AgentConfig.hooks` / `slots` in the same task, including the family packages that compile against the workspace kernel: `hooks`, `agent-sdk`, `prism-code`, `ag-ui`, `mcp`, `memory`, `prism-core`, and `prism-coding-tools`.
- `src/__tests__/hook-catalog-freeze.test.ts` pins the catalog (names and kinds) and the four slot names. `docs/next/{hooks,slots,loop}.md` are final for Phase 2.
- The repo-wide sweep finds no retired name outside `plans/`, `docs/history/`, `docs/_evidence/`, `dist/`, and released `/docs` prose.
- Every task regenerates the compat baseline. `node scripts/release.mjs gate` is green.

This plan is Part B of roadmap **Phase 1 — Hook bus, slots, and loop primitives**. It depends on [plan 144](144-Phase-1-Part-A-Hook-Bus-Slots-And-Loop-Primitives.md) being complete: the bus, slots, `RunController`, the ask path, and the catalog coverage harness must be in the tree.

The phase review is plan 144 Task 1, and it covered this plan's classification and middleware mapping. Task 1 here is a read-only entry check that re-verifies the caller map after Part A has changed the code.

Retirement tasks are cut by catalog hook, so each task removes one old mechanism group and its call sites inside the primitives. That removes the Part A transitional overlap one group at a time. Order matters where fields share a type:

- `guardrails` loses its tool stages in Task 2 and is deleted in Task 3.
- `middleware` loses hook names in Tasks 2–4 and is deleted in Task 5.

Released `/docs` pages (`middleware-hooks.md`, `guardrails.md`, `agent-loops.md`, and the rest) stay on the 0.12.1 contract until roadmap Phase 11. Each task drops only the `docs.test.ts` pin rows that tie a released page to a removed export (plan 144 Task 1(i)).

No version bump, publish, conformance-suite export, or `/docs` change.

## Tasks

- [x] Task 1: Part B entry check — the caller map after Part A (read-only)
  - Acceptance Criteria:
    - Functional: Plan 144 is `complete` in `plans/README.md`, and its Task 1 verdict and amendments are applied here.
    - Functional: The Notes list, for each Task 2–5 mechanism, every caller from `graft callers <symbol> --depth all` and `graft grep "<field>"`, grouped by workspace. Each caller is marked *migrate* (with its target hook or slot) or *delete* (roadmap phase that removes the module, and why deleting now is safe).
      - Symbols: `PermissionPolicy`, `Guardrails`, `Guardrail`, `runGuardrails`, `GuardrailPack*`, `ProviderRequestPolicy`, `DeterministicTurn*`, `RetryMiddlewarePayload`, `InstructionInjector`, `ContextProvider`, `ToolNarrowing`, `InputBuilder`, `PromptBuilder`, `StopHook`, `TurnPolicyOptions`, `CompactionStrategy`, `CompactionTrigger`, `MiddlewareRegistry`, and `createMiddlewareRegistry`.
    - Functional: Confirm or refute each of these:
      - (a) `PermissionPolicy` has kernel users other than tool dispatch: the resource loader (`src/contracts-core/resources.ts:3`) and execution policy (`src/execution-policy.ts:36`). If so, Task 2 removes only `AgentConfig.permission` and its dispatch use, and the type stays for those users.
      - (b) Guardrail packs (`AgentSessionConfig.guardrailPacks`, `src/guardrails.ts:204-268`) can compile onto `tool.call` / `tool.result` registrations under the owner `kernel:guardrail-packs`, without changing pack semantics or their durable restore (`src/agent-session/session.ts:255-263`).
      - (c) The `retry` middleware hook has callers. If it has none, Task 3 deletes it with no replacement.
      - (d) `rpc.ts` and `cli-runner.ts` use `instructionInjectors` only for extension-discovered injectors, so Task 4 deletes that path along with `registerInstructionInjector`.
      - (e) The `compaction-conformance` suite (`src/testing/compaction-conformance.ts`) can retarget to the `Compactor` contract, and family strategies (`packages/memory/src/compaction/{llm,observational-memory}`) pass it after migration.
    - Performance: n/a — read-only.
    - Code Quality: Every caller row cites `file:line`.
    - Security: List every trust or approval path touched by Tasks 2 and 4: ACP permission elicitation (`packages/ag-ui/src/acp/agent/permission-elicit.ts`), prism-code approval, MCP trust, and `createSecureAgent`. For each, name the `tool.call` / `context.build` registration that replaces it, so no gate is lost.
  - Approach:
    - Documentation Reviewed:
      - plan 144 Task 1 Notes
      - `roadmap.md` §2.4 "Replaces"
    - Options Considered:
      - Rely on plan 144 Task 1's inventory alone. Rejected: Part A Task 4 rewrote the session internals, so its line citations are stale.
    - Chosen Approach:
      - Re-run `graft callers` per symbol and record the table.
    - API Notes and Examples:
      ```bash
      graft callers ProviderRequestPolicy --depth all
      ```
    - Files to Create/Edit:
      - This plan's Task 1 Notes, plus amendments.
    - References:
      - plan 144
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit: none. This is a review.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-01):
    - **Verdict: proceed with amendments.** The task structure holds. Five findings amend Task 2 (supervisor and MCP direct dispatch are real `permission` callers the plan missed; prism-code approval is not a `permission` caller) and refresh Task 3's citation. All symbols and fields were re-checked after Part A, so the line numbers below are post-Part-A.

    - **Entry condition.** Plan 144's six tasks are all `[x]` with `Done`/`Notes (executed 2026-09-30/10-01)` entries. `plans/README.md` marked 144 `complete (2026-10-01)` as this task's prerequisite (144's plan-end handoff had not touched the row; Task 6 of this plan now only needs to mark 145). Part A Task 1's verdict was "proceed with amendments"; all three amendments are in the tree (`ToolCapabilityKind` in `src/contracts-protocol.ts:486`; `AgentDefinition.loop` retired; `hook.error`/`package.event` in `AgentEventPayload`).

    - **Part A moved every cited symbol.** Re-verified declarations: `PermissionPolicy` `src/security.ts:33`; `Guardrails`/`Guardrail` `src/contracts-core/run-limits.ts:125,141`; `StopHook`/`TurnPolicyOptions` `src/contracts-core/loop.ts:32,70`; `CompactionStrategy`/`CompactionTrigger` `src/contracts-core/compaction.ts:6,39`; `ProviderRequestPolicy` `src/contracts-core/extensions.ts:140`; `InstructionInjector`/`ContextProvider`/`ToolNarrowing`/`InputBuilder`/`PromptBuilder` `src/contracts-core/agent.ts:334,292,68,340,356`; `MiddlewareRegistry`/`createMiddlewareRegistry` `src/middleware.ts:100,110`. `graft callers` returns nothing for interface/type symbols (no call edges), so the map below is `graft grep` + `rg` over `src packages apps scripts examples` with `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, `**/vendor/**` excluded. The plan's original line citations (`src/tools.ts:93,279-286`, `tool-round.ts:431`, `assemble.ts:565`) are stale; refreshed below.

    - **Task 2 caller map — `AgentConfig.permission` / `SecureAgentOptions.permission` / dispatch use.**

      | Caller | Verdict |
      | --- | --- |
      | `src/contracts-core/agent.ts:120,171` | delete fields (`AgentConfig.permission`, `SecureAgentOptions.permission`); `PermissionPolicy` type stays |
      | `src/secure-agent.ts:35,70,92` | migrate: `SecureAgentOptions.permission` → host `tool.call`; readiness = ≥1 host `tool.call` (plan 144 Task 1(j)) |
      | `src/host-composition.ts:73,270,348` | migrate: `governance.permission` readiness → `tool.call` registration count; fail with `HostCompositionError`/`ERR_PRISM_HOST_COMPOSITION` (`:11,383`) |
      | `src/tools.ts:94,328` | delete `DispatchToolCallOptions.permission` + `assertPermission`; direct dispatchers use `beforeExecute` (`:88`) |
      | `src/agent-session/session/tool-round.ts:450` | migrate: `ctx.session.agent.config.permission` → the session's `tool.call` bus |
      | `src/agent-session/session/assemble.ts:680` | migrate: same |
      | `src/testing/tool-conformance.ts:36,47,55,100,154,306,310` | migrate: `permission` probe → `beforeExecute` |
      | `packages/agent-sdk/src/define-agent.ts:89,354` | migrate: `config.policy` → `hooks` |
      | `packages/mcp/src/server.ts:110` | migrate: `dispatchToolCall({permission})` → `beforeExecute` (MCP dispatches outside `RunController`) |
      | `packages/prism-core/src/runtime/supervisor/supervisor.ts:544,563,589,882,894,915`; `packages/prism-core/src/runtime/supervisor/types.ts` | **finding — not in the plan**: migrate `intersectPolicies(...)`/`childAgent.config.permission` to a composed child `tool.call` handler (the supervisor already registers `askEveryTool()`) |
      | `packages/prism-code/src/{approval,tools,acp,headless}.ts` | **refuted as a `permission` caller** — prism-code approval rides `ExecutionPolicy`/`ToolsOptions.executionPolicy` (`packages/prism-coding-tools/src/agent/index.ts:611`), a retained seam |
      | `src/input.ts:522`, `src/resources.ts:9`, `src/content.ts:303`, `src/contracts-core/resources.ts:3,22`, `src/node/{instruction-injectors,contribution-discovery,agent-definitions,system-project-prompts}.ts`, `src/extensions.ts:52,241`, `src/security.ts:33,73-84` | keep: `PermissionPolicy` resource/extension-load users (type not retired) |
      | `src/__tests__/{secure-agent,host-composition,host-composition-compat,settings-security,install-smoke,run-tool-names,public-export-contract,docs,agent-approval-coverage,field-policy}.test.ts`; `packages/prism-core/src/runtime/supervisor/__tests__/{supervisor,nested-approvals}.test.ts`; `packages/agent-sdk/src/__tests__/define-agent.test.ts` | rewrite/delete the `permission` rows |
      | `examples/{secure-agent,host-composition-compat,guardrail-packs}.ts` | migrate |
      | `scripts/compat-baseline/{arnilo__prism,arnilo__prism-agent-sdk}.txt` | regenerate |

    - **Task 2 caller map — tool guardrail stages + `tool_call`/`tool_result` middleware.**

      | Caller | Verdict |
      | --- | --- |
      | `src/guardrails.ts:65-75` (`GuardrailError`), `:96-135` (`runGuardrails`), `:204-266` (`compileGuardrailPacks*`), `:268-300` (`describeGuardrailPacks`) | migrate: packs → `tool.call` (deny/ask) / `tool.result` (tripwire→deny) handlers under owner `kernel:guardrail-packs`; `GuardrailError` kept for packs (Task 3 note) |
      | `src/tools.ts:23,104,262-275,372-385` | delete `DispatchToolCallOptions.guardrails` + the `tool_call`/`tool_result` middleware runs |
      | `src/agent-session/session/tool-round.ts:376-395,416-494` | migrate: `matchAskGate`/`bindDispatchToolCall` → `tool.call` |
      | `src/agent-approval.ts:141-219,222-273` | migrate: `resolveRunDecisions`/`validateModifiedArguments` → `tool.call` + ask path |
      | `src/contracts-core/run-limits.ts:94-148` | keep types; delete the `tool_input`/`tool_output` stage members |
      | `src/agent-run-state.ts:172-209` | migrate fingerprint: guardrail names → hook registration ids (plan 144 Task 1(k)) |
      | `packages/hooks/src/compile.ts:306-391` | migrate PreToolUse→`tool.call`, PostToolUse→`tool.result` |
      | `packages/mcp/src/server.ts:115` | migrate guardrails → `beforeExecute` + result transform (MCP has no hook bus) |
      | `src/__tests__/{guardrails,guardrail-packs,guardrail-pack-ask,guardrail-pack-decision-revalidation,guardrail-pack-durability,guardrail-refusal-text,contribution-security-boundaries,tool-effects,tools}.test.ts` | rewrite only where they assert stage internals |
      | `examples/{guardrail-packs,hooks-json}.ts` | migrate |

    - **Task 2 caller map — guardrail packs (`AgentSessionConfig.guardrailPacks`).**

      | Caller | Verdict |
      | --- | --- |
      | `src/agent-session/session.ts:245-266` (`packRefs`, `serializedGuardrailPackState`, `restoreGuardrailPacks`) | migrate: recompile to hook handlers; the pack-owned state codec is unchanged |
      | `src/agent-session/session.ts:919-930` (`compiledGuardrailPacks`/`packGuardrails`) | migrate: register the compiled handlers as `tool.call`/`tool.result` under `kernel:guardrail-packs` |
      | `src/contracts-core/agent.ts:199` (`AgentSessionConfig.guardrailPacks`) | keep field |

    - **Task 3 caller map — `providerRequestPolicies`, `inputBuilder`, `promptBuilder`, provider middleware hooks, `DeterministicTurn*`, `retry`, input/output guardrail stages.**

      | Caller | Verdict |
      | --- | --- |
      | `src/contracts-core/agent.ts:126`, `src/contracts-protocol.ts:93`, `src/contracts-core/extensions.ts:140-146`, `src/contributions.ts:84,112`, `src/extensions.ts:204-205`, `src/agent-session/session.ts:804`, `src/run-bundle.ts:99` | delete `providerRequestPolicies` + registry → `model.request` handlers |
      | `src/contracts-core/agent.ts:115,340`, `src/contracts-core/extensions.ts:12,187`, `src/contributions.ts:9,74,102`, `src/extensions.ts:13,162-164,337`, `src/manifests.ts:12,119`, `src/input.ts:14,82,87,111,320,347-348`, `src/agent-session/session/assemble.ts:655` | delete `inputBuilder` + `registerInputBuilder` → `run.input` / `context.build` |
      | `src/contracts-core/agent.ts:116,356`, `src/contracts-core/extensions.ts:14,188`, `src/contributions.ts:11,75,103`, `src/extensions.ts:16,166-168`, `src/manifests.ts:13,120`, `src/input.ts:20,99,113,179,369,397`, `src/agent-session/session/assemble.ts:656` | delete `promptBuilder` + `registerPromptBuilder` → `context.build` |
      | `src/middleware.ts:5,6,12,19-89`; `src/agent-session/session/provider-round.ts:238-302,328`; `src/agent-session/session/assemble.ts:719-732`; `src/capture.ts:4,58,91`; `src/contracts-core/extensions.ts:49`; `src/index.ts:581-589` | delete `beforeProviderTurn`/`provider_request`/`retry` + `DeterministicTurn*` → `model.call` / `model.request`; `retry` deleted with no replacement (kernel retry stays) |
      | `src/contracts-core/run-limits.ts:141-145`; `src/guardrails.ts`; `src/agent-session/session/assemble.ts:475`; `src/agent-session/session/provider-round.ts:447`; `src/agent-session/session.ts:764` | delete `Guardrails.input`/`output` + the `guardrails` field/type/stage runner → `run.input` / `model.response` `ctx.reject` |
      | `packages/memory/src/compaction/llm/strategy.ts:44,184` | migrate: `providerRequestPolicies` → `model.request` handler |
      | `packages/prism-core/src/governance/model-router/{router,invocation,selection}.ts` | migrate: routing → `model.call` around handler |
      | `packages/hooks/src/compile.ts:312-333` | migrate UserPromptSubmit → `run.input` |
      | `packages/agent-sdk/src/{define-agent.ts,planes/hooks.ts}` | migrate builder/policy planes → hooks |
      | `src/__tests__/{provider-request-policy,input-pipeline,deterministic-turns,middleware,prefix-stability-conformance,capture,guardrails}.test.ts` | delete/rewrite |
      | `examples/{custom-builders,host-composition-compat,caveman-ponytail,crew-hierarchy}.ts` | migrate |

    - **Task 4 caller map — `instructionInjectors`, `context`, `toolNarrowing`/`allowHiddenToolCalls`, `promptBuilder`, `stopHooks`, `turnPolicy`/`maxStopContinuations`.**

      | Caller | Verdict |
      | --- | --- |
      | `src/contracts-core/agent.ts:144,292-338`, `src/contracts-protocol.ts:12,133`, `src/contracts-core/extensions.ts:13,199`, `src/contributions.ts:10,86,114`, `src/extensions.ts:14,212-214,343,357`, `src/instruction-injection.ts` (delete), `src/input.ts:15,29,82-83,249-250`, `src/agent-session/session/types.ts:194`, `src/agent-session/session/assemble.ts:546,569,652` | delete `InstructionInjector` + `registerInstructionInjector` → `context.build` handler factories |
      | `src/rpc.ts:9,15,45-80,290-297`, `src/cli-runner.ts:14,30,35,68-74,300,397-412,529-552`, `src/node/instruction-injectors.ts` | delete the injector discovery/resolution path (Task 1(d)) → `context.build` |
      | `packages/prism-code/src/{wiki.ts,acp.ts,headless.ts,tui/index.ts}` | migrate injectors → `context.build` |
      | `packages/agent-sdk/src/planes/hooks.ts` | migrate instructions plane → `context.build` |
      | `packages/memory/src/wiki/extension.ts:67-79` | migrate wiki injector → `context.build` |
      | `src/node/system-project-prompts.ts` | migrate → `context.build` factory; preserve the project-instruction trust gate |
      | `src/contracts-core/agent.ts:78,292`, `src/contracts-core/extensions.ts:11,183`, `src/contributions.ts:6,70,175`, `src/extensions.ts:8,146,344`, `src/input.ts:10,93,112`, `src/agent-definitions.ts:8,140`, `src/node/agent-definitions.ts:8,398-403` | delete `AgentConfig.context`/`RunOptions.context` + `registerContextProvider` → `context.build` |
      | `packages/prism-code/src/{prompt.ts,observational-memory.ts}` | migrate → `context.build` factories |
      | `packages/memory/src/{memory.ts,fabric/*,compaction/observational-memory/compose.ts,rag/context.ts,rag/types.ts,types.ts}` | migrate → `context.build` handler factories |
      | `src/contracts-core/agent.ts:58-68,88,90`, `src/contracts-protocol.ts:121-124,329`, `src/tools.ts:224`, `src/agent-session/session/{tool-round.ts:408,types.ts:204,assemble.ts:582,618-629}` | delete `toolNarrowing`/`allowHiddenToolCalls` → `context.build` (tools) |
      | `src/contracts-core/agent.ts:18,153-154`, `src/contracts-protocol.ts:27,147`, `src/contracts-core/loop.ts:52-73`, `src/contracts-core/extensions.ts:19,200-201`, `src/contributions.ts:18,87,115`, `src/extensions.ts:23,216-218,345-346,359`, `src/agent-session/session/{types.ts:214,assemble.ts:219-251,400-402,578,804,848-849,948}` | delete `stopHooks` + `StopHook*` + `registerStopHook` → `run.end` |
      | `packages/prism-coding-tools/src/agent/todo.ts:308` | migrate `TodoContinuationStopHook` → `run.end` handler factory |
      | `packages/agent-sdk/src/{define-agent.ts:26,56-59,190-192,352,planes/hooks.ts:8,30,74}` | migrate `stopHooks` → `run.end` |
      | `packages/prism-code/src/{acp.ts:266,headless.ts:282}` | migrate the todo stop hook → `run.end` |
      | `src/contracts-core/loop.ts:32-44`, `src/contracts-core/run-limits.ts:28,45,48-49`, `src/run-limits.ts:119-122,159,165`, `src/contracts-protocol.ts:34,145,210-211,234,657`, `src/agent-session/session/{assemble.ts:189-368,770,798-805,847,types.ts:172,211,persist.ts:231-233}`, `src/agent-run-state.ts:99-103,457`, `src/agent-run-lifecycle.ts:226` | delete `turnPolicy`/`TurnPolicy*`/`host_policy` → `turn.before` `{ stop }` (`stopReason: "hook_stop"`); rename `maxStopContinuations`→`maxContinuations` |
      | `packages/prism-code/src/limits.ts:1,22,47,77,146,260`, `packages/prism-code/src/headless.ts:35,311-337` | migrate: `createCostTurnPolicy` → `turn.before`; rename `maxStopContinuations`→`maxContinuations` |
      | `src/__tests__/{instruction-injection*,node-instruction-injectors,rpc-instruction-injectors,cli-instruction-injectors,tool-narrowing,stop-hooks,turn-policy-stops,input-pipeline,attention-compiler-*}.test.ts` | delete/rewrite |
      | `examples/{instruction-injection,context,tool-narrowing-planes,custom-tools-skills-context,external-app-db-backed,caveman-ponytail,hooks-json,memory-fabric,rag,working-semantic-memory,extension-package}.ts` | migrate |

    - **Task 5 caller map — compaction strategy/trigger and the `middleware` registry.**

      | Caller | Verdict |
      | --- | --- |
      | `src/contracts-core/compaction.ts:6-10,39-47,83-97` | delete `CompactionStrategy`/`CompactionTrigger` + `CompactionOptions.strategy`/`trigger` → the `compaction` slot + `compaction.when`; keep the non-strategy knobs |
      | `src/contracts-core/extensions.ts:17,189`, `src/contributions.ts:5,76`, `src/extensions.ts:7,170` | delete `registerCompactionStrategy` + its registry |
      | `src/compaction.ts:12` (`createDefaultCompactionStrategy`) | keep the body, re-express as the default `Compactor` |
      | `src/slots/defaults.ts:1,25` | migrate: default `Compactor` from the same function |
      | `src/agent-session/session.ts:18,912,919-930` | migrate: `session.compact()`/auto-compaction → the slot |
      | `src/agent-session/session.ts:836-857`; `src/attention-compiler.ts:33,301-303,918`; `src/contracts-core/attention.ts:6,34,75,111` | migrate: `CompactionTrigger` → `compaction.when` (kernel default under owner `kernel`) |
      | `src/testing/compaction-conformance.ts:9,26-27` | retarget `assertCompactionStrategyConforms` to `Compactor` (Task 1(e)) |
      | `src/middleware.ts` (whole file), `src/contracts-core/extensions.ts:7,176,179`, `src/extensions.ts:29,49,64-71,114,122-130,234,349-361`, `src/contracts-core/agent.ts:9,117`, `src/index.ts:586-589` | delete `middleware` field/registry/`Middleware*` types/`src/middleware.ts`/`activateKernel().middleware`; the last hook names map to `retry` (Task 3, deleted), tool stages (Task 2), model/context stages (Tasks 3-4), and session/compaction → observe/`compaction.when` |
      | `src/agent-session/session.ts:520,532,924,927`; `src/agent-session/session/{tool-round.ts:448,assemble.ts:416,684,719-732,provider-round.ts:21,30,234-284,328}`; `src/input.ts:30,81,94-95,141,153,176,234,296,317,326,340-355,370-371`; `src/capture.ts` | delete the call sites as their owners retire |
      | `packages/memory/src/compaction/{llm,observational-memory}/*` | migrate strategies → `Compactor` factories |
      | `packages/prism-code/src/{compaction.ts,observational-memory.ts,sessions.ts,config.ts,tui/commands.ts,index.ts}` | migrate → `slots.compaction` |
      | `packages/ag-ui`, `packages/prism-core` middleware users | migrate to hooks/observe |
      | `src/__tests__/{compaction*,mid-run-compaction,middleware,compaction-request-hook}.test.ts` | delete/rewrite |
      | `examples/{compaction,coding-compaction,host-composition-compat,autonomous-coding-loop,observational-memory-recall-status-view}.ts` | migrate |

    - **Assumption checks:**
      - **(a) Confirmed with a citation correction.** `PermissionPolicy` (`src/security.ts:33`) has kernel users beyond tool dispatch: the resource loader (`src/contracts-core/resources.ts:3,22`; `src/resources.ts:9`; `src/content.ts:303`; `src/input.ts:522`), the node loaders (`src/node/{agent-definitions,contribution-discovery,instruction-injectors,system-project-prompts}.ts`), extension setup (`src/extensions.ts:52,241`), host composition (`src/host-composition.ts`), and the supervisor. So Task 2 removes only `AgentConfig.permission` (`src/contracts-core/agent.ts:120`), `SecureAgentOptions.permission` (`:171`), and the `DispatchToolCallOptions.permission` dispatch use (`src/tools.ts:94,328`); the type and `checkPermission`/`assertPermission`/`createStaticPermissionPolicy` stay. **Correction:** `src/execution-policy.ts` is a different type (`ExecutionPolicy`, `checkExecution`, `assertExecutionAllowed`), not a `PermissionPolicy` user. Prism-code approval rides that `ExecutionPolicy`, not the retired field.
      - **(b) Confirmed, with a seam detail.** `compileGuardrailPacksWithState` (`src/guardrails.ts:217-266`) already turns pack refs into stage guardrails (`toolInput`/`toolOutput`) plus `askGate`/`askBlocks` and a pack-owned `snapshotState`. Re-expressing each produced guardrail as a `tool.call` (deny/ask) or `tool.result` (tripwire→deny) handler under owner `kernel:guardrail-packs` preserves pack semantics because the guardrail `evaluate(ctx)` is unchanged. Durable restore (`serializedGuardrailPackState`/`restoreGuardrailPacks`, `src/agent-session/session.ts:249-266`) recompiles through the same function with the same state codec, so it is orthogonal to the stage container and survives. `GuardrailError` stays for packs.
      - **(c) Confirmed: `retry` has callers, but no host/example caller.** Production: `src/agent-session/session/provider-round.ts:328` (the kernel retry loop). Tests: `src/__tests__/agents.test.ts:2093`, `src/__tests__/middleware.test.ts:49-53`. No example or package registers a `retry` middleware. Kernel retry stays; the `retry` hook name and `RetryMiddlewarePayload` are deleted in Task 3 with no replacement, and the two tests drop their rows.
      - **(d) Confirmed.** `src/rpc.ts:45-80,290-297` resolves `instructionInjectors` only from the host-supplied `ContributionRegistry`; `src/cli-runner.ts:397-412,547-552` builds them only from extension-discovered injectors (`registerDiscoveredInstructionInjectors`). Both are extension-discovery paths, so Task 4 deletes the param, `resolveInstructionInjectors`, `runInstructionInjectors`, and `registerInstructionInjector` with the field.
      - **(e) Confirmed.** `Compactor` (`src/slots/types.ts:5-8`) is structurally `CompactionStrategy` (`src/contracts-core/compaction.ts:6-10`) minus the name: both are `compact(context: CompactionContext)`. `assertCompactionStrategyConforms` (`src/testing/compaction-conformance.ts:26`) only needs its parameter retargeted to `Compactor`; the LLM and observational-memory strategies (`packages/memory/src/compaction/{llm/strategy.ts:62,observational-memory/strategy.ts:30-32}`) already return `compact()` and pass once typed as `Compactor`. No behavioral change.

    - **Security — trust/approval paths touched by Tasks 2 and 4:**
      - **ACP permission elicitation** (`packages/ag-ui/src/acp/agent/{permission-elicit,decision,forward-notify}.ts`) is **event-driven, not `AgentConfig.permission`**: it reacts to `agent_suspended` and resumes through `resolveRunDecisions`. Under Part A the ask path resolves inline via `host.ui.confirm` or the store slot; the replacement is a host `tool.call` handler returning `{ ask }` (answered by the ask path) registered where the agent is composed, with `permission()`/`decisionForElicitation` kept as the elicitation transport.
      - **prism-code approval** (`packages/prism-code/src/approval.ts:198,321`) is an `ExecutionPolicy` applied per-tool via `ToolsOptions.executionPolicy` (`packages/prism-coding-tools/src/agent/index.ts:611`), with persisted `permissions.json` rules. It is **not touched by the `permission` field removal.** If Task 2 keeps its “entry point becomes a `tool.call` hook” goal, the handler must reproduce `ExecutionPolicy.check` (allow/deny/`modified`→rewrite), the prompt, and `onDenied`; recommend deferring to Phase 7 (`@arnilo/prism-approval`) rather than re-architecting a retained seam. Amendment 2.
      - **MCP trust** (`packages/mcp/src/server.ts:98-116`) calls `dispatchToolCall` directly with `permission`/`guardrails`. Since MCP is outside `RunController.executeTools` it has no hook bus; its replacement is `DispatchToolCallOptions.beforeExecute` (permission) plus a result transform (guardrails). Amendment 1.
      - **`createSecureAgent`** (`src/secure-agent.ts:35,70,92`): readiness swaps `permission.check` for ≥1 host `tool.call` registration; a missing gate fails with `HostCompositionError`/`ERR_PRISM_HOST_COMPOSITION` (`src/host-composition.ts:11,270,348,383`). No gate is lost.
      - **Supervisor delegation** (`packages/prism-core/src/runtime/supervisor/supervisor.ts:544-589,882-915`) composes the child `permission` via `intersectPolicies` and already registers `askEveryTool()`; the replacement is a composed child `tool.call` handler. Amendment 1.

    - **Amendments applied:**
      1. **Task 2 — add the missed `permission` callers.** Add `packages/prism-core/src/runtime/supervisor/{supervisor,types}.ts` (compose `intersectPolicies` as a child `tool.call` handler) and `packages/mcp/src/server.ts` (direct `dispatchToolCall` → `beforeExecute`) to the caller list and Files to Create/Edit.
      2. **Task 2 — correct the prism-code attribution.** prism-code approval is an `ExecutionPolicy` gate, not a `permission` caller. State explicitly whether Task 2 re-expresses it as a `tool.call` hook or defers it to Phase 7; if deferred, drop it from the Functional (callers) and Code Quality bullets and keep `packages/prism-code/src/__tests__/approval.test.ts` untouched.
      3. **Task 3 — citation correction.** Replace “execution policy (`src/execution-policy.ts:36`)” in the Task 1(a) heritage with the real `PermissionPolicy` users; `ExecutionPolicy` is a distinct type.
      4. **Task 4 — caller list.** Add `packages/prism-code/src/limits.ts` and `packages/prism-code/src/headless.ts:311-337` (the `createCostTurnPolicy` `turnPolicy` and `maxStopContinuations` callers) and the `hooks-json`/`memory-fabric`/`rag`/`working-semantic-memory` examples.
      5. **Task 5 — confirmed retarget.** `assertCompactionStrategyConforms` moves to `Compactor` with a parameter-only change; the family strategies pass unchanged.

- [x] Task 2: Tool gates → `tool.call` / `tool.result` (retire `permission`, the tool guardrail stages, and the tool middleware hooks)
  - Acceptance Criteria:
    - Functional (removed, with no alias):
      - `AgentConfig.permission` and its tool-dispatch use (`src/tools.ts:94,328`, `src/agent-session/session/tool-round.ts:450`, `src/agent-session/session/assemble.ts:680`; post-Part-A line numbers, Task 1)
      - `Guardrails.toolInput` and `Guardrails.toolOutput`
      - the `tool_call` and `tool_result` members of `MiddlewareHookName`
      - Tool decisions come only from `tool.call`, and tool-output rewriting or blocking comes only from `tool.result`.
    - Functional: Guardrail packs compile onto `tool.call` (deny / ask) and `tool.result` (tripwire → deny result) under the owner `kernel:guardrail-packs`.
      - Pack semantics, pack durability, and decision revalidation are unchanged.
      - The existing `guardrail-pack*.test.ts` suites pass, rewritten only where they asserted stage internals.
    - Functional: `createSecureAgent` swaps its `permission.check` readiness requirement for "at least one host `tool.call` registration" (plan 144 Task 1(j)).
      - `SecureAgentOptions.permission` is removed. A missing gate fails with the existing composition error code.
    - Functional (callers, migrated in this task):
      - ACP permission elicitation in `packages/ag-ui/src/acp/agent/{permission-elicit,decision}.ts` becomes a `tool.call` → `{ ask }` hook, answered by the Part A ask path.
      - `packages/mcp` (its direct `dispatchToolCall` → `beforeExecute` + a result transform; it has no hook bus), `packages/hooks/src/compile.ts` (PreToolUse / PostToolUse → `tool.call` / `tool.result`), `packages/agent-sdk/src/planes/hooks.ts`, `packages/prism-coding-tools`, `packages/acp-agent`, and `packages/prism-channels`
      - `packages/prism-core/src/runtime/supervisor/{supervisor,types}.ts`: compose the child `intersectPolicies(...)`/`childAgent.config.permission` into a child `tool.call` handler (the supervisor already registers `askEveryTool()`), replacing `permission:` in both `createAgent` calls.
      - prism-code approval is **not** a `permission` caller (Task 1 finding): it rides the retained `ExecutionPolicy`/`ToolsOptions.executionPolicy` seam and is left unchanged until roadmap Phase 7 (`@arnilo/prism-approval`).
      - `examples/{secure-agent,hooks-json,host-composition-compat,guardrail-packs}.ts` and the tests Task 1 lists
    - Functional (sweep): grep `\b(permission:|toolInput|toolOutput|"tool_call"|"tool_result")\b` over `src/ packages/ apps/ scripts/ examples/ docs/`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, and released `/docs` prose. Zero kernel-config hits; each remaining hit is attributed in the note (for example, an event type named `tool_call`). Drop the Task 1-listed `docs.test.ts` pin rows.
    - Performance: One decide dispatch per tool call replaces the permission check plus the tool-input stage run. There is no extra allocation with zero registrations. The tool-round latency suites stay green.
    - Code Quality:
      - The kernel keeps no approval policy (§2.1 "Not in the kernel": approval policy).
      - The prism-code approval engine keeps its `ExecutionPolicy` gate unchanged (Task 1 finding: it is not the retired `permission` field). Roadmap Phase 7 (`@arnilo/prism-approval`) replaces it.
    - Security:
      - Deny wins over allow and ask; plan 144's invariant test stays green.
      - A throwing gate is a deny.
      - ACP and prism-code approval (its retained `ExecutionPolicy` gate) still gate every write, execute, and network tool. `approval_paths_still_gate_after_migration` proves this per host.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (`tool.call`, `tool.result` rows)
      - `src/tools.ts:260-300`
      - `src/agent-session/session/tool-round.ts:357-505`
      - `src/guardrails.ts:81-268`
      - `src/secure-agent.ts:30-110`
      - plan 092 and plan 104 (guardrail packs)
    - Options Considered:
      - Keep `PermissionPolicy` as a `tool.call` sugar field. Rejected: that is a compatibility alias, which §1.4 forbids.
      - Delete guardrail packs now, since they move to `@arnilo/prism-guardrail-packs` in roadmap Phase 9. Rejected: they are a working capability with durability tests. Recompiling them onto hooks is small, and deleting them strands their users until Phase 9.
    - Chosen Approach:
      - Delete the fields and their call sites, and register the migrated behavior as hooks at each caller.
    - API Notes and Examples:
      ```ts
      hooks: (h) => h.on("tool.call", async (call) => (await policy.allows(call) ? undefined : { deny: "policy" }), { id: "policy" })
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-core/run-limits.ts`, `src/tools.ts`, `src/guardrails.ts`, `src/secure-agent.ts`, `src/middleware.ts`, `src/agent-run-state.ts` (fingerprint), and `src/agent-session/session/{tool-round,assemble}.ts`
      - `src/host-composition.ts`
      - `src/index.ts`
      - `packages/prism-core/src/runtime/supervisor/{supervisor,types}.ts` and `packages/mcp/src/server.ts` (Task 1 amendment 1)
      - The workspaces and examples above.
      - `src/__tests__/{guardrails,guardrail-pack*,agent-approval-coverage,public-export-contract,docs}.test.ts`
      - `docs/next/hooks.md`: the "Replaces" notes for these rows.
      - `CHANGELOG.md`
      - `scripts/compat-baseline/*.txt`: every file the regeneration rewrites.
    - References:
      - plan 144 Tasks 2 and 5
  - Test Cases to Write:
    - `permission_field_is_gone`: a type test showing `AgentConfig` rejects `permission`.
    - `guardrail_packs_compile_onto_tool_hooks`
    - `guardrail_pack_ask_suspends_via_tool_call`
    - `secure_agent_requires_tool_call_gate`
    - `approval_paths_still_gate_after_migration`: covers ACP, prism-code headless, and prism-code TUI.
    - `hooks_json_pre_tool_use_maps_to_tool_call`: in `packages/hooks`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Config fields and types are removed.
    - Docs pages to create/edit:
      - `docs/next/hooks.md`: "Replaces" notes.
      - `CHANGELOG.md`: "Removed" entries for `permission`, `guardrails.toolInput` / `toolOutput`, and the tool middleware hooks, each naming its replacement.
      - Package READMEs whose documented config changes (`packages/hooks/README.md`, `packages/agent-sdk/README.md`): update their examples to `hooks`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: `node scripts/release.mjs gate --update-baseline`. Paste every baseline diff. The removals attributed to this plan are the fields and types above. Any other removal is inherited, and the note names its plan. `node scripts/release.mjs gate` then exits 0.
  - Notes (executed 2026-10-01):
    - **All four retirements landed with no alias.** `AgentConfig.permission`, `SecureAgentOptions.permission`, `DispatchToolCallOptions.permission`, `Guardrails.toolInput`, and `Guardrails.toolOutput` are gone; `tool_call` and `tool_result` are gone from `MiddlewareHookName`. `PermissionPolicy`, `checkPermission`, `assertPermission`, and the `guardrails` field stay (the `guardrails` field and the `Guardrails` type keep only the input/output stages until Task 3).
    - **Two scope findings forced plan amendments.** Both are recorded below because they change behavior that existing tests pinned: the supervisor's tool-call budget, and deny-wins over ask.
    - **Finding 1 — a permission gate cannot carry a tool-call budget, so `toolBudgetPolicy` is deleted.** `packages/prism-core/src/runtime/supervisor/supervisor.ts` intersected `toolBudgetPolicy(limits.maxToolCalls)` into the child permission. That worked because `dispatchToolCall` charged `maxToolCalls` *before* the permission check, so the (N+1)th call raised `AgentRunError` → `SupervisorLimitError`. As a `tool.call` hook the policy returns `{deny}`, and `RunController.dispatchOne` returns on a deny without dispatching, so the call is never charged and the run finishes `succeeded` with a denied tool result instead of rejecting. The budget now rides the child's own run limit (`session.run(input, { limits: { maxToolCalls: limits.maxToolCalls } })`, `supervisor.ts:615`), which charges on dispatch and surfaces as `SupervisorLimitError` as before. `toolBudgetPolicy` is deleted with a comment naming why. Consequence for Tasks 3–5: **a budget that must surface as a run error belongs in `RunLimits`, not in a gate.** The 8 supervisor budget/cascade tests pass again.
    - **Finding 2 — deny now wins over ask, changing two suspensions into denials.** `packages/prism-core/.../__tests__/nested-approvals.test.ts` `cannot widen child permission through a root approval` asserted `suspended` (the root's ask fired first) and then `succeeded` (the child's deny blocked at dispatch). Under roadmap §2.4 the deny wins at `tool.call`, so the run never suspends. The test now asserts `succeeded` with no `interruption` and no execution, which keeps the property it was written for: **a root approval cannot widen a child deny.** The same rewrite already applied to `guardrail-pack-ask.test.ts` and `guardrail-pack-decision-revalidation.test.ts`.
    - **Guardrail packs compile onto `tool.call` / `tool.result` with a new type split.** `src/guardrails.ts` now exports `CompiledGuardrailPacks` (raw arrays `toolInput`/`toolOutput`/`askGate`/`askBlocks` plus `packs`/`snapshotState`) and `CompiledGuardrailRules` (`{toolInput, toolOutput}`), and `runGuardrails` delegates to a new exported `runGuardrailList(guards, …)` that takes the guards explicitly; `guardrailRefusalText` is exported for hosts that must reproduce a refusal. `runGuardrailList` early-returns on an empty array, so the no-extra-allocation claim holds.
    - **Session-scoped pack handlers need an id and a payload guard.** The bus is per agent and shared by all of its sessions (`hookBusInstance = runtime?.hooks ?? createHookBus({owner:'host'})`), so unnamed registrations were ambiguous. Registering with a fixed id (`'guardrail-packs'`) threw `ERR_PRISM_HOOK_DUPLICATE_ID` on the *second* session of an agent, breaking `session.fork()`. Pack handlers therefore register with `sessionHookId()` (module counter → `session-<n>`, `SESSION_HOOK_ID_PREFIX`) and scope themselves by comparing the payload/`HookContext` `sessionId`. Because a `ToolCallDecision` is only a bare string for `ask`, `evaluatePackToolCall` stashes the pack record on `SessionHost.packAskRecords` keyed by `callId`; `stageAskDecisions` reads and deletes it, so pending decisions keep their `guardrail`/`guardrailRule`/`reason` identity.
    - **Session hooks are run state, not agent definition.** `agentHookIds` (`src/agent-session/runtime-registry.ts`) and the suspended-run `hookIds` (`src/agent-session/session/persist.ts`) now filter with the shared `isSessionScopedHookId` (`SESSION_HOOK_ID_MARKER = '#session-'`). Without the filter the durable agent fingerprint mismatched on suspend/resume.
    - **A hook deny emits no `tool_execution_blocked`.** `src/loop/dispatch.ts` appends the `hook_denied` `ToolResult` as a tool message. Pack durability/ask/revalidation tests that asserted a `tool_execution_blocked` event with `guardrail_blocked` now assert the `guardrail_decision` record instead. A pack tripwire no longer rejects the whole run (the bus converts a throwing `tool.call` handler into a deny) — the plan's explicit replacement text wins: **a denied call with a succeeded run.**
    - **A blocked `tool.result` cannot deny.** It is a transform, so packages/hooks PostToolUse returns a withheld `ToolResult {toolCallId, name, error:{message: reason}}` (run continues, raw result withheld) instead of throwing, which would fail the run closed.
    - **New extension hook seam.** `ExtensionAPI` gained `readonly hooks: HookRegistrar` (a type-only import from `../hooks/index.js`, erased at runtime). `createExtensionKernel` collects inert `ExtensionHookRegistration`s with undo tracking and `activateKernel` returns `hooks: (registrar) => void`, replayed onto the agent's registrar via `AgentConfig.hooks`. Without this seam `packages/hooks` could not reach `tool.call` at all (`ExtensionAPI` had no registrar), since `createHooksExtension` returns through the kernel. `packages/agent-sdk/src/planes/hooks.ts` returns `hooks: activated.hooks` and `define-agent.ts` always sets an `AgentConfig` registrar (the hooks plane first, then `config.policy` as a `tool.call` gate).
    - **Direct `dispatchToolCall` callers have no bus, so they use `beforeExecute`.** `packages/mcp/src/server.ts` keeps `McpServerOptions.permission` and calls `assertPermission(...)` in `beforeExecute`; `packages/prism-core/.../workflows/run/node-execution.ts` dropped `guardrails: options.guardrails` entirely (the workflow tool path has no hook bus) and its guardrail test is deleted. The supervisor composes its child policy into a `tool.call` handler (`registerPermissionGate`) in both `createAgent` calls; since `AgentConfig.permission` is gone the effective policy is `preliminaryPermission` / `permission` rather than a re-intersection with `childAgent.config.permission`.
    - **`createSecureAgent` readiness is now a `tool.call` gate.** It drops `options.permission.check`, the `permission` field, and its `Omit` key, and `freezeGuardrails` freezes only input/output. Because `askEveryTool()` always registers a `tool.call` handler, the gate count is satisfied trivially; `src/host-composition.ts` computes `governance.permission` as `isSecure || typeof config?.hooks === "function"` and its business-readiness message is now `Business composition requires a tool gate (a `tool.call` hook)`.
    - **Sweep.** `permission:` is gone from every `AgentConfig`/`SecureAgentOptions`/dispatch construction in `src`, `packages`, `examples`, and `scripts`; `toolInput`/`toolOutput` survive only inside `src/guardrails.ts`, `src/guardrail-packs/**`, and the new `CompiledGuardrail*` types. Remaining `permission` uses are the retained `PermissionPolicy` consumers (resource loader, `src/extensions.ts`, host composition, content, input) and the `ExecutionPolicy` gate. No `tool_execution_blocked`-style event rename was needed, and no `tool_call`/`tool_result` middleware name remains.
    - **Public surface.** `src/index.ts` now also exports `runGuardrailList`, `guardrailRefusalText`, and the types `CompiledGuardrailPacks`, `CompiledGuardrailRules`, `RunGuardrailListOptions` (plus `ExtensionHookRegistration` from `extensions.js`). `FROZEN_VALUE_EXPORTS` and `FROZEN_TYPE_EXPORTS` in `src/__tests__/public-export-contract.test.ts` gained exactly those five names; nothing was removed. `node scripts/release.mjs gate --update-baseline` rewrote three baselines: `arnilo__prism.txt` (+138/-20, almost all additive hook/slot exports from Part A that the baseline had never picked up), `arnilo__prism-agent-sdk.txt`, and `arnilo__prism-code.txt`. The only removal in the whole diff is the `Guardrails`/`GuardrailPackRow` re-export line narrowing; no retired symbol name remains.
    - **Verification.** `bun run typecheck` exits 0 across all 15 workspaces. `src/__tests__` and the `packages/{agent-sdk,prism-code,prism-channels,ag-ui,mcp,hooks,prism-core}` suites pass; the guardrail/permission batch is 179 pass / 0 fail. Known reds on this machine are inherited or environmental, not from this task: `packaging guard > @arnilo/prism-agent-sdk` peer dependency (inherited from plan 144), `names the Bun runtime when the sqlite modules are imported under node`, the spawn-heavy stdio/bin suites (need `--timeout=0`), and the soft real-time budget asserts (`run-bundle` 100-tool snapshot and `field-policy` overhead). I confirmed `run-bundle` is pre-existing by stashing every tracked change and re-running it (8.36 ms against a 5 ms budget, same failure).

- [x] Task 3: Model path → `run.input` / `model.request` / `model.call` / `model.response` (retire `providerRequestPolicies`, `inputBuilder`, the input and output guardrail stages, and the provider middleware hooks)
  - Acceptance Criteria:
    - Functional (removed, with no alias):
      - `AgentConfig.providerRequestPolicies` and `RunOptions.providerRequestPolicies`
      - `ProviderRequestPolicy*` types and `ExtensionAPI.registerProviderRequestPolicy`, plus its contribution registry
      - `AgentConfig.inputBuilder`, `InputBuilder`, and `registerInputBuilder`
      - `Guardrails.input` and `Guardrails.output`. With the tool stages gone after Task 2, the `guardrails` field, the `Guardrails` type, and the stage runner are deleted. `GuardrailError` stays only if packs still use it (Task 1(b)).
      - The `beforeProviderTurn`, `provider_request`, and `retry` middleware hook names, and `DeterministicTurn*` (`src/middleware.ts:19-89`)
    - Functional (replacements):
      - Deterministic turns become a `model.call` around handler that skips `next`.
      - Input rewriting and rejection is `run.input`.
      - Output rejection is `model.response` `ctx.reject(reason)`, which fails the run with `HookRejectedError`, matching the old output-guardrail failure.
    - Functional (callers): migrate in this task:
      - `packages/memory` (the `providerRequestPolicies` users)
      - `packages/prism-core/src/governance/model-router` → `model.call`
      - `packages/hooks` (UserPromptSubmit → `run.input`)
      - `packages/agent-sdk`
      - `src/run-bundle.ts:99`
      - `examples/{custom-builders,caveman-ponytail,crew-hierarchy}.ts`, and every other example Task 1 lists
    - Functional (sweep): grep for `providerRequestPolicies|ProviderRequestPolicy|inputBuilder|InputBuilder|beforeProviderTurn|provider_request|DeterministicTurn|\bguardrails\b|Guardrails\b` with the standard exclusions. The only hits allowed are attributed released `/docs` prose. Drop the Task 1-listed pin rows.
    - Performance: The `model.request` / `model.call` dispatch replaces the policy loop and middleware call one for one. No extra provider request. The prefix-stability conformance (`src/testing/prefix-stability-conformance.ts`) stays green, which proves request bytes are unchanged with no hooks registered.
    - Code Quality: Routing, caching, and deterministic turns live in handlers, not the kernel. `model-router` stays in `prism-core` until roadmap Phase 9 moves it.
    - Security:
      - Redaction of request secrets (`generateWithRetry` `requestSecrets`) still applies after `model.request` transforms, so a transform cannot un-redact.
      - `model_request_transform_cannot_leak_secret` proves this.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (`run.input`, `model.request`, `model.call`, `model.response` rows)
      - `src/agent-session/session/assemble.ts:600-620`
      - `src/agent-session/session/provider-round.ts:238-339`
      - `src/agent-session/session.ts:755`
      - `src/input.ts:300-380`
    - Options Considered:
      - Keep `ProviderRequestPolicy` as a typed helper that returns a hook. Rejected: that is an alias by another name. A policy is now a handler function.
    - Chosen Approach:
      - Delete the old call sites inside `turn()`, and rely on the Part A hook firing already at the same points.
    - API Notes and Examples:
      ```ts
      h.on("model.call", async (req, next) => (cached(req) ?? next(req)), { id: "cache" });
      h.on("model.response", (msg, ctx) => (violates(msg) ? ctx.reject("policy") : undefined));
      ```
    - Files to Create/Edit:
      - `src/contracts-core/{agent,extensions,run-limits}.ts`, `src/contracts-protocol.ts`, `src/middleware.ts`, `src/guardrails.ts`, `src/input.ts`, `src/extensions.ts`, and `src/contributions.ts`
      - `src/agent-session/{session.ts,session/assemble.ts,session/provider-round.ts}`
      - `src/run-bundle.ts`, `src/agent-run-state.ts`, and `src/index.ts`
      - The workspaces and examples above, and their tests.
      - `src/__tests__/{provider-request-policy,middleware,guardrails,public-export-contract,docs}.test.ts`: delete or rewrite onto hooks.
      - `docs/next/hooks.md`
      - `CHANGELOG.md`
      - `scripts/compat-baseline/*.txt`
    - References:
      - plan 144 Task 4 (`turn()` wraps these call sites)
  - Test Cases to Write:
    - `deterministic_turn_via_model_call_skips_provider`
    - `model_response_reject_fails_run`
    - `run_input_reject_fails_before_first_turn`
    - `model_router_routes_via_model_call`: in `prism-core`.
    - `model_request_transform_cannot_leak_secret`
    - `prefix_stability_unchanged_without_hooks`: the existing conformance.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes
    - Docs pages to create/edit:
      - `docs/next/hooks.md`
      - `CHANGELOG.md`: "Removed" entries with their replacements.
      - Affected package READMEs (`packages/memory/README.md`, `packages/prism-core/README.md`), if their examples use the removed fields.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: `node scripts/release.mjs gate --update-baseline`. Paste the diffs, with attribution, in the note.
  - Notes (executed 2026-10-01):
    - **Every Task 3 retirement landed with no alias.** Gone: `AgentConfig.providerRequestPolicies` and `RunOptions.providerRequestPolicies`, the `ProviderRequestPolicy`/`ProviderRequestPolicyContext`/`ProviderRequestPolicyResult` types, `ExtensionAPI.registerProviderRequestPolicy` and the `providerRequestPolicies` contribution registry, `AgentConfig.inputBuilder` and the `InputBuilder` interface with `registerInputBuilder` and the `inputBuilders` registry, `Guardrails.input`/`Guardrails.output` plus the whole `Guardrails` container (field on `AgentConfig` and `RunOptions`, type, `runGuardrails`, `RunGuardrailsOptions`, `stageGuards`, `mergeGuardrails`, `freezeGuardrails`), the `beforeProviderTurn`/`provider_request`/`retry` middleware names, and all of `DeterministicTurn*`. `src/provider-request-policy.ts` keeps only `applyDefaultProviderRequestOptions`, `mergeProviderRequestOptions`, and `ProviderRequirementError`; `createSessionCachePolicy` and `createProviderRequestPolicyChain` are deleted with it. `ManifestContributionKind` loses `inputBuilder` and `providerRequestPolicy` (their registries are gone), so a manifest declaring either now fails closed at parse.
    - **Deleting the policy chain also deleted a live behavior, so it was restored.** `applyProviderRequestPolicies` was where the kernel called `applyDefaultProviderRequestOptions`, which stamps `sessionId`/`cacheKey`/cache breakpoints and the portable thinking intent. Removing the method silently dropped thinking-level resolution: five `thinkingLevel` tests failed with `options.compat === undefined`. `assemble.ts` now calls `applyDefaultProviderRequestOptions(request, { sessionId, thinkingLevel })` itself, immediately before `session.redactProviderRequest`, so **defaults are stamped and redaction still runs last** — a `model.request` transform can neither skip the stamping nor un-redact (`model_request_transform_cannot_leak_secret`).
    - **`model.request` gained a `secrets` channel, or the retirement would have leaked credentials.** The old `ProviderRequestPolicyResult` carried `secrets` so a policy could declare values it had just injected and have them join the provider-error redaction set. A plain `TransformHook<ProviderRequest, ProviderRequest>` cannot. Dropping it would have let a transform inject a credential and have it echoed verbatim in a provider error. `model.request` is now `TransformHook<ProviderRequest, ProviderRequest | ModelRequestTransformResult>`, `RunController.turn()` unwraps the result and collects `secrets`, `internals.generate(request, requestSecrets)` carries them, and `generateWithRetry` merges them with the retry policy's secrets exactly as before. This also required `HookBus.transform` to return `HookTransformResult<N>` (`Exclude<HookResult<N>, undefined | HookRejection>`) instead of claiming to return the payload; the bus already returned the transform's value, so this is the signature catching up to reality, not a behavior change. Task 6 should freeze `ModelRequestTransformResult` with the rest of the catalog.
    - **Deterministic turns changed shape in two visible ways.** A `model.call` around handler that skips `next` returns a synthetic `message_start`/delta/`done` stream, so the turn runs through the provider-round machinery: it now emits `provider_turn_started`/`provider_turn_finished` and reports the session's **estimated** usage, where the retired `beforeProviderTurn` middleware reported `usage: undefined` and no provider-turn events. The host still emits the frozen `deterministic_turn` event (via `ctx.emit`) and the adapter is still never called (`onRequest` count 0). Both differences are asserted in `deterministic-turns.test.ts`.
    - **`buildTimeline` drops provider steps for host-answered turns.** Because the kernel now wraps a deterministic turn in provider-turn events, the `deterministic_turn` scorer read them as "the adapter was called" and failed provenance. The filter runs at projection time (not on the event) because the host emits the marker from inside `model.call`, i.e. after `provider_turn_started` has already folded. Any `provider` step whose parent turn also carries a `deterministic` step is dropped.
    - **Input rewriting reaches the provider from turn 2, not turn 1.** `run.input` fires in `assemble()` over `inputToMessages(input)` and its output is appended to the session, but the turn-1 request is still built by `assembleProviderInput({ input: nextInput })` from the raw input. So a rewrite shows up in the persisted transcript and in every later turn. **Rejection is unaffected**: `ctx.reject` throws `HookRejectedError` before any provider call, which is the security-relevant half of `run_input_reject_fails_before_first_turn`. Closing the rewrite gap means threading the rewritten messages into `assembleProviderInput`, which is a wiring change to the assembly seam rather than part of this retirement; it is recorded for Task 6's catalog freeze.
    - **`GuardrailRecord.stage` widened to `GuardrailRecordStage`.** `steer_rejected` is a frozen event carrying a `GuardrailRecord`, and `applyPendingSteers` now drives it from `run.input`: a handler returning fewer messages drops that message (never entering history or the store) and the run continues; `ctx.reject` fails the run closed, matching the old `interrupt`. That decision needs an `input`-staged record, so `GuardrailRecord.stage` is `GuardrailRecordStage` (`GuardrailStage | "input" | "output"`) while `Guardrail.stage` and `GuardrailContext` stay tool-only. `AgentRunInterruptionKind` keeps its `input_guardrail` member (frozen persisted vocabulary) although no kernel path produces it now; the two `agent-run-state.test.ts` tests covering input-stage approval suspension were deleted with the mechanism.
    - **Claim grounding is now a `model.response` gate, not an output guardrail.** `createClaimGroundingGuardrail` returns `(message, context) => HookRejection | undefined`: `onViolation: "block"` is `ctx.reject("claim_ungrounded")` and `"flag"` emits a `guardrail_decision` tripwire. `model.response` carries the assistant message alone, so the new options field `toolResults?: () => readonly ToolResult[]` supplies the same-run results the old `GuardrailContext.toolResults` provided; it defaults to none, and `evidenceSources` as a function extractor is unchanged.
    - **Caller migrations.** `packages/prism-core/src/governance/model-router`: `providerRequestPolicy` → `modelRequestTransform` and `createOpenRouterRoutingPolicy()` → `createOpenRouterRoutingTransform()`, returning `ModelRouterRequestTransform` (a new exported type) that composes directly into `hooks.on("model.request", …)`. `packages/memory`'s LLM compaction owns its own provider call outside any bus, so its `providerRequestPolicies` option became `requestTransforms?: readonly ProviderRequestTransform[]` (a plain ordered transform list, no name/registry/`secrets`) — the smallest honest replacement, since there is no bus to hang a hook on. `src/capture.ts` became `ProviderCapture.transform()` returning a `model.request` handler (was `middleware()` on `provider_request`). `packages/hooks`: UserPromptSubmit is a `run.input` handler whose blocking branch is `context.reject(reason)`, and `HooksExtension.guardrails` is deleted. `packages/agent-sdk`: `AgentSdkConfig.guardrails`, `AssembledHooksPlane.guardrails`, and `mergeGuardrails` are deleted; the hooks plane contributes only through `hooks`. `packages/prism-core/src/runtime/workflows`: `WorkflowNodeContext.guardrails` is removed (the workflow tool path already had its guardrail test deleted in Task 2). `src/capture.ts`, `examples/{custom-builders,hooks-json,host-composition-compat,manifests}.ts`, `examples/README.md`, `docs/observability.md`, and `packages/hooks/README.md` followed.
    - **Snapshot surface.** `RunBundleSnapshot.requestPolicies` and `guardrailRows` are deleted (only pack rows remain in `guardrails`), and `agentFingerprint` no longer spreads host guardrails. The pinned 32-tool golden digest moves `sha256:adffa717…` → `sha256:d8077565…`, which is the intended one-time invalidation of the fingerprint key set for the 1.0 break. The run-bundle test's "moves for every listed contribution" row for a guardrail revision is replaced by a hook-registration row, since a host gate is now identified by its registration id.
    - **Public surface.** Removed from the root barrel: `createProviderRequestPolicyChain`, `createSessionCachePolicy`, `runGuardrails`, `DeterministicTurnError`, and the types `ProviderRequestPolicy`, `ProviderRequestPolicyContext`, `ProviderRequestPolicyResult`, `InputBuilder`, `Guardrails`, `RunGuardrailsOptions`, `SessionCachePolicyOptions`, `BeforeProviderTurnPayload`, `DeterministicTurnAnswer`, `DeterministicTurnProvenance`. Added: `ModelRequestTransformResult` and `HookTransformResult`. `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` were updated deliberately to match, and `node scripts/release.mjs gate --update-baseline` rewrote four baselines — `arnilo__prism.txt` (-41/+166, every removal attributed to this task), `arnilo__prism-agent-sdk.txt`, `arnilo__prism-code.txt`, and `arnilo__prism-memory.txt` (+`ProviderRequestTransform`). `node scripts/release.mjs gate` exits 0 with `updated: false`.
    - **Verification.** `bun run typecheck` is 0 across all 15 workspaces. `src/__tests__`: 3575 pass / 5 fail, and all five are the inherited reds this plan already carried (bin spawns ×2, the agent-sdk peer packaging guard, packed-install host-composition, real-provider stdio) — none reference a retired symbol. Packages: `memory` 494/0, `agent-sdk` 88/0, `hooks` 25/0, `prism-channels` 93/0, `ag-ui` 239/0, `mcp` 106/0, `prism-core` 763 pass / 1 fail (the inherited `names the Bun runtime … under node`), `prism-code` 0 fail file-by-file. The `prefix-stability` conformance (24/24) still passes with no hooks registered, which is the plan's byte-stability criterion.
    - **Carried into Task 6.** Freeze `ModelRequestTransformResult` and `HookTransformResult` with the catalog; decide whether turn 1 should see `run.input` rewrites; decide whether `AgentRunInterruptionKind` keeps its now-unreachable `input_guardrail` member.

- [x] Task 4: Context and run control → `context.build`, `turn.before`, and `run.end` (retire `instructionInjectors`, `context`, `toolNarrowing`, `promptBuilder`, `stopHooks`, `turnPolicy`, and the context middleware hooks)
  - Acceptance Criteria:
    - Functional (removed, with no alias):
      - `AgentConfig` / `RunOptions` `instructionInjectors`, `context`, `toolNarrowing`, and `promptBuilder`
      - `AgentConfig` / `RunOptions` `stopHooks` and `turnPolicy`
      - the `InstructionInjector`, `ContextProvider`, `ToolNarrowing*`, `PromptBuilder`, `StopHook*`, and `TurnPolicyOptions` / `TurnBoundaryContext` / `TurnStopDecision` types
      - the `context`, `input_assembly`, and `prompt_build` middleware hook names
      - `ExtensionAPI.register{InstructionInjector,ContextProvider,PromptBuilder,StopHook}`, their contribution registries, and the `activateKernel` fields `instructionInjectors`, `context`, and `stopHooks`
      - the `rpc.ts` `instructionInjectors` param and `cli-runner.ts` injector discovery (Task 1(d))
      - The `AgentConfig.allowHiddenToolCalls` fate follows `toolNarrowing`, as Task 1 decides.
    - Functional (replacements):
      - Injectors, providers, and narrowing are `context.build` transforms over `ContextDraft { system[], messages[], tools[], skills[] }`, which affect the provider view only.
      - Turn policy is `turn.before` `{ stop }`, which yields `stopReason: "hook_stop"`. The `host_policy` stop reason is deleted.
      - Stop hooks are `run.end` `{ continue: { reason, steer? } }`.
      - `RunLimits.maxStopContinuations` is renamed `maxContinuations`, per roadmap §2.4 and plan 144 Task 1(f), with no alias.
    - Functional (callers): migrate in this task:
      - `packages/prism-code`: instruction injectors in `prompt.ts`, `wiki.ts`, and `headless.ts`; the todo stop hook; and the `maxCost` `turnPolicy` → `turn.before` (`limits.ts:260` `createCostTurnPolicy`; rename `maxStopContinuations`→`maxContinuations` at `limits.ts:1,22,47,77,146` and `headless.ts:311-337`)
      - `packages/prism-coding-tools/src/agent/todo.ts` → a `run.end` handler factory
      - `packages/hooks` (Stop → `run.end`, SessionStart context → `context.build`)
      - `packages/agent-sdk` (instructions plane → `context.build`)
      - `packages/memory`: RAG / fabric `ContextProvider` → `context.build` handler factories; the wiki extension
      - `src/node/{instruction-injectors,system-project-prompts}.ts` → `context.build` handler factories
      - `examples/{instruction-injection,context,tool-narrowing-planes,custom-tools-skills-context,external-app-db-backed}.ts`, and every other example Task 1 lists
    - Functional (sweep): grep for `instructionInjectors|InstructionInjector|ContextProvider|toolNarrowing|ToolNarrowing|promptBuilder|PromptBuilder|stopHooks|StopHook|turnPolicy|TurnPolicy|host_policy|maxStopContinuations|input_assembly|prompt_build` with the standard exclusions. The only hits allowed are attributed released `/docs` prose. Drop the pin rows.
    - Performance:
      - `context.build` runs once per turn, which is the same cadence as the injectors it replaces.
      - The draft is a shallow copy per turn only when a handler is registered. With no handlers, the assembled request is unchanged (prefix-stability conformance).
    - Code Quality:
      - The kernel keeps its skills catalog as its own `context.build`-point contribution (§2.4 "Replaces: skills catalog"), registered under the owner `kernel`, so `disable.hooks` can address it in Phase 2.
      - Family modules become handler factories, not new types.
    - Security:
      - `context.build` never mutates the store. The plan 144 invariant stays green.
      - The trust policy on project instruction files (`src/node/instruction-injectors.ts`) is preserved in its handler factory. `project_instructions_still_require_trust` proves it.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (`context.build`, `turn.before`, `run.end` rows)
      - `src/instruction-injection.ts`
      - `src/input.ts:160-380`
      - `src/agent-session/session/assemble.ts:107-267,669-698`
      - `src/extensions.ts:195-363`
      - `src/rpc.ts:45-297`
      - `src/cli-runner.ts:398`
    - Options Considered:
      - Split context and run control into two tasks. Rejected: both edit `assemble.ts`'s turn-boundary block and the same `ExtensionAPI` / `activateKernel` surface. Two tasks would each rewrite and re-baseline the same lines. Task 1's caller table decides whether to split anyway, if the caller count exceeds one reviewable change.
    - Chosen Approach:
      - Delete the fields and call sites, and ship handler factories at the family callers.
    - API Notes and Examples:
      ```ts
      h.on("context.build", (draft) => ({ ...draft, system: [...draft.system, agentsMd] }), { id: "agents-md" });
      h.on("run.end", (view) => (openTodos(view) ? { continue: { reason: "Finish your todo list." } } : undefined), { id: "todo" });
      h.on("turn.before", (t) => (t.usage && cost(t.usage) > cap ? { stop: "budget" } : undefined));
      ```
    - Files to Create/Edit:
      - `src/contracts-core/{agent,loop,extensions,run-limits}.ts`, `src/contracts-protocol.ts`, `src/instruction-injection.ts` (delete), `src/input.ts`, `src/middleware.ts`, `src/extensions.ts`, `src/contributions.ts`, `src/rpc.ts`, `src/cli-runner.ts`, `src/node/{instruction-injectors,system-project-prompts}.ts`, `src/agent-session/session/assemble.ts`, `src/run-limits.ts`, and `src/index.ts`
      - The workspaces and examples above.
      - `src/__tests__/{instruction-injection*,node-instruction-injectors,rpc-instruction-injectors,cli-instruction-injectors,tool-narrowing,stop-hooks,turn-policy-stops,public-export-contract,docs}.test.ts`: delete or rewrite onto hooks.
      - `scripts/e2e-coverage.json`: remove deleted suites.
      - `docs/next/hooks.md`
      - `CHANGELOG.md`
      - `scripts/compat-baseline/*.txt`
    - References:
      - plan 106 (stop hooks)
      - plan 084 (turn policy)
  - Test Cases to Write:
    - `context_build_injects_without_touching_store`
    - `turn_before_stop_replaces_turn_policy`
    - `run_end_todo_continuation_capped_by_max_continuations`
    - `project_instructions_still_require_trust`
    - `hooks_json_stop_maps_to_run_end`: in `packages/hooks`.
    - `prism_code_todo_continuation`: the existing `todo-continuation.test.ts`, rewritten.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes
    - Docs pages to create/edit:
      - `docs/next/hooks.md`
      - `docs/next/loop.md` (`maxContinuations`, `hook_stop`)
      - `CHANGELOG.md`
      - Affected package READMEs (`packages/hooks`, `packages/agent-sdk`, `packages/memory`, `packages/prism-coding-tools`), where their examples use the removed fields.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: `node scripts/release.mjs gate --update-baseline`. Paste the diffs, with attribution.
  - Lab impact: `packages/prism-code` loses its injector and stop-hook wiring, and gains hook registrations. No module becomes fully deletable; roadmap Phase 12 deletes the assembler. Note this in Further Actions only if a module becomes dead.

  - Notes (executed 2026-10-01):
    - **Every Task 4 retirement landed with no alias.** Gone from `AgentConfig` and `RunOptions`: `instructionInjectors`, `context`, `toolNarrowing`, `promptBuilder`, `stopHooks`, `turnPolicy`. Gone as types: `InstructionInjector`/`InstructionContext`/`InstructionContribution`/`InstructionTiming`, `ContextProvider`/`ContextResolutionContext`, `PromptBuilder`/`PromptBuildRequest`, `ToolNarrowing`/`ToolNarrowingContext`, `StopHook`/`StopHookContext`/`StopHookDecision`, `TurnPolicyOptions`/`TurnBoundaryContext`/`TurnStopDecision`. Gone with no replacement: `resolveInstructionInjectors`/`runInstructionInjectors`, `resolveContextProviders`, `createDefaultPromptBuilder`, `DefaultPromptBuilder`, `ResolveContextOptions`, the `contextProviders`/`promptBuilders`/`instructionInjectors`/`stopHooks` contribution registries with their `register*` methods and the matching `activateKernel()` fields, the `"context"` contribution file kind, and the `contextProvider`/`promptBuilder`/`instructionInjector` manifest kinds (so a manifest declaring one now fails closed). `src/instruction-injection.ts` is deleted; `src/node/instruction-injectors.ts` became `src/node/instruction-sources.ts` (the `./node/instruction-injectors` subpath is renamed, with `package.json`, `phase54-package-map.mjs`, `e2e-coverage.json`, `release-and-install.md`, and the e2e fixture all updated).
    - **`RunLimits.maxStopContinuations` → `maxContinuations`, with no alias.** Renamed across `RunLimits`, `ResolvedRunLimits`, `RunLimitName` (still excluded from the counter axes), `resolveRunLimits`, `RunLimitTracker`'s validator, and Prism Code's limits config. The default stays 3 and the narrowing law is unchanged.
    - **`allowHiddenToolCalls` is kept, contrary to Task 1's table.** Task 1 said it dies with `toolNarrowing`, but it guards `ctx.turnAllow`, which `RunTurnOptions.tools` (the public `RunController.turn(options)` contract) still sets — the custom-loop tool-scoping path that survives. Deleting it would have silently denied hidden tools to every host that scopes a turn. `tool-narrowing.test.ts` now pins that behavior through a real custom loop.
    - **Three Part A gaps found and closed, because the retirements made them load-bearing.**
      - `ContextDraft.context` was **write-only**: `applyDraft` set `request.context`, but `contextMessages` had already run inside `buildProviderMessages`, so a handler's blocks reached the provider request's `context` field and never the prompt. `applyDraft` now renders them into `messages` at the stable-prefix boundary, and `draftFromRequest` no longer mirrors the request's context (the assembler always renders its own). This is what makes RAG, memory fabric, and observational memory still work.
      - `ContextDraft.tools` let a handler **introduce** a tool the request never carried. `applyDraft` now clamps the draft's tool list to the request's own names, restoring the restrictive-only law the retired `toolNarrowing` had. Pinned by "context.build tools are restrictive-only" and by the smuggling test in `contribution-security-boundaries.test.ts`.
      - `run.end` could not express anything but a bare reason: `combine("run.end", …)` looked for `typeof value.continue === "string"`, so the todo gate's two-message continue would have been dropped. `RunEndDecision.continue` is now `{ reason, steer? }` per the plan, `combine`'s `first-continue` rule matches that shape (and treats a malformed decision as no continuation), and `RunEndPayload` gained `history`, `turn`, and `continuations` — the transcript view the roadmap specifies, plus `continuations` as the `stopHookActive` replacement.
    - **The `turn.before` stop reason is now redacted and byte-capped, like the retired policy's was.** `RunController.turn` passes `before.stop` to `setFinishReason(reason, detail)`; `assemble.ts` redacts and UTF-8-truncates it to `TURN_STOP_DETAIL_MAX_BYTES` before it becomes `stopDetail`. `AgentFinishReason` loses `host_policy`; `AgentRunState.stopReason` is now `"hook_stop" | "hook_limit"`, so a hook stop stays a continuable durable checkpoint exactly as `host_policy` was.
    - **The kernel's skills catalog stays in assembly rather than becoming a named registration.** `createDefaultPromptBuilder` became module-private `buildProviderMessages` in `src/input.ts`, documented as the kernel's own `context.build`-point contribution. Registering it as a separate kernel handler was **not** done: `HookOptions` carries no owner (`HookError.owner` is fixed at `createHookBus` time) and the session's bus is the host's, so "registered under the owner `kernel`" is not reachable from the current seam, and Phase 2's `disable.hooks` addressing is the thing that needs it. Splitting the function out would have added a registration and an ordering question for no behavior change.
    - **One shared factory instead of eight copies.** `src/context-build.ts` adds `ContextSource` (`{ name, instructions?, contextBlocks? }`), `registerContextSources(hooks, sources)` for static text, and `withContextBlocks(draft, blocks)` for the dynamic case (RAG, memory, observational memory, Prism Code's environment block) — the three-line tail every dynamic provider needs. It registers nothing for an empty or contentless list, so a host with no sources keeps byte-identical request bytes.
    - **Caller migrations.** `packages/memory`: `Memory.contextBlocks`/`registerContextBuild` (from `createContextProvider`), `registerMemoryFabricContext` (from `createMemoryFabricContextProvider`), `registerRagContext` (from `createRagContextProvider`), `RagContextBuild` (from `RagContextProvider`), the fabric and OM attach seams now carry a `contextBuild` handler instead of a provider, and the wiki extension contributes a `context.build` handler. `packages/prism-code`: `createEnvironmentContextSource`, `registerCostStop` (was `createCostTurnPolicy`, now a `turn.before` gate producing `hook_stop`/`max_cost`), `registerTodoContinuation` (was `createTodoContinuationStopHook`, now registering a `run.end` handler and returning the handler the TUI notifies). `packages/agent-sdk`: `AgentSdkConfig.contextSources` and `AgentSdkConfig.registerHooks` replace `context`/`instructionInjectors`/`stopHooks`; `registerHooks` is one field, not three, because the per-agent bus is the only seam that survives. `packages/hooks`: `Stop` is a `run.end` handler and the additionalContext queue is drained by a `context.build` handler. `src/cli-runner`: `--instruction`/`--injector-file`/`--discover` resolve to `ContextSource[]` and register via `registerContextSources`; `--instruction <unknown>` still fails closed. `src/rpc.ts`: the per-run `instructionInjectors` param and its registry option are **deleted** rather than migrated — with a per-agent bus there is no run-scoped context seam, and adding a `RunOptions` field for it would contradict the design.
    - **Two CLI-level behavior notes.** A `CliRuntime.createSession` override owns the whole agent, so it now owns the `--instruction` sources too (the CLI test's factory registers them the same way `defaultCreateSession` does). `hook_stop` is also Prism Code's clean max-cost stop, replacing `host_policy`; the hard `maxCost` limit breach path is unchanged.
    - **Context blocks escape the context budget now.** With `context.build` running post-assembly, a handler's blocks are not measured or trimmed by `contextBudget`/`attentionCompiler`. This is a real narrowing of behavior, not a bug: the assembler no longer has a context input at all, so those stages trim only what they can see. It resolves when `@arnilo/prism-context-engineering` (roadmap Phase 8) moves the budget to `context.build`. The affected assertions were removed from `context-budget.test.ts` and `invalidation-inventory.test.ts` rather than re-pointed.
    - **Tests.** Added `src/__tests__/context-build.test.ts` (8 tests: `context_build_injects_without_touching_store`, stable-prefix placement, block append, source ordering, no-op sources, byte-identical request with no sources, and the restrictive-only tool law) and `turn_before_stop_replaces_turn_policy` + a truncation test in `turn-before-stops.test.ts`. `stop-hooks.test.ts` → `run-end-continuations.test.ts` (`run_end_todo_continuation_capped_by_max_continuations` and the rest, rewritten onto `run.end`). `turn-policy-stops.test.ts` → `turn-before-stops.test.ts`. `node-instruction-injectors.test.ts` → `node-instruction-sources.test.ts` (`project_instructions_still_require_trust`). Deleted: `instruction-injection.test.ts`, `instruction-injection-assembler.test.ts`, `instruction-injection.types.test.ts`, `rpc-instruction-injectors.test.ts`. `cli-instruction-injectors.test.ts` → `cli-instruction-sources.test.ts` (6/6, end-to-end through the flags).
    - **Public surface.** Removed from the root barrel: `createDefaultPromptBuilder`, `resolveContextProviders`, `resolveInstructionInjectors`, `runInstructionInjectors`, and the types `DefaultPromptBuilder`, `ResolveContextOptions`, `ResolveInstructionInjectorsOptions`. Added: `registerContextSources`, `withContextBlocks`, and the type `ContextSource`. `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` were updated deliberately. `contextMessages` is now exported from `src/input.ts` (module-level, not on the root barrel) because `RunController.applyDraft` renders handler blocks with it. `node scripts/release.mjs gate --update-baseline` rewrote five baselines and the gate then exits 0 with `updated: false`; the only removals are the retired names above plus the pre-Part-A loop/middleware internals the baseline had never picked up (`singleShotLoop`, `generateValidateReviseLoop`, `mergeGuardrails`, `policyList`, `resolveLoop`, `resolveDeterministicTurn`, …).
    - **Verification.** `bun run typecheck` is 0 across all 15 workspaces. `src/__tests__`: 3544 pass / 5 fail, and all five are the inherited reds this plan already carried (bin spawns ×2, the agent-sdk peer packaging guard, packed-install host-composition, real-provider stdio). Packages: `memory` 494/0, `hooks` 25/0, `agent-sdk` 88/0, `prism-channels` 93/0, `ag-ui` 239/0, `mcp` 106/0, `prism-core` 763/1 (the inherited `names the Bun runtime … under node`). `packages/prism-code` is 0 fail file-by-file. All 14 migrated examples run to completion. `plan-review-gate.test.mjs` is 15/0.
    - **Left deliberately.** `MemoryContextProviderOptions` keeps its name (it configures `registerContextBuild`); renaming it would ripple through the memory package for no behavior gain. `scripts/plan-review-gate.test.mjs` still cites `input_assembly`/`createDefaultPromptBuilder` because it checks that plan Notes quote phrases present in the immutable `docs/_evidence/*-primitive-review.md` archives, which record what those plans cited. `docs/instruction-injection.md` and `docs/middleware-hooks.md` keep their retired-name prose as released 0.12 documentation; only their test pins were dropped.
    - **Carried into Task 6.** Freeze `RunEndDecision.continue` as `{ reason, steer? }` and `RunEndPayload`'s `history`/`turn`/`continuations`; decide whether `AgentRunState.stopReason` keeps the now-unreachable vocabulary; decide whether the Phase 2 `disable.hooks` owner seam needs the kernel's skills catalog as a named `context.build` registration.

- [x] Task 5: Compaction → the `compaction` slot and `compaction.when`; session lifecycle → observe; delete `middleware`
  - Acceptance Criteria:
    - Functional (removed, with no alias):
      - `CompactionOptions.strategy` and `CompactionOptions.trigger`, and the `CompactionStrategy` and `CompactionTrigger*` types
      - `ExtensionAPI.registerCompactionStrategy` and its registry
      - the last middleware hook names: `compaction_request`, `compaction`, `session_start`, and `session_shutdown`
      - then the whole `AgentConfig.middleware` field, `MiddlewareRegistry`, `Middleware*` types, `createMiddlewareRegistry`, `src/middleware.ts`, `activateKernel().middleware`, and `ExtensionKernel.middleware`
      - `AgentConfig.compaction` keeps only the non-strategy knobs (for example `false` to disable, keep-recent sizing), as Task 1 confirms.
    - Functional (replacements):
      - `session.compact()` and auto-compaction call the `compaction` slot (`Compactor`). The kernel default drops the oldest whole turns, keeps tool-call/result pairs together, and writes a marker entry (§2.5).
      - `compaction.when` is the only auto trigger. With no handler, the kernel default trigger keeps the 0.12 default threshold, registered under the owner `kernel`.
      - Session start and shutdown observers use the observe hooks for the session events.
    - Functional (callers): migrate in this task:
      - `packages/memory/src/compaction/{llm,observational-memory}` strategies → `Compactor` factories
      - `packages/prism-code/src/{compaction,observational-memory}.ts` → `slots.compaction`
      - `packages/ag-ui` and `packages/prism-core` middleware users → hooks
      - `examples/{compaction,coding-compaction}.ts`, and every other example Task 1 lists
      - `src/testing/compaction-conformance.ts` retargets to `Compactor` (Task 1(e)), and the family strategies pass it.
    - Functional (sweep): grep for `middleware|MiddlewareRegistry|createMiddlewareRegistry|CompactionStrategy|CompactionTrigger|compaction_request|session_start|session_shutdown|registerCompactionStrategy` with the standard exclusions. The only hits allowed are attributed released `/docs` prose, and the `session_started` / `session_closed` event type names. Drop the pin rows, including `docs/middleware-hooks.md` ↔ `createMiddlewareRegistry` at `src/__tests__/docs.test.ts:2035`.
    - Performance:
      - `compaction.when` runs at the same check point and cadence as the 0.12 trigger.
      - The default compactor makes no model call. LLM and observational compaction stay opt-in, and their READMEs keep their model-call cost notes.
    - Code Quality: `src/compaction.ts` holds only the default `Compactor`. The slot contract lives in `src/slots/`.
    - Security:
      - The default compactor redacts secrets in any marker text, as it does today.
      - `compaction.when` throw fails closed as a decide throw. Test: `compaction_when_throw_fails_closed`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1 "Compaction" and §2.5 slots table
      - `src/compaction.ts:12-50`
      - `src/contracts-core/compaction.ts:6-90`
      - `src/agent-session/session.ts:495-507,874-880`
      - `src/testing/compaction-conformance.ts`
    - Options Considered:
      - Keep `CompactionOptions.strategy` beside the slot. Rejected: two ways to set one slot is an alias.
    - Chosen Approach:
      - Route compaction through the Part A slot, delete the last middleware names, then delete the registry itself.
    - API Notes and Examples:
      ```ts
      createAgent({ model, slots: { compaction: createLlmCompactor({ model: side }) } });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/{agent,compaction,extensions}.ts`, `src/compaction.ts`, `src/middleware.ts` (delete), `src/extensions.ts`, `src/contributions.ts`, `src/agent-session/session.ts`, `src/slots/defaults.ts`, `src/testing/compaction-conformance.ts`, and `src/index.ts`
      - The workspaces and examples above.
      - `src/__tests__/{compaction*,mid-run-compaction,middleware,public-export-contract,docs}.test.ts`
      - `scripts/e2e-coverage.json`
      - `docs/next/{slots,hooks}.md`
      - `CHANGELOG.md`
      - `scripts/compat-baseline/*.txt`
    - References:
      - plan 144 Task 4 (compaction slot contract)
  - Test Cases to Write:
    - `compaction_slot_default_drops_oldest_whole_turns_and_marks`
    - `compaction_slot_direct_implementation_used_by_session_compact`
    - `compaction_when_triggers_auto_compaction`
    - `compaction_when_throw_fails_closed`
    - `family_compactors_pass_compaction_conformance`
    - `middleware_field_is_gone`: a type test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes
    - Docs pages to create/edit:
      - `docs/next/slots.md` (compaction default and `Compactor`)
      - `docs/next/hooks.md`
      - `CHANGELOG.md`
      - `packages/memory/README.md`: the compaction examples use `slots.compaction`, and the model-call cost note stays.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Public-surface chore: `node scripts/release.mjs gate --update-baseline`. Paste the diffs, with attribution.

  - Notes (executed 2026-10-01):
    - **`src/middleware.ts` is deleted, and with it the whole registry.** Gone: `MiddlewareRegistry`, `MiddlewareRegistryOptions`, `Middleware`, `MiddlewareNext`, `MiddlewareHookName`, `createMiddlewareRegistry`, `AgentConfig.middleware`, `AssembleProviderInputOptions.middleware`, `ExtensionKernel.middleware`, `ActivatedKernelConfig.middleware`, `ExtensionKernelOptions.middleware`, `ExtensionAPI.use`, `ExtensionAPI.middleware`, and the root-barrel exports. The last two producers went with them: `provider-round.ts` was still dispatching the already-dead `"retry"` middleware, and `assemble.ts`/`cli-runner.ts` were threading the registry into the assembler and the CLI agent.
    - **The four remaining middleware names had no replacement, and mostly had no users.** `compaction_request` (rewrite the compaction context), `compaction` (rewrite the result), and `session_shutdown` had **zero** registrants anywhere in the tree, so they were pure deletion. `session_start` had exactly one: the hooks.json `SessionStart` adapter. That one moved to `context.build` — the first `context.build` of a session runs the `SessionStart` handlers with `{ source: "startup" }` and queues their additionalContext, keyed by a per-extension `startedSessions` set so a second session on the same agent still opens. There is no `session_started`/`session_closed` observe hook: `OBSERVE_HOOKS` is keyed on `AgentEventPayload["type"]` and neither event exists there (the two `session_started`/`session_closed` spellings in the tree are `RealtimeEvent` variants and a SQLite index name, not agent events). `session.openSession()` and its idempotence flag went with the dispatch.
    - **Compaction has exactly two seams now.** `CompactionStrategy` is replaced by the Part A `Compactor` slot contract; `createDefaultCompactionStrategy`/`DefaultCompactionStrategyOptions` became `createDefaultCompactor`/`DefaultCompactorOptions`; `session.compactBranch` resolves `this.slotRegistry.resolve("compaction", config.slots?.compaction)` instead of reading `CompactionOptions.strategy`; `src/slots/defaults.ts` and the `compaction` slot doc point at the new name. `assertCompactionStrategyConforms` became `assertCompactorConforms`, and the family strategies pass it with only the parameter type changed, as Task 1(e) predicted.
    - **`CompactionOptions` keeps `thresholdEntries`, `keepRecentEntries`, `maxSummaryChars`, `secrets`, `metadata`, `signal`; `strategy` and `trigger` are gone.** The auto trigger is the `compaction.when` hook: a registered handler owns the decision, and with no handler `resolveAutoCompact` falls back to the kernel's `thresholdEntries` gate. The plan's "registered under the owner `kernel`" is not reachable from the current seam for the same reason Task 4's skills catalog was not — `HookOptions` carries no owner and the session's bus is the host's — so the default trigger is the code path, not a registration.
    - **`CompactionTrigger` and `resolveShouldCompact` stayed.** They are not an auto-compaction seam: they are the policy evaluator a `compaction.when` handler composes with, and two non-session callers (`packages/memory`'s OM attach loop and Prism Code's `compaction` config) use them for their own cadence. Removing them would have meant re-deriving four trigger kinds in three places. What was removed is the *alias* — `CompactionOptions.trigger` — which is the thing that made two ways to set one trigger.
    - **The `compaction.when` payload gained two fields so the four trigger kinds can express themselves.** `entryCount` (for `threshold_entries`) and `turn` (for `each_turn`) were both missing, and both are additive. Without `turn`, Prism Code's `each_turn` — the default in every mid-run compaction test — silently decided `false`; without `entryCount`, `threshold_entries` was unreachable. This is the third instance in this plan of a replacement hook payload being narrower than the mechanism it replaced (see the claim-grounding `toolResults()` accessor and `RunEndPayload.history`).
    - **One behavioral fix found while migrating:** `session.compact(options)` read its options straight off the call, so `AgentConfig.compaction.secrets` never reached `redactSecrets` on the manual path — an agent-level `compaction.secrets` was silently ignored by `/compact`. It now merges the agent config exactly like the auto path does.
    - **Extension kernel.** `ExtensionAPI.registerCompactionStrategy`, the `compactionStrategies` contribution registry, and the `compactionStrategy` manifest kind are gone — and the registry was already write-only, so no caller lost a routed strategy. `createLlmCompactionExtension` and `createObservationalMemoryExtension` keep their tool/command/recall contributions and lost the `options` that only fed the compactor; a `Compactor` is now a host slot assignment. `ExtensionLifecycleEventName` lost `session_start`, `session_shutdown`, and `compaction` (dead once their dispatch went; the union is `X | string`, so this narrows a hint, not the wire). `obsolete` `instructionInjector`/`contextProvider`/`promptBuilder` manifest kinds were dropped in Task 4.
    - **Caller migrations.** `packages/memory`: `createLlmCompactionStrategy`/`createCodingCompactionStrategy`/`createObservationalMemoryCompactionStrategy` → `createLlmCompactor`/`createCodingCompactor`/`createObservationalMemoryCompactor` with matching option types; the OM attach wrapper no longer force-installs a compactor per call and still exposes `attach.compactor` for the host to assign to the slot. `packages/prism-code`: `resolvePrismCodeCompaction` now returns `PrismCodeCompactionResolution { options, compactor, trigger, registerTrigger }`; `acp.ts` and `headless.ts` split that across `compaction`/`slots.compaction`/`hooks`, `AgentSdkConfig` gained `compactor?: Compactor` alongside `loop`, and `compactSession` (the `/compact` path) narrowed to `{ session, signal }` and now runs whatever compactor the agent's slot holds. `packages/agent-sdk`: `AgentSdkConfig.middleware` and `AssembledHooksPlane.middleware` are gone. `packages/hooks`: the `SessionStart` adapter moved onto `context.build`.
    - **Tests.** `middleware.test.ts` and `compaction-request-hook.test.ts` are deleted (18 + 17 type errors, and nothing left to test). Added `compaction_slot_default_drops_oldest_whole_turns_and_marks` (the tool call stays with its result even when keep-recent would split them), `compaction_slot_direct_implementation_used_by_session_compact`, and `middleware_field_is_gone` (a `@ts-expect-error` type test over the four retired surfaces). `compaction_when_triggers_without_config` was renamed to `compaction_when_triggers_auto_compaction`; `compaction_when_throw_fails_closed` already existed and passed unchanged. `family_compactors_pass_compaction_conformance` runs `assertCompactorConforms` against the OM compactor (the coding compactor's conformance test was already there and was only renamed). `agent-event-bridge.test.ts`'s session-lifecycle describe became `close() is idempotent and tears down acrossRuns subscribers`, keeping the half that still applies.
    - **Docs.** `docs/middleware-hooks.md` is released 0.12 prose and is kept verbatim; its pins are replaced by one test asserting the registry stays *out* of `src/index.ts`. `docs/next/slots.md` and `docs/next/hooks.md` updated. `packages/memory/README.md` gained a `## Compaction` section showing `slots: { compaction: createLlmCompactor(...) }` and keeping the model-call cost note (LLM and coding compactors make a model call; the OM compactor and the kernel default make none). `packages/hooks` README/index/package description and `scripts/package-truth.mjs` were rewritten to the five hook seams.
    - **Public surface.** Removed from the root barrel: `Middleware`, `MiddlewareHookName`, `MiddlewareNext`, `MiddlewareRegistry`, `MiddlewareRegistryOptions`, `createMiddlewareRegistry`, `CompactionStrategy`, `createDefaultCompactionStrategy`, `DefaultCompactionStrategyOptions`, `assertCompactionStrategyConforms`. Added: `Compactor`, `createDefaultCompactor`, `DefaultCompactorOptions`, `assertCompactorConforms`. `CompactionStrategy` also leaves `REQUIRED_SDK_CONTRACT_TYPES` (it is a slot contract declared in `src/slots/types.ts`, not a contracts-core type) and joins `FROZEN_TYPE_EXPORTS`. The compat baseline was regenerated and the gate exits 0 with `updated: false`; the only root removals are the names above plus the pre-Part-A loop/middleware internals the baseline had never picked up.
    - **Verification.** `bun run typecheck` and `bun run build` are clean across all 15 workspaces. `src/__tests__`: 3528 pass / 6 fail, all six inherited (bin spawns ×2, the agent-sdk peer packaging guard, packed-install host-composition, install smoke, real-provider stdio) — confirmed by stashing and re-running. Packages: `memory` 494/0, `ag-ui` 239/0, `mcp` 106/0, `prism-channels` 93/0, `agent-sdk` 88/0, `hooks` 25/0, `prism-core` 763/1 (inherited), `prism-code` 0 fail file-by-file. The six compaction/middleware examples run, as do the eight touched earlier in this plan. `docs.test.ts` is 163/0 and `scripts/e2e-coverage.json` has no dangling test-file references.
    - **Left deliberately.** `deterministic_turn`'s persisted `metadata.deterministic.middleware` field and the three prism-core readers of it stay — frozen event vocabulary, already decided in Task 3. `PrismCodeCompactionKind`'s config key is still spelled `compaction.strategy` in `prism-code.json`, because that is a released config-file surface, not the retired type. `docs/compaction-and-retry.md` keeps its `createDefaultCompactionStrategy()` prose and the pin rows for it were dropped rather than renamed.
    - **Carried into Task 6.** Freeze `CompactionWhenPayload.entryCount`/`turn` and `Compactor`; decide whether `session.compact()`'s new agent-config merge should be part of the documented merge law or left implicit; `OpenSession`-style session-lifecycle hooks are absent and Phase 2 may want them.

- [x] Task 6: Freeze the hook catalog and slot contracts for Phase 2
  - Acceptance Criteria:
    - Functional: `src/__tests__/hook-catalog-freeze.test.ts` pins:
      - the exact `HOOK_CATALOG` `{ name, kind }` list
      - the four slot names
      - each decide hook's combination-rule id
      - A change fails with a message pointing to `docs/next/hooks.md`.
    - Functional: A final repo-wide sweep for all eleven retired field names and their types, over `src/ packages/ apps/ scripts/ examples/ docs/`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, and released `/docs` pages. It finds zero hits. The command and its empty output are pasted in the note.
    - Functional: `docs/next/{hooks,slots,loop,tools}.md` describe the final Phase 1 contract, with no "transitional" wording. The plan 144 catalog-coverage test and every invariant test pass.
    - Functional: `plans/README.md` marks plans 144 and 145 `complete (<date>)`. Plan-end handoff runs for both plans (SKILL.md, "Plan end").
    - Performance: No change.
    - Code Quality: The freeze test is data, not a snapshot file, so a deliberate change is a one-line diff in review.
    - Security: The freeze includes the `tool.call` combination rule, so a later change to deny precedence cannot land silently.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 "Done"
      - `src/__tests__/public-export-contract.test.ts:968` (the freeze-test pattern)
    - Options Considered:
      - Rely on the compat baseline to freeze the catalog. Rejected: the baseline records types, not the runtime catalog or combination rules.
    - Chosen Approach:
      - A data-pinned freeze test beside the catalog coverage test.
    - API Notes and Examples:
      ```ts
      assert.deepEqual(HOOK_CATALOG.map(({ name, kind }) => `${name}:${kind}`), FROZEN_PHASE_1_CATALOG);
      ```
    - Files to Create/Edit:
      - `src/__tests__/hook-catalog-freeze.test.ts`: new.
      - `scripts/e2e-coverage.json`
      - `docs/next/{hooks,slots,loop,tools}.md`
      - `CHANGELOG.md`
      - `plans/README.md`
      - `plans/backlog.md`: plan-end handoff only.
    - References:
      - plan 144 Task 6
  - Test Cases to Write:
    - `hook_catalog_is_frozen_for_phase_2`: fails on any add, remove, rename, kind change, or combination-rule change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. This is a freeze.
    - Docs pages to create/edit:
      - `docs/next/*.md`: final wording.
      - `CHANGELOG.md`: one line noting the Phase 1 contract is complete.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-01):
    - **`src/__tests__/hook-catalog-freeze.test.ts` is three data-pinned tests, not a snapshot file.** `hook_catalog_is_frozen_for_phase_2` pins the twelve named hooks as `name:kind` and the 39 observe hooks by name, and additionally pins the *insertion order* of `HOOK_CATALOG` — a `Set` comparison would hide a rename presented as a move. `decide_hook_combination_rules_are_frozen` pins all four rules, which is the acceptance criterion's security case: `tool.call`'s `deny > ask > rewrite > respond` precedence cannot change silently. `slot_names_and_defaults_are_frozen` types the frozen list as `readonly (keyof SlotContracts)[]` and resolves every one through `createSlotRegistry(createSlotDefaults())`, so a slot without a kernel default also fails. Every failure message names `docs/next/hooks.md` and `docs/next/slots.md`, so a deliberate Phase 2 change edits the test and the prose in the same review.
    - **A latent slot bug was fixed rather than pinned.** `createSlotRegistry` kept its known-slot set as `new Set<SlotName>([...])` — a hand-maintained duplicate of `SlotContracts` with no type relationship, so adding a fifth slot to `SlotContracts` without editing the registry would compile clean and then throw `UnknownSlotError` at runtime. The set now derives from a `SLOT_NAMES: readonly SlotName[]` literal, which makes that a compile error. The freeze test covers the runtime half; the type now covers the compile half.
    - **The final retired-name sweep finds zero live references.** The command below, run over `src packages apps scripts examples docs` (`apps/` does not exist), excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, the compat baseline, the historical `phase16`/`phase25` freeze fixtures, `budgets.json`, and test files:
      ```
      grep -rnE "\b(middleware|guardrails|stopHooks|turnPolicy|providerRequestPolicies|instructionInjectors|toolNarrowing|inputBuilder|promptBuilder)\b" \
        src packages apps scripts examples docs --include='*.ts' --include='*.mjs' --include='*.json' \
        | grep -v /dist/ | grep -v '^docs/history/' | grep -v '^docs/_evidence/' \
        | grep -v 'scripts/compat-baseline' | grep -v 'scripts/budgets.json' | grep -v 'scripts/phase16' \
        | grep -v 'scripts/phase25' | grep -v 'scripts/plan-review-gate' | grep -v '/__tests__/' | grep -v '\.test\.ts'
      ```
      returns only attributed hits, none of them a retired field: `src/loop/run-controller.ts:95` cites the retired `toolNarrowing` law in a comment; `src/contracts-protocol.ts:252-253,796` and its four prism-core readers (`trajectory.ts`, `timeline.ts`) are the frozen `deterministic_turn` `metadata.deterministic.middleware` payload field, kept in Task 3; the three `packages/ag-ui` hits are A2UI painting "middleware", unrelated vocabulary; `packages/agent-sdk/src/define-agent.ts:56,62` is the `registerHooks` JSDoc naming what it replaces. `guardrails` remains a live word because the guardrail *mechanism* survives as the `tool.call` pack hook and `runGuardrailList` — only the `Guardrails` config container and its four stages were retired, so the plan's sweep term is broader than the retirement.
    - **Docs.** `docs/next/hooks.md` had a factual error the freeze exposed: it named the observe hook `message.delta`, but observe hooks are named for the event type, so the real name is `message_delta` (fixed in the prose and in both JSON examples). Both `docs/next/hooks.md` and `docs/next/slots.md` gained a "Frozen for Phase 2" section naming the freeze test. The four `docs/next/` pages are free of transitional wording; the only forward references are the roadmap §2.4 citation and the accurate "family packages gain their annotations when each moves to its native package" note in `tools.md`. `CHANGELOG.md` gained the freeze entry, and two stale unreleased-section claims were corrected while I was there: `limits.maxStopContinuations` → `maxContinuations` (renamed in Task 4) and the `compaction.when` fallback described as "the configured `trigger`/`thresholdEntries`" → "the kernel's `thresholdEntries` default" (Task 5 removed the trigger alias).
    - **Plan end.** `plans/README.md` marks plans 144 and 145 `complete (2026-10-01)`. `Compromises Made` and `Further Actions` are filled and all 13 entries are handed off to `plans/backlog.md` with priorities. The two P1/P2 items a Phase 2 author should read first are the hook-harness promotion (every Phase 2 test needs it) and the per-registration owner seam (the kernel skills catalog cannot register under owner `kernel` until the bus owner stops being fixed at `createHookBus`).
    - **Whole-plan verification.** `bun run build:core` and `bun run typecheck` are clean. `hook-catalog-coverage` + `hook-invariants` + `hook-catalog-freeze` + `kernel-imports-no-package` are 42/0. `docs.test.ts` is 163/0; `packaging.test.ts` + `public-export-contract.test.ts` are 316/1 (the inherited agent-sdk peer-dependency guard). `src/__tests__` is 3531 pass / 6 fail, the same six inherited environmental reds (two bin stdio spawns, the peer packaging guard, packed-install host-composition, install smoke, real-provider stdio). `memory` 494/0, `ag-ui` 239/0, `mcp` 106/0, `prism-channels` 93/0, `agent-sdk` 88/0, `hooks` 25/0, `prism-core` 763/1 (inherited sqlite-runtime red), `prism-code` 0 fail file-by-file. `node scripts/release.mjs gate` exits 0 with `updated: false` — Task 6 added no public surface. `scripts/plan-review-gate.test.mjs` is 15/0.
    - **Carried forward.** Everything in `Further Actions` above; the highest-value one for Phase 2 is that the hook bus has no per-registration owner seam, which blocks the kernel skills catalog registration that roadmap §2.4 assigns to Phase 2.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run test` (every workspace, because each family package compiles against the kernel)
- `bun test --timeout=0 dist/__tests__/hook-catalog-coverage.test.js dist/__tests__/hook-invariants.test.js dist/__tests__/hook-catalog-freeze.test.js dist/__tests__/kernel-imports-no-package.test.js`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `node scripts/release.mjs gate`
- `grep -rnE "\b(middleware|guardrails|stopHooks|turnPolicy|providerRequestPolicies|instructionInjectors|toolNarrowing|inputBuilder|promptBuilder)\b" src packages apps scripts examples --include='*.ts' --include='*.mjs' | grep -v /dist/` returns only attributed hits.

## Compromises Made

- **A `tool.call` deny can no longer fail a run the way a guardrail `interrupt` could.** The hook bus catches a throwing `tool.call` handler and converts it to a deny, so a guardrail pack tripwire — which used to throw `GuardrailError` and reject the whole run — is now a denied tool call in a run that *succeeds*. This is not a compromise so much as the platform's actual shape (a deny is scoped to a call; a run-level rejection is `ctx.reject` on a transform), and it is recorded here because the semantics are visible: a caller that asserted on `status === "failed"` must now assert on the `hook_denied` error code on the tool result.
- **`deny` now beats `ask` at `tool.call`, which reverses the 0.12 ordering.** In 0.12 the ask gate fired at charge time and a sibling deny was evaluated at dispatch, so an ask-then-deny scenario suspended. It now denies outright. Deny-wins is the property that makes a `tool.call` gate a security boundary rather than a prompt, so the trade was made deliberately (roadmap §2.4) and the affected tests were rewritten to deny-wins semantics.
- **`PermissionPolicy` survived the retirement of `AgentConfig.permission`.** The field and its dispatch use are gone, but the interface stays: it is a retained kernel type with non-dispatch users (resource loading, the extension kernel, content and input assembly) and it is the gate type for direct `dispatchToolCall` callers, which have no hook bus and so take their check at the `beforeExecute` seam. Retiring the field did not retire the concept.
- **`CompactionTrigger` and `resolveShouldCompact` were kept rather than folded into the hook.** The plan's Phase 1 table reads as if the `compaction.when` hook replaces the trigger evaluation. In practice the four trigger kinds are a reusable policy evaluator with two non-session callers (the observational-memory attach loop, Prism Code's own config), and folding them in would have meant re-deriving them in three places. What was removed is the alias `CompactionOptions.trigger`, which is what made two ways to set one trigger. The auto-compaction path uses the hook; a handler composes with the evaluator.
- **`HOOK_COMBINATION` is not a root export.** The freeze test reads it from `src/hooks/index.ts`, which is internal. Hosts cannot introspect the combination rules, only observe them. Exposing it was not worth a public-surface addition and a compat-baseline update; the freeze is a test guarantee, and the rules are documented in `docs/next/hooks.md`.
- **Released prose for the retired mechanisms was left in place.** `docs/middleware-hooks.md`, `docs/compaction-and-retry.md`, and `docs/instruction-injection.md` still describe the 0.12 API, and the historical CHANGELOG sections still name `stopHooks` and `maxStopContinuations`. Their test pins were dropped rather than rewritten, because the pages are shipped 0.12 documentation and editing them would falsify the record of what 0.12 shipped.

Recorded in plans/backlog.md.

## Further Actions

- **Promote the hook harness into `@arnilo/prism/testing`.** `src/__tests__/helpers/hook-harness.ts` is now the standard way to drive a loop and assert which hooks fired, and every Phase 2 test will want it. Until it ships as a package subpath, a native package cannot test against the hook contract without a bespoke harness.
- **Decide the fate of the five `artifact_*` `AgentEventPayload` variants.** They are the residue of the retired `generate-validate-revise` loop strategy. They are still frozen public events that only a Phase 9 `workflows` package is likely to emit, and they sit in the frozen catalog as observe hooks (`artifact_validation_started` and friends). Retire them or keep them as a package-emittable contract — the current state is neither.
- **Make the context budget a `context.build` handler.** Task 4 moved context injection to `context.build`, which runs *after* assembly, so blocks a handler adds escape `applyContextBudget` entirely. The budget can only re-budget once it is itself a handler that sees the handler-added blocks. This is the Phase 8 (`@arnilo/prism-context-engineering`) work this deferral points at.
- **Give the run-start `run.input` transform a turn-1 provider path.** `run.input` rewrites the messages appended to session history, but turn 1's provider request is assembled from the raw `nextInput`, so a `run.input` rewrite first reaches the provider on turn 2. A reject is unaffected (it fails before any provider call), so the security-relevant case is correct, but the rewriting case is surprising. Worth either documenting the boundary in `docs/next/hooks.md` or making assembly read the rewritten messages.
- **Add session-lifecycle hooks if Phase 2 needs them.** The `session_start` middleware had no observe-hook replacement — `OBSERVE_HOOKS` is keyed on `AgentEventPayload["type"]` and there is no `session_started` event — so the one real user (the hooks.json `SessionStart` adapter) now piggybacks on the first `context.build` of a session. That works, but a Phase 2 that wants to open a session per se has no seam.
- **Decide whether `AgentRunState.stopReason` keeps its now-unreachable members.** `hook_stop`/`hook_limit` are the only values the kernel writes; the union is persisted vocabulary, so it was left intact, but each retired value is a branch a future reader will look for.
- **Decide the kernel skills catalog's owner.** The skills catalog is contributed by `createDefaultPromptBuilder` during assembly and is explicitly Phase 2 `disable.hooks` work. Registering it under owner `kernel` is not reachable today because the bus owner is fixed at `createHookBus`; Phase 2 needs an owner seam before it can.

Recorded in plans/backlog.md.
