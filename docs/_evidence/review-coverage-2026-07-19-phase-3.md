# Review coverage — 2026-07-19 Phase 3

Working evidence for Plan 070 Task 0. This page freezes Phase 3’s source revision, supported capability boundary, shared-primitive decision, finite-limit targets, and release evidence before public implementation begins.

**Evidence frozen:** 2026-07-20. **Prism source:** `6048e82db212303f4f072ff70539830b779f35cf` (`Phase 0.0.7 completed`). **Default test rule:** all default tests use local fakes; a credential-gated live suite is separate.

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current contract already covers this part. |
| `extend` | Owning task extends an existing optional package/primitive. |
| `new-package` | New optional package only; core stays unchanged unless a later two-consumer review proves a generic gap. |
| `unsupported` | Deliberate 0.0.8 absence. Return a stable explicit error when a declared protocol operation is unavailable. |

## Frozen external references

| Surface | Pinned reference | Compatibility decision |
| --- | --- | --- |
| OTel GenAI | [`semantic-conventions-genai@c26a2c21d1ee70d5231bd440c7b48d3c94ee506a`](https://github.com/open-telemetry/semantic-conventions-genai/tree/c26a2c21d1ee70d5231bd440c7b48d3c94ee506a/docs/gen-ai) | Development-status spans/metrics/events are adopted only where Prism has source data. Content attributes and evaluation explanations stay off by default. |
| MCP specification | [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) | JSON-RPC over stdio and Streamable HTTP only. Capability is declared only after SDK compatibility tests. |
| MCP TypeScript SDK | [`@modelcontextprotocol/sdk@1.29.0`](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.29.0), lock integrity `sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==` | Current bridge is 1.29.0. Context7 verified client capability declaration, roots handlers, server capability inspection, and Streamable HTTP session construction. Task 4 pins the manifest to the tested SDK version; no untested upgrade. |
| A2A | [A2A v1.0.0 `173695755607e884aa9acf8ce4feed90e32727a1`](https://github.com/a2aproject/A2A/tree/173695755607e884aa9acf8ce4feed90e32727a1) and [specification](https://a2a-protocol.org/v1.0.0/specification) | JSON-RPC/HTTPS only. Tasks, subscription, rich parts, and optional push hooks are added behind host lifecycle/auth adapters. |
| Exa | [Search](https://exa.ai/docs/reference/search), [contents retrieval](https://exa.ai/docs/reference/contents-retrieval), retrieved 2026-07-20 | Direct API only, `POST /search` with requested contents. Docs have no immutable revision, so URL plus retrieval date and adapter request/response fixtures are release evidence. |
| Brave | [Web Search `GET /res/v1/web/search`](https://api-dashboard.search.brave.com/api-reference/web/search/get), [versioning](https://api-dashboard.search.brave.com/documentation/guides/versioning), retrieved 2026-07-20 | Direct API only. Prism limits results to 20, matching documented maximum; token is late-bound `X-Subscription-Token`. |
| Firecrawl | [v2 introduction](https://docs.firecrawl.dev/api-reference/v2-introduction), [search](https://docs.firecrawl.dev/api-reference/endpoint/search), [scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [extract](https://docs.firecrawl.dev/api-reference/endpoint/extract), retrieved 2026-07-20 | Direct v2 API only: `/v2/search`, `/v2/scrape`, `/v2/extract`. Markdown and returned schema data are untrusted. |
| Release security | [Dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review), [SBOM](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-software-bill-of-materials), [secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning), [artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds) | Prefer GitHub-native gates, immutable action revisions, minimal tokens, and protected-environment canaries. |

### External behavior relied on

- GenAI inference and tool spans are `CLIENT` and `INTERNAL` respectively; `gen_ai.evaluation.result` is an event. Inputs, outputs, system instructions, and tool definitions are opt-in content fields, not default telemetry.
- MCP 1.29.0 clients declare capabilities at construction; undeclared use is rejected by SDK. Roots use `roots/list` plus optional `notifications/roots/list_changed`; server capabilities are inspected after connect.
- A2A v1.0 defines task get/list/cancel/subscribe, `text`/`raw`/`url`/`data` parts, ordered task updates, authenticated push configuration, and `A2A-Version` negotiation.
- Brave documents a 400-character/50-word query maximum, `count <= 20`, and `offset <= 9`; Prism never expands those provider maxima.
- Firecrawl documents `search.limit <= 100`, `query <= 500` characters and bearer authentication. Prism uses tighter portable defaults and validates returned Markdown/JSON itself.

## Capability traceability matrix

| Roadmap criterion | Current surface | Minimum 0.0.8 gap | Owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Parent OTel agent/provider/tool hierarchy and context | Event-derived independent `prism.*` spans in `packages/observability-opentelemetry` | Active parent/context lifecycle; semantic map; trace reference | 1 | parent/error/detach/exporter-failure matrix | `observability.md`, `agent-events.md` | offline OTel conformance |
| Metadata-safe GenAI/MCP telemetry and low-cardinality metrics | `AgentEvent`, redactor, safe counters | Convention mapping and label allow-list | 1 | secret/content/ID label-negative tests | `observability.md`, `host-security.md` | tarball/secret scan |
| Final-result/trace grading, judges, pairwise, thresholds | `@arnilo/prism-evals` result scorers/datasets/experiments | Bounded owner-scoped trace resolver, optional judge, report/gate | 2 | fake judge, trace cap, deterministic threshold failure | `evaluations.md`, `runs-and-usage.md` | offline eval gate |
| Batched ledger, snapshot cache, benchmarks | Serialized write-through `RunLedger`; repeated session rebuild | Optional flush/ack batch wrapper and leaf cache | 3 | order/crash/terminal flush/cache-read count benchmarks | `runs-and-usage.md`, `performance.md`, persistence pages | offline persistence + published bench |
| MCP tools/resources/prompts/roots/sampling/elicitation/notifications | Tool bridge, tool-list notification, server tools, stateless Streamable HTTP | SDK-pinned capability facades/session handling | 4 | fake SDK/server capability, session, origin, overflow matrix | `mcp-tools.md`, `resource-loading.md` | offline MCP conformance |
| Host-owned MCP OAuth/auth | `resolveAuthInfo`, authorizer, exact-origin pinned client transport | Exact request/session/ownership binding and host OAuth callback | 4 | wrong origin/session/owner/token-redaction cases | `mcp-tools.md`, `credential-storage.md`, `host-security.md` | secret scan + MCP conformance |
| A2A durable task/cancel/reconnect/rich parts/push | Text-only immediate session execution, bounded SSE, card verification | Host task lifecycle adapter, part mapping, bounded replay/push | 5 | fake lifecycle/card/task/reconnect/push matrix | `a2a.md`, `agent-session-runtime.md`, `workflows.md` | offline A2A conformance |
| Narrow web search/fetch/extract package | Tool dispatch, credentials, media SSRF bounds, bounded response reader | Optional direct-adapter package and normalized public result types | 6 | fake Brave/Exa/Firecrawl normalization/overflow/security matrix | `web-tools.md`, `tools.md` | pack/install + offline conformance |
| Citation identity and schema-validated untrusted external results | `ToolResult`, `ContentBlock`, resource/media bounds | Package-local citation/document/extraction contracts | 6 | citation/schema/prompt-injection fixtures | `web-tools.md`, `host-security.md` | offline web conformance |
| Official Exa/Firecrawl MCP prototype guidance only | Existing hardened MCP bridge | Documentation-only prototype boundary | 4, 6 | docs assertion: no generic remote passthrough | `mcp-tools.md`, `web-tools.md` | docs review |
| SAST/dependency/secret/SBOM/license/attestation/updates/live canaries | `release.yml` readiness, pack, provenance publish | Native GitHub security workflows and protected live jobs | 7 | workflow policy/negative secret/license/SBOM fixtures | `release-and-install.md`, `host-security.md` | required PR/release jobs |
| Reusable conformance and bounded performance evidence | Provider/session/tool/ledger helpers and 0.0.7 benchmark tables | Package-local protocol/web helpers plus Phase 3 benchmark script | 1–7 | each fake suite and dated benchmark output | `performance.md` | `sdk:ready` + documented live prerequisites |

## Primitive and caller inventory

| Primitive | Existing contract and callers | Phase 3 disposition |
| --- | --- | --- |
| `AgentEvent` | `src/agents.ts` emits provider/tool/guardrail/limit events; subscribers, `RunLedger`, OTel adapter consume them | Reuse as telemetry source. Task 1 adds parent/context only; no second event bus. |
| `RunLedger` / `RunLedgerRecord` | Four ordered append methods; `RuntimeAgentSession.ledgerChain` serializes appends; SQLite/PostgreSQL implement it | Task 3 may add one optional wrapper with flush/ack. Default remains write-through; no persistence schema. |
| `ProductionPersistenceStore` | Cursor/ownership-scoped `queryRuns`, `queryEvents`, `queryToolCalls`, `queryUsage`; optional checkpoints/leases/feedback | Task 2 reads a bounded host-selected trace. Task 5 adapts host lifecycle/checkpoints. No generic task table. |
| `RunLimits` / `RunLimitTracker` | Runtime/provider/tool limits charge before provider/tool work | Reuse for run work. Package-specific external operations get package-local finite limits until a second equal consumer exists. |
| Guardrails/redaction/permission/trust | `runGuardrails`, `dispatchToolCall`, `redact*`, `assertPermission`, `assertTrusted` | All tool/protocol/web outputs route through existing dispatch/redaction. No protocol-specific security bypass. |
| Durable agent/workflow state | `CheckpointStore`, `AgentRunLifecycle`, durable agent run state, workflow status/cancel | Task 5 projects host-selected lifecycle into A2A. No new worker/queue/runtime. |
| `ResourceLoader` | `loadTextResource`, `loadJsonResource`, `loadBinaryResource`; permission/trust context | Task 4 maps resources only through a narrow adapter; Task 6 does not pretend remote web fetch is a generic resource loader. |
| `CredentialResolver` | `resolveCredentialValue`, explicit/chained/env resolvers, OAuth store | Tasks 4–6 resolve at adapter request edge. Credentials never enter tool schemas/results/telemetry. |
| Media URL/SSRF primitives | `assertSsrfAllowedUrl`, address-pinned `requestUrl`, media MIME/byte/time bounds | Reuse policy/validation semantics. Generalize pinned transport only if Task 6 proves identical requirements with media and MCP; otherwise package-local provider fetch. |
| Provider transport | `readSseEvents`, `readBoundedResponseText`, bounded JSON argument parsing | Reuse bounded response/redaction semantics where shape fits. Do not force non-SSE vendor APIs through provider types. |
| Tool dispatch | `ToolDefinition`, registry, schema validation, permissions, guardrails, ledger, limit tracker | Web tools and mapped MCP tools use this path; models never choose adapter/provider credentials. |
| OTel adapter | Optional event projection with in-memory fixture and exporter-error isolation | Extend in place in Task 1; OTel API remains optional-package only. |
| Evals package | Immutable dataset, function scorer, bounded experiment pool, package-local store | Extend in place in Task 2; judge stays host callback, not core/provider dependency. |
| MCP package | Official SDK bridge, bounded tool discovery/result conversion, DNS-pinned Streamable HTTP, authorized server helper | Extend in place in Task 4; capability facades remain package-local. |
| Supervisor A2A package | Card/JWS, bounded JSON-RPC/SSE, exact-origin client | Extend in place in Task 5; task/push adapters remain package-local. |

### Core primitive decision

No new core primitive is authorized by Task 0. The only conditional candidates are:

1. **Trace-context carrier:** Task 1 may add one only if OTel, supervisor delegation, and another core consumer require the same dependency-free propagation shape.
2. **Flushable ledger capability:** Task 3 may add one only if one adapter wraps memory, SQLite, PostgreSQL, and host ledgers without changing `RunLedger` ordering.
3. **Pinned bounded HTTP request:** Task 6 may extract one only if media and web adapters use identical DNS-pinning, redirect, byte, abort, and error-redaction semantics.

Otherwise code stays in its optional package. One-consumer interfaces, vendor types, protocol vocabularies, and task queues are rejected.

## Frozen capability boundary

| Surface | Supported in 0.0.8 | Explicitly unsupported / deferred |
| --- | --- | --- |
| Telemetry | Optional OTel API adapter; agent/inference/tool/guardrail/delegation hierarchy; safe traces/metrics/evaluation events | Exporter registration, hosted backend, default content capture, per-delta spans, ID/content metric labels |
| Evaluations | Function scorers, bounded trace target, host-supplied judge, pairwise comparison, datasets, reports, threshold assertion | Mandatory LLM/provider, evaluation service/database, automatic production grading |
| MCP | Pinned-SDK tools/resources/prompts/roots/sampling/elicitation/notifications and Streamable HTTP only when SDK test proves each | Server discovery, arbitrary remote capability proxy, raw SDK callback/tool exposure, automatic OAuth/token forwarding |
| A2A | v1.0 JSON-RPC/HTTPS card/task/status/list/cancel/subscribe, rich parts, bounded replay, optional host push hook | gRPC, REST/HTTP+JSON binding, endpoint discovery, JWK fetching, second durable engine |
| Web tools | Host-selected Brave or Exa discovery; Firecrawl Markdown/schema extraction; direct native fetch adapters | Browser automation, vendor SDK dependency, model-selected provider, generic web/MCP passthrough |
| Release | Native CI security gates and scheduled/manual protected canaries | Secrets in PR/default jobs, public-network default tests, hosted security service |

## Frozen limits and charging points

Values in this table are target defaults/hard caps for later tasks, not active 0.0.7 APIs. Every count/byte/time/concurrency check happens before retaining data or starting the next request. Existing stricter package limits remain authoritative until changed with tests.

| Surface | Default / hard cap | Charge before | Owner |
| --- | --- | --- | --- |
| OTel active spans | one agent span per run; provider/tool/guardrail/delegation only from existing bounded run work | `startSpan`; no span for deltas | 1 |
| OTel content buffering | `0 / 0` by default | copying any prompt/content | 1 |
| Eval trace pages | `20 / 100` per record kind | next persistence page | 2 |
| Eval trace records | `1,000 / 5,000` events, tool calls, and usage records each | append snapshot item | 2 |
| Eval judge request/response | `256 KiB / 1 MiB` each | serialization/body retention | 2 |
| Eval judge attempts/time | `1 / 3`; `60 s / 30 min` | request attempt/timer | 2 |
| Eval worker concurrency | `1 / 32` (existing) | start worker | 2 |
| Ledger batch entries/bytes | `128 / 4,096`; `512 KiB / 16 MiB` | enqueue | 3 |
| Ledger batch delay/in-flight flushes | `25 ms / 1 s`; `1 / 8` | timer/flush dispatch | 3 |
| Snapshot cache | one current leaf snapshot per active session/run; no cross-session cache | store/reuse snapshot | 3 |
| MCP existing tool bridge | existing `20/100` pages, `500/5,000` tools, `4 MiB/16 MiB` aggregate schemas, `10 MB/16 MiB` result | page/schema/result retention | 4 |
| MCP resources/prompts | `20 / 100` pages; `500 / 5,000` items; `1 MiB / 8 MiB` item content | page/item conversion | 4 |
| MCP roots/sampling/elicitation | `32 / 128` roots; `32 / 128` messages; `64 KiB / 1 MiB` arguments/schema | callback/request dispatch | 4 |
| MCP HTTP sessions/replay | `128 / 1,024` active sessions; `1,024 / 10,000` replay events; `64 KiB / 1 MiB` event | session/replay allocation | 4 |
| A2A existing request/response/stream | `64 KiB/1 MiB` request/response; `64 KiB/1 MiB` event; `10 MiB/64 MiB` stream; `10k/100k` events | body/frame/event retention | 5 |
| A2A task pages/parts/artifacts | `100 / 1,000` tasks; `32 / 256` parts per message/artifact; `1 MiB / 8 MiB` raw/data part; `8 MiB / 64 MiB` aggregate artifacts | parse/decode/store/replay | 5 |
| A2A push | `32 / 256` registrations; `3 / 10` attempts; `30 s / 5 min` delivery | persist/deliver/retry | 5 |
| Web query/results/URLs | `4 KiB / 16 KiB`; `10 / 20` results; `5 / 20` URLs | request construction | 6 |
| Web provider request/output | `256 KiB / 1 MiB` request; `2 MiB / 16 MiB` response; `1 MiB / 8 MiB` Markdown; `256 KiB / 1 MiB` extracted JSON | request/body/output retention | 6 |
| Web schema/concurrency/time | `64 KiB / 256 KiB` schema; `4 / 16` active calls; `60 s / 30 min`; `2 / 4` retries | schema compile/call/retry | 6 |
| CI/live canaries | default suite `0` remote calls; protected live job one bounded scenario/provider | credential resolution/network call | 7 |

### Network and credential rules

1. Provider API origins are exact allow-lists and provider API redirects are rejected. Native `fetch` uses `redirect: "error"` or equivalent pinned transport.
2. A fetched target URL is absolute HTTP(S), has no userinfo, and passes the host’s public/private policy before sending it to Firecrawl. Firecrawl-side redirects are provider behavior; Prism does not claim DNS pinning after handing a URL to Firecrawl. Hosts that need that guarantee use a controlled fetch adapter instead.
3. MCP client requests pin a validated DNS address and reject redirects today; Task 4 extends session/auth behavior without weakening that boundary.
4. A2A and MCP authorization run on every request and bind exact origin, session, and ownership. Missing/foreign resources/tasks resolve as authorized-not-found, not disclosure.
5. Credentials are resolved immediately before adapter I/O, redacted in errors before ledger/export, excluded from tool inputs/outputs/telemetry, and never forwarded automatically between MCP/A2A/provider/web surfaces.
6. Search snippets, Markdown, HTML, extracted JSON, A2A artifacts, MCP resources/prompts, and remote protocol errors are untrusted data. They cannot modify system instructions, tools, permissions, credential selection, or provider routing.

## Web normalization and external-operation ownership

| Tool / adapter | Host-selected request | Normalized public output | Credential owner and redaction point |
| --- | --- | --- | --- |
| `web_search` / Exa | `POST https://api.exa.ai/search`; query plus explicitly requested bounded `contents` only | `title`, canonical `url`, bounded `snippet`/`highlights`, provider result ID, publication/retrieval time, provider/cost/rate metadata, citation identity | Adapter resolves `{ provider: "exa", name: "api_key" }` at request edge; redact key from headers, response/error, telemetry, and `ToolResult`. |
| `web_search` / Brave | `GET https://api.search.brave.com/res/v1/web/search`; query/count/offset only | Same normalized search result; source fields missing from Brave stay absent, never guessed | Adapter resolves `{ provider: "brave", name: "subscription_token" }` at request edge; redact `X-Subscription-Token` and all error echoes. |
| `web_fetch` / Firecrawl | `POST https://api.firecrawl.dev/v2/scrape`; one prevalidated public URL and Markdown format | `url`, canonical/source URL, bounded Markdown, selected metadata, retrieval time, provider/cost/rate metadata, `untrusted: true`, citation identity | Adapter resolves `{ provider: "firecrawl", name: "api_key" }` at request edge; redact bearer header/body/error echoes. |
| `web_extract` / Firecrawl | `POST https://api.firecrawl.dev/v2/extract`; bounded URL list plus host-supplied JSON Schema | Same document attribution plus schema-validated bounded JSON value and `untrusted: true` | Same Firecrawl resolver/redaction rule; schema/value never influence tool permissions or system instructions. |

`citationId` is deterministic: `web:<provider>:<providerResultId>` when provider returns a stable result ID, otherwise `web:<provider>:sha256(<canonicalUrl>)`. `canonicalUrl` removes fragment and normalizes only URL syntax; Prism does not follow target redirects to manufacture identity. Provider-specific fields remain under bounded metadata and never replace normalized fields.

| External operation | Authorization/credential owner | Required boundary |
| --- | --- | --- |
| OTel export | Host exporter SDK; Prism adapter receives tracer/meter only | Exporter failure isolated; Prism receives no exporter credential. |
| Model judge | Host-supplied judge callback | Judge receives bounded redacted evaluation target; no resolver/tools/workspace. |
| MCP HTTP/OAuth | Host auth resolver; Task 4 session binding | Every request binds exact origin/session/ownership; no token forwarding to model/tool content. |
| A2A invoke/card/push | Host authorizer/client auth/push delivery callback | Every task/push action is owner-scoped; card keys are explicitly pinned. |
| Web adapters | Host `CredentialResolver` or explicit callback | Exact provider API origin, no provider API redirects, late credential resolution. |
| Live canary | Protected CI environment only | Least-privilege key, redacted aggregate report, no PR/default-job secret. |

## Required test evidence by task

| Task | Network-free evidence | Restricted live evidence |
| --- | --- | --- |
| 1 | Parent graph, context, cleanup, semantic attributes, no-content/no-ID-label, exporter isolation | Host OTel exporter smoke only if configured |
| 2 | Fake trace reader/judge, redaction/cap/threshold/pairwise deterministic reports | Explicit host judge/model smoke |
| 3 | Fake ledger order/flush/crash/cache invalidation; reproducible local benchmark | PostgreSQL benchmark when service exists |
| 4 | Fake SDK/server capabilities, roots/resources/prompts/sampling/elicitation, sessions, auth/origin/SSRF/overflow | Configured MCP endpoint smoke |
| 5 | Fake lifecycle/card/push, rich parts, cancel/reconnect/replay/owner isolation | Configured A2A endpoint smoke |
| 6 | Fake Brave/Exa/Firecrawl normalization, schema, redirect/SSRF, credential/prompt-injection fixtures | Protected least-privilege Exa/Brave/Firecrawl smoke |
| 7 | Workflow policy, SBOM/license/attestation, secret-negative and skipped-canary tests | Scheduled/manual protected credentials only |

## Release evidence checklist

- `npm run sdk:ready`, Node 20/current import check, every workspace pack, packed offline consumer, `npm audit --audit-level=high`, tarball deny-list/secret check, and `git diff --check`.
- Focused OTel/eval/ledger/MCP/A2A/web fake-server conformance suites pass without public network.
- SAST, dependency review, secret scanning, SPDX SBOM/license policy, and artifact attestation jobs pass with pinned actions/minimal permissions.
- Protected live canaries either pass with least-privilege credentials or are recorded as an explicit release-host prerequisite; skipped canaries never make the default suite appear live-tested.
- Benchmarks publish machine/runtime, workload, p50/p95, throughput, memory, disk, cost metadata when supplied, backpressure observations, and no portability claim.

## Current exclusions

No browser, coding, Office, SaaS connector, hosted observability, generic proxy, provider SDK, remote discovery, automatic token forwarding, background task worker, or new core persistence schema is authorized by this phase. Those belong to later roadmap phases or require a new evidence review.
