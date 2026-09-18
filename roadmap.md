# Prism Roadmap — Release 0.8.0

Updated: **2026-09-18**

Released baseline: **0.7.0** — shipped 2026-09-15 as the six-plan host-completeness line ([072](plans/072-Host-Eval-And-Observability-Cockpit.md)–[078](plans/078-Host-Owned-Subagent-Spawn-And-Parallel-Agents.md)), Node `>=22`, ten publishable manifests.

Current release: **0.8.0** — eleven publishable manifests. Messaging channels (`@arnilo/prism-channels`), connected apps, `@arnilo/prism-work` replacing `@arnilo/prism-office`, durable long-run surfaces, and honesty gates. Cut owned by [085](plans/085-Honesty-Gates-Runtime-Split-And-0-8-0-Cut.md) (supersedes [080](plans/080-Messaging-Channel-Followons-And-0-8-0-Cut.md) Task 10). Registry/tag writes stay operator-authorized.

Status: **verified 2026-09-18** (085 Task 8). Registry/tag writes stay operator-authorized.

Next: R09 delegated coding runtimes, R12 native Vertex, and R13 remote clients remain later-release items if demand returns.

This roadmap replaces the previous historical roadmap in full. It preserves the rationale and priorities from the 2026-09-13 review for future reference. Historical implementation evidence remains in [plans](plans/README.md), [CHANGELOG](CHANGELOG.md), and [documentation history](docs/history/README.md); it is not repeated here.

**P0, P1 and P2 mean execution priority within 0.7.0—not separate release dates or permission to defer scope.** Earlier demand-gated recommendations are now part of this release request. The plan fixes reference integrations and requires their verification.

## 1. Direction and objectives

**Prism needs less feature breadth and more end-to-end completeness.**

Prism already implements most underlying capabilities advertised by major agent frameworks. Its largest opportunity is making those capabilities work together reliably so hosts do not rebuild authorization, accounting, review, recovery, and operational glue.

Positioning:

> A provider-neutral agent runtime that hosts can own, govern, inspect, and recover—across personal assistants, coding agents, and business workflows.

Objectives for 0.7.0:

- Make personal, coding and multi-tenant business hosts easier to assemble correctly.
- Bind every paid call, privileged action, approval and retrieved source to current host authority and attributable evidence.
- Distinguish completed, failed, denied, unsupported and uncertain outcomes consistently across packages.
- Support durable human review and safe restart without silently repeating external effects.
- Deliver useful reference integrations without creating another runtime, hosted platform or broad abstraction framework.

Expected outcome: the three host journeys in Section 8 pass against freshly built and packed 0.7.0 artifacts, every recommendation has implementation/tests/docs/evidence, and the existing ten npm packages remain a coherent release. Optional installation must not become optional verification of a capability claimed to ship.

## 2. Existing strengths to extend—not rebuild

| Surface | Already available | Direction for 0.7.0 |
| --- | --- | --- |
| `@arnilo/prism` | Agent/session runtime, streaming, loops, guardrails, tools/skills, identity, limits and durable interruptions | Consistent run-local authority and evidence; preserve one runtime |
| `prism-core` | Workflows/schedules/sagas, server, persistence, policy/quorum approvals, audit, routing, evals, credentials and work connectors | Complete invocation, review and operating paths across these components |
| `prism-providers` | Native and compatible model adapters, workload identity, caching/reasoning and modality contracts | Govern all calls and deepen native Bedrock/Vertex fidelity |
| `prism-coding-tools` | Files/shell/Git, workspaces, LSP, checks, process sessions, Docker/native sandbox contracts, inspector | Coherent contained processes, recovery and external coding-runtime delegation |
| `prism-memory` | Working/semantic/observational memory, consent, hybrid RAG, generations, provenance, Wiki/Graft | Document ACLs, source synchronization and cross-layer memory lifecycle |
| `prism-mcp` | Client/server bridge, OAuth, bounded tools/resources/prompts, MCP Apps | Invalidate changed/revoked capabilities and preserve authority through integration |
| `prism-ag-ui` | AG-UI, A2UI, ACP, A2A, replay and approval projections | Match core's durable edited-approval capabilities |
| `prism-acp-agent` | Spawnable stdio agent, validated local config, coding tools and persistence wiring | Real-provider onboarding with truthful config, authority and recovery |
| `prism-office` | Typed Office models, parsing/generation, patches/previews and decimal-safe spreadsheets | Semantic diffs, evidence-bound review and import fidelity |
| `prism-web-tools` | Search/fetch/extract/browser tools, citations and untrusted-content boundaries | Reviewable research evidence, not more interchangeable search wrappers |

