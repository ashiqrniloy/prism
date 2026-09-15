# Phase 74 — Primitive Review: Attention Compiler Inventory

Plan: [074-Attention-Compiler.md](../../plans/074-Attention-Compiler.md) Task 1 ("Primitive review — no new engine until this lands").
Date: 2026-09-14. Baseline: released `0.6.0` plus the completed 072/073-line work in tree.
Scope: **read-only**. This document is the gate for Tasks 2–7: no compiler code lands before it.

Cite convention: `covers:` spans are `file:Lstart–Lend` in this tree. Everything below was verified against those spans, not against prose.

---

## 1. Current turn path (verified order)

| # | Step | Span | Behavior |
| --- | --- | --- | --- |
| 1 | run start: input guardrails → append input messages → **auto-compact** | `src/agent-session/session/assemble.ts:L151`, `src/agent-session/session.ts:L501–L509` | `autoCompact` runs once per `run()`, before the first assemble; gated by `compaction.thresholdEntries`; skips when the branch already ends in a compaction entry. |
| 2 | per-turn assemble callback (loop-owned) | `src/agent-session/session/assemble.ts:L210–L251` | Passes `history: session.history`, `summaries`, `toolResults`, `turn`, `tools`, `inputLayout`, `toolResultFold`, `contextProviders`, `middleware`, `redactor`, `providerOptions` into the assembler. |
| 3 | `assembleProviderInput` | `src/input.ts:L188–L331` | See §2.1. |
| 4 | provider-request policy + `provider_request` middleware | `src/agent-session/session/assemble.ts:L253–L254` | Policy chain fills `sessionId`/`cacheKey`/cache defaults (`src/provider-request-policy.ts:L57–L77`). |
| 5 | redact request → `generateWithRetry` | `src/agent-session/session/assemble.ts:L255–L260`, `src/agent-session/session.ts:L576–L578` | `redactProviderRequest` is the last transform before the provider edge. |
| 6 | provider edge applies cache breakpoints | `packages/prism-providers/src/anthropic/cache.ts:L28`, `alibaba/cache.ts:L39`, `kimi/cache.ts:L32`, `bedrock/converse.ts:L93`, `openai/cache.ts:L52` | Each adapter calls the shared `applyCacheControl`; no breakpoint logic lives in the assembler. |

**Consequence for 074:** the only seam that is both per-turn and upstream of `input_assembly` is step 3's inputs (`history` / `toolResults` / `input`) — i.e. inside the step-2 callback, or as a new opt-in option consumed by `assembleProviderInput` before its own compose. A post-assembly mutation (step 4+) and a `prompt_build` middleware both land **after** `input_assembly` and are therefore rejected (§4).

---

## 2. Inventory

### 2.1 Input assembly — `src/input.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `L150–L176` | `createDefaultPromptBuilder` | Final provider message order for `cache_aware`: `stable system prefix → context blocks → skill messages → tool declarations → dynamic messages`; `legacy` keeps the old whole-prompt order. |
| `L188–L331` | `assembleProviderInput` | Single compose path (see below). |
| `L333–L346` | `buildDefaultInputMessageGroups` | Groups: `instructions`, `summaries`, `history`, `input`, `attachments`, `toolResults`. |
| `L348–L355` | `DefaultInputMessageGroups` | The group shape `cache_aware` flattening depends on. |
| `L357–L378` | `flattenInputGroups` | `cache_aware` = `instructions → attachments → summaries → history → toolResults → input`; `legacy` = `instructions → summaries → history → input → attachments → toolResults`. |
| `L131–L147` | `resolveContextProviders` | Runs `context` middleware and each provider; returns `ContextBlock[]` merged into the prompt later, **not** history messages. |

