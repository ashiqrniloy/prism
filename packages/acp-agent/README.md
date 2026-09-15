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

Real-provider configuration with credential reference:

```json
{
  "userId": "local",
  "cwd": ".",
  "model": { "provider": "openai", "model": "gpt-4o" },
  "credentialRef": "OPENAI_API_KEY",
  "sessionStore": { "type": "sqlite", "path": ".prism/sessions.db" },
  "mcp": { "allow": ["https://mcp.example.com"] },
  "modes": { "modes": [{ "id": "edit", "name": "Edit" }], "defaultModeId": "edit" },
  "configOptions": { "options": [{ "type": "boolean", "id": "verbose", "name": "Verbose", "defaultValue": false }] }
}
```

Explicit offline mock mode (no credentials needed):

```json
{
  "userId": "local",
  "cwd": ".",
  "model": { "provider": "mock", "model": "mock" }
}
```

| Key | Required | Description |
| --- | --- | --- |
| `userId` | yes | Ownership user id for every session. |
| `cwd` | yes | Workspace root the coding tools are bound to (must exist). |
| `model` | yes* | Model selection (`{ "provider": "<name>", "model": "<id>" }`). *Required unless `provider` is injected programmatically. |
| `credentialRef` | yes* | Credential reference (e.g. env var name) used to resolve API credentials. *Required when using a real provider without an injected provider instance. |
| `sessionStore` | no | `{ "type": "sqlite", "path" }` or `{ "type": "memory" }` (default). Durable SQLite stores support session agent reconstruction across restarts. |
| `mcp.allow` | no | URL origins or path-segment subtrees allowed for http/sse MCP servers; the marker `"stdio"` allows stdio servers. |
| `modes` | no | Mode table; `defaultModeId` must name a mode. |
| `configOptions` | no | Boolean or select options with `defaultValue`. |
| `limits` | no | AG-UI/ACP caps passthrough (see `AgUiLimitOptions`). |

### Provider Activation & Security

- **Supported providers**: `openai`, `anthropic`, `google`, `deepseek`, `openrouter`, `ollama`, `xai`, `zai`, `alibaba`, `kimi`, `clinepass`, `commandcode`, `neuralwatt`, `opencode-go`, `hyper`, and `mock`.
- **Lazy provider loading**: First-party provider adapters (`@arnilo/prism-providers/<adapter>`) are dynamically imported only on the first generation call. In mock mode, no provider package is ever evaluated.
- **Fail closed before startup**: Missing model configurations or unresolvable credentials fail immediately before startup with `ConfigError` rather than silently falling back to mock mode.
- **Credential safety**: Raw API keys never enter config persistence, argv, stdout protocol streams, events, or model context. Identity binds only the non-secret `credentialRef`.

### Programmatic usage

```ts
import { createSpawnableAgent, loadConfig } from "@arnilo/prism-acp-agent";

// Driven entirely by config (lazy real provider or explicit mock)
const agent = createSpawnableAgent({
  config: loadConfig("prism-acp-agent.json"),
  // Optional custom secret resolver (defaults to reading process.env[ref])
  credentialResolver: (ref) => secrets.get(ref),
});

// Or inject a provider instance directly (provider and model must match)
const customAgent = createSpawnableAgent({
  config: loadConfig("prism-acp-agent.json"),
  provider: myCustomProvider,
});
```

## Library surface

- `loadConfig(path)` / `parseConfig(text, baseDir)` — read and validate a config; throws `ConfigError` with a clear message.
- `createSpawnableAgent({ config, provider?, model?, credentialResolver? })` — build the ACP `AgentApp`.
- `selectMcpServers(allow, servers)` — the allow-list gate (exported for reuse).
- `SUPPORTED_PROVIDERS` — allow-list array of supported provider names.

## Development

```sh
npm run build --workspace @arnilo/prism-acp-agent
npm test --workspace @arnilo/prism-acp-agent
```
