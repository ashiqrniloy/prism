# Prism Docs

Prism is a TypeScript/Node.js agent harness. Hosts own providers, tools, credentials, storage, and behavior; Prism supplies contracts, registries, events, and replaceable runtime primitives.

## Current line (0.5.6)

- **Trusted extension activation**: `activateKernel(kernel)` returns ready-to-spread `AgentConfig` contributions; CLI loads allow-listed `--extension` packages (plan 069).
- **Wiki ingest**: `/wiki-ingest` + `ingestWikiSource` stage text/file/image/PDF (and URLs via a host `fetchUrl` hook) into `raw/ingest/` with an OKF filing brief (plan 069).
- **Graft graph commands**: `/graft-init`, `/graft-build`, `/graft-build-deep` (host-configured `deepModel`, key env-only) (plan 069).
- **Run limits**: HARD caps are request/response bytes only; policy axes accept `null` (plan 067).
- **Tool-result fold**: content-only `ToolResult`s fold into `tool_result.result` (0.5.3).
- **Stream token coalesce**: adjacent text/thinking deltas merge on persist (0.5.2).
- **Provider request construction**: kernel session/cache/thinking defaults; hosts overlay (0.5.1).
- **10 publishable packages** at current **0.5.6** lockstep — inventory below.

## Public contracts

- [Public contracts](public-contracts.md): canonical message, agent, tool, store, resource, credential, and event shapes.
- [Coding tools, sandboxing, and personas](coding-tools.md): `@arnilo/prism-coding-tools` family subpaths — agent, security, document-reader, openapi, computer-use-linux, dev, personas.
- [Core runtime, sessions, and governance](core.md): `@arnilo/prism-core` family subpaths — runtime, sessions, governance, credentials, enterprise, work, validation.

## Identity and governance

- [Agent identity](agent-identity.md): host-verified `Principal`/`AgentIdentity`, delegation narrowing, redacted telemetry refs, optional OIDC verifier.
- [Policy and audit](policy-and-audit.md): allow/deny/modify/approval decision ledger, multi-party approvals, OPA evaluator — evidence refs only.
- [Signed, hash-chained audit export](audit-export.md): tenant-scoped signed, hash-chained audit batches with independent verification; no key storage.
- [Model routing](model-routing.md): allow-list/residency/budget/rate/circuit/fallback governance with atomic budget reservation.

## Agent/session runtime

- [Agent/session runtime](agent-session-runtime.md): create agents/sessions, `run`/`prompt`/`steer`/`stream`, durable resume, batch approvals.
- [Agent definitions](agent-definitions.md): declarative `AgentDefinition` resolution and `AGENT.md` bundle discovery, fail-closed activation.
- [Agent loops](agent-loops.md): replaceable loops with `limits.maxToolRounds` budgets and durable revision/restore hooks.
- [Guardrails](guardrails.md): typed fail-closed input/output/tool checks with redacted decision records.
- [Agent events](agent-events.md): `turn_started`/`tool_call_delta` stream plus durable page/resume sources for reconnect.
- [Observability](observability.md): OTel GenAI span hierarchy, RAG span tree, bounded trace linkage, exporter isolation.
- [Operations runbook](operations.md): high-availability fencing model, failover drill, replay rules; never unlock leases manually.
- [Disaster recovery and backup operations](disaster-recovery.md): backup/restore/PITR/DR-drill runbook with guarded commands and RPO/RTO.
- [Data classification and field-level redaction](data-classification.md): `applyFieldPolicy` allow/redact/tokenize/deny walks with fail-closed protected default.
- [Evaluations](evaluations.md): deterministic bounded trace/model-judge/pairwise scoring with CI thresholds and trace linkage.
- [Runs and usage ledger](runs-and-usage.md): durable run/event/usage persistence, host-raisable `RunLimits`, `CostCatalog` pricing.
- [Performance limits](performance.md): frozen 0.1.0 capacity envelopes and network-free benchmark evidence — the performance contract.
- [Structured output](structured-output.md): `Artifact*` seam plus provider-native `StructuredOutputOptions` for capable models.

## Compaction/session memory