`assembleProviderInput` order (verified):
1. fold history + tool results (`L205–L213`) when `toolResultFold` resolves;
2. run instruction injectors; the current `input` is redacted **before** injector code sees it (`L212–L227`);
3. compose system instructions (`L228–L230`);
4. tool disclosure and default group build (`L240–L245`, `L249–L252`);
5. **`input_assembly` middleware** (`L268` on the budget path after `applyContextBudget` at `L257`, `L278` on the default path — it always runs) and `resolveContextProviders` (budget path `L251–L256`, default path `L281–L287`);
6. `prompt_build` middleware (`L288–L313`) then the prompt builder (`L314`);
7. `assertMessagesSupportModelCapabilities` (`src/content.ts:L169`) and `applyDefaultProviderRequestOptions` (`L319–L330`).

### 2.2 Budget — `src/context-budget.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `L19–L27` | `ContextBudget` | `maxInputTokens`, `maxInputBytes`, `reportOmissions`, `tokenEstimator` (UTF-16/4 default). |
| `L29–L40` | `ContextBudgetOmissionKind` | `skills`, `skill_body`, `context`, `history`, `tool_results`, `summaries`, `attachments`, `tools`. |
| `L48–L55` | `ContextBudgetReport` | Kept tokens/bytes + omissions; stored under `CONTEXT_BUDGET_REPORT_METADATA_KEY` (`src/input.ts:L2`). |
| `L106–L123` | `resolveContextBudget` | Defaults/normalization; byte caps estimator-independent. |
| `L125–L191` | `applyContextBudget` | Evicts **whole items** by kind until under budget; returns groups/context/skills/tools + report. |
| `L193–L…` | `dropNext` | Deterministic eviction cursor. |

**Gap:** this is a *drop* engine driven by a host `contextBudget`. Compiler C9 explicitly does not route through it — it may only strip/stub monotonic content and must throw `AttentionBudgetError` when still over. No reuse of `dropNext`.

### 2.3 Tool-result fold — `src/tool-result-fold.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `L4–L7` | defaults + hard cap | `minAgeTurns 2`, `minBytes 4096`, `maxSummaryBytes 512`, hard summary cap `4096`. |
| `L20–L25` | `ToolResultFoldOptions` | `minAgeTurns?`, `minBytes?`, `maxSummaryBytes?`, **`summarize` (required)**. |
| `L42–L59` | `resolveToolResultFold` | **Returns `undefined` when no `summarize` is supplied** → folding is off by default. |
| `L63–L130` | `foldToolResultHistory` | Projection-only rewrite of history tool messages; input array untouched. |
| `L132–L152` | `foldToolResultValue` | Same for the current turn's `toolResults`; stamps `metadata.prismFolded: true`. |
| `L154–L186` | `maybeFold` | Eligibility: `turn - toolResultTurn ≥ minAgeTurns` and `bytes ≥ minBytes`; abort-aware; summary capped. |
| `L187–L…` | `foldedToolResultHeader` | Replacement text shape `name` + `toolCallId` + summary. |

