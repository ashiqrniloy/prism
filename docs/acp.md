# Agent Client Protocol (ACP) coding-host interop

## What it does

`@arnilo/prism-ag-ui/acp` (stable ACP **v1**, `@agentclientprotocol/sdk@1.3.0` root exports only) exposes two adapters:

- `createPrismAcpAgent(options)` — serves ACP as an **agent**: an editor/AI client connects through the SDK transport and drives host-owned Prism sessions with `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/set_mode`, `session/set_config_option`, `session/list`, `session/delete`, `session/close`, and `session/cancel`. The agent is a thin protocol adapter: every capability, decision, and byte cap is wired from host seams, and there is **no second policy engine** on the agent side.
- `createAcpEventMapper(options)` — maps a Prism `AgentEvent` stream (or `CoWorkEvent`) to ACP `SessionUpdate`s for hosts that stream through their own transport.

The adapter builds on the Phase 8/9 shared machinery: redacted event projection (`AgUiProjection`), the durable pending-decision batch model (keyed by the permission optionIds `allow-once` / `allow-for-run` / `reject-once` / `reject-for-run`), `AgentRunLifecycle` resume, `CodingLifecycleEvent` emission, and the AG-UI/ACP package caps. It never ships experimental ACP v2 or UNSTABLE fields (`providers`, `nes`, `positionEncoding`, `sessionCapabilities.fork`, `mcpCapabilities.acp/auth`, `elicitation` is consumed client-side only and never advertised; the UNSTABLE `plan` surface is consumed client-side only — `plan_update`/`plan_removed` are emitted solely to clients that advertised `ClientCapabilities.plan`, F5).

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
| `sessions?` | `AcpSessionStoreSeams` | `load` (advertises `sessionCapabilities.loadSession`), `list` (list), `delete` (delete), `resume` (resume), `additionalDirectories` (policy narrowing of `additionalDirectories`), `transcript` (F2: replay source for `session/load`/`session/resume`), `title` (F6: host-owned session titles — see below). `close` is always advertised. |
| `mcp?` | `AcpMcpSeams` | `transports: ("http" \| "sse")[]` and `select({ servers, signal })` — **required** for any client-supplied MCP server; select must approve before the bridge connects. Advertises `mcpCapabilities.http`/`sse` per transport. |
| `modes?` | `{ modes: AcpSessionMode[], defaultModeId? }` | `AcpSessionMode { id, name, description?, apply? }`; `apply({ sessionId?, fromModeId?, modeId, signal })` is the host hook run on switch. Advertised in `SessionModeState` on new/load/resume; enables `session/set_mode`. |
| `configOptions?` | `{ options: AcpConfigOption[], onChange? }` | `boolean`/`select` options with `defaultValue`; enables `session/set_config_option` (requires the client to advertise `session.configOptions.boolean`). **B3:** only `boolean` options are advertised in `session/new`/`load`/`resume` responses and `config_option_update`; `select` options are never settable — `set_config_option` on one fails with `ERR_PRISM_ACP_CAPABILITY` until the ACP spec defines a select capability. |
| `capabilities?` | `AcpCapabilitiesOptions` | `prompt.media`/`prompt.embedded` policy seams, re-checked **live at prompt time**; presence advertises `promptCapabilities.image`/`audio`/`embeddedContext`. `usage.contextWindow({ model, signal })` reports the model's context window in tokens; `usage_update` is emitted only when it returns a positive finite number — absent/undefined/throw ⇒ the update is omitted (never `size = used`). |
| `commands?` | `AcpCommandsSeam` | F9: `{ list({ sessionId, signal }) => AcpCommand[] }`. Presence emits `available_commands_update` on `session/new`, `session/load`, and `session/resume`. Absent seam ⇒ no update. |
| `coding?` | `AcpCodingSeams` | `filesystem(client, sessionId)` / `processes(client, sessionId)` factories building `AcpClientFilesystem` / `AcpClientTerminals` over client methods; `lifecycle?: CodingLifecycleEmitter` subscribes `CodingLifecycleEvent`s into ACP updates. |
| `name?` | `string` | `agentInfo.name` (default `"Prism"`). |

Client capabilities are read at `initialize` and gate **client-method use**, not advertisement: `fs.readTextFile`/`writeTextFile` gate the fs seam, `terminal` the processes seam, `session.configOptions.boolean` the config path, `elicitation` the elicitation route.

## Outputs / response / events

