# Phase 8 — Compaction Strategies and Retry Policy

## Objectives
- Add replaceable compaction and retry policies without hidden provider, credential, store, extension, or settings globals.
- Provide a deterministic default compaction strategy that records branch summaries while preserving raw session entries.
- Add manual and opt-in auto-compaction to `AgentSession` so provider input can use summaries plus recent context.
- Add a bounded retry/backoff policy for transient provider failures with abort-aware waits.
- Document every new public API, extension point, event behavior, and manifest contribution under `/docs` as it lands.

## Expected Outcome
- Root exports include default compaction and retry helpers plus small option/context/result types.
- `AgentSession.compact()` appends compaction/summary data to the current branch without deleting raw history.
- Optional auto-compaction runs before provider input when host/run compaction thresholds are exceeded.
- Provider turns can retry transient failures according to a host-replaceable `RetryPolicy`, emitting `retry_scheduled` events and honoring abort.
- Extension middleware can observe/transform compaction and retry payloads; extensions can register retry policies and compaction strategies.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing primitives and lock the minimal Phase 8 surface
  - Acceptance Criteria:
    - Functional: Existing `CompactionStrategy`, `CompactionContext`, `CompactionResult`, `SessionEntry` summary/compaction kinds, branch helpers, `AgentSession`, `RunOptions`, `AgentEvent` compaction/retry variants, contribution registries, extension APIs, middleware hooks, docs, and Phase 8 roadmap requirements are inventoried; the task records the smallest generic additions needed for default compaction, manual/auto compaction, retry policy, and extension hooks.
    - Performance: Inventory adds no runtime code, dependency, provider call, filesystem access, network call, timer, watcher, queue worker, retry loop, or test slowdown.
    - Code Quality: The locked surface rejects vector memory, provider-backed summarization, deletion/rewrite of raw history, database/index changes, CLI/RPC commands, background schedulers, and provider-specific retry adapters.
    - Security: Design keeps credentials outside compaction/retry contexts, does not serialize provider requests or resolved credentials, redacts known secrets from summaries/errors, and keeps retry classification fail-closed for aborts and non-transient errors.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 8 and non-negotiable boundaries: host controlled, defaults replaceable, secrets never enter history/events, docs ship with APIs.
      - `plans/010-session-store-jsonl-branching.md` closeout: Phase 7 added branch-aware entries, memory/JSONL stores, summary/compaction entry kinds, and explicitly deferred compaction/retry behavior.
      - `src/contracts.ts` `AgentConfig`, `RunOptions`, `AgentSession`, `AgentEvent`, `SessionEntry`, `SessionStore`, `CompactionStrategy`, `CompactionContext`, `CompactionResult`, `ExtensionAPI`, and `ExtensionLifecycleEventName`.
      - `src/agents.ts` current store-backed runtime, leaf handling, provider loop, abort bridge, tool loop, and current lack of compaction/retry.
      - `src/session-stores.ts` `createSessionEntry()`, `getSessionBranchEntries()`, `listSessionBranches()`, `rebuildSessionContext()`, and memory store behavior.
      - `src/contributions.ts`, `src/extensions.ts`, `src/middleware.ts`, and `src/manifests.ts` for strategy registration, extension middleware, and manifest contribution kinds.
      - `src/redaction.ts`, `docs/credentials-and-redaction.md`, and `docs/session-stores-and-branching.md` for secret and store-entry boundaries.
      - `docs/agent-session-runtime.md`, `docs/middleware-hooks.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/configuration-and-manifests.md`, `docs/public-contracts.md`, `docs/index.md`, and `docs/api-page-template.md`.
      - `node_modules/@types/node/timers/promises.d.ts`: `setTimeout(delay, value, options?: TimerOptions): Promise<T>` for abort-aware retry sleep.
      - `node_modules/@types/node/timers.d.ts`: `TimerOptions` supports `signal` and `ref?: false` so retry timers need not keep Node alive.
      - Existing `src/__tests__/*.test.ts` style: `node:test`, `node:assert/strict`, temporary files only where needed, no network.
      - `package.json` scripts and `tsconfig.json` strict `NodeNext`/declaration settings.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - Project pattern/wiki directories: none present under `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/`.
    - Options Considered:
      - Add a vector store or long-term memory API: rejected; Phase 8 only needs session-branch summaries and retry policy.
      - Delete or rewrite old session entries during compaction: rejected; roadmap says raw history should not be deleted by default.
      - Call the current provider to summarize by default: rejected; provider-backed summarization should be a host strategy, not a hidden extra provider turn.
      - Retry every provider error: rejected; aborts, validation errors, unknown providers, tool errors, and post-output provider failures should not be retried by default.
      - Add a global retry/compaction registry lookup in runtime: rejected; hosts/extensions may register strategies, but runtime uses only explicit agent/run config.
    - Chosen Approach:
      - Add one generic compaction helper module, tentatively `src/compaction.ts`, with `createDefaultCompactionStrategy()` and small data helpers for compaction entries.
      - Update branch context rebuild so compaction entries summarize older branch entries while raw entries remain stored.
      - Add `AgentSession.compact(options?)` and opt-in auto-compaction via explicit agent/run compaction options.
      - Add one generic retry helper module, tentatively `src/retry.ts`, with `RetryPolicy`, `createDefaultRetryPolicy()`, and transient-error classification.
      - Use `node:timers/promises` only for abort-aware retry sleeps; no dependency, scheduler, queue, or worker.
      - Add a retry-policy contribution registry/API/manifest kind so extensions can register policies; hosts still explicitly pass the selected policy to runtime.
    - API Notes and Examples:
      ```ts
      import { createDefaultCompactionStrategy, createDefaultRetryPolicy, createAgent } from "prism";

      const agent = createAgent({
        model,
        provider,
        compaction: { strategy: createDefaultCompactionStrategy(), thresholdEntries: 40, keepRecentEntries: 10 },
        retry: { policy: createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 100 }) },
      });
      ```
    - Files to Create/Edit:
      - `plans/011-compaction-strategies-and-retry.md`: record inventory and locked API before implementation.
      - Expected later files: `src/contracts.ts`, `src/compaction.ts`, `src/retry.ts`, `src/session-stores.ts`, `src/agents.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/manifests.ts`, `src/redaction.ts`, `src/index.ts`, `src/__tests__/compaction.test.ts`, `src/__tests__/retry.test.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/config-manifests.test.ts`, `src/__tests__/docs.test.ts`, `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/session-stores-and-branching.md`, `docs/middleware-hooks.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/configuration-and-manifests.md`, `docs/public-contracts.md`, `docs/credentials-and-redaction.md` if redaction guidance changes, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 8 deliverables and acceptance.
      - `plans/010-session-store-jsonl-branching.md` further action: Phase 8 compaction/retry on existing summary/compaction entry support.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Inventory Result / Locked Surface:
      - Reuse as-is: `SessionStore.append/list/get`, branch entry ids/parents, `createSessionEntry()`, `getSessionBranchEntries()`, `rebuildSessionContext()`, `CompactionStrategy`, `CompactionContext`, `CompactionResult`, `AgentEvent.compaction_started`, `AgentEvent.compaction_finished`, `AgentEvent.retry_scheduled`, middleware hook names `compaction` and `retry`, compaction strategy contribution registry, extension event names `compaction` and `retry`, and docs/export checks.
      - Add only small public option/context types: `CompactionOptions`, `CompactionEntryData`, `DefaultCompactionStrategyOptions`, `RetryPolicy`, `RetryContext`, `RetryDecision`, `RetryOptions`, and `DefaultRetryPolicyOptions`.
      - Add `AgentConfig.compaction?: false | CompactionOptions`, `RunOptions.compaction?: false | CompactionOptions`, `AgentConfig.retry?: false | RetryOptions`, `RunOptions.retry?: false | RetryOptions`, and `AgentSession.compact(options?)`.
      - Keep auto-compaction opt-in: no runtime compaction runs unless agent/run config requests it; manual `session.compact()` may use the default strategy.
      - Keep retry opt-in or default-bounded only when configured; retry never applies to aborts, missing providers, tool dispatch failures, unknown tools, validation failures, or provider failures after observable output has been emitted.
      - Standard compaction entries store `summary` plus data such as `throughEntryId`, `keepEntryIds`, `strategy`, and `trigger`; raw branch entries are never removed.
      - Extension hooks are middleware payloads at `compaction` and `retry`; extension registration remains inert until a host passes the selected middleware/strategies/policies into an agent.
      - Explicitly rejected for Phase 8: vector memory, semantic retrieval, provider-backed default summarization, global registries, app tools, CLI/RPC compact commands, background maintenance, cross-process locks, JSONL compaction/rewrite, and new dependencies.
  - Test Cases to Write:
    - None for this inventory-only plan edit; no source or docs API files changed.
    - Source/docs validation intentionally not run; task changed only this plan and added no runtime code.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document public APIs and runtime behavior they add.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add default compaction strategy and compaction-aware branch context
  - Acceptance Criteria:
    - Functional: `createDefaultCompactionStrategy()` returns a `CompactionStrategy` that summarizes older current-branch entries, records a `throughEntryId`, preserves a configurable number of recent message entries, truncates summary output to a configured maximum, and redacts known secret strings; `rebuildSessionContext()` returns provider context with compaction summaries plus recent messages while `entries` still contains the raw branch path.
    - Performance: Default compaction is O(n) over current-branch entries, uses arrays/maps/string slicing only, performs no provider/tool/resource/filesystem/network calls, and adds no dependency.
    - Code Quality: Compaction helpers are pure and deterministic with injectable limits; strategy output uses typed data instead of ad hoc metadata; existing no-compaction rebuild behavior remains unchanged for branches without compaction entries.
    - Security: Default summaries exclude metadata, provider requests, provider objects, credential resolvers, resolved credentials, settings, and full tool values by default; known secret strings are redacted before summary text can be appended or emitted.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `CompactionStrategy`, `CompactionContext`, `CompactionResult`, `SessionEntry`, `Message`, and `ContentBlock`.
      - `src/session-stores.ts` branch helper and context rebuild behavior.
      - `src/redaction.ts` `redactSecrets()` and `errorToErrorInfo()`.
      - `docs/session-stores-and-branching.md` summary/compaction entry semantics.
      - `docs/input-and-prompt-assembly.md` summary messages consumed by default provider input assembly.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Store a generated summary as a plain `summary` entry only: rejected; a `compaction` entry needs boundary data so provider context knows which raw messages are summarized.
      - Change `SessionStore` to hide compacted entries: rejected; stores should remain append/list/get only and raw history must stay available.
      - Summarize every content block verbatim: rejected; tool values/images/metadata can be large or sensitive, so default summary should use conservative text/tool-call labels and redaction.
      - Add token counting: rejected; there is no tokenizer dependency, and entry/count/character thresholds are enough for the default.
    - Chosen Approach:
      - Create `src/compaction.ts` with `createDefaultCompactionStrategy(options?)`, `isCompactionEntryData()`, and a tiny text extractor for user/assistant/tool messages.
      - Standardize `CompactionEntryData` with `throughEntryId`, `keepEntryIds`, `strategy`, and `trigger` fields stored in `SessionEntry.data`.
      - Update `rebuildSessionContext()` to detect the latest valid compaction entry on a branch: include its summary, include later summary entries, and include message entries after `throughEntryId` plus any `keepEntryIds`; do not mutate or filter `entries`.
      - Kept existing behavior for branches with no valid compaction entry; malformed compaction `data` is ignored for now rather than making old/custom entries unreadable.
    - API Notes and Examples:
      ```ts
      const strategy = createDefaultCompactionStrategy({ maxSummaryChars: 2000 });
      const result = await strategy.compact({ sessionId: "s1", entries, keepRecentEntries: 4, trigger: "manual" });
      const snapshot = rebuildSessionContext([...entries, compactionEntry], { leafId: compactionEntry.id });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: added `CompactionEntryData` and extended `CompactionContext` with optional `trigger`, `keepRecentEntries`, and `secrets`.
      - `src/compaction.ts`: implemented `createDefaultCompactionStrategy()`, `DefaultCompactionStrategyOptions`, `isCompactionEntryData()`, conservative text extraction, truncation, and redaction.
      - `src/session-stores.ts`: made `rebuildSessionContext()` compaction-aware while preserving raw `entries`.
      - `src/index.ts`: exported compaction helpers and option/data types.
      - `src/__tests__/compaction.test.ts`: added default strategy and rebuild tests.
      - `src/__tests__/session-stores.test.ts`: no change; compaction rebuild coverage lives in `src/__tests__/compaction.test.ts`.
      - `src/__tests__/public-contracts.test.ts`: added compile/runtime coverage for new compaction exports.
      - `docs/compaction-and-retry.md`: created detailed API page for compaction strategy and branch context behavior.
      - `docs/session-stores-and-branching.md`: documented compaction entry boundary semantics.
      - `docs/input-and-prompt-assembly.md`: noted that compacted summaries flow into default summary messages.
      - `docs/public-contracts.md`: updated compaction contract inventory and related APIs.
      - `docs/index.md`: added the compaction/retry page under Compaction/session memory.
      - `src/__tests__/docs.test.ts`: added docs/export checks.
    - References:
      - `roadmap.md` Phase 8 deliverables: compaction strategy contract/default and branch-summary entries without deleting raw history.
      - `plans/010-session-store-jsonl-branching.md` locked branch/store helper behavior.
  - Test Cases to Write:
    - `default_compaction_strategy_summarizes_old_entries_and_keeps_recent_ids`: validates summary, `throughEntryId`, `keepEntryIds`, and truncation. Implemented in `src/__tests__/compaction.test.ts`.
    - `default_compaction_strategy_redacts_known_secret_strings`: validates summaries do not contain passed known secrets. Implemented in `src/__tests__/compaction.test.ts`.
    - `rebuild_session_context_uses_latest_compaction_summary_and_recent_messages`: validates provider context is summary plus recent messages while raw branch entries remain in `snapshot.entries`. Implemented in `src/__tests__/compaction.test.ts`.
    - `rebuild_session_context_without_compaction_is_unchanged`: validates existing Phase 7 behavior remains intact. Implemented in `src/__tests__/compaction.test.ts`.
    - `public_contracts_cover_default_compaction_strategy`: validates root exports and type shape. Implemented in `src/__tests__/public-contracts.test.ts`.
    - `docs_reference_existing_compaction_exports`: validates docs reference exported compaction APIs. Implemented in `src/__tests__/docs.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed with 162 tests, 30 suites, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds root compaction helpers/types and changes documented provider-context rebuild behavior for branches with compaction entries.
    - Docs pages to create/edit:
      - `docs/compaction-and-retry.md`: create detailed API page for `createDefaultCompactionStrategy()`, compaction options/data, and context rebuild behavior.
      - `docs/session-stores-and-branching.md`: update `rebuildSessionContext()` and `SessionEntry.kind === "compaction"` semantics.
      - `docs/input-and-prompt-assembly.md`: note compacted summaries flow into default summary messages.
      - `docs/public-contracts.md`: update compaction contract inventory and examples.
    - `docs/index.md` update: Yes; add `Compaction and retry policies - Summarize branch history and retry transient provider failures with host-replaceable policies` under Compaction/session memory.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Wire manual and opt-in auto-compaction into `AgentSession`
  - Acceptance Criteria:
    - Functional: `session.compact(options?)` runs the selected/default compaction strategy on the current branch, appends a compaction entry under the current leaf, updates the leaf to that entry, emits `compaction_started` and `compaction_finished`, and returns the strategy result; auto-compaction runs before provider input only when agent/run compaction options are enabled and threshold criteria are met.
    - Performance: Runtime performs at most one auto-compaction check per run before provider streaming, uses no background worker/timer/watcher, and does not add provider turns or tool calls.
    - Code Quality: Runtime reuses `createSessionEntry()`, `getSessionBranchEntries()`, `rebuildSessionContext()`, the selected `CompactionStrategy`, and existing store append behavior; manual and auto paths share one helper; no CLI/RPC command or JSONL rewrite is added.
    - Security: Compaction context excludes provider objects, provider requests, credential resolvers, resolved credentials, settings providers, and hidden metadata; emitted summary/event/store text is redacted for known secrets passed in compaction options.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` current `RuntimeAgentSession` store selection, `currentLeafId`, run flow, provider assembly, subscriber events, abort bridge, and `snapshot()`.
      - `src/session-stores.ts` branch helpers and compaction-aware context from the prior task.
      - `src/middleware.ts` existing `compaction` hook name and middleware error behavior.
      - `src/extensions.ts` extension middleware registration through `ExtensionAPI.use()`.
      - `docs/agent-session-runtime.md`, `docs/middleware-hooks.md`, and `docs/extensions.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Auto-compact after every run by default: rejected; hidden history mutation surprises hosts and can serialize user text unexpectedly.
      - Compact after provider output: rejected initially; compacting before provider input is the path that reduces the next request.
      - Let strategies append directly to stores: rejected; runtime owns branch parent ids and store ordering.
      - Add queueing for compaction during active runs: rejected; one active run already exists, and manual compact can fail fast during an active run if needed.
    - Chosen Approach:
      - Added `compact(options?)` to `AgentSession` and implemented it in `RuntimeAgentSession` using the current leaf branch.
      - Merged compaction config as `RunOptions.compaction` over `AgentConfig.compaction`; `false` disables auto-compaction for that run.
      - Auto-compaction checks after user/model-change entries are appended and before the first provider request when branch entry count exceeds `thresholdEntries`.
      - Run `middleware.run("compaction", { context, result })` after strategy execution and before appending the runtime-owned standard compaction entry.
      - Used run/manual abort signals for compaction where available.
      - Fixed `keepRecentEntries: 0` in the default compaction strategy so it keeps no recent entries instead of all entries.
    - API Notes and Examples:
      ```ts
      const session = agent.createSession({ id: "s1" });
      await session.run("long chat", { compaction: { thresholdEntries: 20, keepRecentEntries: 6 } });
      await session.compact({ keepRecentEntries: 4, metadata: { reason: "manual" } });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: added `AgentSession.compact(options?)`, `AgentConfig.compaction`, `RunOptions.compaction`, `CompactionOptions`, and `CompactionMiddlewarePayload`.
      - `src/agents.ts`: implemented manual compact, auto-compaction check, compaction events, middleware hook, leaf update, and redaction use.
      - `src/compaction.ts`: fixed `keepRecentEntries: 0` handling in the default strategy.
      - `src/__tests__/agents.test.ts`: added manual/auto compaction runtime tests.
      - `src/__tests__/compaction.test.ts`: existing default strategy tests cover shared behavior; no new shared helper tests needed.
      - `src/__tests__/public-contracts.test.ts`: added coverage for `session.compact()` and compaction config.
      - `docs/agent-session-runtime.md`: documented `session.compact()`, auto-compaction timing, events, abort behavior, middleware, and non-goals.
      - `docs/compaction-and-retry.md`: documented manual/auto runtime APIs.
      - `docs/middleware-hooks.md`: documented the `compaction` runtime call site and payload.
      - `docs/extensions.md`: documented extension middleware path for compaction.
      - `docs/public-contracts.md`: updated `AgentSession`, `AgentConfig`, `RunOptions`, and compaction contract sections.
    - References:
      - `roadmap.md` Phase 8 deliverables: manual and auto-compaction APIs; extension hooks around compaction.
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `agent_session_manual_compact_appends_compaction_entry_and_updates_leaf`: validates branch entry append, parent id, returned result, and `session.entries()` leaf path. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_auto_compacts_before_provider_input_when_threshold_exceeded`: validates provider request receives summary plus recent messages, not full old history. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_compaction_events_are_emitted`: validates `compaction_started` and redacted `compaction_finished.summary`. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_compaction_middleware_can_adjust_summary_payload`: validates extension hook path without bypassing store/leaf ownership. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_compaction_disabled_by_run_option_false`: validates host can skip configured auto-compaction. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_compaction_context_excludes_credentials_and_provider_objects`: validates stores/events/context do not receive credential resolvers or provider objects. Implemented in `src/__tests__/agents.test.ts`.
    - `public_contracts_cover_default_compaction_strategy`: extended to cover `CompactionOptions`, `AgentConfig.compaction`, and `session.compact()`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds `AgentSession.compact()`, compaction config on agent/run options, compaction middleware call site, and runtime event behavior.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: update session method list, run flow, event flow, and security/performance notes.
      - `docs/compaction-and-retry.md`: document manual and auto-compaction APIs with examples.
      - `docs/middleware-hooks.md`: document `compaction` call site and payload.
      - `docs/extensions.md`: document how extensions register compaction middleware and strategies.
      - `docs/public-contracts.md`: update public contracts and examples.
    - `docs/index.md` update: No if the compaction/retry page was already added in the prior task; verify link text remains accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add retry policy contracts, registry support, and provider-turn backoff
  - Acceptance Criteria:
    - Functional: `RetryPolicy` can decide whether a transient provider failure should retry; `createDefaultRetryPolicy()` retries only known transient provider errors up to a bounded attempt count with exponential backoff; runtime emits `retry_scheduled`, waits with abort support, and retries provider turns that fail before observable output; extensions can register retry policies and transform retry decisions through middleware.
    - Performance: Retry attempts are bounded, delays are capped, sleeps use native abort-aware timers, and no retry path adds dependencies, workers, unbounded queues, network probes, or extra store scans.
    - Code Quality: Retry classification is generic and provider-agnostic; retry code is shared by thrown provider errors and provider `error` events; aborts and post-output failures are not retried; tests use deterministic delays/policies without slowing the suite.
    - Security: Retry context and middleware payloads exclude provider request messages/content by default, provider objects, credentials, credential resolvers, and settings; retry errors/events are redacted for known secrets and preserve only safe `ErrorInfo` fields such as `message` and `code`.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ProviderEvent.error`, `ErrorInfo`, `AgentEvent.retry_scheduled`, `AgentConfig`, and `RunOptions`.
      - `src/agents.ts` provider generate loop, provider error handling, abort bridge, and active run cleanup.
      - `src/provider-events.ts` `providerError()` and `src/redaction.ts` `errorToErrorInfo()`.
      - `src/contributions.ts`, `src/extensions.ts`, and `src/manifests.ts` contribution registration patterns.
      - `src/middleware.ts` `retry` hook name and middleware behavior.
      - `node_modules/@types/node/timers/promises.d.ts` and `node_modules/@types/node/timers.d.ts` for `setTimeout(..., { signal, ref: false })`.
      - `docs/provider-layer.md`, `docs/agent-session-runtime.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/configuration-and-manifests.md`, and `docs/middleware-hooks.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Retry the whole `session.run()`: rejected; user/tool/store entries would duplicate. Retry only the current provider turn before output is safer.
      - Retry after partial assistant content/tool calls have been emitted: rejected; subscribers and stores may have observed partial output.
      - Add provider-specific HTTP adapters to classify errors: rejected; providers can set `ErrorInfo.code`, and default policy can use generic transient codes.
      - Add retry policy lookup from a global registry: rejected; registries are explicit and hosts pass the selected policy.
      - Use real long sleeps in tests: rejected; inject a zero-delay sleep or deterministic policy for fast tests.
    - Chosen Approach:
      - Added `src/retry.ts` with `createDefaultRetryPolicy()`, `isTransientErrorInfo()`, `waitForRetry()`, and default policy options; retry contracts live in `src/contracts.ts`.
      - Extended `errorToErrorInfo()`/`providerError()` to preserve string/number `code` from error-like objects while continuing to redact messages/causes.
      - Added `retryPolicies` to `ContributionRegistries`, `ExtensionAPI.registerRetryPolicy(policy)`, and manifest contribution kind `retryPolicy`.
      - In `RuntimeAgentSession`, wrapped one provider turn in a retry loop that reuses the same assembled request, schedules retries only before any `message_started`/delta/tool call has been emitted, and honors `RunOptions.signal`/session abort during backoff.
      - Ran `middleware.run("retry", { context, decision })` before scheduling so extension middleware can reduce/deny delay or stop retrying.
    - API Notes and Examples:
      ```ts
      const retry = createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 500 });
      await session.run("Hi", { retry: { policy: retry } });

      extensionApi.registerRetryPolicy(retry);
      extensionApi.use("retry", ({ context, decision }) => ({ ...decision, delayMs: 0 }));
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: added `RetryPolicy`, `RetryContext`, `RetryDecision`, `RetryOptions`, `RetryMiddlewarePayload`, `AgentConfig.retry`, and `RunOptions.retry`; widened safe `ErrorInfo.code` to string/number.
      - `src/retry.ts`: implemented default policy, transient classifier, and exported abort-aware delay helper.
      - `src/agents.ts`: retries provider turns, emits `retry_scheduled`, runs retry middleware, and preserves abort/concurrency behavior.
      - `src/redaction.ts` and `src/provider-events.ts`: preserve safe error `code` and redact known secret strings in retryable errors.
      - `src/contributions.ts`: added `retryPolicies` contribution registry.
      - `src/extensions.ts`: added `registerRetryPolicy()` to `ExtensionAPI` implementation.
      - `src/manifests.ts`: added `retryPolicy` contribution kind.
      - `src/index.ts`: exported retry helpers and types.
      - `src/__tests__/retry.test.ts`: added retry policy/classification tests.
      - `src/__tests__/agents.test.ts`: added runtime retry event/backoff/abort/no-partial-retry tests.
      - `src/__tests__/contributions.test.ts`, `src/__tests__/extensions.test.ts`, and `src/__tests__/config-manifests.test.ts`: added retry policy registry/API/manifest coverage.
      - `src/__tests__/public-contracts.test.ts`: added compile coverage for retry types and root exports.
      - `docs/compaction-and-retry.md`: documented retry policy APIs and runtime behavior.
      - `docs/provider-layer.md`: documented provider errors can set safe `ErrorInfo.code` for retry classification.
      - `docs/agent-session-runtime.md`: documented retry timing/events/non-retry cases.
      - `docs/middleware-hooks.md`: documented `retry` call site and payload.
      - `docs/contribution-registries.md`, `docs/extensions.md`, and `docs/configuration-and-manifests.md`: documented retry policy contribution support.
      - `docs/public-contracts.md`: updated contract inventory and examples.
      - `docs/index.md`: no change needed; existing compaction/retry page link already covers retry.
      - `src/__tests__/docs.test.ts`: added retry export docs check.
    - References:
      - `roadmap.md` Phase 8 deliverables: retry/backoff policy for transient provider errors and extension hooks around retry.
      - `node_modules/@types/node/timers/promises.d.ts` and `node_modules/@types/node/timers.d.ts` for abort-aware sleep.
  - Test Cases to Write:
    - `default_retry_policy_retries_known_transient_codes_with_capped_backoff`: validates retry decisions, cap, and no retry after max attempts. Implemented in `src/__tests__/retry.test.ts`.
    - `default_retry_policy_does_not_retry_abort_or_non_transient_errors`: validates fail-closed classification. Implemented in `src/__tests__/retry.test.ts`.
    - `provider_error_preserves_safe_error_code_for_retry`: validates `ErrorInfo.code` survives helper conversion without leaking secrets. Implemented in `src/__tests__/retry.test.ts`.
    - `agent_session_retries_provider_turn_before_output_and_emits_retry_scheduled`: validates runtime retry and event shape. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_does_not_retry_after_observable_output`: validates no duplicated partial content/tool calls. Implemented in `src/__tests__/agents.test.ts`.
    - `agent_session_retry_backoff_honors_abort_signal`: validates abort during delay rejects promptly and no next provider attempt starts. Implemented in `src/__tests__/agents.test.ts`.
    - `retry_middleware_can_stop_or_adjust_retry_decision`: validates extension hook path. Implemented in `src/__tests__/agents.test.ts`.
    - `extension_api_and_manifest_support_retry_policy_registration`: validates registry/API/manifest kind. Implemented across `src/__tests__/contributions.test.ts`, `src/__tests__/extensions.test.ts`, and `src/__tests__/config-manifests.test.ts`.
    - `public_contracts_cover_retry_policy`: validates root exports and type shape. Implemented in `src/__tests__/public-contracts.test.ts`.
    - `docs_reference_existing_retry_exports`: validates docs reference exported retry APIs. Implemented in `src/__tests__/docs.test.ts`.
    - `npm run typecheck`: passed.
    - `command npm test`: passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds retry policy contracts/helpers/config, contribution registry/API/manifest kind, retry middleware call site, and runtime retry behavior/events.
    - Docs pages to create/edit:
      - `docs/compaction-and-retry.md`: document `RetryPolicy`, `createDefaultRetryPolicy()`, retry config, event semantics, and examples.
      - `docs/agent-session-runtime.md`: document provider-turn retry timing and non-retry cases.
      - `docs/middleware-hooks.md`: document `retry` call site and payload.
      - `docs/contribution-registries.md`: add retry policy registry entry.
      - `docs/extensions.md`: add `registerRetryPolicy()` and retry middleware examples.
      - `docs/configuration-and-manifests.md`: add `retryPolicy` manifest contribution kind.
      - `docs/provider-layer.md`: document safe provider error codes for retry classification.
      - `docs/public-contracts.md`: update retry contracts and examples.
    - `docs/index.md` update: No if the compaction/retry page was already linked; ensure the description includes retry policies.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification and compaction/retry wiki consistency
  - Acceptance Criteria:
    - Functional: All Phase 8 acceptance scenarios pass; public root exports compile; docs link every new compaction/retry API, event, middleware hook, contribution registry, manifest kind, and security boundary.
    - Performance: Full test suite stays under the roadmap target of 10 seconds locally, uses no network, uses deterministic fast retry delays, and adds no dependency, watcher, worker, or long-running timer.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; tests use existing `node:test` style and keep compaction/retry logic covered without large fixtures.
    - Security: Tests/docs confirm no built-in app tools, no hidden provider/tool/store/strategy/retry globals, no automatic credential resolution, no provider credentials in compaction/retry contexts, and known secrets redacted from summaries/events/errors.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md` for required page structure.
      - `docs/index.md` navigation groups and Future API areas.
      - `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/session-stores-and-branching.md`, `docs/middleware-hooks.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/configuration-and-manifests.md`, `docs/provider-layer.md`, and `docs/public-contracts.md` after implementation.
      - `src/__tests__/docs.test.ts` documentation checks.
      - `package.json` `build`, `typecheck`, and `test` scripts.
    - Options Considered:
      - Add a docs generator or golden token fixtures: rejected; existing docs tests plus focused API pages are enough.
      - Add CLI/RPC compact/retry commands now: rejected; Phase 9 owns CLI/RPC surfaces.
      - Add provider-backed summarization examples with real network calls: rejected; examples must stay deterministic and offline.
    - Chosen Approach:
      - Ran the existing validation commands after implementation.
      - Added a docs test covering the compaction/retry page, root exports, retry policy registry/API/manifest kind, middleware/event names, `docs/index.md` link text, and security boundaries.
      - Reviewed and corrected docs for stale retry wording, compaction/retry related links, and credential/provider-object leakage boundaries.
      - Filled `Compromises Made` and `Further Actions` after implementation and tests passed.
    - API Notes and Examples:
      ```sh
      npm run build && npm run typecheck && command npm test
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: added checks for compaction/retry docs, root exports, event names, middleware/config names, registry/API/manifest docs, `docs/index.md` text, provider error-code docs, and credential/provider-object boundaries.
      - `docs/compaction-and-retry.md`: added `RetryMiddlewarePayload` and related API links for middleware, manifest kinds, provider error codes, and retry redaction.
      - `docs/index.md`: corrected compaction/retry link text from planned retry surfaces to implemented retry behavior.
      - `docs/agent-session-runtime.md`: clarified whole-run retry non-goal and runtime/middleware wording.
      - `docs/session-stores-and-branching.md`, `docs/middleware-hooks.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/configuration-and-manifests.md`, `docs/provider-layer.md`, and `docs/public-contracts.md`: already consistent from earlier tasks; verified by docs tests and final review.
      - `plans/011-compaction-strategies-and-retry.md`: marked the final task complete and filled closeout sections after all checks passed.
    - References:
      - `roadmap.md` Phase 8 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: passed; validates emitted JS/types and package exports.
    - `npm run typecheck`: passed; validates strict TypeScript types.
    - `command npm test`: passed; validates compaction, retry, runtime, registries, manifests, docs, and public contracts.
    - `docs_index_links_compaction_retry_page`: passed through existing docs index-link tests and updated compaction/retry text assertion.
    - `docs_reference_existing_compaction_retry_exports`: passed through the new compaction/retry docs safety/export test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new API by verification alone; it validates docs for APIs added by earlier tasks.
    - Docs pages to create/edit:
      - `docs/compaction-and-retry.md`: final corrections if verification finds gaps.
      - `docs/index.md`: final navigation corrections if needed.
      - Other updated docs pages: final consistency corrections if needed.
    - `docs/index.md` update: No unless verification finds navigation missing or misleading.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Default compaction remains conservative and local: it summarizes text/labels only, ignores malformed compaction `data`, uses exact known-secret redaction only, and does not call providers or tokenize content.
- Auto-compaction is opt-in and checks once before provider input; there is no background maintenance, JSONL rewrite, vector memory, semantic retrieval, or CLI/RPC compaction command in Phase 8.
- Retry is scoped to the current provider turn before observable output; it does not retry whole runs, tool failures, aborts, validation failures, missing providers, or provider failures after assistant output begins.
- Retry classification is generic (`ErrorInfo.code` plus transient message hints) rather than provider-specific HTTP adapter logic.

## Further Actions
- Phase 9: add any CLI/RPC compact or retry-control surfaces if the roadmap still needs them, building on the completed runtime APIs.
- Optional host package work: provide provider-backed/custom compaction strategies outside the default strategy when model-generated summaries are desired.
- Optional hardening if needed: add provider-specific retry policies in adapter packages rather than expanding Prism's default generic classifier.
