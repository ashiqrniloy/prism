# Changelog

## [Unreleased]

### Changed

- The `compaction.when` handler abstains (`undefined`) below `attention.compactRatio` instead of owning the decision (plan 194 Task 2), so a host trigger or the kernel `thresholdEntries` fallback still fires; past the ratio it asks for compaction as before.
- The fold stub now names the tool, the call id, and the original payload size and tells the model it may re-run the tool (plan 194 Task 4); the attention compiler's own stub is unchanged.
### Added

- `accounting` and `context.accounted` (plan 194 Task 5): one estimate pass per provider request with per-source counts (system, instructions, skills, history, tool results, folded, input, prefix blocks, tail blocks), counts and source names only. Any configured stage emits the event.
- `blocks.maxShare` (plan 194 Task 5): caps injected prefix and tail context blocks at a fraction of the model input cap, dropping whole blocks by lowest priority then latest-added and reporting each drop. Mutually exclusive with `budget`; the system prompt and instruction layers are never counted or dropped.
- `fold.clearAtLeastTokens`, `fold.keepLast` and `fold.excludeTools` (plan 194 Task 4): cache-aware fold batching with a per-session cleared-id frontier, so the provider prefix moves once per batch instead of once per turn. `0` keeps the previous per-turn behavior.
- `assertToolDisclosureConforms` and `ToolDisclosureConformanceOptions` (plan 158 Task 8): the tool-disclosure conformance helper moves here with the activation tool it asserts (the kernel's `@arnilo/prism/testing/tool-conformance` keeps the dispatch/validation probes). The package now also exports its own `ToolSearchState` type rather than reading the kernel's.


- `@arnilo/prism-context-engineering` (plan 158 Task 7): the four context-engineering stages as one
  package on the lockstep line, built from the retired kernel modules `context-budget.ts`,
  `tool-result-fold.ts`, `tool-search.ts`, `attention-compiler.ts`, and
  `contracts-core/attention.ts`. One `context.build` handler composes the configured stages in a
  fixed order — fold → tool search → attention or budget — at the lowest first-party priority, so a
  budget sees every block another handler added this turn. The kernel modules stay in place for one
  task (the plan's duplication window) and are deleted in Task 8.
- Config is `{ budget?, fold?, toolSearch?, attention? }`, every stage off unless configured. A
  package with no config registers no hook and no tool, so the request bytes are unchanged.
  `budget` and `attention` are mutually exclusive and fail the load with a message naming both.
- Budget: the whole draft is measured (messages, context blocks, tool declarations) and droppable
  rows are evicted oldest-first, tool results before other history, then the lowest-priority context
  block. The leading system block is the mandatory prefix — never dropped, and an unfittable prefix
  rejects the transform with the 0.12 `context budget exceeded: mandatory prefix cannot fit` message.
  `budget.reportOmissions` emits a `context.omissions` package event.
- Fold: old tool-result messages are rewritten in the provider view only. `summarize` is `"truncate"`
  (deterministic, no model call) or `{ model }` (one call per newly folded result, cached per session
  by tool-call id in the session's own state). The store keeps the full result.
- Tool search: `toolSearch.disclosure: "search"` narrows `draft.tools` to the activated and top-k set
  and registers `search_tools`. The index is built from `draft.tools`, so a tool the kernel hid with a
  `when` predicate or `disable.tools` can never be returned; activations are session state.
- Attention: the ported compiler strips old thinking and stubs old tool results past `triggerRatio`,
  fails closed with `AttentionBudgetError` when the gate still fires, keeps its sticky frontier and
  fold ledger in session state, and emits `attention.compiled` as a package event. `compaction.when`
  requests compaction past `compactRatio`.
- The algorithms are exported as a library (`applyDraftBudget`, `compileAttention`,
  `createAttentionCompiler`, `foldToolResultHistory`, `selectDisclosedTools`, the frontier and ledger
  codecs, and the truncation follow-up policy), so a host can compose its own handler.
- `RESERVED_TOOL_NAMES` drops `search_tools` (the kernel no longer generates it exclusively): the
  package owns the activation tool now, and the 0.12 run-assembly path that still appends its own
  `search_tools` fails closed with a duplicate tool when a host configures both.
- Two kernel helpers were dropped with the port rather than copied: `foldToolResults` /
  `foldToolResultValue` (an in-flight entry point whose age gate is always zero, so it never folds)
  and the kernel run-overlay helpers (`resolveRunAttentionCompiler`, `mergeAttentionRunOverlay`),
  whose run field is deleted in Task 8.

## [0.1.0] - 2026-08-09

### Added

- Initial package scaffold on the lockstep release line.

## [0.0.28] - 2026-08-08

### Added

- Package created in the pre-release manifest sweep.
