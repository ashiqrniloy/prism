# Agent Client Protocol (ACP) coding-host interop

## What it does

`@arnilo/prism-ag-ui/acp` (stable ACP **v1**, `@agentclientprotocol/sdk@1.3.0` root exports only) exposes two adapters:

- `createPrismAcpAgent(options)` — serves ACP as an **agent**: an editor/AI client connects through the SDK transport and drives host-owned Prism sessions with `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/set_mode`, `session/set_config_option`, `session/list`, `session/delete`, `session/close`, and `session/cancel`. The agent is a thin protocol adapter: every capability, decision, and byte cap is wired from host seams, and there is **no second policy engine** on the agent side.
- `createAcpEventMapper(options)` — maps a Prism `AgentEvent` stream (or `CoWorkEvent`) to ACP `SessionUpdate`s for hosts that stream through their own transport.

The adapter builds on the Phase 8/9 shared machinery: redacted event projection (`AgUiProjection`), the durable pending-decision batch model (`allow_once` / `allow_for_run` / `reject_once` / `reject_for_run`), `AgentRunLifecycle` resume, `CodingLifecycleEvent` emission, and the AG-UI/ACP package caps. It never ships experimental ACP v2 or UNSTABLE fields (`providers`, `nes`, `positionEncoding`, `sessionCapabilities.fork`, `mcpCapabilities.acp/auth`, `elicitation` is consumed client-side only and never advertised).

## When to use it

Use `createPrismAcpAgent` when an editor/AI client already speaks ACP and you want it to reach host-owned Prism runs: text streaming, safe tool status, usage, four-outcome approvals, session persistence, modes, config options, and — when the client advertises them — editor-buffer filesystem (`fs/read_text_file`, `fs/write_text_file`) and terminal (`terminal/create` … `terminal/kill`) client methods, plus prompt media (`image`, `audio`, `embeddedContext`) and `elicitation` decisions.

Do **not** use it when the host needs a browser/TUI Web endpoint (use [AG-UI](ag-ui.md)), remote agent-to-agent tasks ([A2A](a2a.md)), or a full editor integration — ACP is a protocol adapter, not an editor, a TUI, or a credential provider.

## Inputs / request

`createPrismAcpAgent(options: CreatePrismAcpAgentOptions)` — every field is host-supplied:

| Option | Shape | Effect |
|---|---|---|
| `authorize` | `(input) => AcpAuthorization \| Promise` | **Required.** Ownership/identity gate for every inbound call, scoped by `sessionId`; unknown sessions fail. |
| `sessionFactory` | `(input) => AcpSessionBinding \| Promise` | **Required.** Builds the Prism `AgentSession` for `session/new`. Input carries `authorization`, `cwd`, `additionalDirectories`, `mcpServers` (policy-checked), `signal`, optional pre-generated `sessionId`, and `coding` (built client fs/terminal adapters when the client advertised them). |
| `lifecycle` | `AgentRunLifecycle` | **Required.** `status`/`resume`/`resumeStream` for durable `session/load` and `session/resume`. |
| `sessions?` | `AcpSessionStoreSeams` | `load` (advertises `sessionCapabilities.loadSession`), `list` (list), `delete` (delete), `resume` (resume), `additionalDirectories` (policy narrowing of `additionalDirectories`). `close` is always advertised. |
| `mcp?` | `AcpMcpSeams` | `transports: ("http" \| "sse")[]` and `select({ servers, signal })` — **required** for any client-supplied MCP server; select must approve before the bridge connects. Advertises `mcpCapabilities.http`/`sse` per transport. |
| `modes?` | `{ modes: AcpSessionMode[], defaultModeId? }` | `AcpSessionMode { id, name, description?, apply? }`; `apply({ sessionId?, fromModeId?, modeId, signal })` is the host hook run on switch. Advertised in `SessionModeState` on new/load/resume; enables `session/set_mode`. |
| `configOptions?` | `{ options: AcpConfigOption[], onChange? }` | `boolean`/`select` options with `defaultValue`; enables `session/set_config_option` (requires the client to advertise `session.configOptions.boolean`). |
| `capabilities?` | `AcpCapabilitiesOptions` | `prompt.media`/`prompt.embedded` policy seams, re-checked **live at prompt time**; presence advertises `promptCapabilities.image`/`audio`/`embeddedContext`. |
| `coding?` | `AcpCodingSeams` | `filesystem(client, sessionId)` / `processes(client, sessionId)` factories building `AcpClientFilesystem` / `AcpClientTerminals` over client methods; `lifecycle?: CodingLifecycleEmitter` subscribes `CodingLifecycleEvent`s into ACP updates. |
| `name?` | `string` | `agentInfo.name` (default `"Prism"`). |

