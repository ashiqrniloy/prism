# @arnilo/prism-all

Complete Prism umbrella. It installs every first-party package through the coding, application SDK, provider, and persistence profiles.

## Install

```bash
npm install @arnilo/prism-all
```

## Included profiles

- `@arnilo/prism-code` — base runtime, compaction, JSON Schema validation, coding tools/security, and MCP
- `@arnilo/prism-sdk` — base runtime, workflows, MCP, Node credentials, and OpenTelemetry
- `@arnilo/prism-providers` — all seven first-party provider adapters: OpenAI, OpenCode Go, OpenRouter, Z.AI, Kimi, `@arnilo/prism-provider-neuralwatt`, and `@arnilo/prism-provider-ai-sdk`
- `@arnilo/prism-session-store-sqlite` and `@arnilo/prism-session-store-postgres`
- `@arnilo/prism-evals`, `@arnilo/prism-memory`, and `@arnilo/prism-rag`
- `@arnilo/prism-server`, `@arnilo/prism-supervisor`, host-selected `@arnilo/prism-web-tools`, optional `@arnilo/prism-browser`, and optional `@arnilo/prism-ag-ui` (AG-UI root plus stable ACP sibling)

Shared packages are deduplicated by npm. This is a pure manifest package with no exports; import APIs from their owning packages.

Installing this package does not activate providers, network transports/listeners, telemetry, database connections, memory, evaluations, delegation, or shell/filesystem tools. Hosts must explicitly configure and register those capabilities, including credentials, trusted roots, permissions, approval policies, and MCP transports.

## Smaller installs

| Need | Install |
| --- | --- |
| Minimal safe runtime | `@arnilo/prism-base` |
| Coding agent | `@arnilo/prism-code` + chosen provider |
| Application SDK | `@arnilo/prism-sdk` + chosen provider and persistence adapter |
| Every first-party provider | `@arnilo/prism-providers` |
| Everything | `@arnilo/prism-all` |

See [Release and install](../../docs/release-and-install.md) for atomic imports, package contents, limits, and release gates.