Do not schedule generic “add memory,” “add HITL,” “add tracing,” “add workflows,” or “add multi-agent support.” Those foundations already exist. Current API navigation: [docs/index.md](docs/index.md).

## 3. First fix three concrete integration traps

These are review findings to reproduce from a fresh build and fix before feature expansion. They are not claims that the entire repository received an exhaustive security audit. The review's 25 ACP/router tests used existing build output; they do not substitute for release verification.

### A. ACP MCP allow-list uses unsafe URL prefixes

`selectMcpServers()` currently compares URLs using `startsWith`. Allowing `https://mcp.example.com` also admits `https://mcp.example.com.attacker.invalid/mcp`.

**Fix:** parsed scheme/host/effective-port matching, with explicit path-segment boundaries. Reject malformed/ambiguous policy entries. Keep downstream SSRF, DNS and redirect checks; origin matching alone is not network containment.

**Host value:** the configured allow-list reflects intended destinations rather than similar strings.

Location: `packages/acp-agent/src/index.ts:41–49`. **073 Task 2.**

### B. Synchronous router facade does not enforce complete governance

`providerSource()` checks allow-list/residency but does not perform async budget/rate/circuit admission. A zero-budget probe selected a provider through this facade while `resolve()` denied it correctly.

**Fix:** fail loudly when a synchronous facade is used with governance it cannot enforce. Preserve explicitly supported narrow use. Then provide the complete governed invocation adapter in R01.

**Host value:** “router configured” no longer implies protections that are absent from the chosen call path.

Location: `packages/prism-core/src/governance/model-router/router.ts:435–485`. **073 Task 3.**

### C. ACP provider override still pairs with a mock model

The spawnable launcher accepts a provider override but constructs `{ provider: "mock", model: "mock" }` as its model.

**Fix:** explicit matching model/provider configuration, scoped credential references, real-provider tests and deliberate mock mode. Preserve configuration through editor-backed sessions and durable reconstruction.

**Host value:** editors launch useful Prism agents without replacing launcher internals.

Location: `packages/acp-agent/src/index.ts:34–38,75–86`. **073 Task 4.**

## 4. Complete recommendation set for 0.7.0

### P0 — R01. Governed invocation and aggregate task accounting

**Existing foundation:** atomic router reservations, usage records, per-run limits, circuit state and candidate selection.

**Deliver:** an opt-in provider-edge adapter that selects, reserves, applies request policy, invokes, settles usage and records outcome. Extend accounting across retries, model switches, child agents, compaction, observational-memory work, embeddings and paid tools. Support shared task/tenant budgets rather than separate model buckets being mistaken for aggregate limits. Bind deployment/residency to host-verified metadata.

**Why:** manual bridging lets hosts omit accounting or enforce policy on only the visible chat path. One task can spend across many providers and background jobs.

**Hosts gain:** dependable spending controls, chargeback, governed non-session calls and safer failover.

**Done means:** concurrent cross-model/child work cannot oversubscribe admission; every attempt settles or remains explicitly unknown. Strict budgets reject unbounded or unpriced work. No fallback replays effects or partially delivered output. Missing usage is never zero usage.

**073 Tasks 6–7.** References: [model routing](docs/model-routing.md), [runs and usage](docs/runs-and-usage.md).

### P0 — R02. Complete durable business-action review

**Existing foundation:** pending decisions, quorum/SoD approval, artifact review, connector drafts and idempotency.

**Deliver:** stable persisted draft/revision identity for M365/GWS; approval bound to exact operation, recipients, payload digest, reviewer authority and policy revision; explicit resume of that revision after restart. Edits invalidate prior approval. Expose edited approvals through AG-UI/server using core validation rather than a second UI policy.

**Why:** an approval callback and an in-memory draft Map do not provide “review this exact email tomorrow after a restart.”

**Hosts gain:** reliable mail/calendar/file review, reviewer edits, restart survival and fewer duplicate or mismatched actions.

**Done means:** draft → edit → reapprove → restart → execute is consistent across replicas; expired/revoked/stale approvals reject; ambiguous external results enter reconciliation rather than replay.

**073 Tasks 8–9.** References: [work tools](docs/work-tools.md), [artifact review](docs/work-artifacts-and-review.md), [AG-UI](docs/ag-ui.md).

### P0 — R03. Finish portable sandbox execution

**Existing foundation:** Docker sandbox, capability attestations, workspace import/export, process sessions and durable recovery contracts.

**Deliver:** Docker `startProcess`, contained input/output/wait/signal/kill/release, attested reconnect, coherent shell/filesystem/LSP/browser workspace, explicit snapshot lifecycle, and an optional E2B reference adapter.

