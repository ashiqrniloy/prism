# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

All notable changes to this project will be documented in this file.

## [0.0.96] - 2026-07-21

### Changed

- Package graph and runtime version pins bumped from 0.0.9 to 0.0.96 for a clean publish tag after the mistaken `v0.0.95` tag and TypeScript 7 / workspace-order CI fixes.

## Unreleased

## [0.0.9] - 2026-07-21

### Added

- Production coding and browser execution for Release 0.0.9: disposable Docker sandbox, bounded native repository list/search, structured Git/named checks/PR handoff, durable coding-plan/checkpoint composition, and optional `@arnilo/prism-browser` with egress/side-effect/upload/download/screenshot policy.
- Versioned all 32 first-party manifests and exact internal ranges to 0.0.9 (adds `@arnilo/prism-browser` to the publishable graph; browser stays out of `@arnilo/prism-code` and activates only through explicit install or `@arnilo/prism-all`).
- Added network-free coding/browser adversarial evaluation fixtures, `scripts/benchmark-0.0.9.mjs`, and protected Docker/Playwright gates via `.github/workflows/sandbox-browser.yml`.
- Office execution remains outside Prism packaging by product decision (host-selected skills/instructions only).
- `tryParseJsonObjectArguments` and `toolCallFromArgumentsText` for recoverable streamed tool-call argument parsing.

### Fixed

- Malformed streamed tool-call arguments (id+name present) become failed/`tool_execution_blocked` tool results (`invalid_arguments` / `invalid_json_arguments`) instead of terminal `ProviderTransportError`, so models can self-correct within existing turn budgets.
- Incomplete tool-call deltas (missing id/name) fail with typed `ProviderTransportError` / `ErrorInfo.code: "incomplete_delta"` instead of a bare `Error("Incomplete tool call delta...")`; openai-compatible streams no longer emit `done` alongside leftover incomplete deltas.
- Empty/whitespace-only call-free artifact candidates (including thinking-only output) are `parse_error` through the revision budget; `generate-validate-revise` session runs no longer resolve `succeeded` without `artifact_finished`.

## [0.0.8] - 2026-07-20

### Added

- Added OpenTelemetry GenAI agent/provider/tool hierarchy, context propagation, delegation/guardrail spans, bounded trace references, and evaluation linkage.
- Added bounded evaluation trace resolution, host model judges, deterministic pairwise reports, serialized artifacts, and CI threshold assertions.
- Added MCP resources/prompts/roots/sampling/elicitation plus principal-bound Streamable HTTP sessions on pinned SDK 1.29.0, and full A2A 1.0 durable task/rich-part/reconnect/push interoperability.
- Added immutable-revision CodeQL/dependency/SBOM/license/secret/attestation release gates, weekly dependency updates, and protected bounded provider/MCP/A2A/web live canaries.
- Added optional `@arnilo/prism-web-tools` with bounded host-selected Brave/Exa search, Firecrawl Markdown/schema extraction, stable citations, late credentials, and explicit untrusted-content results.
- Added optional `createBatchedRunLedger()` with bounded FIFO/backpressure, explicit durability/flush status, terminal acknowledgement, and documented buffered crash-loss semantics.
- Added one-leaf, one-second runtime session snapshot caching with mutation/checkout/resume invalidation and reproducible network-free 0.0.8 performance evidence.
- Versioned all 31 first-party manifests and exact internal ranges to 0.0.8; no tag or publication was created.

### Fixed

- `generateValidateReviseLoop` routes artifact parse failures through the revision budget (`metadata.reason: "parse_error"`, repairer receives `value: undefined`) instead of returning silently after one provider turn.
- `@arnilo/prism-provider-opencode-go` Anthropic route sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers alongside Bearer, fixing HTTP 401 on MiniMax/Qwen models; `structuredOutput: "json_schema"` is no longer inferred from OpenAI routing alone (verified models only), fixing HTTP 400 on `deepseek-v4-pro`; both stream parsers require protocol completion evidence and fail truncated streams with a terminal `error` instead of a false `done`.
- `@arnilo/prism-provider-kimi` aligns with official contracts: featured Coding `k3` defaults `reasoning_effort: "high"`, 256K-class context windows use the exact `262_144`, the featured Moonshot catalog adds `kimi-k2.7-code-highspeed`/`kimi-k2.6`/`kimi-k2.5`, routing keys (`route`, `preserve_thinking`) no longer leak into wire bodies, the Coding route sends provider-owned `x-api-key`/`anthropic-version` headers, and both stream parsers fail truncated streams instead of emitting `done`.

## [0.0.7] - 2026-07-19

### Added

