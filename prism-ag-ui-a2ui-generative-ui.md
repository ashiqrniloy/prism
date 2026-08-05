# Prism AG-UI: A2UI painting middleware and standard projectors

Status: **requested**. Filed against Prism `0.0.24` (`@arnilo/prism-ag-ui`, AG-UI `0.0.57` compatibility shipped). Synapta is upgrading `0.0.14 → 0.0.24` now and adopting AG-UI server-side immediately; the items below gate Synapta's A2UI (generative UI) phase, which by roadmap rule does not start until they ship upstream.

Context: Synapta is a digital-employee platform (agentic ERP). Agent↔client communication is being standardized fully on AG-UI via `@arnilo/prism-ag-ui`. The harness UI renders agent-generated ad-hoc surfaces from a constrained component catalog — the exact A2UI model (declarative, pre-approved catalog, no code execution). Prior FR precedent: `prism-structured-output-final-turn-only.md` (shipped in 0.0.11).

---

## FR-1 (P0, blocking): A2UI painting middleware in `@arnilo/prism-ag-ui`

### Summary

`@ag-ui/a2ui-middleware` is the official server-side bridge that detects A2UI operations and paints them as `a2ui-surface` `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA` events on the AG-UI stream. Prism 0.0.24 emits `ACTIVITY_*` only through a hand-written host `projection.activity` allow-list callback, so every Prism host that wants A2UI must re-implement the same detection/painting/incremental-update logic. Request: ship an opt-in A2UI middleware/projection in `@arnilo/prism-ag-ui` with parity to the official middleware semantics.

### Requested behavior

1. **Fixed-schema mode**: a dispatched tool result containing an `a2ui_operations` envelope (`createSurface`, `updateComponents`, `updateDataModel` per A2UI v0.9.1, forward-compatible with v1.0 candidate) is detected and painted as an `a2ui-surface` activity message — `createSurface` once per `surfaceId`, later operations as deltas.
2. **Streaming mode**: a designated render tool (e.g. `render_a2ui`) streams its arguments through the normal `TOOL_CALL_ARGS` path; the middleware incrementally paints activity deltas so surfaces build progressively as the model generates them.
3. **Catalog stamping**: host-configured `defaultCatalogId` applied when the client did not forward a catalog; the model never invents catalog ids.
4. **Validation/bounds**: operations schema-validated and bounded by the existing handler caps; invalid operations produce a bounded error event, never stream corruption or partial unvalidated paint.
5. **Action round-trip**: A2UI user actions arriving in subsequent `RunAgentInput` (tool-result / activity-reference shape) are surfaced to `input.project` in a documented, untrusted-input shape so the session can consume them.
6. Security posture unchanged: opt-in, allow-listed, redaction applied before paint; A2UI payloads treated as untrusted model output until validated.

### Acceptance criteria

- `createAgUiHandler({ a2ui: { catalogId, mode } })` (or equivalent opt-in) with no host-written painting code required for the two modes above.
- All emitted events validate against official `EventSchemas`; `activityType: "a2ui-surface"` payloads interoperate with the official A2UI renderers (Lit/React) and `@ag-ui/client` activity-message handling.
- Compile-checked example `examples/ag-ui-a2ui.ts` plus conformance coverage against the official `@ag-ui/a2ui-middleware` fixtures/behaviors.

### References

- Official middleware: `@ag-ui/a2ui-middleware` (ag-ui repo `middlewares/`), integration skill `skills/ag-ui-a2ui-integration/SKILL.md`.
- A2UI spec: https://a2ui.org/specification/v0.9.1-a2ui/ (v1.0 candidate: `specification/v1.0-a2ui/`).

---

## FR-2 (P0, blocking): Standard opt-in projectors for state, messages, and activity

### Summary

In 0.0.24 the mapper deterministically emits `RUN_*` / `STEP_*` / `TEXT_MESSAGE_*` / `TOOL_CALL_*`; everything else (`STATE_SNAPSHOT`/`STATE_DELTA`, `MESSAGES_SNAPSHOT`, `ACTIVITY_*`, `REASONING_*`) requires a hand-written host projector. The allow-list-by-default posture is correct — but the common cases (transcript snapshot from session history; state snapshot/delta from a declared run-state store; activity from tool progress records) are identical across hosts. Request: ship batteries-included **opt-in** projectors for the standard families.

### Requested behavior

- `projection.messagesFromSession()` — emits `MESSAGES_SNAPSHOT` from the authorized session's history (roles redacted per host policy).
- `projection.stateFromStore(store)` — emits `STATE_SNAPSHOT` on run start and `STATE_DELTA` (RFC 6902) on store change notifications.
- `projection.activityFromToolProgress()` — emits `ACTIVITY_SNAPSHOT`/`ACTIVITY_DELTA` from durable tool-progress records.
- Each is an explicit opt-in composing the existing `AgUiProjection` allow-list; caps, redaction, and ownership semantics unchanged.

### Acceptance criteria

- The three projectors above are one-line opt-ins in `createAgUiHandler`; no host code needed for the documented common shapes.
- Host-written custom projectors still compose alongside them.

---

## FR-3 (P2): Reasoning encrypted-value helper

Today a host must supply an already client-encrypted opaque value for `REASONING_ENCRYPTED_VALUE`; Prism never produces one from provider reasoning signatures. Request an opt-in helper that seals provider reasoning signatures/items into client-opaque values (host-supplied key material, Prism-owned sealing format), so hosts can surface reasoning continuity without hand-rolling envelope encryption. Not blocking; Synapta does not surface reasoning to clients yet.

## FR-4 (P2): MCP Apps UI-initiated mutation retry (endorse existing Task 4)

The 0.0.24 docs note the shipped MCP Apps proxy does not retry UI-initiated mutations and that "Task 4 adds generic durable effect recovery." Synapta endorses this for a future release. Use case: agent-rendered approval/action cards (irreversible business actions) where a UI-initiated mutation interrupted mid-call needs bounded, idempotent recovery through the new `ToolEffectStore` claim/CAS lifecycle rather than silent loss.

## FR-5 (P2, optional): NATS JetStream `AgentEventSource` adapter

0.0.24's durable `AgentEventSource` ships PostgreSQL LISTEN/NOTIFY, which Synapta can run. Synapta's cross-service backbone is NATS JetStream (transactional outbox pattern); a JetStream-backed `AgentEventSource` (durable consumer, per-subject replay, at-least-once with stable event IDs) would keep one messaging backbone for agent event fan-out. Postgres is an acceptable interim — do not prioritize over FR-1/FR-2.

---

## Explicitly not requested

- **WebSocket / binary protobuf transport** — SSE is sufficient behind Synapta's ingress (APISIX) and matches the existing event-driven pattern.
- **A2A server-side exposure** — Synapta defers external agent interop until a real counterparty exists; `createAgUiA2AAdapter` (client-side fronting) already covers the future UI path.
- **Frontend client/renderer work** — Synapta owns its Svelte client layer over `@ag-ui/client`; not a Prism concern.

## Sequencing ask

FR-1 + FR-2 in the next minor release (`0.0.25`) if feasible. Synapta's roadmap gates its entire generative-UI phase (Phase AG-4) on that release; server-side AG-UI (Phase AG-2) and client migration (Phase AG-3) proceed on 0.0.24 in parallel.