**Why:** coding agents need watchers, development servers and interactive processes. Business document/data processing also needs contained execution. A one-shot sandbox is not a complete process environment.

**Hosts gain:** portable execution with fewer host-process workarounds, recoverable workspaces and clear cleanup ownership.

**Done means:** restart attaches only to attested owned resources, never spawns a duplicate to conceal uncertainty. Filesystem snapshots are not advertised as process-memory checkpoints. Vendor egress/isolation and retained-resource cleanup remain explicit. No Prism cloud compute platform is built.

**073 Tasks 10 and 13.** References: [process sessions](docs/process-sessions.md), [coding security](docs/coding-security.md).

### P0 — R04. Permission-aware, synchronized enterprise retrieval

**Existing foundation:** exact corpus scopes, hybrid lexical/vector retrieval, source replacement, generations, reranking and citations.

**Deliver:** document ACL constraints inside both query legs, authorization/version rechecks before reranker and model exposure, revocation-aware caching, source freshness, and durable incremental Google Drive synchronization for content/deletion/ACL changes.

**Why:** tenant/corpus isolation does not authorize individual documents in a shared knowledge base. Filtering after top-K also reduces useful recall and is not an adequate authorization contract.

**Hosts gain:** permission-trimmed answers, prompt revocation, fresher sources and better retrieval under selective access.

**Done means:** unauthorized text, titles and citations never leave the authorized boundary; revoked sources are withheld; synchronization survives page replay/crash without skipping committed changes. Unknown group/access facts are not inferred as permission.

**073 Tasks 11–12.** Reference: [RAG](docs/rag.md).

### P0 — R05. Validated host compositions and onboarding

**Existing foundation:** `createSecureAgent`, templates, explicit extension activation, persistence adapters, ACP binary and inspector.

**Deliver:** maintained personal-assistant and multi-tenant-business-worker compositions; working real-provider ACP; inspection of effective tools, credential references, ownership, durability, sandbox capabilities and governance coverage; readiness refusals for unsupported combinations; fresh packed-install tests of documentation.

**Why:** host ownership should not require every host to rediscover all wiring rules. Powerful primitives can still create an error-prone first hour.

**Hosts gain:** faster onboarding and clearer production-readiness boundaries.

**Done means:** compositions run without source-tree dependencies; inspection is bounded/redacted/inert by default; memory-only stores or mixed uncontained workspaces are never labeled production-durable/isolated. Reuse existing templates and inspector, not a new profile framework.

**073 Tasks 4–5 and 27.** References: [host security](docs/host-security.md), [CLI](docs/cli-rpc.md), [inspector](docs/dev-inspector.md).

### P1 — R06. Operational controls for background execution

**Existing foundation:** coordinator, checkpoints, leases/fences, schedules, durable cancellation, server health and drain.

**Deliver:** fair tenant/workload admission, queue age/deadline visibility, starvation protection, inspection of suspended approvals/unknown effects/recovery failures, separately authorized operator intervention, and a deployable reference worker.

**Why:** exclusive claiming is not fair scheduling, and a recoverable workflow is not automatically an operable service.

**Hosts gain:** predictable background throughput, noisy-neighbor protection and actionable incident response.

**Done means:** a saturated tenant cannot indefinitely hide other eligible work; drain completes or reaches an explicit deadline; operators cannot unlock leases or replay unknown effects without supported reconciliation.

**073 Task 14.** References: [workflows](docs/workflows.md), [operations](docs/operations.md), [server](docs/server.md).

### P1 — R07. Agent-behavior evaluation and reproducible evidence

**Existing foundation:** immutable datasets, scorers, trace resolvers, judges, comparisons, production-run curation and prompt promotion.

**Deliver:** a shared `ExecutionTimeline` projection; multi-turn scenarios including clarification/refusal; required/forbidden/ordered tool trajectories; approval-before-effect checks; outcome/environment scorers; workflow experiments; failure injection; repeated trials with uncertainty; release manifests binding prompt/tools/skills/model/policy/runtime/dataset; inspector quality/cost/latency comparison.

**Why:** a correct answer can follow a forbidden action. Final-answer grading misses the failure that matters to a business host.

**Hosts gain:** safer releases, reproducible regressions and evidence for model/prompt/tool changes.

**Done means:** hard safety/business invariants fail independently of average answer quality; simulations cannot mutate production; trial count and uncertainty are visible; missing traces or skipped required cases cannot become passing evidence.

**Plan 072 Tasks 1–7** (primitives, scorers, scenarios, manifests); **plan 073 Task 15** (inspector comparison and host-journey gates). References: [evaluations](docs/evaluations.md), [prompt registry](docs/prompt-registry.md).

### P1 — R15. Host-consumable execution timeline, workflow graph, and cockpit aggregations