Client capabilities are read at `initialize` and gate **client-method use**, not advertisement: `fs.readTextFile`/`writeTextFile` gate the fs seam, `terminal` the processes seam, `session.configOptions.boolean` the config path, `elicitation` the elicitation route.

## Outputs / response / events

`initialize` returns `{ protocolVersion, agentCapabilities, agentInfo }`; `agentInfo.version` comes from the package manifest. Advertised capability = a host seam is wired (pure function, no hand-maintained matrix): `loadSession`/`sessionCapabilities.*` iff the matching `sessions` seam exists (`close` always), `promptCapabilities.*` iff the matching `capabilities.prompt` seam exists, `mcpCapabilities.*` iff `mcp.select` + the transport are wired. Unadvertised agent methods fail naturally with JSON-RPC `-32601`; unadvertised client methods are never called.

In-stream `SessionUpdate`s:

| Prism event | ACP update |
|---|---|
| Assistant text | `agent_message_chunk` |
| Tool lifecycle | `tool_call` / `tool_call_update` (title/status/content) |
| Tool result, projected | `tool_call_update` with `locations` (≤ `acpLocationsPerUpdate`) and/or a `diff` block (≤ `acpDiffBytes`) — only from `AgUiProjection.toolLocations`/`toolDiff` allow-lists, at `finish()` |
| Provider usage / errors | `usage_update`, `error` |
| Durable suspension | `session/request_permission` with the four outcomes `allow_once` / `allow_for_run` / `reject_once` / `reject_for_run`; cancel, unknown options, and request failure deny. Sticky decisions expire at run end. |
| Elicitation suspension (all-elicitation batch + client advertised `elicitation`) | `elicitation/create` (form mode, bounded schema, redacted reason); `accept` → `allow_once` with the typed payload as `RunDecision.elicitation`, `decline`/`cancel` → `reject_once`. Otherwise falls back to the shared four-option permission path. |
| `file_changed` lifecycle | `tool_call_update` with `locations: [{ path }]` (needs a `toolCallId`; diff only from `fileDiff` allow-list, capped + redacted) |
| `worktree_changed` / process events | Projection-gated `agent_message_chunk` (deny-by-default: no `lifecycle` projection hook = no update) |
| `permission_denied` lifecycle | `tool_call_update` status `failed` (never raw args; synthesized id `prism:denied:<approvalId>` when no `toolCallId`) |
| `configuration_changed` lifecycle | `config_option_update` with the full current set, per streaming session |
| Session mode/config switch | `current_mode_update` / `config_option_update` |

Frozen caps (default / hard, from the Phase 10 freeze manifest): sessions 32/128, additional directories 8/32 (path 4 KiB/16 KiB), MCP servers 8/32 (config 16 KiB/256 KiB, header values 4 KiB/64 KiB), modes 16/64, config options 16/64, list page 20/100, diff bytes 64 KiB/1 MiB, locations per update 32/128, prompt media parts 16/64 and media bytes 64 KiB/1 MiB (shared AG-UI caps), terminal output chunks 51200 B/1 MiB (Phase 9 `process.outputChunkBytes`), stream events/bytes per AG-UI budgets. `session/load`/`session/resume` of a still-registered session rejects with `ERR_PRISM_ACP_INPUT` ("ACP session already exists"); model reconnect as resume of a pre-seeded stored session.

Errors surface as `AcpError` with codes `ERR_PRISM_ACP_INPUT` (malformed), `ERR_PRISM_ACP_LIMIT` (caps), `ERR_PRISM_ACP_POLICY` (host denied), `ERR_PRISM_ACP_CAPABILITY` (not advertised), `ERR_PRISM_ACP_MCP` (MCP bridging). Over the wire they become JSON-RPC `-32603` with the message in `data.details` (SDK behavior).

## Request/response example

```json
// initialize → agentCapabilities (all seams wired)
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": {},
    "sessionCapabilities": { "list": {}, "delete": {}, "additionalDirectories": {}, "resume": {}, "close": {} },
    "promptCapabilities": { "image": true, "audio": true, "embeddedContext": true },
    "mcpCapabilities": { "http": true, "sse": true }
  },
  "agentInfo": { "name": "Prism", "version": "0.0.27" }
}

// session/new response (modes + configOptions wired)
{ "sessionId": "acp-9f1c…", "modes": { "currentModeId": "edit", "availableModes": [{ "id": "edit", "name": "Edit" }] },
  "configOptions": [{ "type": "boolean", "id": "verbose", "name": "Verbose", "defaultValue": false, "currentValue": false }] }
```

