# Review coverage — 2026-07-22 Phase 7

Working evidence for Plan 075 Task 0. Freezes Phase 7 / Release **0.0.12** scope, protocol revisions, primitive ownership, finite limits, OAuth eligibility, threats, tests, docs, and release gates before implementation.

**Evidence frozen:** 2026-07-22. **Prism source:** `f9630a9bd12f299fdf473640e3869eea050b786f`. **Release target:** 0.0.12. **Default test rule:** network-free fakes and protocol fixtures; provider live canaries remain explicit host/operator gates.

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current public contract covers the requirement. |
| `extend` | Owning task adds a generic reusable contract to an existing seam. |
| `new-package` | New optional workspace package; core remains protocol/UI-free. |
| `compose` | Existing public primitives suffice; package-local wiring only. |
| `out-of-scope` | Later phase or deliberately unsupported; must not land in 0.0.12. |

## Frozen product decision

0.0.12 closes **coding-harness P2 interoperability** only: one optional AG-UI package with a stable ACP sibling, one generic streamed durable-resume seam, and a thin coding-focused LLM compaction preset.

**Not in 0.0.12** (do not implement here):

| Deferred or rejected item | Owner / reason |
| --- | --- |
| Conversation storage/service, artifacts API, personal-agent UX, device sync | 0.0.13+ product scope. |
| Enterprise identity, Azure/Bedrock/Vertex, work connectors, policy ledger | 0.0.13+ enterprise scope. |
| Prism TUI, desktop app, browser UI framework, server route | Host-owned UI; adapter uses Web `Request`/`Response` only. |
| ACP terminal, filesystem, editor, process, diff, or MCP implementation | Host/editor responsibility; stable sibling maps only shared message/tool/approval lifecycle. |
| Protocol types or AG-UI/ACP dependencies in `@arnilo/prism` core | Optional package owns protocol dependencies. |
| Second agent runtime, event daemon, polling worker, UI state database, replay cache | Reuse session/event/ledger/checkpoint seams; no background process. |
| Raw event passthrough, client-defined executable tools, client state mutation, raw tool args/results, local paths | Default-deny projection boundary. |
| Anthropic Claude Code or Google Gemini CLI subscription OAuth/token reuse | Current provider terms prohibit third-party subscription credential routing/piggybacking. |
| Generic OAuth framework or credential-file/CLI scraping | Provider-local supported flow only; current core OAuth seams already suffice. |
| Observational-memory coding runtime/profile | LLM preset is sufficient; do not add a second coding memory system. |

## Frozen external revisions

