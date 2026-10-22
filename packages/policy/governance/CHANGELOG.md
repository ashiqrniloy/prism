# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-governance` (plan 159 Task 6): the `packages/prism-core/src/governance/policy` surface (evaluator, OPA REST adapter, memory/file decision ledgers, approvals, audit export, canonical JSON, limits) moved out of `@arnilo/prism-core`'s `./governance/policy` and `./governance/policy/opa` subpaths, and composed into one package: a `tool.call` gate (deny by default, inline rules or OPA, `approval` → `{ ask }`), opt-in `run.input` / `model.request` gates, an observe-side audit ledger, and the `governance.policy` / `governance.audit` services.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
