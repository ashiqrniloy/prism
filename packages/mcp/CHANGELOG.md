# Changelog

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
