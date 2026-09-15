# 074 — Attention Compiler (cache-stable turn gate)

Roadmap phase: **0.7.0**, **plan 4 of 7** in the extended line (**072, 073, 074, 075, 077, 078, 079**). Does **not** wait on [072](072-Host-Eval-And-Observability-Cockpit.md). May run **in parallel** with [073](073-Release-0-7-0-Host-Completeness.md) and [077](077-Work-Scope-Memory-Index.md). [073 Tasks 27–29](073-Release-0-7-0-Host-Completeness.md) (the 0.7.0 cut) are **deferred until this plan and the rest of the line are closed** and must include this plan’s evidence. Do **not** publish after any single plan alone.

Baseline: `@arnilo/prism` **0.6.0** assembly (`assembleProviderInput`, `applyContextBudget`, `toolResultFold`) and compaction (`CompactionOptions.thresholdEntries`, `session.compact` task-boundary contract). [076](076-Observational-Memory-Mastra-Parity.md) is superseded; do not wait on it. Do **not** edit plan 072 while it is in progress.

Constraint: Prism stays a **harness**. Compiler is **opt-in**. Omit `AgentConfig.attentionCompiler` / `AgentDefinition.attentionCompiler` → today’s assembly path, **byte-for-byte**. No hosted context studio, no default-on compaction, no new npm package, no 12-layer manifesto, no nested-run packets, no handles.

This rewrite **replaces** the previous 0.8.0 staged-eviction mixer. The compiler is a **gate**, not a mixer: it **runs every provider turn** and **mutates only when over a host ratio of the model input cap**. Mutations are **monotonic** so prompt cache prefixes survive.

## Product Boundary

- **In:** opt-in per-turn measure; no-op below `triggerRatio`; sticky in-place thinking strip; sticky deterministic tool-result stubs; frozen prefix (system / `AGENTS.md` / skill catalog / tool list); host-programmable compaction **trigger** (when `session.compact` / OM auto-compact fires); after compact, pack frozen prefix + compaction summary (OM render when that strategy is selected) + recent tail; redacted `attention_compiled` only when a turn actually mutated.
- **Out:** 12 named `AttentionLayerId`s, `evict: handle`, nested `ContextPacket`s, LLM summarizer inside the compiler, mid-run `session.compact` (existing throw stands), rewriting OM observations/reflections mid-run, replacing observational memory, replacing `applyContextBudget` for compiler-off agents, Memory Fabric (075).

## Picture (two machines)

| Machine | When | Writes store? | Touches OM ledger? | Cache |
| --- | --- | --- | --- | --- |
| **Compiler** | Every **provider turn** inside a run | No | **No** | No-op = append-only hit. Mutate = sticky frontier only |
| **Compaction** (OM strategy or default) | Task boundary: `session.compact` / auto before **next** `run()`, never while a run is in flight | Yes — one `kind: "compaction"` entry | Strategy **reads** ledger and renders summary; does not delete sources | One miss, then new prefix (frozen + summary) is stable |

Context engineering = **this turn’s tokens**. Memory = **what survives the window**. This plan owns the packer **and** the **when-to-compact** host seam. Plan 077 owns the OM working-set **index**. Plan 075 (same extended 0.7.0 line) owns cross-session fabric.

Existing levers stay. Compiler **does not orchestrate** them into a new prompt builder:

| Lever | Today | Compiler on |
| --- | --- | --- |
| `assembleProviderInput` | One compose path | Same path; optional pre-pass on **history clone** |
| `toolResultFold` | Host must supply `summarize` | Default **deterministic stub** used only for compiler-eligible rows; host `summarize` still wins if set |
| `applyContextBudget` | Drop whole items | **Not** a compiler stage. Compiler-off unchanged. Compiler-on still-over → `AttentionBudgetError` (host should compact), not silent history delete |
| `session.compact` / `thresholdEntries` | Entry-count gate, once per `run()` before assemble; throws if run active | Same timing. New `CompactionOptions.trigger` is the host program surface. `thresholdEntries` kept |
| OM `context.compactAfterTokens` | Post-run flush, then compact if session-entry tokens ≥ cap | Still default for `attach()`. Host `shouldCompact` / `trigger` overrides when set |
| OM context provider | Re-resolves every assemble | Compiler **does not drop, stub, or rewrite** those blocks. Volatile OM in the prefix still busts cache — documented, not magically pinned |
| 077 `projectWorkMemory` | Filters OM working set | Orthogonal. Compiler packs whatever providers already emitted |

## Locked forks (cache)

Prompt cache is **byte-identical prefix**. Change message *i* → miss from *i* onward.

| Fork | Choice | Why |
| --- | --- | --- |
| Run vs mutate | **Measure every turn. Mutate only if `used / inputCap ≥ triggerRatio`.** | “Every turn” must not mean “rewrite every turn” |
| Under ratio | **Byte-identical** to compiler-off assembly | Golden cache / golden test |
| Mutation shape | **In-place** strip/stub. **Do not delete** history rows mid-run | Deleting a `tool` row without its `tool_call` breaks providers; dropping early history reshuffles the whole suffix |
| Stickiness | **Monotonic.** Once thinking stripped or result stubbed, stay that way even if later under ratio | Unstub / restore thinking = prefix churn |
| Stub text | **Deterministic:** `name`, `toolCallId`, hash of **already-redacted** text, byte length. No model | LLM summaries change every call → miss forever |
| Evict order (when over) | (1) thinking blocks older than `thinkingKeepTurns` (2) oldest eligible tool results beyond `keepLast` | Thinking is pure attention waste; old grep dumps next. Never constitution |
| Frozen prefix | **Never** strip/stub/drop: system instructions, `SYSTEM.md` / `AGENTS.md` layers, skill **catalog**, `request.tools` | These are the expensive cached prefix |
| Skill **bodies** | Progressive load may extend prefix once | Loading a skill is one bust, then sticky. Do not unload |
| Tools disclosure | Do not shrink the disclosed set mid-run | Shrink = prefix rewrite |
| OM mid-run | Compiler **does not** evict, fold, or rewrite observations/reflections | Compact at boundary is the OM rewrite |
| Still over after stubs | **`AttentionBudgetError`** | Do not walk `applyContextBudget` over constitution. Host compact or raise ratio/cap |
| Compact mid-run | **Forbidden** (existing contract) | `session.compact()` throws while `run()` in flight. Auto-compact remains **once per `run()`**, before first assemble |
| Compact vs compiler ratio | `triggerRatio` (default **0.75**) < `compactRatio` (default **0.90**) when both set | Cheap stubs first; compact (new prefix) only when stubs cannot hold. Fail closed if compact ratio < trigger ratio |
| Input cap | `contextWindow - maxOutputTokens - reserveTokens`, or host `maxInputTokens` | 100% of context window is too late (need output + next tool result). Missing both window and host cap → fail closed at compiler create |

## Objectives

- Give hosts one opt-in **Attention Compiler** that **measures** every provider turn and **rewrites nothing** until a declared fraction of the model **input cap**.
- When over, keep the frozen prefix and shrink **only** thinking then old tool payloads, monotonically, without touching OM.
- Give hosts a **programmable compaction trigger** (`threshold_entries` \| `input_ratio` \| `custom shouldCompact`) so they decide **when** OM/default compact fires. After compact, next assemble is frozen prefix + summary + recent tail.
- Preserve prompt cache: no-op turns identical; mutated turns only advance a sticky frontier.
- Wire opt-in on `AgentConfig` / `AgentDefinition`. `RunOptions.attentionCompiler: false` disables for that run.

## Expected Outcome

- `createAttentionCompiler(options)` validates options; `assembleProviderInput` branches once when enabled. No second `PromptBuilder`.
- Default agent/session bytes unchanged when the field is omitted.
- Hosts set `triggerRatio`, `thinkingKeepTurns`, `keepLast`, `excludeTools`, `reserveTokens`, and read `AttentionReport` only on mutated turns.
- `CompactionOptions.trigger` (and OM attach override) is the host compaction-when seam. `thresholdEntries` and OM `compactAfterTokens` remain.
- Docs: `docs/attention-compiler.md`. Example: `examples/attention-compiler.ts`.
- Requirement **R17** in the 0.7.0 roadmap.