`initialize` returns `{ protocolVersion, agentCapabilities, agentInfo }`; `agentInfo.version` comes from the package manifest. Advertised capability = a host seam is wired (pure function, no hand-maintained matrix): `loadSession`/`sessionCapabilities.*` iff the matching `sessions` seam exists (`close` always), `promptCapabilities.*` iff the matching `capabilities.prompt` seam exists, `mcpCapabilities.*` iff `mcp.select` + the transport are wired. Unadvertised agent methods fail naturally with JSON-RPC `-32601`; unadvertised client methods are never called.

In-stream `SessionUpdate`s:

| Prism event | ACP update |
|---|---|
| Assistant text | `agent_message_chunk` |
| Assistant thinking | `agent_thought_chunk` (same `messageId` scheme as text; through the shared redactor and byte caps) |
| Tool lifecycle | `tool_call` / `tool_call_update` (title/status/content) — `tool_call.kind` comes from the session's tool registry `kind` metadata when present (B4), else the name heuristic |
| Tool result, projected | `tool_call_update` with `locations` (≤ `acpLocationsPerUpdate`) and/or a `diff` block (≤ `acpDiffBytes`) — only from `AgUiProjection.toolLocations`/`toolDiff` allow-lists, at `finish()`. `toolResult` may return a string (text content) or `{ type: "image", data, mimeType }` (F8) — the mapper wraps the image as `{ type: "content", content: { type: "image", data, mimeType } }` and drops payloads over `acpImageBytes` (never truncated). Opt-in turnkey: `createCodingToolProjection()` (F7) recognizes first-party `edit` (path + unified patch as `newText`, `firstChangedLine` location), `write` and `delete` (metadata path locations), and `move` (destination `metadata.to` location) results; moves never emit diffs, and default remains deny-by-default. |
| Provider usage | `usage_update` (only when the `capabilities.usage.contextWindow` seam reports a valid window — absent/undefined/throw ⇒ the update is omitted, never `size = used`) |
| Run-level failure | No transcript chunk — the `session/prompt` request rejects with `ERR_PRISM_ACP_RUN` (redacted, byte-capped message). Retryable provider-turn failures stay silent and may recover; only a terminal `error` event fails the request. |
| Run stop reason | `session/prompt` returns the SDK `StopReason` (F4): `cancelled` when the run was aborted, `max_turn_requests` for the tool-round ceiling (`finishReason: "turn_limit"`), `max_tokens` for `"token_limit"`, `refusal` for `"refusal"`, else `end_turn`. The generic `finishReason` field is set on `agent_finished` by loop strategies (single-shot records `turn_limit` at the `maxToolRounds` ceiling); `token_limit`/`refusal` have no core producer yet — the mapping is ready. |
| Durable suspension | `session/request_permission` with the four options `allow-once`→`allow_once`, `allow-for-run`→`allow_always`, `reject-once`→`reject_once`, `reject-for-run`→`reject_always` (optionId→SDK kind, as emitted by `permission-elicit.ts`); cancel, unknown options, and request failure deny. Sticky decisions expire at run end. |
| Elicitation suspension (all-elicitation batch + client advertised `elicitation`) | `elicitation/create` (form mode, bounded schema, redacted reason); `accept` → `allow_once` with the typed payload as `RunDecision.elicitation`, `decline`/`cancel` → `reject_once`. Otherwise falls back to the shared four-option permission path. |
| `file_changed` lifecycle | `tool_call_update` with `locations: [{ path }]` (needs a `toolCallId`; diff only from `fileDiff` allow-list, capped + redacted) |
| `worktree_changed` / process events | Projection-gated `agent_message_chunk` (deny-by-default: no `lifecycle` projection hook = no update) |
| `permission_denied` lifecycle | `tool_call_update` status `failed` (never raw args; synthesized id `prism:denied:<approvalId>` when no `toolCallId`) |
| `configuration_changed` lifecycle | `config_option_update` with the full current set, per streaming session |
| Plan lifecycle (F5, UNSTABLE-gated) | `plan_changed` → `plan_update` with `plan: { type: "items", planId = planPath, entries: [{ content, priority: "medium", status }] }` — the complete entry list per update (client replaces its plan wholesale); `plan_removed` → `plan_removed` with `planId = planPath`. Emitted only when the client advertised `ClientCapabilities.plan`; mapper stays capability-agnostic (gate in the agent wiring). Entries come from `writeCodingPlanFile`'s `onEvent` (parsed via `parseCodingPlanTodos`) or host-emitted through their `CodingLifecycleEmitter`; text passes the shared redactor and byte caps. |
| Session title (F6) | `sessions.title({ sessionId, prompt, signal })` resolves on `session/prompt`; a defined value differing from the last emitted title produces `session_info_update` with `{ sessionUpdate: "session_info_update", title }`. Best-effort: `undefined` or a throw means no title and no update (requests never fail on titles); the host owns title storage. Titles pass the shared redactor and are truncated at `maxTextBytes`/`maxEventBytes`. |
| Slash commands (F9) | `commands.list({ sessionId, signal })` on `session/new`/`load`/`resume` produces `available_commands_update` with `{ name, description, input?: { hint } }` (SDK `AvailableCommand`; description is required). Names/descriptions/hints pass the shared redactor and `maxTextBytes`; the list is sliced at `acpCommandsPerUpdate`. Best-effort: a throw or non-array omits the update (session start never fails on commands). |
| Session mode/config switch | `current_mode_update` / `config_option_update` |

