# Prism extensions

Context, credentials, integrations, policy and durable stores for Prism agents.

```sh
bun add @arnilo/prism @arnilo/prism-extensions
```

Import only the subpaths your host lists. Each default export is a Prism package except `store-codecs` and `workflows/testing`, which are libraries. The bundle root has no export.

| Subpath | Package page |
| --- | --- |
| `@arnilo/prism-extensions/context-engineering` | [context-engineering](context-engineering/README.md) |
| `@arnilo/prism-extensions/context-files` | [context-files](context-files/README.md) |
| `@arnilo/prism-extensions/keyring` | [keyring](keyring/README.md) |
| `@arnilo/prism-extensions/advisor` | [advisor](advisor/README.md) |
| `@arnilo/prism-extensions/delegate` | [delegate](delegate/README.md) |
| `@arnilo/prism-extensions/hooks-json` | [hooks-json](hooks-json/README.md) |
| `@arnilo/prism-extensions/mcp` | [mcp](mcp/README.md) |
| `@arnilo/prism-extensions/observability` | [observability](observability/README.md) |
| `@arnilo/prism-extensions/workflows` | [workflows](workflows/README.md) |
| `@arnilo/prism-extensions/approval` | [approval](approval/README.md) |
| `@arnilo/prism-extensions/governance` | [governance](governance/README.md) |
| `@arnilo/prism-extensions/guardrail-packs` | [guardrail-packs](guardrail-packs/README.md) |
| `@arnilo/prism-extensions/model-router` | [model-router](model-router/README.md) |
| `@arnilo/prism-extensions/store-codecs` | [store-codecs](store-codecs/README.md) |
| `@arnilo/prism-extensions/store-jsonl` | [store-jsonl](store-jsonl/README.md) |
| `@arnilo/prism-extensions/store-postgres` | [store-postgres](store-postgres/README.md) |
| `@arnilo/prism-extensions/store-sqlite` | [store-sqlite](store-sqlite/README.md) |
| `@arnilo/prism-extensions/compaction` | [compaction](compaction/README.md) |

`@arnilo/prism-extensions/workflows/testing` exports workflow test helpers.

## Optional peers

Install these only for the subpath you use:

| Subpath | Install |
| --- | --- |
| `keyring` (OS backend) | `bun add @napi-rs/keyring` |
| `mcp` | `bun add @modelcontextprotocol/client zod` |
| `observability` | `bun add @opentelemetry/api` |
| `store-postgres` | `bun add pg` |

Without the peer, package setup records a status note and registers no integration. Keyring preserves its fail-closed resolver: `keyring:` reads return undefined, writes refuse, and `env:` refs still delegate. Its encrypted-file backend needs no native peer. A supplied Postgres pool needs no `pg` peer. Observability also needs a host-owned telemetry SDK to export data.