- Typed `Guardrails` for input, provider output, tool input, and tool output. Guardrail decisions are bounded/redacted `guardrail_decision` events; provider output is buffered before exposure when output checks are configured.
- Workflow tool nodes and MCP server tool registrations now route optional tool guardrails through shared `dispatchToolCall()`.
- `RunLimits` adds validated, narrowing-only budgets for turns, provider attempts, tool rounds/calls, wall time, request/response bytes, token usage, and optional single-currency cost. Breaches emit one `run_limit_exceeded` event and return `AgentRunError.result.limit`.
- Opt-in durable built-in agent runs can suspend before a tool side effect and resume through versioned, bounded, redacted checkpoint state with CAS approval, ownership/fingerprint checks, and no automatic replay of an ambiguous dispatched tool.
- `createSecureAgent()` composes strict tool schemas/validation, trust and permission gates, redaction, finite limits, exact ownership, and durable pre-tool approval without changing low-level `createAgent()` defaults.
- `createAgentRunLifecycle()` adds explicit, ownership-scoped durable agent status/resume capability for selected server and MCP exposures; no lifecycle route/tool is enabled by default.

## [0.0.6] - 2026-07-19

### Added

- Caller-gated model discovery: `listOpenAIModels`, `listKimiModels`, `listZaiModels`, `listOpenRouterModels`, and `listOpenCodeGoModels`. Provider setup remains network-free; hosts explicitly fetch and register current models.
- Shared `ThinkingLevel` helpers and use-case model bindings. Background compaction and observational-memory jobs can use an explicit provider/model or a supplied session-model fallback.
- Opt-in sequential artifact-loop tools: `loop: { strategy: "generate-validate-revise", toolCalls: "bounded" }`. Tool rounds use existing authorization/redaction/ledger paths, share `maxToolRounds` across candidates, and fail with `artifact_failed` metadata `{ reason: "tool_round_limit" }` after exhaustion.
- Checksummed SQLite/PostgreSQL migration histories and catalog-shape verification, bounded JSON Schema compilation LRU, and public `assertFiniteVector` validation.

### Changed

- Provider packages now document and implement current cache, reasoning, streaming, and discovery behavior. OpenAI Responses replay/function-call/SSE argument handling is corrected; Kimi adds optional Moonshot support; Z.AI and OpenCode Go catalogs/routes were refreshed; OpenRouter discovery/reasoning and NeuralWatt thinking controls are hardened. AI SDK remains host-model-owned.
- Workflow definitions now require a non-empty `revision`; cancellation requires exact ownership and the current workflow definition. All workflow limits have finite hard caps.
- Coding tools now enforce bounded streamed reads, write/edit inputs, shell wall time, total output, and spill-file lifecycle. Custom coding operation interfaces now receive bounded read/stat/write/edit options and abort signals.
- Encrypted credential helpers `encryptBytes`, `decryptBytes`, and envelope rotation are asynchronous. Existing credential files must meet restrictive Unix permission requirements. Linux Secret Service/GNOME Keyring byte-array reads are accepted by the keychain store.
- MCP Streamable HTTP requires HTTPS and explicit `allowedOrigins`; loopback HTTP requires explicit opt-in. Discovery, schemas, results, and response bodies are bounded.
- Compaction and observational-memory workers now have finite turn/call/transcript/error budgets. A2A streaming uses strict incremental UTF-8 and LF/CRLF SSE parsing.
- Generated Prism, workflow, and evaluation IDs use cryptographic UUIDs; non-finite embedding vectors now fail before scoring or persistence.

### Security

- Fixed cross-owner workflow cancellation and duplicate active-run overwrite risks.
- Added fail-closed limits and validation at file, process, credential, MCP, migration, schema, vector, provider-worker, and A2A trust boundaries.

### Upgrade notes

- Finish or deliberately migrate pre-0.0.6 workflow runs/checkpoints before upgrading: their definition hashes lack the required revision.
- Update workflow definitions with `revision`, cancellation callers with `workflow` plus exact ownership, MCP HTTP configs with `allowedOrigins`, and custom coding/credential integrations for the changed interfaces above.

## [0.0.5] - 2026-07-16

- `@arnilo/prism-providers` now installs all seven first-party adapters including AI SDK interoperability; `@arnilo/prism-all` now installs every first-party package while activating none automatically.

- Added optional `@arnilo/prism-supervisor` with bounded explicit child delegation, derived memory scope IDs, narrowing-only permissions, A2A 1.0 cards/ES256 signatures, authorized JSON-RPC/SSE serving, and an exact-origin remote client.

- Added bounded immutable run/trace feedback with exact ownership, evaluation linkage, memory/SQLite/PostgreSQL stores, schema migration 003, and safe OpenTelemetry projection.

