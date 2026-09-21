# Prism Docs

Prism is a TypeScript/Node.js agent harness. Hosts own providers, tools, credentials, storage, and behavior; Prism supplies contracts, registries, events, and replaceable runtime primitives.

## Current line (0.10.0)

- **Attention budget axes**: `attentionCompiler.trigger` accepts one axis, a predicate, or an any-of array (`input_ratio`, `run_input_ratio`, `token_floor`), and `durable: true` keeps the fold ledger and sticky frontier in the checkpoint across a resume.
- **Turn traces and exhaustion attribution**: `provider_turn_finished` carries a closed `stopReason`, a `budgets` snapshot, the effective tool menu (`count` / `idsHash`), and provider cache counts; `agent_finished` carries the run outcome, and the execution timeline adds per-turn stop reasons plus `exhaustion`.
- **Cache-stable disclosure**: late-expanding context (skill bodies, deferred schemas, loaded references) lands at the request tail instead of rewriting the prefix, cache read/write telemetry rides usage records, and `runPrefixStabilityConformance` asserts a shared-prefix floor against a host's own assembly.
- **Per-turn tool narrowing**: a host callback receives the turn and the run grant and returns the effective subset; out-of-grant names are dropped and reported as `tool_narrowing_clamped`.
- **Usage estimation and the context meter**: labeled token estimates for providers that report no usage (reported usage always wins, and `usageEstimation: "off"` restores zero-for-no-usage), plus `session.contextMeter()` for cap and spend ratios.
- **Guardrail packs**: four built-in restrictive packs (`coding-standard`, `destructive-commands`, `validation-respect`, `secrets-hygiene`) compiled onto existing tool stages, each with a trajectory scorer.
- **Background child agents**: session-lifetime children with milestone or streamed reports, narrowed budget shares, and rate-coalesced child events.
- **Checkpoint sidecar metadata**: a redacted ≤4 KiB map attached to every checkpoint record without charging `maxStateBytes`, plus restore hooks that revert external layers before a resume claims the run.
- **Bounded session search**: `store.searchSessions(query)` over workspace/time/provider/label/kind/ownership filters, indexed at append time (SQLite FTS5, Postgres `tsvector`) with a bounded linear matcher for JSONL and memory stores.
- **Deterministic turns**: the `beforeProviderTurn` middleware hook answers a turn from host data with no provider request, recorded as `deterministic` on the timeline and in usage.
- **Shared work scopes**: explicitly granted observational-memory scopes shared across sessions, deny-by-default, audited, and revocable at the next read; session-private scopes stay the default.
- **Retrieval revocation and local reranking**: deletion and revocation propagate through derived vector/wiki artifacts under bounded walks, and an in-process cross-encoder reranker ships with no declared inference dependency.
- **Live-stream terminal semantics**: one `isTerminalAgentEventType` predicate (`agent_finished` / `agent_denied` / `error`) shared by every source, so a limit death delivers `run_limit_exceeded` → `budget_exhausted` → `error` before a stream or replay ends.
- **12 publishable packages** at current **0.10.0** lockstep, with the migration guide reachable from the release section below — inventory below.

### Carried from the 0.8.0 line

- **Messaging channels**: `@arnilo/prism-channels` transport-neutral runtime with deny-by-default authorization, owned bindings, one-use durable approvals, official Telegram (private DMs, opt-in granted groups/topics, drafts, bounded media/voice, opt-in notices) and experimental pinned signal-cli Signal.
- **Connected apps**: identity-bound MCP server sessions admit host-selected transports and register prefixed tools; Google Workspace and Microsoft 365 HTTP adapters live under `@arnilo/prism-work/connectors`.
- **Work family**: `@arnilo/prism-work` replaces `@arnilo/prism-office` — connectors, documents, sheets, diagrams, document-reader, sandbox, and vendored office skills. No pre-1.0 shim.
- **Durable long runs**: turn-boundary checkpoints with host-only `decision: "continue"`, turn-stop policy, frozen run-bundle snapshots, claim-grounding guardrail, and typed provider failure classes.
- **Honesty surfaces**: Postgres release evidence is this-commit, channel lease release stays held until the store acknowledges, and observational-memory workers ignore non-tool events on purpose.

