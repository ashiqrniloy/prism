# Review coverage — 2026-07-15

This page freezes Prism 0.0.5 scope at commit `f5128a816ae204c52f3e2f089de71c99bd5de6d4` after the Prism/Mastra review. It maps every confirmed finding and accepted capability to one owning roadmap phase, package/public surface, focused test owner, and documentation owner.

Status: **scope frozen; Phases 1-14 implementation complete; publication handoff pending**. Phase 0 changes no public runtime behavior.

## Release decision

- Target release is **0.0.5**. Do not publish the currently versioned but unpublished 0.0.4 package graph.
- npm currently reports `@arnilo/prism@0.0.3`; Phase 14 has retargeted every repository package and lock entry to 0.0.5. Publication remains pending the clean signed-tag workflow.
- Core remains a Node.js 20-compatible, zero-runtime-dependency harness.
- New capabilities are opt-in and package-owned. No server, database, credential store, telemetry exporter, memory worker, schedule, remote agent, or privileged tool activates on install.
- Any row below that changes a trust boundary remains a release blocker until its owning phase and regression checks pass.

## Frozen confirmed findings

Each ID appears once. “Planned” means owned, not fixed.

| ID | Confirmed finding | Disposition and single owner | Package / public surface | Focused test owner | Documentation owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | Bracket-normalization lets IPv6 loopback, link-local, ULA, and IPv4-mapped private literals bypass media SSRF checks; DNS resolution/rebinding behavior is not sufficient for a private-network denial claim. | Phase 1 | Core `src/content.ts`; `SsrfPolicy` and media fetch path | `src/__tests__/content.test.ts` with injected resolver/requester matrix | `multimodal-content.md`, `host-security.md` | completed 2026-07-15 |
| S-002 | `createReadOnlyTools()` does not apply the aggregate `executionPolicy`. | Phase 1 | `@arnilo/prism-coding-agent` read-only aggregator | coding-agent execution-policy tests | `coding-agent-tools.md` | completed 2026-07-15 |
| S-003 | Approval caching defaults to a process-lifetime map instead of `none`; `run` and `session` scopes have no identity in the cache key. | Phase 1 | `@arnilo/prism-coding-security`; approval policy and execution identity metadata | coding-security approval tests | `coding-security.md`, `host-security.md` | completed 2026-07-15 |
| C-001 | Sandbox adapter returns only an exit code and cannot forward stdout/stderr to coding-agent `onData`. | Phase 2 | coding-security sandbox adapter / coding-agent bash operations bridge | sandbox and shell integration tests | `coding-security.md`, `coding-agent-tools.md` | completed 2026-07-15 |
| C-002 | OpenTelemetry agent spans end only on `agent_finished`; provider failure can leave `prism.agent.run` active. | Phase 2 | `@arnilo/prism-observability-opentelemetry` instrumentation lifecycle | in-memory telemetry failed/aborted-run tests | `observability.md` | completed 2026-07-15 |
| C-003 | `prism.provider.tokens` is incremented for provider-turn and agent-total events, double-counting one usage source. | Phase 2 | OTel token metric names/scopes | in-memory metric assertions | `observability.md`, `runs-and-usage.md` | completed 2026-07-15 |
| C-004 | Usage rows do not distinguish provider-turn values from run totals; the loop returns the latest turn rather than an explicit aggregate. | Phase 2 | core `Usage`, `UsageRecord`, runtime accumulator, persistence adapters | multi-turn run-ledger conformance and runtime tests | `runs-and-usage.md`, persistence docs | completed 2026-07-15 |
| C-005 | Providers resolve media one block at a time, so request-wide 32-item/32-MiB bounds are not accumulated before provider/upload side effects. | Phase 2 | core media request resolver and provider media serializers | content/provider-media/provider package tests | `multimodal-content.md` | completed 2026-07-15 |
| A-001 | Workflow coordinator concurrency test was timing-sensitive under load. | Phase 0 | test only; production workflow API unchanged | `packages/workflows/src/__tests__/coordinator.test.ts` repeated five times plus full suite | this page, `performance.md` | completed at frozen HEAD `f5128a8` |
| A-002 | `AgentConfig.extensions`, `settings`, and `credentials` are accepted but explicitly ignored by agent/session runtime. | Phase 3 | core `AgentConfig` and host composition docs | compile fixtures and runtime behavior tests | `agent-session-runtime.md`, `customization.md`, `migration.md` | completed 2026-07-15 |
| A-003 | `AgentSession.run()`/`prompt()` return `Promise<void>` and integrated streaming requires a separately started subscriber. | Phase 3 | core `AgentSession`, new run-result/stream contract | agent/session, CLI/RPC, workflow tests | agent/session, events, CLI/RPC, workflow docs | completed 2026-07-15 |
| A-004 | Direct source/phase-text boundary tests make refactors fail without behavioral changes. | Phase 14 | test architecture; replace implementation assertions when touched, retain manifest/docs/absence boundary checks | docs/export/behavior/pack tests replacing implementation-text assertions | testing/release coverage docs | completed for touched tests; broad historical conversion deferred |
| A-005 | `src/contracts.ts`, `src/agents.ts`, and `packages/workflows/src/run.ts` are conflict hotspots; docs/plans are larger than production source. | Phase 14 | maintainability gate; split only where completed work proves a cohesive domain | typecheck, public exports, behavior suites, docs links | review coverage and release docs | reviewed; no safe release-time cohesive split, deferred with measurements |
| R-001 | 0.0.4 must not be published after the review; all package/version/tag/provenance checks must target 0.0.5. | Phase 14 | 30-package graph, lockfile, release workflow/script | release, packaging, install, Node 20/24, registry checks | `release-and-install.md`, changelogs, migration docs | completed 2026-07-16; publication handoff pending |