Frozen caps (default / hard, from the Phase 10 freeze manifest): sessions 32/128, additional directories 8/32 (path 4 KiB/16 KiB), MCP servers 8/32 (config 16 KiB/256 KiB, header values 4 KiB/64 KiB), modes 16/64, config options 16/64, list page 20/100, diff bytes 64 KiB/1 MiB, locations per update 32/128, projected tool-result images `acpImageBytes` 256 KiB/1 MiB (F8; oversize dropped), slash commands `acpCommandsPerUpdate` 32/128 (F9), prompt media parts 16/64 and media bytes 64 KiB/1 MiB (shared AG-UI caps), terminal output chunks 51200 B/1 MiB (Phase 9 `process.outputChunkBytes`), stream events/bytes per AG-UI budgets. `session/load`/`session/resume` of a still-registered session rejects with `ERR_PRISM_ACP_INPUT` ("ACP session already exists"); model reconnect as resume of a pre-seeded stored session.

Errors surface as `AcpError` with codes `ERR_PRISM_ACP_INPUT` (malformed), `ERR_PRISM_ACP_LIMIT` (caps), `ERR_PRISM_ACP_POLICY` (host denied), `ERR_PRISM_ACP_CAPABILITY` (not advertised), `ERR_PRISM_ACP_MCP` (MCP bridging), `ERR_PRISM_ACP_RUN` (run-level failure — the `session/prompt` request rejects instead of emitting a fake `Agent error:` chunk). Over the wire they become JSON-RPC `-32603` with the message in `data.details` (SDK behavior).

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
- **Transcript replay (F2).** When `sessions.transcript` is wired, `session/load` and `session/resume` replay `user_message_chunk`/`agent_message_chunk` text chunks (from `SessionEntry`s with `kind: "message"` and a user/assistant role, text blocks only) before returning `sessionState`. Each chunk passes the shared redactor and is truncated at `maxTextBytes`; replay stops at `maxReplayEvents` chunks and counts against the stream event/byte caps (an oversized transcript fails the load/resume request closed). Absent seam = no replay, behavior unchanged.
- **Client fs/terminal are adapters, not a second implementation.** `AcpClientFilesystem` / `AcpClientTerminals` wrap the client's `fs/*` and `terminal/*` methods behind the Phase 9 `ProcessSession`-flavored interfaces; the agent pre-generates the session id so terminal requests can carry it. `createAcpFilesystemOperations` from `@arnilo/prism-coding-agent` maps that filesystem seam onto the coding tools' `read`/`write`/`edit` operations. This editor-buffer mode is intentionally hybrid: `repo_list`, `repo_search`, `glob`, `delete`, and `move` remain disk-backed unless the host supplies separate operations; binary/image/document handling never falls back to local disk. Host repo operations remain default when the client fs is absent.
- **Spawnable ACP coding registry (Task 6).** `@arnilo/prism-acp-agent` wires `createAcpClientFilesystem` and creates a separate coding tool registry per ACP session when the client advertises `fs/read_text_file` or `fs/write_text_file`. That session's `read`/`write`/`edit` operations use editor buffers; without fs advertisement, the existing disk registry is used. `shell`, repository search/list/glob, `delete`, and `move` remain disk-backed in this hybrid mode. Durable approvals resolve the same per-session agent, so one session cannot resume through another session's buffer adapter.
- **Modes and config options are a pure host overlay.** The agent stores only a thin per-session registry; `apply`/`onChange` hooks narrow the host's own behavior. Mode switches can narrow or host-authorized widen — never a parallel policy evaluator, never a client-enabled tool.
- **Lifecycle wiring.** Pass your `createCodingLifecycleEmitter()` as `coding.lifecycle`; `file_changed` etc. then flow to streaming sessions. `configuration_changed` broadcasts `config_option_update` (agent-message fallback if the SDK rejects the kind).
- **Stream budgets.** Every lifecycle update counts against the same per-run stream event/byte budget as prompt updates; overflowing closes the update, never the run.

