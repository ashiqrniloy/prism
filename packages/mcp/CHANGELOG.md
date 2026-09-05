## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

# Changelog
## [Unreleased] — 2026-07-28 adoption (plan 063)

### Changed
- **Modular TypeScript SDK v2 (plan 063 task 1):** `@modelcontextprotocol/sdk` 1.30.0 → exact pins `@modelcontextprotocol/client` + `@modelcontextprotocol/server` 2.0.0. All client/server/transport/auth imports moved to the modular packages; `CompatibilityCallToolResultSchema` (`toolResult` member) is gone from the client codec; unknown tools now error (`-32602`) instead of `isError` results; OAuth persistence is SDK issuer-stamped (`StoredOAuthTokens`/`StoredOAuthClientInformation`) with issuer-keyed reads.
- **Modern client negotiation + subscriptions (plan 063 task 2):** `connectMcpTools`/`connectMcpCapabilities` gain `protocolVersion` (`"legacy" | "auto | {pin}`) with one bounded `server/discover` probe per auto connection; the bridge exposes the negotiated `protocolEra`/`protocolVersion`; modern tool calls emit SDK-managed standard headers with `Mcp-Param-*` mirrors from retained `x-mcp-header` declarations; SDK `listChanged` + explicit-cursor list APIs + `callTool({toolDefinition})` replace custom wire handling; SEP-2549 list-cache hints honored (`ttlMs` ceiling = min(hint, configured), absent/zero = refetch-always), cache is private per principal by default.
- **MRTR auto-fulfilment (plan 063 task 3):** elicitation works across eras — legacy `elicitation/create` dispatch, or SDK `input_required` auto-fulfilment on 2026-07-28 (`inputRequired: {autoFulfill: true, maxRounds}` capped by the new `maxMrtrRounds` option, default and hard cap 10). Roots/sampling callbacks are `@deprecated` (SEP-2577) and kept for legacy callers.
- **Dual-era serving (plan 063 task 4):** `createPrismMcpWebHandler(factory)` serves 2026-07-28 via SDK `createMcpHandler` (fresh `McpServer` per request) with the stateless fallback for 2025 traffic, and gains `fetch`/`close`/`notify`/`bus` lifecycle; host/origin allowlists run before body parsing and auth; `servePrismMcpStdio` replaces hand-wired stdio; `cacheHints` option emits SEP-2549 hints. `relayStatelessBody` removed (obsolete).
- **OAuth 2026-07-28 conformance (plan 063 task 5):** `finishAuth(URLSearchParams)` validates persisted `state` fail-closed then RFC 9207 `iss`; issuer-keyed credential storage; CIMD preferred, DCR deprecated (`application_type` defaults `"native"`); explicit `onInsufficientScope: "reauthorize" | "throw"`; server challenges carry the configured scope.
- **Tool schema fidelity + no-arg prompts (found by the official conformance suite, plan 063 task 7):** registered tool `inputSchema` now reaches the wire verbatim via SDK `fromJsonSchema` (`$schema`/`$defs`/`$ref`/`additionalProperties` survive the `tools/list` round-trip; AJV-backed argument validation); prompt `argsSchema` defaults to `{}` so callers may omit the arguments object.

### Added
- `scripts/mcp-conformance-2026.mjs` deterministic official-conformance runner with the recorded boundary baseline (`scripts/mcp-conformance-2026-baseline.yaml`); conformance matrix and performance record in `docs/mcp-tools.md` / `docs/migration.md` (plan 063 task 7). Tasks (`io.modelcontextprotocol/tasks`) intentionally not advertised; draft vocabulary fails closed.

## [0.2.1] - 2026-08-13

### Changed
- 0.2.1 (plan 021): transport pinning lifted to the core pinnedFetch primitive — createSecureMcpFetch and OAuth discovery re-route through it with byte-identical McpBridgeError/McpOAuthError behavior and redirects rejected; boundResponse/defaultResolver/isLoopbackAddress/isLoopbackHostname/normalizeHostname/raceAbort/requestPinned/resolvePinnedAddress remain exported as re-exports from @arnilo/prism (same names/signatures).



## [0.1.1] - 2026-08-10

### Changed
- Stateless SSE relay extracted into `relayStatelessBody` (internal module export, not in the package entry surface) with deterministic unit + E2E tests (`src/__tests__/sse-relay.test.ts`); behavior-preserving.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Added
- MCP OAuth client/server integration (RFC 9728 + RFC 8414 discovery, PKCE, token refresh, RFC 7591 DCR, RFC 8707 resource binding, RFC 7009 revocation): `createMcpClientAuth`, `McpClientAuthOptions`, `McpClientAuthState` persistence seam, `McpOAuthRegistrationStrategy` (static | dcr), `McpOAuthError` (ERR_PRISM_MCP_OAUTH_*), `createMcpOAuthFetch`/`createMcpOAuthTransport` (SSRF-checked, DNS-pinned, redirect-free, byte-bounded discovery fetch; bearer tokens never leave the allowed server origin), `protectedResource` option on `createPrismMcpWebHandler` serving `/.well-known/oauth-protected-resource` with `WWW-Authenticate` challenges on unauthenticated requests.
- `createPrismMcpWebHandler` stateless mode now requires a server factory and creates a fresh SDK transport per request (SDK stateless transports cannot be reused); `McpProtectedResource.resource` is required (RFC 9728, SDK PRM schema).

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Added
- `mcpElicitationDecision` / `mcpElicitationResultFromDecision` map MCP elicitation onto the shared pending-decision model (humanInteraction fail-closed).

### Changed
- Released with exact 0.0.25 graph.

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
- Dependency: `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0 (clears moderate `@hono/node-server` path-traversal advisory on the MCP HTTP stack).

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

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Pinned official MCP SDK 1.29.0 and added bounded capability bridge for resources, prompts, roots, sampling, and form/URL elicitation with stable unsupported errors.
- Added explicitly selected, per-call-authorized server resources/prompts and official list-change capability declarations.
- Added opt-in Streamable HTTP sessions bound on every request to host-validated principal identity; stateless mode remains default and Last-Event-ID replay remains unsupported.

## [0.0.7] - 2026-07-19

- `CreatePrismMcpServerOptions.guardrails` applies shared core tool-input/output guardrails to registered Prism tools; commands remain explicit host callbacks.
- `CreatePrismMcpServerOptions.limits` applies shared core tool-call accounting to registered Prism tools.
- Explicit `agentRuns` capabilities register bounded `agent.<id>.status` and `agent.<id>.resume` tools backed by core durable lifecycle CAS; no lifecycle tool is registered by default.

## [0.0.6] - 2026-07-19

- Added finite page/tool/cursor/metadata/schema/JSON/result/client-option limits and atomic discovery refresh using raw SDK list/call requests.
- Streamable HTTP now requires exact HTTPS origins, rejects credentials/fragments/redirects/private or mixed DNS, pins a validated address for every request, and bounds responses; plaintext is loopback-only and explicit.
- Structured content, compatibility `toolResult`, content blocks, and remote error summaries now enter Prism through one aggregate byte/depth/property boundary.

## [0.0.5] - 2026-07-16

- Added explicit authorized Prism tool/command MCP server registration and bounded Web-standard Streamable HTTP handling.

## [0.0.4] - 2026-07-14

- Added stdio/Streamable HTTP transports, paginated listing/cache refresh, deterministic name collision checks, bounded result mapping, abort forwarding, and attributable call timeouts.

## [0.0.3]

- Initial release: `connectMcpTools` MCP client bridge for Plan 055 Task 3.