- [Compaction and retry policies](compaction-and-retry.md): host-replaceable summarize/retry policies with deprecated-option removals fail closed.
- [LLM compaction subpath](compaction-llm.md): provider-backed summarization with finite `model.parameters.maxTokens` and coding handoff strategy.
- [Observational memory compaction subpath](compaction-observational-memory.md): observations/reflections with `appendEntry`, exact-id recall, nested-only settings.
- [Working and semantic memory](working-and-semantic-memory.md): working-memory store, semantic recall, pgvector path, consent lifecycle.
- [Session stores](session-stores.md): `SessionStore` contract, append options, branches, bounded search — start here for persistence.
- [Conversations](conversations.md): durable user-scoped threads with versioned metadata and legal-hold-aware deletion.
- [Work artifacts and review](work-artifacts-and-review.md): artifact attach, revision compare, approve/reject, expiring delivery links.
- [Session stores and branching](session-stores-and-branching.md): branch-semantics helper reference (compatibility stub for session-stores.md).
- [Database persistence](database-persistence.md): production persistence contracts, migrations, retention, and adapter conformance harnesses.
- [SQLite persistence](sqlite-persistence.md): optional `better-sqlite3` adapter with FTS search and verified migrations.
- [PostgreSQL persistence](postgres-persistence.md): optional pooled `pg` adapter with advisory-locked migrations and live conformance.
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable governance/router/ERP state, outbox/inbox messaging, approval records.
- [Migration guide](migration.md): current 0.5.x migration cuts with replacement tables and rollback notes.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL adapter, single-process, no cross-process safety.

## Provider and model connection

- [Embeddings](embeddings.md): provider-neutral batch `embedMany` contract with OpenAI-compatible and DashScope adapters.
- [Speech and transcription](speech.md): provider-neutral synthesis and transcription contracts with streaming variants.
- [Image generation and editing](image-generation.md): provider-neutral generate/edit contract with OpenAI and DashScope adapters.
- [Moderation](moderation.md): provider-neutral classification under a neutral vocabulary; scores are provider output.
- [Batch jobs](batch-jobs.md): provider-neutral submit/status/cancel/results contract with OpenAI Files-API adapter.
- [Provider primitives](provider-primitives.md): shared bounded transport and OpenAI serialization helpers across providers.
- [Provider layer](provider-layer.md): register host-owned providers/models, duplicate policy, streaming, mock provider.
- [Model registry](model-registry.md): register `ModelConfig` records with capabilities, limits, cost, cache metadata.
- [Provider caching](provider-caching.md): `PromptCacheHints`, stable-prefix guidance, per-provider cache matrix, cache telemetry.
- [Thinking and reasoning](thinking-and-reasoning.md): `thinkingLevel` snapping to per-model capability families with legality evidence.
- [Use-case model selection](use-case-model-selection.md): bind models for compaction, memory, and other non-session LLM jobs.
- [Provider request policies](provider-request-policies.md): kernel request-option defaults with host `ProviderRequestPolicy` overlays.
- [Provider packages](provider-packages.md): all adapters as `@arnilo/prism-providers/<adapter>` subpaths; tool_result and event wire shapes stay provider-neutral.
  - First-party adapters: [`openai`](providers/openai.md), [`anthropic`](providers/anthropic.md), [`google`](providers/google.md), [`opencode-go`](providers/opencode-go.md), [`openrouter`](providers/openrouter.md), [`zai`](providers/zai.md), [`deepseek`](providers/deepseek.md), [`xai`](providers/xai.md), [`clinepass`](providers/clinepass.md), [`hyper`](providers/hyper.md), [`commandcode`](providers/commandcode.md), [`kimi`](providers/kimi.md), [`alibaba`](providers/alibaba.md), [`ollama`](providers/ollama.md), [`neuralwatt`](providers/neuralwatt.md), plus the cross-vendor `model-discovery` listing adapters on the same page.
  - Enterprise cloud (workload identity): [`azure`](providers/azure.md) (Entra/Foundry), [`bedrock`](providers/bedrock.md) (IAM/SigV4), [`vertex`](providers/vertex.md) (ADC/Vertex).
  - Optional AI SDK adapter: [`ai-sdk`](providers/ai-sdk.md) maps host-owned pinned `LanguageModelV4` models onto Prism streams.
