# Agent SDK

## What it does

The `@arnilo/prism-agent-sdk` package provides systematic, declarative agent runtime assembly from Prism seams.
A single `defineAgent()` call coordinates tool planes, skills discovery, instructions / `AGENTS.md`, MCP client bridges,
hooks, session stores, host-only commands, and compaction strategies into a coherent runtime agent and session factory.

Key contracts:
- **Tool-plane ordering contract**: Tools resolve strictly through the deterministic pipeline: `planes -> exclude -> replace -> add`. Within and across planes, tools preserve their declaration order. Exclusions remove named tools without disturbing survivors; replacements swap implementations in place at original indices; additions append after all planes.
- **Bare-loop guarantee**: Disabling every capability plane or using `barePreset()` produces the bare, unopinionated Prism loop with zero registered tools, zero auto-discovery, zero background network activity, and zero background workers.
- **Resilient MCP lifecycle**: MCP bridges connect in parallel during `defineAgent()`, each bounded by `connectTimeoutMs` (default 15 s). A failing or hanging server becomes a `failed` status entry instead of aborting startup; host `mcp.allow` exclusions become `disabled`. `AgentSdkDefinition.mcp.status` is the live per-server view, `reconnect(serverId)` re-bridges one server and updates the agent's tool registry for the next run, and `dispose()` idempotently tears down all bridges.
- **Host commands vs LLM tools**: Host-only commands (`commands: readonly CommandDefinition[]`) register exclusively for host UI and CLI dispatch (e.g. `/wiki-init`, `/compact`) and are never exposed as model-visible tools. Duplicate command registrations fail closed by default.

APIs:
- `defineAgent(config)`: Assembles tool planes, skills, instructions, MCP bridges, hooks, store, and commands.
- `resolveToolPlane(options)`: Resolves an array of `ToolDefinition`s through planes, exclude, replace, and add stages.
- `barePreset()`: Returns a minimal baseline config with zero tools and zero auto-discovery.
- `codingPreset(options)`: Returns a standard coding configuration with 9 canonical coding tools, `AGENTS.md` auto-loading, and opt-in git tools (`planes.git: true`).
- `mergeAgentConfig(base, override)`: Deep-merges agent configurations and tool planes without mutating inputs.
- `parseAgentSdkConfig(raw)` / `resolveJsonConfig(raw, context)`: Fail-closed JSON config validation and resolution with exact key paths.

## When to use it

Use `@arnilo/prism-agent-sdk` when building application hosts (such as Prism Code, CLI runners, or developer environments)
that configure tools, workspace skills, prompt layers, MCP servers, and hooks declaratively or from configuration files.

Do not use the SDK if your host requires an unopinionated minimal embed with fixed static dependencies and no configuration layer;
direct use of `createAgent` and `createAgentSession` from `@arnilo/prism` remains the foundation.

## Inputs / request

`defineAgent` accepts `AgentSdkConfig`:

