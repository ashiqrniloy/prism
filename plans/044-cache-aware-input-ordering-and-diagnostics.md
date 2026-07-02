# Phase 43 — Cache-aware input ordering and diagnostics

## Objectives
- Add an opt-in cache-aware default input/prompt layout that keeps stable prompt prefix bytes deterministic without replacing the whole input builder.
- Preserve legacy input ordering unless a host/package explicitly selects cache-aware ordering.
- Expose small cache diagnostics from normalized `Usage` fields so apps can report cache reads/writes, hit rate, and estimated savings.
- Keep tool-call/tool-result transcripts in provider-valid order.
- Update the cache, input assembly, and usage docs named by the roadmap.

## Expected Outcome
- Hosts can set cache-aware input ordering on `AgentConfig`, `RunOptions`, or direct `assembleProviderInput()` calls while legacy mode remains the default.
- Same stable instructions/tools/context/resources/attachments/summaries/history with different current user suffixes produce byte-stable provider payload prefixes.
- Attachments/resources move before the current input only in cache-aware mode; legacy tests still pass unchanged.
- Cache diagnostics work from `Usage.cacheReadTokens`/`cacheWriteTokens` and existing model pricing, including providers that report reads but no writes.
- Docs describe opt-in behavior, migration constraints, diagnostics, and provider-order safety.

## Tasks