### Carried from the 0.7.0 line

- **Traps closed**: ACP MCP destination matching uses WHATWG origin plus path-segment subtree rules, the ACP launcher requires a real provider (mock mode is explicit), and the model-router facade refuses governance it cannot enforce (`ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` / `_ASYNC_STATE`).
- **Governed host surfaces**: validated personal/business compositions, governed provider invocation with aggregate task/tenant accounting, durable business-action drafts with editable approvals, Docker process sessions and coherent workspace recovery, Drive knowledge synchronization, snapshot/reconnect with one hosted sandbox, fair worker admission, cross-layer memory lineage with correction/revocation, evidence-backed citations with import-fidelity/OCR reports, and monotonic per-run tool narrowing.
- **Evidence cockpit**: execution timeline, workflow graph, trajectory/outcome evals (scenarios, trials, manifests), cockpit aggregations, and workflow OpenTelemetry spans — with the cross-package journey matrix behind them.
- **Attention Compiler**: opt-in per-turn gate that mutates the transcript only after a ratio of the model input cap, with sticky thinking/tool stubs and a host-programmable compaction trigger.
- **Memory Fabric**: opt-in typed notes (fact/procedure/file/working/episode) with links, validity windows, and time/tool recall over the working, semantic, and observational-memory engines.
- **Work-scope memory index**: host-named work scopes (`open`/`bind`/`project`/`enter`) project the observational outline; unscoped attach keeps the 0.6.0 dropper.
- **Host-owned subagent spawn**: `spawn_agent` over the host supervisor (allow-listed children, narrowed identity, redacted results), bounded async spawn with `wait_agent`/`cancel_agent`, opt-in per-child worktree isolation, and redacted `subagent_started`/`subagent_stopped` lifecycle events.
- **Native Bedrock Converse and governed realtime voice**: `createBedrockConverseProvider` adds a native `Converse`/`ConverseStream` route next to the OpenAI-compatible one, with no AWS SDK dependency; realtime voice sessions stay host-governed.

### Carried from the 0.6.0 line

- **Node 22 floor**: `engines.node` is `>=22` in all eleven publishable packages, the `node20-compat` CI leg becomes `node22-compat`, and `@types/node` moves to `^22.20.0` (plan 071; Node 20 is upstream EOL since 2026-04-30).
- **Folded 0.5.7 content**: the 0.5.7 cut was never published — its durable-tool-round and strict-tool-result fixes, host knobs, peer/options truth, and dependency floors ship in 0.6.0 (migration guide below).
- **Release-truth gates**: one forward-claim version-literal gate (manifests, internal ranges, lockfile, version constant, index banner, workflow tags), a workflow-liveness gate (every script target and action reference resolves, actions SHA-pinned), and a load-tolerant startup budget ratio (plan 071).
- **Self-describing coverage failures**: a failing coverage child prints its redacted output tail and records `status`/`exitCode`/`tail` on its artifact row (plan 071).
- **Durable tool rounds**: concurrent tool dispatch persists successful sibling results — plus synthetic errors for failed and never-dispatched calls — before a round fails or aborts, so no `tool_use` is left unanswered (plan 070).
- **Strict-provider tool results**: a content-less `ToolResult` folds to the non-empty `(tool completed with no output)` payload instead of an empty one (plan 070).
- **Host-tunable knobs**: context-budget `tokenEstimator`, `snapshotCacheTtlMs`, memory-session search caps, `SsrfPolicy.allowedCidrs`, and browser `idleRunTtlMs` (plan 070).
- **Peer and options truth**: the optional peer-dependency matrix and the configuration options index (both linked below) cover every third-party peer and public option surface (plan 070).
- **Trusted extension activation**: `activateKernel(kernel)` returns ready-to-spread `AgentConfig` contributions; CLI loads allow-listed `--extension` packages (plan 069).
- **Wiki ingest**: `/wiki-ingest` + `ingestWikiSource` stage text/file/image/PDF (and URLs via a host `fetchUrl` hook) into `raw/ingest/` with an OKF filing brief (plan 069).
- **Run limits**: HARD caps are request/response bytes only; policy axes accept `null` (plan 067).
- **Tool-result fold**: content-only `ToolResult`s fold into `tool_result.result` (0.5.3).
- **Stream token coalesce**: adjacent text/thinking deltas merge on persist (0.5.2).
- **Provider request construction**: kernel session/cache/thinking defaults; hosts overlay (0.5.1).