## Accepted capability scope

These are the twelve accepted Mastra-comparison recommendations. Each has one implementation owner; adjacent phases may consume the result but do not own a duplicate implementation.

| ID | Capability | Single owner | Reused Prism primitives | Minimum missing surface | Test owner | Documentation owner |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | Direct run result and integrated stream | Phase 3 / core | `AgentSession`, loop, `AgentEvent`, bounded subscriber | `AgentRunResult`; race-free `session.stream()` wrapper over one execution | core agent/session suite | agent/session and events docs |
| F-002 | Minimal scorers, sampling, datasets, batch experiments | Phase 4 / `@arnilo/prism-evals` (completed 2026-07-15) | F-001 result, run/trace IDs, package-local evaluation store | package-local scorer/dataset/experiment records and runner | eval package tests | `evaluations.md` |
| F-003 | Minimal project scaffold | Phase 5 / existing root CLI (completed 2026-07-15) | CLI parser, examples, provider packages, pack smoke | deterministic `prism init`; tiny templates | CLI temp-project pack/install/typecheck/test | CLI, README, release/install docs |
| F-004 | AI SDK model interoperability | Phase 6 / `@arnilo/prism-provider-ai-sdk` (completed 2026-07-15) | `AIProvider`, provider events, transport/content/structured-output conformance | one supported AI SDK language-model adapter | provider conformance with fake AI SDK model | provider package and AI SDK page |
| F-005 | Working memory and semantic recall | Phase 7 / `@arnilo/prism-memory` (completed 2026-07-15) | context providers, middleware, ownership, Postgres package | package-local `Embedder`, `VectorStore`, working-memory store; one pgvector adapter | memory conformance and PostgreSQL opt-in suite | `working-and-semantic-memory.md` |
| F-006 | Durable human approval and suspend/resume | Phase 8 / workflows plus coding-security bridge (completed 2026-07-15) | checkpoints, leases, fencing, workflow resume/cancel, execution policy | suspended state, validated payload, exact-once resume cursor | workflow restart/race/authorization tests | workflow and coding-security docs |
| F-007 | Small text/Markdown RAG | Phase 9 / `@arnilo/prism-rag` (completed 2026-07-16) | Phase 7 embed/vector contracts, resource/content bounds, context provider | deterministic chunk/index/retrieve/citation helpers | RAG package tests | `rag.md` |
| F-008 | Web-standard agent/workflow handler and MCP server | Phase 10 / `@arnilo/prism-server` plus existing MCP package (completed 2026-07-16) | F-001 result/stream, workflow commands, MCP SDK, abort/redaction | `Request -> Response` handler; explicit MCP server registration | server and MCP in-memory tests | `server.md`, `mcp-tools.md` |
| F-009 | Durable schedules and reconnectable background runs | Phase 11 / workflows (completed 2026-07-16) | coordinator, checkpoints, leases, active-run registry | schedule records/claims and one-time/interval/host-calculated next run | workflow multi-coordinator tests | workflow/persistence/server docs |
| F-010 | Workflow composition, state, and replay | Phase 11 / workflows (completed 2026-07-16) | DAG runner, node adapters, checkpoints, lineage/events | workflow node, bounded typed state, replay lineage/cursor | workflow nested/replay tests | workflow docs |
| F-011 | Trace/run feedback linked to evaluations | Phase 12 / persistence plus OTel/evals (completed 2026-07-16) | run/trace IDs, cursor queries, redaction, OTel | bounded feedback record/query and safe OTel projection | persistence conformance and OTel tests | observability/evaluation docs |
| F-012 | Supervisor delegation and A2A | Phase 13 / `@arnilo/prism-supervisor` (completed 2026-07-16) | F-001, memory scope, permission/abort/budget, web handler | bounded child delegation and current A2A protocol mapping/signing | supervisor isolation and A2A protocol tests | `supervisors.md`, `a2a.md` |