**Existing foundation:** `AgentEvent` / `WorkflowEvent`, `EvaluationTrace`, checkpoints, OTel `invoke_agent`/`chat`/`execute_tool`, provider capture, `buildGraph` Maps, loopback `prism dev`.

**Deliver:** frozen `ExecutionTimeline` and `WorkflowGraphView` JSON; live and persistence projectors; content-capture policy (`metadata` / `redacted_io` / `full_io`); Mermaid and Graphviz DOT exporters; run overlay; `summarizeTimeline` / `summarizeSession`; explicit workflow OTel `invoke_workflow` + node spans. Hosts render these in their own applications. No React cockpit, no Studio, no draw.io.

**Why:** raw event unions are complete but hostile. Every host otherwise re-parses 20 event variants and re-derives DAG graphics. Trajectory evals and ops waterfalls need the same document.

**Hosts gain:** cockpit waterfall, DAG graphics in-product, CI path match, cost/latency cards, APM correlation — without a hosted observability product.

**Done means:** default payload is metadata-only; I/O is opt-in and redacted; graph overlay has status not payloads; disabled OTel remains zero-alloc; mermaid/DOT are deterministic and escaped.

**Plan 072 Tasks 1–7.** References: [evaluations](docs/evaluations.md) (after 072), plan 072 `docs/execution-timeline.md` (to be added).

### P1 — R16. Work-scope session memory index

**Existing foundation:** observational-memory ledger (observations/reflections, exact-id recall, opt-in attach), session custom entries, coding `taskId` / workflow `nodeId` as *optional* host ids.

**Deliver:** host-named `WorkScope` tree, bind table to OM ids, active stack, `projectWorkMemory` as the working set, leaf-only auto-bind on flush, `withWorkScope` helper. Dropper skipped when any host scope exists; unscoped attach keeps today’s dropper. No baked phase/plan/task enum. No resource-scoped OM.

**Why:** a token-budget dropper cannot keep task-1 constraints alive for task 15, or promote phase-1 invariants into phase 2, without either dumping the log or deleting too early. Hosts need an index, not a second memory model.

**Hosts gain:** roadmap → plan → execute loops can attach episodes to *their* scopes and query `self+ancestors`. Prism does not own the ontology.

**Done means:** no `om.scope.*` → 0.6.0 OM byte-for-byte; projection is a filter (recall-by-id still full ledger); close ≠ delete; helper is not inside `runWorkflow`.

**Plan 077 Tasks 1–7.** References: [observational memory](docs/compaction-observational-memory.md).

### P1 — R17. Cache-stable attention compiler

**Existing foundation:** `assembleProviderInput`, `cache_aware` layout, `toolResultFold` (host `summarize` required), `applyContextBudget`, `session.compact` at task boundary (`thresholdEntries`), OM `compactAfterTokens` after post-run flush.

**Deliver:** opt-in compiler that **measures every provider turn** and **mutates nothing** until `used / inputCap ≥ triggerRatio` (default 0.75 of `contextWindow - maxOutputTokens - reserve`). Over ratio: sticky in-place thinking strip, then deterministic old tool-result stubs. Frozen prefix (system / `AGENTS.md` / skill catalog / tools) never touched. Compiler does not rewrite OM mid-run. Host-programmable compaction trigger (`threshold_entries` | `input_ratio` | `custom shouldCompact`). Compact still task-boundary. Still-over throws `AttentionBudgetError` rather than silently dropping constitution.

**Why:** rewriting the prompt every turn destroys prefix cache. A token-budget dropper that deletes history rows breaks tool pairing and cache. Hosts need a gate, not a mixer, and they need to program *when* OM compact fires without Prism inventing their ontology.

**Hosts gain:** long tool loops keep cache hits until they are actually fat; then thinking and grep dumps shrink first; OM summary lands only at compact, as a new stable prefix.

**Done means:** omitted field → 0.6.0 assembly byte-for-byte; under ratio → golden identical request; stubbed ids stay stubbed; `session.compact()` still throws in-flight; OM `compactAfterTokens` unchanged unless host passes `shouldCompact` / `trigger`.

**Plan 074 Tasks 1–6** (complete: primitive review, frozen contracts, input-cap resolution, the ratio gate with sticky thinking/tool-result stages, one host-programmable compaction trigger shared by `autoCompact` and observational-memory attach, opt-in wiring through `AgentConfig`/`AgentDefinition`/`RunOptions` with a session-owned sticky frontier, `attention_compiled` telemetry folding into an `attention` timeline step, the hermetic measurement scenario behind `docs/_evidence/phase74-attention-measurements.md`, the sticky frontier riding `persistSessionState` checkpoints, and the `truncated` → compact-once trigger, with a network-free example). References: [attention compiler](docs/attention-compiler.md), [input assembly](docs/input-and-prompt-assembly.md), [compaction](docs/compaction-and-retry.md), [provider caching](docs/provider-caching.md).

