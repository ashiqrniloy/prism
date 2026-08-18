# @arnilo/prism-acp-agent

Spawnable ACP agent: a thin binary that serves [`createPrismAcpAgent`](https://github.com/ashiqrniloy/prism/tree/main/packages/ag-ui) over stdio from a config file.

The binary is pure wiring — every protocol detail lives in `@arnilo/prism-ag-ui`. It wires the common seams for a single-workspace, single-local-user deployment:

- `authorize` — single local user from config
- `sessionFactory` — real Prism sessions backed by the [coding tools](https://github.com/ashiqrniloy/prism/tree/main/packages/coding-agent) (`shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move`)
- session store — in-memory or [SQLite](https://github.com/ashiqrniloy/prism/tree/main/packages/session-store-sqlite) (sessions, runs, checkpoints, leases)
- MCP allow-list gate — http/sse servers must match a URL prefix; stdio servers require the `"stdio"` marker
- modes and config options tables

## Usage

```sh
npx prism-acp-agent [--config prism-acp-agent.json]
```

The agent speaks ACP over newline-delimited JSON on stdio. It serves until the client closes stdin.

### Config file

The config file is the trust boundary: unknown keys are rejected and invalid values fail closed with a clear error. Relative paths resolve against the config file's directory.

```json
{
  "userId": "local",
  "cwd": ".",
  "sessionStore": { "type": "sqlite", "path": ".prism/sessions.db" },
  "mcp": { "allow": ["https://mcp.example.com"] },
  "modes": { "modes": [{ "id": "edit", "name": "Edit" }], "defaultModeId": "edit" },
  "configOptions": [{ "type": "boolean", "id": "verbose", "name": "Verbose", "defaultValue": false }]
}
```

| Key | Required | Description |
| --- | --- | --- |
| `userId` | yes | Ownership user id for every session. |
| `cwd` | yes | Workspace root the coding tools are bound to (must exist). |
| `sessionStore` | no | `{ "type": "sqlite", "path" }` or `{ "type": "memory" }` (default). |
| `mcp.allow` | no | URL prefixes allowed for http/sse MCP servers; the marker `"stdio"` allows stdio servers. |
| `modes` | no | Mode table; `defaultModeId` must name a mode. |
| `configOptions` | no | Boolean or select options with `defaultValue`. |
| `limits` | no | AG-UI/ACP caps passthrough (see `AgUiLimitOptions`). |

The served agent uses the mock provider by default (full lifecycle, no tokens). Wire a real provider programmatically:

```ts
import { createSpawnableAgent, loadConfig } from "@arnilo/prism-acp-agent";
import { createOpenAIResponsesProvider } from "@arnilo/prism-provider-openai";

const agent = createSpawnableAgent({
  config: loadConfig("prism-acp-agent.json"),
  provider: createOpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

## Library surface

- `loadConfig(path)` / `parseConfig(text, baseDir)` — read and validate a config; throws `ConfigError` with a clear message.
- `createSpawnableAgent({ config, provider? })` — build the ACP `AgentApp`.
- `selectMcpServers(allow, servers)` — the allow-list gate (exported for reuse).

## Development

```sh
npm run build --workspace @arnilo/prism-acp-agent
npm test --workspace @arnilo/prism-acp-agent
```
