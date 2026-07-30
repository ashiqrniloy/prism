# Review coverage — 2026-07-23 Phase 8

Working evidence for Plan 076 Task 0. Freezes Phase 8 / Release **0.0.13** scope, package names, primitive ownership, finite limits, external revisions, threats, tests, docs, and release gates before implementation.

**Evidence frozen:** 2026-07-23. **Prism source:** `5b21f78cde6c4f3c9e7760f153c4bd8670d104e4`. **Release target:** 0.0.13. **Default test rule:** network-free fakes, CLI fake executables, and protocol fixtures; cloud/provider/tenant live canaries remain explicit host/operator gates.

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current public contract covers the requirement. |
| `extend` | Owning task adds a generic reusable contract to an existing seam. |
| `new-package` | New optional workspace package; core stays free of product/cloud/CLI SDKs. |
| `compose` | Existing public primitives suffice; package-local wiring only. |
| `out-of-scope` | Later phase or deliberately unsupported; must not land in 0.0.13. |

## Frozen product decision

0.0.13 closes **enterprise identity, policy/audit, model governance, enterprise-cloud providers, server deployment seams, persistence lifecycle hooks, and least-privilege Microsoft 365 / Google Workspace connectors** only.

**Not in 0.0.13** (do not implement here):

| Deferred or rejected item | Owner / reason |
| --- | --- |
| Conversation storage/service, artifact co-work review API, personal memory consent UX, channel/device adapters | 0.0.14+ product scope. |
| Studio, hosted cloud, managed observability, visual workflow editor, broad Slack/Teams chat catalog | Demand-gated 0.1.x control-plane / product layer. |
| Local Office `.docx`/`.xlsx`/`.pptx` executable, SDK, wrapper, protocol, or runtime package | Product boundary; hosts may use external skills/tools. |
| User authentication database or identity provider inside Prism | Host/application owns auth; Prism accepts host-verified identity only. |
| Mandatory global policy engine, KMS, WORM store, queue broker, or container orchestrator | Host-replaceable seams; at most one reference adapter per seam. |
| Model-controlled M365/GWS command strings, generic Graph/Discovery requests, CLI login, tenant-admin commands, debug/telemetry dumps, credential-store access | Injection / over-privilege / secret-leakage risk. |
| Advertising Teams/Planner/To Do or Docs/Sheets/Slides as universal parity | Capability-gated only; Outlook/Gmail/calendar/files/tasks are the 0.0.13 common denominator. |
| Folding Azure/Bedrock/Vertex into consumer Anthropic/Google packages | Enterprise workload-identity and region/private-endpoint semantics differ. |
| Redis/SQS/other queue adapters by default | **Task 5 deferred:** no measured Postgres polling bottleneck recorded; keep coordinator poll path. |
| Putting work connectors or enterprise-cloud SDKs into `@arnilo/prism-code` / `@arnilo/prism-sdk` | Profiles stay lean; enroll only in `@arnilo/prism-all` unless size/adoption review revises this freeze. |

## Frozen external revisions