| Field | Type | Description |
| --- | --- | --- |
| `model` | `ModelConfig` | **Required.** Provider and model identifier (`{ provider, model }`). |
| `provider` | `AIProvider` | Fixed provider adapter instance. Supply this **or** `providerSource`. |
| `providerSource` | `ProviderResolver` | Per-run provider resolver (`(model) => AIProvider \| undefined`). Use it when the host switches provider/model between runs: `RunOptions.providerSource` and `RunOptions.model` override it per run, whereas a fixed `provider` would win and shadow them. |
| `tools` | `ToolPlaneConfig` | Tool configuration: `planes`, `exclude`, `replace`, `add`. |
| `planes` | `Record<string, ...>` | Shorthand for `tools.planes`. |
| `exclude` | `readonly string[]` | Shorthand for `tools.exclude`. |
| `replace` | `Record<string, ToolDefinition>` | Shorthand for `tools.replace`. |
| `add` | `readonly ToolDefinition[]` | Shorthand for `tools.add`. |
| `workspaceRoot` | `string` | Base directory for skills, `AGENTS.md`, and relative paths. |
| `trust` | `TrustPolicy` | Path-trust policy gating filesystem reads and execution. |
| `skills` | `SkillsPlaneConfig` | Skills discovery configuration (`workspaceRoot`, `roots`, `exclude`, `add`, `activateAll`, `trust`). |
| `instructions` | `InstructionsPlaneConfig \| string` | Text instructions, `AGENTS.md` auto-load setting, and custom layers. |
| `mcp` | `McpPlaneConfig` | MCP servers (`stdio`, `url`, or a custom transport), host `allow` list, `connectTimeoutMs` default, and optional connector. |
| `hooks` | `HooksPlaneConfig` | Hooks configuration (`filePath`, `config`, `trusted`, `timeoutSeconds`). |
| `store` | `SessionStore` | Custom session store (defaults to in-memory store). |
| `loop` | `LoopStrategy \| LoopFactory` | Replaceable agent loop strategy or factory. |
| `compaction` | `false \| CompactionOptions` | Compaction strategy and threshold options. |
| `commands` | `readonly CommandDefinition[]` | Host-only commands registered for UI/host dispatch. |
| `duplicate` | `"replace" \| "error"` | Duplicate registration policy for tools and commands (defaults to `"error"` for commands). |
| `policy` | `PermissionPolicy` | Tool and action permission policy. |
| `limits` | `RunLimits` | Run limits (tool rounds, turns, tokens, timeouts). |

## Outputs / response / events

`defineAgent` returns an `AgentSdkDefinition`:

```ts
interface AgentSdkDefinition {
  /** The assembled Prism runtime agent. */
  readonly agent: Agent;
  /** IDs of successfully connected MCP servers (live view). */
  readonly connectedMcpServerIds: readonly string[];
  /** Live MCP plane status plus reconnect/close controls. */
  readonly mcp: AgentSdkMcpPlane;
  /** Host-only commands registered for direct execution. */
  readonly commands: readonly CommandDefinition[];
  /** Creates an AgentSession bound to the assembled agent. */
  createSession(options?: AgentSessionConfig): AgentSession;
  /** Idempotently closes all connected MCP client bridges. */
  dispose(): Promise<void>;
}

interface AgentSdkMcpPlane {
  readonly status: readonly McpServerStatus[];
  getServerTools(serverId: string): readonly ToolDefinition[];
  reconnect(serverId: string): Promise<McpServerStatus>;
  close(): Promise<void>;
}

interface McpServerStatus {
  readonly serverId: string;
  readonly state: "connected" | "failed" | "disabled";
  readonly toolCount: number;
  readonly error?: string;  // redacted runtime failure
  readonly reason?: string; // disabled policy reason
}
```

The returned `AgentSession` emits canonical Prism lifecycle events (`agent_started`, `turn_started`, `provider_turn_started`,
`message_started`, `message_delta`, `tool_call_started`, `tool_call_delta`, `tool_call_finished`, `provider_turn_finished`,
`message_finished`, `turn_finished`, `agent_finished`).

## Request/response example

JSON configuration parsed and validated with `parseAgentSdkConfig()`:

```json
{
  "tools": {
    "exclude": ["delete", "move"],
    "add": []
  },
  "instructions": {
    "agentsMd": true
  },
  "mcp": {
    "allow": ["https://api.githubcopilot.com"],
    "servers": [
      {
        "serverId": "github",
        "url": "https://api.githubcopilot.com/mcp/",
        "allow": "https://api.githubcopilot.com",
        "headers": { "Authorization": "Bearer host-resolved-token" }
      }
    ]
  },
  "hooks": {
    "filePath": ".prism/hooks.json"
  }
}
```

Parsing errors fail closed and return actionable key-path messages:

```json
{
  "error": "Invalid configuration at mcp.servers.github.allow: expected array of strings"
}
```

## Implementation example

