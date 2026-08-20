# Changelog

All notable changes to this package will be documented in this file.

## [0.3.0] - 2026-08-20

### Added

- Initial release of `@arnilo/prism-antigravity-agent` delegated agent adapter around official Antigravity CLI (`agy`).
- `createAntigravityCliAgent`: Factory for running headless `agy` subprocesses with per-run Prism MCP capability exposure and lifecycle management.
- `createAntigravityMcpExposure` and `createAntigravityMcpHttpServer`: Ephemeral run-bound MCP exposure and loopback Bearer token authenticated HTTP server.
- `writeEphemeralWorkspaceConfig` and `writeEphemeralAgentFile`: Atomic generation and restoration of `.agents/mcp_config.json`, `.agents/settings.json`, and `.agents/agents/<name>/agent.md`.
- `resolveToolPolicy`: Hybrid tool policy engine supporting `"prism-mutators"`, `"prism-only"`, and custom allow/deny rules.
- `runAntigravityCli`: ProcessSessions-backed subprocess runner with streaming NDJSON validation, duration formatting, and safe environment filtering.
- `diagnoseCliError`: Comprehensive diagnostics for authentication required, quota exhaustion, invalid models, and unhandled CLI flags with secret redaction.
- `createAntigravityConversationStore`: Session- and branch-isolated conversation continuation via explicit `--conversation <id>`.
- `createAntigravityEventProjector`: Projection of NDJSON stream events into Prism `AgentEvent`s, text deltas, and AG-UI activity snapshots with `thinkingTokens` counting.
- `createAntigravityDelegationTool`: Supervisor tool definition for delegating subtasks to Antigravity.

## [0.1.0] - 2026-08-09

### Added

- Initial release baseline.

## [0.0.28] - 2026-08-08

### Added

- Reserved package entry for the Antigravity delegated agent adapter.
