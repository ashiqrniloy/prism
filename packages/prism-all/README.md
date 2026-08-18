# @arnilo/prism-all

Broad Prism umbrella. It installs **21 first-party packages (44 transitive)** across the coding, application SDK, provider, and persistence profiles.

## Install

```bash
npm install @arnilo/prism-all
```

## Included profiles

- `@arnilo/prism-code` — base runtime, compaction, JSON Schema validation, coding tools/security, and MCP
- `@arnilo/prism-sdk` — base runtime, workflows, MCP, Node credentials, and OpenTelemetry
- `@arnilo/prism-providers` — all eleven first-party provider adapters, including `@arnilo/prism-provider-neuralwatt`, plus AI SDK interoperability
- `@arnilo/prism-session-store-sqlite`, `@arnilo/prism-session-store-postgres`, and `@arnilo/prism-enterprise-postgres` (separate session/run versus enterprise-state compositions)
- `@arnilo/prism-evals`, `@arnilo/prism-memory`, `@arnilo/prism-rag`, `@arnilo/prism-policy`, `@arnilo/prism-model-router`, and `@arnilo/prism-work-tools`
- `@arnilo/prism-server`, `@arnilo/prism-supervisor`, host-selected `@arnilo/prism-web-tools`, optional `@arnilo/prism-browser`, optional `@arnilo/prism-ag-ui` (AG-UI root plus stable ACP sibling), and optional Azure/Bedrock/Vertex providers

Shared packages are deduplicated by npm. This is a pure manifest package with no exports; import APIs from their owning packages.

Installing this package does not activate providers, network transports/listeners, telemetry, database connections, memory, evaluations, delegation, or shell/filesystem tools. Hosts must explicitly configure and register those capabilities, including credentials, trusted roots, permissions, approval policies, and MCP transports.

## Smaller installs

| Need | Install |
| --- | --- |
| Minimal safe runtime | `@arnilo/prism-base` |
| Coding agent | `@arnilo/prism-code` + chosen provider |
| Application SDK | `@arnilo/prism-sdk` + chosen provider and persistence adapter |
| 11 of 14 first-party providers | `@arnilo/prism-providers` |
| Broad umbrella (44 transitive packages) | `@arnilo/prism-all` |

See [Release and install](../../docs/release-and-install.md) for atomic imports, package contents, limits, and release gates.
