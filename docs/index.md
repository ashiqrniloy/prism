# Prism Docs

Prism is a TypeScript/Node.js agent harness. Host apps and extension packages own providers, tools, resources, credentials, storage, UI, and business behavior. Prism supplies contracts, registries, streaming events, and replaceable runtime primitives.

## Public contracts
- [Public contracts](public-contracts.md): type shapes for messages, agents, tools, stores, generic `CheckpointStore`, atomic `LeaseStore`, bounded `EventMultiplexer`, resources, credentials, and events.

## Agent/session runtime
- [Agent/session runtime](agent-session-runtime.md): create explicit or opt-in secure agents/sessions, get direct `AgentRunResult` values from `run`/`prompt`, use integrated `stream()`, subscribe to normalized events, and expose opted-in durable lifecycle capabilities.
- [Agent definitions](agent-definitions.md): resolve declarative `AgentDefinition` values via `resolveAgentDefinition`, and turn app-config `<configRoot>/agents/<name>/AGENT.md` bundles into runnable agents via `discoverAgentBundles` / `resolveAgentBundle` (explicit tool/skill activation by name, fail-closed omitted capabilities, migration-only `activateAllCapabilities`, strict duplicate scope checks, configurable prompt layers, no auto-discovery).
- [Agent loops](agent-loops.md): replaceable per-run control loops — `singleShotLoop` default and opt-in bounded artifact-loop tool rounds with host-supplied `validator`/`parser`/`repairer` callbacks.
- [Guardrails](guardrails.md): typed fail-closed input/output/tool checks with buffered provider output and redacted decision records.
- [Agent events](agent-events.md): the `AgentEvent` stream — agent/turn/message (including live `tool_call_delta` fragments), provider turn timing, tool execution, queue/subscriber overflow, compaction/retry, artifact validation/refinement, and error variants, redacted via `redactAgentEvent`.
- [Observability](observability.md): metadata-only provider/tool and run-feedback/evaluation projection, terminal span cleanup, low-cardinality metrics, and optional `@arnilo/prism-observability-opentelemetry` adapter.
- [Evaluations](evaluations.md): optional deterministic scorers/datasets/experiments plus ID-only linkage from evaluation records to immutable owned run feedback.
- [Runs and usage ledger](runs-and-usage.md): durable run/event/tool/usage persistence plus bounded immutable run/trace feedback, evaluation links, ownership, redaction, query, and deletion semantics.
- [Performance limits](performance.md): bounded live subscriber queues, branch-read pagination expectations, JSONL/dev-store limits, and production sizing assumptions.
- [Structured output](structured-output.md): the `Artifact*` seam plus provider-native `StructuredOutputOptions` / `structuredOutputMode` for capable models.

## Compaction/session memory
- [Compaction and retry policies](compaction-and-retry.md): summarize branch history and retry transient provider failures with host-replaceable policies.
- [LLM compaction package](compaction-llm.md): optional provider-backed strategy with finite summary/reserve/error caps, bounded redacted streaming retention, and mandatory finite post-policy `model.parameters.maxTokens`.
- [Observational memory compaction package](compaction-observational-memory.md): optional source-backed memory with owned append callback, finite turn/call/argument/result/transcript/error worker limits, redacted provider-valid transcripts, fast compaction, recall, and status/view commands; worker model falls back to host-supplied `sessionModel`.
- [Working and semantic memory](working-and-semantic-memory.md): optional `@arnilo/prism-memory` working-memory store, semantic recall, finite Embedder/VectorStore contracts, in-memory adapters, and PostgreSQL/pgvector path.
- [Session stores](session-stores.md): `SessionStore` contract, `SessionAppendOptions`, `SessionAppendConflictError`, branch handles, `readBranchPath`, and dev-vs-production branch reads — start here for session persistence.
- [Session stores and branching](session-stores-and-branching.md): detailed branch semantics and helper reference (kept for compatibility; links back to the canonical atomic append / branch-handle sections).
- [Database persistence](database-persistence.md): production persistence contracts, shared checksummed migration/full-shape catalog primitives (`@arnilo/prism/testing/persistence-schema`), conditional append, indexes, `readBranchPath`, reference relational schema, retention, and NoSQL mapping.
- [SQLite persistence](sqlite-persistence.md): optional `better-sqlite3` adapter with session/run storage, checkpoints/leases, feedback, and transactionally verified/backfilled migration-v3 metadata.
- [PostgreSQL persistence](postgres-persistence.md): optional pooled `pg` adapter with session/run/checkpoint/lease/feedback storage, advisory-locked checksummed/full-shape migrations, and opt-in live conformance.
- [Migration guide](migration.md): 0.0.3 compatibility, 0.0.6 hardening, and 0.0.7 guardrails, RunLimits, durable approval/resume, and secure composition.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL file adapter for single-process Node hosts; no cross-process safety.
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): Plan 056 inventory — session/run-ledger/persistence contracts, credential/OAuth seams, content/resource/model capabilities, package dependency matrix, conformance matrix, and threat model for production adapters.

