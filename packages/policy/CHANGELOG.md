# Changelog

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Added
- `@arnilo/prism-policy/opa` subpath: `createOpaPolicyEvaluator` — OPA REST decision adapter (plan 011 Task 2) over native `fetch` (no OPA SDK): host-pinned SSRF-checked `POST /v1/data/<path>` with `{"input": <document>}`; default input carries redacted actor refs only (prompts/tool args/JWTs/credentials never included; unrestricted payload keys rejected); boolean / `{allow}` / `{outcome, reason?, evidenceRefs?, expiresAt?}` decision mapping; bounded caps (timeout 2/30 s, input 16/256 KiB, response 64 KiB/1 MiB, retries 0/2, timeout/transport/5xx only); fail-closed default `onFailure: "deny"` (recorded deny rows) vs `"escalate"`; optional `requirePolicyVersion` bundle-revision pin via `provenance=true`; optional `SecretRedactor` on OPA-provided reason/evidence refs; caller aborts propagate. Frozen codes `ERR_PRISM_OPA_*`; decisions flow unchanged through `evaluateAndAppend` into durable Phase 6 stores.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Changed
- Released with exact 0.0.25 graph.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Documented optional `@arnilo/prism-enterprise-postgres` `PolicyDecisionStore` composition; memory/file adapters remain development/reference stores.

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

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Added

- Optional policy evaluator, append-only decision ledger (memory + JSONL file), and cursor-paginated audit export with frozen byte/page caps. Redacted evidence refs only; unrestricted payloads rejected.
