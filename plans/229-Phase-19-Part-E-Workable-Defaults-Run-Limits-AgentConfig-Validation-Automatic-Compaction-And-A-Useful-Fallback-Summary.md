# Phase 19 Part E — workable defaults: run limits, `AgentConfig` validation, automatic compaction, and a useful fallback summary

## Objectives

- Let an ordinary task finish on a default agent. `DEFAULT_RUN_LIMITS` (`src/run-limits.ts:13-24`) allows 16 turns, 8 tool rounds, 32 tool calls, 120 s, and 40,000 **cumulative** input tokens. Probe `p6-defaults`: a 12-round task failed at turn 7 on `maxInputTokens`.
- Reject a malformed `AgentConfig`. `createAgentWith` checks only three removed fields (`src/agent-session/create-agent.ts:72-80`); probe `p3b` passed `tools: [tool]`, got no error, and the model's call came back "Unknown tool".
- Compact before the provider rejects. With no configuration nothing triggers compaction: the kernel fallback needs `thresholdEntries` (`resolveAutoCompact`, `src/agent-session/session.ts:1043`), and `@arnilo/prism-extensions/compaction` registers a trigger only when configured (`packages/extensions/compaction/src/index.ts`).
- Make the no-model fallback summary worth having. `createDefaultCompactor` keeps the last 8 messages and the **first** 4,000 characters of everything older (`src/compaction.ts:18-19`), so the oldest text survives and recent progress is dropped.
- Let the LLM compactor summarize a history larger than its own model's window. It sends everything in one request (`summarizeHistory`, `packages/extensions/compaction/src/strategy.ts`), which fails in exactly the overflow case and falls back to the summary above.

## Expected Outcome

- Default limits sized for agent work: 50 turns, 50 tool rounds, 200 tool calls, 15 minutes, and no default cap on the token axes. Hosts still narrow them; `null` still disables.
- `createAgent` throws a `TypeError` naming the key for an unknown top-level key or a known key of the wrong shape.
- An agent whose model has a resolvable input cap compacts automatically at 80% of it, with no configuration. `compaction: false` disables it; a configured trigger or a `compaction.when` vote still wins.
- The default compactor keeps recent entries by a token budget, and its summary holds the first user request, the latest dropped progress, and the files and tools touched.
- The LLM compactor summarizes an oversized history in bounded chunks and merges them.