## Provider and model connection
- [Provider primitives](provider-primitives.md): shared bounded transport and OpenAI serialization helpers — migrated across first-party providers; native structured-output and observability contracts.
- [Provider layer](provider-layer.md): register and resolve host-owned providers/models, choose replace-or-error duplicate policy, create provider events, stream/reconstruct tool-call deltas, use generic provider request options, and test with the mock provider; deprecated provider-level timeout/retry hints point to runtime abort/retry.
- [Model registry](model-registry.md): register and resolve `ModelConfig` records with capabilities, limits, cost, cache support metadata, compat data, and duplicate policy.
- [Provider caching](provider-caching.md): use `PromptCacheHints`, `PromptCacheBreakpoint`, `ModelCacheCapabilities`, cache-aware stable-prefix guidance, and shared cache diagnostics helpers; includes a per-provider explicit/implicit cache matrix for OpenAI, OpenRouter, OpenCode Go, Z.AI, Kimi, NeuralWatt, and the host-owned AI SDK adapter; cache hints are best-effort and cache keys are never secrets.
- [Thinking and reasoning](thinking-and-reasoning.md): portable `ThinkingLevel` helpers (`applyThinkingLevel` / `thinkingCompatFor`) map per-turn effort into provider `compat` fields; model defaults stay on `ModelConfig.compat`; no second options tree.
- [Use-case model selection](use-case-model-selection.md): bind `{ model?, provider?, thinkingLevel? }` for observational memory, LLM compaction, and other non-session LLM jobs with explicit session-model fallback via `resolveUseCaseModel`.
- [Provider request policies](provider-request-policies.md): chain `ProviderRequestPolicy` hooks, use `createSessionCachePolicy`, and merge legacy/structured cache options safely.
- [Provider packages](provider-packages.md): define explicit provider packages, model metadata, auth descriptors, request/cache policies, and provider-owned header precedence without package discovery or provider-specific core behavior; includes a first-party cache behavior summary and the **caller-gated on-demand model discovery** contract (`list*Models`, setup zero-fetch).
  - Phase 12 package workspaces: [`@arnilo/prism-provider-openai`](providers/openai.md), [`@arnilo/prism-provider-opencode-go`](providers/opencode-go.md) (official Go open models, dual-route Anthropic/OpenAI, caller-gated `listOpenCodeGoModels`, `reasoning_content`/thinking preserve), [`@arnilo/prism-provider-openrouter`](providers/openrouter.md) (app-controlled catalog, caller-gated `listOpenRouterModels`, `reasoning` merge/preserve, `cache_control` + sticky `session_id`), [`@arnilo/prism-provider-zai`](providers/zai.md) (official `thinking`/`reasoning_effort`/`tool_stream`, implicit cache, caller-gated `listZaiModels`), [`@arnilo/prism-provider-kimi`](providers/kimi.md), and [`@arnilo/prism-provider-neuralwatt`](providers/neuralwatt.md) with implicit vLLM prefix caching, reasoning controls (`reasoning_effort`/`thinking_token_budget`/`enable_thinking`/`preserve_thinking`/`clear_thinking`), reasoning preservation, OpenAI-style tool-call loop, quota, telemetry, and retry classification helpers.
  - Optional AI SDK adapter: [`@arnilo/prism-provider-ai-sdk`](providers/ai-sdk.md) maps host-owned `LanguageModelV4` models onto Prism `AIProvider` streams (specification v4; no Prism catalog; maps `finish.usage` cache read/write tokens; reasoning is host-model-owned).
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider subpath using native or injected `fetch` for Chat Completions streaming.