- [OpenAI-compatible provider](providers/openai-compatible.md): base Chat Completions subpath with strict-completion default and vendor hooks.

## Input, prompt, and context assembly

- [SDK customization guide](customization.md): map every replaceable seam — providers, middleware, loops, stores — to explicit host wiring.
- [Input and prompt assembly](input-and-prompt-assembly.md): input-to-message builders, cache-aware ordering, optional context-budget eviction.
- [Multimodal content](multimodal-content.md): media resolution, SSRF/MIME policy, capability tags, video generation contract.
- [System prompts](system-prompts.md): layered system prompts plus trust-gated `AGENTS.md`/`SYSTEM.md` file auto-load.
- [Versioned prompt registry](prompt-registry.md): immutable content-hashed prompt assets with durable stores and bounded diff.
- [Instruction injection](instruction-injection.md): package injectors layer redacted instructions without granting capabilities.
- [Context and skills](context-and-skills.md): ordered context providers, progressive skill disclosure, fail-closed activation.
- [LLM Wiki](wiki.md): optional knowledge compiler emitting OKF bundles, with `/wiki-ingest` raw staging (text, file, image, or URL via a host `fetchUrl` hook) and on-device hybrid search.
- [Retrieval-augmented generation](rag.md): bounded source lifecycle, hybrid retrieval, reranking, citations, inert injection.

## Tools

- [Recoverable tool effects](tool-effects.md): effect declarations, claim/CAS store, unknown reconciliation classifications.
- [Tools](tools.md): host-owned tool registration, allow/deny filtering, bounded artifact-loop dispatch, progressive loading.
- [OpenAPI tools adapter](openapi-tools.md): compile allow-listed OpenAPI 3.1 operations into bounded, approval-gated tools.
- [Tool execution primitives](tool-execution-primitives.md): bounded JSON Schema validation, parallel dispatch, MCP bridge mapping.
- [Tool validator JSON Schema package](../packages/prism-core/README.md): optional `@arnilo/prism-core/validation/json-schema` adapter.
- [MCP client bridge and server exposure](mcp-tools.md): SDK v2 bridge and serving with OAuth transports and DNS-pinned transport.
- [Web search, fetch, and extraction](web-tools.md): Brave/Exa/Firecrawl tools with finite limits and untrusted-content boundaries.
- [Work tools](work-tools.md): identity-scoped M365/GWS connectors — draft-then-approve, isolated subprocess environments.
- [Work connectors](work-connectors.md): connector principles, capability gates, scoped OAuth establishment, out-of-scope boundaries.
- [Browser automation](browser-automation.md): Playwright-backed browser tools with egress policy, caps, and verified checkpoints.
- [Device adapters](device-adapters.md): deny-by-default realtime voice/desktop-control contract with consent and sandbox gating.
- [Linux desktop control](computer-use-linux.md): optional `computer-use-linux` MCP wrapper — doctor-first, approval-gated mutators.
- [Obscura browser engine](obscura.md): optional host-binary browser engine adapter with fail-closed lifecycle and CDP composition.
- [Coding agent tools](coding-agent-tools.md): shell/read/write/edit/search toolset with caps, document reader, and optional Git awareness.
- [Document reader](document-reader.md): bounded PDF/DOCX text extraction behind `createReadTool({ documentReader })`.
- [Indexed code search](indexed-code-search.md): host-owned incremental index seam; results labeled `untrusted_index`.
- [Coding workspaces](coding-workspaces.md): worktree lifecycle with CheckpointStore CAS records and LeaseStore fencing.
- [Coding review and diagnostics](coding-review-and-diagnostics.md): bounded patch-review manifests and normalized LSP diagnostics.
- [Language intelligence](language-intelligence.md): bounded LSP client with lazy spawn, URI confinement, policy-gated rename.
- [Process sessions](process-sessions.md): long-running process registry with durable recovery and fail-closed ownership.
- [Forge integration](forge-integration.md): reference GitHub adapter — every mutation policy-gated and effect-recorded.
- [Coding execution approval and sandboxing](coding-security.md): path/command approval, workspace modes, Docker/native sandboxes, egress allow-listing.