### Persistence and ownership

- **Active-run recovery (0.2.6, plan 026 Task 5).** When `sessionStore` and the `recovery` seam (checkpoints + leases + ownerId, all three together) are wired, the agent records a bounded `activeRun` reference on `PersistedAcpSession` while a durable run is live (first run event → `running`, suspension → `suspended` + version, finish/deny/error → `terminal`; frozen 512-byte cap; advisory only — the authoritative status is re-queried from `AgentRunLifecycle.status`). After a restart, `restore` re-attaches the ref to the live session and hosts re-resolve it with `createAcpRunRecovery` (exported from `@arnilo/prism-ag-ui/acp`): suspended runs report their pending approval ids and durable version, terminal runs report terminal, and unprovable in-flight streams report `unknown` — the prompt is never restarted automatically. Durable cancellation (`recovery.cancel`) is ownership/version/fence checked, terminal/idempotent, aborts no unrelated run, and never replays a pending/dispatched tool: a cancelled run reports `cancelled` and must not be resumed. `session/cancel` on a live agent aborts the controller (0.2.5 parity) and, for restored runs, writes the durable marker under the session's ownership. Cancel markers live in `prism.coding-agent.cancel.v1` (schemaVersion 1, CAS + lease fenced). A host-side terminal whose managed process is unattestable after restart reports `unknown` (exitCode null); the agent never fabricates an exit or replays input (`terminal-client`).

- **Without the durability seam the agent never persists `modeId`/`configValues`.** Defaults are recomputed per session from the `modes`/`configOptions` seams — a fresh `session/new`, `load`, or `resume` always starts from `defaultModeId` / option `defaultValue`, and the agent's per-session registry is in-memory only. Persisting mode/config across sessions is a **host** decision, and host-side persistence MUST be ownership-scoped.
- **Host persistence MUST key by `sessions.ownership`.** `authorize` binds transport identity to ownership; a host store that persists `modeId`/`configValues` must refuse any restore whose stored ownership differs from the current session's ownership — a `sessionId` alone is never a sufficient key (session ids may collide across tenants). A cross-tenant restore rejects with `ERR_PRISM_ACP_INPUT` and never returns the other tenant's mode/config.
- **Ownership-scoped restore (host-owned store).** The store is keyed by `sessionId` and records the owning `userId`; restore refuses on mismatch (this exact pattern is asserted in `packages/ag-ui/src/__tests__/acp-modes-config.test.ts`):

  ```ts
  // Host-owned store; the agent is never asked to persist anything.
  class HostModeConfigStore {
    private readonly entries = new Map<string, { userId: string; modeId?: string; configValues: Record<string, boolean | string> }>();
    save(userId: string, sessionId: string, state: { modeId?: string; configValues: Record<string, boolean | string> }): void {
      this.entries.set(sessionId, { userId, ...state });
    }
    restore(userId: string, sessionId: string): { modeId?: string; configValues: Record<string, boolean | string> } | undefined {
      const entry = this.entries.get(sessionId);
      if (entry && entry.userId !== userId) {
        throw new AcpError("ERR_PRISM_ACP_INPUT", `mode/config load rejected: ownership mismatch for session '${sessionId}'`);
      }
      return entry; // absent or cross-tenant -> nothing restored, fail closed
    }
  }
  ```

  Because the agent recomputes defaults on every `load`/`resume`, a host that restores state re-applies it after load through the same gated seams (`session/set_mode`, `session/set_config_option` — both run the `apply`/`onChange` hooks) and must refuse cross-tenant loads at the `authorize` seam first (falsy `authorize` = `Unauthorized ACP session`, before any mode/config state is reachable).