### P1 — R08. Cross-layer memory correction and deletion

**Existing foundation:** semantic memory consent/correction/deletion/retention and source-backed observations/reflections.

**Deliver:** lineage from messages through semantic memories, observations, reflections and summaries; corrections that supersede derived conflicts; revocation/deletion that blocks derived injection; explainable recall; explicit revocable parent-child sharing grants.

**Why:** deleting one vector row does not remove the same fact from a reflection or compacted summary.

**Hosts gain:** trustworthy personalization, less stale memory and meaningful user control.

**Done means:** invalidation takes effect before background cleanup; legacy lineage is handled conservatively; legal hold/audit retention are explicit exceptions, not silent promises of erasure. Retained held material stays out of model context; prior disclosure cannot be undone.

**073 Task 16.** References: [working/semantic memory](docs/working-and-semantic-memory.md), [observational memory](docs/compaction-observational-memory.md).

### P1 — R09. Delegate to complete external coding runtimes

**Existing foundation:** supervisor, ACP/A2A/MCP interoperability and model providers.

**Deliver:** Codex and Claude Agent SDK adapters first; Copilot, Gemini CLI and Cursor adapters follow within 0.7.0. Normalize task status/cancellation, approval requests, artifacts, usage and provenance; advertise actual visibility, enforcement and recovery support.

**Why:** model access is not a coding harness. `createOpenAICodexProvider()` does not embed Codex's complete runtime. Hosts may want Prism to govern the outer business workflow while delegating specialized coding work.

**Hosts gain:** best-of-breed coding execution without replacing surrounding orchestration.

**Done means:** each runtime has a tested capability matrix and live journey; unobservable actions/usage remain unobservable/unknown, not falsely approved/accounted. SDKs are lazy and version-pinned. Use supported Codex SDK/app-server, not the removed MCP-server interface. Local execution does not imply local inference.

**073 Tasks 17–18.** References: [supervisors](docs/supervisors.md), [A2A](docs/a2a.md).

### P1 — R10. Evidence-backed artifact and research review

**Existing foundation:** Office AST/patches, artifact revisions/approval, web citations and RAG provenance.

**Deliver:** paragraph/table/cell/slide diffs; approval bound to artifact and evidence revisions; source excerpts/snapshots with hashes/timestamps; citation integrity and claim-support checks; imported-document fidelity/loss reports; optional Mistral OCR/layout adapter for scanned documents.

**Why:** a changed hash says nothing about whether an amount, paragraph or factual claim changed correctly. Generated business artifacts need reviewable evidence.

**Hosts gain:** traceable reports, safer spreadsheet/document changes and less manual fact-checking.

**Done means:** reviewers can identify semantic changes and exact evidence; stale/revoked evidence invalidates acceptance. Source existence is distinguished from claim support, and model support verdicts retain uncertainty. OCR requires explicit data-upload authorization; default parsers remain local/no-network. No full Office editor or custom OCR engine.

**073 Tasks 19–20.** References: [documents](docs/documents.md), [artifact review](docs/work-artifacts-and-review.md), [document reader](docs/document-reader.md).

### P1 — R11. Per-run tool narrowing and remote capability invalidation

**Existing foundation:** registries, filters, dispatch permission checks, progressive discovery and skill dependencies.

**Deliver:** an immutable run-local subset of already registered/authorized tools applied to model schemas, discovery and dispatch; preserve it through checkpoints and recheck current permission on resume; invalidate loaded MCP definitions after schema/effect/authorization changes.

**Why:** exposing irrelevant tools increases prompt cost and selection errors. Dispatch-only denial protects effects but does not improve the model's choice set.

**Hosts gain:** one continuing assistant can switch safely between research, coding and business tasks without discarding session context.

**Done means:** no middleware, skill, client or subagent can broaden authority; concurrent runs do not mutate a shared registry; stale remote definitions reject before execution. No additional registry or hidden global tool state.

**073 Task 21.** References: [tools](docs/tools.md), [MCP](docs/mcp-tools.md).

### P1 — R12. Native enterprise-cloud provider fidelity

**Existing foundation:** Bedrock/Vertex/Azure endpoint and workload identity support; the Bedrock adapter now ships both a compatible route and a native Converse/ConverseStream route (plan 073 Task 22, completed 2026-09-14), while Vertex still uses its compatible route.

