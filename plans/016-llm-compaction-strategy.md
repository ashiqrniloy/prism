# Phase 13 — LLM Compaction Strategy Package

## Objectives
- Add `@prism/compaction-llm` as an explicit, replaceable LLM-backed compaction package; do not change Prism core's default compaction.
- Reuse existing `CompactionStrategy`, `AgentSession.compact()`, auto-compaction config, middleware, session store, branch, provider, request-policy, credential, and redaction primitives before adding anything generic.
- Adapt Pi's proven token-estimated cut points, previous-summary update prompts, split-turn prefix summaries, structured markdown format, file-operation tracking, and safe conversation serialization to Prism contracts.
- Keep raw history append-only and keep all tests network-free with mock providers.

## Expected Outcome
- `@prism/compaction-llm` builds, typechecks, tests, packs, and exports strategy/extension helpers with no import side effects.
- Hosts can use the package manually via `session.compact({ strategy })` or opt into existing runtime auto-compaction with `AgentConfig.compaction` / `RunOptions.compaction`.
- Summaries preserve exact file paths, errors, decisions, and current work; oversized tool results are truncated and known secrets are redacted before provider requests, events, and stored entries.
- Failed or aborted summary provider calls append no compaction entry and do not corrupt the current branch.

## Tasks

- [x] Review primitives and lock the minimal Phase 13 package surface
  - Acceptance Criteria:
    - Functional: Current Prism compaction/runtime/provider/package primitives and Pi compaction behavior are inventoried; the task records whether `@prism/compaction-llm` can be built with existing public APIs or names the single generic core gap if one is unavoidable.
    - Performance: Review adds no runtime code, provider call, dependency, tokenizer, worker, watcher, filesystem scan, package discovery, or network test.
    - Code Quality: The locked design rejects making LLM compaction the core default, adding provider-specific core branches, rewriting stores, deleting raw history, and adding a shared abstraction before package evidence requires it.
    - Security: Design keeps credentials at the summary-provider edge, redacts exact known secrets before summarization and storage, and forbids resolved credentials in session entries, registries, metadata, docs, or fixtures.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 13 and non-negotiable boundaries.
      - `plans/011-compaction-strategies-and-retry.md`, especially Phase 8 default compaction/retry closeout and provider-backed compaction deferral.
      - `plans/014-provider-auth-cache-and-system-prompt-primitives.md` Phase 11 provider request/cache/auth/system-prompt primitives.
      - `plans/015-real-provider-packages.md` workspace/package shape and provider package boundary tests.
      - `src/contracts.ts`: `CompactionStrategy`, `CompactionContext`, `CompactionResult`, `CompactionOptions`, `CompactionEntryData`, `AIProvider`, `ProviderRequest`, `ProviderRequestPolicy`, `CredentialResolver`, `RunOptions`, and `AgentConfig`; `src/credentials.ts`: `CredentialValueSource` and `resolveCredentialValue()`.
      - `src/agents.ts`: `session.compact()`, opt-in `thresholdEntries` auto-compaction, compaction middleware, redaction, and append-only branch handling.
      - `src/session-stores.ts`: `getSessionBranchEntries()`, `rebuildSessionContext()`, compaction-entry boundary behavior, and raw-entry preservation.
      - `src/compaction.ts`, `src/redaction.ts`, `src/provider-request-policy.ts`, `src/provider-events.ts`, `src/mock-provider.ts`, and `src/index.ts`.
      - `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/session-stores-and-branching.md`, `docs/provider-layer.md`, `docs/provider-packages.md`, `docs/credentials-and-redaction.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, and `docs/index.md`.
      - Pi compaction docs: `/home/arn/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/compaction.md` sections on triggers, cut points, split turns, message serialization, file tracking, summary format, and extension customization.
      - Pi source/type references: `dist/core/compaction/compaction.d.ts`, `dist/core/compaction/compaction.js`, `dist/core/compaction/utils.js`, `dist/core/compaction/branch-summarization.d.ts`, `dist/core/compaction/branch-summarization.js`, and `dist/core/session-manager.d.ts`.
      - Pi example: `/home/arn/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/custom-compaction.ts`.
      - npm workspaces docs: `https://docs.npmjs.com/cli/v11/using-npm/workspaces` for `workspaces`, `npm run --workspaces`, and `--if-present` behavior.
      - `.agents/skills/create-plan/references/prism-wiki.md`; project pattern/wiki directories are not present.
    - Options Considered:
      - Put LLM summarization into `createDefaultCompactionStrategy()`: rejected; roadmap says provider-backed compaction is an optional package.
      - Add a new compaction package registry/loader: rejected initially; `ExtensionAPI.registerCompactionStrategy()` and direct strategy passing already exist.
      - Add a tokenizer dependency: rejected; Pi's chars/4 estimate is enough until measured inaccurate.
      - Add core token-triggered auto-compaction now: reject unless review proves existing `thresholdEntries` plus package helpers cannot satisfy Phase 13; if needed, add only a generic auto-policy hook with docs/tests before package work.
      - Build package exports only: chosen default, using `createLlmCompactionStrategy()` and `createLlmCompactionExtension()`.
    - Chosen Approach:
      - Start with a package-only design: direct strategy factory, optional extension wrapper for registry contribution, pure preparation utilities, and docs/examples.
      - Summary provider/model are explicit package options. Hosts may pass an already credentialed `AIProvider`, or a provider factory that receives a per-call credential resolved from a host-supplied `CredentialValueSource`.
      - Existing runtime auto-compaction remains opt-in through `thresholdEntries`; token estimates choose the cut point and package helpers can help hosts decide manual compaction timing.
    - Primitive Review Result:
      - Existing public APIs are enough for Phase 13; no core primitive is required before creating `@prism/compaction-llm`.
      - Reused core surfaces: `CompactionStrategy`, `CompactionContext`, `CompactionResult`, `CompactionEntryData`, `CompactionOptions`, `AgentSession.compact()`, `AgentConfig.compaction`, `RunOptions.compaction`, `createSessionEntry()`, `rebuildSessionContext()`, `AIProvider`, `ProviderRequest`, `ProviderRequestOptions`, `ProviderRequestPolicy`, `createProviderRequestPolicyChain()`, `mergeProviderRequestOptions()`, `CredentialValueSource`, `resolveCredentialValue()`, `redactSecrets()`, `createSecretRedactor()`, `ExtensionAPI.registerCompactionStrategy()`, and `ContributionRegistries.compactionStrategies`.
      - Runtime fit: strategies can return a package-created compaction entry; `compactBranch()` copies its `data` when `isCompactionEntryData()` passes, and extra JSON fields survive because the guard validates only core fields. The runtime still owns append ordering, parent ids, middleware, events, redaction of the final summary, and history rebuild.
      - Locked package API: `createLlmCompactionStrategy(options)`, `createLlmCompactionExtension(options)`, pure preparation/serialization/file-op helpers, prompt constants, and package-specific data/types. No `defineCompactionPackage()`, no provider SDK dependency, no core default change.
      - Locked behavior: use Pi-style chars/4 token estimates, backward cut-point selection, `reserveTokens`, `keepRecentTokens`, previous-summary update prompts, optional split-turn prefix summaries, structured markdown, safe labeled serialization, 2000-char default tool-result truncation, optional read/modified file lists, and mock-provider-only tests.
      - Explicit non-goals: token-triggered core auto-compaction, background compaction, JSONL/session-store rewrite, branch pointer mutation beyond existing append, semantic retrieval, CLI/RPC commands, provider-specific core branches, hidden credential discovery, and live provider tests.
      - Validation: inspected `src/contracts.ts`, `src/agents.ts`, `src/compaction.ts`, `src/session-stores.ts`, `src/provider-request-policy.ts`, `src/redaction.ts`, `src/extensions.ts`, `src/credentials.ts`, `src/index.ts`, `package.json`, Phase 8/11/12 plan records, Prism docs listed above, Pi compaction docs/source records, and confirmed root workspaces are currently only `["packages/provider-*"]`.
    - API Notes and Examples:
      ```ts
      import { createLlmCompactionStrategy } from "@prism/compaction-llm";

      const strategy = createLlmCompactionStrategy({
        summaryProvider,
        summaryModel: { provider: "openai", model: "gpt-4.1-mini" },
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
        maxSummaryTokens: 4_096,
      });

      await session.compact({ strategy, secrets: [apiKey] });
      ```
    - Files to Create/Edit:
      - `plans/016-llm-compaction-strategy.md`: record primitive inventory and locked package/API shape.
      - Tentative later files: `package.json`, `package-lock.json`, `packages/compaction-llm/**`, `docs/compaction-llm.md`, `docs/compaction-and-retry.md`, `docs/index.md`, and `src/__tests__/phase13-boundaries.test.ts`.
      - No core primitive files are planned from this review; revisit only if implementation exposes a concrete generic gap.
    - References:
      - `roadmap.md` Phase 13 deliverables and acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - None for the review-only plan edit; validation was source/docs inspection plus `rg`/`node` checks recorded above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by review alone; later tasks must document package APIs and any generic core changes.
    - Docs pages to create/edit:
      - `none`: review notes live in this plan until APIs are implemented.
    - `docs/index.md` update: No for review alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add the `@prism/compaction-llm` workspace skeleton
  - Acceptance Criteria:
    - Functional: Root scripts include compaction workspaces; `@prism/compaction-llm` has package metadata, strict TypeScript config, README, public barrel, skipped live-test convention, and network-free placeholder tests.
    - Performance: Default `npm test` remains network-free; workspace overhead is TypeScript plus `node:test` only.
    - Code Quality: Package has no import side effects, no runtime dependencies beyond peer `prism`, no provider SDK, and follows existing ESM/NodeNext workspace style.
    - Security: Skeleton contains no real credentials, no env auto-read, no postinstall script, no catalog/provider call, and no filesystem/session discovery.
  - Approach:
    - Documentation Reviewed:
      - npm workspaces docs: `https://docs.npmjs.com/cli/v11/using-npm/workspaces`.
      - `package.json`, `package-lock.json`, `tsconfig.packages.json`, and existing `packages/provider-*/package.json` scripts.
      - `plans/015-real-provider-packages.md` package skeleton task and final boundary checks.
      - `docs/provider-packages.md` first-party workspace notes.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Put compaction package under the existing `packages/provider-*` glob: rejected; it is not a provider.
      - Add `packages/compaction-*` workspace glob: chosen.
      - Add a shared package utility immediately: rejected; extract only after package code proves repetition.
    - Chosen Approach:
      - Update root workspaces to include `packages/compaction-*`.
      - Create a minimal package with `build`, `typecheck`, `test`, and `pack:dry-run` scripts matching provider workspaces.
      - Add a skipped live-test placeholder guarded by `PRISM_LIVE_COMPACTION_TESTS=1`; all real tests use mock providers.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      npm run pack:dry-run --workspaces --if-present
      ```
    - Files to Create/Edit:
      - `package.json`: added `packages/compaction-*` to workspaces.
      - `package-lock.json`: updated workspace lock metadata for `@prism/compaction-llm`.
      - `packages/compaction-llm/package.json`: added package metadata, scripts, peer dependency, exports/files.
      - `packages/compaction-llm/tsconfig.json`: added strict workspace config extending `tsconfig.packages.json`.
      - `packages/compaction-llm/README.md`: added initial usage/security stub.
      - `packages/compaction-llm/src/index.ts`: added temporary public barrel with `packageName`.
      - `packages/compaction-llm/src/__tests__/index.test.ts`: added public entrypoint and package metadata tests.
      - `packages/compaction-llm/src/__tests__/live.test.ts`: added skipped live-test placeholder unless explicitly enabled.
      - `docs/compaction-llm.md`: added initial API page stub following Prism wiki structure.
      - `docs/index.md`: added Compaction/session memory entry for the package.
    - Validation:
      - `npm install --package-lock-only --ignore-scripts --offline`: passed.
      - `npm run build --workspace=@prism/compaction-llm`: passed.
      - `npm run typecheck --workspace=@prism/compaction-llm`: passed.
      - `npm run test --workspace=@prism/compaction-llm`: passed with live test skipped.
      - `npm run pack:dry-run --workspace=@prism/compaction-llm`: passed.
      - `npm run typecheck`: passed.
      - `command npm test`: passed after restoring the local `node_modules/prism -> ..` self-link expected by existing Phase 12 package import tests.
    - References:
      - `roadmap.md` suggested plan `016-llm-compaction-strategy.md`.
      - Existing provider workspace package files under `packages/provider-*`.
  - Test Cases to Write:
    - `compaction_llm_package_entrypoint_exists`: implemented; imports the built package public entrypoint.
    - `compaction_llm_live_tests_are_skipped_by_default`: implemented; asserts live placeholder uses `PRISM_LIVE_COMPACTION_TESTS` and `skip:` through source plus runtime skip behavior.
    - `compaction_llm_package_metadata_is_minimal`: implemented; asserts peer `prism`, no runtime dependencies, no postinstall, and `files: ["dist", "README.md"]`.
    - `npm run typecheck`: passed; validates root plus workspace types.
    - `command npm test`: passed; validates network-free tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; creates a new first-party package name and entrypoint.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: create package API page stub that will be filled by implementation tasks.
      - `docs/index.md`: add `LLM compaction package - Provider-backed compaction strategy package` under Compaction/session memory.
    - `docs/index.md` update: Yes; new package navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement token preparation, serialization, redaction, and file-operation tracking
  - Acceptance Criteria:
    - Functional: Package utilities estimate tokens, decide cut points with `reserveTokens`/`keepRecentTokens`, avoid cutting at tool-result messages, detect split turns, carry previous compaction summaries into repeated compactions, serialize Prism messages so the summary model cannot continue the conversation, truncate oversized tool results, preserve exact paths/errors/decisions, redact known secrets, and optionally collect read/modified file details.
    - Performance: Preparation is O(n) over current branch entries, uses chars/4 token estimates and string truncation only, and performs no provider call, filesystem access, network access, worker, timer, or dependency work.
    - Code Quality: Utilities are pure, typed, testable without runtime sessions, and store package-specific details as JSON-serializable data compatible with `CompactionEntryData`.
    - Security: Serialized conversation and file details exclude credentials, provider objects, credential resolvers, settings providers, hidden metadata, and full unbounded tool values; exact known secrets are redacted before a provider request can be built.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `SessionEntry`, `Message`, `ContentBlock`, `ToolCallContent`, `ToolResultContent`, `ErrorInfo`, `CompactionContext`, and `CompactionEntryData`.
      - `src/session-stores.ts` compaction boundary handling via `throughEntryId` and `keepEntryIds`.
      - `src/redaction.ts` exact known-secret redaction behavior.
      - Pi `compaction.js`: `estimateTokens()`, `findValidCutPoints()`, `findCutPoint()`, `findTurnStartIndex()`, `prepareCompaction()`.
      - Pi `utils.js`: `serializeConversation()`, `TOOL_RESULT_MAX_CHARS`, `extractFileOpsFromMessage()`, `computeFileLists()`, and `formatFileOperations()`.
      - Pi `branch-summarization.js`: branch summary entries include compaction summaries as context and accumulate file details.
      - `docs/session-stores-and-branching.md`, `docs/compaction-and-retry.md`, and `docs/credentials-and-redaction.md`.
    - Options Considered:
      - Tokenize with provider-specific tokenizers: rejected; no dependency and provider-specific logic.
      - Serialize provider messages as JSON: rejected; too easy for the model to treat as live chat and too verbose.
      - Copy Pi message roles exactly: rejected; Prism has `user`/`assistant`/`tool` roles and typed content blocks, so adapt to Prism contracts.
      - Track only tool-call paths: chosen baseline; also read obvious `ToolResultContent.error.message` and string results for error preservation, but do not parse arbitrary large result objects beyond truncation.
    - Chosen Approach:
      - Add pure helpers for `estimateMessageTokens()`, `estimateEntryTokens()`, `findLlmCompactionCutPoint()`, `prepareLlmCompaction()`, `serializeCompactionConversation()`, and file-op extraction.
      - Use `throughEntryId` for Prism rebuild behavior, store `firstKeptEntryId`, `estimatedTokensBefore`, `estimatedTokensAfter`, `isSplitTurn`, `readFiles`, and `modifiedFiles` as extra JSON fields in package data.
      - Treat `role: "tool"` messages as invalid cut starts so tool results stay with the assistant call context.
      - Use a configurable `maxToolResultChars` defaulting to Pi's 2000-character truncation.
    - API Notes and Examples:
      ```ts
      const prep = prepareLlmCompaction({ sessionId: "s1", entries, secrets: [apiKey] }, {
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
        maxToolResultChars: 2_000,
      });

      const conversation = serializeCompactionConversation(prep.messagesToSummarize);
      ```
    - Files to Create/Edit:
      - `packages/compaction-llm/src/tokens.ts`: added chars/4 token estimate helpers for text, messages, and session entries.
      - `packages/compaction-llm/src/prepare.ts`: added previous-summary lookup, cut-point logic, split-turn detection, data shape, and file-op integration.
      - `packages/compaction-llm/src/serialize.ts`: added safe labeled conversation serialization, tool-result truncation, and exact-secret redaction.
      - `packages/compaction-llm/src/file-ops.ts`: added optional read/modified file tracking and summary block formatting.
      - `packages/compaction-llm/src/index.ts`: exported pure helpers and types.
      - `packages/compaction-llm/src/__tests__/prepare.test.ts`: added cut point, repeated compaction, split turn, and tool-result-boundary coverage.
      - `packages/compaction-llm/src/__tests__/serialize.test.ts`: added serialization, truncation, file ops, and redaction coverage.
      - `docs/compaction-llm.md`: documented preparation/data/serialization behavior.
      - `docs/compaction-and-retry.md`: linked the optional package from core compaction docs.
    - Validation:
      - `npm run build --workspace=@prism/compaction-llm`: passed.
      - `npm run test --workspace=@prism/compaction-llm`: passed with live test skipped.
      - `npm run typecheck`: passed.
      - `command npm test`: passed with live tests skipped.
    - References:
      - `roadmap.md` Phase 13 deliverables: token-estimated cut points, split-turn prefix summaries, structured summary format, redaction, file-operation tracking.
      - Pi `docs/compaction.md` summary format and message serialization sections.
  - Test Cases to Write:
    - `prepare_llm_compaction_keeps_recent_tokens_and_sets_boundary_data`: implemented; validates `throughEntryId`, `firstKeptEntryId`, `keepEntryIds`, and token estimates.
    - `prepare_llm_compaction_does_not_cut_at_tool_result`: implemented; validates tool results stay with the tool-call context.
    - `prepare_llm_compaction_uses_previous_summary_on_repeated_compaction`: implemented; validates prior compaction summary/data are found and used.
    - `prepare_llm_compaction_detects_split_turn_prefix`: implemented; validates split-turn prefix messages are separated.
    - `serialize_compaction_conversation_prevents_continuation_and_truncates_tool_results`: implemented; validates role labels and truncation marker.
    - `serialize_compaction_conversation_redacts_known_secrets`: implemented; validates secret removal before provider request construction.
    - `file_operation_tracking_collects_read_and_modified_paths`: implemented; validates `readFiles`/`modifiedFiles` from Prism tool-call contracts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds package helper exports, package-specific compaction data fields, and documented serialization behavior.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: fill inputs, outputs/data, serialization, file tracking, security/performance notes, and examples.
      - `docs/compaction-and-retry.md`: add related link to the LLM package if not already present.
    - `docs/index.md` update: No if the package page was linked in the skeleton task; verify link text still matches behavior.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement the provider-backed LLM compaction strategy
  - Acceptance Criteria:
    - Functional: `createLlmCompactionStrategy()` returns a `CompactionStrategy` that prepares the branch, calls the explicit summary provider/model, supports custom instructions, previous-summary update prompts, split-turn prefix summaries, `reserveTokens`, `keepRecentTokens`, `thinkingLevel`, cache/request policy options, `maxSummaryTokens`, and host-supplied credential resolution, then returns a standard compaction entry with structured markdown summary and package details.
    - Performance: The strategy makes only the required summary provider calls, streams/collects text incrementally, caps/truncates summary output by configured estimate, and adds no background queue, scheduler, tokenizer dependency, or live network test.
    - Code Quality: Provider calling is generic over `AIProvider`/`ProviderRequest`; provider-specific payload fields remain in `ProviderRequest.options`/request policies; strategy code is separate from pure preparation helpers.
    - Security: Resolved credentials are per-call only, passed only to a host-supplied provider factory when configured, added to exact redaction lists, and never stored in summary data, provider metadata, docs, tests, events, or session entries.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AIProvider.generate()`, `ProviderEvent`, `ProviderRequestOptions`, `ProviderRequestPolicy`, `CredentialValueSource`, and `CredentialRequest`.
      - `src/provider-request-policy.ts` `createProviderRequestPolicyChain()` and policy secret redaction results.
      - `src/provider-events.ts` text/thinking/error/done event shapes.
      - `src/mock-provider.ts` and `docs/provider-layer.md` for deterministic mock provider tests.
      - Phase 12 provider packages' use of `ProviderRequest.options.cacheRetention`, `cacheKey`, `compat`, `extra`, headers, and `ModelConfig.limits.maxOutputTokens`.
      - Pi `generateSummary()`, `compact()`, `SUMMARIZATION_PROMPT`, `UPDATE_SUMMARIZATION_PROMPT`, `TURN_PREFIX_SUMMARIZATION_PROMPT`, and `SUMMARIZATION_SYSTEM_PROMPT` in `compaction.js`/`utils.js`.
      - `docs/provider-packages.md`, `docs/credentials-and-redaction.md`, `docs/system-prompts.md`, and `docs/compaction-and-retry.md`.
    - Options Considered:
      - Reuse the active agent provider implicitly: rejected; Prism runtime does not expose hidden active providers to strategies, and host choice must be explicit.
      - Require provider packages or SDK-specific clients: rejected; use generic `AIProvider`.
      - Put credentials into `ProviderRequest.metadata`: rejected; secret metadata could leak to docs/events/stores.
      - Use one provider call for split turns by concatenating prompts: rejected; separate prefix summary is clearer and matches Pi's behavior.
    - Chosen Approach:
      - Export `createLlmCompactionStrategy(options)`, `LlmCompactionStrategyOptions`, `LlmCompactionEntryData`, and prompt constants.
      - Build summary requests as a system message plus a user message containing `<conversation>` and optional `<previous-summary>` tags.
      - Apply package `providerRequestPolicies` and merge `providerOptions`; set safe generic cache/session fields and `ModelConfig.limits.maxOutputTokens` from `maxSummaryTokens` when provided.
      - Collect only text deltas/final text from provider events; provider `error` events or aborts throw before a compaction entry is returned.
      - Append `<read-files>` / `<modified-files>` blocks to the final structured markdown when file tracking is enabled.
    - API Notes and Examples:
      ```ts
      const strategy = createLlmCompactionStrategy({
        summaryProvider: (credential) => createOpenAIResponsesProvider({ apiKey: credential }),
        credential: credentials,
        credentialRequest: { provider: "openai", name: "apiKey" },
        summaryModel: cheapModel,
        providerOptions: { cacheRetention: "short", extra: { max_output_tokens: 4096 } },
        thinkingLevel: "low",
        customInstructions: "Focus on current files and failing tests.",
      });
      ```
    - Files to Create/Edit:
      - `packages/compaction-llm/src/prompts.ts`: added system, initial, update, and split-turn prompt text.
      - `packages/compaction-llm/src/strategy.ts`: added strategy factory, credential resolution, provider request construction, policy application, event collection, summary capping, and entry data creation.
      - `packages/compaction-llm/src/index.ts`: exported strategy helpers and types.
      - `packages/compaction-llm/src/__tests__/strategy.test.ts`: added normal, repeated, split-turn, custom instructions, cache/thinking/max-token, credential, abort, redaction, and provider-error tests.
      - `docs/compaction-llm.md`: documented strategy inputs/outputs/events/security.
      - `docs/compaction-and-retry.md`: already linked optional provider-backed strategy.
      - `docs/credentials-and-redaction.md`: added related link for per-call summary credential resolution.
      - `packages/compaction-llm/README.md`: added strategy usage examples.
    - Validation:
      - `npm run build --workspace=@prism/compaction-llm`: passed.
      - `npm run test --workspace=@prism/compaction-llm`: passed with live test skipped.
      - `npm run typecheck`: passed.
      - `command npm test`: passed with live tests skipped.
    - References:
      - `roadmap.md` Phase 13 deliverables: provider-backed summary options and provider-error acceptance.
      - Pi compaction prompt/source references listed above.
  - Test Cases to Write:
    - `llm_compaction_strategy_builds_provider_request_and_returns_compaction_entry`: implemented; validates normal summary, custom instructions, redacted prompt, request options, max tokens, and standard compaction entry data.
    - `llm_compaction_strategy_updates_previous_summary_and_split_turn_prefix`: implemented; validates update prompt includes prior summary, split-turn uses two calls, and merged split-turn section.
    - `llm_compaction_strategy_applies_policy_thinking_and_max_summary_tokens`: implemented; validates provider request policy, thinking option, model max tokens, and summary cap.
    - `llm_compaction_strategy_resolves_credential_per_call_without_storing_it`: implemented; validates provider factory receives credential and entries/details do not store it.
    - `llm_compaction_strategy_throws_on_provider_error_without_result`: implemented; validates provider errors throw before a result is returned.
    - `llm_compaction_strategy_observes_abort_signal`: implemented; validates abort throws before provider work/result.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds main package strategy API, provider request behavior, credential option, prompt format, and compaction entry details.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: strategy API, request/response examples, provider/model/cache/thinking/credential options, failure behavior, security/performance notes.
      - `docs/compaction-and-retry.md`: link optional provider-backed strategy and clarify core default remains local.
      - `docs/credentials-and-redaction.md`: add related link if credential resolver examples are referenced.
    - `docs/index.md` update: No if package page already linked; verify description says provider-backed/optional.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Wire package extension helpers and runtime integration tests
  - Acceptance Criteria:
    - Functional: Package exposes `createLlmCompactionExtension()` to register the strategy, direct strategy use works with `session.compact()`, existing `thresholdEntries` auto-compaction works when a host selects the strategy, branch summaries are preserved in summary input, raw history remains append-only, and failed/aborted summarization appends no entry.
    - Performance: Runtime tests use only `createMockProvider()`/small custom mock providers and memory stores; no live providers, timers beyond abort tests, filesystem stores, or long fixtures.
    - Code Quality: Extension wrapper is inert until a host loads it; tests prove no core default changes and no package code imports provider packages.
    - Security: Runtime tests verify secrets do not appear in provider requests, emitted compaction events, stored entries, README snippets, or docs fixtures.
  - Approach:
    - Documentation Reviewed:
      - `src/extensions.ts` `ExtensionAPI.registerCompactionStrategy()` and `docs/extensions.md` contribution inertness.
      - `src/agents.ts` manual/auto compaction, middleware payloads, active-run rejection, and append ordering.
      - `src/session-stores.ts` branch rebuild with compaction entries and `summary` entries.
      - `docs/agent-session-runtime.md`, `docs/contribution-registries.md`, `docs/middleware-hooks.md`, and `docs/session-stores-and-branching.md`.
      - Existing tests in `src/__tests__/agents.test.ts`, `src/__tests__/compaction.test.ts`, and provider workspace tests for `node:test` style.
    - Options Considered:
      - Add a new `defineCompactionPackage()` core primitive: rejected unless primitive review found a generic need; extension/direct factory covers package registration.
      - Add CLI/RPC compact commands here: rejected; Phase 9 already owns CLI/RPC and this package should stay SDK/package-level.
      - Use real provider packages in tests: rejected; mock providers are enough and faster.
    - Chosen Approach:
      - Implement a tiny extension wrapper that registers the configured strategy by name.
      - Add package runtime tests that create a Prism agent/session with memory store, mock main provider, mock summary provider, and selected compaction strategy.
      - Cover manual and auto paths through public `AgentSession` APIs only; do not modify core runtime unless the primitive review task proved a gap.
    - API Notes and Examples:
      ```ts
      import { createExtensionKernel, createAgent } from "prism";
      import { createLlmCompactionExtension } from "@prism/compaction-llm";

      const extension = createLlmCompactionExtension({ strategy });
      const kernel = createExtensionKernel();
      await kernel.load([extension]);
      const selected = kernel.registries.compactionStrategies.resolve(strategy.name);

      const agent = createAgent({ model, provider, compaction: { strategy: selected, thresholdEntries: 40 } });
      ```
    - Files to Create/Edit:
      - `packages/compaction-llm/src/extension.ts`: added extension factory.
      - `packages/compaction-llm/src/index.ts`: exported extension helper.
      - `packages/compaction-llm/src/__tests__/runtime.test.ts`: added direct, extension, manual, auto, branch-summary, raw-history, event, failure, abort, and redaction tests.
      - `packages/compaction-llm/README.md`: added manual and extension examples.
      - `docs/compaction-llm.md`: added runtime integration and extension examples.
      - `docs/extensions.md`: added related link for the optional LLM compaction extension helper.
    - Validation:
      - `npm run build --workspace=@prism/compaction-llm`: passed.
      - `npm run test --workspace=@prism/compaction-llm`: passed with live test skipped.
      - `npm run typecheck`: passed.
      - `command npm test`: passed with live tests skipped.
    - References:
      - `roadmap.md` Phase 13 acceptance: not core default, raw history append-only, failures do not corrupt branches.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `llm_compaction_extension_registers_strategy_in_contribution_registry`: implemented; validates extension wrapper inert contribution.
    - `session_manual_compact_with_llm_strategy_appends_compaction_entry`: implemented; validates direct runtime integration and event summary.
    - `session_auto_compact_with_llm_strategy_uses_existing_threshold_entries`: implemented; validates opt-in auto path before provider input.
    - `llm_compaction_preserves_raw_history_and_rebuilds_summary_plus_recent_messages`: implemented; validates append-only branch and context rebuild.
    - `llm_compaction_includes_branch_summary_entries_in_summary_input`: implemented; validates `kind: "summary"` branch context.
    - `llm_compaction_provider_error_appends_no_entry`: implemented; validates failure path leaves entries unchanged.
    - `llm_compaction_abort_appends_no_entry`: implemented; validates abort signal handling.
    - `llm_compaction_runtime_redacts_secret_from_events_and_store`: implemented; validates exact known-secret redaction for events and compaction entries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds package extension helper and documents runtime integration behavior.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: extension, manual, auto, branch, failure, and redaction examples.
      - `docs/extensions.md`: optional related link/example for package compaction strategy registration.
      - `docs/contribution-registries.md`: optional related link if package registry examples are updated.
    - `docs/index.md` update: No unless final link text needs correction.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify docs, package exports, boundaries, and pack output
  - Acceptance Criteria:
    - Functional: All Phase 13 package exports are documented, root/workspace builds and tests pass, package dry-run includes only `dist` and README, and docs link the new page from `/docs/index.md`.
    - Performance: Full default test suite remains network-free and under the roadmap target; no package setup performs provider calls, credential resolution, filesystem discovery, or live tests by default.
    - Code Quality: `npm run build`, `npm run typecheck`, `command npm test`, and `npm run pack:dry-run` pass; boundary tests guard that LLM compaction is not imported or selected by Prism core.
    - Security: Secret scans over docs/README/tests find only fake placeholders; tests prove known secrets are redacted from summary provider requests, events, and stored compaction entries.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`, `.agents/skills/create-plan/references/prism-wiki.md`, `docs/index.md`, `docs/compaction-llm.md`, `docs/compaction-and-retry.md`, and package README after implementation.
      - `package.json`, `package-lock.json`, `packages/compaction-llm/package.json`, package `exports`/`files`, and generated declarations.
      - Existing `src/__tests__/phase12-boundaries.test.ts` for package-boundary test style.
    - Options Considered:
      - Rely on package tests only: rejected; root boundary tests should catch docs/export/core-default drift.
      - Add live integration tests to default suite: rejected; live provider tests must stay opt-in.
      - Add API extractor or docs generator: rejected; TypeScript declarations and focused docs tests are enough.
    - Chosen Approach:
      - Add one root Phase 13 boundary test for package imports, docs links, minimal package metadata, skipped live test, no real-looking secrets, and no core default imports/strings.
      - Run root validation commands after implementation.
      - Fill this plan's closeout sections only after checks pass.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - `src/__tests__/phase13-boundaries.test.ts`: added package export, docs link, no-core-default, inert setup, live-test skip, package files, and secret scan checks.
      - `docs/compaction-llm.md`: verified final API page and extension/runtime examples.
      - `docs/compaction-and-retry.md`: verified optional related-link/core-default clarification.
      - `docs/index.md`: verified navigation link exists.
      - `packages/compaction-llm/README.md`: verified package examples and security notes.
      - `plans/016-llm-compaction-strategy.md`: marked tasks complete and filled closeout.
    - Validation:
      - `npm run build`: passed.
      - `npm run typecheck`: passed.
      - `command npm test`: passed with live tests skipped.
      - `npm run test --workspace=@prism/compaction-llm`: passed with `PRISM_LIVE_COMPACTION_TESTS` live smoke skipped.
      - `node --test dist/__tests__/phase13-boundaries.test.js`: passed.
      - `npm run pack:dry-run --workspace=@prism/compaction-llm`: passed and emitted `prism-compaction-llm-0.0.1.tgz` dry-run output.
      - `npm run pack:dry-run --workspaces --if-present`: passed.
    - References:
      - `roadmap.md` Phase 13 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `phase13_compaction_llm_imports_from_public_entrypoint`: implemented; imports package factory exports from built workspace output.
    - `phase13_compaction_llm_setup_is_inert`: implemented; extension/strategy creation does not call provider or resolve credentials until compaction runs.
    - `phase13_docs_index_links_compaction_llm_page`: implemented; validates docs navigation.
    - `phase13_package_exports_files_are_minimal`: implemented; validates package metadata and pack include list.
    - `phase13_live_tests_are_skipped_by_default`: implemented; validates `PRISM_LIVE_COMPACTION_TESTS` guard.
    - `phase13_core_does_not_default_to_llm_compaction`: implemented; scans core runtime/default compaction source for package import/default selection.
    - `phase13_no_real_secrets_in_docs_or_fixtures`: implemented; scans docs/package tests/README for real-looking tokens.
    - `npm run build`, `npm run typecheck`, `command npm test`, `npm run pack:dry-run`: final validation commands passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; finalizes package exports and docs for all Phase 13 public behavior.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: final API page.
      - `docs/compaction-and-retry.md`: final related API link and non-default note.
      - `docs/index.md`: final Compaction/session memory navigation entry.
    - `docs/index.md` update: Yes if link text is missing or stale; otherwise verify unchanged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Token counting remains a Pi-style chars/4 estimate with no tokenizer dependency; add provider-specific tokenizers only if real cut points are wrong enough to matter.
- Split-turn detection is heuristic and keeps the implementation pure/O(n); refine it only with failing real transcripts.
- Live provider coverage remains opt-in behind `PRISM_LIVE_COMPACTION_TESTS=1`; default validation stays mock-only and network-free.

## Further Actions
- Optional: add provider-specific README snippets after real provider packages expose preferred cheap summarization models.
- Optional: add live smoke examples for common providers, still skipped by default.