- **Durable registry (0.1.6, plan 018 closeout `acp-session-store`).** Pass `sessionStore` (`AcpSessionStore` from `@arnilo/prism-ag-ui/acp`) to let a restarted agent restore its live-session registry: `save` (on `session/new`, `set_mode`, `set_config_option`), `loadAll` (once per agent instance, lazily on first authorized touch), `evict` (on `close`/`delete`). The stored entry carries `sessionId`, `ownership`, `modeId`, `configValues`, `cwd`, `additionalDirectories`, `updatedAt` — never ephemeral stream state (client/controller/budget) or pending decisions. Restore re-resolves the live `AgentSession` through your `sessionFactory`, re-validates cwd/directories and mode/config values against the seams, enforces the registry cap, and drops corrupt or seam-mismatched entries fail-closed. The seam is additive-only: absent `sessionStore` ⇒ the agent behaves exactly as 0.1.5. Storage topology stays host-owned; the store is the trust boundary for tampering/replay. The full threat model and test mapping live in `docs/_evidence/phase18-primitive-review.md`; enforcement tests in `packages/ag-ui/src/__tests__/acp-session-store.test.ts`. The host-owned mode/config store pattern above stays valid for hosts that persist without the agent seam.

## Security and performance notes

- **Untrusted client input.** Client-supplied paths, `additionalDirectories`, MCP server configs, terminal env/args, and media are validated at the boundary: count/byte caps, ownership-scoped sessions, path policy via the `sessions.additionalDirectories` seam, MCP servers only through host `select` (never auto-connected), UNSTABLE `acp` transport always rejected.
- **Deny-closed by default.** Unknown mode ids, unadvertised methods, unprojected lifecycle events, oversize diffs/locations/media, thrown projection hooks, and failed elicitation all fail closed. Raw tool arguments/results are never sent unless a projection allow-list says otherwise.
- **Slash commands (F9).** `commands.list` is a host-owned slash-command list (not derived from the tool registry). The agent emits `available_commands_update` on session start (`session/new`, `session/load`, `session/resume`). Mid-session refresh is not in this release — re-list by starting a session. Names, descriptions, and input hints pass the shared redactor; the list is sliced at `acpCommandsPerUpdate`. Absent seam or a thrown list ⇒ no update.
- **Projected images (F8).** `AgUiProjection.toolResult` may return `{ type: "image", data, mimeType }` (return-type widening — existing string returns stay valid). The mapper emits `{ type: "content", content: { type: "image", data, mimeType } }` (SDK v1 `ToolCallContent` has no top-level image variant). `data` is the host-supplied base64; it is not redacted and not truncated — payloads over `acpImageBytes` are dropped. Default (no hook / non-image return) emits no image.
- **Coding-tool projection (F7).** `createCodingToolProjection({ maxDiffBytes? })` is an opt-in `AgUiProjection` for first-party `@arnilo/prism-coding-agent` results: `edit` → `toolDiff` (`path` + unified `patch` as `newText`) and `toolLocations` (`path` + `firstChangedLine`); `write` and `delete` → `toolLocations` (`path` only); `move` → destination `toolLocations` (`metadata.to`, with `from` fallback). No delete/move diff is fabricated. Pass as `projection: createCodingToolProjection()` on the agent/mapper. Mapper still redacts and enforces `acpDiffBytes` / `acpLocationsPerUpdate`; optional `maxDiffBytes` pre-truncates the patch so a slightly-oversize edit is shortened instead of dropped. Without the factory, behavior is unchanged (deny-by-default).
- **No secrets.** Updates carry no raw file bodies, terminal output is capped by the Phase 9 chunk budget, and the shared redactor is applied before anything leaves the host. `permission_denied` never includes raw args.
- **Performance.** The adapter is O(1) per update with no unbounded buffering; p95 targets (fs round trip 250 ms, mode switch 250 ms, terminal chunk ack 1000 ms, prompt first update 2000 ms, prompt end 30 s) are recorded by `scripts/benchmark-0.0.27.mjs` and gated in `scripts/budgets.json` `phase10`.

## Related APIs

- [AG-UI](ag-ui.md): sibling frontend protocol; shared projection/redaction/caps and the same pending-decision model. This page is the full ACP reference.
- [Coding agent tools](coding-agent-tools.md): the `CodingLifecycleEvent` source mapped here; `@arnilo/prism-coding-agent` `process.outputChunkBytes` caps terminal chunks.
- [Agent events](agent-events.md): the durable `AgentEventSource`/replay story behind `session/load` and `session/resume`.
- [Host security guide](host-security.md): fail-closed checklist rows for ACP boundaries (authorize, ownership, redaction, untrusted MCP).
- [Migration guide](migration.md): 0.0.26 → 0.0.27 advertise/surface changes for hosts that parsed the old `initialize`.
- [AG-UI adoption evaluation](ag-ui-adoption.md): the underlying input/event/capability matrix.
- [Obscura browser engine](obscura.md): optional binary-backed generic tools behind the session prompt loop.
