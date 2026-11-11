# Changelog

## [Unreleased]

Consolidate ten host and driver workspaces into `@arnilo/prism-hosts` subpaths. Preserve library exports, protocol caps, authentication, sandboxing and both executable bins. Host-builder indexes and the installer use bundle specifiers. Versions remain in lockstep with the kernel.

### ./mcp-server history

## [Unreleased]

### Fixed

- **`serveTools` returns a tool's value, not only its text (plan 192 Task 3).** A `tools/call` answer now carries the `ToolResult`'s text blocks **and**, when `value` is a JSON object within `limits.resultBytes`, `structuredContent` — until now the value was dropped whenever the tool also authored text, so a caller that reads structure lost it. A result with no text block falls back to a clipped-JSON text block, an error answers `isError: true` with `<code>: <message>`, and an untrusted result answers with the kernel's envelope (`formatUntrustedToolText`) so a vendor agent sees the same bytes the internal loop would; non-text blocks follow the envelope, and `structuredContent` still carries the redacted value. An over-cap value is not structured: the clipped text is the whole answer. The value is the kernel-redacted one, so a secret placeholder survives and no raw secret leaves.

### Added

- **`skillResources(skills, servedToolNames)` (plan 215 Task 10).** A helper next to `serveTools` that turns the skills tied to the lent tools into `serveTools` resources, so a vendor agent reads them over the same bounded resource channel (no new transport or option). A skill is lent only when its `requiresTools` is non-empty and a subset of the served tools; a skill with no `requiresTools`, or no body, is not. Each resource is `prism-skill://<name>`, `text/markdown`, holding the skill as a standard `SKILL.md` (frontmatter and body, rendered from the loaded skill, never from its path). A skill over the 256 KiB resource bound is left out and returned in `skipped` (`{ name, reason: "oversized", bytes }`), never truncated. Pure and deterministic. New exports: `skillResources`, `SkillResources`, `SkippedSkillResource`. `examples/serve-tools.ts` passes it to `serveTools`.
- **`examples/serve-tools.ts`: serving a run's tools to an external agent (plan 165 Task 8).** The Phase 14 end-to-end example, offline. Inside one `session.run` an inline `defineDriver` driver binds a `workspace` worktree for the run's session, writes the vendor's MCP configuration into it with `excludeOverlay`, and serves `read`, `edit`, and the permission tool with `serveTools` over `loopback-http` and then `stdio-relay`, driving the scripted `jsonl-stream` CLI as the vendor binary through `--mcp-endpoint`. It shows an allowed `edit` that changes the file in the worktree, a declined `edit` under `@arnilo/prism-approval` in `ask` mode, the permission tool's deny and allow, an unserved name as a JSON-RPC error, a call after `close()` refused, the served calls' `origin` on the run's events, the worktree diff with the overlay excluded, and a conflicting `merge` reported unresolved.
- `serveTools`'s permission tool (plan 165 Task 5): `options.permissionTool` (`{ name, effects?, rewrite?, codec? }`) serves one more tool, `prefix + name`, backed by `run.ask`. Its neutral input is `{ toolName, input, toolCallId? }` and its output text is JSON `{ behavior, updatedInput?, message? }`; a driver whose vendor has a permission-prompt hook (`claude --permission-prompt-tool`) supplies a `codec` (`decode`/`encode`) to map the vendor shape, the only vendor-shape hook in the package. Each call is one `run.ask` (`effects` defaults to every effect, `rewrite` to `false`) and appends one bounded, redacted `prism.permissions` `external_state` entry `{ toolName, toolCallId, behavior, reason }` — never the input. A `deny` is a normal result carrying the decision JSON, not `isError`. An `approval_pending` answer closes the served tools. It fails closed: a throwing `decode`, gate, or `encode`, and a decision that cannot be recorded, each deny. New `ServeToolsError` code `serve_tools_permission_conflict`; new exported types `PermissionRequest`, `PermissionDecision`, `PermissionCodec`, `ServeToolsPermissionTool`.
- `serveTools(run, options)` (plan 165 Task 4): bridge an allow-listed subset of a run's `ToolDefinition[]` to an external agent over the run's callback broker, so the vendor's own agent loop calls Prism tools through the same `tool.call` gate the internal loop uses. `tools/list` lists `prefix + name`; `tools/call` runs `bridgeTools` → `executeTools`, maps the `ToolResult` to MCP `content` (redacted by the kernel, truncated to `limits.resultBytes`), and returns `isError` with the deny text for a denied or approval-pending result. Static `resources` are served bounded to 256 KiB. Two transports: `loopback-http` (`endpoint.url` = `broker.url + "/mcp"`, token in `env[headerEnv]`) and `stdio-relay` (`endpoint` spawns `prism relay mcp --run <dir>`). `limits.maxConcurrentCalls` bounds in-flight calls (a call over the cap is a JSON-RPC error, never queued); `close()` unregisters the route, runs on `run.signal` abort and after an `approval_pending`, and a late call is refused. New `ServeToolsError` codes `serve_tools_empty`, `serve_tools_transport`, `serve_tools_resource_bytes`.
- `serveMcp(agent, options)` and `mcpHost()` (plan 161 Task 5): serve a Prism agent over MCP as one `prompt` tool (`toolName` to rename) plus `agent.commands` as MCP prompts. Exactly one transport — `{ stdio: true }`, `{ transport }`, or `{ http }` — over the existing `servePrismMcpStdio`/`createPrismMcpWebHandler` helpers. Approvals suspend (`interactive: false`) and resume through the SDK's multi-round-trip `input_required` elicitation when the client advertises `elicitation.form`; without elicitation the call fails closed with `ERR_PRISM_MCP_APPROVAL_REQUIRED` naming the pending approval.
- `servePrismMcpStdio` accepts a caller-owned `transport`, and both transport helpers take an `McpServerFactory` and forward its request context (era, authInfo).

