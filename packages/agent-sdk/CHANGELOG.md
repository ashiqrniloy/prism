# Changelog

## [0.1.0] - 2026-09-29

First published version (independent version line; the package never shipped under the lockstep `0.12.0` number).

### Changed

- `@arnilo/prism-coding-tools`, `@arnilo/prism-hooks`, and `@arnilo/prism-mcp` are required peers. The root entry imports all three statically (`codingPreset`, the hooks plane, and the MCP plane), so marking them optional let installs fail on the first import.

### Added

- New capability package (plan 134): `@arnilo/prism-agent-sdk` assembles a configurable agentic runtime over tool planes, skills discovery, instructions, MCP client bridges, hooks, session stores, host commands, and compaction strategies.
- `defineAgent()` systematic assembly returning `AgentSdkDefinition` with assembled agent, session factory, `connectedMcpServerIds`, host commands, and idempotent `dispose()`.
- `resolveToolPlane()` tool resolver pipeline: `planes -> exclude -> replace -> add` with stable index retention and configuration error reporting.
- Ready-to-use presets: `barePreset()` (minimal zero-tool runtime) and `codingPreset()` (canonical coding tools with AGENTS.md auto-load and opt-in git plane).
- `mergeAgentConfig()` for deep merging of tool configurations, planes, and host overrides.
- `parseAgentSdkConfig()` and `resolveJsonConfig()` with fail-closed key-path validation.
- Host commands registration (`commands: readonly CommandDefinition[]`) for host-only dispatch (not model-visible tools), with duplicate rejection fail-closed by default.