**Deliver:** native Vertex Gemini with workload credentials (Bedrock Converse/ConverseStream delivered in 0.7.0); explicit matrices for native tools, grounding, multimodal input, caching, reasoning, structured output and usage. Preserve compatible routes as explicit alternatives.

**Why:** enterprise hosts choose a cloud boundary for identity, network and data governance, not only model availability. Compatible APIs are not the entire native feature surface.

**Hosts gain:** native cloud functionality without custom provider adapters or leaving approved deployment boundaries.

**Done means:** native conformance and live tool/stream journeys pass; region/inference-profile policy is verified; hosted actions are attributed without pretending they pass through host tool approval. Unsupported capabilities fail explicitly.

**073 Task 22 (Bedrock, complete) and Task 23 (Vertex, out of 0.7.0).** References: [Bedrock](docs/providers/bedrock.md), [Vertex](docs/providers/vertex.md).

### P2 — R13. Channels and non-TypeScript hosts

**Existing foundation:** authorized HTTP/SSE, RPC, MCP, ACP, AG-UI, webhooks and durable decisions.

**Deliver:** thin Python and .NET remote clients plus maintained Slack and Teams approval/notification recipes. Cover streaming/reconnect/status/resume/cancellation, conversation binding, event deduplication and authenticated reviewer identity.

**Why:** hosts are not always TypeScript services, and users often review business actions where they already communicate.

**Hosts gain:** adoption without porting Prism, and approvals outside a custom web application.

**Done means:** both clients interoperate against packed server artifacts; both channels reject forged/replayed/cross-owner approvals and survive restart. Authentication is separate from reviewer authorization. Client source/build artifacts ship with 0.7.0; PyPI/NuGet publication requires separate operator approval. No multi-language runtime or channel framework.

**073 Tasks 24–25.** References: [server](docs/server.md), [agent events](docs/agent-events.md).

### P2 — R14. Complete realtime voice orchestration

**Existing foundation:** speech/transcription contracts, DeviceAdapter admission and OpenAI Realtime transport.

**Deliver:** realtime audio connected to ordinary agent tools, approvals and accounting; turn-taking/interruption/barge-in; non-replaying reconnect; transcript/privacy controls; one tested accessible host integration with text fallback.

**Why:** voice enables hands-free assistance, accessibility and business support. A transport alone is not a complete voice-agent harness.

**Hosts gain:** voice agents using the same governance and capabilities as text agents.

**Done means:** microphone consent never becomes blanket tool approval; revoked consent stops processing; reconnect reconciles call IDs/outcomes rather than repeating mutations. Audio is bounded and governed explicitly—text redaction cannot sanitize raw audio. Live interruption behavior and deterministic queue checks are recorded.

**073 Task 26.** References: [device adapters](docs/device-adapters.md), [speech](docs/speech.md).

## 5. What I would ship first

**Plan 072 first** (R07/R15): timeline, graph, trajectory/outcome scorers, scenarios, trials, manifests, cockpit aggregations, workflow OTel — complete. Then plan 073 traps and host compositions (Tasks 1–27 also complete). **Plan 077 in parallel** (R16 work scopes) and **plan 074 in parallel** (R17 attention compiler), then **075** (memory fabric), **078** (host-owned spawn) and **079** (messaging channels). 073 Tasks 28–29 are the cut and are deferred until the whole line is closed.

After plan 072 and the three concrete integration traps:

1. **Validated host compositions and real-provider ACP launcher — fastest adoption improvement.** Give hosts two tested starting points, truthful readiness inspection and a useful editor launcher. Start with existing APIs, then integrate the new adapters during final journeys. 073 Tasks 4–5 and 27.
2. **Governed invocation/accounting adapter — strongest cross-cutting business value.** Put admission and settlement around the actual paid operation, including children and background jobs. 073 Tasks 6–7.
3. **Durable draft review with editable approvals — turns existing governance into usable business functionality.** Persist the exact proposed action, bind approval to its revision and let reviewers edit without approving stale content. 073 Tasks 8–9.
4. **Docker process-session support — closes a concrete coding execution gap.** Keep watchers, servers and interactive work inside the same attested workspace as file edits and diagnostics. 073 Task 10.
5. **Document ACL retrieval — essential next step for enterprise knowledge hosts.** Enforce permission before retrieval/reranking exposure, then maintain it through incremental source changes. 073 Tasks 11–12.