## Input, prompt, and context assembly
- [SDK customization guide](customization.md): map provider resolution, middleware, context, builders, injectors, loops, compaction, retry, stores, and skills to explicit host-wired APIs.
- [Input and prompt assembly](input-and-prompt-assembly.md): render tiny prompt templates and turn common host input, history, attachments, explicit resources, summaries, and tool results into messages with replaceable builders, provider-input assembly, legacy default order, and opt-in cache-aware ordering. Audio/file/document `ContentBlock` types and capability checks are documented there.
- [Multimodal content](multimodal-content.md): complete-request media resolution and aggregate bounds, DNS-classified/address-pinned URLs, SSRF/MIME policy, and `ModelCapabilities.input` tags.
- [System prompts](system-prompts.md): compose explicit user/package/app/run system prompt layers, auto-load the standard `AGENTS.md` (workspace) / `SYSTEM.md` prompt files via the Node `loadSystemPromptFiles` loader (trust-gated for `AGENTS.md`), and append `SYSTEM.md` → per-agent `AGENT.md` body → repo `AGENTS.md` layers from a discovered agent bundle via `resolveAgentBundle`.
- [Instruction injection](instruction-injection.md): register package injectors that layer redacted instructions/context blocks without granting tools, permissions, or resource escapes.
- [Context and skills](context-and-skills.md): resolve ordered context providers and keep context/skill selection host-owned; omitted declarative skills stay inactive by default, `toolNames` fail closed before provider turns, and strict skill registries prevent silent shadowing.
- [Retrieval-augmented generation](rag.md): optional bounded text/Markdown chunking, Phase 7 vector indexing/retrieval, stable citations, and explicit inert context injection.

## Tools
- [Tools](tools.md): register host-owned active tools with replace-or-error duplicate policy, apply exact allow/deny filtering, dispatch normal or opt-in bounded artifact-loop calls, and optionally bound untrusted JSON Schema compilation.
- [Tool execution primitives](tool-execution-primitives.md): finite JSON Schema LRU validation, exclusive-aware bounded parallel dispatch, MCP bridge mapping, coding execution policy, and image-read bounds.
- [Tool validator JSON Schema package](../packages/tool-validator-json-schema/README.md): optional `@arnilo/prism-tool-validator-json-schema` adapter for `tool.parameters`.
- [MCP client bridge and server exposure](mcp-tools.md): optional bounded atomic tool discovery/results, exact-origin DNS-pinned HTTPS/loopback-only HTTP client transport, and explicitly authorized Prism tools/commands/durable agent lifecycle on SDK `McpServer`.
- [Coding agent tools](coding-agent-tools.md): optional `shell`, `read`, `write`, and `edit` definitions with streamed text pages, bounded image/edit reads and write/edit payloads, finite shell wall/total-output limits, secure host-owned spill cleanup, pluggable bounded operation contracts, per-path mutation serialization, and optional `ExecutionPolicy`. Limits do not sandbox host access—gate with permission/trust policy and `@arnilo/prism-coding-security`.
- [Coding execution approval and sandboxing](coding-security.md): path/command approval, identity-scoped caching, shell-turn exclusivity, and abort-aware streaming sandbox adapters for coding tools.

## Extensions/plugins
- [Contribution discovery (workspace)](contribution-discovery.md): opt-in, realpath-contained directory scanner turning `SKILL.md`/`manifest.json` into inert `DiscoveredContribution` envelopes the host registers — no `import()`, no auto-activate, no provider scanning. Per-agent bundles remain app-controlled and are documented under Agent/session runtime.
- [Contribution registries](contribution-registries.md): explicit host-owned registries for extension/package contributions without hidden globals, with `duplicate: "error"` strict mode for provider/model/tool/skill shadowing prevention.
- [Extension kernel and event bus](extensions.md): load host-provided extensions in order, register contributions, emit lifecycle events, and isolate extension errors.
- [Extension authoring guide](extension-authoring.md): publish third-party extension packages that register inert contributions and show host-owned activation, trust, permissions, redaction, and no-sandbox boundaries.
- [Middleware hooks](middleware-hooks.md): ordered hook registry for provider, input, context, tool, retry, compaction, and session lifecycle boundaries.

## Configuration/manifests
- [Configuration and manifests](configuration-and-manifests.md): merge in-memory JSON config layers and validate data-only package manifests with prototype-pollution key rejection.
- [Node filesystem config loader](node-filesystem-config.md): explicitly read caller-named JSON config files in Node hosts.
- [Resource loading](resource-loading.md): decode text, JSON, binary, and manifest resources through caller-provided loaders with bounded byte limits.

## Server/API
- [Web-standard server handler](server.md): optional framework-free authorized direct/SSE agent, explicitly selected durable agent lifecycle, and durable workflow routes with explicit bounds and zero default exposure.

## Multi-agent and interoperability
- [Supervisor delegation](supervisors.md): optional explicit child allow-list, derived memory scopes, narrowing-only permissions, lifecycle hooks, nested delegation, cancellation, and finite budgets.
- [A2A interoperability](a2a.md): optional A2A 1.0 cards, ES256 signatures, authorized JSON-RPC/SSE handler, and exact-origin client with fatal streaming UTF-8 plus bounded LF/CRLF/multiline SSE parsing.

