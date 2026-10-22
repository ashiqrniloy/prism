# Changelog

## [Unreleased]

### Changed

- `trigger` (plan 157 Task 5): set it to a JSON-safe `CompactionTrigger` and the package registers it as the session's `compaction.when` handler, so the auto gate travels with the package instead of the host. Omitted, no handler is registered and the kernel's `compaction.thresholdEntries` fallback owns the decision. The model-ref config key now accepts a model object as well as a `"provider/model"` string (the outer schema node stays open so the `anyOf` branch validates the keys).

### Added

- `@arnilo/prism-memory-compaction` (plan 157 Task 3): the LLM summarization compactor moved out of
  `@arnilo/prism-memory`'s `./compaction/llm` subpath into a source-exported package on the lockstep
  line. The default export is a `definePackage` definition that claims the `compaction` slot and
  summarizes the dropped history with one model call per compaction, through
  `prism.models.client(config.model ?? ctx.session.model)`. Config: `{ model?, profile?, keepRecentTokens?, maxSummaryTokens?, summaryPrompt? }`.
  Installing the package is the opt-in; without it the kernel's deterministic compactor makes no
  model call.
- The `compaction.fallback` package event: a failed summary falls back to
  `prism.slots.compaction.default` with a redacted, bounded reason instead of failing the run or
  leaving the branch uncompacted. An aborted signal still propagates and appends nothing.
- The coding profile keeps the latest plan turn (`todo_write` result plus its call) out of the cut,
  so the plan survives any number of compactions.

### Removed

- `@arnilo/prism-memory`'s `./compaction/llm` subpath and the inert `llmCompaction` package. The
  moved module surface (`prepareLlmCompaction`, `serializeCompactionConversation`,
  `collectFileOperations`, the limits and token estimators, the prompts) stays available as named
  exports of the new package's modules for tests and hosts that build their own compactor.
- The `provider`, `summaryProvider`, `summaryModel`, `credential`, `credentialRequest`,
  `providerOptions`, `requestTransforms`, `thinkingLevel`, and `maxOutputTokens` compactor options.
  The model call is the kernel's (`models.client`), the credential is the credentials slot's, and
  the request budget is derived from `maxSummaryTokens`.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The LLM compactor shipped inside `@arnilo/prism-compaction-llm` and then `@arnilo/prism-memory`'s
`./compaction/llm` subpath before this package existed; see those packages' changelogs for the
pre-split history.