## Implementation example

See [`examples/acp-coding-host.ts`](../examples/acp-coding-host.ts) (runs in the demo gate). The host owns all state and policy:

```ts
import { createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";

const agent = createPrismAcpAgent({
  authorize: ({ sessionId }) => (sessionId ? hostSessions.has(sessionId) : true)
    ? { ownership: { userId: "host-user" } }
    : false,
  sessionFactory: (input) => ({ session: hostSessionFor(input) }), // Prism AgentSession
  lifecycle: { status, resume, resumeStream },                     // durable
  sessions: { load, list, delete, resume, additionalDirectories }, // capability seams
  mcp: { transports: ["http", "sse"], select: ({ servers }) => approve(servers) },
  modes: { modes: [{ id: "edit", name: "Edit" }, { id: "review", name: "Review", apply: narrow }], defaultModeId: "edit" },
  configOptions: { options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }] },
  capabilities: { prompt: { media: async () => true, embedded: async () => false } },
  coding: { lifecycle, filesystem: clientFsAdapter, processes: clientTerminalAdapter },
});
// serve over the host's ACP transport: agent.connect(stream)
```

## Extension and configuration notes

- **Seam = capability.** Wiring `sessions.load` advertises `loadSession`; removing it withdraws the method. There is no separate capability flag to keep in sync — the freeze manifest's advertise-when matrix is enforced by construction and asserted by `scripts/phase10-conformance.test.mjs`.
- **Client fs/terminal are adapters, not a second implementation.** `AcpClientFilesystem` / `AcpClientTerminals` wrap the client's `fs/*` and `terminal/*` methods behind the Phase 9 `ProcessSession`-flavored interfaces; the agent pre-generates the session id so terminal requests can carry it. Host repo operations remain default when the client fs is absent.
- **Modes and config options are a pure host overlay.** The agent stores only a thin per-session registry; `apply`/`onChange` hooks narrow the host's own behavior. Mode switches can narrow or host-authorized widen — never a parallel policy evaluator, never a client-enabled tool.
- **Lifecycle wiring.** Pass your `createCodingLifecycleEmitter()` as `coding.lifecycle`; `file_changed` etc. then flow to streaming sessions. `configuration_changed` broadcasts `config_option_update` (agent-message fallback if the SDK rejects the kind).
- **Stream budgets.** Every lifecycle update counts against the same per-run stream event/byte budget as prompt updates; overflowing closes the update, never the run.

## Security and performance notes

- **Untrusted client input.** Client-supplied paths, `additionalDirectories`, MCP server configs, terminal env/args, and media are validated at the boundary: count/byte caps, ownership-scoped sessions, path policy via the `sessions.additionalDirectories` seam, MCP servers only through host `select` (never auto-connected), UNSTABLE `acp` transport always rejected.
- **Deny-closed by default.** Unknown mode ids, unadvertised methods, unprojected lifecycle events, oversize diffs/locations/media, thrown projection hooks, and failed elicitation all fail closed. Raw tool arguments/results are never sent unless a projection allow-list says otherwise.
- **No secrets.** Updates carry no raw file bodies, terminal output is capped by the Phase 9 chunk budget, and the shared redactor is applied before anything leaves the host. `permission_denied` never includes raw args.
- **Performance.** The adapter is O(1) per update with no unbounded buffering; p95 targets (fs round trip 250 ms, mode switch 250 ms, terminal chunk ack 1000 ms, prompt first update 2000 ms, prompt end 30 s) are recorded by `scripts/benchmark-0.0.27.mjs` and gated in `scripts/budgets.json` `phase10`.

## Related APIs

- [AG-UI](ag-ui.md): sibling frontend protocol; shared projection/redaction/caps and the same pending-decision model. This page is the full ACP reference.
- [Coding agent tools](coding-agent-tools.md): the `CodingLifecycleEvent` source mapped here; `@arnilo/prism-coding-agent` `process.outputChunkBytes` caps terminal chunks.
- [Agent events](agent-events.md): the durable `AgentEventSource`/replay story behind `session/load` and `session/resume`.
- [Host security guide](host-security.md): fail-closed checklist rows for ACP boundaries (authorize, ownership, redaction, untrusted MCP).
- [Migration guide](migration.md): 0.0.26 → 0.0.27 advertise/surface changes for hosts that parsed the old `initialize`.
- [AG-UI adoption evaluation](ag-ui-adoption.md): the underlying input/event/capability matrix.