## Documents, sheets, and diagrams

- [Documents, spreadsheets, and presentations](documents.md): OOXML generation, parsing, patching, and bounded preview for Office formats.
- [Spreadsheets and CSV data](sheets.md): fail-closed XLSX/CSV ingestion with decimal-safety guarantees.
- [Diagrams and mxGraph embed](diagrams.md): origin-enforced draw.io embed client with XXE-safe XML validation.

## Extensions/plugins

- [Contribution discovery (workspace)](contribution-discovery.md): realpath-contained `SKILL.md`/manifest scanner producing inert envelopes.
- [Contribution registries](contribution-registries.md): explicit host-owned registries with strict duplicate shadowing prevention.
- [Extension kernel and event bus](extensions.md): ordered extension loading, registration, lifecycle events, error isolation.
- [Extension authoring guide](extension-authoring.md): publish third-party extensions with host-owned activation and trust boundaries.
- [Middleware hooks](middleware-hooks.md): ordered hooks for provider, input, tool, retry, compaction, and session boundaries.

## Configuration/manifests

- [Configuration and manifests](configuration-and-manifests.md): layered JSON config merge with data-only manifest validation.
- [Node filesystem config loader](node-filesystem-config.md): explicitly read caller-named JSON config files in Node.
- [Resource loading](resource-loading.md): decode text/JSON/binary through caller-provided loaders; RAG bridge.

## Server/API

- [Web-standard server handler](server.md): framework-free authorized agent/SSE handler with durable reconnect and webhook seams.

## Multi-agent and interoperability

- [Multi-agent patterns (handoff/crew/supervisor/A2A)](multi-agent-patterns.md): decision table for handoff, crew, supervisor, and A2A.
- [Supervisor delegation](supervisors.md): child allow-lists, narrowed permissions, finite budgets, nested delegation.
- [A2A interoperability](a2a.md): A2A 1.0 cards, durable task seams, verified client, AG-UI fronting.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): AG-UI event mapping, A2UI middleware, hardened MCP/A2A adapters, ACP sibling.
- [ACP coding-host interop](acp.md): stable ACP v1 agent with capability advertisement, approvals, durability, and projections.
- [Spawnable ACP agent](acp-agent.md): stdio bin serving `createPrismAcpAgent` from a validated config file.
- [AG-UI adoption evaluation](ag-ui-adoption.md): official AG-UI matrix and shipped handshake boundaries.

## CLI/RPC

- [Dev inspector](dev-inspector.md): loopback-only local playground over a configured agent; `prism dev` composition.
- [CLI/RPC](cli-rpc.md): print/json modes, LF-delimited RPC, `prism init` scaffold, provider scaffolding, allow-listed `--extension` activation.
- [Workflows](workflows.md): typed bounded DAG orchestration with durable suspend/resume, schedules, sagas.

## Security and credentials

- [Host security guide](host-security.md): fail-closed checklist across supply chain, boundaries, redaction, trust, persistence.
- [Security/auth/trust](settings-auth-trust-security.md): settings providers, trust/permission policies, host-owned wiring.
- [Credentials and redaction](credentials-and-redaction.md): resolver order, env/OAuth helpers, provider-edge resolution, secret redaction.
- [Credential storage](credential-storage.md): bounded AES-GCM adapter, system keychain, host-KMS wrap, work/OIDC subpaths.

## Testing and examples