## Requirements

| ID | Requirement |
| --- | --- |
| C1 | Opt-in. Absent/`false` → current `assembleProviderInput` path. Zero extra allocations. No implicit enable from compaction, OM, 077, or `contextBudget`. |
| C2 | `inputCap` = host `maxInputTokens` if set, else `model.limits.contextWindow - (model.limits.maxOutputTokens ?? 0) - reserveTokens` (`reserveTokens` default `1024`). Create throws if cap cannot be resolved. |
| C3 | `triggerRatio` in `(0, 1)` default `0.75`. `used / inputCap < triggerRatio` → request **deep-equal** to compiler-off for the same inputs (golden). |
| C4 | Over ratio, stages **stop when under ratio** (not under 0%): (1) strip `thinking` from assistant turns except last `thinkingKeepTurns` (default `1`); (2) stub oldest fold-eligible tool results, keep last `keepLast` (default `3`) full. In-place on a **history clone**. Session store / input history array not mutated. |
| C5 | Default stub is deterministic, no model. If `toolResultFold.summarize` is also set, that function wins for fold-eligible rows; compiler still picks *which* rows via age/`keepLast`/`excludeTools`. |
| C6 | Frozen prefix: do not strip, stub, drop, or reorder instructions (system / `SYSTEM.md` / `AGENTS.md` / injectors), skill catalog, or `request.tools`. `excludeTools`, tool **errors**, and approval payloads are never stubbed. |
| C7 | Projection-only for compiler stages. OM ledger, 077 binds, working/semantic stores, session entries **not rewritten** by the compiler. |
| C8 | Compiler does not read, drop, stub, or rewrite observational-memory context blocks mid-run. |
| C9 | If still `used / inputCap ≥ triggerRatio` after C4 → throw `AttentionBudgetError` (same family as `ContextBudgetError`). Do not call `applyContextBudget` as a silent last resort while compiler is on. |
| C10 | Mutations sticky across turns of the same run/session leaf: a stubbed `toolCallId` stays stubbed; stripped thinking stays stripped. |
| C11 | `CompactionOptions.trigger` optional. Omitted → today’s `thresholdEntries` gate only. `type: "custom"` is the host program interface. Auto-compact still at most once per `run()`, still skipped if last entry is already `compaction`, still skipped by `RunOptions.compaction: false`, still **not** during an in-flight run. |
| C12 | OM `attach()`: if host passes `shouldCompact` / `trigger`, it **replaces** the `tokens >= compactAfterTokens` boolean. If omitted, `compactAfterTokens` unchanged. Compact still only when `runDepth === 0`. |
| C13 | After a compaction entry exists, next `assembleProviderInput` uses existing `rebuildSessionContext` (summaries + `keepRecentEntries` tail). Compiler still only mutates that tail if over ratio. Frozen prefix still C6. |
| C14 | Telemetry: one redacted `attention_compiled` **only when C4 mutated or C9 threw**. `mutated: false` turns emit nothing. No I/O payloads. |
| C15 | `AgentDefinition.attentionCompiler` omitted = off. `true` = defaults. Object = host options. `RunOptions.attentionCompiler: false` disables. Run may only **narrow** ratio/`keepLast`/`thinkingKeepTurns` (raise ratio, lower keep counts); cannot invent new stage kinds. |
| C16 | Core stays dependency-free. Code lives in `@arnilo/prism` next to `assembleProviderInput`. |

---

## Tasks