**Gap (exactly the compiler's C5 seam):** fold exists, is age/size-gated, projection-only and already provider-safe — but it is inert without a host `summarize`. The compiler supplies a **deterministic default stub** for compiler-eligible rows and lets a host `summarize` still win.

### 2.4 Compaction — `src/agent-session/session.ts`, `src/contracts-core/compaction.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `src/contracts-core/compaction.ts:L28–L36` | `CompactionOptions` | `strategy`, `thresholdEntries`, `keepRecentEntries`, `maxSummaryChars`, `secrets`, `metadata`, `signal`. **No host "when" seam.** |
| `L6–L17` | `CompactionContext` | Carries `trigger?: "manual" \| "auto" \| string` (set by the session, not by hosts). |
| `session.ts:L313–L316` | `compact()` | **Throws** `"Agent session already has an active run"` while a run is in flight (mid-run compact contract). |
| `session.ts:L501–L509` | `autoCompact` | Entry-count gate (`thresholdEntries`), once per `run()`, skips when the branch already ends in compaction. |
| `session.ts:L511–L555` | `compactBranch` | Strategy → `compaction` middleware → append `compaction` entry → `rebuildHistory()`; emits `compaction_started`/`compaction_finished`; summary passed through `redactSecrets`. |

**Gap:** host-programmable trigger (`input_ratio` / `shouldCompact`) does not exist; `trigger` is only accepted on the internal `CompactionContext`.

### 2.5 Observational-memory attach — `packages/memory/src/compaction/observational-memory/compose.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `L101–L105` | `ObservationalMemory.attach` | Contract. |
| `L124–…` | `attach(...)` | Wraps `run`/`prompt`/`stream` with a `runDepth` guard. |
| `L160–L172` | context provider `observational-memory` | Resolves `buildObservationalMemoryContextBlocks(...)` → **context blocks**, never history messages. |
| `L174–L189` | `sync()` | Post-run only (`runDepth === 0`), skips when `passive`; flushes, then calls `session.compact()` when estimated entry tokens ≥ `context.compactAfterTokens`. |
| `L340` | `compactAfterTokens` resolution | Settings default; negotiates with `overrides`. |

**Gap:** the "when" decision is a token threshold inside `attach`, hard-wired to its own flush/compact sequence. Compiler R17 extends this seam; it must not add a second observer or a mid-run rewrite (C8).

### 2.6 Cache layout — `src/cache-helpers.ts`, `src/provider-request-policy.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `cache-helpers.ts:L41–L63` | `applyCacheControl` | Marks the last content block of each requested location; `ttl` optional. |
| `cache-helpers.ts:L116–L…` | `resolveBreakpoint` | Resolves `system_prompt` / `last_stable_message` / message index. |
| `provider-request-policy.ts:L38–L41` | `DEFAULT_CACHE_BREAKPOINTS` | `[{ location: "system_prompt" }, { location: "last_stable_message" }]`, filled only when `model.cache` declares support. |

Cache is therefore **byte-prefix + per-provider breakpoint placement**, computed after assembly. A compiler that mutates only a sticky frontier keeps every earlier breakpoint byte-identical; any reordering/deletion inside the prefix invalidates from that point.

### 2.7 Frozen-prefix inputs (C6)

| Primitive | Span | Note |
| --- | --- | --- |
| `composeSystemPrompt` | `src/system-prompts.ts:L18` | SYSTEM.md → package → AGENTS.md → host → run merge order. |
| Skill catalog vs bodies | `src/skill-disclosure.ts:L64–L69` (`capSkillCatalog`), `L72–L76` (`selectSkillsForPrompt`), `L78–L83` (`skillHasRenderableBody`), `L85–L…` (`skillPromptText`) | Catalog is always rendered; bodies only when eager/loaded; caps `HARD_MAX_SKILL_CATALOG_ENTRIES 256`, `HARD_MAX_SKILL_DESCRIPTION_BYTES 4096`, `HARD_MAX_SKILL_INSTRUCTION_BYTES 262144`. |
| Tool disclosure | `src/tool-search.ts:L177–L…` (`selectDisclosedTools`), used at `src/input.ts:L240–L243` with `session.activatedTools` | Disclosed set may grow (activation) but shrinking mid-run rewrites the prefix → forbidden by the plan's forks. |

### 2.8 Thinking — `src/contracts-core/content.ts`, `packages/prism-providers/src/anthropic/thinking.ts`

| Span | Primitive | Behavior |
| --- | --- | --- |
| `src/contracts-core/content.ts:L64` | `type: "thinking"` content block | Thinking lives in assistant messages in history. |
| `thinking.ts:L57–L66` | `anthropicPreserveThinking` | `compat.preserveThinking` wins; otherwise replays historical thinking only when the model declares `capabilities.reasoning === true`. |

**Constraint for the compiler's strip stage:** stripping is only safe on turns older than `thinkingKeepTurns`, and the stripped message must keep its `tool_use` blocks and any following `tool_result` pairing intact; replay-on models lose the signature only for stripped turns, which is the same policy `preserveThinking` already exposes.

### 2.9 Middleware — `src/middleware.ts`

`MiddlewareHookName` (`L4–L14`) includes `input_assembly`, `prompt_build`, `context`, `compaction`, `provider_request`. The compiler may not be implemented as `prompt_build`/`provider_request` middleware or as a post-assembly mutation, because both run **after** `input_assembly` (`src/input.ts:L268/L278`).

### 2.10 Redaction

| Span | Point | Coverage |
| --- | --- | --- |
| `src/agent-session/session.ts:L463` | session append (input messages) | `this.redact(message)`. |
| `src/agent-session/session.ts:L558–L559` | entry store | `redactSessionEntry` before `store.append`. |
| `src/agent-session/session.ts:L576–L578` | provider edge | `redactProviderRequest` after policy/middleware. |
| `src/input.ts:L218` | assembler | current `input` redacted before injectors see it. |
| `src/redaction.ts:L44`, `L98` | helpers | `redactMessage`, `redactSecrets`. |

**Consequence:** `session.history` handed to the assembler is already redacted; a compiler pre-pass cannot un-redact or bypass it, and its output is redacted again at the provider edge. Stub text must be derived only from already-redacted content (`name`, `toolCallId`, content hash, byte length).

### 2.11 Round context — `src/agent-session/session/assemble.ts`

`assembleRoundContext` (`L63`) builds the run context; `executeRun` (`L296`) drives it; the per-turn `assemble` callback (`L210`) is the only place a per-turn, pre-`input_assembly` transform can be inserted for the wired session.

---

## 3. Reuse vs gap (decision table)

| Need (074) | Existing primitive | Verdict | Gap Tasks 2–7 must fill |
| --- | --- | --- | --- |
| Per-turn measure of `used / inputCap` | `assembleProviderInput` inputs (`history`, `toolResults`, `input`, `tools`, `skills`, `context`) + `ContextBudget.tokenEstimator` semantics | **Reuse** | Nothing — read-only measure on the group set. |
| In-place strip/stub on a history clone | `foldToolResultHistory` (projection-only, `L63`) + group lists (`L348–L355`) | **Reuse** | Deterministic stub for rows with no host `summarize`. |
| Deterministic tool-result stub | `foldedToolResultHeader` (`L187`) | **Reuse** | Compiler-owned default `summarize`; host `summarize` still wins. |
| Age/size gating | `minAgeTurns`/`minBytes`/`maxSummaryBytes` defaults (`L4–L7`) | **Reuse** | Compiler defaults (`thinkingKeepTurns`, `keepLast`) mapped onto the same gates. |
| Frozen prefix | `composeSystemPrompt`, `capSkillCatalog`, tool set | **Reuse (do not touch)** | Assert in tests that compiler-on never mutates these groups. |
| Budget overflow after stubbing | `applyContextBudget` / `dropNext` | **Reject** | `AttentionBudgetError` instead of eviction (C9). |
| When-to-compact seam | `CompactionOptions` (`L28–L36`), `autoCompact` (`L501`), OM `sync()` (`L174`) | **Extend** | `CompactionOptions.trigger` (+ custom `shouldCompact`) honored by both the session and OM attach. |
| Mid-run refresh | `compact()` throw (`L313`) | **Keep throw** | Nothing; documented as forbidden. |
| Cache breakpoints | provider-edge `applyCacheControl` + `DEFAULT_CACHE_BREAKPOINTS` | **Reuse** | Golden test that no-op turns are byte-identical, mutated turns only advance the frontier. |
| Report surface | `ContextBudgetReport` + `CONTEXT_BUDGET_REPORT_METADATA_KEY` precedent | **Pattern reuse** | `AttentionReport` only on mutated turns, same metadata precedent. |
| New store / new package / new runtime | — | **Reject** | Nothing: compiler is a pure pre-pass in `src/`. |

---

## 4. Rejected primitives (frozen)

| Rejected | Why |
| --- | --- |
| Second prompt builder | Duplicates `assembleProviderInput` + `createDefaultPromptBuilder` (`src/input.ts:L150`, `L188`) and splits the `input_assembly` contract. |
| 12-layer `AttentionLayerId` manifest | Duplicates the group/stage structure already expressed by `DefaultInputMessageGroups` + prompt-builder order. |
| `evict: handle` / handles | Breaks `cache_aware` prefix stability and creates a second eviction authority beside `dropNext`. |
| Nested `ContextPacket`s | No consumer; nested-run packets stay deferred. |
| Auto-enable when `contextBudget` is set | Silent token/cache change (C1). |
| Mid-run `session.compact` | Contradicts `compact()`'s documented throw (`session.ts:L313`) and invalidates the prefix more often than sticky stubs. |
| OM context-block pinning in the compiler | Special-cases one provider name; cache placement is documented instead. |
| LLM summarizer inside the compiler | Non-deterministic stub text → permanent cache miss; host `summarize` remains the extension point. |
| New npm package / new store / DatasetStore-style extras | No import cycle forces it; `src/` is one-way-consumed by session + `input.ts`. |

---

## 5. Security and ordering confirmations

- **Projection-only (C7/C8):** every reuse target is already projection-only (`foldToolResultHistory` `L63`, `applyContextBudget` returns new groups, `flattenInputGroups` `L357`). The compiler writes no session entry, no OM ledger row, no store. OM blocks arrive as `ContextBlock[]` via `resolveContextProviders` and are never in the groups the compiler may touch.
- **Redaction:** `session.history` is redacted at entry-append time (`session.ts:L558`) and the assembled request is redacted again before the provider (`session.ts:L576`), so the compiler cannot introduce a new leak path; stub text is derived from redacted content only.
- **Middleware cannot be bypassed:** the compiler is upstream of both `input_assembly` call sites (`src/input.ts:L268`, `L278`). Host `input_assembly` middleware therefore still observes and may rewrite compiler output. Implementing the compiler as `prompt_build`/`provider_request` middleware or as a post-assemble mutation is rejected (§4).
- **Caps:** no `maxRequestBytes`/`maxResponseBytes` change; `HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES` (4096) and the skill caps still apply to anything the compiler renders.
- **Fail closed:** unresolved `inputCap` → compiler creation throws (C2); still-over after stubs → `AttentionBudgetError` (C9); option validation errors are compiler-specific, never silent.
- **No new import graph:** compiler code lives in `src/` (root package), consumed by the session assembler; no package boundary is crossed, no new dependency.

---

## 6. Gap list owned by later tasks

| Gap | Task |
| --- | --- |
| `AttentionCompilerOptions` / `createAttentionCompiler` / `inputCap` precedence / `triggerRatio < compactRatio` validation | 2 |
| `AttentionReport` (mutated turns only) + `AttentionBudgetError` | 2–3 |
| Strip/stub stages, stickiness, `excludeTools`, error/approval rows never stubbed | 3 |
| `CompactionOptions.trigger` + `shouldCompact`, honored by session and OM attach | 4 |
| `AgentConfig`/`AgentDefinition.attentionCompiler` + `RunOptions.attentionCompiler: false` | 5 |
| Golden cache tests, byte-identical no-op turns, docs/example | 6–7 |

---

## 7. Bounds already in tree (no new caps needed before Task 2)

`minAgeTurns 2` / `minBytes 4096` / `maxSummaryBytes 512` (hard 4096) · `DEFAULT_MAX_SKILL_CATALOG_ENTRIES 64` (hard 256) · `HARD_MAX_SKILL_DESCRIPTION_BYTES 4096` · `HARD_MAX_SKILL_INSTRUCTION_BYTES 262144` · `ContextBudget` estimator is estimator-independent for byte caps · tool-search top-K caps (`src/tool-search.ts`).

## 8. Deferred (other owners)

Fabric packing (plan 075) · provider-native context-editing adapters · nested-run packets · OM-block pinning pending host evidence · compaction of working/semantic stores (not the compiler's job).