```ts
import {
  type AgentEvent,
  type ToolRegistry,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerUsage,
} from "@arnilo/prism";
import {
  type AgentSdkConfig,
  codingPreset,
  defineAgent,
  mergeAgentConfig,
} from "@arnilo/prism-agent-sdk";

// Assemble a coding agent with canonical tools and mock provider
const app = await defineAgent(
  mergeAgentConfig(codingPreset({ cwd: process.cwd() }), {
    model: { provider: "mock", model: "assistant" },
    provider: createMockProvider([
      providerTextDelta("I am ready to help."),
      providerUsage({ inputTokens: 10, outputTokens: 6, totalTokens: 16 }),
      providerDone(),
    ]),
    instructions: "Follow repo conventions and test every change.",
  }) as AgentSdkConfig,
);

// Inspect active MCP connections and host commands
console.log("Connected MCP servers:", app.connectedMcpServerIds);
console.log("Registered host commands:", app.commands.map((c) => c.name));

// Create a session and execute a turn
const session = app.createSession();
const result = await session.run("Check workspace status");

// Clean up resources (closes all MCP bridges)
await app.dispose();
```

## Extension and configuration notes

### Skills plane: multi-root discovery and activation

`SkillsPlaneConfig` supports multi-root discovery (`roots`) with `origin` and `layout` ("flat" or "kind-dir"), plus automatic activation:

```ts
const app = await defineAgent({
  model,
  provider,
  skills: {
    roots: [
      { dir: "~/.agents/agent/skills", origin: "global", layout: "flat" },
      { dir: "~/.prism/agent/skills", origin: "global", layout: "flat" },
    ],
    workspaceRoot: "/path/to/repo",
    activateAll: true, // defaults to true when skills are registered, ensuring discovered skills render in the catalog
  },
});
```

### Resilient MCP plane: status, headers, and reconnect

`assembleMcpPlane` (and therefore `defineAgent`) connects every non-disabled server in parallel with a
per-server timeout. Connection failures do not reject assembly — they surface as status:

```ts
const app = await defineAgent({
  model,
  provider,
  mcp: {
    connectTimeoutMs: 15_000,            // plane default; each server may override it
    allow: ["stdio", "https://api.githubcopilot.com"], // host allow-list (ACP mcp.allow semantics)
    servers: [
      {
        serverId: "github",
        url: "https://api.githubcopilot.com/mcp/",
        allow: "https://api.githubcopilot.com",
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      },
      { serverId: "linear", url: "https://mcp.linear.app/mcp", allow: "https://mcp.linear.app", auth: oauthOptions },
      { serverId: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], allow: "stdio" },
    ],
  },
});

app.mcp.status; // [{ serverId: "github", state: "connected", toolCount: 12 }, { serverId: "fs", state: "failed", toolCount: 0, error: "…" }, …]
await app.mcp.reconnect("fs"); // closes the old bridge, reconnects, and swaps its tools in the registry
```

- **Config errors still fail closed**: an invalid per-server `allow` destination, a malformed `mcp.allow` entry, a duplicate `serverId`, or a non-positive `connectTimeoutMs` throws `AgentSdkConfigError` before any process or network activity.
- **Runtime failures never throw**: status carries a bounded, redacted message (header values, bearer tokens, and `token=`/`secret=` shapes are masked). `reconnect` reports the failure as `McpConnectError`.
- **Host policy stubs**: a spec with `disabledReason` is reported `disabled` with that reason and never validated against the allow policy or connected; `preflightError` is reported `failed` without connecting. Hosts use these for per-repo trust decisions and unresolved header references.
- **HTTP specs** accept `headers` (static request headers) and `auth` (an `McpClientAuthOptions` OAuth integration from `@arnilo/prism-mcp`), mapped onto the transport's `requestInit`/`auth`.
- **Reconnect swaps tools**: tools re-registered by `reconnect` are visible to the next run through the agent's tool registry (no agent rebuild). `getServerTools(serverId)` returns the current bridged definitions for one server (empty when unknown or not connected) so hosts can list or temporarily unregister them.

