# Changelog

## [Unreleased]

### Changed

- Task capture runs on `run.input` (it now receives the run id on its hook context) instead of re-reading the session branch from a `turn.before` hook: the validator pins the input the run was actually given, a mid-run steer cannot replace it, and no branch read is spent. Requires a kernel whose transform hooks carry `context.runId` (0.13.0 line, plan 191 follow-up).

### Added

- `@arnilo/prism-advisor` (plan 191 Task 8): a second model's advice and completion validation as one integration package.
  - The `advise` tool makes one `models.client` call, with no tools, over `selectTranscript(<branch>, context)` and the question; the result is the advice plus `[advisor: <model>, <tokens> tokens]`, capped by `adviceMaxChars` (4,000 default, 16,000 ceiling).
  - `triggers.beforeTools` consults before each named tool: a `revise` verdict denies the call with `Advisor: <advice>` as the result, and a retry of the same tool with the same arguments is allowed without a second consult, so a revise cannot loop.
  - `triggers.beforeFinish` reviews the final answer at the natural end of a run and continues with the advice as a steer.
  - `validate` adds completion validation on `run.end`: a captured (or inferred) task pinned into the slice, an `incomplete`/`complete` verdict from a model engine or a hidden `delegate` child through the `delegate` service, `missing` items as the continuation steer, and `unverified` after `maxRounds` (2 default, 10 ceiling). It fails closed: errors, timeouts, unparseable verdicts and an unavailable engine never yield `verified`.
  - Events: `advisor.consult` and `validator.verdict`, neither carrying the transcript, the advice, or the final answer. `maxConsultsPerRun` (3 default, 20 ceiling) caps consults per run; validation rounds are counted separately.
  - Every failure of an advisor consult allows the tool call or ends the run normally: an advisor outage cannot block work. `triggers.beforeFinish` and `validate` together are a config error, because the first `run.end` continuation wins.