## Public contracts

- [Public contracts](public-contracts.md): canonical message, agent, tool, store, resource, credential, and event shapes.
- [Coding tools, sandboxing, and personas](coding-tools.md): `@arnilo/prism-coding-tools` family subpaths — agent, security, openapi, computer-use-linux, dev, personas.
- [Core runtime, sessions, and governance](core.md): `@arnilo/prism-core` family subpaths — runtime, sessions, governance, credentials, enterprise, validation.
- [Configuration options index](options-index.md): every public `*Options`/`*Limits`/`*Config` surface mapped to the doc page that owns its fields.

## Identity and governance

- [Agent identity](agent-identity.md): host-verified `Principal`/`AgentIdentity`, delegation narrowing, redacted telemetry refs, optional OIDC verifier.
- [Policy and audit](policy-and-audit.md): allow/deny/modify/approval decision ledger, multi-party approvals, OPA evaluator — evidence refs only.
- [Signed, hash-chained audit export](audit-export.md): tenant-scoped signed, hash-chained audit batches with independent verification; no key storage.
- [Model routing](model-routing.md): allow-list/residency/budget/rate/circuit/fallback governance with atomic budget reservation, aggregate task/tenant accounting across all paid work, and fail-closed synchronous invocation boundaries.

## Agent/session runtime

- [Agent/session runtime](agent-session-runtime.md): create agents/sessions, `run`/`prompt`/`steer`/`stream`, durable resume, batch approvals, per-run `toolNames` narrowing.
- [Durable runs](durable-runs.md): turn-boundary `checkpointPolicy: "every-turn"` checkpoints and `decision: "continue"` crash recovery for long runs.
- [Agent definitions](agent-definitions.md): declarative `AgentDefinition` resolution and `AGENT.md` bundle discovery, fail-closed activation.
- [Agent loops](agent-loops.md): replaceable loops with `limits.maxToolRounds` budgets and durable revision/restore hooks.
- [Hooks](hooks.md): the hook model — stop hooks with bounded continuation, session/compaction boundary seams, and the Claude Code / Codex event map plus the `hooks.json` adapter.
- [Guardrails](guardrails.md): typed fail-closed input/output/tool checks with redacted decision records.
- [Agent events](agent-events.md): `turn_started`/`tool_call_delta` stream plus durable page/resume sources for reconnect.
- [Observability](observability.md): OTel GenAI span hierarchy, workflow spans, cockpit aggregations, RAG span tree, bounded trace linkage, exporter isolation.
- [Execution timeline](execution-timeline.md): execution timeline projection and cockpit summaries for host dashboards and trajectory evals.
- [Operations runbook](operations.md): high-availability fencing, fair worker admission, operator queue/cancel/reconcile; never unlock leases manually.
- [Disaster recovery and backup operations](disaster-recovery.md): backup/restore/PITR/DR-drill runbook with guarded commands and RPO/RTO.
- [Data classification and field-level redaction](data-classification.md): `applyFieldPolicy` allow/redact/tokenize/deny walks with fail-closed protected default.
- [Evaluations](evaluations.md): trajectory/outcome scorers over execution timelines, citation-integrity invariant, workflow experiments, scenarios, repeated trials that re-run items with sample standard error, failure injection, two-field and release manifests, deterministic bounded trace/model-judge scoring.
- [Runs and usage ledger](runs-and-usage.md): durable run/event/usage persistence, aggregate task accounting across paid work, host-raisable `RunLimits`, `CostCatalog` pricing.
- [Performance limits](performance.md): frozen 0.1.0 capacity envelopes and network-free benchmark evidence — the performance contract.
- [Structured output](structured-output.md): `Artifact*` seam plus provider-native `StructuredOutputOptions` for capable models.