- [x] **Task 1 — Primitive review (no new engine until this lands)**
  - Acceptance Criteria:
    - Functional: Written inventory of assembly, fold, budget, compact, OM attach, and cache-layout primitives; **reuse vs gap** table; explicit rejection of a second prompt builder, 12-layer manifest, handles, and nested packets.
    - Performance: Docs-only; no runtime change; no new import graph.
    - Code Quality: Evidence file lists exact `covers:` file:line (or current spans); rejects a new package.
    - Security: Confirms projection-only (C7/C8), redaction already applied before assembly, compiler must not bypass `input_assembly` middleware.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md` — `assembleProviderInput`, `cache_aware` flatten (`instructions → attachments → summaries → history → toolResults → input`).
      - `docs/provider-caching.md` — prefix breakpoints.
      - `docs/compaction-and-retry.md` — task-boundary compact; `thresholdEntries`; auto-compact once per `run()`.
      - `docs/compaction-observational-memory.md` — `attach()` post-run flush + `compactAfterTokens`.
      - `docs/system-prompts.md` — `SYSTEM.md` → package → `AGENTS.md` → host → run.
      - `docs/context-and-skills.md` — skill catalog vs bodies.
      - `docs/thinking-and-reasoning.md` — thinking blocks.
      - `docs/api-page-template.md` / `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Previous 074 12-layer mixer with handles + packets: cache-hostile and duplicates `assembleProviderInput`. Reject.
      - Auto-enable when `contextBudget` set: silent token/cache change. Reject (C1).
      - Mid-run compact so OM can refresh inside a 200-tool `run()`: breaks documented throw and cache more often than sticky stubs. Reject for 0.7.0.
      - Pin OM context-provider bytes in the compiler: special-cases one provider name. Reject; document cache placement instead.
    - Chosen Approach:
      - Inventory, then later tasks wrap `assembleProviderInput` with an opt-in history-clone pre-pass, then today’s compose (injectors → providers → prompt builder → `input_assembly` once). Compaction trigger extends `CompactionOptions` / OM attach, not a new runtime.
    - API Notes and Examples:
      ```ts
      import { assembleProviderInput } from "@arnilo/prism";
      const request = await assembleProviderInput({
        model,
        input,
        inputLayout: "cache_aware",
        contextProviders,
        tools: activeTools,
      });
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase74-primitive-review.md`: inventory + reuse table (history path; not an API page).
      - `scripts/plan-review-gate.test.mjs` + `scripts/run-all-tests.mjs` (registered in `GATE_FILES`): the gate that keeps the review present and honest.
    - References:
      - `src/input.ts` `assembleProviderInput` / `flattenInputGroups`
      - `src/context-budget.ts` `applyContextBudget` / `dropNext`
      - `src/tool-result-fold.ts` `ToolResultFoldOptions`
      - `src/agent-session/session.ts` `autoCompact` / `compactBranch`
      - `src/contracts-core/compaction.ts` `CompactionOptions`
      - `packages/memory/src/compaction/observational-memory/compose.ts` `attach` / `compactAfterTokens`
      - `src/agent-session/session/assemble.ts` `assembleRoundContext`
  - Test Cases to Write:
    - none (review). Gate: `scripts/plan-review-gate.test.mjs` asserts the evidence file exists, cites `path:line` spans, names every required reuse row (`src/input.ts`, `src/context-budget.ts`, `src/tool-result-fold.ts`, `src/agent-session/session.ts`, `src/contracts-core/compaction.ts`, the OM `compose.ts` attach path, `src/agent-session/session/assemble.ts`, `src/cache-helpers.ts`, `input_assembly`, `redactProviderRequest`, `AttentionBudgetError`, projection-only) and still rejects the five forbidden primitives.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase74-primitive-review.md`: inventory (history, not `/docs` API).
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (no API page).
  - Completion Notes:
    - Evidence document: `docs/_evidence/phase74-primitive-review.md` (8 sections: verified turn path, per-primitive inventory, reuse/gap decision table, rejected primitives, security/ordering confirmations, gap list for Tasks 2–7, bounds already in tree, other owners).
    - Verified, not assumed: `assembleProviderInput` (`src/input.ts:L188–L331`) runs `input_assembly` exactly once on both paths (`L268` budget, `L278` default) and the default prompt builder orders `stable system prefix → context → skills → tool declarations → dynamic` (`L150–L176`); `flattenInputGroups` cache_aware order is `instructions → attachments → summaries → history → toolResults → input` (`L357–L378`). Cache breakpoints are applied at the provider edge (`packages/prism-providers/src/anthropic/cache.ts:L28`, `alibaba/cache.ts:L39`, `kimi/cache.ts:L32`, `openai/cache.ts:L52`, `bedrock/converse.ts:L93`) through the shared `applyCacheControl` (`src/cache-helpers.ts:L41–L63`), with `DEFAULT_CACHE_BREAKPOINTS` = `system_prompt` + `last_stable_message` (`src/provider-request-policy.ts:L38–L41`).
    - Key reuse findings: `foldToolResultHistory` is projection-only and already age/size-gated, but `ToolResultFoldOptions.summarize` is required and `resolveToolResultFold` returns `undefined` without it (`src/tool-result-fold.ts:L20–L59`) — that inert-by-default seam is exactly where the compiler supplies its deterministic stub while a host `summarize` still wins. `applyContextBudget`/`dropNext` (`src/context-budget.ts:L125`, `L193`) are rejected: C9 requires `AttentionBudgetError`, not eviction. `CompactionOptions` has no host "when" seam (`src/contracts-core/compaction.ts:L28–L36`), `compact()` still throws mid-run (`src/agent-session/session.ts:L313–L316`), `autoCompact` runs once per `run()` at `src/agent-session/session/assemble.ts:L151`, and OM's `attach` decides on its own `compactAfterTokens` inside a post-run `sync()` (`packages/memory/src/compaction/observational-memory/compose.ts:L160–L189`, `L340`) — the trigger seam Tasks 2/4 extend.
    - Hook decision: the compiler is a pre-pass on the per-turn assemble callback's inputs (`src/agent-session/session/assemble.ts:L210–L251`), upstream of both `input_assembly` call sites, so host middleware still observes compiler output. Implementing it as `prompt_build`/`provider_request` middleware or as a post-assembly mutation is rejected as bypassing `input_assembly`.
    - Security confirmed: history reaches the assembler already redacted (`src/agent-session/session.ts:L463`, `L558–L559`) and the request is redacted again before the provider (`L576–L578`); OM context arrives as `ContextBlock[]` (`compose.ts:L160–L172`), never as history groups, so C7/C8 projection-only holds without special-casing a provider name. Stub text stays `name` + `toolCallId` + hash of already-redacted text + byte length.
    - Deviations: (1) the review landed where planned and its "gate: evidence file exists and names the reuse rows" is now a hermetic test (`scripts/plan-review-gate.test.mjs`, registered in `GATE_FILES`) rather than prose; (2) the plan listed `assembleRoundContext` — that function is module-private (`src/agent-session/session/assemble.ts:L63`) and the per-turn seam is the `assemble` callback (`L210`), recorded as such; (3) `src/contracts-core/content.ts` (thinking block `L64`) and `src/content.ts` (capability assertion `L169`) are distinct files. No code, exports, or caps changed by this task.

- [x] **Task 2 — Contracts: options, input cap, report, errors, compaction trigger**
  - Acceptance Criteria:
    - Functional: Frozen TypeScript contracts for `AttentionCompilerOptions`, `AttentionReport`, `AttentionBudgetError`, `CompactionTrigger`, `CompactionTriggerContext`. `createAttentionCompiler` validates ratios/cap. Unknown trigger `type` throws at create, not first turn. `minTokens`-style layer maps **do not exist**.
    - Performance: Create/validate is sync, no provider I/O.
    - Code Quality: Types live beside other contracts; no runtime import of `@arnilo/prism-memory`.
    - Security: Report carries ids/counts/hashes, not raw I/O; hash is of already-redacted text.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md` — `ContextBudget` / `ContextBudgetError`.
      - `docs/compaction-and-retry.md` — `CompactionOptions`.
      - Task 1 evidence.
    - Options Considered:
      - Free-string layer names / JSON Schema config file. Reject; TS object on `AgentConfig` is enough.
      - Percentage of full `contextWindow` including output. Reject; output must stay reserved (C2).
    - Chosen Approach:
      - Closed `CompactionTrigger` union. `thresholdEntries` remains when `trigger` omitted. Custom `shouldCompact` is the host program interface.
    - API Notes and Examples:
      ```ts
      import { createAttentionCompiler } from "@arnilo/prism";

      const compiler = createAttentionCompiler({
        triggerRatio: 0.75,
        thinkingKeepTurns: 1,
        keepLast: 3,
        excludeTools: ["submit_payment"],
        reserveTokens: 1024,
      });

      // Host-programmable compact-when (task boundary):
      const compaction = {
        strategy: omStrategy,
        trigger: {
          type: "custom",
          shouldCompact: ({ estimatedInputTokens, inputCapTokens }) =>
            estimatedInputTokens / inputCapTokens >= 0.9,
        },
      };
      ```
    - Files to Create/Edit:
      - `src/contracts-core/attention.ts`: compiler types (or equivalent split file).
      - `src/contracts-core/compaction.ts`: `trigger?: CompactionTrigger` on `CompactionOptions`; `CompactionTrigger` / `CompactionTriggerContext`; `assertCompactionTrigger` (placed beside the union, `assertSessionMetadataKey` precedent — Task 4 adds `resolveShouldCompact` where the token estimate is available).
      - `src/attention-compiler.ts`: `createAttentionCompiler`, `resolveInputCap`, `AttentionBudgetError` + code/guard, `DEFAULT_ATTENTION_*` knobs, validators.
      - `src/contracts.ts` / package exports: re-export (`src/contracts-core.ts` module line, `src/index.ts` type + value blocks).
      - `src/__tests__/attention-compiler-contracts.test.ts`.
      - `src/__tests__/public-export-contract.test.ts`, `scripts/budgets.json`, `docs/_evidence/phase54-package-map.md`: frozen-surface bookkeeping for the new names.
    - References:
      - `src/context-budget.ts` `ContextBudgetError`
      - `src/contracts-core/compaction.ts`
      - Task 1 reuse table
  - Test Cases to Write:
    - missing `contextWindow` and host `maxInputTokens`: create throws
    - `triggerRatio` `0` / `1` / `NaN`: throws
    - `compactRatio < triggerRatio` when both set: throws
    - default options: `triggerRatio === 0.75`, `thinkingKeepTurns === 1`, `keepLast === 3`
    - unknown `trigger.type`: throws
    - `createAttentionCompiler` does not call a provider
    - (added) host `maxInputTokens` wins over the window; `reserveTokens` override; malformed `maxOutputTokens` / non-positive cap throw
    - (added) `excludeTools` dedupe + freeze, keep counts, `input_ratio` trigger must exceed `triggerRatio`, `AttentionBudgetError` code/guard, handle immutability
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public types/factories, still inert until Task 3/5 wire assembly.
    - Docs pages to create/edit:
      - `docs/attention-compiler.md`: create page (stub sections until Task 6 fills examples); current contract.
    - `docs/index.md` update: yes — under **Input, prompt, and context assembly**: Attention compiler — opt-in per-turn gate that mutates only after a ratio of the model input cap.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Shipped: `src/contracts-core/attention.ts` (`AttentionInputCapOptions`, `AttentionCompilerOptions`, `AttentionCompilerContext`, `AttentionCompiler`, `AttentionReport`), `src/contracts-core/compaction.ts` (`CompactionTriggerContext`, `CompactionTrigger` union `threshold_entries` | `input_ratio` | `custom`, `CompactionOptions.trigger?`, `assertCompactionTrigger`), `src/attention-compiler.ts` (`ATTENTION_BUDGET_ERROR_CODE`, `AttentionBudgetError`, `isAttentionBudgetError`, `createAttentionCompiler`, `resolveInputCap`, `resolveAttentionReserveTokens`, five `DEFAULT_ATTENTION_*` knobs). Public through the `src/index.ts` type + value blocks; `src/contracts-core.ts` gained the attention module line so `@arnilo/prism/contracts` sees the types.
    - Cap resolution (C2), verified by test: `maxInputTokens` when set (positive safe integer), else `contextWindow - (maxOutputTokens ?? 0) - reserveTokens` with `reserveTokens` default 1024. `createAttentionCompiler` throws `TypeError` when neither source is present, when a declared limit is malformed (`NaN`/negative/non-integer `maxOutputTokens`), or when the computed cap is not positive; `resolveInputCap(options?, model?)` is the same helper Task 4's `input_ratio` trigger will call.
    - Validation locked at create: `triggerRatio` in the open interval `(0, 1)`; `compactRatio` in `(0, 1)` **and** above `triggerRatio`; `thinkingKeepTurns` / `keepLast` / `reserveTokens` non-negative safe integers; `excludeTools` bounded (1024 names, 256 chars each), de-duplicated, frozen; unknown trigger `type` throws here rather than on turn one; an `input_ratio` trigger must exceed `triggerRatio` (compaction fires after the stubs). Handle and `excludeTools` are `Object.freeze`d.
    - Decisions: config errors are `TypeError` (the `context-budget.ts` / `run-limits.ts` idiom) and only the runtime overflow is `AttentionBudgetError` (`attention_budget_exceeded`, message-only like `ContextBudgetError`, with `isAttentionBudgetError`). `AttentionReport` is frozen as counts + ids only (`used`, `inputCap`, `triggerRatio`, `droppedThinkingTurns`, `stubbedToolResults`, `truncated`, optional `runId`/`sessionId`); `truncated` is defined as "the gate stopped while eligible rows remained, so the sticky frontier is partial" — the value Task 3's early stop needs and Task 6's event prints. No layer map, no JSON config file, no new dependency, nothing imported from `@arnilo/prism-memory`.
    - Surface bookkeeping (not in the task list, required by existing gates): +19 root export names rebaselined in `scripts/budgets.json` (1305 → 1324), `FROZEN_VALUE_EXPORTS` +12 / `FROZEN_TYPE_EXPORTS` +7 in `src/__tests__/public-export-contract.test.ts`, `docs/_evidence/phase54-package-map.md` regenerated, and `@arnilo/prism-memory` rebaselined 697 → 696 for the earlier dead-export removal (`sourceIdsFromRecord`).
    - Docs: `docs/attention-compiler.md` created with the nine required API-page headings (current contract, cap table, report table, error table, both examples, extension/security notes), linked once from the `Input, prompt, and context assembly` section of `docs/index.md`, and registered in `apiPages` in `src/__tests__/docs.test.ts` so the headings stay enforced. The page states plainly that the stages/wiring land in Tasks 3/5 and that omitting the option keeps today's request bytes.
    - Tests: 14 cases in `src/__tests__/attention-compiler-contracts.test.ts` — cap precedence/reserve, unresolvable + malformed caps, ratio bounds, compact-vs-trigger ordering, defaults, keep counts, excludeTools normalization/freeze, trigger shape and unknown-type rejection, `input_ratio` cross-check, error family, synchronous create with no I/O surface. `npm test` all 5 stages pass.
    - Deviations: (1) `assertCompactionTrigger` lives in `src/contracts-core/compaction.ts` next to the union it validates instead of a new `src/compaction-trigger.ts`, so the trigger cannot be declared without its validator being available; Task 4 still adds `resolveShouldCompact` (it needs the token estimate and the session/OM call sites); (2) `AttentionCompiler` carries `inputCap`/`reserveTokens`/`triggerRatio`/`compactRatio`/`thinkingKeepTurns`/`keepLast`/`excludeTools` only — Task 3 adds the stage method to the same file; (3) the plan's "does not call a provider" case is asserted structurally (synchronous, non-thenable handle, no network import) because the repo's network-free guard forbids `globalThis.fetch` in hermetic tests.


