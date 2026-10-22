# Changelog

## [Unreleased]

### Added

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