## Compaction/session memory

- [Compaction and retry policies](compaction-and-retry.md): host-replaceable summarize/retry policies with deprecated-option removals fail closed.
- [LLM compaction subpath](compaction-llm.md): provider-backed summarization with finite `model.parameters.maxTokens` and coding handoff strategy.
- [Observational memory compaction subpath](compaction-observational-memory.md): source-backed observations/reflections, an optional work-scope index for the current working set, and exact-id recall; `invalidatedIds` withhold derived injection.
- [Working and semantic memory](working-and-semantic-memory.md): working-memory store, semantic recall, pgvector path, consent lifecycle, lineage invalidation, parent-child share grants.
- [Memory fabric](memory-fabric.md): opt-in typed notes (fact/procedure/file/working/episode) with validity windows over the existing vector and working stores.
- [Scoped memory](scoped-memory.md): workspace-scope guard, gated writes, promotion ladder, decay reads, audit mirror (`@arnilo/prism-memory/scoped`).
- [Scoped agent memory design concept](scoped-agent-memory.md): workspace-scoped persistent memory — gated writes, promotion ladder, decay-based reads; case study and research basis.
- [Session stores](session-stores.md): `SessionStore` contract, append options, branches, bounded search — start here for persistence.
- [Conversations](conversations.md): durable user-scoped threads with versioned metadata and legal-hold-aware deletion.
- [Work artifacts and review](work-artifacts-and-review.md): artifact attach, revision compare, evidence-bound citations, approve/reject, expiring delivery links.
- [Session stores and branching](session-stores-and-branching.md): branch-semantics helper reference (compatibility stub for session-stores.md).
- [Database persistence](database-persistence.md): production persistence contracts, migrations, retention, and adapter conformance harnesses.
- [SQLite persistence](sqlite-persistence.md): optional `better-sqlite3` adapter with FTS search and verified migrations.
- [PostgreSQL persistence](postgres-persistence.md): optional pooled `pg` adapter with advisory-locked migrations and live conformance.
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable governance/router/ERP state, outbox/inbox messaging, approval records.
- [Migration guide](migration.md): the era index of migration cuts with replacement tables and rollback notes.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL adapter, single-process, no cross-process safety.

## Provider and model connection

- [Embeddings](embeddings.md): provider-neutral batch `embedMany` contract with OpenAI-compatible and DashScope adapters.
- [Speech and transcription](speech.md): provider-neutral synthesis and transcription contracts with streaming variants.
- [Realtime voice](realtime-voice.md): governed OpenAI Realtime bridge into host tool dispatch, barge-in, reconnect, and transcript privacy.
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
  - Enterprise cloud (workload identity): [`azure`](providers/azure.md) (Entra/Foundry), [`bedrock`](providers/bedrock.md) (IAM/SigV4; OpenAI-compatible or native Converse route), [`vertex`](providers/vertex.md) (ADC/Vertex).
  - Optional AI SDK adapter: [`ai-sdk`](providers/ai-sdk.md) maps host-owned pinned `LanguageModelV4` models onto Prism streams.
- [OpenAI-compatible provider](providers/openai-compatible.md): base Chat Completions subpath with strict-completion default and vendor hooks.

## Input, prompt, and context assembly