## Existing primitive inventory

| Domain | Existing reusable primitive | What it already covers | Frozen gap/decision |
| --- | --- | --- | --- |
| Agent execution | `Agent`, `AgentSession`, `AgentLoopStrategy`, `singleShotLoop`, generate/validate/revise loop | provider/tool turns, retry, compaction, abort, stores, middleware, ledger | Add only F-001 result/stream in Phase 3; do not add a second engine or central application object. |
| Events and fan-in | `AgentEvent`, `createEventMultiplexer<T>()`, bounded `subscribe()` queues | normalized live events, ordered source fan-in, overflow policies | Reuse for server, workflow, and supervisor streams. Durable replay remains storage-owned. |
| Provider boundary | `AIProvider.generate()`, `ProviderEvent`, request policies, bounded SSE/body/argument transport, provider/media/openai helpers | first-party model streams, tool fragments, structured output, abort, metadata | AI SDK is an optional adapter only; no new provider abstraction. |
| Input/context | `InputBuilder`, `PromptBuilder`, `ContextProvider`, instruction injectors, resource loader, ten middleware hook names | explicit context/prompt assembly and host contributions | Memory and RAG inject through context/middleware; no memory-specific core hook. |
| Tools | `ToolDefinition`, validator, registry/filter, permission policy, `ExecutionPolicy`, bounded parallel dispatch | schema validation, allow/deny, ownership metadata, ordered tool transcript | Fix policy propagation/identity; durable approval extends workflow checkpoints rather than tool loop internals. |
| Redaction | `SecretRedactor`, message/event/request/session/ledger redactors | active-path cycle handling, object/Map key redaction, metadata-safe errors | Reuse at every new storage/remote boundary; no second redaction system. |
| Session/run persistence | `SessionStore`, `RunLedger`, `ProductionPersistenceStore`, cursor pages, ownership scope | sessions, branches, entries, runs, events, tool calls, usage, definitions, retention, migrations | Add narrowly typed records only when package-local stores cannot preserve cross-package run linkage. Vector search stays outside `SessionStore`. |
| Durable coordination | `CheckpointStore`, `LeaseStore`, fencing tokens; memory/SQLite/PostgreSQL implementations | versioned CAS state, atomic claims, expiry/takeover | Reuse for suspend, schedules, background runs, and replay. No new queue/lock engine. |
| Workflows | bounded DAG with agent/function/tool/conditional/fan-out/join nodes; checkpoint/resume/cancel/coordinator/RPC | deterministic local and multi-process orchestration | Extended for suspension, schedules/background runs, composition/state/replay without a durable-agent engine. |
| MCP | client bridge over SDK stdio and Streamable HTTP; list cache, timeout, abort, bounded results | consuming remote MCP tools | Add explicit server exposure in existing package; expose nothing by default. |
| CLI/RPC | `prism` CLI, LF-delimited RPC, `CommandDefinition`, workflow commands | host-controlled run and durable workflow operations | Add stdlib-only `init`; server remains optional package-owned. |
| Testing | mock provider plus provider/session/ledger/compaction/tool/extension/persistence conformance | network-free adapter and behavior checks | Add package-specific conformance only for genuinely reusable memory/eval/server seams. Avoid new source-text boundary tests. |
| Packaging | root plus 29 workspaces; 23 capability packages and six profile bundles | independent installation, dependency-ordered release, pack/import smoke | `prism-all` reaches all 30 packages; provider umbrella reaches all seven adapters; focused profiles stay unchanged. Core keeps zero runtime dependencies. |

## Current package and export inventory

The publishable graph is root plus 28 workspaces (29 packages). Every package remains explicit; no package discovery exists.

