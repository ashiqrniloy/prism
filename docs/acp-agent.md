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
| `model` | yes* | Model selection `{ "provider": "<name>", "model": "<id>" }`. Supported providers: `openai`, `anthropic`, `google`, `deepseek`, `openrouter`, `ollama`, `xai`, `zai`, `alibaba`, `kimi`, `clinepass`, `commandcode`, `neuralwatt`, `opencode-go`, `hyper`, and `mock`. *Required unless `provider` is passed programmatically. |
| `credentialRef` | yes* | Reference (env var name or host secret identifier) used to resolve API credentials. *Required when using a non-mock provider without an injected provider instance. |
| `sessionStore` | no | `{ "type": "sqlite", "path": ".prism/sessions.db" }` or `{ "type": "memory" }` (default). SQLite persists sessions, runs, checkpoints, and leases (`createSqlitePersistence`), and supports session agent reconstruction across restarts. |
| `mcp.allow` | no | MCP allow-list. http/sse servers must match an allow origin or path-segment subtree; stdio servers require the marker `"stdio"`. The UNSTABLE `acp` transport is never approved. |
| `modes` | no | Mode table `{ "modes": [{ "id", "name", "description?" }], "defaultModeId"? }`; ids unique, `defaultModeId` must name a mode. |
| `configOptions` | no | `{ "options": [{ "type": "boolean" \| "select", "id", "name", "defaultValue", ... }] }`; ids unique. Select options are advertised/settable per the B3 gate (see [acp.md](acp.md)). |
| `limits` | no | AG-UI/ACP caps passthrough (`AgUiLimitOptions`). |

Real-provider example:

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

Explicit offline mock mode example:

```json
{
  "userId": "local",
  "cwd": ".",
  "model": { "provider": "mock", "model": "mock" }
}
```

## What it wires

The binary is pure wiring (~200 lines) — no protocol code lives here. It builds:

- `authorize` — single local user; every inbound call is scoped by session id.
- `sessionFactory` — real Prism sessions over `createAgent` with the nine coding tools (`createCodingTools(config.cwd)`), durable `runState` (`interruptBeforeTool`, checkpoints), ownership-scoped to `userId`. When the client advertises filesystem capabilities, a per-session agent with client-backed buffer tools is constructed and bound to the session id.
- `lifecycle` — `createAgentRunLifecycle` over the same checkpoint store. Durable SQLite checkpoints enable interrupted runs and approval state to be reconstructed across restarts with the selected model and provider intact.
- `mcp` — allow-list `select` gate with origin- and path-segment subtree checking for http/sse transports.
- `modes` / `configOptions` — from config.
- Provider — **fail closed before startup**. Unlike earlier releases where missing configuration silently defaulted to mock mode (Trap C), Prism 0.7.0 requires either an explicit `model` in config or an injected provider. For real providers, credentials are resolved lazily on demand via dynamic import of `@arnilo/prism-providers/<adapter>`. Offline mock mode must be explicitly specified (`model: { provider: "mock", model: "mock" }`).

Programmatic usage:

```ts
import { createSpawnableAgent, loadConfig } from "@arnilo/prism-acp-agent";

// Driven by config with optional custom credential resolver
const agent = createSpawnableAgent({
  config: loadConfig("prism-acp-agent.json"),
  credentialResolver: (ref) => process.env[ref],
});

// Or programmatic provider override (must match config.model.provider)
const customAgent = createSpawnableAgent({
  config: loadConfig("prism-acp-agent.json"),
  provider: customProvider,
});
```

## Library surface

- `loadConfig(path)` / `parseConfig(text, baseDir)` — read + validate; throw `ConfigError` (code `PRISM_ACP_AGENT_CONFIG`) with a clear message.
- `createSpawnableAgent({ config, provider?, model?, credentialResolver? })` — build the ACP `AgentApp`.
- `selectMcpServers(allow, servers)` — the allow-list gate, exported for reuse in custom hosts.
- `SUPPORTED_PROVIDERS` — list of supported provider adapter identifiers.

## Security posture

- Config file = trust boundary: validated shape, no arbitrary code execution.
- MCP servers only from the allow-list; the UNSTABLE `acp` transport is never bridged.
- **Origin and path-segment destination matching**:
  - Exact origin matching normalizes scheme, hostname (punycode IDN), and effective port (e.g. 443 on https). Lookalike hosts (`https://mcp.example.com.attacker.invalid`) are strictly rejected.
  - Path matching enforces exact path or path-segment subtree: `https://mcp.example.com/mcp` admits `/mcp`, `/mcp/`, and `/mcp/sub`, but rejects `/mcp-other` and `/other`.
  - Config entries with credentials (`user:pass@`), query parameters, fragment identifiers, or ambiguous path forms (`%2e%2e`, `%2f`, `%5c`, `..`, backslashes) fail validation.
  - Candidate URLs embedding credentials or ambiguous encoded path forms fail closed at selection.
  - Stdio servers require the explicit `"stdio"` marker; URL entries cannot authorize `stdio` processes, and `"stdio"` cannot authorize remote servers.
- Coding tools are bound to `config.cwd` only; session ownership is fixed to `userId`.
- Session store paths are resolved against the config directory and fail closed on invalid config.
- **Credential isolation**: Secret values never enter config persistence, argv flags, stdout protocol streams, events, or model context. Identity carries only the non-secret `credentialRef` name.
- **Trust model**: The ACP agent config is designed as a single-local-user trust boundary (workstation / editor agent), not a multi-tenant business boundary. Cross-tenant credential sharing or multi-user elevation must not be multiplexed through a single spawnable ACP agent process.