| Surface | Frozen reference | Compatibility decision |
| --- | --- | --- |
| Prism | [`f9630a9bd12f299fdf473640e3869eea050b786f`](../plans/075-release-0-0-12-coding-harness-interoperability.md) | Existing core/session/server/compaction contracts inventoried below. |
| Node.js | Release support remains Node 20+ | Optional package uses Web `Request`/`Response`, `ReadableStream`, native abort, and existing bounded SSE patterns; no framework dependency. |
| AG-UI | `@ag-ui/core` **0.0.57**; [Events](https://docs.ag-ui.com/concepts/events), [Interrupts](https://docs.ag-ui.com/concepts/interrupts), [Serialization](https://docs.ag-ui.com/concepts/serialization), [TypeScript schemas](https://github.com/ag-ui-protocol/ag-ui/tree/main/sdks/typescript/packages/core) | Pin the official schema package. Validate produced events with `EventSchemas`; close active message/tool sequences before `RUN_FINISHED` or `RUN_ERROR`. |
| ACP | `@agentclientprotocol/sdk` **1.3.0** stable root; [overview](https://agentclientprotocol.com/protocol/overview), [tool calls](https://agentclientprotocol.com/protocol/tool-calls), [TypeScript SDK](https://agentclientprotocol.com/libraries/typescript) | Use stable `session/update` and `session/request_permission` contracts only. Exclude `./experimental/v2`. |
| OpenAI Codex OAuth | Existing `packages/provider-openai/src/oauth.ts`; [OpenAI provider docs](providers/openai.md) | Existing RFC 7636 PKCE browser/device-code flow is retained, host-invoked, abortable, bounded, and redacted. |
| Anthropic Claude Code auth/legal | [Authentication](https://docs.anthropic.com/en/docs/claude-code/authentication), [legal and compliance](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance) | No third-party Claude.ai subscription OAuth adapter: Anthropic directs third-party products to API keys or cloud providers. |
| Gemini CLI auth/terms | [Authentication](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx), [FAQ](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md), [terms/privacy](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md) | No Gemini CLI OAuth adapter or token import: terms prohibit third-party software use of Gemini CLI OAuth; use API key or Vertex instead. |

## Frozen package and API contract

| Decision | Frozen choice |
| --- | --- |
| Package | New optional `@arnilo/prism-ag-ui`; it depends on `@arnilo/prism` and pinned protocol packages. `@arnilo/prism` remains dependency-free and protocol-free. |
| Subpath | `@arnilo/prism-ag-ui/acp` is the only ACP export. It uses the stable ACP SDK root, never the experimental v2 subpath. |
| Root exports | `createAgUiEventMapper`, `createAgUiHandler`, `createPersistenceAgUiReplay`, and package-local limits/projection types. |
| ACP exports | `createAcpEventMapper`, `createPrismAcpAgent`. No terminal/filesystem/editor/process/MCP export. |
| Generic core gap | Add `resumeAgentRunStream()` and `AgentRunLifecycle.resumeStream()`. Both reuse one private resume preparation/CAS path with existing `resumeAgentRun()`; no AG-UI/ACP type enters core. |
| AG-UI run input | Parse official `RunAgentInput` before host capability resolution. Host rebinds `threadId`/`runId` to authorized session/run ownership; default input selection is final accepted user text only. |
| AG-UI lifecycle | Map Prism lifecycle/message/tool events to official `RUN_*`, `TEXT_MESSAGE_*`, and `TOOL_CALL_*` schemas. Close open text/tool sequences before terminal events. Map durable suspension to `RUN_FINISHED` with `{ type: "interrupt", interrupts }`; map failure to one `RUN_ERROR`. |
| Durable approval | Exact checkpoint `runId`, authorized ownership, interruption, and `expectedVersion` are required. AG-UI resume resolves every pending interrupt in one payload; ACP unknown/cancel/reject choices deny. No side effect is replayed after an ambiguous dispatched tool. |
| Replay | `createPersistenceAgUiReplay` adapts ownership-scoped `ProductionPersistenceStore.queryEvents({ sessionId, runId, ... })`. It pages durable redacted rows, then attaches to a live bounded subscriber. Delivery is at-least-once across page/live boundary; stable event/message/tool IDs permit client deduplication. Terminal replay never invokes a provider or tool. |
| Projection | Default deny: tool name/status only; no args, result, progress payload, raw event, local path, frontend tool, or arbitrary state. Host must explicitly provide redaction-safe projectors for any exposed value. |
| ACP parity | Map assistant chunks, safe tool status, usage, errors, and durable permissions over same projection/limits/ownership contracts. ACP `session/update` does not create a second run runtime. |
| Coding compaction | `createCodingCompactionStrategy()` lives in `@arnilo/prism-compaction-llm`, wraps `createLlmCompactionStrategy()`, enables existing file-operation retention, and adds coding instructions. It produces normal `kind: "compaction"` entries; raw history remains. |
| Release graph | Task 8 adds one publishable package (34 → 35) and includes it only in `@arnilo/prism-all`, never `@arnilo/prism-code` or `@arnilo/prism-sdk`. |

## Capability traceability matrix

| Phase 7 roadmap criterion | Existing surface | Minimum gap | Status / owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Provider-authorized subscription OAuth behind existing seams | `OAuthProvider`, `refreshOAuthCredential`, Node OAuth store, OpenAI Codex PKCE/device flow | Support matrix and eligibility gate; no currently eligible Anthropic/Google flow | `compose` / Task 6 | provider registration absence; existing Codex OAuth tests | credential + provider pages | offline + provider-policy review |
| AG-UI event mapping without core/UI coupling | Redacted ordered `AgentEvent`, session `stream()`/`subscribe()` | Optional mapper over official schemas and projection policy | `new-package` / Task 2 | schema/lifecycle/redaction/limit fixtures | `ag-ui.md`, agent events | offline package test |
| Host TUI/desktop run, approval, resume, reconnect | Durable run state, `AgentRunLifecycle`, `AgentEventRecord`, `queryEvents`, server SSE limits | Generic streamed durable resume + handler/replay adapter | `extend` / Task 1; `new-package` / Task 3 | CAS/ownership/reconnect/no-rerun/overflow fixtures | runtime, runs, server, security | offline integration |
| ACP parity where event/tool/approval contracts overlap | Same agent event, interruption, and lifecycle seams | Stable sibling mapper/agent over shared policy | `new-package` / Task 4 | stable SDK type/permission/subpath packed-consumer tests | AG-UI, A2A, security | offline package test |
| Coding-aware compaction retaining path/diff/check/plan signals | LLM `CompactionStrategy`, file-operation collection, coding checkpoints/check summaries | Thin LLM preset and fixture | `compose` / Task 5 | prompt/redaction/repeated-compaction/conformance fixtures | compaction + coding docs | offline package test |
| Finite protocol/reconnect/compaction behavior | Server/SSE, subscriber, persistence, compaction limits | Package-local resolved limits plus benchmark | `new-package` / Tasks 2–3; `compose` / Task 5; Task 8 | hostile-input and benchmark schema/budget tests | performance + AG-UI docs | benchmark + `sdk:ready` |
| No product/UI/enterprise scope creep | Host-owned UI/product boundaries | Explicit negative tests and release guard | `compose` / Tasks 0, 8 | source/package/export scope assertions | review + migration docs | pack/install + diff review |

## Primitive and caller inventory

| Primitive / symbol | Existing contract and callers | Phase 7 disposition |
| --- | --- | --- |
| `AgentEvent`, `redactAgentEvent`, `AgentSession.stream()` / `subscribe()` | Core redacted ordered live events; subscriber default queue 1024 and close/drop policies | Reuse. Adapter owns protocol event correlation and projected payload. |
| `AgentEventRecord`, `RunLedger`, `ProductionPersistenceStore.queryEvents()` | Redacted durable event rows; SQLite/Postgres persistence queries | Reuse for replay only after host ownership binding. Add no event store/cache. |
| `resumeAgentRun`, `AgentRunLifecycle.resume()` | CAS, exact ownership/ref/session/fingerprint/revision, denial, dispatched-tool ambiguity protection | **Extend once** with streamed resume wrappers used by AG-UI and ACP. |
| `StoredAgentRunState`, `AgentRunInterruption`, checkpoint store | Redacted versioned pre-side-effect durable state; 256 KiB default / 1 MiB hard | Reuse. Adapter exposes only public interruption/status/version. |
| `PrismServerLimits` and server SSE handler | Existing Web request/response, abort, bounded stream/event/queue/time controls | Reuse values/pattern; AG-UI remains package-local and does not add server route. |
| `SecretRedactor`, credential resolver/OAuth store | Exact known-secret redaction; host-owned late-bound credentials/storage | Reuse. Project before transport/persistence; do not scan CLI credentials. |
| `OAuthProvider`, `refreshOAuthCredential`, `createOAuthCredentialStoreAdapter` | Generic login/refresh/store seam, OpenAI provider implementation | Reuse unchanged. Future provider OAuth stays provider-local and eligibility-gated. |
| `CompactionStrategy`, LLM preparation/file operations | Standard append semantics; LLM tracks read/modified files and caps summary/provider output | Reuse. Implement preset, not a memory runtime. |
| Observational-memory strategy | Optional projection/ledger/fold rendering workers | Leave unchanged; no coding profile needed. |
| Coding checkpoint and named check summaries | Bounded plan/todo/artifact/check references and fixed command checks | Supply coding signals to LLM compaction fixture/instructions; do not expose raw checkpoint/path data by default. |

### Primitive decision

**Authorized generic core extension:** `resumeAgentRunStream()` and `AgentRunLifecycle.resumeStream()` only. The implementation must share resume validation/CAS/dispatch preparation with `resumeAgentRun()` and use the existing bounded event subscriber. Both AG-UI and ACP consume it.

**Authorized new package:** `@arnilo/prism-ag-ui`, including its `./acp` sibling and package-local mapper, handler, replay, SSE, projection, and limit code.

**Authorized package-local composition:** `createCodingCompactionStrategy()` in `@arnilo/prism-compaction-llm`; provider support documentation/negative guards.

**Rejected:** protocol types in core; UI framework/server route; new runtime/store/worker; generic OAuth abstraction; observational-memory coding runtime; client-controlled tools/state; raw event passthrough; Claude/Gemini CLI credential reuse.

## Frozen finite limits and charging points

**Rule:** adapter validates every incoming selector/body/count before resolving a session, invoking resume, querying replay, or subscribing. It checks every outgoing projected field before enqueue/serialization. Task 2/3 must implement these exact defaults and hard caps; they may tighten a default but must not raise a hard cap without updating this page, tests, and docs.

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Request body | 64 KiB / 1 MiB | Before AG-UI parse | Task 3 returns bounded client error. |
| Input messages | 128 / 1,024 | Before host input resolver | Task 3 rejects; never silently truncates user intent. |
| Input text or one content value | 64 KiB / 1 MiB | Before message projection/host resolver | Task 3 rejects. |
| Frontend tools / frontend state mutation | 0 / 0 | Before session/run lookup | Task 3 rejects unless a later scope revises this freeze. |
| Replay cursor | 4 KiB / 16 KiB | Before durable query | Task 3 rejects malformed/oversized cursor. |
| Replay page rows | 100 / 500 | Before `queryEvents` | Task 3 pages; never full-scans. |
| Outbound projected event | 64 KiB / 1 MiB | Before SSE/ACP enqueue | Tasks 2–4 close/fail safely; do not split JSON. |
| Outbound text, tool display, state snapshot | 64 KiB / 1 MiB | Before schema serialization | Tasks 2–4 omit/truncate only with explicit bounded marker. |
| Tool args/results/progress payload | 0 / 0 by default | Projection | Tasks 2–4 omit. Any later host projector remains inside outbound-event cap. |
| Error detail | 8 KiB / 64 KiB | Before protocol error event | Tasks 2–4 redact and truncate. |
| Stream events / aggregate bytes | 10,000 / 100,000; 10 MiB / 64 MiB | Before each enqueue | Task 3 closes stream with bounded terminal error. |
| Subscriber queue | 128 / 4,096 | Existing `SubscribeOptions` passed by adapter | Tasks 1/3 use `overflow: "close"`; no hidden queue. |
| Request/run wall time | 120 s / 30 min | Adapter-owned abort signal | Task 3 aborts/cleans up; background completion is explicit host policy only. |
| Coding compaction output | reuse 16,384 / 131,072 tokens; error 1 KiB / 8 KiB | Existing LLM strategy | Task 5 adds no provider call or unbounded parser. |

The request/event/aggregate/queue/time values intentionally match existing `@arnilo/prism-server` defaults and hard caps. Replay page and cursor values reuse bounded persistence/MCP conventions. The `0 / 0` tool/state rows are a capability denial, not a zero-length serialization limit.

**Forbidden:** unbounded replay, polling, background queue, raw tool payload forwarding, arbitrary client state patch, local path disclosure, auto OAuth refresh timer, CLI credential scan, second compaction call, or hard-cap increase.

## OAuth eligibility matrix

| Provider surface | 0.0.12 status | Allowed auth | Explicitly prohibited / absent | Future eligibility evidence |
| --- | --- | --- | --- | --- |
| OpenAI Codex | supported existing flow | `createOpenAICodexOAuthProvider`; host-invoked browser/device code, PKCE, abort, refresh/store seam | automatic login, ambient credential discovery | Existing protocol/abort/refresh/redaction/store tests remain required. |
| Anthropic provider | API key only | Host-supplied `apiKey` | `createAnthropicSubscriptionOAuthProvider`, Claude Code credential file/token import, Claude.ai subscription routing | Provider-published third-party authorization plus exact flow/scopes, terms review, network-free fixtures. |
| Google provider | API key only | Host-supplied `apiKey`; Vertex remains later enterprise scope | `createGeminiCliOAuthProvider`, Gemini CLI credential/token import | Provider-published third-party authorization plus exact flow/scopes, terms review, network-free fixtures. |

A future provider-local subscription adapter requires all of: explicit provider permission for third-party products; exact authorize/token/refresh documentation; abort and expiry behavior; PKCE/state where required; bounded request/response handling; token/code/error redaction; durable store round trip; no import/setup network; protocol conformance; legal review. Until then absence is correct behavior, not a missing stub.

## Threat and authority matrix

| Boundary | Trusted authority | Untrusted input | Mandatory control | Default / unsupported |
| --- | --- | --- | --- | --- |
| AG-UI thread/run IDs | Host `authorize` and session/run resolver | Client `threadId`, `runId`, cursor | Rebind to exact ownership/session/run; validate checkpoint version | Cross-owner replay/resume unsupported. |
| Resume/approval | Durable checkpoint + host policy | Resume payload/permission result | Exact run/interruption/version; all open interrupts addressed; CAS before side effect | Partial, stale, unknown, or ambiguous resumes fail. |
| Event/replay payload | Runtime redactor + host projection | Messages, tool events, ledger rows | Redact then allow-list/project/cap before transport | Raw events/paths/args/results/state unsupported. |
| Client tools/state | Host tool registry/session state | `RunAgentInput.tools`, state, custom fields | Reject before agent lookup | Client cannot grant capabilities or mutate backend state. |
| ACP permissions | Host permission policy + checkpoint | ACP option/outcome | Only known allow-once/reject selection maps to exact resume; unknown/cancel denies | Allow-always persistence is not added in 0.0.12. |
| OAuth | Provider terms + host credential ownership | OAuth code/token/CLI credential files | Explicit authorized flow, bounded calls, redaction, host store | Claude/Gemini CLI subscription credential use unsupported. |
| Compaction | Existing LLM redactor/limits/provider | Paths, diffs, command/check output, previous summary | Existing serialization/redaction/caps; retain signal summary only | Full diff/transcript retention and second memory runtime unsupported. |

## Validation matrix for Task 0

| Check | Frozen assertion |
| --- | --- |
| Traceability | Every Phase 7 roadmap criterion has one primary Task 1–8 owner; 0.0.13+ conversations/artifacts/enterprise identity have none. |
| Protocol revisions | `@ag-ui/core@0.0.57`; `@agentclientprotocol/sdk@1.3.0` stable root; official AG-UI schemas validate mapped events. |
| Primitive reuse | Only streamed durable resume is a generic core extension with two consumers; all AG-UI/ACP types stay optional-package-local. |
| Lifecycle | `RUN_FINISHED` closes text/tool lifecycle; durable suspension is interrupt outcome; terminal replay never reruns work. |
| Finite resources | All request/event/page/queue/text/tool/state/error/time caps above are enforced; no polling/daemon/unbounded scan. |
| Security | Ownership before data, exact-version approvals, default-deny projection, redaction before transport, and no frontend capability grant. |
| OAuth policy | OpenAI Codex remains only subscription OAuth; Anthropic/Google register API key only and expose no forbidden factory. |
| Coding compaction | One LLM preset reuses file operations/standard entries/redaction/caps; raw session history stays intact. |

## Documentation and release ownership

- Task 0: this evidence page, `docs/index.md`, and `docs.test.ts` regression guard.
- Task 1: generic streamed durable resume; runtime/events/public-contract docs.
- Tasks 2–4: optional AG-UI/ACP mapper, handler/replay, and stable sibling; AG-UI/security/A2A docs.
- Task 5: coding LLM compaction preset and docs.
- Task 6: OAuth support-matrix docs and absence guards.
- Task 7: canonical docs, examples, migration, package metadata/navigation.
- Task 8: 0.0.12 graph, benchmark, pack/install, supply-chain, dry-run publish, and roadmap completion evidence.

No public implementation API changes land in Task 0. This page, `roadmap.md` Phase 7, and Plan 075 are authoritative until implementation; later tasks may tighten defaults but cannot widen scope, raise hard caps, add protocol types to core, add a background worker/store, or enable unsupported subscription OAuth without updating this evidence, tests, docs, and plan.
