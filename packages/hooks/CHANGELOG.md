# Changelog

## [0.9.0] - 2026-09-21

### Added

- New capability package (plan 106 R4): `parseHooksConfig()` validates the Claude flat
  and Codex `{ "hooks": { ... } }` shapes and rejects unknown events, unsupported
  handler types, shell interpolation, and bad timeouts with `ERR_PRISM_HOOKS_CONFIG`.
- `createHooksExtension()` compiles the config onto public seams — `session_start`
  context injection, `UserPromptSubmit` input guardrail, `PreToolUse`/`PostToolUse`
  middleware plus guardrails, and a `Stop` stop hook — with `command` handlers spawned
  shell-free and `mcp_tool` handlers delegating to a host-provided client.
- Hash-pinned handler trust (`hookCommandHash()`, host-configurable algorithm), a
  logged `"all"` escape hatch, seconds-based timeouts, Codex-style context spill to
  `<tmpdir>/hook_outputs/`, and detached `async` handler delivery.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package's first published version is 0.10.0, the lockstep cut that adds it to the release graph.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate 0.9.0.