- [x] **Task 3 — Sticky stages (thinking, then tool stubs) behind the ratio gate**
  - Acceptance Criteria:
    - Functional: Under ratio, request deep-equal to compiler-off (golden). Over ratio: oldest thinking beyond `thinkingKeepTurns` stripped first; then oldest eligible tool results stubbed; last `keepLast` tool results full; `excludeTools` / errors / approvals never stubbed; history array passed in and session store unchanged; stop as soon as `used / inputCap < triggerRatio`; still over → `AttentionBudgetError`.
    - Performance: Measure once per turn (same trick as `applyContextBudget`). Stub path has no `summarize` Promise unless host supplied one. Disabled path: no compiler object.
    - Code Quality: Reuse `foldToolResultHistory` / export default stub summarizer **only when compiler on**. Do not copy `dropNext`. Do not call `applyContextBudget` on the compiler-on still-over path.
    - Security: Stub text contains no original payload; hash of already-redacted text; secrets list honored; `excludeTools` fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md` — budget eviction (not used as last resort here).
      - `docs/thinking-and-reasoning.md`.
      - `docs/provider-caching.md`.
      - Task 1 evidence.
    - Options Considered:
      - Delete oldest history messages (user “discard”). Reject: breaks tool_call pairing and reshuffles suffix cache.
      - Always require host `summarize`. Reject for compiler default.
      - Server-side Anthropic `clear_tool_uses_*`. Reject as Prism source of truth.
    - Chosen Approach:
      - History-clone pre-pass inside `assembleProviderInput` when compiler resolved. Default stub one-liner. Host fold `summarize` wins for eligible rows.
    - API Notes and Examples:
      ```ts
      const request = await assembleProviderInput({
        model,
        input,
        history,
        tools,
        attentionCompiler: { triggerRatio: 0.75, keepLast: 3 },
      });
      // under ratio: no attention_compiled
      // over: thinking gone from old assistants; old tool bodies are stubs; store still full
      ```
    - Files to Create/Edit:
      - `src/attention-compiler.ts`: gate + stages + `AttentionBudgetError` (`AttentionStickyFrontier`, `createAttentionStickyFrontier`, `AttentionCompileOptions`, `AttentionCompilation`, `compileAttention`).
      - `src/tool-result-fold.ts`: export the fold's text projection / turn inference / summary cap (`toolResultFoldText`, `inferToolResultTurns`, `capToolResultSummary`) so the compiler stubs the same bytes it would fold; the deterministic stub text itself lives with the compiler (compiler-only behavior).
      - `src/context-budget.ts`: export `measureInputCost` (the `measureAll` pass, now shared) so the gate measures the whole request once and subtracts deltas.
      - `src/input.ts`: branch on the assembled groups (after fold, before injectors/prompt builders), default groups like the budget path, `attentionCompiler` / `attentionSticky` options, `compileAttention` call.
      - `src/__tests__/attention-compiler-stages.test.ts`.
      - `scripts/budgets.json` + `docs/_evidence/phase54-package-map.md`: export-count bookkeeping (+10 names, none re-exported from the root barrel).
    - References:
      - `src/tool-result-fold.ts`
      - `src/input.ts`
      - `src/context-budget.ts` (error family only)
  - Test Cases to Write:
    - under ratio: request deep-equal to compiler-off fixture; store/history clone unchanged
    - over: oldest thinking stripped, last `thinkingKeepTurns` kept
    - over: oldest tool results stubbed, last `keepLast` full
    - `excludeTools`: named tool never stubbed
    - tool error / approval payload: never stubbed
    - sticky: turn N stubs id `call_1`; turn N+1 under ratio still has stubbed `call_1` (not restored)
    - deterministic stub: same input → identical stub bytes
    - still over after all eligible stubs: `AttentionBudgetError`; instructions/tools still present on the attempted groups
    - compiler off + `contextBudget`: `applyContextBudget` still works as today
    - (added) compiler + `contextBudget`: `TypeError`, so the budget cannot silently evict after the stages
    - (added) in-flight `toolResults` rows are the newest rows: protected while `keepLast` covers them, stubbed once they fall outside it
    - (added) a stub that would cost more than the payload it replaces is skipped instead of grown
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `assembleProviderInput` behavior when compiler set.
    - Docs pages to create/edit:
      - `docs/attention-compiler.md`: gate, stages, stub format, error.
      - `docs/input-and-prompt-assembly.md`: Related APIs link only (no release recap).
    - `docs/index.md` update: no — entry added in Task 2.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Shipped: the ratio gate and both stages are live on the assembly path. `compileAttention({ compiler, groups, context?, skills?, tools?, fold?, frontier?, redactor?, signal?, turn?, sessionId?, runId? })` measures `measureInputCost({ groups, context, skills, tools })` **once**, then (1) strips `thinking` from assistant turns beyond the newest `thinkingKeepTurns`, oldest first, and (2) stubs tool-result rows beyond the newest `keepLast`, oldest first — history rows then the current turn's in-flight results, which are always newer. Each stage stops as soon as `used < triggerRatio * inputCap`; every mutation subtracts its own `estimateMessageTokens` delta, so no re-measure. Exhausting every eligible row while still over throws `AttentionBudgetError` (message names the estimate, the trigger, the cap, and the counts; no payloads).
    - C3 golden holds: with a fresh (empty) frontier the gate is evaluated before any mutation, so an under-ratio turn returns **the same groups object**, and `assembleProviderInput({ attentionCompiler })` is deep-equal to the same call without it (tested). C10 stickiness is an explicit caller-owned `AttentionStickyFrontier` (`createAttentionStickyFrontier()`) — a stripped assistant turn is keyed by a SHA-256 of its thinking, a stubbed row by `toolCallId`; both are re-applied even when the turn is under ratio, so the prefix never re-grows. Omitting the frontier means one-shot mutation (documented).
    - C6 fail-closed list: `excludeTools`, `error` rows, rows stamped with a decision/approval metadata key (`approval`, `approvalId`, `prismApproval`, `decision`, `decisions`, `pendingDecisions`, `elicitation`), rows outside a host fold's own age/byte gates, and rows whose stub would cost more than the payload. C5 holds: with `toolResultFold` configured the host `summarize` produces the body (capped by `maxSummaryBytes` via the now-exported `capToolResultSummary`) for the rows the compiler picks; otherwise the deterministic default stub is `omitted <bytes> bytes (sha256 <32 hex>)` under the existing `Tool result <name> [<id>]: …` header, digested from redactor output when a redactor is present.
    - Projection-only (C7/C8): the compiler replaces entries in its own `history` / `toolResults` clones and never mutates a `Message` or the caller's arrays — the thrown-gate test asserts the input groups are byte-identical afterwards, and the assembly test asserts the store-side payload survives. Instructions, summaries, input, attachments, context blocks, skills, and tool declarations are measured but never touched; OM stays untouched.
    - Branch shape (Task 1 seam): `assembleProviderInput` takes the budget-style default-groups path when `attentionCompiler` is set (so the cost covers context blocks and skills too), resolves providers against the unmutated groups, compiles, then flattens, runs `input_assembly` exactly once, and continues through the normal prompt builders — middleware still observes compiler output. `attentionCompiler` + `contextBudget` is a `TypeError`: C9 forbids eviction as a silent fallback, so the combination fails closed instead of picking a winner. A custom `inputBuilder` is not consulted while the compiler is on (same precedent as the budget path).
    - Tests: 18 cases in `src/__tests__/attention-compiler-stages.test.ts` — no-op identity/report, thinking order and `thinkingKeepTurns` (counting thinking turns, not assistant messages), `keepLast`, deterministic bytes, `excludeTools`, error/decision protection, sticky tool ids, sticky thinking, host-summarize + age gate, in-flight ordering (both directions), attention-budget throw with untouched groups, assembly pass-through, under-ratio deep-equal, middleware once, compiler+budget rejection with compiler-off eviction still working, resolved-handle vs raw-options validation, all with spec-side `at()`/`foldOf()` helpers so the change adds **zero** non-null assertions (budget unchanged).
    - Deviations: (1) the deterministic stub lives in `src/attention-compiler.ts` (compiler-only, C5) rather than being exported from `tool-result-fold.ts`; the fold instead exports the three primitives the compiler needs, and `capSummaryBytes` became `capToolResultSummary`; (2) measurement needed the whole assembled cost, so the compiler reuses the budget's measurement pass (`measureInputCost`) instead of a tail-only estimate — the plan's "branch after fold, before injectors" holds, but the branch builds default groups first (context blocks included) so the ratio means what a host expects; (3) task list said `src/tool-result-fold.ts` gains the default summarizer; see (1) — same behavior, one fewer public name; (4) `scripts/budgets.json` root export ceiling 1324 → 1334 (+10) and `docs/_evidence/phase54-package-map.md` regenerated, both required by existing gates (no new names reach the root barrel, so the frozen export lists are untouched); (5) docs note the deliberate sticky-beats-golden rule: C3 byte-identity is defined for a fresh frontier, and once a session leaf has mutated, later under-ratio turns keep the frontier.


- [x] **Task 4 — Host-programmable compaction trigger + post-compact pack**
  - Acceptance Criteria:
    - Functional: `CompactionOptions.trigger` discriminated union works in `autoCompact`. Omitted `trigger` + `thresholdEntries` = today’s entry-count gate. `input_ratio` uses the same `inputCap` helper as the compiler. `custom.shouldCompact` is async-ok, fail closed on throw. Last entry `kind: "compaction"` still skips. `RunOptions.compaction: false` still skips. `session.compact()` still throws while a run is active. OM `attach()`: host `shouldCompact` / `trigger` replaces `compactAfterTokens` comparison; omitted → `compactAfterTokens` unchanged; still `runDepth === 0` only. After compact, next assemble = frozen prefix + summary + recent tail (existing `rebuildSessionContext`); compiler does not rewrite the summary; compiler may still stub thinking/tools in the **kept tail** if over ratio.
    - Performance: Trigger check is O(entries) token estimate already paid by snapshot/history rebuild; custom callback not called when compaction config is `false`.
    - Code Quality: One `resolveShouldCompact` helper used by `autoCompact` and OM attach. Do not fork `compactBranch`.
    - Security: Custom callback sees redacted estimates/ids, not raw tool payloads. Callback cannot skip redaction or middleware.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-and-retry.md` — auto-compact timing.
      - `docs/compaction-observational-memory.md` — post-run `compactAfterTokens`.
      - `docs/agent-session-runtime.md` — `session.compact` / run overlay.
      - Task 1 evidence.
    - Options Considered:
      - Compact between tool rounds of one `run()`. Reject (existing throw; C11).
      - Compiler calls `session.compact` at `compactRatio`. Reject: compiler does not write the store; compact stays host/autoCompact/OM attach.
      - Remove `thresholdEntries` / `compactAfterTokens`. Reject: back-compat.
    - Chosen Approach:
      - Additive `trigger` on `CompactionOptions`. OM attach accepts the same trigger or a `shouldCompact` function; documented precedence: explicit trigger/shouldCompact > `compactAfterTokens`.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({
        model,
        attentionCompiler: true,
        compaction: {
          strategy: omStrategy,
          trigger: { type: "input_ratio", ratio: 0.9 },
        },
      });

      createObservationalMemory({
        /* workers… */
        shouldCompact: (ctx) => ctx.entryCount > 40 || ctx.estimatedInputTokens / ctx.inputCapTokens >= 0.9,
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/compaction.ts`: trigger types (if not done in Task 2).
      - `src/agent-session/session.ts`: `autoCompact` uses `resolveShouldCompact`.
      - `src/contracts-core/compaction.ts`: `resolveShouldCompact()` + `ResolveShouldCompactOptions` / `ResolveShouldCompactInput` beside the Task 2 trigger union (no new file: the helper takes token thunks, so it never imports `resolveInputCap` and cannot cycle with `attention-compiler.ts`).
      - `src/agent-session/session.ts`: `autoCompact` resolves `{ trigger, thresholdEntries }` through the helper and supplies `estimateAssemblyTokens(messages) + summaries` and `resolveInputCap(undefined, options.model ?? config.model)` as thunks.
      - `src/index.ts` + `src/__tests__/public-export-contract.test.ts`: +1 value, +2 types.
      - `packages/memory/src/compaction/observational-memory/compose.ts`: `trigger` / `shouldCompact` on `CreateObservationalMemoryOptions`, validated at create, honored in the attach loop's post-run `sync()`.
      - `src/__tests__/compaction-trigger.test.ts` (14 cases: helper contract + session behavior).
      - `packages/memory/src/compaction/observational-memory/__tests__/attach.test.ts`: 4 new OM gate cases on the existing `attachFixture` (extended with optional create options + session model).
      - `scripts/budgets.json` (+3 exports, 1334 → 1337) and `docs/_evidence/phase54-package-map.md` regenerated.
    - References:
      - `src/agent-session/session.ts` `autoCompact`
      - `src/agent-session/helpers.ts` `mergeCompaction`
      - `packages/memory/src/compaction/observational-memory/compose.ts`
      - `rebuildSessionContext` (session context rebuild)
  - Test Cases to Write:
    - omitted trigger + `thresholdEntries: 10`: compact when entries > 10 (today)
    - `input_ratio: 0.9`: compact when estimate ≥ 0.9 cap; not when below
    - custom `shouldCompact` false: no compact even if `thresholdEntries` would have fired **if trigger is set** (trigger replaces the gate)
    - custom throw: fail closed, no compact entry
    - in-flight `session.compact()`: still throws
    - OM attach default: `compactAfterTokens` still fires post-run
    - OM attach custom: compactAfterTokens ignored when `shouldCompact` provided
    - post-compact assemble: instructions + tools + summary + keep-recent; OM source entries still on the branch
    - compiler on after compact: does not stub/drop the summary; may stub tail tool results if over ratio
    - (added) helper contract: legacy gates (`>` entries, `>=` tokens), trigger precedence, lazy cap resolution, memoized token sources, `true`-only compaction, `onError` reporting, malformed trigger rejection
    - (added) `input_ratio` with an unresolvable cap fails the run loudly on the first turn
    - (added) a custom trigger is asked once per run with the run input already appended
    - (added) OM: unknown trigger type / non-function `shouldCompact` throw at create; a throwing callback is reported through the `debug` sink
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — compaction trigger + OM attach override.
    - Docs pages to create/edit:
      - `docs/attention-compiler.md`: compact-when section.
      - `docs/compaction-and-retry.md`: `trigger` field table + Related APIs.
      - `docs/compaction-observational-memory.md`: `shouldCompact` / trigger override; `compactAfterTokens` still default.
      - `docs/agent-session-runtime.md`: auto-compact trigger sentence.
    - `docs/index.md` update: no — existing pages; compiler nav from Task 2.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Shipped: `resolveShouldCompact({ trigger?, thresholdEntries?, compactAfterTokens? }, input)` is the one compact-when decision for `session.autoCompact()` and the observational-memory attach loop. Precedence is explicit: a `trigger` replaces both legacy gates; otherwise `entryCount > thresholdEntries` (session) or `estimatedInputTokens >= compactAfterTokens` (OM) decides exactly as before. `threshold_entries` and a `custom` callback that only reads counts never pay for the token estimate or the input cap — the two token sources are thunk-backed and memoized per call, and a `custom` context exposes them as getters, so an entry-count-only host works with a `sessionModel` that declares no `contextWindow`.
    - Failure policy (documented in the helper, both pages, and the plan): a malformed trigger throws (`assertCompactionTrigger` reuse — an unknown `type` never silently disables compaction); `input_ratio` uses the compiler's `resolveInputCap` and an unresolvable cap is a config error that fails the run loudly on the first turn; a throwing `custom.shouldCompact` — including one that reads an unresolvable cap — decides `false` and reports through `onError` (the session does not subscribe; OM passes `options.debug` as `observational-memory:compaction-trigger-error`). `custom` also compacts only on a strict `true`, so a truthy non-boolean cannot compact on a guess.
    - Session path: `autoCompact` keeps its early exits (`mergeCompaction` false / `RunOptions.compaction: false` → no trigger resolution; a branch whose last entry is `kind: "compaction"` is skipped), then resolves the gate with `entryCount = snapshot.entries.length`, `estimateAssemblyTokens(snapshot.messages) + Σ estimateTextTokens(summary)`, and `resolveInputCap(undefined, options.model ?? agent.config.model)`. Compaction still runs through `compactBranch` (no `session.compact()` call), the mid-run guard is untouched, and C11 holds: the compiler never writes the store and never compacts.
    - OM path: `trigger` / `shouldCompact` live on `CreateObservationalMemoryOptions` (validated at create) and **replace** `context.compactAfterTokens` inside `sync()`; omitted, the token gate is byte-for-byte today's comparison (`>=`). The estimate stays `Σ estimateEntryTokens(entries)`, the cap comes from `resolveInputCap(undefined, attachOptions.sessionModel)`, and `runDepth === 0` remains the only entry condition.
    - Post-compact pack: verified through the public surface — after an `input_ratio` compaction the very next request carries the fresh `Summary:` message, the agent instructions, the tool declarations, and the kept recent tail, while `rebuildSessionContext` still exposes the raw branch. The compiler is proven not to rewrite the summary or the frozen prefix (deep-equal on `summaries`/`instructions`/`input`, summary text including the tool-call marker passed through) and to still stub an eligible tool row in the kept tail (`keepLast: 0`, 1 stub, payload bytes gone) — it is a clone-and-replace pass, so the store keeps the original payload.
    - Gate bookkeeping: `resolveShouldCompact` + its two option types are the only new names (budget 1334 → 1337, reason recorded); no `!` was added anywhere (`compaction-trigger.test.ts` uses `at`-style helpers and `assert.ok`). Core learned no optional-package vocabulary (`core-boundaries` gate: the helper doc says "host attach loops", not the package name).
    - Deviations: (1) the helper lives in `src/contracts-core/compaction.ts` beside the trigger union instead of a new `src/compaction-trigger.ts` — one file fewer, and taking thunks keeps it out of the `attention-compiler.ts` import graph; (2) the OM gate is a create option, not an `attach()` option — settings are JSON-validated and `attach()` per-session overrides were not required by any criterion (the plan's own example puts `shouldCompact` on `createObservationalMemory`); (3) `CompactionOptions.metadata` is now also visible to a `custom` trigger context, so the `metadata` row in `docs/compaction-and-retry.md` says so; (4) `keepLast: 0` is a valid attention-compiler value, used by the post-compact test to prove tail stubbing without a second tool round.


- [x] **Task 5 — Opt-in wiring: AgentConfig, AgentDefinition, runs**
  - Acceptance Criteria:
    - Functional: Omitted `attentionCompiler` keeps today’s request bytes (golden). `AgentDefinition.attentionCompiler: true` enables defaults after `resolveAgentDefinition`. `RunOptions.attentionCompiler: false` disables. Run overlay may raise `triggerRatio` or lower `keepLast` / `thinkingKeepTurns` only; adding stage kinds or lowering ratio (more aggressive) throws.
    - Performance: Disabled path: zero extra allocations beyond today’s assembly.
    - Code Quality: `assembleRoundContext` passes the flag through; injectors and `input_assembly` middleware still run exactly once.
    - Security: Definition cannot enable compiler for another agent’s session; ownership unchanged.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-definitions.md` — fail-closed omitted fields.
      - `docs/agent-session-runtime.md` — `RunOptions`.
      - `docs/customization.md` — replaceable seams.
    - Options Considered:
      - Registry of compilers. Reject YAGNI.
    - Chosen Approach:
      - Optional field on `AgentConfig` / `AgentDefinition` / `RunOptions`. Resolver copies definition field onto config.
    - API Notes and Examples:
      ```ts
      import { createAgent, resolveAgentDefinition } from "@arnilo/prism";

      const agent = createAgent({
        model,
        attentionCompiler: true,
      });

      const fromDef = resolveAgentDefinition(
        { name: "research", model, attentionCompiler: { triggerRatio: 0.8 } },
        { providerSource },
      );
      ```
    - Files to Create/Edit:
      - `src/contracts-core/attention.ts`: `AttentionCompilerSetting` (`boolean | AttentionCompilerOptions`).
      - `src/contracts-core/agent.ts` + `src/contracts-protocol.ts`: `AgentConfig.attentionCompiler`, `AgentDefinition.attentionCompiler`, `RunOptions.attentionCompiler`.
      - `src/agent-definitions.ts`: `buildBaseConfig` copies the field onto the config and touches nothing else.
      - `src/attention-compiler.ts`: `resolveRunAttentionCompiler(agent, run, model)` — eager validation + the narrowing merge.
      - `src/agent-session/session.ts` + `session/types.ts`: lazily created, session-owned `attentionStickyFor()`.
      - `src/agent-session/session/assemble.ts`: resolve once per run, pass the handle and the session frontier to `assembleProviderInput`.
      - `src/index.ts` + `src/__tests__/public-export-contract.test.ts`: +1 value, +1 type.
      - `src/__tests__/attention-compiler-wiring.test.ts` (13 cases).
      - `scripts/budgets.json` (1337 → 1339) and `docs/_evidence/phase54-package-map.md` regenerated.
    - References:
      - `src/agent-definitions.ts` `buildBaseConfig`
      - `docs/agent-definitions.md`
  - Test Cases to Write:
    - omitted: request deep-equal to pre-compiler fixture
    - definition `true`: compiler runs when over ratio
    - run `false` overrides agent `true`
    - run lowering `triggerRatio`: throws
    - run raising `triggerRatio`: allowed
    - middleware `input_assembly` spy: called once
    - (added) omitted / `false` / under-ratio runs produce byte-identical requests; an enabled compiler stubs the provider view while the store keeps the payload
    - (added) helper matrix: `true` → documented defaults, cap from the model window, `false`/`true` run semantics, exclusions unioned, every widening direction rejected with a named error
    - (added) a run overlay is validated before the first provider turn (zero provider requests on rejection) and cannot enable a compiler the agent left off
    - (added) injectors and `input_assembly` middleware run exactly once per provider round with the compiler on
    - (added) `excludeTools` from the run overlays the agent list, and removing the only stub-eligible row fails closed with `AttentionBudgetError`
    - (added) sticky across runs: a base-ratio stub survives a later relaxed-ratio run, while an identically seeded relaxed session keeps the payload — the A/B that fails if the frontier is rebuilt per run
    - (added) one lazily created frontier per session, never shared between sessions
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config/definition/run option.
    - Docs pages to create/edit:
      - `docs/attention-compiler.md`: config table.
      - `docs/agent-definitions.md`: new field row.
      - `docs/agent-session-runtime.md`: `RunOptions.attentionCompiler`.
      - `docs/options-index.md`: new option rows if that index lists AgentConfig/RunOptions fields.
    - `docs/index.md` update: no — existing pages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Surface: `AttentionCompilerSetting = boolean | AttentionCompilerOptions` is the one shape on `AgentConfig`, `AgentDefinition`, and `RunOptions`. `resolveRunAttentionCompiler(agent, run, model)` is the single resolver: it maps `true` → defaults, `undefined`/`false` → `undefined` (nothing allocated downstream), merges a run overlay, and returns the frozen `AttentionCompiler` handle the session passes to assembly — the same handle `assembleProviderInput` already accepts, so validation happens once and a typo fails before the first provider turn.
    - Overlay rules (C12), enforced with named `TypeError`s: a run may raise `triggerRatio`/`compactRatio`, lower `keepLast`/`thinkingKeepTurns`, and extend `excludeTools` (union, removal impossible); it may not lower a gate, protect more rows, set `maxInputTokens`/`reserveTokens` (cap inputs are config-level — moving the cap moves the gate), or enable the compiler where the agent left it off. Raising the gate to or above the agent's `compactRatio` requires raising `compactRatio` in the same overlay (the Task 2 `compactRatio > triggerRatio` invariant is preserved, not bypassed, and the run-local handle's `compactRatio` never drives compaction).
    - Timing: resolution happens in `assembleRoundContext` after the run input is appended and after auto-compaction, with `options.model ?? config.model`, so the cap follows the run's model and the run's `input_ratio` compaction trigger and the compiler agree on one number.
    - Sticky frontier: session-owned and created lazily on the first enabled assembly (`attentionStickyFor()`), so sessions that never enable the compiler allocate nothing, and one frontier spans turns, provider rounds, branches, and runs. This is the deviation: the Task 3 note said "per run/session leaf" and my first cut keyed the frontier by `currentLeafId` — which in this codebase is the branch *tip entry id* and therefore advances on every append, silently rebuilding the frontier per turn. The behavioral test caught it (a run-1 stub did not survive a relaxed run-2), and the fix makes the frontier per session: keys are `toolCallId`s and content hashes, so a branch that never contained a mutated row is simply never matched, while a branch that did keeps the cache-friendly projection.
    - Disabled path: `import.meta`-free, no frontier, no measure pass — assembly runs the exact `else` branch it ran before the compiler existed (`attended` is `undefined`), and an under-ratio turn returns the same groups object it was handed.
    - Gate bookkeeping: +2 exports (budget 1337 → 1339, reason recorded) and no new non-null assertions. `docs/options-index.md` lists option *type* names only (`AgentConfig`/`RunOptions` rows already exist and no new type is an options bag on those surfaces), so it needed no edit; the index still validates under `live-doc-check`.
    - Docs: `docs/attention-compiler.md` gained an "Enabling it" table (three surfaces), the allowed/rejected overlay list, and the session-owned frontier paragraph; `docs/agent-definitions.md` gained the field row; `docs/agent-session-runtime.md` mentions the run overlay next to `toolResultFold`.


- [x] **Task 6 — Telemetry, example, docs conformance**
  - Acceptance Criteria:
    - Functional: Mutated turns emit one redacted `attention_compiled` (`truncated`/`stubbedToolResults`/`droppedThinkingTurns`/`used`/`inputCap`/`triggerRatio`). Under-ratio turns emit **zero**. Example `examples/attention-compiler.ts` runs without credentials (mock model) and shows no-op then stub. `docs/attention-compiler.md` matches the API template. Index blurb is one sentence, no plan numbers.
    - Performance: Event payload bounded; no message text.
    - Code Quality: If 072 `ExecutionTimeline` exists, map as step `kind: "attention"`; if not, plain `AgentEvent`. Do not reimplement timeline.
    - Security: Report omits I/O; docs state default-off, projection-only, stub ≠ delete, compact still task-boundary, compiler does not rewrite OM mid-run.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md`
      - `docs/api-page-template.md`
      - `.agents/skills/create-plan/references/prism-wiki.md`
      - `docs/index.md` live headings
    - Options Considered:
      - Emit every turn with `mutated: false`. Reject (noise + cost).
      - Extra `docs/context-engineering.md` orientation. Reject; API page + related links.
    - Chosen Approach:
      - Event only on mutation/error. One API page. Related links from compaction, OM, input assembly, caching, thinking.
    - API Notes and Examples:
      ```json
      {
        "type": "attention_compiled",
        "runId": "r1",
        "sessionId": "s1",
        "used": 12000,
        "inputCap": 15000,
        "triggerRatio": 0.75,
        "stubbedToolResults": 4,
        "droppedThinkingTurns": 2
      }
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts`: the `attention_compiled` member of the `AgentEvent` union (the union lives here, not in `contracts-core/`).
      - `src/input.ts`: `onAttentionReport`, called once per mutated turn before `input_assembly` middleware.
      - `src/agent-session/session/assemble.ts`: the emitter, built once per run when the compiler is on.
      - `src/__tests__/attention-compiler-events.test.ts` (4 cases).
      - `packages/prism-core/src/governance/observability/timeline-types.ts` + `timeline.ts`: the `"attention"` step kind and its fold.
      - `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts`: +1 case.
      - `examples/attention-compiler.ts` and its `examples/README.md` row (the README gate lists every `.ts` example).
      - `docs/attention-compiler.md` (event + hook rows), `docs/agent-events.md`, `docs/execution-timeline.md`, `docs/provider-caching.md`, `docs/thinking-and-reasoning.md`, `docs/context-and-skills.md`, `docs/compaction-observational-memory.md`.
      - `docs/index.md`, `docs/input-and-prompt-assembly.md`, `docs/compaction-and-retry.md`: already carried their entries/links from Tasks 2–4 — verified, unchanged.
    - References:
      - `docs/agent-events.md`
      - Plan 072 R15 (optional timeline fold)
  - Test Cases to Write:
    - under ratio: zero `attention_compiled` events
    - over: event has no tool payload strings
    - compiler off: zero events
    - example file typechecks
    - docs lint/index test if one exists for nav entries
    - (added) `Object.keys(event)` is exactly the documented fields — nine at Task 6, eleven after the P2 enrichment added `usedAfter`/`stubbedBytes` — so the payload-free invariant is structural, not a regex
    - (added) event ordering: emitted between the provider round that is under the ratio and the one that is over it, never before the run's first turn
    - (added) two tool rounds → two events, one per mutated round, while the pre-tool round stays silent
    - (added) store retention alongside the event: the payload behind the stub is still in the session store
    - (added) timeline fold: `attention_compiled` → one `attention` step, `succeeded`, metadata carries the counts
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — event name + API page complete.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: no — entry from Task 2; no new nav.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Completion Notes:
    - Emission seam: `assembleProviderInput` gained one optional callback, `onAttentionReport`, fired after `compileAttention` returns `mutated: true` and before `input_assembly` middleware. Chosen over attaching the report to request metadata (the `contextBudgetReport` precedent) because that would have cost a metadata key plus an exported reader; the callback adds no export and no new public type. The session builds it once per run **only when the compiler is on**, so a disabled run passes `undefined` and allocates nothing.
    - One event per *mutated* assembly, not per run: the fixture shows the pre-tool round (tiny request) silent, the tool-result round reporting, and a two-tool-call run reporting twice. `session.emit` redacts, so the event is ledger-safe by construction — and it is payload-free structurally: the only fields are identity, the measured numbers, and `truncated`, which the test pins with an exact `Object.keys` comparison rather than a "no long strings" heuristic.
    - Fail-closed errors are *not* a second event: a still-over request throws `AttentionBudgetError`, which the run already surfaces as its `error` event, and the plan's "event only on mutation/error" is satisfied by that existing path plus the mutation event. Emitting from the throw site would have required a second seam inside `compileAttention`.
    - Timeline: plan 072's `ExecutionTimeline` already existed, so the compiler maps to a real step — `ExecutionStepKind` gained `"attention"` and `projectAgentTimeline` folds `attention_compiled` into a one-step `succeeded` entry carrying the counts. No timeline reimplementation, no new folder, and unknown-event handling in the folder's `default` branch is untouched.
    - `Compromises Made` unaffected. The plan's `docs/index.md` line ("entry from Task 2") was verified rather than re-edited: the entry is one sentence, links the page, and carries no plan numbers.
    - Example is network-free and deterministic: `assembleProviderInput` twice against the same history — under the ratio the request is byte-identical to a compiler-off assembly and no report fires; over it the aged row becomes `omitted 4006 bytes (sha256 …)` in the provider view while the caller's history still holds every byte — which is the "stub ≠ delete" statement in executable form. Listed in `examples/README.md` (the docs gate requires every `.ts` example to appear there in backticks).

## Compromises Made

- Compiler **opt-in / default-off**. Auto-enable would change every host’s token bill and cache prefixes.
- No new package. Lives in `@arnilo/prism` beside `assembleProviderInput`.
- **No mid-run compaction** (existing task-boundary contract). Long single `run()` loops rely on sticky stubs; hosts who need a new OM prefix start a new `run()` or compact between tasks.
- No 12-layer manifesto, handles, nested isolation packets, or LLM-in-compiler. Add when stubs+thinking+compact-when measurably fail.
- Default stub is extractive, not LLM. Hosts already have `toolResultFold.summarize` and LLM/OM compaction for the expensive path.
- Compiler does **not** pin OM context-provider bytes. Volatile OM in the cached prefix still busts cache; hosts should keep constitution in the prefix and treat OM as post-compact summary.
- `applyContextBudget` is not the compiler’s last resort. Still-over throws so constitution cannot be silently dropped.
- Pause-after-compaction SDK UX not shipped; `compaction_finished` + `attention_compiled` are the seams.
- Telemetry stays one event per *mutation*, not one per turn with `mutated: false`: a busy run would otherwise pay an event, a ledger append, and a timeline step per provider round to say "nothing happened". Fail-closed turns stay observable through the run's existing `error` event rather than a second event from the throw site.
- The timeline `attention` step carries counts only, not per-stub byte totals. Summary curves already derive usage from provider steps; duplicating them invites drift (upgrade path in Further Actions).
- Helpers that a host may want as config (`onAttentionReport` is a call option, the frontier is session-owned) rather than registry seams: no attention registry, no plugin kind.

## Further Actions

All four follow-ups shipped on 2026-09-14; the measurement came first, as the plan required, and it is what the later three were justified against.

- **P1 — measure before extending: complete.** `scripts/benchmark-scenarios/attention-compiler.mjs` (registered in `scripts/benchmark.mjs`, hermetic, network-free) assembles an 8-turn fixture through the real `assembleProviderInput` in compiler-off/compiler-on/volatile-provider/pinned/resume/truncation modes; `docs/_evidence/phase74-attention-measurements.md` records the output, and `scripts/attention-measurements.test.mjs` (in `GATE_FILES`) re-runs the scenario and fails if any documented number drifts. Floors live in `scripts/budgets.json#attentionCompiler`.
  - Recorded: **63.7 % fewer input tokens** (32,716 → 11,886 over 8 turns, 83,310 payload bytes stubbed across 4 mutating turns), **one cache bust** (the turn the gate trips) against **zero** compiler-off, and the stub is byte-identical when re-applied on later turns — so the compiler is not the cache tax.
- **P2 — `attention` step enrichment: complete.** `AttentionReport` gained `usedAfter` (post-mutation estimate, so `used` → `usedAfter` is the per-turn cost curve) and `stubbedBytes` (payload mass the stubs removed); both ride the `attention_compiled` event and the timeline `attention` step metadata. Docs rows updated in `docs/attention-compiler.md`, `docs/agent-events.md`, `docs/execution-timeline.md`; the event-keys test still pins the exact field set.
- **P3 — frontier persistence across restarts: complete.** The sticky frontier is bounded (256 thinking keys, 256 tool-call ids, newest kept — eviction only ever drops rows that have left the input window) and rides a durable run's `persistSessionState` checkpoint as `sessionState.attentionSticky`, restored on resume by `restoreAttentionSticky`. `parseAttentionStickyFrontier` validates from the untrusted store: malformed entries are dropped one by one, a malformed shape yields an empty frontier, and neither can block a resume. Measured worth: **32,867 bytes** of re-stub churn avoided on the relaxed-gate resume; the integration test proves a stub survives a resume *below* the gate only when the opt-in is on (control included). Docs: `docs/agent-session-runtime.md`, `docs/attention-compiler.md`.
- **P4 — `truncated` follow-up signalling: complete.** `createAttentionTruncationTrigger({ threshold })` counts consecutive truncated turns from `attention_compiled` events and fires **once per armed streak** at the next compaction decision through the existing `CompactionOptions.trigger` seam; a mutated-but-not-truncated turn clears the streak, `reset()` disarms, and the threshold is validated at create. Documented with a worked example in `docs/attention-compiler.md` and `docs/compaction-and-retry.md`.
- **OM-block pin: closed by measurement, not by code.** The fixture quantifies the problem — with a provider block that changes each turn, **19,348 bytes** are re-sent behind it across the run — and pins the decision: the four-line host recipe (`resolve` once per session, documented in the evidence file and `docs/attention-compiler.md`) fixes it without giving the compiler authority over provider bytes, which the locked fork forbids. Revisit only if a host proves it cannot express the pin itself.
- **Still owned elsewhere (unchanged):** nested `ContextPacket`s / nested-run packets (plan 078), provider-native context-editing adapters (provider plans — the compiler exists so hosts do not depend on them), Memory Fabric packing (plan 075).
- **Projected episodic pack: complete (2026-09-15, with 077).** The post-compact summary the compiler packs now renders the work-scope projection (leaf + ancestors) instead of the full ledger when the host opened scopes; the compiler itself still measures and never repacks. `packages/memory/src/compaction/observational-memory/strategy.ts`; docs `docs/attention-compiler.md`.