| Surface | Frozen reference | Compatibility decision |
| --- | --- | --- |
| Prism | `5b21f78cde6c4f3c9e7760f153c4bd8670d104e4` | Existing ownership/credential/permission/provider/server/persistence/lease seams inventoried below. |
| Node.js | Release support remains Node 20+ | Optional packages use Web `Request`/`Response`, `execFile`, abort, and existing bounded patterns; no framework dependency. |
| Microsoft Entra Agent ID | [Governing Agent Identities](https://learn.microsoft.com/en-us/entra/id-governance/agent-id-governance-overview); [What are agent identities?](https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities) | Informs `Principal`/`AgentIdentity` sponsor/owner/delegation/scope/expiry vocabulary. Prism does **not** embed Entra; hosts verify tokens/claims and supply identity context. |
| CLI for Microsoft 365 | [CLI for Microsoft 365 docs](https://pnp.github.io/cli-microsoft365/); npm `@pnp/cli-microsoft365`; GitHub `pnp/cli-microsoft365` | Host-installed execution adapter only. Prism ships hard-coded typed `execFile` argument templates; never `m365 login`, setup, tenant-admin, or model-built argv. |
| Google Workspace CLI | [googleworkspace/cli](https://github.com/googleworkspace/cli); npm `@googleworkspace/cli` (`gws`) | Host-installed execution adapter only. Discovery-dynamic surface is **not** exposed to models; Prism allow-lists typed operations, forces JSON/NDJSON parse bounds, disables interactive auth/debug from Prism. |
| Azure OpenAI / Foundry Entra auth | [Entra ID authentication for Azure OpenAI / Foundry Models](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity) | Host supplies late-bound workload credential callback (Managed Identity / token provider). No static keys in fixtures. |
| Azure private network | [Configure virtual networks for Foundry Tools](https://learn.microsoft.com/en-us/azure/ai-services/cognitive-services-virtual-networks) | Preserve custom subdomain / private-endpoint / VNet semantics on package config; do not rewrite endpoints. |
| Amazon Bedrock IAM | [Identity and access management for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html) | Host supplies AWS credential callback (IRSA / instance role / assumed role). Package never embeds long-lived keys. |
| Amazon Bedrock PrivateLink | [Interface VPC endpoints for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html) | Preserve region + optional VPC endpoint override; fail closed if residency policy rejects region. |
| Google Vertex / ADC | [Authenticate to Vertex AI (generative)](https://cloud.google.com/vertex-ai/generative-ai/docs/start/authenticate); [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) | Host supplies ADC/workload credential callback. Separate from `@arnilo/prism-provider-google` consumer API-key package. |
| OpenRouter routing metadata | Existing `openRouterRouting` compat fields; [OpenRouter provider docs](providers/openrouter.md) | Router may honor metadata only when policy/allow-list/residency permit; never bypass governance. |

## Frozen package and API contract

| Decision | Frozen choice |
| --- | --- |
| Core identity | Add `Principal`, `AgentIdentity`, `IdentityVerifier`, `assertIdentityActive`, `narrowIdentity` (names may alias but semantics frozen). Extend `OwnershipScope`; no identity database in core. |
| Policy package | New optional `@arnilo/prism-policy` with evaluator + decision ledger + cursor export; redacted/evidence-ref payloads only. |
| Model router | New optional `@arnilo/prism-model-router` as `ProviderResolver`-compatible facade over allow-list/residency/budget/rate/circuit/fallback. |
| Enterprise cloud providers | New optional `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, `@arnilo/prism-provider-vertex`. Keep `@arnilo/prism-provider-anthropic` and `@arnilo/prism-provider-google` separate. |
| Work connectors | New optional `@arnilo/prism-work-tools` with subpaths `./microsoft365` and `./google-workspace` only. |
| Server | Extend `@arnilo/prism-server` with optional health/readiness, host auth/rate-limit adapter hooks, graceful drain, event replay helpers, and worker/coordinator deployment contracts over existing leases. |
| Persistence lifecycle | Extend existing `RetentionPolicy` / production persistence seams with apply/delete/legal-hold/export hooks, optional host KMS/envelope callback, tenant quotas, and extension allow-list/signature policy. |
| Idempotency | Add a narrow generic side-effect `IdempotencyStore` (or equivalent) consumed by both connector subpaths; reuse session `idempotencyKey` patterns for inspiration, not as the connector store. |
| Profile manifests | New packages enroll in `@arnilo/prism-all` only. `@arnilo/prism-code` and `@arnilo/prism-sdk` stay free of work connectors and enterprise-cloud SDKs. |
| Release graph | Task 10 versions the graph to **0.0.13** and adds six publishable packages (**35 → 41** manifests: root + 40 under `packages/`). |
| Queues | Absent by default. Task 5 may add a queue adapter only with measured Postgres polling/load evidence recorded in Plan 076 Compromises/Further Actions and this page. |

### Frozen package names and subpaths

```text
@arnilo/prism-policy
@arnilo/prism-model-router
@arnilo/prism-provider-azure
@arnilo/prism-provider-bedrock
@arnilo/prism-provider-vertex
@arnilo/prism-work-tools
@arnilo/prism-work-tools/microsoft365
@arnilo/prism-work-tools/google-workspace
```

## Capability traceability matrix

| Phase 8 roadmap criterion | Existing surface | Minimum gap | Status / owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Authenticated `Principal` / `AgentIdentity` with tenant, sponsor/owner, delegated actor, scopes, credential refs, issued/expiry, revocation; immutable propagation | `OwnershipScope`, server `authorize`→ownership, run/tool/workflow ownership fields, OTel attributes | Core identity types + verifier seam + propagation asserts | `extend` / Task 1 | expired/revoked/wrong-tenant/widen-scope denial; MCP/A2A/server/tool/workflow/telemetry carry refs without secrets | `agent-identity.md`, host-security, public-contracts | offline core + package tests |
| Policy-decision ledger allow/deny/modify/approval + WORM export without unrestricted payloads | `GuardrailDecision`, `PermissionPolicy`, tool_approval interruption, run feedback immutability, redaction | Optional policy package + redacted store/export | `new-package` / Task 2 | attribution, version mismatch fail-closed, export pagination, payload rejection | `policy-and-audit.md` | offline package test |
| Model governance allow-list/residency/routing/fallback/circuit/retry/budget/rate + diagnostics | `ProviderResolver`, `ProviderRequestPolicy`, OpenRouter routing metadata, run budgets | Optional model-router facade + diagnostics | `new-package` / Task 3 | deny-before-call matrix; diagnostic redaction; OpenRouter gated by policy | `model-routing.md`, openrouter | offline package test |
| Azure / Bedrock / Vertex enterprise adapters with workload identity + region/private-endpoint | Provider package conformance, `CredentialResolver`, OpenAI-compatible patterns where applicable | Three provider packages + host credential callbacks | `new-package` / Task 4 | MI/IRSA/ADC mocks; region preserved; consumer Anthropic/Google unchanged | `providers/azure.md`, `bedrock.md`, `vertex.md` | offline + gated live canaries |
| Server health/readiness, auth/rate-limit adapters, drain, replay, worker/coordinator | `createPrismHandler`, authorize/ownership, leases/fencing, SSE/resume, `queryEvents` | Optional health/drain/replay/deployment helpers | `extend` / Task 5 | multi-process failover/drain/replay; unauthorized detail denial; queues absent by default | `server.md`, performance | offline multi-process fixtures |
| M365 + GWS identity-scoped tools (mail/calendar/files/tasks); Teams/Planner/To Do and Docs/Sheets/Slides capability-gated | `ToolDefinition`, tool approval, web-tools subpath pattern, coding-security `execFile` bounds | `@arnilo/prism-work-tools` subpaths + typed templates | `new-package` / Task 7 (M365), Task 8 (GWS) | fake CLI argv injection/schema/JSON bounds; capability mismatch; least scopes | `work-tools.md`, `work-connectors.md` | offline package test + gated tenant canaries |
| Draft-then-approve mutations; idempotent retries via operation/draft/resource IDs + concurrency tokens | tool_approval interruption, session `idempotencyKey`, checkpoints | Connector draft store + side-effect idempotency store | `extend` + `new-package` / Task 7, Task 8 | duplicate retry no-op; stale ETag fail; send only after approval | work-tools docs | offline fixtures |
| Hard-coded CLI `execFile` templates only; no model command/login/admin/debug/credential access | coding-security sandbox `execFile`, credential redaction | Package-local template registry + isolated config dirs | `compose` / Task 7, Task 8 | forbidden argv/env denial; credentials never in argv/model context | work-connectors, credential-storage, host-security | offline hostile argv tests |
| Retention/deletion/legal-hold/export, optional KMS/envelope, extension allow-list/signature, tenant quotas | `RetentionPolicy`, feedback delete, credentials-node envelope crypto, extension kernel trust | Persistence lifecycle + extension signature/allow-list + quota hooks | `extend` / Task 6 | hold blocks delete; unsigned extension deny; quota contention; key rotation mock | database-persistence, host-security, extensions | offline store + extension tests |
| Bounded performance for identity/policy/router/connectors/deployment | Existing server/web-tools/persistence limits | Frozen caps below + benchmarks | `compose` / Tasks 1–8, 10 | hostile overflow; network-free benchmarks | performance, review page | `sdk:ready` + benchmark |
| Narrow optional contracts; no mandatory control plane | Product boundaries; profile packaging | Package/profile guards | `compose` / Tasks 0, 9–10 | pack graph 41; prism-code/sdk free of connectors/cloud SDKs | release-and-install, migration | pack/install + diff review |
| Security fail-closed: verified identity, narrow delegation, late-bound creds, least privilege, approvals, share/attachment/residency policy | host-security checklist, redaction, permission/trust | Threat matrix enforcement in owning tasks | `compose` / all tasks | negative tests per threat row | host-security + task docs | security review before publish |

## Primitive and caller inventory

| Primitive / symbol | Existing contract and callers | Phase 8 disposition |
| --- | --- | --- |
| `OwnershipScope` (`tenantId`/`accountId`/`userId`) | Persistence records, tools, agents, server authorize result, workflows, leases | **Extend** with authenticated identity context that still projects to ownership; never replace ownership checks. |
| `CredentialResolver` / OAuth store / credentials-node envelope | Late-bound secrets; encrypted vault/keychain | Reuse. Enterprise cloud + connectors resolve via host callbacks; secrets never in CLI argv or model context. |
| `PermissionPolicy` / `TrustPolicy` | Tool/extension/resource checks | Reuse at connector and extension boundaries; optional policy package may record decisions. |
| `ProviderRequestPolicy` / `ProviderResolver` | Provider request mutation and model→provider resolution | Reuse. Model-router wraps resolver; request policies remain chainable. |
| Guardrails + `tool_approval` interruption | `createSecureAgent`, agent loop durable suspend | Reuse for connector mutation approvals; do not invent a second approval runtime. |
| Run ledger / feedback / `AgentEventRecord` | Durable redacted run evidence | Reuse for attributable diagnostics refs; policy ledger stays separate schema. |
| Checkpoints / leases | Durable interruption and multi-process fencing | Reuse for drain/worker/coordinator and connector draft durability where applicable. |
| `RetentionPolicy` (+ query on production stores) | Stored policy rows; limited apply semantics today | **Extend** with apply/delete/legal-hold/export/quota hooks. |
| Server `authorize` → ownership | `@arnilo/prism-server` every route | **Extend** optional health/rate-limit/drain/replay; ownership still only from authorize. |
| OTel / observability package | Span/metric export | Propagate identity refs as redacted attributes; no secret material. |
| Supervisor / A2A / MCP | Delegation and remote tool bridges | Accept verified identity; refuse cross-tenant widening. |
| coding-security `execFile` / sandbox bounds | Sandbox FS/shell | Pattern reuse for CLI adapters (typed args, caps, kill); not a coding-workspace dependency for work-tools. |
| web-tools subpath packaging | `@arnilo/prism-web-tools/{brave,exa,firecrawl}` | Copy packaging pattern for work-tools subpaths. |
| Session `idempotencyKey` | Session append dedup | Inspiration only; connectors need a side-effect idempotency store keyed by identity+operation. |

### Primitive decision

**Authorized generic core extensions (each needs ≥2 consumers):**

1. Authenticated identity contracts + attach/assert/narrow helpers (consumers: server, tools, workflows, MCP, A2A, telemetry, connectors, providers/router).
2. Side-effect `IdempotencyStore` contract (consumers: M365 + GWS; optional future connectors).
3. Retention/legal-hold/export/quota persistence hooks (consumers: sqlite + postgres production stores; memory may unsupported/explicit).
4. Extension allow-list / signature policy seam on the extension kernel (consumers: host loaders + contribution discovery).

**Authorized new packages:** `@arnilo/prism-policy`, `@arnilo/prism-model-router`, `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, `@arnilo/prism-provider-vertex`, `@arnilo/prism-work-tools` (`./microsoft365`, `./google-workspace`).

**Authorized package/server extensions:** health/drain/replay/deployment helpers on `@arnilo/prism-server`; optional KMS/envelope callback wiring via credentials-node patterns without forcing cloud KMS SDKs into core.

**Rejected:** auth DB; control plane; Office packages; model-controlled CLI; merging enterprise cloud into consumer Anthropic/Google; mandatory queues; putting connectors/cloud SDKs into `prism-code`/`prism-sdk`; protocol/UI frameworks in core.

## Frozen finite limits and charging points

**Rule:** validate every untrusted field before persistence, provider call, CLI spawn, or export enqueue. Owning tasks may tighten defaults but must not raise hard caps without updating this page, tests, and docs.

### Identity / policy

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Scopes per identity | 64 / 256 | Before verify/narrow/attach | Task 1 rejects. |
| One scope string | 128 B / 512 B | Before verify/narrow | Task 1 rejects. |
| Identity metadata map | 4 KiB / 16 KiB | Before persistence/telemetry attach | Task 1 omits/rejects; never stores secrets. |
| Credential reference string | 256 B / 2 KiB | Before attach | Task 1 rejects; never expands to secret. |
| Policy decision record | 8 KiB / 64 KiB | Before ledger append | Task 2 rejects unrestricted payloads. |
| Evidence ref / reason | 1 KiB / 8 KiB each | Before append/export | Task 2 truncates with marker or rejects. |
| Policy export page | 100 / 500 | Before export cursor read | Task 2 pages; no full scan. |
| Identity/policy CPU path | sync O(fields); 0 network in core helpers | Before tool/provider work | Tasks 1–2 fail closed locally. |

### Model router

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Resolve attempts (including fallbacks) | 3 / 8 | Before each provider resolve | Task 3 stops; emits attributable deny. |
| Concurrent circuit keys retained | 1,024 / 16,384 | Before circuit state insert | Task 3 evicts oldest or rejects new key. |
| Diagnostics record | 8 KiB / 64 KiB | Before audit/telemetry | Task 3 redacts; no secrets/raw prompts. |
| Token/cost budget fields | finite non-negative; host units | Before provider call | Task 3 denies when exhausted. |
| Rate-limit window memory | per identity+model key; capped with circuit keys | Before admit | Task 3 denies with retry hint bounded. |

### Work connectors (per tool invocation)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Pagination pages | 20 / 100 | Before next-page CLI/API call | Task 7 / Task 8 stop with partial+cursor or error. |
| Items per page / aggregate items | 50 / 500; 200 / 2,000 | Before parse/accumulate | Task 7 / Task 8 reject/truncate with marker. |
| Request/response body | 256 KiB / 2 MiB | Before spawn/parse | Task 7 / Task 8 kill/reject. |
| Attachment / file bytes | 5 MiB / 25 MiB; 10 MiB / 50 MiB | Before upload/download/scan | Task 7 / Task 8 deny; scan hook required for inbound. |
| CLI stdout/stderr capture | 2 MiB / 16 MiB | While reading pipes | Task 7 / Task 8 abort process. |
| Process wall time | 60 s / 10 min | Spawn abort signal | Task 7 / Task 8 kill process tree best-effort. |
| Concurrent CLI processes / identity | 2 / 8 | Before spawn | Task 7 / Task 8 queue-reject. |
| Retries for idempotent ops | 2 / 4 | Before retry | Task 7 / Task 8 require idempotency key. |
| Rate / cost counters | finite host ceilings | Before mutation | Task 7 / Task 8 deny. |
| Operation/draft/idempotency key | 256 B / 2 KiB | Before store write | Task 7 / Task 8 reject. |

### Server deployment / persistence lifecycle

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Health/readiness response | 4 KiB / 64 KiB; no tenant payloads by default | Before serialize | Task 5 redacts. |
| Drain admit cutoff | 30 s / 5 min | After drain flag | Task 5 rejects new admits; in-flight use existing timeouts. |
| Replay page rows / cursor | 100 / 500; 4 KiB / 16 KiB | Before `queryEvents` | Task 5 pages; authorize+ownership required. |
| Publish/capacity concurrent runs | reuse server 16 / 256 | Existing handler | Task 5 documents; does not raise hard caps. |
| Tenant quota counters | finite host ceilings per resource class | Before persist/spawn | Task 6 denies with attributable reason. |
| Envelope/KMS payload | reuse credentials-node envelope file caps (4 MiB / 16 MiB) | Before encrypt/decrypt | Task 6 rejects; host KMS timeout bounded (60 s hard). |

**Forbidden:** unbounded CLI output, model-built argv, credential-in-argv, unrestricted policy payload store, uncapped router fallback loops, raising hard caps silently, default queue broker, Office binary packaging.

## Work-connector capability freeze

| Workload | 0.0.13 status | Notes |
| --- | --- | --- |
| Outlook / Gmail search, read, draft, approved send | supported common denominator | Draft durable before send; external-recipient policy fail closed. |
| Calendar list/create/update | supported common denominator | Idempotent create/update with provider concurrency tokens. |
| OneDrive/SharePoint / Drive files search/read/upload/move/share | supported common denominator | Share external targets policy-gated; attachment caps apply. |
| Tasks list/create/complete | supported common denominator | Provider-specific task systems mapped to shared result shapes where possible. |
| Teams / Planner / To Do | capability-gated optional | Not advertised as universal parity; absent capability → explicit unsupported. |
| Docs / Sheets / Slides cloud ops | capability-gated optional | Same; no local Office execution implied. |
| CLI login / setup / tenant-admin / debug / credential export | unsupported from Prism | Host may run outside Prism; tools must deny if invoked. |
| Generic Graph or Discovery passthrough | unsupported | Hard-coded templates only. |

## Threat and authority matrix

| Boundary | Trusted authority | Untrusted input | Mandatory control | Default / unsupported |
| --- | --- | --- | --- | --- |
| Identity claims | Host `IdentityVerifier` | Caller headers/body identity fields | Verify before attach; expiry/revocation/tenant checks | Caller-asserted identity unsupported. |
| Delegation | Parent verified identity | Requested child scopes | `child.scopes ⊆ parent.scopes`; tenant immutable | Scope widening / tenant swap unsupported. |
| Credentials | Host resolver / workload callback / CLI config dir | Model text, tool args, env dumps | Late-bound resolve; never argv/model/context; per-identity isolated config | Credential discovery from model unsupported. |
| Policy decisions | Host policy + ledger | Action/resource context | Redact; store evidence refs; version pin | Unrestricted prompt/tool body in ledger unsupported. |
| Model routing | Allow-list + residency + budgets | Model id, OpenRouter metadata | Deny before provider call on miss/exhaustion | Bypass router via metadata unsupported when policy attached. |
| Cloud providers | Host workload identity | Endpoint/region overrides | Preserve private-endpoint/region; mock-only offline | Static keys in repo/fixtures unsupported. |
| Server health/replay | Authorize + ownership | Health query detail flags, replay cursors | Minimal health by default; ownership-scoped replay | Anonymous tenant dump unsupported. |
| Connector CLI | Hard-coded templates + host binary pin | Model-suggested command/args | `execFile` argv from template only; version/schema validate at start | Model command, login, admin, debug unsupported. |
| Mutations | Durable draft + tool_approval + idempotency store | Retry storms, stale ETags | Draft→approve→send; concurrency token; dedupe | Blind send/share/delete unsupported. |
| Attachments / shares | Host scan + recipient policy | Files, external recipients | Cap bytes; scan hook; external deny-by-default | Unscanned inbound / open external share unsupported. |
| Extensions | Allow-list + signature policy | Unsigned packages | Fail closed when policy enabled | Unsigned load when enterprise policy on unsupported. |
| Retention / legal hold | Host hold + retention policy | Delete requests | Hold blocks delete/export rules per policy | Silent purge under hold unsupported. |

## Validation matrix for Task 0

| Check | Frozen assertion |
| --- | --- |
| Traceability | Every Phase 8 roadmap Functional/Performance/Code Quality/Security criterion has one primary Task 1–10 owner; 0.0.14 conversations/artifacts/channels/devices and 0.1.x Studio/control-plane have none. |
| Package names | Exact names/subpaths listed above; 35 → 41 manifests at release; new packages only in `prism-all`. |
| Primitive reuse | Only identity, side-effect idempotency, retention/hold/export/quota, and extension signature/allow-list are authorized generic core/extension gaps; each needs ≥2 consumers. |
| CLI boundary | M365/GWS adapters are hard-coded templates via `execFile`; no model-controlled command surface. |
| Cloud separation | Azure/Bedrock/Vertex packages distinct from consumer Anthropic/Google. |
| Finite resources | All identity/policy/router/connector/deployment caps above are enforced by owning tasks. |
| Security | Host-verified identity, narrow delegation, late-bound credentials, draft-then-approve, fail-closed residency/share/attachment/extension/hold policy. |
| Queues | **Deferred after Task 5:** no Redis/SQS adapter. Postgres/`createWorkflowCoordinator` checkpoint polling remains default; revisit only with measured polling/load evidence. |


## Documentation and release ownership

- Task 0: this evidence page, `docs/index.md`, and `docs.test.ts` regression guard.
- Task 1: identity contracts + propagation docs (`agent-identity.md` and cross-links).
- Task 2: `@arnilo/prism-policy` + `policy-and-audit.md`.
- Task 3: `@arnilo/prism-model-router` + `model-routing.md`.
- Task 4: azure/bedrock/vertex provider packages + provider docs.
- Task 5: server deployment seams + `server.md` / performance notes.
- Task 6: retention/KMS/quotas/extension signature docs + persistence/security pages.
- Task 7: `@arnilo/prism-work-tools/microsoft365` + shared work-tools contracts.
- Task 8: `@arnilo/prism-work-tools/google-workspace` + shared result-shape parity docs.
- Task 9: canonical docs, examples, migration, index navigation.
- Task 10: 0.0.13 graph, benchmarks, pack/install, supply-chain, dry-run publish, roadmap completion evidence.

No public implementation API changes land in Task 0. This page, `roadmap.md` Phase 8, and Plan 076 are authoritative until implementation; later tasks may tighten defaults but cannot widen scope, raise hard caps, add Office packages, embed an auth DB/control plane, expose model-controlled CLI, merge enterprise cloud into consumer Anthropic/Google, or enable default queues without updating this evidence, tests, docs, and plan.