This was the preferred implementation order, not a smaller release scope. All P0 work, all P1 work (including R15, R16, and R17) and the delivered P2 items shipped in 0.7.0, together with the plans absorbed into the line on 2026-09-14. Dependencies and separately checkable tasks are defined in [plan 072](plans/072-Host-Eval-And-Observability-Cockpit.md), [plan 073](plans/073-Release-0-7-0-Host-Completeness.md), [plan 074](plans/074-Attention-Compiler.md), [plan 075](plans/075-Memory-Fabric.md), [plan 077](plans/077-Work-Scope-Memory-Index.md) and [plan 078](plans/078-Host-Owned-Subagent-Spawn-And-Parallel-Agents.md); [plan 079](plans/079-Prism-Messaging-Channels-Telegram-Signal.md) moved to 0.8.0. 073 Tasks 28–29 were the cut and ran once the six shipped plans were closed.

## 6. Audience-specific adjustment

### Personal assistants

Prioritize **memory correction, onboarding and channel delivery**.

The central trust questions are whether the assistant remembers the right facts, can forget or correct them, uses the intended account, and asks before taking consequential action. Emphasize R05, R08 and R13, while keeping R01/R02 protections available. Voice R14 adds accessibility without replacing text approval or privacy controls.

### Coding hosts

Prioritize **sandbox processes, ACP usability and external harness adapters**.

The critical journey is edit → run/watch/test → inspect/review → restart/recover. Shell, file tools, LSP, browser and delegated runtime must agree on workspace identity and authority. Emphasize R03, R05 and R09; R11 reduces irrelevant capabilities without losing session context.

### Business hosts

Prioritize **governed calls, durable review, document authorization and behavioral evaluations**.

A good answer is insufficient if it leaked a restricted document, overspent a shared budget, sent the wrong draft or repeated an uncertain mutation. Emphasize R01, R02, R04 and R07; R06 supplies operations and R10 supplies review evidence.

Audience priority changes staffing and sequencing—not the obligation to complete every item for this requested release.

## 7. Model-side recommendation: evidence and clear capability boundaries

**The most useful improvement is not “more autonomy.” It is better evidence and clearer capability boundaries.**

Agents perform better when they can determine:

| Question | Required answer in Prism | Main recommendations |
| --- | --- | --- |
| **What is allowed now?** | Current identity/policy, effective tools, source ACLs, remaining admitted budget and actual sandbox/delegated capabilities—not prompt claims | R01, R03, R04, R05, R09, R11 |
| **Which source supports this fact?** | Authorized source/revision/excerpt, retrieval time and lineage, with uncertainty where support is not verified | R04, R08, R10 |
| **What changed since approval?** | Exact action/artifact revision and semantic difference; changed recipients/payload/evidence/policy require renewed authorization | R02, R10 |
| **Did an action complete, fail, or become uncertain?** | Correlated effect/attempt IDs, observable outcome and durable reconciliation state; no invented success or zero-cost default | R01, R02, R06, R09, R14 |
| **What can safely resume?** | Checkpoint/version/fence, current authorization, attested resource identity and explicit replay limits | R02, R03, R06, R08, R11, R14 |

Prism already has much of this machinery. Making the answers consistent across packages delivers more host value than another orchestration abstraction, provider wrapper or tool collection.

Evidence remains **data**, never authority by itself: a retrieved instruction cannot grant tools; an authenticated chat button cannot grant reviewer rights; a sandbox label cannot assert unverified isolation; a model judge cannot prove factual truth.

## 8. Release evidence and acceptance

### Three integrated host journeys

1. **Personal:** packed onboarding → scoped provider → remembered fact → correction/revocation across derived memory → authenticated channel notification/review → restart with no leaked stale context.
2. **Coding:** real-provider ACP → contained edit and long-running test/watch → diagnostics/browser workspace coherence → patch review → restart/reattach → external runtime delegation → cancellation and cleanup.
3. **Business:** verified identity → authorized synchronized knowledge → governed task budget → exact durable draft → reviewer edits/quorum → restart → external effect → uncertain-outcome reconciliation → evidence-backed artifact and audit.

Cross-cutting journeys cover Python/.NET protocol parity and voice interruption/reconnect without duplicate mutation.

### Required evidence

- Fresh build/offline tests, lint/format/typecheck, coverage, public declarations/compatibility, package truth, supply-chain/security checks and packed-install examples.
- Node 22 and Node 24 core/package coverage; optional SDKs with stricter engines explicitly refuse unsupported activation rather than raising the root floor silently.
- Required protected/live checks for PostgreSQL/pgvector, Docker/browser, Drive, E2B, OCR, Bedrock/Vertex, all claimed delegated runtimes, Slack/Teams and voice.
- Multi-worker reservation/fencing, approval CAS, source revocation, migration/rollback, cleanup and unknown-effect refusal tests.
- Recorded package/startup/runtime/resource/cost measurements; repeated trial evidence for behavior and declared setup for live latency measurements.
- Every recommendation linked to code, tests, docs, integration pins, operational ownership and a passing evidence artifact.