| Export group | Current public surface |
| --- | --- |
| Root runtime | `@arnilo/prism` |
| Root provider helpers | `@arnilo/prism/providers/openai-compatible`, `/transport`, `/openai`, `/media` |
| Root testing helpers | `/testing/provider-conformance`, `/session-store-conformance`, `/compaction-conformance`, `/tool-conformance`, `/extension-conformance`, `/persistence-schema`, `/run-ledger-conformance` |
| Root Node helpers | `/node/config`, `/settings`, `/trust`, `/session-store-jsonl`, `/contribution-discovery`, `/instruction-injectors`, `/system-prompts`, `/agent-definitions` |
| Provider packages | `prism-provider-openai`, `-opencode-go`, `-openrouter`, `-zai`, `-kimi`, `-neuralwatt` |
| Compaction packages | `prism-compaction-llm`, `prism-compaction-observational-memory` |
| Optional feature packages | `prism-observability-opentelemetry`, `prism-tool-validator-json-schema`, `prism-mcp`, `prism-coding-agent`, `prism-coding-security`, `prism-session-store-sqlite`, `prism-session-store-postgres`, `prism-credentials-node`, `prism-workflows`, `prism-evals`, `prism-provider-ai-sdk`, `prism-memory`, `prism-rag`, `prism-server`, `prism-supervisor` |
| Profile bundles | `prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, `prism-sdk` |

Core middleware exposes exactly ten built-in hook names: `provider_request`, `input_assembly`, `prompt_build`, `context`, `tool_call`, `tool_result`, `retry`, `compaction`, `session_start`, and `session_shutdown`. Custom string hooks remain extension-owned. New phases reuse these hooks or package APIs unless the owning phase documents a generic cross-package gap.

## Package and primitive decisions by phase

| Phase | Owner | Existing primitive consumed | Why it is insufficient | Minimum generic addition allowed |
| --- | --- | --- | --- | --- |
| 1 | core, coding-agent, coding-security | content policy, execution policy, approval policy | hostname normalization/DNS pinning and cache identity are incomplete | normalized/pinned network seam and execution run/session identity only |
| 2 | core, coding-security, OTel, providers | bash callback, runtime events, usage rows, media resolver | callbacks/terminal states/accounting/request aggregation are incomplete | sandbox output callback; usage scope/aggregate; request-level media resolver |
| 3 | core | session run, loop, events | no direct terminal result or integrated stream | `AgentRunResult` and one stream wrapper |
| 4 | optional eval package | Phase 3 result, IDs, persistence | no scorer/dataset record or bounded runner | package-local contracts; generic persistence addition only for durable cross-package linkage |
| 5 | root CLI | CLI and compile-checked examples | `prism init` + `templates/init` | templates and command only; no new library primitive |
| 6 | optional AI SDK provider | `AIProvider` and provider conformance | AI SDK models do not implement Prism's interface | adapter only; no core change |
| 7 | optional memory plus PostgreSQL adapter | context, ownership, middleware | no embedding/vector/working-memory contract | package-owned contracts and one production adapter |
| 8 | workflows/coding-security | checkpoint/resume/lease/policy | completed: suspended/denied state, validated/redacted resume, expected-version CAS, tool policy recheck | workflow status/checkpoint extension; no generic scheduler |
| 9 | optional RAG | Phase 7 and context/resource limits | completed: bounded text/Markdown chunk/index/filter/retrieve/citation/context helpers | package-only helpers |
| 10 | optional server and MCP | Web APIs, result/stream, workflow commands, MCP SDK | completed: bounded authorized agent/workflow Web handler plus explicit MCP tool/command registration and SDK Web transport | package-owned handler/router and MCP registrations |
| 11 | workflows/persistence | coordinator/checkpoint/lease/DAG | completed: ownership-scoped one-time/interval/calculated schedules, deterministic background enqueue, nested runner composition, bounded validated state/history, immutable replay lineage and fresh approval checks | package records over existing generic checkpoint/lease primitives; no migration or second worker engine |
| 12 | persistence/evals/OTel | run/trace IDs and cursor queries | completed: immutable exact-owned feedback append/query/delete, ID-only evaluation linkage, migration-003 SQLite/PostgreSQL stores, safe span projection and fixed-label counters | one bounded typed record/store plus optional OTel handlers; no vendor exporter |
| 13 | optional supervisor/A2A | session result, memory scope, policy, event multiplexer, Request/Response, WebCrypto | completed: explicit bounded child delegation, narrowing permissions/hooks, derived scopes, A2A 1.0 cards/ES256/JSON-RPC/SSE/exact-origin client | one zero-dependency optional package; text-only protocol subset |
| 14 | release/docs/tests | deterministic release and pack checks | completed: graph/docs/changelogs retargeted to 0.0.5; packed cross-capability and release matrix evidence recorded | no release-time source split; all umbrella inclusion preserves independent direct installs and inert activation |

## Threat-boundary matrix

| Boundary | Untrusted input / asset | Primary risks | Required 0.0.5 controls | Owner |
| --- | --- | --- | --- | --- |
| Media network fetch | URL, hostname, DNS answer, response bytes/MIME | private-network access, rebinding, redirects, decompression/size abuse | normalize literals, classify all private ranges, resolve and pin public address or require allow-list/injected hardened loader, reject redirects, timeout/abort, per-item and whole-request bounds before provider side effects | Phases 1-2 |
| Tool execution | model-produced name/arguments/path/command | shell execution, traversal/symlink escape, policy bypass, output exhaustion | schema/filter/permission/execution policy on every aggregator, realpath containment, approval, sandbox, abort, bounded/redacted output | Phases 1-2 |
| Approval cache/resume | action and human decision | cross-run/session/tenant decision reuse, stale approval, duplicate side effect | default no cache, identity-bound keys, durable owner check, version/fencing/idempotency, policy recheck on resume | Phases 1 and 8 |
| Remote HTTP/MCP | request body, identity headers, selected capability, stream consumer | unauthorized capability use, DoS, data leak, orphaned runs | expose nothing by default, host auth callback, owner checks, body/event/concurrency/time bounds, disconnect abort, redacted errors | Phase 10 |
| Working/semantic memory and RAG | stored user text, embeddings, retrieved documents/metadata | cross-tenant recall, prompt injection, retention leak, unbounded context | mandatory tenant/resource/thread scope, bounded top-K/context, redaction, inert context, host retention/deletion | Phases 7 and 9 |
| Workflow suspend/schedule/replay | resume payload, checkpoint, schedule, source run | forged resume, stale worker, duplicate fire/side effect, approval replay | schema validation, authorization, CAS/fencing, idempotency, immutable lineage, bounded state/history | Phases 8 and 11 |
| Feedback/evaluation | comments, tags, scorer output, dataset items | PII/secret persistence, tenant leak, metric-cardinality explosion | ownership, redaction, limits, retention, no free text in metric labels, scorer isolation | Phases 4 and 12 |
| Supervisor delegation | child prompt/result, selected child/tool, delegated memory | privilege amplification, recursive/cyclic delegation, budget exhaustion, memory/credential leak | implemented: explicit allow-list, AND-only permission narrowing, unique resources, depth/concurrency/token/time/tool limits, cancellation propagation | Phase 13 complete |
| A2A | remote card, signature, task/message stream | impersonation, replay, malicious/oversized remote content, SSRF/credential forwarding | implemented: protocol-1.0 validation, host auth, ES256 signature/expiry verification, exact HTTPS origin allow-list/redirect rejection, bounds/timeouts/abort, untrusted output mapping | Phase 13 complete |

## Capabilities already present — do not reimplement

| Existing capability | Evidence | 0.0.5 rule |
| --- | --- | --- |
| Revision ownership/redaction fix and valid multi-round tool transcript | `src/agent-loops.ts`, `src/redaction.ts`, regression tests | Preserve; Phase 3 reuses loop output. |
| Object and `Map` key redaction, active-path cycle handling | redaction suite | Use the same redactor everywhere. |
| Bounded provider SSE, error body, argument parsing, retry, native structured output | provider primitives and conformance | Adapters reuse these helpers/limits. |
| Polling OpenAI device OAuth | provider-openai OAuth tests | No new credential flow in core. |
| JSON Schema tool validation, bounded parallel calls, exclusive tools | core/tool-validator and loop tests | Preserve shared dispatch. |
| MCP client bridge | `@arnilo/prism-mcp` | Phase 10 adds server direction only. |
| SQLite/PostgreSQL production persistence, checkpoints, leases | adapter conformance/live CI | Extend only required records/migrations. |
| Encrypted file/keychain credentials | `@arnilo/prism-credentials-node` | Hosts keep explicit credential ownership. |
| Audio/file/document blocks and MIME/size checks | core/provider media tests | Fix SSRF/request aggregation; do not add a second media model. |
| OpenTelemetry agent/provider/tool instrumentation | optional OTel package | Correct lifecycle/accounting; no vendor matrix. |
| Bounded DAG workflows and distributed coordinator | workflows package | Extend the same engine. |
| Deterministic resumable package release | `scripts/release.mjs`, release workflow/tests | Retarget to 0.0.5 only after all gates. |

## Explicit exclusions

0.0.5 does not include Studio/editor/cloud services, browser automation, voice providers, chat-channel adapters, framework-specific HTTP adapters, auth-provider packages, deployment-provider packages, vendor observability exporters, a vector-store matrix, advanced document parsers/GraphRAG, an interactive TUI, automatic discovery/activation, or a mandatory central application object.

A cron-expression parser is also excluded: Phase 11 provides one-time timestamps, fixed intervals, and a host-supplied next-run calculator. Add a cron adapter only from a concrete requirement.

## Frozen baseline summary

Detailed commands and measurements are in [Performance limits](performance.md#005-phase-0-baseline-2026-07-15).

| Area | Frozen value |
| --- | --- |
| Runtime/toolchain | Node 24.18.0 measurement host; npm 11.16.0; supported runtime remains Node >=20 |
| Full network-free tests | 1,475 total; 1,450 pass; 25 explicit live skips; 0 fail; 25.750 s |
| `sdk:ready` | pass; 54.341 s |
| Publishable graph | 24 packages at Phase 0 freeze; 25 after Phase 4 (evals); 26 after Phase 6 (AI SDK); 27 after Phase 7 (memory); 28 after Phase 9 (RAG); 29 after Phase 10 (server); 30 after Phase 13 (supervisor/A2A). Phase 14 follow-up puts all 30 behind `prism-all` and all seven adapters behind `prism-providers`. |
| Tarballs | 542,993 packed bytes / 2,084,900 unpacked bytes aggregate; root 346.0 kB / 1.3 MB |
| Installed workspace | 72 MiB `node_modules` |
| Source/tests | 189 production TypeScript files / 26,828 lines; 144 test files / 23,535 lines |
| Docs/plans/examples | 70 docs / 12,662 lines; 58 plans / 24,270 lines; 39 examples / 3,134 lines |
| Current generator | `prism init`; default sources ~3.3 KB / 8 files; default clean install ~27.5 MB vs Mastra 439 MB |
| Mastra comparator | default scaffold measured 439 MB `node_modules`, 300 MB build output, 427 installed packages |

## Phase 0 verification

Executed from repository root at frozen HEAD:

```bash
npm test
npm run sdk:ready
for i in 1 2 3 4 5; do node --test packages/workflows/dist/__tests__/coordinator.test.js; done
node /tmp/prism-phase0-bench.mjs
```

Results:

- Pre-change baseline and post-documentation full checks passed with zero failures. Final `sdk:ready` completed in 57.764 s with all 24 dry-run packs; the frozen pre-change value remains 54.341 s.
- Coordinator suite passed five consecutive runs after the pre-freeze test correction.
- Traceability validation found 14 unique confirmed-finding IDs, 12 unique capability IDs, all roadmap phases 0-14, and no missing or duplicate owner.
- The benchmark script was temporary because these measurements are dated evidence, not CI wall-clock assertions.

## Documentation reviewed

- Local: `docs/index.md`, `public-contracts.md`, `agent-session-runtime.md`, `agent-loops.md`, `runs-and-usage.md`, `workflows.md`, `workflow-orchestration-primitives.md`, `host-security.md`, `release-and-install.md`, `performance.md`, and `review-coverage-2026-07-14.md`.
- Source: core contracts/runtime/middleware/input/tools/content/redaction/persistence/checkpoint/lease/provider primitives, workflow package, optional package manifests/exports, and all seven testing conformance helpers.
- Comparison: Mastra repository commit `2745031d1d4a4978f037092da371428c32e2842a` and current docs/source reviewed on 2026-07-15 for agents, memory, RAG, workflows, evals, observability, server, MCP, scheduling, supervisors, and A2A.

## Related pages

- [Roadmap](../roadmap.md): executable Phase 0-14 plan and release gate.
- [Review coverage — 2026-07-14](review-coverage-2026-07-14.md): evidence for capabilities already shipped before this review.
- [Performance limits](performance.md): dated baseline details and existing runtime limits.
- [Host security](host-security.md): current host responsibilities pending the Phase 1-2 corrections.
- [Release and install](release-and-install.md): current package graph and deterministic publication process.