- [SDK customization guide](customization.md): map every replaceable seam — providers, middleware, loops, stores — to explicit host wiring.
- [Input and prompt assembly](input-and-prompt-assembly.md): input-to-message builders, cache-aware ordering, optional context-budget eviction.
- [Attention compiler](attention-compiler.md): opt-in per-turn gate that mutates only after a ratio of the model input cap.
- [Multimodal content](multimodal-content.md): media resolution, SSRF/MIME policy, capability tags, video generation contract.
- [System prompts](system-prompts.md): layered system prompts plus trust-gated `AGENTS.md`/`SYSTEM.md` file auto-load.
- [Versioned prompt registry](prompt-registry.md): immutable content-hashed prompt assets with durable stores and bounded diff.
- [Instruction injection](instruction-injection.md): package injectors layer redacted instructions without granting capabilities.
- [Context and skills](context-and-skills.md): ordered context providers, progressive skill disclosure, fail-closed activation. `@arnilo/prism-work` ships `docx`, `xlsx`, `powerpoint`, `pdf`.
- [LLM Wiki](wiki.md): optional knowledge compiler emitting OKF bundles, with `/wiki-ingest` raw staging (text, file, image, or URL via a host `fetchUrl` hook) and on-device hybrid search.
- [Retrieval-augmented generation](rag.md): bounded source lifecycle, hybrid retrieval, permission-trimmed query legs, reranking, evidence-backed citations, inert injection.
- [Knowledge synchronization](knowledge-sync.md): paged enterprise-source import with a Drive connector, checkpointed change cursors, and host-owned ACL mapping.

## Tools

- [Recoverable tool effects](tool-effects.md): effect declarations, claim/CAS store, unknown reconciliation classifications.
- [Tools](tools.md): host-owned tool registration, allow/deny filtering, per-run `toolNames` narrowing, bounded artifact-loop dispatch, progressive loading.
- [OpenAPI tools adapter](openapi-tools.md): compile allow-listed OpenAPI 3.1 operations into bounded, approval-gated tools.
- [Tool execution primitives](tool-execution-primitives.md): bounded JSON Schema validation, parallel dispatch, MCP bridge mapping.
- [Tool validator JSON Schema package](../packages/prism-core/README.md): optional `@arnilo/prism-core/validation/json-schema` adapter.
- [MCP client bridge and server exposure](mcp-tools.md): SDK v2 bridge and serving with OAuth transports and DNS-pinned transport.
- [Connected apps](connected-apps.md): identity-bound MCP server sessions that admit host-selected transports and register prefixed tools.
- [Web search, fetch, and extraction](web-tools.md): Brave/Exa/Firecrawl tools with finite limits, hashed web evidence snapshots, and untrusted-content boundaries.
- [Work tools](work-tools.md): identity-scoped M365/GWS connectors — scanned file get, hash-bound uploads/copies, fixed Docs/Sheets/Slides updates, approvals, isolated subprocess environments.
- [Work connectors](work-connectors.md): connector principles, capability gates, scoped OAuth establishment, out-of-scope boundaries.
- [Work sandbox](work-sandbox.md): host-pinned document image and `createWorkComposition` — office/exec in an injected Docker sandbox, connectors stay on the host.
- [Browser automation](browser-automation.md): Playwright-backed browser tools with egress policy, caps, and verified checkpoints.
- [Device adapters](device-adapters.md): deny-by-default realtime voice/desktop-control contract with consent and sandbox gating.
- [Linux desktop control](computer-use-linux.md): optional `computer-use-linux` MCP wrapper — doctor-first, approval-gated mutators.
- [Obscura browser engine](obscura.md): optional host-binary browser engine adapter with fail-closed lifecycle and CDP composition.
- [Coding agent tools](coding-agent-tools.md): shell/read/write/edit/search toolset with caps, document reader, and optional Git awareness.
- [Document reader](document-reader.md): bounded PDF/DOCX/XLSX/PPTX text extraction behind `createReadTool({ documentReader })`; optional host-selected Mistral OCR parser (not default).
- [Indexed code search](indexed-code-search.md): host-owned incremental index seam; results labeled `untrusted_index`.
- [Coding workspaces](coding-workspaces.md): worktree lifecycle with CheckpointStore CAS records, LeaseStore fencing, and opt-in per-child spawn isolation.
- [Coding review and diagnostics](coding-review-and-diagnostics.md): bounded patch-review manifests and normalized LSP diagnostics.
- [Language intelligence](language-intelligence.md): bounded LSP client with lazy spawn, URI confinement, policy-gated rename.
- [Process sessions](process-sessions.md): long-running process registry with durable recovery, Docker/E2B container sessions, and fail-closed ownership.
- [Forge integration](forge-integration.md): reference GitHub adapter — every mutation policy-gated and effect-recorded.
- [Coding execution approval and sandboxing](coding-security.md): path/command approval, workspace modes, Docker/native/E2B sandboxes with long-running process handles, egress allow-listing.
- [Hosted sandboxes](hosted-sandboxes.md): E2B `DisposableSandbox` adapter with pause/resume, filesystem-only snapshots, and reconnect by non-secret sandbox id.