### Documentation truth criteria

These five acceptance criteria stay in force for the truth suite (`scripts/phase24-truth.test.mjs`):

- truth: no page claims “every” or “all” unless dependency closure proves it.
- truth: packed-install tests assert documented contents, not just that a file exists.
- truth: generated checks catch drift between manifests, docs and evidence.
- truth: stale 0.1.1/0.0.23 “current line” text and contradictory provider counts are gone.
- truth: docs tests fail on wrong package closure/version/navigation while permitting editorial changes.

**Missing credentials or infrastructure means blocked—not passed.** No item is silently dropped to preserve a date/version. No claim of exactly-once delivery for arbitrary external effects. No dry-run reported as published. Actual tagging/registry publication remains an operator-authorized action after plan 073 Tasks 28–29, which stay deferred until every plan of the extended line (072, 073, 074, 075, 077, 078, 079) is closed.

## 9. Product and implementation boundaries

- Extend existing sessions, ledgers, checkpoints, leases, workflows, tools, approvals and events. No second runtime.
- Keep root dependency-free and optional SDKs behind explicit activation and lazy optional dependencies.
- Hosts own identity, credentials, UI, accounts, infrastructure, retention policy, business rules and operational incident decisions.
- Reuse native/platform/installed functionality before adding dependencies or abstractions. New shared primitives require proven multiple consumers.
- Do not build Prism Studio, a visual workflow editor, hosted compute/control plane, identity provider, OCR engine, Office editor or multi-language runtime.
- Reference breadth is fixed in plan 073: E2B, Drive, Mistral OCR; Codex/Claude/Copilot/Gemini CLI/Cursor; Python/.NET; Slack/Teams; native Bedrock/Vertex; OpenAI Realtime host integration. Additional vendor catalogs are not implied. Plan 072 adds no vendor SDKs.
- Security tightenings need migration/refusal tests. Broad incompatibilities cannot be hidden under 0.7.0; resolve explicitly before release.
- Capability support must be truthful: local execution versus local inference; model provider versus complete harness; filesystem snapshot versus process memory; authenticated user versus authorized reviewer; observed usage versus estimated/unknown cost.

## 10. External reference points

These informed the review; they are not a claim that Prism must reproduce every provider's managed infrastructure. Exact integration versions are pinned and rechecked during implementation.

- [OpenAI sandbox agents](https://openai.github.io/openai-agents-js/guides/sandbox-agents/concepts/) and [Codex SDK](https://developers.openai.com/codex/sdk): coherent execution lifecycle and complete coding-runtime delegation.
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview): integrated tools, permissions, sessions and explicit checkpoint limits.
- [Google ADK evaluation](https://github.com/google/adk-docs/blob/main/docs/evaluate/criteria.md): trajectory checks beyond final answers.
- [Microsoft Durable Extension](https://learn.microsoft.com/en-us/agent-framework/integrations/durable-extension): operating durable workers and long-lived human review.
- [GitHub Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk), [Gemini CLI SDK](https://github.com/google-gemini/gemini-cli/blob/main/packages/sdk/README.md), [Cursor SDK](https://cursor.com/docs/sdk/typescript): complete coding harnesses and host integration, not interchangeable raw model APIs.
- [AWS AgentCore identity](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-authentication.html) and [policy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html): explicit delegated access and execution governance.
- [NVIDIA NeMo Agent Toolkit](https://docs.nvidia.com/nemo/agent-toolkit/latest/index.html) and [Salesforce Testing API](https://developer.salesforce.com/docs/ai/agentforce/guide/testing-api.html): profiling, evaluation and business behavior evidence.
- [Mistral Agents](https://docs.mistral.ai/studio/agents/agents-api), [AgentScope Runtime](https://github.com/agentscope-ai/agentscope-runtime), [IBM watsonx Orchestrate ADK](https://developer.watson-orchestrate.ibm.com/), [Vercel WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent), and [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/use-time-travel): connected work, portable execution and durable integration patterns.

Use this roadmap to recover **why** an item matters. Use [plan 072](plans/072-Host-Eval-And-Observability-Cockpit.md), [plan 073](plans/073-Release-0-7-0-Host-Completeness.md), [plan 074](plans/074-Attention-Compiler.md), [plan 075](plans/075-Memory-Fabric.md), [plan 077](plans/077-Work-Scope-Memory-Index.md) and [plan 078](plans/078-Host-Owned-Subagent-Spawn-And-Parallel-Agents.md) to see **what shipped in 0.7.0 and what evidence made it complete**, and [plan 079](plans/079-Prism-Messaging-Channels-Telegram-Signal.md) for the 0.8.0 channel work.
