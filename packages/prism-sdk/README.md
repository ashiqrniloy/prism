# @arnilo/prism-sdk

Prism application profile: `@arnilo/prism-base`, workflows, MCP integration, Node credential storage, and OpenTelemetry instrumentation.

```bash
npm install @arnilo/prism-sdk @arnilo/prism-provider-openai
```

This is a pure manifest package with no exports. Import APIs from their owning packages. Providers and persistence drivers remain explicit deployment choices; install one provider and, when needed, either `@arnilo/prism-session-store-sqlite` or `@arnilo/prism-session-store-postgres`. See [Release and install](../../docs/release-and-install.md) for profile boundaries.
