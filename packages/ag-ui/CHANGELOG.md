# Changelog

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
- Elicitation (Phase 10): when the client advertised `elicitation` at initialize and the suspension is an all-elicitation batch, each pending decision surfaces as `elicitation/create` (form mode, bounded schema + redacted reason); accept carries the typed payload as `RunDecision.elicitation`, decline/cancel/errors deny (`reject_once`) — no widening of the approval vocabulary. Without the advertisement, elicitation decisions stay on the shared approval path (four options). Permission parity unchanged and locked by existing tests: four-outcome mapping, sticky `allow_for_run`/`reject_for_run`, cancel → deny, unrecognized ids deny.
- Conformance, smoke, example, benchmarks (Phase 10): `scripts/phase10-conformance.test.mjs` (in `npm test`) runs a composed scenario (initialize matrix, session/new with dirs+MCP+modes+config, fs/terminal client methods, lifecycle updates, four-outcome permission, mode/config switches, duplicate-resume rejection, reconnect load/resume, list paging, delete) plus adversarial cases (unadvertised methods → method-not-found, UNSTABLE acp MCP transport, host select denial, oversize config, garbage cursor, unknown mode, oversize media, secret redaction) over the real `@arnilo/prism-ag-ui/acp` subpath. `scripts/acp-client-smoke.mjs` is an operator-gated real-transport smoke (`PRISM_TEST_ACP_CLIENT=1`; fails closed without it) that drives the agent over the SDK's ndJsonStream stdio transport — read-only prompt, one edit via `allow_once`, narrowing mode switch, reconnect load — with policy never disabled. `examples/acp-coding-host.ts` demonstrates the full host seam set (runs in the demo gate). `scripts/benchmark-0.0.27.mjs` records p95 for fs round trip, terminal chunk ack, mode switch, prompt first update, and prompt end; `scripts/budgets.json` gains the `phase10` section (freeze p95Targets) and `budget-gate.test.mjs` checks the recorded `scripts/benchmark-0.0.27.json` evidence.
- Documentation (Phase 10): new `docs/acp.md` is the full ACP coding-host reference (seam = capability, event mapping table, caps, security); `docs/ag-ui.md` shrinks ACP to a summary + link; `docs/migration.md` gains the 0.0.26 → 0.0.27 section; `docs/index.md` lists ACP under frontend interoperability; `docs/agent-events.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/mcp-tools.md`, `docs/host-security.md` gain ACP pointers; package README ACP section updated.
- A2UI renderer core values exported from the `@arnilo/prism-ag-ui/renderer` subpath entry (Synapta FR): `A2UiSurfaceState`, `reduceA2UiOps`, `readA2UiBatch`, `resolvePointer`, `A2UI_VERSION` — framework hosts can drive the validated DOM-free surface state machine without mounting a renderer or importing `dist/` directly; `createA2UiRenderer` behavior and the frozen A2UI limits unchanged.

## [0.0.26] - 2026-08-06

## [0.0.26] - 2026-08-06

### Added
- `createReasoningEncryptedValue` (FR-3): bounded `AgUiReasoningProjection.encryptedValue` fragment for the `reasoning` projection callback from a host-owned `encrypt` function; fails closed on missing/throwing/non-string `encrypt`, never infers an encrypted value from a Prism reasoning signature, truncates to `maxBytes` (default `DEFAULT_MAX_REASONING_BYTES`, clamped to `HARD_MAX_REASONING_BYTES`). See [ag-ui docs](../../docs/ag-ui.md).
- MCP Apps UI-initiated mutation retry (FR-4): `createAgUiMcpAppHandler` accepts optional `effectStore` + `effectContext`; every approved `tools/call` records `begin` → `markDispatched` → `complete`/`fail`/`markUnknown` (abort/transport loss → `unknown`). New `reconcileAppEffect` / `deriveAppEffectKey` / `hashJson` exports let the host resolve unknown records against the actual outcome (claim/CAS); retries replay completed results idempotently, other states fail closed with `409` until reconciled. The proxy never auto-retries; absent `effectStore` keeps 0.0.25 behavior.
- A2A server-side exposure (Task 13): `createAgUiA2AServer({ card, authorize, sessionFactory, input?, projection?, redactor?, a2ui?, durable?, tasks?, push?, parts?, endpointPath?, limits?, a2aLimits?, selectTaskId? })` fronts a local AG-UI agent as an A2A 1.0 server over supervisor's `createA2AHandler`; `SendMessage`/`SendStreamingMessage` stream text/activity/state as bounded artifact updates with a terminal task; `agent_suspended` → `TASK_STATE_INPUT_REQUIRED`; bounded live task registry for `GetTask`/`ListTasks`/`CancelTask`; optional `durable` replays finished runs from an `AgentEventSource` with cursor event ids; text parts become the AG-UI user message and other parts arrive in `forwardedProps.a2a` for `input.project`. Lazy optional-peer import — the supervisor peer is required only when the factory is called. See [A2A interoperability](../../docs/a2a.md).
- Reference frontend renderer (Task 14): new `@arnilo/prism-ag-ui/renderer` subpath export — `createA2UiRenderer({ stream, catalog?, limits?, onAction?, onError?, dom? })` consumes an AG-UI event stream (SSE or in-memory `AsyncIterable`) and renders `a2ui-surface` snapshots/deltas into DOM surfaces from a host component catalog. DOM-free `reduceA2UiOps` core (surface/component/data-model state machine, JSON-Pointer bindings, snapshot replace / delta append); thin DOM binding with a built-in default Text/Container/Column/Row/Button catalog; server-side A2UI caps enforced client-side (ops/message, op bytes, surfaces/run, component depth); invalid/oversized ops drop closed with a bounded `prism.a2ui.error` event; unknown components render explicit placeholders; never executes remote HTML (no HTML-string assignment, no dynamic code evaluation). No new dependency, no host build step, no jsdom. See [ag-ui docs](../../docs/ag-ui.md).

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Added
- Opt-in A2UI painting middleware (`a2ui` handler option) and standard projectors (`createMessagesFromSessionProjection`, `createStateFromStoreProjection`, `createActivityFromToolProgressProjection`, `composeAgUiProjections`).
- Batch interrupt/resume via shared `RunDecision[]`; ACP four-outcome permission mapping.

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