### Changed

- `serveTools`'s `ServeToolsHandle.tools` now also lists the permission tool name when `permissionTool` is set (plan 165 Task 5). `CallbackBroker.route("mcp", handler | undefined)` (plan 165 Task 4): `undefined` removes the route, so `serveTools.close()` can unregister it. The bound/redaction/truncation helpers moved to `src/bounds.ts` (`bounded`, `truncateUtf8`), shared by `serve`, `server`, and `serve-tools`. `serveMcp`'s doc comment now points at `serveTools`.
- `@arnilo/prism-mcp-server` (plan 159 Task 3): Host library serving Prism tools, resources, and prompts over MCP stdio and Streamable HTTP transports. Extracted from `@arnilo/prism-mcp` with 0.12 API intact (`createPrismMcpServer`, `createPrismMcpWebHandler`, `servePrismMcpStdio`).

### Removed

- `createPrismMcpServer`, `CreatePrismMcpServerOptions`, `PrismMcpCacheHints`, `PrismMcpCacheableMethod`, `PrismMcpAgentRunExposure`, `PrismMcpResource`, `PrismMcpPrompt`, and `PrismMcpAuthorization.identity` (plan 161 Task 5). The server's direct `dispatchToolCall`/`assertPermission`/`createToolRegistry`/`createRunLimitTracker` path bypassed the run's approval and governance, so tool serving waits for `serveTools` (plan 165 Task 4, now shipped). The `@arnilo/prism-governance` dependency is gone: identity enforcement belongs to the agent's own governance hooks, and `authorize` stays.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./acp history

## [Unreleased]

### Added

- `@arnilo/prism-acp`: `serveAcp(agent, …)` and `acpHost()` (plan 161 Task 2). Serves an existing agent over ACP v1. Approvals suspend and resume through `session/request_permission`.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./ag-ui history

## [Unreleased]

### Changed

- `createAgUiHandler(agent, options?)` now takes a Prism `Agent` and drives the public `Session` API (plan 161 Task 4): `threadId` selects `agent.session({ id, create: true })`, the run streams `session.stream(input, { interactive: false })`, a suspension ends in a `RUN_FINISHED` interrupt (one per pending decision), `resume` maps `ResumeEntry` (`status: "cancelled"` → `reject_once`, a resolved payload `{ outcome }`) to `session.resume(decisions)`, and a client disconnect aborts through `session.abort()`. `authorize` is now optional and defaults to deny.
- Moved to `packages/hosts/ag-ui` and ships TypeScript source (`exports: { ".": "./src/index.ts", "./renderer": "./src/renderer/index.ts" }`). No build step.

### Removed

- `effect-recovery.ts` (`reconcileAppEffect`, `deriveAppEffectKey`, `hashJson`) and the `AgUiMcpAppHandlerOptions.effectStore`/`effectContext` claim path. The MCP Apps proxy no longer retries an approved UI mutation.
- The handler's `sessionFactory`, `lifecycle`, `resolveRun`, `interrupts`, `onSuspended`, `replay`, `mcp`, `input`, and `inputPolicy` options, and the `AgUiRunResolutionRequest`/`AgUiInterrupt*` types.
- The unused `AgUiProjection.lifecycle`/`fileDiff` hooks (no caller); the `@arnilo/prism-tools-coding` and `@arnilo/prism-governance` dependencies.
- The `./acp` subpath and `packages/ag-ui/src/acp/**` (plan 161 Task 3). ACP v1 serving moved to `@arnilo/prism-acp`: `serveAcp(agent, …)` and `acpHost()`, plus the event mapper. `createPrismAcpAgent`, `createAcpClientFilesystem`, `createAcpClientTerminals`, the modes/config/session-store seams, and the coding projection are gone.

## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

# Changelog

## [0.3.0] - 2026-08-20

### Added

- `createCodingToolProjection()` now projects successful `delete` and `move` results as bounded path locations; moves use destination metadata with a source fallback and never emit diffs.

## [0.2.8] - 2026-08-18

### Added
- ACP adoption fixes (plan 028): `createCodingToolProjection`, image `toolResult`, slash-command seam, usage/title/transcript seams, `ERR_PRISM_ACP_RUN`, `acpImageBytes`/`acpCommandsPerUpdate`.

## [0.2.6] - unreleased

### Added
- **Durable ACP run recovery** (plan 026 Task 5): optional `recovery` seam (`checkpoints` + `leases` + `ownerId`, all three together; partial config fails closed) plus the existing `sessionStore` persist a bounded `activeRun` ref on `PersistedAcpSession` (frozen 512-byte cap, additive optional field — 0.1.6 records remain readable) while a durable run is live: running on first event, suspended with the durable version on approvals, terminal on finish/deny/error. Restore re-attaches the ref; `createAcpRunRecovery` (new export) re-resolves it against `AgentRunLifecycle.status` — suspended runs preserve pending approval ids, terminal runs report terminal, unprovable in-flight streams report `unknown` (never a restarted prompt). Durable cancellation is ownership/version/fence checked, terminal/idempotent, aborts no unrelated run, and never replays a pending/dispatched tool; `session/cancel` writes the marker for restored runs (new `prism.coding-agent.cancel.v1` namespace, CAS + lease fenced). Errors `ERR_PRISM_RECOVERY_*`; corrupt/oversized refs and markers fail closed.

## [0.1.6] - 2026-08-11

