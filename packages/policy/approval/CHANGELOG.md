# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-approval` (plan 154 Task 6): `deny` / `ask` / `edits` / `auto` over tool effects and roots, as one `tool.call` handler. An `ask` confirms through `host.ui` or suspends the run. An always answer is a follow-up `select` stored as a per-session grant.

### Changed

- The `tool.call` handler passes the payload's `sessionId` to `coding.targets` (plan 165 Task 7), so "inside roots" follows the calling session: a session bound to a worktree reports that worktree as its root, and a write to the package root from that session counts as outside. Sessions with no worktree are unchanged.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