## Documents, sheets, and diagrams

- [Documents, spreadsheets, and presentations](documents.md): OOXML generation, parsing, import fidelity reports, patching, structural diffs, and bounded preview for Office formats.
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
- [Effective run bundle snapshots](run-bundle.md): frozen JSON projection of the effective run bundle — prompt/skill/tool/guardrail digests, resolved limits, storage kinds, one pinning digest, zero network or store reads.
- [Host compositions](host-compositions.md): personal and business worker host compositions, inspection reports, storage durability truth, sandbox isolation, and fail-closed readiness enforcement.
- [Node filesystem config loader](node-filesystem-config.md): explicitly read caller-named JSON config files in Node.
- [Resource loading](resource-loading.md): decode text/JSON/binary through caller-provided loaders; RAG bridge.
- [Optional peer dependencies](peer-dependencies.md): every third-party peer a package declares, the subpath it unlocks, its install line, pin rationale, and which peers touch the network.

## Server/API

- [Web-standard server handler](server.md): framework-free authorized agent/SSE handler with durable reconnect, editable approvals, and webhook seams.

## Multi-agent and interoperability

- [Multi-agent patterns (handoff/crew/supervisor/spawn/A2A)](multi-agent-patterns.md): decision table for handoff, crew, supervisor, in-process spawn, and A2A.
- [Supervisor delegation](supervisors.md): child allow-lists, model-facing sync/async spawn, wait/cancel, narrowed permissions, finite budgets, nested delegation.
- [A2A interoperability](a2a.md): A2A 1.0 cards, durable task seams, verified client, AG-UI fronting.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): AG-UI event mapping with editable durable approvals, A2UI middleware, hardened MCP/A2A adapters, ACP sibling.
- [ACP coding-host interop](acp.md): stable ACP v1 agent with capability advertisement, approvals, durability, and projections.
- [Spawnable ACP agent](acp-agent.md): stdio bin serving `createPrismAcpAgent` with lazy real providers, credential references, explicit offline mock mode, durable SQLite recovery, and origin- and path-safe MCP allow-listing.
- [AG-UI adoption evaluation](ag-ui-adoption.md): official AG-UI matrix and shipped handshake boundaries.

## CLI/RPC

- [Dev inspector](dev-inspector.md): loopback-only local playground over a configured agent; composition inspection via `GET /inspect`; quality/cost/latency compare from timeline summaries; `prism dev` composition.
- [CLI/RPC](cli-rpc.md): print/json modes, LF-delimited RPC, `prism init` scaffold (`personal-assistant`, `business-worker`, `deep-research` templates), provider scaffolding, allow-listed `--extension` activation.
- [Workflows](workflows.md): typed DAG orchestration plus serializable graph/Mermaid overlay for host UIs.