### Changed
- **Durable ACP session store** (plan 018 closeout `acp-session-store`): additive host-owned `AcpSessionStore` seam on `CreatePrismAcpAgentOptions` (`save` on session/new + set_mode + set_config_option, lazy ownership-scoped `loadAll` once per agent instance, `evict` on close/delete). Persisted entry shape `{sessionId, ownership, modeId, configValues, cwd, additionalDirectories, updatedAt}` — never ephemeral stream state or pending decisions; restored entries re-validate modes/config options and cwd, drop corrupt/oversized entries fail-closed, keep the in-memory registry caps (32 default / 128 hard); cross-tenant restore refuses `ERR_PRISM_ACP_INPUT`; the whole entry rides the optional `SecretRedactor` at the save boundary. Absent seam = byte-identical 0.1.5 behavior.

## [0.1.1] - 2026-08-10

### Changed
- ACP modes/config persistence guidance ([docs/acp.md](acp/README.md) "Persistence and ownership"): the agent never persists `modeId`/`configValues`; host stores MUST key by `sessions.ownership` and refuse cross-tenant restores (`ERR_PRISM_ACP_INPUT`). New tests in `src/__tests__/acp-modes-config.test.ts`: ownership-scoped host-store refusal, agent-stays-thin regression guard, cross-tenant `authorize`-seam refusal.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.0.27] - 2026-08-07