### Connected MCP status for host footers
`app.mcp.status` is the live per-server view (configuration order) for host interfaces such as status
footers. `app.connectedMcpServerIds` remains the list of currently connected server IDs, and both update
after `app.mcp.reconnect(serverId)`.

### Optional web tools composition
Web search and extraction tools from `@arnilo/prism-web-tools` integrate seamlessly via the tool plane:

```ts
import { createObscuraWebTools } from "@arnilo/prism-web-tools/obscura";

const obscura = createObscuraWebTools({ command: "/usr/bin/obscura", nativeTools: false });

const app = await defineAgent({
  model,
  provider,
  tools: {
    planes: {
      coding: codingPreset({ cwd }).tools?.planes?.coding,
      web: obscura.tools, // exposes unique web_search and web_fetch
    },
  },
});
```

Web tools remain inert until executed; no background network or binary initialization occurs during `defineAgent()`.

### Wiki commands composition
Workspace memory wiki commands from `@arnilo/prism-memory/wiki` can be supplied to `commands`:

```ts
import {
  createWikiInitCommand,
  createWikiIngestCommand,
  createWikiLintCommand,
  createWikiRefreshCommand,
} from "@arnilo/prism-memory/wiki";

const app = await defineAgent({
  model,
  provider,
  commands: [
    createWikiInitCommand({ workspaceRoot: cwd }),
    createWikiRefreshCommand({ workspaceRoot: cwd }),
    createWikiLintCommand({ workspaceRoot: cwd }),
    createWikiIngestCommand({ workspaceRoot: cwd }),
  ],
});
```

Commands execute strictly via host dispatch (`app.commands.find(c => c.name === "wiki-init").execute(...)`) and are never visible
to the language model as tool calls. Duplicate command names reject with an error at assembly time.

### Compaction and Observational Memory (OM)
Hosts supply compaction strategies through `config.compaction`:

```ts
import { createCodingCompactionStrategy } from "@arnilo/prism-memory/compaction/llm";

const app = await defineAgent({
  model,
  provider,
  compaction: {
    strategy: createCodingCompactionStrategy({ provider, model }),
  },
});
```

When attaching Observational Memory (`createObservationalMemory(...).attach(session)`), worker models and providers remain
completely independent of the main agent session model.

## Security and performance notes

- **Trust gating**: Filesystem paths for `skills` (`.agents/skills`), `instructions` (`AGENTS.md`), and `hooks` (`hooks.json`) are validated against `TrustPolicy`. Paths outside allowed roots fail closed and reject assembly.
- **MCP default-deny**: MCP servers require an explicit `allow` destination (`"stdio"` for local commands, the HTTP/HTTPS origin/subtree for URL servers). Wildcards or unauthorized origins/paths fail closed before launching processes or establishing HTTP connections, and an optional host `mcp.allow` list disables any server outside it.
- **Credential boundary**: The Agent SDK stores no credentials. API keys and OAuth tokens resolve strictly at the provider adapter or tool execution boundary.
- **Web data classification**: Web tool outputs carry `untrusted_external` provenance and preserve adapter-level egress policies.
- **Assembly performance**: Agent assembly is single-pass ($O(N)$ with respect to tool count and planes). No per-turn overhead is introduced over the raw Prism harness.
- **Config validation cost**: Configuration validation runs in $O(\text{config})$ time, failing immediately on the first illegal key path or mismatched type.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): Base `createAgent` and `createAgentSession` runtime.
- [Coding tools](coding-tools.md): Canonical coding tools and git planes.
- [Contribution registries](contribution-registries.md): Host registries for commands, tools, and providers.
- [Hooks](hooks.md): Event and lifecycle hooks compiled by the hooks plane.
- [MCP tools](mcp-tools.md): Model Context Protocol client bridges and security rules.
- [Web tools](web-tools.md): Search and fetch tools from Obscura, Brave, and Firecrawl.
- [Wiki](wiki.md): Workspace memory and wiki command definitions.
- [Observational Memory](compaction-observational-memory.md): Compaction strategies and background memory workers.
