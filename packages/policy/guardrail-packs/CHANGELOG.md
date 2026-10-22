# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-guardrail-packs` (plan 159 Task 5): the built-in guardrail packs (`coding-standard`, `destructive-commands`, `validation-respect`, `secrets-hygiene`) moved out of the kernel, as restrictive-only `tool.call` / `tool.result` rules with their state in `state.session("packs")` so an `ask` rule survives a durable resume. Pack refs are package config (`guardrailPacks({ packs })`), not a `SessionOptions.guardrailPacks` session option.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
