# Changelog

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
