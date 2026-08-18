# Spawnable ACP agent (`@arnilo/prism-acp-agent`)

New in 0.2.8 (plan 028 Task 10 / adoption F3). A thin binary that serves [`createPrismAcpAgent`](acp.md) over stdio from a config file — the wiring you would otherwise copy out of [`examples/acp-coding-host.ts`](../examples/acp-coding-host.ts) into every host.

## Running

```sh
npx prism-acp-agent [--config prism-acp-agent.json]
```

The agent speaks ACP v1 as newline-delimited JSON on `stdin`/`stdout` (SDK `ndJsonStream` adapter over `Readable.toWeb(process.stdin)` / `Writable.toWeb(process.stdout)`). It serves until the client closes stdin; an `EPIPE` on stdout (client disconnected) is a normal shutdown.

```sh
# a config file must exist; missing/invalid config fails closed with a clear error and exit 1
printf '%s\n' '{"userId":"local","cwd":"/workspace"}' > prism-acp-agent.json
npx prism-acp-agent
```

## Config reference

The config file is the trust boundary: unknown keys are rejected (a typo cannot silently disable a security-relevant option), every value is shape-validated, and relative paths resolve against the config file's directory.

| Key | Required | Description |
| --- | --- | --- |
| `userId` | yes | Ownership user id for every session (single-local-user `authorize`). |
| `cwd` | yes | Workspace root the coding tools are bound to (must be an existing directory). Sessions always operate on this root — a client-supplied `cwd` never moves the tools. |
| `sessionStore` | no | `{ "type": "sqlite", "path": ".prism/sessions.db" }` or `{ "type": "memory" }` (default). SQLite persists sessions, runs, checkpoints, and leases (`createSqlitePersistence`). |
| `mcp.allow` | no | MCP allow-list. http/sse servers must have a `url` starting with an allow entry; stdio servers require the marker `"stdio"`. The UNSTABLE `acp` transport is never approved. |
| `modes` | no | Mode table `{ "modes": [{ "id", "name", "description?" }], "defaultModeId"? }`; ids unique, `defaultModeId` must name a mode. |
| `configOptions` | no | `{ "options": [{ "type": "boolean" \| "select", "id", "name", "defaultValue", ... }] }`; ids unique. Select options are advertised/settable per the B3 gate (see [acp.md](acp.md)). |
| `limits` | no | AG-UI/ACP caps passthrough (`AgUiLimitOptions`). |

Example:

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

## What it wires

The binary is pure wiring (~200 lines) — no protocol code lives here. It builds:

- `authorize` — single local user; every inbound call is scoped by session id.
- `sessionFactory` — real Prism sessions over `createAgent` with the nine coding tools (`createCodingTools(config.cwd)`), durable `runState` (`interruptBeforeTool`, checkpoints), ownership-scoped to `userId`.
- `lifecycle` — `createAgentRunLifecycle` over the same checkpoint store, so approvals suspend/resume durably.
- `mcp` — allow-list `select` gate with http/sse transports.
- `modes` / `configOptions` — from config.
- Provider — **mock by default** (full lifecycle, no tokens). Wire a real provider programmatically:

```ts
import { createSpawnableAgent, loadConfig } from "@arnilo/prism-acp-agent";
import { createOpenAIResponsesProvider } from "@arnilo/prism-provider-openai";

const agent = createSpawnableAgent({
  config: loadConfig("prism-acp-agent.json"),
  provider: createOpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

## Library surface

- `loadConfig(path)` / `parseConfig(text, baseDir)` — read + validate; throw `ConfigError` (code `PRISM_ACP_AGENT_CONFIG`) with a clear message.
- `createSpawnableAgent({ config, provider? })` — build the ACP `AgentApp`.
- `selectMcpServers(allow, servers)` — the allow-list gate, exported for reuse in custom hosts.

## Security posture

- Config file = trust boundary: validated shape, no arbitrary code execution.
- MCP servers only from the allow-list; the UNSTABLE `acp` transport is never bridged.
- Coding tools are bound to `config.cwd` only; session ownership is fixed to `userId`.
- Session store paths are resolved against the config directory and fail closed on invalid config.