## Security and credentials

- [Host security guide](host-security.md): fail-closed checklist across supply chain, boundaries, redaction, trust, persistence.
- [Security/auth/trust](settings-auth-trust-security.md): settings providers, trust/permission policies, host-owned wiring.
- [Credentials and redaction](credentials-and-redaction.md): resolver order, env/OAuth helpers, provider-edge resolution, secret redaction.
- [Credential storage](credential-storage.md): bounded AES-GCM adapter, system keychain, host-KMS wrap, work/OIDC subpaths.

## Testing and examples

- [Test layout and isolation](testing.md): the five `npm test` stages, scratch-root rule, and the tracked-fixture isolation gate.
- [Contribution quality budgets](contributing.md): the non-null assertion allowance, export-surface ceilings, and the rule that keeps them shrinking.
- [Live and end-to-end testing](live-testing.md): opt-in live matrix with skip-not-fail contract and credential scoping table.
- Provider test doubles: `createMockProvider()` and provider event helpers are documented on the canonical Provider layer page above.
- [Provider conformance](provider-conformance.md): network-free adapter assertions from `@arnilo/prism/testing/provider-conformance`.
- [Session store conformance](session-store-conformance.md): assert append/idempotency/conflict/branch invariants for any store.
- [Run ledger conformance](run-ledger-conformance.md): assert durable run/usage writes and reopen survival.
- [Compaction conformance](compaction-conformance.md): assert redacted non-empty summaries and abort observation.
- [Prefix stability conformance](prefix-stability-conformance.md): assert progressive disclosure keeps the provider cache prefix stable.
- [Tool conformance](tool-conformance.md): assert blocked-reason matrix and success-path dispatch behavior.
- [Extension conformance](extension-conformance.md): assert inert contributions and redacted setup errors.
- `examples/`: compile-checked typed examples ([`conversation-durable-replay.ts`](../examples/conversation-durable-replay.ts), [`artifact-review-delivery.ts`](../examples/artifact-review-delivery.ts), [`enterprise-identity.ts`](../examples/enterprise-identity.ts), [`enterprise-policy-audit.ts`](../examples/enterprise-policy-audit.ts), [`enterprise-work-connectors.ts`](../examples/enterprise-work-connectors.ts), [`connected-slack-mcp.ts`](../examples/connected-slack-mcp.ts), [`server-deployment-seams.ts`](../examples/server-deployment-seams.ts), [`neuralwatt-agent-run.ts`](../examples/neuralwatt-agent-run.ts), [`cache-aware-prompt-assembly.ts`](../examples/cache-aware-prompt-assembly.ts), [`guardrail-packs.ts`](../examples/guardrail-packs.ts), [`ag-ui-server.ts`](../examples/ag-ui-server.ts), [`acp-coding-host.ts`](../examples/acp-coding-host.ts), [`telegram-agent.ts`](../examples/telegram-agent.ts), [`signal-agent.ts`](../examples/signal-agent.ts), [`messaging-agent.ts`](../examples/messaging-agent.ts), and more), plus runnable mock demos.

## Third-party integrations

- [Impeccable behavior integration](impeccable.md): upstream Impeccable skill behind `load_skill`; host supplies the compiled `SKILL.md`.
- [Messaging channels](messaging-channels.md): `@arnilo/prism-channels` transport-neutral runtime — deny-by-default sender authorization, owned session binding, serialized turns, current-run replies, one-use durable approvals, bounded attachment refs (images reach the model only when it declares image input), and opt-in host notices to one already-bound pair.
- [Telegram channel](telegram-channel.md): official `@arnilo/prism-channels/telegram` long polling and mountable webhook ingress with durable offset/lease handling, approval callbacks, opt-in granted group/topic text, bounded media with optional voice transcription/synthesis, and opt-in streaming drafts.
- [Signal channel (experimental)](signal-channel.md): `@arnilo/prism-channels/signal` pinned signal-cli v0.14.8 private-socket manual receive, explicit policy gate, UUID DM filtering and bounded ambiguous delivery.
- [Messaging channel operations](messaging-channel-operations.md): durable journal, restart and reconciliation contract, lease fencing, retention and the operator runbook.

