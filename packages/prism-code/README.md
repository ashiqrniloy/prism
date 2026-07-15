# @arnilo/prism-code

Prism profile for coding agents: `@arnilo/prism-base`, host coding tools, coding execution security, and MCP integration.

```bash
npm install @arnilo/prism-code @arnilo/prism-provider-openai
```

This is a pure manifest package with no exports. Import APIs from their owning packages. Installing it does not register tools, start MCP transports, or grant filesystem/shell access. Hosts must configure trusted roots, permission and approval policies, transports, and a provider. See [Release and install](../../docs/release-and-install.md) for profile boundaries.
