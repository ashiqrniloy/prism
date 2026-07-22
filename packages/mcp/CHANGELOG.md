# Changelog
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