### Added
- Truthful ACP capability negotiation (Phase 10): `resolveAcpAgentCapabilities(options)` — pure, O(1) function of host-wired seams; absent seam omits the capability key (never an empty stub). `loadSession` iff `sessions.load`, `sessionCapabilities.{list,delete,resume,additionalDirectories}` iff matching `sessions.*` seam, `promptCapabilities.{image,audio,embeddedContext}` iff `capabilities.prompt.{media,embedded}` gate, `mcpCapabilities.{http,sse}` iff `mcp.select` + matching `mcp.transports`; `close` always; UNSTABLE cells (`mcpCapabilities.acp`, `sessionCapabilities.fork`, `auth`, `providers`, `nes`, `positionEncoding`) never advertised. Client `fs`/`terminal`/`session.configOptions.boolean`/`elicitation` advertisements are read from the initialize request into a closed-default `ResolvedAcpClientCapabilities` that gates later client-method use.
- `createPrismAcpAgent` options `sessions`, `mcp`, `capabilities` (seam presence drives advertisement); `initialize` now returns `agentInfo.version` from the package.json (single version source via JSON import attribute, `resolveJsonModule`), replacing the stale hard-coded version.
- Client filesystem and terminal adapters (Phase 10): `createAcpClientFilesystem(client, sessionId, options?)` wraps `fs/read_text_file` / `fs/write_text_file` behind a minimal read/write interface (payloads capped at AG-UI `maxTextBytes`; `readTextFile`/`writeTextFile` option masks fail closed with `ERR_PRISM_ACP_CAPABILITY`). `createAcpClientTerminals(client, sessionId, options?)` maps `terminal/create|output|wait_for_exit|kill|release` onto `ProcessSession`-flavored semantics (pull-based; no stdin) with output payloads capped at the frozen Phase 9 `process.outputChunkBytes` constants (requested as client-side `outputByteLimit` and verified per response).
- `AcpCodingSeams` option on `createPrismAcpAgent` (`filesystem`/`processes` host factories) — the agent calls a seam only when the client advertised the matching capability at initialize, builds `AcpCodingContext` (`filesystem`/`processes` adapters), and passes it plus a pre-generated ACP `sessionId` to `sessionFactory` (id asserted on return when seams are wired, so `terminal/*`/`fs/*` requests correlate).
- `AcpError` with frozen codes `ERR_PRISM_ACP_INPUT` / `LIMIT` / `POLICY` / `CAPABILITY` / `MCP`; new dependency `@arnilo/prism-coding-agent` (workspace) for the Phase 9 output-chunk caps.
- ACP session lifecycle (Phase 10): `session/load`, `session/resume`, `session/list`, `session/delete` handlers wired only when the matching `sessions.*` seam exists (absent seam ⇒ method not registered). Load/resume register the binding in the session registry (bounded by new `acpSessions` cap, default 32/hard 128, fixing the unbounded Map) and accept the same `additionalDirectories` + `mcpServers` gates as `session/new`; list pages the host's ordered summaries with an opaque numeric cursor at `acpSessionListPage` (default 20/hard 100) and forwards the `cwd` filter.
- Session inputs (Phase 10): `session/new`/`load`/`resume` now validate client-supplied `additionalDirectories` (count + path-byte caps, policy seam returns the allowed subset; non-empty request without the advertised seam rejected `ERR_PRISM_ACP_POLICY`) and `mcpServers` (`validateMcpServers`: count/per-config/header-value caps, UNSTABLE `acp` transport rejected unconditionally, http/sse accepted only when advertised via `mcp.transports`, stdio accepted, all run through `mcp.select` before forwarding; nothing reaches the host unvetted). Policy-checked `cwd`, `additionalDirectories`, and approved `mcpServers` are forwarded to `sessionFactory`.
- New caps: `acpSessions` 32/128, `acpAdditionalDirectories` 8/32, `acpAdditionalDirectoryPathBytes` 4 KiB/16 KiB, `acpMcpServersPerSession` 8/32, `acpMcpServerConfigBytes` 16 KiB/256 KiB, `acpMcpHeaderValueBytes` 4 KiB/64 KiB, `acpSessionListPage` 20/100 (freeze `caps.acp`). `AcpSessionStoreSeams` finalized: `load`/`resume` take `{ sessionId, cwd, signal }`, `list` returns `AcpSessionSummary[]` (`{ sessionId, cwd, additionalDirectories?, title?, updatedAt? }`).
- Session modes (Phase 10): `modes: AcpModesSeam` option (`modes: AcpSessionMode[]` + optional `defaultModeId`, defaulting to the first mode) — `session/new`, `load`, and `resume` return `SessionModeState`; `session/set_mode` validates the id (unknown ⇒ `ERR_PRISM_ACP_INPUT` fail-closed), runs the host `apply` hook (`{ sessionId, fromModeId, modeId, signal }` — a pure host-side contribution overlay over its own tools/write/approval policy; no ACP-only policy engine), persists the mode per session, and emits `current_mode_update`. Tables bounded at `acpModesPerSession` 16/64, duplicate ids and unknown defaults rejected at creation.
- Session config options (Phase 10): `configOptions: AcpConfigOptionsSeam` option — returned on `new`/`load`/`resume` only when the client advertised `session.configOptions.boolean` at initialize (else omitted; `session/set_config_option` rejects with `ERR_PRISM_ACP_CAPABILITY`); values validated against the declared `boolean`/`select` type (unknown id/value ⇒ `ERR_PRISM_ACP_INPUT`), `onChange` hook runs after validation, the full set with `currentValue` is returned and broadcast as `config_option_update`. Tables bounded at `acpConfigOptions` 16/64, duplicate ids rejected at creation.
- Rich prompt content (Phase 10): `projectAcpPrompt` replaces the text-only prompt guard — text + `resource_link` baseline always accepted (links become `[resource_link: name (uri)]` markers), `image`/`audio` blocks accepted only when the agent advertised `promptCapabilities.image/audio` (host `capabilities.prompt.media` seam) and the live policy re-approves, `resource` embedded blocks only with `embeddedContext` (text resources join the prompt text, blobs become media parts); MIME prefix (`image/*`, `audio/*`), base64 shape, part count (`maxInputMediaParts` 16/64), and decoded byte budget (`maxInputMediaBytes` 64 KiB/1 MiB) are validated fail-closed with `ERR_PRISM_ACP_CAPABILITY`/`POLICY`/`LIMIT`/`INPUT`; `session/prompt` now streams a prism user `Message` (text + media content blocks) instead of a plain string, so media reaches the host session.
- Tool-call diffs and locations (Phase 10): `AgUiProjection` gains `toolLocations`/`toolDiff` allow-list hooks (default omit); the ACP mapper attaches `locations` (count-capped at `acpLocationsPerUpdate` 32/128, invalid entries dropped) and one `diff` content block (redacted, byte-capped at `acpDiffBytes` 64 KiB/1 MiB) to `tool_call_update` — never raw tool I/O. Available-commands/plan updates stay omitted (no frozen consumer).
- Coding lifecycle → ACP updates (Phase 10): `createAcpLifecycleMapper` + `AcpLifecycleMapper` (freeze `lifecycleEventMapping`): `file_changed` → locations-only `tool_call_update` (dropped without the event's `toolCallId`; diff only via the new `AgUiProjection.fileDiff` allow-list, capped at `acpDiffBytes`); `worktree_changed` + `process_started`/`exited`/`killed` → `agent_message_chunk` only via the new `AgUiProjection.lifecycle` allow-list (deny-by-default); `permission_denied` → `tool_call_update` status failed (never raw args; synthesized `prism:denied:<approvalId>` id when untargetable); `configuration_changed` → agent-wired `config_option_update` broadcast with the full per-session set. `AcpCodingSeams.lifecycle` accepts the host `CodingLifecycleEmitter`; updates are delivered only to sessions with an active prompt stream and count against that session's shared per-run notification budget.
- Elicitation (Phase 10): when the client advertised `elicitation` at initialize and the suspension is an all-elicitation batch, each pending decision surfaces as `elicitation/create` (form mode, bounded schema + redacted reason); accept carries the typed payload as `Decision.elicitation`, decline/cancel/errors deny (`reject_once`) — no widening of the approval vocabulary. Without the advertisement, elicitation decisions stay on the shared approval path (four options). Permission parity unchanged and locked by existing tests: four-outcome mapping, sticky `allow_for_run`/`reject_for_run`, cancel → deny, unrecognized ids deny.
- Conformance, smoke, example, benchmarks (Phase 10): `scripts/phase10-conformance.test.mjs` (in `npm test`) runs a composed scenario (initialize matrix, session/new with dirs+MCP+modes+config, fs/terminal client methods, lifecycle updates, four-outcome permission, mode/config switches, duplicate-resume rejection, reconnect load/resume, list paging, delete) plus adversarial cases (unadvertised methods → method-not-found, UNSTABLE acp MCP transport, host select denial, oversize config, garbage cursor, unknown mode, oversize media, secret redaction) over the real `@arnilo/prism-ag-ui/acp` subpath. `scripts/acp-client-smoke.mjs` is an operator-gated real-transport smoke (`PRISM_TEST_ACP_CLIENT=1`; fails closed without it) that drives the agent over the SDK's ndJsonStream stdio transport — read-only prompt, one edit via `allow_once`, narrowing mode switch, reconnect load — with policy never disabled. `examples/acp-coding-host.ts` demonstrates the full host seam set (runs in the demo gate). `scripts/benchmark-0.0.27.mjs` records p95 for fs round trip, terminal chunk ack, mode switch, prompt first update, and prompt end; `scripts/budgets.json` gains the `phase10` section (freeze p95Targets) and `budget-gate.test.mjs` checks the recorded `scripts/benchmark-0.0.27.json` evidence.
- Documentation (Phase 10): new `docs/acp.md` is the full ACP coding-host reference (seam = capability, event mapping table, caps, security); `docs/ag-ui.md` shrinks ACP to a summary + link; `docs/migration.md` gains the 0.0.26 → 0.0.27 section; `docs/index.md` lists ACP under frontend interoperability; `docs/agent-events.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/mcp-tools.md`, `docs/host-security.md` gain ACP pointers; package README ACP section updated.
- A2UI renderer core values exported from the `@arnilo/prism-ag-ui/renderer` subpath entry (host FR): `A2UiSurfaceState`, `reduceA2UiOps`, `readA2UiBatch`, `resolvePointer`, `A2UI_VERSION` — framework hosts can drive the validated DOM-free surface state machine without mounting a renderer or importing `dist/` directly; `createA2UiRenderer` behavior and the frozen A2UI limits unchanged.

## [0.0.26] - 2026-08-06

## [0.0.26] - 2026-08-06

### Added
- `createReasoningEncryptedValue` (FR-3): bounded `AgUiReasoningProjection.encryptedValue` fragment for the `reasoning` projection callback from a host-owned `encrypt` function; fails closed on missing/throwing/non-string `encrypt`, never infers an encrypted value from a Prism reasoning signature, truncates to `maxBytes` (default `DEFAULT_MAX_REASONING_BYTES`, clamped to `HARD_MAX_REASONING_BYTES`). See [ag-ui docs](ag-ui/README.md).
- MCP Apps UI-initiated mutation retry (FR-4): `createAgUiMcpAppHandler` accepts optional `effectStore` + `effectContext`; every approved `tools/call` records `begin` → `markDispatched` → `complete`/`fail`/`markUnknown` (abort/transport loss → `unknown`). New `reconcileAppEffect` / `deriveAppEffectKey` / `hashJson` exports let the host resolve unknown records against the actual outcome (claim/CAS); retries replay completed results idempotently, other states fail closed with `409` until reconciled. The proxy never auto-retries; absent `effectStore` keeps 0.0.25 behavior.
- A2A server-side exposure (Task 13): `createAgUiA2AServer({ card, authorize, sessionFactory, input?, projection?, redactor?, a2ui?, durable?, tasks?, push?, parts?, endpointPath?, limits?, a2aLimits?, selectTaskId? })` fronts a local AG-UI agent as an A2A 1.0 server over supervisor's `createA2AHandler`; `SendMessage`/`SendStreamingMessage` stream text/activity/state as bounded artifact updates with a terminal task; `run.suspended` → `TASK_STATE_INPUT_REQUIRED`; bounded live task registry for `GetTask`/`ListTasks`/`CancelTask`; optional `durable` replays finished runs from an `AgentEventSource` with cursor event ids; text parts become the AG-UI user message and other parts arrive in `forwardedProps.a2a` for `input.project`. Lazy optional-peer import — the supervisor peer is required only when the factory is called. See [A2A interoperability](ag-ui/README.md).
- Reference frontend renderer (Task 14): new `@arnilo/prism-ag-ui/renderer` subpath export — `createA2UiRenderer({ stream, catalog?, limits?, onAction?, onError?, dom? })` consumes an AG-UI event stream (SSE or in-memory `AsyncIterable`) and renders `a2ui-surface` snapshots/deltas into DOM surfaces from a host component catalog. DOM-free `reduceA2UiOps` core (surface/component/data-model state machine, JSON-Pointer bindings, snapshot replace / delta append); thin DOM binding with a built-in default Text/Container/Column/Row/Button catalog; server-side A2UI caps enforced client-side (ops/message, op bytes, surfaces/run, component depth); invalid/oversized ops drop closed with a bounded `prism.a2ui.error` event; unknown components render explicit placeholders; never executes remote HTML (no HTML-string assignment, no dynamic code evaluation). No new dependency, no host build step, no jsdom. See [ag-ui docs](ag-ui/README.md).

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Added
- Opt-in A2UI painting middleware (`a2ui` handler option) and standard projectors (`createMessagesFromSessionProjection`, `createStateFromStoreProjection`, `createActivityFromToolProgressProjection`, `composeAgUiProjections`).
- Batch interrupt/resume via shared `Decision[]`; ACP four-outcome permission mapping.

### Changed
- Publishable graph remains **47** manifests at **0.0.25**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.24 → 0.0.25 notes.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Changed
- Released with exact 0.0.21 graph.

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Released with exact 0.0.18 graph.

## [0.0.17] - 2026-07-29

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

## [0.0.14] - 2026-07-26

### Added

- Co-work events: `mapCoWork` (AG-UI + ACP parity), co-work projection/replay, and handler co-work context threading for artifact progress/approval/download-link, connector drafts, and redacted browser snapshots (Plan 077 Task 4).

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

- Added optional bounded AG-UI event mapping over redacted Prism agent events.
- Added authorized Web handler, durable interrupt/resume, and redacted bounded replay adapters.
- Added stable ACP v1 sibling mapper and agent builder with bounded permission-to-resume flow.

### ./channels history

## [Unreleased] (Phase 10 Task 2)

### Added
- `channelHostUi` routes confirm, select, input and notify requests to a consumed pairing with explicit authorization, bounded expiring waiters, CAS reply tokens and journaled prompt delivery. Input answers never enter the journal or an agent turn. Connections accept the existing runtime `limits`; `ChannelPairingStore.resolve` resolves confirmed pairing references.

### Changed
- The `checkpoints`/`leases` store shapes this package accepts are declared locally in `src/checkpoint-contract.ts` instead of imported from `@arnilo/prism` (plan 168 Task 4), so channels gains no dependency on the workflows engine. Structural match with the `checkpoints`/`leases` service contracts, so the memory defaults, a store package's services, and the old kernel copies all satisfy them. No behavior change.
- **Direct Agent host bindings**: `connectTelegram(agent, options)` and `connectSignal(agent, options)` bind one host-configured Prism `Agent` directly to messaging channels, returning `{ handle(update), start(), close(), stop(), drain(options) }`.
- Chat bindings now run turns through `agent.session({ id })` via `session.run(text, { interactive: false })`.
- Suspended runs (`RunResult.pending`) prompt for operator approval via the approval store, and the chat response resolves the suspension via `session.resume(decisions, { interactive: false })`.
- Telegram bot tokens and Signal account credentials are now strict references (`env:` or `keyring:`); literal values throw `ChannelTokenLiteralError` (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`). Secret values are automatically redacted from messages, errors, and traces.
- Package moved to `packages/hosts/channels` as a TypeScript-source package (`name: "@arnilo/prism-channels"`).

### Removed
- `createMessagingRuntime`, `resolveAgent`, and agent aliases have been removed in favor of single-agent `connect*` bindings.
- `createAgentRunLifecycle` usage has been deleted.

## [Unreleased] (plan 079 Task 4)

### Added
- **New family package `@arnilo/prism-channels`**: the messaging-channel runtime moves out of `@arnilo/prism-core` into its own tarball so transports can grow without touching the core package's release cadence, export budget or peer set. The move is behavior-preserving: same export names, same semantics, same tests.
- Root export `.` ships the transport-neutral contracts, `createMessagingRuntime`, the durable journal (`createChannelStateStore`, `createChannelDeliveryJournal`), pairing (`createChannelPairingStore`), limits and the recovery API (`reconcile`/`listUnresolved`/`prune`).
- `./telegram` now ships `createTelegramAdapter` and `createTelegramWebhookHandler`: explicit lease-fenced long polling or host-mounted webhook admission, native-fetch plain-text sends, server-issued approval callback buttons, fixed endpoint/redirect protection, Unicode-safe chunks and ambiguous-delivery handling.
- `./signal` (experimental) ships `createSignalAdapter` plus `SIGNAL_CLI_VERSION`: a Node-only private-Unix-socket client for an externally supervised signal-cli v0.14.8 daemon (`subscribeReceive` / `unsubscribeReceive` / `send` only, manual `params.result.envelope` parsing). Construction rejects without an explicit operator acceptable-use/GPL `policy` attestation and a matching `signalCliVersion`; receipt waits for durable-writer readiness, admits only selected-account direct UUID text, pauses on account mismatch / storage / lease loss with bounded backoff reconnect, sends only to the authorized bound UUID with `/approve` / `/deny` command rendering, and never spawns, links, registers, trusts identities or opens TCP/HTTP.
- Durable one-use `allow_once` / `reject_once` controls resume one core pending decision through `AgentRunLifecycle.resumeStream`; exact principal, chat, session, run, approval id, version, current grant/agent revision and expiry are verified before side effects. `/status` survives a suspended restart and `/cancel` uses core terminal denial.
- Host examples and fault injection (Task 8): `examples/messaging-agent.ts` (sqlite + mock), Telegram webhook mount helper, SIGKILL restart worker, sqlite reopen/lease-fence/capacity end-to-end suite, and opt-in `telegram-live` / `signal-live` matrix probes that skip without operator credentials and never create contacts or accounts.
- Packaging/current-contract (Task 9): packed `.` / `./telegram` / `./signal` imports, root/telegram isolation from Signal socket code, no third-party peers, wiki-structured `/docs` pages and options-index entries.
- Peer `@arnilo/prism@^0.7.0` is the only runtime dependency: Prism primitives are consumed through the public entry, never through `@arnilo/prism-core` internals. `@arnilo/prism-core` is a dev dependency for the SQLite/PostgreSQL journal-conformance legs.
- Group and topic ownership (plan 080 Task 4): `TelegramAdapterOptions.allowGroups` (and the same option on `TelegramWebhookHandlerOptions`) opts group/supergroup text into parsing, with the signed group `chat.id` as `externalConversationId`, `from.id` as `externalActorId`, and `message_thread_id` as `threadId`. Chat titles, bots, `sender_chat` (channel posts/anonymous admins) and non-text updates stay dropped; forwarded messages are admitted but flagged in `claims`. Admission is still the host `authorize` decision on the exact observed `(chat, thread?, sender)`, replies post back to the bound topic, and Signal remains direct-message only.
- Streaming previews (plan 080 Task 5): `MessagingRuntimeOptions.onAssistantDelta` forwards the cumulative redacted assistant text of the running turn as `ChannelAssistantDelta`. The runtime only subscribes (bounded) when a host supplies the callback, so hosts that do not see no behavior change; previews stop at cancel/`stop()`, reset per assistant message, never enter the journal, and can never fail a turn. `TelegramAdapterOptions.sendDrafts` (default off) opts the Telegram subpath in: `TelegramAdapter.sendDraft` posts `sendMessageDraft` with a fixed per-chat draft id, one request in flight with the latest partial winning, text capped to the last 3,500 UTF-16 units, and skipped for group chats (Bot API drafts are private-chat only). The experimental Signal subpath has no draft equivalent and ignores the callback.
- Bounded attachments and voice (plan 080 Task 6): `ChannelInboundEvent.attachments` carries `ChannelAttachmentRef` values (`image` | `document` | `voice`, transport file id, optional mime/size/name) and `ChannelLimits.maxAttachmentBytes` (default 1 MiB, hard 4 MiB) bounds every fetch. The Telegram subpath parses `photo` (largest size), `voice` and `document` plus captions, resolves voice/document text through the host `transcribe`/`extractDocumentText` hooks before `admit`, and exposes `TelegramAdapter.fetchAttachment` (`getFile` + bounded download, redirects forbidden, token never logged) which the runtime calls as `MessagingRuntimeOptions.fetchAttachment` only for an event image when the resolved model declares `image` input. Declared sizes over the cap are denied `oversized` before a fetch, anything else unprocessable settles `unsupported_media` with a bounded notice and no model call, `synthesize` adds an optional `sendVoice` next to `final` text (OGG/OPUS, MP3, M4A; failures never fail the reply), and no media bytes, URLs or refs beyond the event reach the journal. Signal stays DM-text-only.
- Proactive opt-in notifications (plan 080 Task 7): `ChannelAction` adds `"notify"`, `ChannelAuthorization.notifications` (missing = false) opts an actor into host notices, and `MessagingRuntime.notify` sends one `notice` to one already-bound conversation/thread pair. It never runs the agent, never allocates a binding, never enqueues a turn and never broadcasts: `authorize` is called with `action: "notify"` and empty text, the grant's alias must match the binding, the caller identity's principal and ownership scope must match the grant, and the existing binding is loaded (never created). The notice is redacted, bounded by the reply cap, journaled as an operation of kind `notify` with the caller `notifyId` as the idempotency key (no cursor move; a repeat is a duplicate) and staged through the same reply journal as an answer, so delivery failures stay recorded instead of retried. Several bindings for one pair resolve to the current alias selection and otherwise fail closed; unbound, foreign, revoked, ungranted and capacity-denied cases produce a bounded reason. Signal stays unicast to an existing DM binding.

### Removed
- `@arnilo/prism-core/integrations/channels` — the subpath and its 25+38 exports are gone from `@arnilo/prism-core`; use `@arnilo/prism-channels`.

## [0.7.0] - 2026-09-15 (plan 079 Tasks 2–3, as `@arnilo/prism-core/integrations/channels`)

- Transport-neutral messaging runtime, durable bindings/journal/pairing, SQLite+PostgreSQL conformance (35 tests). Moved to this package by plan 079 Task 4.

### ./evals history

All notable changes to `@arnilo/prism-evals` will be documented in this file.

## [Unreleased]

- **Host library `@arnilo/prism-evals`**: evaluations machinery moved out of `@arnilo/prism-core/governance/evals` into `packages/hosts/evals` as a host library.
- **Controlled failure injection reshaped**: `wrapAgentWithFailureInjection` deleted in favor of `failureInjection(options)` (`AgentConfig.hooks` function using `tool.call` deny and `tool.execute` around for unknown-effect) and `failingStore(store)` wrapping `SessionStore`.
- **Factory-based scenario runner**: `runScenario` supports host agent factories `(extra) => createAgent({ ...extra })`, avoiding agent construction or object spread inside evals.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./devtools history

All notable changes to `@arnilo/prism-devtools` will be documented in this file.

## [Unreleased]

- **Host library `@arnilo/prism-devtools`** (plan 162 Task 4): the developer inspector moved out of `@arnilo/prism-coding-tools/dev` into `packages/hosts/devtools`. `serveDevtools(agent, { port, hostname, token })` serves the page and its JSON routes on `Bun.serve` over the public `Agent` API.
- **`prism-devtools` bin**: serves a manifest-built agent (`--root`, `--model provider/model`, `--trust-project`, `--port`) on loopback.
- **Security**: loopback by default; a non-loopback `hostname` requires a `token` ref (`env:NAME`); a literal token is refused; a bearer token guards every route when set; every JSON body and SSE event passes the agent's redactor.
- **Removed from the 0.12 inspector**: the `prism dev` subcommand, `createPrismDevInspector`, `createDevRouter`, `runDevCli`, the `PrismRequestHandler` dependency, the prompt and decision panels, and the timeline panel (the projector stays in `@arnilo/prism-core` until Phase 16). No alias is kept.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./remote history

## [Unreleased]

- Added optional host-owned `resumeAuthority` for coordination with other resume entry points.

### Added

- `@arnilo/prism-remote`: protocol `prism.remote/1` (JSON-RPC 2.0 method table, capability negotiation, bounded frame dispatcher, memory and stdio transports) (plan 170 Task 2).
- `@arnilo/prism-remote`: `serveAgent` and `remoteHostUi` — sessions, runs, steering, commands, and durable suspension on disconnect (plan 170 Task 3).
- `@arnilo/prism-remote`: `connectAgent` — an `Agent` proxy over stdio or an in-process transport, with `origin.remote` attribution, `executedBy: "external"` tool events, local `host.ui` routing, and optional session mirroring (plan 170 Task 4).

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.

### ./headless history

## [Unreleased]

### Added

- Added a `command` scheduler target: `{ kind: "command", agent, command, input }` runs one registered package command on the schedule session with no model turn, no prompt, and no agent loop, so a maintenance-style pass (`memory:maintain`) can be scheduled like any other job. The firing status comes from the command's result (`status` from the run vocabulary, else `ok: false` ⇒ `failed`, else `completed`); a throw records `failed` without persisting the error or the result. Registration fails closed with the new `unknown_command` when the command is not registered on the target agent.

- Added `resumeWhenAnswered`, `createResumeAuthority`, authoritative branch-tip recovery, and guarded remote/router resume composition.

### Added

- Ordered `routeHostUi` routing with explicit kind limits, timeouts, a fail-closed `policyDefault`, and bounded, value-free answer logging with optional ownership-scoped checkpoint persistence.

### ./host-builder history

All notable changes to `@arnilo/prism-host-builder` will be documented in this file.

## [Unreleased]

- **Host library `@arnilo/prism-host-builder`** (plan 215 Task 14): version-exact reference indexes for building a Prism host. `data/api.json` lists every public name per package and `exports` subpath with its kind, signature, summary, the docs that mention it and the examples that import it. `data/errors.json` lists the `ERR_PRISM_*` codes and the short error codes with their owner, declaration, class, meaning and a sample message. `data/examples.json` lists the CI-tested examples, and `data/examples/` holds their sources. `bun scripts/host-builder-index.mjs` regenerates them from the same declaration model the compat gate uses; `--check` fails on stale data.
- **Interface and class members in the API index** (plan 215 Task 20): `data/api.json` entries for interfaces and classes carry `members` (field and method declarations, comments removed, at most 60 per type), and `prism_api` returns them. The Task 20 evaluation showed builders guessed field names such as `call.arguments` for `call.args`, because the index held only `export interface X`. The skill gained a "Mistakes the compiler cannot catch" section (a host that runs tools needs a `principal`; deleting a retired field is not an upgrade; types are not behavior), the upgrade map gained the `extensions`, `identity`, `store`, `provider`/`model` and `tools.use` rows (and no longer calls `identity` a valid config name), and `recipes.md` gained a coding-tools recipe.
- **Skill `prism-host-builder`** (plan 215 Task 15): `skills/prism-host-builder/SKILL.md` and seven references (`choosing`, `layout`, `recipes`, `pitfalls`, `security`, `verification`, `upgrading`) for a coding agent that builds, changes, upgrades or debugs a host. Judgment and pointers only; every doc, example and error-code reference is checked by `host_builder_kit_matches_surface`, and the skill passes `package_skills_conform`. The package does not register it into agents.
- **MCP server** (plan 215 Task 16): `prism-host-builder mcp [--root <dir>] [--allow-version-mismatch]` serves four read-only tools (`prism_api`, `prism_errors`, `prism_examples`, `prism_docs`), `prism-docs://` resources for the installed docs and READMEs, and the `build-host`, `add-capability` and `upgrade-host` prompts over stdio. Each tool call fails with `ERR_PRISM_HOST_BUILDER_VERSION` when the installed `@arnilo/prism` is not the indexed version (or warns with `--allow-version-mismatch`). Results are bounded at 64 KiB and marked when cut. New dependencies `@modelcontextprotocol/server` and `zod`, the same versions `@arnilo/prism-mcp-server` pins.
- **`prism-host-builder` bin**: `info` prints the Prism version and the size of each index; `--help` prints usage; an unknown command exits 2.
- **API**: `loadHostBuilderIndex(name)` loads an index lazily and caches it; `readExampleSource(path)` returns an indexed example's source and refuses a path the index does not list.
- **Host checks** (plan 215 Task 17): `prism-host-builder mcp` takes `--entry <file>#<export>` and `--package <file>#<export>` (repeatable), `--trust-project`, `--check-timeout <seconds>` (default 30, at most 120) and `--pass-env <NAME>`, and serves three tools that run the host's own code in one bounded `bun` child process: `prism_inspect_host` (returns `agent.inspect()` and disposes the agent), `prism_check_manifest` (what `prism verify` does; project packages are imported only with `--trust-project`) and `prism_check_package` (`packageConformance`). Targets come only from the start flags and must resolve inside `--root` (`ERR_PRISM_HOST_BUILDER_ENTRY`, exit 1). The child sees `PATH`, `HOME`, `TMPDIR`, `PRISM_HOME`, the `--pass-env` names and `PRISM_HOST_BUILDER_CHECK=1`; results and each output stream are capped at 1 MiB, the process group is killed on timeout and after exit, and `--pass-env` values are masked. A factory that runs a session or makes an outbound request fails with `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL`. The four lookup tools stay read-only; the server now lists seven tools.
- **Installer** (plan 215 Task 18): `prism-host-builder install --target <claude|codex|cursor|agents|prism> [--mcp] [--root <dir>] [--force] [--dry-run]` copies `skills/prism-host-builder/` into the target's project skill directory (`.claude/skills`, or `.agents/skills`, which Codex, Cursor and Prism's `contextFiles` also read) and writes a `.prism-host-builder.json` stamp (version, content hash, file list). A re-install of the same version is a no-op; a newer version replaces the copy only while its files still match the stamp, otherwise `ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT` unless `--force`. With `--mcp`, a JSON target (`.mcp.json`, `.cursor/mcp.json`) gets `prism: { command: "bunx", args: ["prism-host-builder", "mcp"] }` merged under `mcpServers` with the file's own indent; the Codex TOML config is printed, not written; the `prism` target prints the `contextFiles` and `@arnilo/prism-mcp` packages a Prism builder agent lists. Every path is realpath-checked inside `--root` (`ERR_PRISM_HOST_BUILDER_INSTALL_ROOT`), a malformed config is refused (`ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG`), conflicts are found before the first write, nothing global is touched and no package manager runs.

### ./driver-process history

## [Unreleased]

- Add `extendAdapter` with explicit function replacement/wrapping, shallow data merges, narrowing-only auth policy, and complete inspection ancestry (plan 166 Task 7).

- Add bounded process abort ladders, graceful transcript flushing, store/vendor/none resume strategies, and binary-major/adapter-revision checks; make stdin disposal safe after child shutdown (plan 166 Task 6).

- Add the adapter contract, process-driver package, per-run materialization and broker pipeline, JSONL transport, and inspection metadata (plan 166 Task 3).

- Route gating, stop continuations, steering, unmapped capture, and vendor limit classification through shared ordered run state (plan 166 Task 4).

- Add JSON-RPC stdio transport, ordered initialization and result decoding, bounded concurrent server requests, gated approvals/client tools, and host UI routing (plan 166 Task 5).