## CLI/RPC
- [CLI/RPC](cli-rpc.md): Run print/json modes and LF-delimited RPC over the public AgentSession runtime, including branch-handle results, fixed `forkSession`, and `checkout`. `prism init` scaffolds a tiny TypeScript project with one selected provider and an offline mock test.
- [Workflows](workflows.md): optional `@arnilo/prism-workflows` typed bounded DAG orchestration — explicit recursive definition revisions, exact-owner cancellation/active identity, finite hard limits, durable human suspend/resume, schedules/background execution, nested workflows, replay, coordination, events, and optional RPC/Web bindings. Interactive TUI (C-012) deferred.
- [Workflow orchestration primitives](workflow-orchestration-primitives.md): architecture inventory — workflow adapters consume core `CheckpointStore`, `LeaseStore`, and bounded `EventMultiplexer`; run control and optional RPC commands stay package-local.
- [Workflow/TUI scope](workflow-tui-primitives.md): records why 0.0.5 ships workflow APIs/RPC control but no interactive terminal UI.

## Security and credentials
- [Host security guide](host-security.md): fail-closed checklist for bounded encrypted vault/KDF/keychain, JSON Schema/vector/cryptographic-ID, MCP discovery/result/transport operations, settings, redaction, trust roots, remote media, exact workflow ownership/revision checks, finite coding I/O and spill ownership, permission/approval policies, persistence, extension loading, and tool validation.
- [Security/auth/trust](settings-auth-trust-security.md): settings providers, credential helpers, trust/permission policies, redaction controls, host-owned settings/credentials wiring outside `AgentConfig`, and security-boundary hardening summary.
- [Credentials and redaction](credentials-and-redaction.md): compose explicit credential resolver order, use caller-supplied env objects/OAuth refresh helpers, resolve credentials only at the provider edge, and redact known secret values.
- [Credential storage](credential-storage.md): optional `@arnilo/prism-credentials-node` adapter with strict bounded AES-GCM envelopes, async finite scrypt, restrictive Unix files, and abort-aware bounded system-keychain calls.

## Testing and examples
- Provider test doubles: `createMockProvider()` and provider event helpers are documented on the canonical Provider layer page above.
- [Provider conformance](provider-conformance.md): run network-free provider adapter assertions (stream order, abort, tool-call reconstruction, cache usage, content coverage, protected header ownership, secret leak) from `@arnilo/prism/testing/provider-conformance`.
- [Session store conformance](session-store-conformance.md): assert any `SessionStore` adapter satisfies append/idempotency/conflict/branch invariants from `@arnilo/prism/testing/session-store-conformance`.
- [Run ledger conformance](run-ledger-conformance.md): assert durable run/event/tool/usage writes and reopen survival. Run-feedback stores use `@arnilo/prism/testing/feedback` for append/query/delete/ownership linkage conformance.
- [Compaction conformance](compaction-conformance.md): assert any `CompactionStrategy` returns a non-empty redacted summary and observes abort from `@arnilo/prism/testing/compaction-conformance`.
- [Tool conformance](tool-conformance.md): assert the tool-dispatch blocked-reason matrix (unknown/denied/invalid/permission/validator) and success path from `@arnilo/prism/testing/tool-conformance`.
- [Extension conformance](extension-conformance.md): assert an `Extension` setup runs, contributions stay inert, and setup errors are redacted or rethrown from `@arnilo/prism/testing/extension-conformance`.
- `examples/`: compile-checked typed examples and runnable mock demos (SDK basics, provider registration, auth, tools, cache-aware prompt assembly, NeuralWatt agent run, stores/branching, compaction, observational-memory recall, structured-output/artifact-loop, CLI, RPC, workflow orchestration).

## Release and install
- [Release and install](release-and-install.md): 30-package graph and profiles, install/tarball rules, deterministic resumable provenance publication, and offline test budget.
- [Review coverage (2026-07-17 provider validation)](review-coverage-2026-07-17-provider-validation.md): Plan 067 evidence freeze — P0–P2 re-verification owners, seven first-party provider packages mapped to official-doc URLs, Pi secondary refs, cache/thinking/discovery surfaces, credential canaries, and use-case model-binding inventory.
- [Review coverage (2026-07-15)](review-coverage-2026-07-15.md): frozen 0.0.5 finding/feature ownership, existing-primitive inventory, package decisions, threat boundaries, exclusions, and measured Phase 0 baseline.
- [Review coverage (2026-07-14)](review-coverage-2026-07-14.md): traceability matrix linking review findings and bug-report fixes to plan tasks, tests, and documentation for release 0.0.4.