## Release and install

- [Release and install](release-and-install.md): install rules, package graph, and deterministic resumable publication.
- [Migrate 0.8 → 0.9](migrate-to-0.9.md): the four behavior deltas inside existing surfaces (limit-death stream order, turn-trace metadata, cache-stable disclosure, labeled usage estimates), every new option with its sizing line, and 0.9.0 host migration steps.
- [Migrate 0.7 → 0.8](migrate-to-0.8.md): work-family import map, messaging channels, connected apps, durable runs, and 0.8.0 host migration steps.
- [Migrate 0.6 → 0.7](migrate-to-0.7.md): ACP MCP allow-list URL normalization, model router facade fail-closed governance, and 0.7.0 host migration steps.
- [Migrate 0.5 → 0.6](migrate-to-0.6.md): Node 22 floor, folded 0.5.7 host delta, third-party floors, and upgrade/rollback steps.
- [Migrate 0.5](migrate-to-0.5.md): 0.4 → 0.5 migration guide with per-release sections and rollback.
- [Documentation archive](history/README.md): frozen migration/history records — not read on the hot path.
- [Review coverage archive](_evidence/): per-phase evidence freezes — audit trail, excluded from tarballs.

## Package inventory

The generated inventory below derives from [`scripts/package-truth.json`](../scripts/package-truth.json) — regenerate with `node scripts/package-truth.mjs --emit-docs`, never hand-edit.

<!-- generated:package-truth:inventory begin -->
**12 publishable manifests** — root `@arnilo/prism` plus 11 workspace packages (4 `prism-*` family packages, 7 capability packages). Generated by `node scripts/package-truth.mjs --emit-docs` — do not hand-edit.

| package | version | notes |
| --- | --- | --- |
| `@arnilo/prism` | 0.10.0 | core — runtime, CLI/RPC, templates, docs |
| `@arnilo/prism-channels` | 0.10.0 | family — transport-neutral messaging runtime, durable journal, pairing and one-use approvals; official /telegram (private DMs, opt-in granted groups/topics) and experimental pinned signal-cli /signal |
| `@arnilo/prism-coding-tools` | 0.10.0 | family — /agent, /security, /openapi, /computer-use-linux, /dev, /impeccable subpaths |
| `@arnilo/prism-core` | 0.10.0 | family — /runtime, /sessions, /governance, /credentials, /enterprise, /validation subpaths |
| `@arnilo/prism-providers` | 0.10.0 | family — all provider adapters as `/<adapter>` subpaths |
| `@arnilo/prism-acp-agent` | 0.10.0 | capability — ACP adapter |
| `@arnilo/prism-ag-ui` | 0.10.0 | capability — AG-UI/A2A/A2UI adapter |
| `@arnilo/prism-hooks` | 0.10.0 | capability — Claude/Codex-compatible hooks.json adapter compiled onto middleware, guardrail, injector, and stop-hook seams |
| `@arnilo/prism-mcp` | 0.10.0 | capability — MCP client/server/OAuth interop |
| `@arnilo/prism-memory` | 0.10.0 | capability — memory plus /rag, /compaction/*, /fabric, /wiki subpaths |
| `@arnilo/prism-web-tools` | 0.10.0 | capability — Brave/Exa/Firecrawl plus peer-gated /browser and /obscura subpaths |
| `@arnilo/prism-work` | 0.10.0 | capability — /connectors, /documents, /sheets, /diagrams, /document-reader, /sandbox, /skills, /tools subpaths |
<!-- generated:package-truth:inventory end -->