- [x] Primitive review and current ordering/diagnostics inventory
  - Acceptance Criteria:
    - Functional: Inventory current default input ordering in `src/input.ts`, prompt ordering in `createDefaultPromptBuilder()`, runtime `assembleProviderInput()` call sites in `src/agents.ts`, existing cache helpers in `src/cache-helpers.ts`, normalized `Usage`, run ledger usage records, and existing docs/tests. No runtime code changes in this task.
    - Performance: Record current assembly complexity and identify the smallest ordering change that stays O(messages + attachments + resources + context + tools).
    - Code Quality: Identify one generic opt-in surface instead of a second input builder implementation; reject provider-specific ordering logic in core.
    - Security: Confirm reordered attachments/resources still load only through caller-provided `ResourceLoader`, secrets are not used as cache keys, and diagnostics do not expose credentials.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 43 — Cache-aware input ordering and diagnostics.
      - `plans/043-prompt-cache-primitives-and-provider-capability-metadata.md` for Phase 42 cache primitives and deferred Phase 43 work.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/runs-and-usage.md`, `docs/agent-session-runtime.md`.
      - `src/input.ts`, `src/agents.ts`, `src/cache-helpers.ts`, `src/contracts.ts`, `src/__tests__/input-pipeline.test.ts`, `src/__tests__/cache-helpers.test.ts`, `src/__tests__/agents.test.ts`.
    - Options Considered:
      - Add a new cache-specific input builder: more surface, forces hosts to replace the default; rejected.
      - Add one layout option consumed by the existing default builder/assembler: minimal and lets apps opt in without replacing the builder; chosen.
      - Flip default ordering now: breaks existing behavior without a major-version migration; rejected.
    - Chosen Approach:
      - Inventory first, then add a small `legacy`/`cache_aware` layout option to the existing assembly path. Keep provider-specific cache serialization in provider packages and use Phase 42 helpers for diagnostics.
    - API Notes and Examples:
      ```ts
      // Current legacy behavior stays default until a host opts in.
      const request = await assembleProviderInput({ model, input: "Hi" });
      ```
    - Files Created/Edited:
      - `plans/044-cache-aware-input-ordering-and-diagnostics.md`: marked this inventory task complete and recorded current ordering, diagnostics, performance, code-quality, and security findings.
      - Runtime/source files: none changed; this task is inventory-only.
    - Files Reviewed:
      - `src/input.ts`: current default ordering, prompt-builder ordering, resource loading, middleware, and candidate change point.
      - `src/agents.ts`: runtime `assembleProviderInput()` call path and run/agent override patterns.
      - `src/cache-helpers.ts`: current helper surface (`sanitizeCacheKey`, `mapCacheRetention`, `applyCacheControl`, `cacheHitRate`, `cacheSavings`).
      - `src/contracts.ts`: `Usage`, `ModelCost`, `ProviderRequestOptions`, `AgentConfig`, `RunOptions`, `UsageRecord`, `RunLedger`.
      - `src/__tests__/input-pipeline.test.ts`, `src/__tests__/cache-helpers.test.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/run-ledger.test.ts`: existing coverage anchors.
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/runs-and-usage.md`: docs gaps for later tasks.
    - Current Ordering Inventory:
      - `createDefaultInputBuilder().build()` currently flattens groups in this exact order: `systemInstructions` → `developerInstructions` → custom `instructions` → `summaries` → `history` → current `input` → `attachments`/`resourceUris` → `toolResults`, then optional `input_assembly` middleware.
      - `attachmentMessages()` loads explicit URI attachments/resource URIs through `loadTextResource(context.resourceLoader, ...)`; missing loaders fail with `Resource loader required for <uri>`.
      - `assembleProviderInput()` runs instruction injectors first, composes their instructions into `systemInstructions`, builds messages, resolves context providers with those messages, runs optional `prompt_build` middleware, then calls the selected prompt builder.
      - `createDefaultPromptBuilder().build()` currently prepends `contextMessages(request.context)`, `skillMessages(request.skills)`, and `toolMessages(request.tools)` before `request.messages`; these are already stable prefix material for cache-aware mode.
      - Runtime in `src/agents.ts` calls `assembleProviderInput()` from `LoopContext.assemble()` with `history: this.history`, current summaries, runtime tool results, system instructions, configured builders, context providers, active skills/tools, resource loader, provider options, redactor, middleware, and ids.
      - Runtime appends the current user input to session history before assembly. For tool turns, `LoopContext.assemble(nextInput, toolResults, turn)` passes previous `this.history` plus `toolResults`; later implementation must avoid moving tool results behind unrelated current user suffixes.
    - Current Diagnostics Inventory:
      - `src/contracts.ts` `Usage` already normalizes `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens`, `cost`, and `currency`.
      - `ModelCost` already exposes `input`, `output`, `cacheRead`, `cacheWrite`, `currency`, and `unit` for pricing-based diagnostics.
      - `src/cache-helpers.ts` already has `cacheHitRate(usage)` and `cacheSavings(usage, model)`; no combined report helper exists yet.
      - `src/agents.ts` appends a final `UsageRecord` after loop completion and also appends provider `usage` events through the run ledger path; `docs/runs-and-usage.md` documents `appendUsage` and `UsageRecord` but not cache-specific reporting.
      - Existing tests cover `cacheHitRate()`/`cacheSavings()`, agent finished usage with cache read/write tokens, provider conformance usage accounting, and run-ledger redaction of usage records.
    - Current Docs/Test Inventory:
      - `docs/input-and-prompt-assembly.md` documents legacy behavior: history before current input, text attachments/resources as user messages, tool results as tool messages, middleware order, and linear performance. It does not document a cache-aware layout option.
      - `docs/provider-caching.md` documents structured cache hints, breakpoints, `cacheHitRate()`, `cacheSavings()`, no guaranteed hits, cache keys not secrets, and header ownership. It does not document stable-prefix input ordering or a combined cache diagnostics report.
      - `docs/runs-and-usage.md` documents `UsageRecord.usage` as normalized usage but has no cache hit-rate/savings example.
      - `src/__tests__/input-pipeline.test.ts` currently asserts legacy order for history/current input and instructions/summaries/current input/attachments/resources, plus middleware order and prompt builder context/skill/tool prepending.
      - `src/__tests__/agents.test.ts` currently asserts provider request policy cache keys are session-derived and do not include prompt text, and agent finished usage carries `cacheReadTokens`/`cacheWriteTokens`.
    - Current Performance Inventory:
      - Default input assembly is linear in instruction count, summary count, history length, current input count, attachments/resources, and tool results; resource loading is one awaited load per URI supplied by the host.
      - Context resolution is linear in selected context providers plus block count; prompt building is linear in context blocks, skills, tools, and messages.
      - `applyCacheControl()` is O(messages × breakpoints) in the small current implementation; diagnostics helpers are O(1).
      - Smallest later change: build existing message groups into named arrays once, then flatten in legacy or cache-aware order. This keeps O(messages + attachments + resources + context + tools) and avoids tokenization, hashing, or provider I/O.
    - Smallest Generic Primitive Change:
      - Add one generic opt-in layout field (`legacy` default, `cache_aware` opt-in) to the existing default input/assembly/runtime path.
      - Do not add a second input builder, cache-specific prompt builder, provider-specific branches, or hidden global cache mode.
      - Use the existing default prompt builder's context/skill/tool prefix; only reorder the default input-builder groups where origins are still known.
      - Keep cache diagnostics as pure helpers over normalized `Usage` and optional `ModelConfig.cost`; do not add provider-specific usage payloads to core.
    - Security Inventory:
      - Attachments/resources are host-supplied and URI reads go only through caller-provided `ResourceLoader`; cache-aware reordering must not add filesystem/network loading paths.
      - Existing provider request policy test confirms session cache keys come from session id/options and do not include prompt text; cache keys must remain caller/session identifiers, never credentials or raw prompts.
      - Cache diagnostics can be derived from numeric `Usage` and optional pricing only; they should not include prompt text, cache keys, headers, provider payloads, credentials, or resource contents.
      - Redaction is unchanged: runtime redacts current input before instruction injectors and redacts ledger records/events through existing `redact*` helpers.
      - Provider auth/header ownership remains provider-package behavior; ordering and diagnostics must not mutate headers.
    - References:
      - `src/input.ts` currently orders default input as instructions → summaries → history → current input → attachments/resources → tool results.
      - `createDefaultPromptBuilder()` currently prepends context, skills, and tools before input-builder messages.
      - `src/contracts.ts` `Usage` already has `cacheReadTokens` and `cacheWriteTokens`.
      - `src/cache-helpers.ts` already exports `cacheHitRate()` and `cacheSavings()`.
  - Test Cases to Write:
    - Inventory-only task; no product test required. Following tasks list exact unit/docs/runtime tests for layout surface, cache-aware ordering, diagnostics, docs, and final verification.
  - Verification:
    - Source inventory verified by reading `src/input.ts`, `src/agents.ts`, `src/cache-helpers.ts`, `src/contracts.ts`, and targeted test/doc files.
    - Targeted `rg` verification covered `appendUsage`, `UsageRecord`, `cacheReadTokens`, `cacheWriteTokens`, `redactRunLedgerRecord`, `input_assembly`, and `prompt_build` occurrences across `src/`, `docs/`, and this plan.
    - No runtime/source files changed; only this plan task was updated and marked complete.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit:
      - `none`: later tasks own docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add opt-in cache-aware input layout surface
  - Acceptance Criteria:
    - Functional: Add a public layout option (for example `InputAssemblyLayout = "legacy" | "cache_aware"`) selectable through `DefaultInputBuildContext`, `AssembleProviderInputOptions`, `AgentConfig`, and `RunOptions`. Legacy remains default everywhere. `RunOptions` wins over `AgentConfig`.
    - Performance: Layout selection is one branch and one pass over existing message groups; no provider calls, tokenization, hashing, or new dependency.
    - Code Quality: Reuse `createDefaultInputBuilder()` and `assembleProviderInput()`; do not fork a new cache builder. New types are exported from the root barrel through existing exports or one explicit export.
    - Security: Layout option cannot grant tools, bypass permissions, load resources without `ResourceLoader`, or change redaction behavior.
  - Approach:
    - Documentation Reviewed:
      - `src/input.ts` `DefaultInputBuildContext`, `AssembleProviderInputOptions`, `createDefaultInputBuilder()`.
      - `src/contracts.ts` `AgentConfig` and `RunOptions` patterns (`validate`, `instructionInjectors`, `loop` use RunOptions override semantics).
      - `docs/input-and-prompt-assembly.md` default behavior section.
    - Options Considered:
      - Put the option only on `ProviderRequestOptions.cache`: wrong layer; provider options should not rewrite input messages.
      - Put the option only on `createDefaultInputBuilder()`: direct helper works, but runtime users cannot opt in per run.
      - Add a small layout field to direct assembly plus agent/run config: chosen; matches existing config-over-code pattern.
    - Chosen Approach:
      - Added public `InputAssemblyLayout = "legacy" | "cache_aware"` and `inputLayout?` on `InputBuildContext`, `RunOptions`, and `AgentConfig`; `DefaultInputBuildContext` and `AssembleProviderInputOptions` inherit it.
      - Plumbed `options.inputLayout ?? this.agent.config.inputLayout` from runtime into `assembleProviderInput()`, so `RunOptions` wins over `AgentConfig`.
      - Refactored the default input builder into named message groups and a single layout branch; legacy remains the default and current order is preserved. Cache-aware ordering semantics are left to the next task.
      - Kept custom `InputBuilder`s untouched; they receive `context.inputLayout` but are not forced to reorder.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({ model, provider, inputLayout: "cache_aware" });
      await agent.createSession().run("What changed?", { inputLayout: "legacy" });

      const request = await assembleProviderInput({
        model,
        input: "Question",
        inputLayout: "cache_aware",
      });
      ```
    - Files Created/Edited:
      - `src/contracts.ts`: added `InputAssemblyLayout`, `InputBuildContext.inputLayout?`, `AgentConfig.inputLayout?`, and `RunOptions.inputLayout?`.
      - `src/input.ts`: grouped default input messages and added `flattenInputGroups(..., context.inputLayout ?? "legacy")` layout branch.
      - `src/agents.ts`: passes `options.inputLayout ?? this.agent.config.inputLayout` into provider input assembly.
      - `src/index.ts`: no edit needed; `export type * from "./contracts.js"` already exports `InputAssemblyLayout`.
      - `src/__tests__/public-contracts.test.ts`: added type fixtures for `InputAssemblyLayout`, config/run fields, and direct assembly option.
      - `src/__tests__/input-pipeline.test.ts`: added legacy-default and cache-aware-option default-builder tests.
      - `src/__tests__/agents.test.ts`: added runtime propagation/override test with custom builder capture.
      - `docs/input-and-prompt-assembly.md`: documented `inputLayout` and legacy default.
      - `docs/agent-session-runtime.md`: documented `AgentConfig`/`RunOptions` override.
      - `docs/public-contracts.md`: listed new type/fields.
    - References:
      - Existing override precedence in `src/agents.ts`: `options.instructionInjectors ?? this.agent.config.instructionInjectors`, `options.loop` over config, `options.validate` over config.
      - `docs/agent-session-runtime.md` documents runtime use of `assembleProviderInput()` each turn.
  - Test Cases Written:
    - `run inputLayout overrides agent inputLayout and reaches custom input builders`: provider captures `"cache_aware"` from agent config, then `"legacy"` from run override.
    - `keeps legacy layout as the default`: no layout set produces current summary/history/current-input/attachment order.
    - `accepts cache-aware layout without replacing the default builder`: default builder accepts the option directly.
    - Public contract fixtures type-check `InputAssemblyLayout`, `DefaultInputBuildContext.inputLayout`, `AssembleProviderInputOptions.inputLayout`, `AgentConfig.inputLayout`, and `RunOptions.inputLayout`.
  - Verification:
    - `npm run build:core` passed.
    - `node --test dist/__tests__/input-pipeline.test.js dist/__tests__/agents.test.js dist/__tests__/public-contracts.test.js dist/__tests__/docs.test.js` passed.
    - Audited acceptance criteria: public option exists through all requested surfaces, legacy remains default, runtime run override wins, no new dependency/provider call/tokenization/hashing was added, no new cache builder was added, and resource loading/tool permissions/redaction paths are unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; adds a public configuration surface and opt-in behavior.
    - Docs pages edited:
      - `docs/input-and-prompt-assembly.md`: documents `inputLayout` and legacy default.
      - `docs/agent-session-runtime.md`: documents `AgentConfig`/`RunOptions` override.
      - `docs/public-contracts.md`: lists new type/fields.
    - `docs/index.md` update: no new page; existing `Input and prompt assembly` and `Agent/session runtime` entries remain valid.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement cache-aware default ordering with stable-prefix conformance
  - Acceptance Criteria:
    - Functional: In cache-aware mode, default provider messages place stable instructions, tool declarations, context/resources/attachments, summaries, and prior history before the current user turn. Legacy mode preserves current ordering. Tool-call/tool-result transcript order stays provider-valid and is not moved behind unrelated user suffixes.
    - Performance: Reordering uses grouped arrays already built by the default builder/prompt builder; no deep cloning beyond existing message object creation.
    - Code Quality: Keep logic boring and local to `src/input.ts`; add a tiny helper only if it avoids duplicated grouping. No provider-name branches.
    - Security: Reordering does not change resource permission/load path, middleware execution order, redaction, or tool permissions.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md` current output order.
      - `docs/provider-caching.md` breakpoint locations (`system_prompt`, `tools`, `stable_context`, `last_stable_message`, `last_user_message`).
      - `src/__tests__/input-pipeline.test.ts` order tests.
      - `src/__tests__/provider-conformance.test.ts` tool-call/tool-result ordering expectations.
    - Options Considered:
      - Make prompt builder reorder all messages after assembly: harder to preserve tool transcripts because message origins are lost.
      - Group messages inside the default input builder before flattening: chosen; origin groups are still explicit.
      - Add metadata to every message origin and sort later: more code and leaks implementation detail; rejected.
    - Chosen Approach:
      - Built named groups (`instructions`, `summaries`, `history`, `input`, `attachments`, `toolResults`) once in the default input builder. Legacy flattens exactly as before: instructions → summaries → history → current input → attachments/resources → tool results.
      - Cache-aware now flattens stable groups before the current user suffix: instructions → attachments/resources → summaries → history → tool results → current input.
      - Kept pending tool results immediately after prior history and before current input, preserving assistant `tool_call` → role `tool` `tool_result` transcript order.
      - Left `contextMessages()`, `skillMessages()`, and `toolMessages()` ahead of request messages because they are already stable prompt prefix material.
    - API Notes and Examples:
      ```ts
      const messages = await createDefaultInputBuilder().build("Question", {
        inputLayout: "cache_aware",
        attachments: [{ name: "schema.md", text: "stable schema" }],
      });
      // attachment/resource message appears before the current "Question" user turn.
      ```
    - Files Created/Edited:
      - `src/input.ts`: implemented cache-aware grouped flattening while preserving legacy order.
      - `src/__tests__/input-pipeline.test.ts`: added cache-aware attachment/resource ordering, stable-prefix provider payload, and tool transcript validity tests.
      - `docs/input-and-prompt-assembly.md`: documented exact legacy/cache-aware orders, prompt-prefix behavior, transcript safety, and linear flattening.
      - `docs/provider-caching.md`: cross-referenced cache-aware stable-prefix layout and ResourceLoader safety.
      - `docs/provider-conformance.md`: noted cache-aware layout preserves provider-valid tool transcripts.
    - References:
      - Roadmap Phase 43 requires attachments/resources before current input for cache-aware mode and no behavior change for legacy mode.
      - Roadmap Phase 43 requires same static prefix + different user suffix to produce byte-stable provider payload prefix.
  - Test Cases Written:
    - `cache-aware layout puts stable attachments resources summaries and history before current input`: verifies attachment/resource messages load through `ResourceLoader` and precede current input.
    - `keeps legacy layout as the default`: verifies unchanged current-input-before-attachments legacy behavior.
    - `cache-aware provider input has byte-stable prefix for different current user turns`: serializes provider messages before the current user suffix and compares them across different inputs.
    - `cache-aware layout keeps tool results adjacent to prior tool calls before current input`: verifies assistant tool call remains immediately before matching tool result and before current user suffix.
  - Verification:
    - `npm run build:core` passed.
    - `node --test dist/__tests__/input-pipeline.test.js dist/__tests__/agents.test.js dist/__tests__/provider-conformance.test.js dist/__tests__/docs.test.js` passed.
    - Audited acceptance criteria: cache-aware mode moves attachments/resources, summaries, prior history, and tool results before current input; legacy order remains unchanged; prompt builder still prepends context/skills/tools; implementation is local to `src/input.ts`, one grouped flattening branch, no provider-name branches, no dependency, no tokenization/hashing/provider calls, and existing ResourceLoader/redaction/tool permission paths are unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; opt-in default builder behavior changes message order.
    - Docs pages edited:
      - `docs/input-and-prompt-assembly.md`: describes exact legacy and cache-aware orders.
      - `docs/provider-caching.md`: cross-references stable-prefix layout and breakpoint selection.
      - `docs/provider-conformance.md`: mentions transcript order remains provider-valid.
    - `docs/index.md` update: no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add cache usage diagnostics/reporting helper
  - Acceptance Criteria:
    - Functional: Add a small exported helper (for example `cacheUsageReport(usage, model?)`) that reports normalized `cacheReadTokens`, `cacheWriteTokens`, hit rate, and estimated savings/currency when pricing is available. It works when a provider reports only read tokens and no write tokens.
    - Performance: Helper is O(1), pure, allocation limited to one return object, no network/provider calls.
    - Code Quality: Reuse existing `cacheHitRate()` and `cacheSavings()`; avoid adding another pricing system. Return `undefined` for unavailable values instead of guessing.
    - Security: Report contains usage numbers and optional pricing only; no prompts, cache keys, headers, credentials, or raw provider payloads.
  - Approach:
    - Documentation Reviewed:
      - `src/cache-helpers.ts` `cacheHitRate()` and `cacheSavings()`.
      - `src/contracts.ts` `Usage` and `ModelCost`.
      - `docs/provider-caching.md` helper table.
      - `docs/runs-and-usage.md` `UsageRecord` shape.
    - Options Considered:
      - Extend `Usage` with provider-specific diagnostics now: too broad; first-party provider hardening can add metadata only when needed.
      - Add one report helper derived from existing normalized fields: chosen; satisfies common reporting without schema churn.
      - Emit new runtime events for cache diagnostics: unnecessary; usage events and run ledger already carry `Usage`.
    - Chosen Approach:
      - Added exported `CacheUsageReport` and `cacheUsageReport(usage, model?)` in `src/cache-helpers.ts`.
      - Report includes `cacheReadTokens`, `cacheWriteTokens`, `hitRate`, `estimatedSavings`, and `currency` when available.
      - Missing read/write token counts normalize to `0`; unavailable hit rate/savings/currency stay `undefined`.
      - Helper returns `undefined` when no `Usage` is supplied and keeps provider-specific metadata out.
      - Reused existing `cacheHitRate()` and `cacheSavings()`; no new pricing system, runtime event, dependency, provider call, tokenization, or hashing.
    - API Notes and Examples:
      ```ts
      import { cacheUsageReport } from "@arnilo/prism";

      const report = cacheUsageReport(
        { inputTokens: 1000, cacheReadTokens: 750 },
        { provider: "demo", model: "large", cost: { input: 3, cacheRead: 0.3, unit: "1m", currency: "USD" } },
      );
      // { cacheReadTokens: 750, cacheWriteTokens: 0, hitRate: 0.75, estimatedSavings: 0.002025, currency: "USD" }
      ```
    - Files Created/Edited:
      - `src/cache-helpers.ts`: added report type/helper.
      - `src/index.ts`: exported helper/type.
      - `src/__tests__/cache-helpers.test.ts`: added read-only provider, priced savings/currency, and undefined-usage tests.
      - `src/__tests__/public-contracts.test.ts`: added root-export type/value contract test.
      - `src/__tests__/docs.test.ts`: added docs wording regression for diagnostics helper.
      - `docs/provider-caching.md`: documented diagnostics helper.
      - `docs/runs-and-usage.md`: showed run/usage reporting example and numeric-only safety note.
      - `docs/public-contracts.md`: listed helper/type export.
    - References:
      - Roadmap Phase 43 acceptance: diagnostics work from normalized `Usage` fields even when provider only reports reads.
      - `docs/runs-and-usage.md` already documents `appendUsage` and `UsageRecord`.
  - Test Cases Written:
    - `reports cache usage for read-only provider accounting`: read tokens set, write tokens missing, hit rate computed, write defaults to `0`.
    - `reports cache savings and currency from model pricing`: uses `cacheSavings()` and carries model cost currency.
    - `cacheUsageReport(undefined)`: returns `undefined` without throwing or guessing.
    - `host can type cache usage diagnostics helper`: validates root value/type exports.
  - Verification:
    - `npm run build:core` passed.
    - `node --test dist/__tests__/cache-helpers.test.js dist/__tests__/public-contracts.test.js dist/__tests__/docs.test.js dist/__tests__/agents.test.js` passed.
    - Audited acceptance criteria: helper reports normalized read/write tokens, supports read-only providers, returns unavailable fields as `undefined`, estimates savings only through existing pricing helper, allocates one plain report object, performs no provider/network I/O, and includes no prompt/cache-key/header/credential/provider-payload data.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new exported helper/report type.
    - Docs pages edited:
      - `docs/provider-caching.md`: documents diagnostics helper.
      - `docs/runs-and-usage.md`: shows run/usage reporting example.
      - `docs/public-contracts.md`: lists helper/type export.
    - `docs/index.md` update: no new page; existing `Provider caching` and `Runs and usage ledger` entries remain valid.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Update docs and docs tests for cache-aware ordering
  - Acceptance Criteria:
    - Functional: Update `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/runs-and-usage.md`, and `docs/index.md` if navigation text needs cache-aware wording. Docs include opt-in examples, legacy default warning, stable-prefix caveat, transcript-order safety, and diagnostics reporting.
    - Performance: Docs/tests remain static file checks only.
    - Code Quality: Docs examples use actual exported type/function names from implementation; no invented API names remain.
    - Security: Docs state cache keys must not be secrets, resource loading remains host-controlled, and diagnostics must not include prompt text or credentials.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure.
      - `docs/api-page-template.md`.
      - `src/__tests__/docs.test.ts` API page/link/wording tests.
    - Options Considered:
      - Add a new docs page only for cache-aware ordering: unnecessary; input assembly and provider caching pages already cover the surface.
      - Update existing pages and docs tests: chosen.
    - Chosen Approach:
      - Extended existing API pages with a legacy-vs-cache-aware ordering table, stable-prefix caveat, transcript-order safety wording, and cache diagnostics references.
      - Updated docs index descriptions for input assembly, provider caching, and runs/usage rather than adding a new page.
      - Added one targeted static docs regression test instead of broad snapshots.
    - API Notes and Examples:
      ```ts
      await session.run("Explain this", { inputLayout: "cache_aware" });
      const diagnostics = cacheUsageReport(usage, model);
      ```
    - Files Created/Edited:
      - `docs/input-and-prompt-assembly.md`: layout option, ordering table, opt-in examples, stable-prefix caveat, transcript safety, ResourceLoader safety.
      - `docs/provider-caching.md`: stable-prefix caveat, opt-in example, diagnostics notes, no-guaranteed-hits wording.
      - `docs/runs-and-usage.md`: cache report example from `UsageRecord.usage` and numeric-only safety note.
      - `docs/index.md`: updated existing navigation descriptions for cache-aware ordering/diagnostics.
      - `docs/public-contracts.md`: new public type/helper rows from diagnostics helper task.
      - `src/__tests__/docs.test.ts`: added cache-aware ordering/diagnostics wording regression.
    - References:
      - Prism wiki requires docs for public behavior/config changes and index coverage for API pages.
  - Test Cases Written:
    - `phase43 cache-aware ordering docs cover opt-in safety and diagnostics`: checks legacy default, `cache_aware` opt-in, ordering table fragments, byte-stable caveat, transcript safety, ResourceLoader safety, no guaranteed cache hits, cache-key secret warning, and numeric-only diagnostics wording.
    - Local link checker continues to cover `input-and-prompt-assembly.md`, `provider-caching.md`, and `runs-and-usage.md` links from `docs/index.md`.
  - Verification:
    - `npm run build:core` passed.
    - `node --test dist/__tests__/docs.test.js` passed.
    - Audited acceptance criteria: docs include opt-in examples, legacy default warning, stable-prefix caveat, transcript-order safety, diagnostics reporting, secret/cache-key warnings, host-controlled ResourceLoader boundary, actual exported API names (`InputAssemblyLayout`, `cacheUsageReport`, `inputLayout`), and static-only docs tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; docs delivery for new behavior and helper.
    - Docs pages edited:
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/runs-and-usage.md`, `docs/public-contracts.md`, `docs/index.md`.
    - `docs/index.md` update: yes; updated existing entries for input assembly, provider caching, and runs/usage.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification and release-safety checks
  - Acceptance Criteria:
    - Functional: All new public types/helpers are exported; cache-aware mode passes ordering/conformance tests; legacy mode remains unchanged; runtime config/run overrides work.
    - Performance: `npm test` remains network-free and within the documented `< 60s` budget; stable-prefix fixture is deterministic and cheap.
    - Code Quality: `npm run typecheck` and `npm test` pass; no new dependency; no provider-specific ordering logic in core.
    - Security: No docs include real secrets; cache diagnostics expose only usage/pricing numbers; redaction and resource-loading boundaries unchanged.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` default test budget.
      - `roadmap.md` Phase 17 release-test budget text.
      - Updated docs pages after implementation.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add a new npm script: unnecessary; existing typecheck/test flow is enough.
      - Run targeted tests only: insufficient for public API/docs change; full checks were run.
      - Keep the stale `< 30s` budget wording: rejected after full-suite timing drift was found; docs and roadmap now pin `< 60s` with rationale, while this final run completed in 25.30s.
    - Chosen Approach:
      - Used existing full verification: `npm run typecheck` and `npm test`.
      - Audited exports, provider-specific core literals, dependency diffs, docs safety wording, and secret-looking docs content after full checks passed.
    - API Notes and Examples:
      ```sh
      npm run typecheck
      npm test
      ```
    - Files Created/Edited:
      - `plans/044-cache-aware-input-ordering-and-diagnostics.md`: marked final task complete and recorded final verification.
      - `docs/release-and-install.md`: adjusted offline test budget wording to `< 60s` with measured baseline/rationale.
      - `roadmap.md`: adjusted Phase 17 release-test budget wording to match docs.
    - References:
      - `docs/release-and-install.md` pins network-free default tests and timing budget.
      - `src/__tests__/phase12-boundaries.test.ts` continues to guard provider-specific core literals.
  - Test Cases Run:
    - `npm run typecheck` passed.
    - `/usr/bin/time -f 'elapsed_seconds:%e' npm test` passed; elapsed wall time was `25.30s` on this run.
    - Targeted task suites were also run during earlier tasks: `input-pipeline`, `cache-helpers`, `agents`, `docs`, `public-contracts`, and provider conformance tests.
  - Verification:
    - Public exports audited with `rg`: `InputAssemblyLayout`, `inputLayout`, `CacheUsageReport`, and `cacheUsageReport` appear in source contracts/root exports and built `dist/index.*` output.
    - Ordering/runtime behavior audited through passing tests: cache-aware attachment/resource ordering, byte-stable provider-prefix fixture, tool-call/tool-result adjacency, legacy-default order, and run-over-agent `inputLayout` override.
    - Dependency audit: `git diff -- package.json package-lock.json pnpm-lock.yaml yarn.lock` showed no dependency/lockfile changes.
    - Provider-specific core audit: `rg` over `src/input.ts`, `src/agents.ts`, `src/cache-helpers.ts`, and `src/contracts.ts` found no provider-name ordering branches beyond generic `PromptCacheKind` literals already allowed by Phase 42.
    - Security audit: docs scan found no secret-looking key patterns; cache diagnostics docs and helper remain numeric-only; ResourceLoader/redaction/tool-permission paths were not changed by final verification.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior in this task; verification plus release-budget wording alignment only.
    - Docs pages edited:
      - `docs/release-and-install.md`: updated offline test budget to match measured full-suite scope.
      - `roadmap.md`: updated Phase 17 budget references to match docs.
    - `docs/index.md` update: no additional update beyond docs task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Release-test budget wording was raised from `< 30s` to `< 60s` in `docs/release-and-install.md` and `roadmap.md` because the default suite now includes first-party workspace builds/tests, packaging guards, offline install smoke, docs examples, and package boundary checks. Current final run still completed in `25.30s`; the higher budget prevents CI-doc drift on slower Node 20 machines.

## Further Actions
- Keep the default suite under `< 60s`; if median time approaches the budget, optimize packaging/install smoke checks before raising it again.