This plan implements roadmap **Phase 19 Part E**. It changes kernel defaults and contracts (limit defaults, config validation, the default compaction trigger, the default compactor's output), so **Task 1 is the phase review**. It runs after plan 228. No version bump or publish.

Cost knobs:
- Automatic compaction with the kernel default compactor makes no model call. With `@arnilo/prism-extensions/compaction` installed it costs one summary call per compaction, as today.
- Chunked summarization costs one call per chunk plus one merge call, capped at `maxChunks` (default 6); it runs only when the history does not fit one request. Both are stated in the package README.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Limits in use.** Every place a default limit is relied on or overridden: `apps/prism-agent/src/host/*.ts`, `packages/extensions/delegate/src/limits.ts:5-7` (child defaults 50 / 200 / 500,000 / 15 min), `workflows` agent nodes, examples, and the tests that pin `DEFAULT_RUN_LIMITS` values. How `maxProviderAttempts` is derived from `maxTurns` (`resolveRunLimits`).
      - (b) **What each axis counts.** Whether cache-read tokens count toward `maxInputTokens` and `maxTotalTokens` (`RunLimitTracker.recordUsage`), and how a clean `turn_limit` stop differs from a breach.
      - (c) **`AgentConfig` inventory.** Every field of `AgentConfig` (`src/contracts-core/agent.ts`) with its runtime type, and every existing runtime check (`create-agent.ts`, `resolveRunLimits`, `usageEstimation` in the session constructor, `loadPackages`). Which fields hold functions or instances and cannot be described by the kernel JSON Schema subset.
      - (d) **Compaction trigger resolution.** `resolveAutoCompact` (`src/agent-session/session.ts:1043-1090`), `resolveShouldCompact` and `CompactionTrigger` (`src/contracts-core/compaction.ts:48`, `:142`), `resolveInputCap` (`src/models/estimate.ts`), and the handlers that vote on `compaction.when` (compaction, context-engineering attention, the memory packages). What happens for a model with no declared window.
      - (e) **Who consumes the default compactor's summary text or `keepEntryIds`**: `snapshotFromBranch` (`src/session-stores.ts`), `compaction-conformance`, the LLM compactor's fallback (`withFallback`), `prepareLlmCompaction` (`packages/extensions/compaction/src/prepare.ts:31`).
      - (f) **Reference host evidence.** The compaction triggers plan 194 set from the measured rot curve (`docs/_evidence/context-rot-0.13.0.md`), so the kernel default does not contradict them.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change.
    - Security: Records which defaults are safety limits a host may be relying on implicitly, for the migration note.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (`AgentConfig`), §2.4 (`compaction.when`), §1.4 (fail closed on unknown config); `docs/agent.md`, `docs/slots.md` (compaction)
      - Plan 191 (child budgets), plan 194 (compaction that fires)
    - Options Considered:
      - Skip — rejected: (a) and (f) set the numbers.
    - Chosen Approach:
      - Inventory, then confirm or re-cut Tasks 2–6.
    - API Notes and Examples:
      ```bash
      graft grep "DEFAULT_RUN_LIMITS"
      graft callers resolveShouldCompact --depth all
      ```
    - Files to Create/Edit:
      - `plans/229-…md`: the task note
    - References:
      - Evaluation probes `p6-defaults`, `p3b`; findings K6, CP1–CP3
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Default run limits sized for agent work
  - Acceptance Criteria:
    - Functional:
      - `DEFAULT_RUN_LIMITS` becomes: `maxTurns: 50`, `maxToolRounds: 50`, `maxToolCalls: 200`, `maxWallTimeMs: 900_000`, `maxInputTokens: null`, `maxOutputTokens: null`, `maxTotalTokens: null`; byte limits unchanged; `maxProviderAttempts` keeps its derivation from `maxTurns` (Task 1(a) confirms the floor still leaves room for retries).
      - Resolution, narrowing, `null`, and validation rules are unchanged.
      - The delegate child defaults stay as they are, and the README says a child's defaults now equal the kernel's on the shared axes.
      - Every test and example that relied on a default is updated to set the limit it means.
    - Performance: n/a — constants.
    - Code Quality: The numbers live in one object; no second "recommended limits" table.
    - Security: `docs/migration.md` states that a host that relied on the old token defaults as a spend guard must set `maxTotalTokens` or `maxCost`. The changelog entry is under Changed, marked behavior-changing.
  - Approach:
    - Documentation Reviewed:
      - `src/run-limits.ts:13-24`, `:97-125`; `src/contracts-core/run-limits.ts`
      - `packages/extensions/delegate/src/limits.ts`
      - `docs/agent.md` (limits table)
    - Options Considered:
      - Keep the token defaults and exclude cache reads — rejected: a cumulative input cap still scales with turn count, not with spend.
      - No default limits at all — rejected: a runaway loop must end without host configuration.
    - Chosen Approach:
      - Bound runs by turns, calls and time by default; leave spend to `maxCost` and the token axes the host sets.
    - API Notes and Examples:
      ```ts
      createAgent({ model });                                   // 50 turns, 200 calls, 15 min
      createAgent({ model, limits: { maxCost: { amount: 2, currency: "USD" } } });
      ```
    - Files to Create/Edit:
      - `src/run-limits.ts`
      - `src/__tests__/run-limits.test.ts` and the tests Task 1(a) lists
      - `examples/*.ts` that depend on a default
      - `apps/prism-agent/src/host/*.ts`: only if a scenario relied on a default
    - References:
      - Probe `p6-defaults`
  - Test Cases to Write:
    - `default_limits_finish_a_twelve_round_task`: the probe now completes.
    - `default_limits_still_end_a_runaway_loop`: a provider that always calls a tool stops at the tool-round ceiling.
    - `default_token_axes_are_disabled`.
    - `host_token_cap_still_breaches`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — defaults
    - Docs pages to create/edit:
      - `docs/agent.md`: the limits table
      - `docs/migration.md`: the spend-guard note
      - `packages/extensions/delegate/README.md`: one sentence
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: `createAgent` rejects a malformed config
  - Acceptance Criteria:
    - Functional:
      - An unknown top-level `AgentConfig` key throws `TypeError` naming the key and the nearest known key when one is within edit distance 2.
      - A known key of the wrong shape throws `TypeError` naming the key and the expected shape. Covered at least: `tools` (object with `add: ToolDefinition[]`, and the fields plans 226 adds), `skills`, `packages` (array), `packageConfig`, `limits`, `retry`, `compaction`, `slots`, `disable`, `hooks` (function), `host`, `instructions`, `model`.
      - Each `tools.add` entry must have a string `name` and a function `execute`; each `skills.add` entry a string `name`.
      - The three removed-field messages stay.
      - `RunOptions` and `SessionOptions` get the same unknown-key check.
      - Validation runs before any package loads, so a bad config has no side effect.
    - Performance: One pass over the config object's own keys; no deep walk of tool schemas.
    - Code Quality: A table of key → checker, shared by the three option types where keys repeat; no JSON Schema for function-valued fields.
    - Security: Error messages name keys and expected shapes, never values (a config may hold a redactor's secrets).
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/agent.ts:50-140`, `src/agent-session/create-agent.ts:70-90`, `src/models/ref.ts` (`resolveRunOptions`)
      - `roadmap.md` §1.4 (unknown config key is an error)
    - Options Considered:
      - Validate with the kernel JSON Schema subset — rejected: half the fields are functions or instances.
      - Warn instead of throw — rejected: the roadmap rule is fail closed.
    - Chosen Approach:
      - A small hand-written checker table.
    - API Notes and Examples:
      ```ts
      await createAgent({ model, tools: [tool] } as never);
      // TypeError: AgentConfig.tools must be an object ({ add?: ToolDefinition[] }); received an array
      ```
    - Files to Create/Edit:
      - `src/agent-session/config-shape.ts`: new
      - `src/agent-session/create-agent.ts`, `src/models/ref.ts`, `src/agent/sessions.ts` (tentative — where `SessionOptions` is first read)
      - `src/__tests__/agent-config-shape.test.ts`: new
    - References:
      - Probe `p3b`
  - Test Cases to Write:
    - `tools_array_is_rejected_with_the_expected_shape`.
    - `unknown_key_names_the_nearest_known_key`: `tool` suggests `tools`.
    - `wrong_typed_known_keys_are_rejected`: table-driven over the list above.
    - `bad_config_loads_no_package`: a package's `setup` spy is not called.
    - `error_message_contains_no_config_value`.
    - `unknown_run_option_is_rejected`, `unknown_session_option_is_rejected`.
    - Every example and the reference host still construct their agents (the example execution gate and `bun run --filter @arnilo/prism-agent test`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new rejections
    - Docs pages to create/edit:
      - `docs/agent.md`: "Errors and security" — config shape errors
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Automatic compaction by default
  - Acceptance Criteria:
    - Functional:
      - With `AgentConfig.compaction` omitted, the kernel fallback trigger is `{ type: "input_ratio", ratio: 0.8 }`. `compaction: false` disables automatic compaction; an explicit `thresholdEntries` or trigger replaces the default.
      - `CompactionOptions.trigger` is accepted by the kernel fallback (today it reads `thresholdEntries` only).
      - The order of authority is unchanged: a `compaction.when` vote wins, the fallback applies only when every handler abstains.
      - A model with no resolvable input cap gets no default trigger and one `info` status note at agent creation; it does not throw.
      - Overflow recovery (plan 194) is unchanged and still covers a trigger that fires too late.
    - Performance: The trigger check reuses the turn's existing estimate; no added store read on a turn that does not compact.
    - Code Quality: One default constant beside `DEFAULT_RUN_LIMITS`-style defaults; no model-specific numbers in the kernel.
    - Security: n/a — no new trust boundary.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts:1043-1090`, `src/contracts-core/compaction.ts:48-60`, `:96-110`, `:142-170`
      - `docs/slots.md` (compaction), `docs/hooks.md` (`compaction.when`)
      - `docs/_evidence/context-rot-0.13.0.md`
    - Options Considered:
      - Default the trigger in `@arnilo/prism-extensions/compaction` only — rejected: an agent without the package would still never compact.
      - A fixed token threshold — rejected: windows differ by two orders of magnitude.
    - Chosen Approach:
      - A ratio of the model's own cap in the kernel fallback; packages keep overriding through `compaction.when`.
    - API Notes and Examples:
      ```ts
      createAgent({ model });                                               // compacts at 80% of the input cap
      createAgent({ model, compaction: false });                            // never automatically
      createAgent({ model, compaction: { trigger: { type: "input_ratio", ratio: 0.6 } } });
      ```
    - Files to Create/Edit:
      - `src/agent-session/session.ts`: `resolveAutoCompact`
      - `src/contracts-core/compaction.ts`: `CompactionOptions.trigger`, the default
      - `packages/extensions/compaction/src/index.ts`, `README.md`: with no `trigger`, the kernel default now applies
      - `src/__tests__/compaction-trigger.test.ts`, `compaction-when-abstain.test.ts`
      - `apps/prism-agent/src/host/*.ts`: unchanged if they set triggers; the 60-turn bounded-size scenario stays green
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding CP1; plan 194 Task 2
  - Test Cases to Write:
    - `default_agent_compacts_at_eighty_percent_of_cap`.
    - `compaction_false_never_auto_compacts`.
    - `explicit_threshold_replaces_the_default`.
    - `when_handler_veto_still_wins`.
    - `model_without_cap_gets_a_note_and_no_trigger`.
    - `compaction_package_without_trigger_uses_kernel_default`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default and an option
    - Docs pages to create/edit:
      - `docs/slots.md`: the compaction slot's default trigger
      - `docs/agent.md`: `compaction`
      - `packages/extensions/compaction/README.md`
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: The default compactor keeps what a continuing agent needs
  - Acceptance Criteria:
    - Functional:
      - The kept tail is chosen by a token budget (`keepRecentTokens`, default 20% of the input cap, floor 2,000) instead of a count of 8; `keepRecentEntries` still works when set. A tool result is never separated from its assistant tool call.
      - The summary is built from, in order: the first user message of the dropped span (the task), the last assistant text of the dropped span (latest progress), the files read and modified and the tool names used (from tool calls), and the newest remaining text up to the budget. It is capped at `maxSummaryChars` (default raised to 8,000) and marks what was cut.
      - Output remains a pure, synchronous function of the entries, with no model call.
      - `compaction-conformance` passes; `snapshotFromBranch` reads the result unchanged.
    - Performance: One pass over the dropped entries; no quadratic string building.
    - Code Quality: Section builders are small and separately tested; the file-operation extraction is shared with `packages/extensions/compaction/src/file-ops.ts` only if it can move to the kernel without importing a package (otherwise the kernel keeps its own minimal version, and the task note says so).
    - Security: `secrets` redaction still runs over the final summary.
  - Approach:
    - Documentation Reviewed:
      - `src/compaction.ts` (whole file), `src/testing/compaction-conformance.ts`
      - `packages/extensions/compaction/src/prepare.ts`, `file-ops.ts`
    - Options Considered:
      - Keep the newest 4,000 characters instead of the oldest — rejected: the original task statement would be lost.
      - Make a model call in the kernel default — rejected: that is the package's job, and the default must cost nothing.
    - Chosen Approach:
      - A structured extract: task, latest progress, touched files, then recent text.
    - API Notes and Examples:
      ```text
      Task: <first user message, cut to 1,500 chars>
      Latest progress: <last assistant text of the dropped span>
      Files modified: a.ts, b.ts   Files read: c.ts
      Tools used: read ×12, edit ×4, shell ×3
      Recent: <newest dropped text up to the budget> […N characters cut]
      ```
    - Files to Create/Edit:
      - `src/compaction.ts`
      - `src/__tests__/compaction.test.ts`, `mid-run-compaction.test.ts`
      - `src/testing/compaction-conformance.ts`: only if a case pinned the old text
    - References:
      - Evaluation finding CP2
  - Test Cases to Write:
    - `summary_keeps_first_user_request_and_latest_progress`.
    - `summary_lists_files_and_tools`.
    - `tail_is_chosen_by_token_budget`.
    - `tool_result_never_split_from_its_call`.
    - `summary_is_capped_and_marks_the_cut`.
    - `secret_in_dropped_text_is_redacted`.
    - `compaction_conformance_passes_for_the_default_compactor`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the default compactor's output and keep rule
    - Docs pages to create/edit:
      - `docs/slots.md`: what the default compactor keeps
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The LLM compactor summarizes a history larger than its model's window
  - Acceptance Criteria:
    - Functional:
      - When the serialized conversation's estimate exceeds the summary model's input cap less the output budget, the compactor splits the entries at message boundaries into chunks that fit, summarizes each in order (each call receives the previous chunk's summary), and returns the last summary. At most `maxChunks` calls (default 6, hard cap 16); beyond that it summarizes the newest `maxChunks` chunks and states the omission in the summary.
      - A history that fits is summarized in one call, byte-identical to today.
      - Text blocks and tool-call arguments are capped per block in the serialization (default 8,000 characters, with a cut marker), as tool results already are.
      - A failure in any chunk falls back as today (`compaction.fallback`, then the kernel default).
      - Each summary call passes the session (plan 225 Task 5), so it is metered.
    - Performance: Stated cost: `ceil(tokens / chunk)` calls, bounded by `maxChunks`. The README table gives the default and the per-compaction ceiling.
    - Code Quality: Chunking is a pure function over entries with its own tests.
    - Security: Redaction applies per chunk request and to the final summary.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/compaction/src/strategy.ts` (`summarizeHistory`, `runSummaryProvider`, `outputBudget`), `serialize.ts`, `prepare.ts`, `config.ts`
      - `src/models/estimate.ts` (`resolveInputCap`, `estimateTextTokens`)
    - Options Considered:
      - Summarize chunks independently and merge — rejected: one more call and the merge can itself overflow; a rolling summary cannot.
      - Truncate the conversation to fit — rejected: silently drops the middle of the work.
    - Chosen Approach:
      - A rolling summary across bounded chunks.
    - API Notes and Examples:
      ```jsonc
      { "name": "@arnilo/prism-extensions/compaction", "config": { "maxChunks": 6 } }
      ```
    - Files to Create/Edit:
      - `packages/extensions/compaction/src/strategy.ts`, `serialize.ts`, `config.ts`, `limits.ts`
      - `packages/extensions/compaction/src/__tests__/chunked-summary.test.ts`: new
      - `packages/extensions/compaction/README.md`
    - References:
      - Evaluation finding CP3
  - Test Cases to Write:
    - `history_that_fits_makes_one_identical_call`.
    - `oversized_history_is_summarized_in_rolling_chunks`: each request's estimate is under the cap.
    - `max_chunks_bounds_calls_and_states_omission`.
    - `long_text_block_is_capped_with_a_marker`.
    - `chunk_failure_falls_back_once`.
    - Package conformance from `@arnilo/prism/testing` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a config field and behavior on large histories
    - Docs pages to create/edit:
      - `packages/extensions/compaction/README.md`: `maxChunks`, the cost table
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/run-limits.test.ts src/__tests__/agent-config-shape.test.ts src/__tests__/compaction.test.ts src/__tests__/compaction-trigger.test.ts`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