- [Live and end-to-end testing](live-testing.md): opt-in live matrix with skip-not-fail contract and credential scoping table.
- Provider test doubles: `createMockProvider()` and provider event helpers are documented on the canonical Provider layer page above.
- [Provider conformance](provider-conformance.md): network-free adapter assertions from `@arnilo/prism/testing/provider-conformance`.
- [Session store conformance](session-store-conformance.md): assert append/idempotency/conflict/branch invariants for any store.
- [Run ledger conformance](run-ledger-conformance.md): assert durable run/usage writes and reopen survival.
- [Compaction conformance](compaction-conformance.md): assert redacted non-empty summaries and abort observation.
- [Tool conformance](tool-conformance.md): assert blocked-reason matrix and success-path dispatch behavior.
- [Extension conformance](extension-conformance.md): assert inert contributions and redacted setup errors.
- `examples/`: compile-checked typed examples ([`conversation-durable-replay.ts`](../examples/conversation-durable-replay.ts), [`artifact-review-delivery.ts`](../examples/artifact-review-delivery.ts), [`enterprise-identity.ts`](../examples/enterprise-identity.ts), [`enterprise-policy-audit.ts`](../examples/enterprise-policy-audit.ts), [`enterprise-work-connectors.ts`](../examples/enterprise-work-connectors.ts), [`server-deployment-seams.ts`](../examples/server-deployment-seams.ts), [`neuralwatt-agent-run.ts`](../examples/neuralwatt-agent-run.ts), [`cache-aware-prompt-assembly.ts`](../examples/cache-aware-prompt-assembly.ts), [`ag-ui-server.ts`](../examples/ag-ui-server.ts), [`acp-coding-host.ts`](../examples/acp-coding-host.ts), and more), plus runnable mock demos.

## Third-party integrations

- [Caveman behavior integration](caveman.md): upstream Caveman skills with injector, persistence, and progressive catalog.
- [Ponytail behavior integration](ponytail.md): upstream Ponytail skills with injector and peer resolution; opt-in.
- [Graft context-graph integration](graft.md): graft CLI pull tools, retrieval-pack context provider, blast-radius middleware, and `/graft-init` / `/graft-build` / `/graft-build-deep` commands (host-configured `deepModel`).
- [Impeccable behavior integration](impeccable.md): upstream Impeccable skill behind `load_skill`; host supplies the compiled `SKILL.md`.

## Release and install

- [Release and install](release-and-install.md): install rules, package graph, and deterministic resumable publication.
- [Migrate 0.5](migrate-to-0.5.md): 0.4 → 0.5 migration guide with per-release sections and rollback.
- [Documentation archive](history/README.md): frozen migration/history records — not read on the hot path.
- [Review coverage archive](_evidence/): per-phase evidence freezes — audit trail, excluded from tarballs.

## Package inventory

The generated inventory below derives from [`scripts/package-truth.json`](../scripts/package-truth.json) — regenerate with `node scripts/package-truth.mjs --emit-docs`, never hand-edit.

<!-- generated:package-truth:inventory begin -->
**10 publishable manifests** — root `@arnilo/prism` plus 9 workspace packages (3 `prism-*` family packages, 6 capability packages). Generated by `node scripts/package-truth.mjs --emit-docs` — do not hand-edit.

| package | version | notes |
| --- | --- | --- |
| `@arnilo/prism` | 0.5.6 | core — runtime, CLI/RPC, templates, docs |
| `@arnilo/prism-coding-tools` | 0.5.6 | family — /agent, /security, /document-reader, /openapi, /computer-use-linux, /dev, /caveman, /ponytail, /impeccable subpaths |
| `@arnilo/prism-core` | 0.5.6 | family — /runtime, /sessions, /governance, /credentials, /enterprise, /work, /validation subpaths |
| `@arnilo/prism-providers` | 0.5.6 | family — all provider adapters as `/<adapter>` subpaths |
| `@arnilo/prism-acp-agent` | 0.5.6 | capability — ACP adapter |
| `@arnilo/prism-ag-ui` | 0.5.6 | capability — AG-UI/A2A/A2UI adapter |
| `@arnilo/prism-mcp` | 0.5.6 | capability — MCP client/server/OAuth interop |
| `@arnilo/prism-memory` | 0.5.6 | capability — memory plus /rag, /compaction/*, /graft, /wiki subpaths |
| `@arnilo/prism-office` | 0.5.6 | capability — /documents, /sheets, /diagrams subpaths |
| `@arnilo/prism-web-tools` | 0.5.6 | capability — Brave/Exa/Firecrawl plus peer-gated /browser and /obscura subpaths |
<!-- generated:package-truth:inventory end -->
