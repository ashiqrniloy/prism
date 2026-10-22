# Changelog

## [Unreleased]

### Added

- Added a `command` scheduler target: `{ kind: "command", agent, command, input }` runs one registered package command on the schedule session with no model turn, no prompt, and no agent loop, so a maintenance-style pass (`memory:maintain`) can be scheduled like any other job. The firing status comes from the command's result (`status` from the run vocabulary, else `ok: false` ⇒ `failed`, else `completed`); a throw records `failed` without persisting the error or the result. Registration fails closed with the new `unknown_command` when the command is not registered on the target agent.

- Added `resumeWhenAnswered`, `createResumeAuthority`, authoritative branch-tip recovery, and guarded remote/router resume composition.

### Added

- Ordered `routeHostUi` routing with explicit kind limits, timeouts, a fail-closed `policyDefault`, and bounded, value-free answer logging with optional ownership-scoped checkpoint persistence.