- Phase 11 extends workflows with explicit durable schedules/background execution, nested composition, bounded validated state, immutable-lineage replay, and optional command/Web bindings over existing checkpoint/lease primitives.

- Optional `@arnilo/prism-server` package with authorized bounded Web-standard direct/SSE agent and durable workflow routes; `@arnilo/prism-mcp` now supports explicit authorized Prism tool/command server exposure and bounded Web-standard Streamable HTTP handling.
- Optional `@arnilo/prism-rag` package: bounded deterministic text/Markdown chunking, Phase 7 vector indexing/retrieval, stable citations, metadata filters, redaction, and explicit ContextProvider injection.
- Workflows now support durable human `suspend()`/approve/deny, expected-version exact-once resume, validated/redacted resume payloads, and opt-in tool approval with execution-policy recheck.

### Added

- Optional `@arnilo/prism-memory` package: schema/template-backed working memory, semantic recall, package-owned `Embedder`/`VectorStore` contracts, in-memory adapters, context provider, opt-in processor, shared conformance, and PostgreSQL/pgvector production path.

## [0.0.4] - 2026-07-14

### Added

- Shared bounded provider transport, OpenAI serialization/media helpers, native structured-output contracts, provider/tool timing metadata, and audio/file/document content capability checks.
- Generic checkpoint, atomic lease, and bounded event-multiplexer contracts plus persistence/run-ledger conformance helpers.
- Optional packages for JSON Schema tool validation, MCP, coding approval/sandboxing, OpenTelemetry, encrypted/keychain credentials, SQLite/PostgreSQL persistence, and bounded workflow orchestration.
- Manifest-only `base`, `code`, and `sdk` profiles; `prism-all` now transitively installs every first-party package.
- Workflow, multimodal, persistence/resume, provider telemetry, cache, and external-adapter examples.

### Changed

- Single-shot loops support ordered bounded parallel tools; `ToolDefinition.exclusive` serializes dangerous turns without reducing later concurrency.
- Provider requests, SSE/error bodies, media, schemas, event queues, checkpoints, and workflow fan-out/output use documented finite limits.
- Session/ledger writes preserve order and redact before persistence; revision-loop transcript ordering and OAuth abort polling are hardened.
- All first-party providers use shared bounded transport helpers and expose current structured-output, multimodal, caching, reasoning, telemetry, and retry behavior where supported.

### Security

- Added fail-closed schema/prototype-pollution, SSRF/media, SQL/tenant, path/shell approval, MCP result, credential-envelope, OAuth, redaction, and stale-worker fencing coverage.
- Optional privileged capabilities remain inactive until hosts explicitly register transports/tools, configure roots/credentials/databases, and approve execution.

## [0.0.3] - 2026-07-08

### Added

- New first-party workspace package `@arnilo/prism-coding-agent` providing optional host coding tools (`shell`, `read`, `write`, `edit`) as Prism `ToolDefinition` objects. The package is opt-in and is **not** included in `@arnilo/prism-all` because the tools perform host shell/filesystem operations.
- `createCodingTools`, `createReadOnlyTools`, and `createAllTools` aggregator factories for importing/registering coding tools.
- Documentation: `docs/coding-agent-tools.md`, updated `docs/index.md` and `docs/tools.md`, and expanded `packages/coding-agent/README.md`.

### Changed

- Bumped all package versions from `0.0.2` to `0.0.3` (core, first-party workspace packages, and umbrella packages).
- Updated `@arnilo/prism` peer dependency range in every first-party workspace package to `0.0.3`.
- Updated umbrella package dependency pins to `0.0.3`.
- `docs/release-and-install.md` now documents nine first-party workspace packages, thirteen total manifests, and the explicit install command for `@arnilo/prism-coding-agent`.

## [0.0.2] - 2026-07-05

### Added

- Added `LICENSE` (MIT) and `CHANGELOG.md` to the published `prism` package.
- Added npm package metadata: `license`, `repository`, `bugs`, `homepage`,
  `keywords`, and `sideEffects`.

### Changed

- `files` whitelist now explicitly excludes `dist/__tests__/` and
  `dist/**/*.map` from published tarballs; source maps remain emitted locally
  for debugging but are no longer shipped.
- Core tarball now ships the `/docs` hub.
- Made `prism` a required peer dependency for all first-party workspace packages; it is no longer optional. The peer range remains `0.0.2` and will widen to `^1.0.0` at the 1.x stable release.
- Pinned the no-network `npm test` budget at < 60s on Node 20 (measured baseline ~45s) after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests.

## [0.0.1] - 2026-06-22

### Added

- Initial release of Prism: a framework for building agentic LLM applications
  with configurable providers, sessions, tools, context providers, compaction,
  extensions, and trust boundaries.
