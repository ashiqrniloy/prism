# Changelog

## [Unreleased]

### Fixed

- The ledger fold reads the package's own log records off a branch (plan 157 Further Action 1). `state.log` keeps each record as one `package_state` entry whose payload is `data.value`, and `foldObservationalMemoryLedger` (via `recordData`) skipped that wrapper: a consumer holding only the branch — the memory fabric's `observational` source, a host projection, `coverage-helpers` — folded an empty ledger for a session the package had recorded. A `set` state value is still not read as a record.
- `foldObservationalMemoryLedger` no longer throws on a sourceless entry. The reopen-recovery fold maps a branch's entries through `recordData`, which yields a bare `undefined` for an entry with no `data` (any `message` entry); `isSessionEntry` then read `.kind` off it and crashed the context cache. It now skips anything that is not an object, which is what the fold's contract already said ("Anything else is skipped").

### Changed

- `context.trigger` replaces the token gate (plan 157 Task 5): set it to a JSON-safe `CompactionTrigger` and the package's `compaction.when` handler composes `resolveShouldCompact` with it instead of comparing `context.compactAfterTokens`. `om:model` also accepts `reset: true` (clear the stored worker refs so the session model is used again) and `om:status` reports the effective `observer`/`reflector` refs. The model-ref config keys now accept a model object as well as a `"provider/model"` string (the outer schema node stays open so the `anyOf` branch validates the keys).

### Added

- `@arnilo/prism-memory-observational` (plan 157 Task 4): observational memory as a package. The
  default export is a `definePackage` definition that owns everything the 0.12 lab coordinator did —
  the per-session toggle, the background observation pass, the ledger, `recall`, the context block,
  and the compaction slot — so the host imports nothing and wires nothing. The worker, ledger,
  recall, render, limits, settings, and type modules moved out of
  `@arnilo/prism-memory/compaction/observational-memory`; the 0.12 attach surface that stayed in the
  family for one task was deleted with the subpath in plan 157 Task 5.
- `capabilities: ["models", "session-state", "background", "slot:compaction"]` and the config
  `{ enabled?, observer?, reflector?, dropper?, context?, worker?, recall? }`. Off by default: with
  the toggle off, the `context.build`, `turn.completed`, and `compaction.when` handlers each return
  after one synchronous state read — no model call, no store write, no branch read.
- The `om`, `om:model`, `om:status`, and `om:view` commands, and the `om.status` package event
  (`{ enabled, observations, reflections, inFlight, lastError? }`) on toggle, pass start, pass end,
  and pass failure.
- Ledger-driven compaction: the `compaction` slot summarizes from the observations and reflections
  the session already holds instead of the raw transcript, and delegates to
  `prism.slots.compaction.default` when the session's toggle is off.
- `prism.state.session("om", …)` for the toggle and the `om:model` refs, and
  `prism.state.log("ledger")` for the append-only observation, reflection, and drop records, so a
  fork carries the ledger up to the fork point.

### Changed

- The worker loop takes a `ModelClient` instead of a `ModelProvider` + `ModelConfig` + credential:
  the model call, its provider, and its key are the kernel's (`prism.models.client`). The per-call
  output budget, `provider`, `credential`, `credentialRequest`, `settings`, `overrides`, `trigger`,
  `shouldCompact`, `debug`, `debugLog`, `passive`, and the flat per-worker knobs are gone; the
  canonical config keys are `observer` / `reflector` / `dropper`.
- Work scopes are deleted, not moved: the moved recall engine and renderer drop the shared-scope and
  scope-outline options, and `om:view` renders the session's own ledger only.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Observational memory shipped inside `@arnilo/prism-memory`'s `./compaction/observational-memory`
subpath before this package existed; see that package's changelog for the pre-split history.
