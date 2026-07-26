# Review coverage — 2026-07-25 Phase 9

Working evidence for Plan 077 Task 0. Freezes Phase 9 / Release **0.0.14** scope, package ownership, primitive inventory, finite limits, capability/consent token shapes, replay semantics, threats, tests, docs, and release gates before implementation.

**Evidence frozen:** 2026-07-25. **Prism source:** `56692ad8ab8d05dce2d5a08f29ad768a8b43e0af`. **Release target:** 0.0.14. **Publishable graph:** 41 → 43 manifests (exactly two new provider packages authorized — `@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-ollama` — added before version completion per user request; no other new packages). **Default test rule:** network-free fakes and protocol fixtures; M365/GWS OAuth, Playwright, PostgreSQL/keychain live canaries remain explicit host/operator gates.

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current public contract covers the requirement. |
| `extend` | Owning task adds a generic reusable contract to an existing seam. |
| `compose` | Existing public primitives suffice; package-local wiring only. |
| `out-of-scope` | Later phase or deliberately unsupported; must not land in 0.0.14. |

## Frozen product decision

0.0.14 adds **durable personal/work-agent conversations, memory consent/lifecycle, artifact co-work review, AG-UI co-work events, scoped OAuth connector establishment, and browser/device composition gates** — all as extensions of shipped packages. Roadmap gate 8 is binding: channel/device/co-work features remain optional and cannot broaden user consent, memory, network, file, browser, connector, or tool permissions; they reuse the AG-UI adapter shipped in 0.0.12.

**Not in 0.0.14** (do not implement here):

| Deferred or rejected item | Owner / reason |
| --- | --- |
| Studio, hosted cloud, managed observability, chat product UI | Demand-gated 0.1.x; hosts own UI chrome. |
| Slack/Teams or broader chat channel catalog | Deferred until web/AG-UI demand is measured (roadmap Phase 9). |
| Realtime voice vendor packages and desktop OS control vendor packages | Contracts + deny-by-default conformance only in 0.0.14; vendor implementations demand-gated 0.1.x. |
| Local Office executable/SDK/wrapper/runtime for artifact previews | Outside Prism product scope; previews/edits stay host-owned. |
| `WorkAgent` or second work-agent runtime, second memory runtime, second event system | Compose ordinary agents over sessions/workflows/tools; extend AG-UI, memory, server in place. |
| Artifact file-body blob store | Prism persists bounded metadata/hashes/refs; hosts own blob storage and rendering. |
| Serialized browser internals (cookies/localStorage/context) in checkpoints | Checkpoints persist verified URLs/domain state + host data refs only. |
| Permission broadening of any kind (consent/memory/network/file/browser/connector/tool) | Forbidden by roadmap gate 8; regression-guarded in Task 8. |
| Always-on proactive agent or push daemon | Schedules require explicit user enablement + revocable capability tokens; host transports consume replay streams. |
| Cross-identity token fallback, model-selected OAuth scopes, credentials in argv/model context | Unsupported; per-identity isolation and host-pinned least-privilege scope maps only. |

## Frozen external revisions

| Surface | Frozen reference | Compatibility decision |
| --- | --- | --- |
| Prism | [`56692ad8ab8d05dce2d5a08f29ad768a8b43e0af`](../plans/077-release-0-0-14-personal-work-agent-conversations-co-work-review-channels.md) | 0.0.13 graph (41 manifests → 43 at 0.0.14 with provider packages alibaba/ollama); conversation/artifact/memory/AG-UI/connector/device seams inventoried below. |
| Node.js | Release support remains Node 20+ | Delivery-link/token signing uses node `crypto` HMAC via host key material; no new runtime dependency enters core. |
| AG-UI | `@ag-ui/core` **0.0.57** (pinned in `packages/ag-ui/package.json`); [Events](https://docs.ag-ui.com/concepts/events), [State](https://docs.ag-ui.com/concepts/state), [Interrupts](https://docs.ag-ui.com/concepts/interrupts) | Co-work events ride official `CUSTOM`/state extension points; produced events still validate with `EventSchemas`; no fork of the 0.0.12 mapper. |
| ACP | `@agentclientprotocol/sdk` **1.3.0** stable root | `./acp` sibling gains co-work parity only where stable `session/update` contracts overlap; no experimental v2. |
| Microsoft Graph OAuth | Current Microsoft identity platform / Graph permission docs at implementation time (delegated `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite`, `Tasks.ReadWrite` family) | PKCE auth-code flow via existing `OAuthProvider` seam; delegated least-privilege scopes only; no application-permission defaults. |
| Google Workspace OAuth | Current Google OAuth 2.0 / Gmail-Calendar-Drive scope docs at implementation time (`gmail.readonly`/`gmail.send`, calendar, drive scopes) | Same seam; incremental consent per bundle; no broad `*` scopes. |
| Playwright | Version pinned by `@arnilo/prism-browser` at 0.0.13 | Checkpoint/resume-verify seam composes existing manager/policy; no new browser engine. |

## Frozen package and API contract

| Decision | Frozen choice |
| --- | --- |
| Release graph | **41 → 43 manifests.** Exactly two new provider packages (`@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-ollama`) authorized per user request before version completion; no other new packages. All Phase 9 surface extends `@arnilo/prism` (types only), `@arnilo/prism-server`, `@arnilo/prism-memory`, `@arnilo/prism-ag-ui` (+`/acp`), `@arnilo/prism-credentials-node`, `@arnilo/prism-work-tools`, `@arnilo/prism-browser`, `@arnilo/prism-workflows`, and the sqlite/postgres session stores. A split (e.g. `@arnilo/prism-conversations`) is authorized only if Task 1/3 records measured size/cohesion evidence, never speculatively. |
| Conversation service | Core exports conversation **types only** (`ConversationThread`, thread state `active \| archived`, replay cursor, request-id idempotency). `@arnilo/prism-server` adds `createConversationService({ sessions, authorize, limits })` with create/list/continue/branch/archive/export/delete. A thread is an ownership-scoped session branch + metadata; `continue` resumes via `resumeAgentRunStream()` + checkpoint CAS so completed tool calls never rerun. |
| Replay semantics | Cursor = opaque ownership-scoped `{ threadId, lastEventSeq }`; pages durable redacted rows via `queryEvents`, then attaches to the live bounded subscriber (0.0.12 pattern); at-least-once across the page/live boundary with stable event/message/tool IDs for client dedup; terminal replay never invokes a provider or tool; gaps detected and recoverable. |
| Memory consent/lifecycle | `@arnilo/prism-memory` extends records with `consent: { source, scope, visible, grantedAt?, revokedAt? }` over the existing `MemoryScope` (`source` user/agent/system; `scope` thread/profile/user maps to user/profile/thread controls; no new scope axis). The single `recall()` gate enforces consent+visibility at assembly time (O(1) per record), covering direct recall and `createContextProvider()` injection; `requireConsent` strict mode also drops consent-less entries. `setConsent`/`correct`/`forget`/`applyRetention` lifecycle APIs (real deletes, bounded batches); conformance covers vector + working stores (in-memory + PostgreSQL/pgvector adapters). |
| Proactive capability | `packages/workflows` gains `createProactiveScheduleCapabilities`: frozen token `{ tokenId, scheduleId, workflowId, scope, actor, createdAt, expiresAt, revoked, revokedAt?, version }` (TTL 24h/31d, record ≤ 16 KiB). Revocation marks the token revoked and pauses the underlying schedule so `pollOnce` never fires it; `assertActive` fails closed on missing/revoked/expired for manual trigger paths. `onCapability` events (redacted actor refs) bridge to `@arnilo/prism-policy`. No schedule runs without an explicit grant. |
| Artifact service | Core exports artifact **types only** (`ArtifactRecord`, `ArtifactRevision`, `ArtifactApproval`, approval state `pending \| approved \| rejected`, `ArtifactDeliveryToken`). `@arnilo/prism-server` adds `createArtifactService(store: CheckpointStore, { redactor, linkSecret, limits, onDecision })` + `createArtifactHandler`: attach/revise/compare/approve/reject/lastValidated/deliveryLink. Records persist as versioned checkpoint values (namespace `prism.artifact`, key `threadId:artifactId`); the checkpoint version is the CAS counter for concurrent reviewers (no lost approvals), revision numbers/approvals/`lastValidatedVersion` live in the JSON value — no separate artifact schema/migration. Compare is hash+metadata-bounded (exactly 2 revisions per call; hosts render content). Delivery links are `base64url(payload).base64url(HMAC-SHA256)` over `{ artifactId, threadId, version, ownership, issuedAt, expiresAt }`, reauthorized per download. Local filesystem paths rejected; records redacted before persist/response. Persistence stores records/revisions only — never file bodies. |
| AG-UI co-work | `packages/ag-ui` extends (not reimplements) `ag-ui-mapper.ts`, `projection.ts`, `handler.ts`, `replay.ts`, `types.ts` with co-work events: `artifact.progress`, `artifact.approval.requested`, `draft.connector.pending`, `browser.snapshot` (redacted), `artifact.download.link` (expiring token). `AgUiEventMapper.mapCoWork()` (+ ACP `mapCoWork()` parity) validate/host-project/redact/byte-cap each event into a named `CUSTOM` event (malformed/oversized fail closed to nothing); shared `projectCoWorkEvent()` keeps one projection path. `createAgUiHandler` accepts `coWorkContext` (`{ threadId, artifactId, identity }`) + a durable `coWork` source (`createCoWorkReplay()`) and appends one bounded redacted page after the run. Default-deny projection from 0.0.12 stands: no local paths, raw tool args/results, or secrets. |
| OAuth connectors | `packages/credentials-node` adds a shared `createOAuth2Provider()` (PKCE auth-code + device-code + refresh + revoke, redacted errors) behind `createMicrosoft365OAuthProvider()` / `createGoogleWorkspaceOAuthProvider()` over the existing `OAuthProvider` seam (Codex pattern); least-privilege scope bundles per capability via `resolveMicrosoft365Scopes` / `resolveGoogleWorkspaceScopes` (read vs mutation; unknown capability fails closed). Core gains optional `OAuthProvider.revoke?` + `revokeOAuthCredential()` (best-effort upstream + mandatory local store delete; GWS RFC 7009, M365 no public endpoint so local delete is the fail-closed boundary). `createOAuthWorkTokenProvider()` bridges stored credentials to a per-identity connector env var: late-bound single-flight refresh, and missing/expired/revoked/cross-identity/wrong-tenant tokens fail closed. `packages/work-tools` adapters accept an optional `tokenProvider` and inject the token via per-exec env — never argv/model context; login UX host-owned. |
| Browser composition | `packages/browser` adds `createBrowserCheckpointLedger()` persisting `{ url, domainStateHash, hostDataRef }` only — never cookies/localStorage/serialized context (frozen caps: URL 8 KiB/16 KiB, hash 256 B/1 KiB, ref 2 KiB/8 KiB, 16/64 checkpoints per run, oldest evicted). `markResumed(runId)` marks state stale after resume/interruption; `assertVerifiedBeforeSideEffect(runId)` fails closed until the host reloads + `verify()`s, so side effects never replay on stale state. Checkpoints are run-scoped: a conversation thread composes through the run it owns, consuming shared `RunLimits` and existing sandbox/egress/secret-injection/approval policy. |
| Device adapters | Core (`src/devices.ts`) adds a minimal `DeviceAdapter` contract + deny-by-default `resolveDevicePolicy()` / `assertDeviceAdmit()` (types + policy only; compose over `PermissionPolicy`, `RunLimits`, redactor). Admission fails closed without explicit `enabled`, an explicit sandbox, approval (when required), an under-budget session count (1/4), and shared `RunLimits`; `acceptDeviceChunk()` drops oversize stream chunks (1 MiB/8 MiB) with a marker; `redactDeviceTelemetry()` redacts before emit/persist; `runDevicePolicyConformance()` is the conformance pair (denial/approval/session-budget/run-accounting/stream-bounds/redaction) for future vendor adapters. No vendor voice or desktop OS control package ships in 0.0.14 (demand-gated 0.1.x). |
| Profile inclusion | No profile changes needed: server/memory/ag-ui/work-tools/browser/credentials-node already enroll per 0.0.12–0.0.13 rules; `prism-code`/`prism-sdk` stay protocol/connector-free. |

## Capability traceability matrix

| Phase 9 roadmap criterion | Existing surface | Minimum gap | Status / owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Durable conversation service: create/list/continue/branch/archive/export/delete user-scoped threads | Session branches + `checkout`, `idempotencyKey` append dedup, `queryEvents` paging, server `authorize`→ownership, `AgentIdentity` | Thread metadata seam on stores + conversation service on server | `extend` / Task 1 | create/continue/branch/archive/export/delete; wrong-user denial; duplicate request-id idempotency; export redaction | `conversations.md` (new), server, session-stores | offline store + server tests |
| Reconnect/replay bounded ordered events without rerunning completed work | `resumeAgentRunStream()`, `AgentRunLifecycle.resumeStream`, 0.0.12 durable-resume page→live pattern, checkpoints/CAS | Ownership-scoped thread replay cursor + gap recovery | `compose` / Task 1 | cursor resume; event-gap recovery; tool-call count invariant across reconnect; backpressure | conversations, ag-ui | offline integration |
| Memory consent/source/visibility/correction/retention/deletion, per-user/profile/thread controls | `MemoryScope` (tenant/account/user/thread), vector + working stores, `runMemoryConformance`, `assertFiniteVector` | Consent fields + injection filter + lifecycle APIs | `extend` / Task 2 | grant/revoke/correct/delete/retention per scope; revoked/invisible absent from assembled requests/events/exports; cross-user denial | working-and-semantic-memory, host-security | offline conformance |
| Proactive schedules/events require explicit enablement + revocable capabilities | `createWorkflowSchedules`, workflow suspend/approve, `assertIdentityActive`, policy ledger | Capability token verified at fire time + revocation fail-closed | `extend` / Task 2 | enable/revoke; revoked token fails closed at fire; audit record; no default-on schedule | workflows, policy-and-audit | offline fixtures |
| Durable artifact service: MIME/hash/version, producer run, citations, preview metadata, approval state, delivery; compare/request-changes/approve/reject; last-validated recovery | Workflow `tool_approval` interruption, persistence lifecycle (0.0.13 v5), `ResourceLoader`, Plan 076 `IdempotencyStore` + draft-then-approve pattern | Artifact record/revision/approval/delivery seam on persistence + server | `extend` / Task 3 | attach/revise/compare/approve/reject; CAS reviewer conflict; failed-update rollback; last-validated recovery; local-path redaction | `work-artifacts-and-review.md` (new), server, persistence pages | offline store + server tests |
| AG-UI maps browser snapshots, connector drafts, approvals, progress, authorized artifact download links into reconnectable co-work events; no local paths | `createAgUiEventMapper`/`createAgUiHandler`/`createPersistenceAgUiReplay`, default-deny projection, `@ag-ui/core` 0.0.57 `EventSchemas` | Co-work event types + thread/artifact-scoped handler input | `extend` / Task 4 | mapping round-trips; disconnect/resume; overflow/backpressure; malformed client event; redaction | ag-ui, work-artifacts-and-review | offline package test |
| OAuth connector flows establish scoped M365/GWS credentials for Outlook/Gmail workloads; Slack/Teams deferred | `OAuthProvider`, `refreshOAuthCredential`, `createOAuthCredentialStoreAdapter`, Codex PKCE pattern, work-tools identity wiring | M365/GWS OAuth adapters + least-privilege scope maps + revocation | `extend` / Task 5 | establish/refresh/revoke; token redaction; cross-identity isolation; least-scope per bundle; no Slack/Teams artifact | credential-storage, work-connectors | offline + gated OAuth canaries |
| Voice/desktop adapters optional, isolated, approval-aware, observable, disabled by default; browser tools compose via existing policy | `PermissionPolicy`, `RunLimits`, `tool_approval`, redactor, browser sandbox/egress policy | `DeviceAdapter` contract + deny-by-default policy + conformance; browser checkpoint/resume-verify | `extend` / Task 6 | denial-by-default; approval gate; stream bounds; side-effect non-replay; checkpoint reload/verify; redacted telemetry | browser-automation, host-security, migration | offline conformance |
| Finite byte/time/rate/version limits + reconnect backpressure everywhere; review/browser loops consume shared budgets | Server/SSE/subscriber/persistence limits, `RunLimits`, package limit resolvers | Frozen caps below + `scripts/benchmark-0.0.14.mjs` | `compose` / Tasks 1–6, 8 | hostile overflow fixtures; network-free benchmark schema/budgets | performance, review page | `sdk:ready` + benchmark |
| Conversation/artifact APIs reuse sessions/branches/checkpoints/events/server/resources; AG-UI extended not reimplemented; no second runtime | All seams above | Package/profile guards | `compose` / Tasks 0, 7–8 | 41 → 43 pack graph (alibaba/ollama providers only); no `WorkAgent`/second-memory/second-event export; prism-code/sdk stay protocol-free | release-and-install, migration | pack/install + diff review |
| Authenticated identity owns every thread/memory/artifact/connector/browser/device action; consent/permission rechecked; links authorized+expiring; tokens/paths/secrets/document-private data never leak | `AgentIdentity`/`IdentityVerifier`, `ownershipFromIdentity`, redactor, policy ledger | Threat matrix enforcement in owning tasks | `compose` / all tasks | negative test per threat row; permission-non-broadening regression | host-security + task docs | security review before publish |

## Primitive and caller inventory

| Primitive / symbol | Existing contract and callers | Phase 9 disposition |
| --- | --- | --- |
| Session branches: `checkout(leafId)`, leaf entries, branch ancestor paging (`src/contracts.ts`) | Session stores (jsonl/sqlite/postgres), `SessionIndex` search hits return `leafId` | **Extend** with thread metadata (title/state/owner) keyed to a branch; thread = branch, not a second tree. |
| `SessionIndex` (`src/contracts.ts:1109`) | sqlite/postgres FTS search, memory fallback | Reuse for thread listing/filtering where stores implement it; memory store may return explicit unsupported. |
| `subscribe(options)` event multiplexer + `queryEvents(AgentEventQuery)` durable pages (`src/contracts.ts`) | Server SSE, 0.0.12 `createPersistenceAgUiReplay`, `createPrismEventReplay` | Reuse for conversation reconnect/replay (page→live, at-least-once, stable IDs). No second event system. |
| `resumeAgentRunStream()` / `AgentRunLifecycle.resumeStream` (`src/agents.ts`, `src/agent-run-lifecycle.ts`) | AG-UI handler resume, durable approvals | Reuse for `continue` so completed tool calls never rerun; checkpoint CAS + `expectedVersion` required. |
| `RunLimits` (`src/contracts.ts:137`) | Agent loops, workflows, browser, connectors | Reuse as shared turn/tool/token/cost budget for review and browser loops. |
| `AgentRunInterruptionKind` / `tool_approval` (`src/agents.ts:576`) | Secure agent, workflow suspension, connector draft-then-approve | Reuse for artifact review approvals and device side effects; no second approval runtime. |
| `idempotencyKey` session append dedup (`src/contracts.ts`) | Session append, Plan 076 connector `IdempotencyStore` | Reuse pattern for conversation `continue` request IDs and artifact mutation dedup. |
| `AgentIdentity` / `IdentityVerifier` / `ownershipFromIdentity` / `assertIdentityActive` / `narrowIdentity` (`src/identity.ts`) | Server authorize, tools, workflows, MCP/A2A, telemetry, connectors | Reuse; every conversation/memory/artifact/connector/browser/device action starts from verified identity; recheck on resume and at schedule fire time. |
| `OAuthProvider` / `OAuthCredentialStore` / `refreshOAuthCredential` (`src/credentials.ts`, `src/index.ts:76`) | OpenAI Codex PKCE adapter, credentials-node stored resolver | **Extend** with M365 + GWS adapters and per-bundle scope maps; single-flight refresh; revocation. |
| `createStoredCredentialResolver` / `createOAuthCredentialStoreAdapter` / encrypted + keychain stores / KMS envelope (`packages/credentials-node`) | Provider credentials, work-tools identity | Reuse for per-identity connector token storage; secrets never in argv/model context/events. |
| `MemoryScope` / vector store / working store / `runMemoryConformance` / `assertFiniteVector` (`packages/memory`) | Memory injection, postgres/memory adapters | **Extend** with consent/source/visibility fields, injection filter, correction/delete/retention, conformance cases. |
| `createWorkflowSchedules` / `WorkflowScheduleRecord` / coordinator / checkpoints (`packages/workflows`) | Durable schedules, suspend/resume, replay | **Extend** with capability-token verification at fire time + revocation; audit via policy ledger. |
| `createPolicyEvaluator` / `evaluateAndAppend` / policy stores / `exportPolicyDecisions` (`packages/policy`) | Enterprise policy decisions, audit export | Reuse for consent-revocation, schedule-revocation, artifact-approval, delivery-link audit records. |
| `RetentionPolicy` / `queryRetentionPolicies` / persistence lifecycle hooks (`src/contracts.ts:1559`, `src/persistence-lifecycle.ts`) | sqlite/postgres lifecycle (0.0.13) | Reuse for thread/memory/artifact retention/deletion/legal-hold; no new retention engine. |
| `ResourceLoader` / `registerResourceLoader` (`src/contracts.ts:1812`) | Media/resource loading, SSRF bounds | Reuse for authorized artifact source/output references; hosts resolve blob bodies. |
| `createSecretRedactor` / `redactAgentEvent` / `redactSessionEntry` (`src/redaction.ts`) | Events, persistence, exports, telemetry | Reuse for conversation export, artifact records, co-work events, device streams. |
| `createPrismHandler` / `createPrismEventReplay` / `createPrismHealthHandler` / drain / rate-limit / deployment lease (`packages/server`) | All server routes, 0.0.13 deployment seams | **Extend** with conversation + artifact services and delivery-link signer/verifier; ownership still only from authorize. |
| `createAgUiEventMapper` / `createAgUiHandler` / `createPersistenceAgUiReplay` / projection / limits (`packages/ag-ui`, `/acp`) | Host TUI/desktop coding apps (0.0.12) | **Extend** with co-work event types + thread/artifact handler scope; default-deny projection stands. |
| `createBrowserManager` / `createBrowserTools` / `policy.ts` / `network.ts` / snapshot / uploads / downloads / shared-sandbox (`packages/browser`) | Sandboxed Playwright tools (0.0.9–0.0.10) | **Extend** with checkpoint (`url`/`domainStateHash`/`hostDataRef`) + resume-verify-before-side-effect; no serialized browser internals. |
| `createWorkTools` / `createMemoryIdempotencyStore` / `identityKey` / `assertSafeArgv` / CLI runners (`packages/work-tools`) | M365/GWS connectors (0.0.13) | Reuse; consume per-identity OAuth tokens from Task 5; idempotent draft-then-approve mutations unchanged. |

### Primitive decision

**Authorized generic extensions (each needs ≥2 consumers or a conformance pair):**

1. Conversation thread metadata seam on session stores (consumers: sqlite + postgres; memory store explicit unsupported/linear fallback) + conversation service on server (consumers: host transports, AG-UI handler scope).
2. Memory consent/source/visibility fields + injection filter + lifecycle APIs (consumers: vector store + working store + prompt assembly filter + conformance suite).
3. Artifact record/revision/approval/delivery seam on persistence + server (consumers: sqlite + postgres + server handler + AG-UI co-work projection).
4. Schedule capability-token verification + revocation (consumers: workflow schedules + policy-ledger audit).
5. `DeviceAdapter` contract + deny-by-default `resolveDevicePolicy()` (conformance pair: future voice + desktop-control adapters; tested now via fixtures only).
6. M365/GWS `OAuthProvider` adapters + scope maps (consumers: work-tools M365 + GWS subpaths).
7. Browser checkpoint/resume-verify seam (consumers: conversation-scoped browser runs + workflow browser checkpoints).

**Authorized package changes — extensions plus exactly two new provider packages (`@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-ollama`):** server (conversation/artifact/delivery), memory (consent/lifecycle), ag-ui + acp (co-work events), credentials-node (OAuth adapters), work-tools (token wiring), browser (checkpoint), workflows (schedule capability), core (types + device contract), sqlite/postgres stores (session write seam + query filters; artifacts reuse the existing checkpoint store — no new schema).

**Rejected:** new conversation/artifact/device packages without measured evidence; Studio/chat UI; Slack/Teams channel packages; voice/desktop vendor packages; `WorkAgent` or second memory/event runtime; artifact blob store; serialized browser internals in checkpoints; cross-identity token fallback; model-selected scopes; any permission broadening (gate 8).

## Frozen finite limits and charging points

**Rule:** validate every untrusted field before persistence, provider call, connector spawn, event emission, link signing, or export enqueue. Owning tasks may tighten defaults but must not raise hard caps without updating this page, tests, and docs. All loops consume shared `RunLimits` (turn/tool/token/cost/wall).

### Conversations (Task 1)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Thread list page | 50 / 200 | Before store list query | Task 1 pages; ownership-scoped index required. |
| Event replay page rows | 100 / 500 | Before `queryEvents` | Task 1 pages; matches server replay. |
| Replay cursor | 4 KiB / 16 KiB | Before cursor parse | Task 1 rejects malformed cursors. |
| Thread title | 256 B / 2 KiB | Before create/rename persist | Task 1 truncates with marker or rejects. |
| Client request ID (idempotency) | 256 B / 2 KiB | Before continue/create dedup | Task 1 rejects oversized IDs. |
| Active branches per thread | 16 / 64 | Before branch create | Task 1 rejects with attributable error. |
| Export payload per request | 8 MiB / 32 MiB | Before export serialize | Task 1 stops with cursor; redactor applied. |
| Export pages per request | 100 / 500 | Before next export page | Task 1 stops; client re-requests with cursor. |

### Memory consent / proactive capability (Task 2)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Consent source string | 256 B / 2 KiB | Before remember/update persist | Task 2 rejects. |
| Consent metadata per record | 1 KiB / 8 KiB | Before persist | Task 2 rejects; never stores secrets. |
| Injection consent check | O(1) per record field check | During assembly filter | Task 2 excludes non-consented/invisible; no full-corpus scan. |
| Retention sweep batch | 500 / 5,000 | Per sweep tick | Task 2 pages; bounded time per batch. |
| Capability token record | 4 KiB / 16 KiB | Before enable/persist | Task 2 rejects. |
| Capability TTL | 24 h / 31 d | Before enable; recheck at fire | Task 2 expires fail-closed. |
| Revocation state | 1 boolean per token (no growing list) | On revoke | Task 2 marks token revoked + pauses schedule; nothing to compact. |

### Artifacts / review / delivery (Task 3)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Artifacts per thread | 64 / 256 | Before attach | Task 3 rejects. |
| Revisions per artifact | 32 / 128 | Before revise | Task 3 rejects; last-validated remains recoverable. |
| Artifact metadata record | 8 KiB / 64 KiB | Before persist | Task 3 rejects unrestricted payloads; no file bodies. |
| Preview metadata | 16 KiB / 64 KiB | Before persist | Task 3 rejects; metadata only, host renders content. |
| Citation / data-source refs | 32 / 128 entries | Before persist | Task 3 truncates with marker or rejects. |
| One citation ref | 2 KiB / 8 KiB | Before persist | Task 3 rejects. |
| MIME string | 128 B / 512 B | Before attach/revise | Task 3 rejects. |
| Hash string | 256 B / 1 KiB | Before attach/revise | Task 3 rejects. |
| Revisions per compare call | exactly 2 | Before compare | Task 3 rejects other arities; hash+metadata only. |
| Delivery link TTL | 5 min / 24 h | Before link sign | Task 3 rejects longer TTLs. |
| Delivery link token | 4 KiB / 16 KiB | Before verify | Task 3 rejects; reauthorize per download. |

### AG-UI co-work (Task 4)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Redacted browser snapshot payload | 256 KiB / 2 MiB | Before event emit | Task 4 truncates with marker or drops event. |
| Connector draft payload | 64 KiB / 512 KiB | Before event emit | Task 4 rejects oversized; draft stays in connector store. |
| Progress / approval record | 4 KiB / 16 KiB | Before event emit | Task 4 rejects. |
| Download-link event payload | 4 KiB / 16 KiB | Before event emit | Task 4 rejects; token only, never body. |
| Existing mapper/handler limits | unchanged from 0.0.12 | Existing resolve/emit paths | Task 4 does not raise them; overflow uses existing subscriber policy. |

### OAuth connectors (Task 5)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Scopes per grant | 16 / 64 | Before authorize URL / token exchange | Task 5 rejects non-map scopes; host-pinned map only. |
| One scope string | 128 B / 512 B | Before grant | Task 5 rejects. |
| Refresh attempts per resolve | 2 / 4 | Before refresh | Task 5 fails closed with attributable error. |
| Concurrent refreshes per identity+provider | 1 / 1 (single-flight) | Before refresh | Task 5 coalesces; no token storm on reconnect. |
| Revocation request timeout | 10 s / 60 s | Before revoke call | Task 5 marks locally revoked regardless; remote best-effort. |
| Token storage envelope | reuse credentials-node 4 MiB / 16 MiB | Before store write | Task 5 rejects; encrypted at rest. |

### Browser composition / device contracts (Task 6)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | ---: | --- | --- |
| Checkpoint URL | 8 KiB / 16 KiB | Before checkpoint persist | Task 6 rejects. |
| Domain state hash | 256 B / 1 KiB | Before checkpoint persist | Task 6 rejects. |
| Host data ref | 2 KiB / 8 KiB | Before checkpoint persist | Task 6 rejects; refs only, never bodies. |
| Checkpoints per run | 16 / 64 | Before checkpoint persist | Task 6 evicts oldest or rejects. |
| Verify before side effect | mandatory after any resume/interruption | Before first mutating browser action | Task 6 reloads + verifies or fails closed. |
| Device enabled default | `false` (disabled by default) | Before any device admit | Task 6 denies without explicit consent+sandbox+approval. |
| Audio / screenshot / stream chunk | 1 MiB / 8 MiB | Before chunk accept/emit | Task 6 drops with marker; redactor applied. |
| Concurrent device sessions per identity | 1 / 4 | Before session admit | Task 6 rejects. |
| Device wall time / turns / tool calls | consume shared `RunLimits` | Existing run accounting | Task 6 denies on breach. |

**Forbidden:** unbounded replay/export scans, file-body persistence in artifact records, serialized browser internals in checkpoints, cross-identity token fallback, model-selected OAuth scopes, credentials in argv/model context/events, default-enabled devices, schedule execution without capability verification, raising hard caps silently, any permission broadening per gate 8.

## Channel and device capability freeze

| Channel / device | 0.0.14 status | Notes |
| --- | --- | --- |
| Web / AG-UI host TUI/desktop | supported (0.0.12 + co-work extensions) | Primary surface; co-work events ride official AG-UI schemas. |
| ACP sibling | supported where stable contracts overlap | `./acp` parity for co-work where `session/update` covers it. |
| Slack / Teams chat channels | deferred — demand-gated | Added only after web/AG-UI demand is measured (roadmap); no package/export/docs entry in 0.0.14. |
| Realtime voice | contract + conformance only | `DeviceAdapter` + deny-by-default policy; vendor packages demand-gated 0.1.x. |
| Desktop OS / computer control | contract + conformance only | Same; approval-aware, isolated, observable, disabled by default. |
| Playwright browser | supported via `@arnilo/prism-browser` | Conversation composition through existing sandbox/egress/secret/approval/limit policy; checkpoint = verified state. |
| Push notification daemon / always-on proactive agent | unsupported | Host transports consume replay streams; schedules need explicit enablement + revocable capability. |

## Threat and authority matrix

| Boundary | Trusted authority | Untrusted input | Mandatory control | Default / unsupported |
| --- | --- | --- | --- | --- |
| Thread ownership | Verified `AgentIdentity` → ownership | Caller thread IDs/cursors | Authorize + ownership on every op; wrong-user → not-found/forbidden | Cross-user list/continue/export unsupported. |
| Replay / continue | Durable cursor + checkpoint CAS | Cursor tampering, reconnect storms | Page→live at-least-once with stable IDs; CAS resume; request-id idempotency | Rerunning completed tool calls unsupported. |
| Memory consent | User consent record + injection filter | Model-requested recall, export flags | Consent+visibility enforced at assembly; revocation immediate | Non-consented/invisible memory in prompts/events/exports unsupported. |
| Proactive schedules | Explicit enablement + capability token | Schedule fire without recheck | Fire-time identity + consent re-verification; revocation fail-closed; policy audit | Default-on proactivity unsupported. |
| Artifact records | Identity + thread ownership + CAS | Revision storms, stale approvals | Version CAS; approval state machine; metadata-only persistence | File-body store / blind approve unsupported. |
| Delivery links | Signed expiring token | Link replay/share | TTL ≤ hard cap; reauthorize per download; ownership check | Permanent/public links unsupported. |
| Exports | Identity + redactor | Export page requests | Bounded pages; redacted payloads; legal-hold honored | Unredacted / unbounded export unsupported. |
| OAuth tokens | Host-pinned scope map + encrypted store | Model scope requests, cross-identity reuse | Least-privilege per bundle; single-flight refresh; per-identity isolation; redaction everywhere | Model-selected scopes / token fallback / credentials in argv unsupported. |
| Browser checkpoints | Verified URL/domain state + host data refs | Resumed context claims | Reload + verify before side effect; no serialized internals | Side-effect replay after interruption unsupported. |
| Device streams | Explicit consent + sandbox + approval | Stream chunks | Disabled by default; chunk caps; `tool_approval` for side effects; redacted telemetry | Default-enabled voice/desktop unsupported. |
| Co-work events | Default-deny projection | Client event payloads | No local paths/raw args/secrets; malformed events fail closed; `EventSchemas` validation | Raw tool payload / filesystem path events unsupported. |
| Permission surface | Roadmap gate 8 | Feature pressure | Non-broadening regression in Task 8 | Any new default consent/memory/network/file/browser/connector/tool permission unsupported. |

## Validation matrix for Task 0

| Check | Frozen assertion |
| --- | --- |
| Traceability | Every Phase 9 roadmap Functional/Performance/Code Quality/Security criterion has one primary Task 1–8 owner; Studio/Slack/Teams/voice-vendor/desktop-vendor/Office have none. |
| Package names | Exactly two new provider packages (`@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-ollama`); 41 → 43 manifests at release; otherwise extensions only in server, memory, ag-ui(+acp), credentials-node, work-tools, browser, workflows, core types, sqlite/postgres stores. |
| Primitive reuse | Only the seven authorized generic extensions above; each has ≥2 consumers or a conformance pair; no `WorkAgent`, second memory runtime, or second event system. |
| Gate 8 | No permission broadening; device adapters disabled by default; schedules require explicit enablement + revocable capability; Task 8 ships a non-broadening regression. |
| Replay semantics | Ownership-scoped cursor; page→live at-least-once; stable IDs for dedup; CAS resume; terminal replay never invokes provider/tools. |
| Token shapes | MemoryConsent, ScheduleCapability, DeliveryLink shapes frozen above; all expiring and ownership-bound. |
| Finite resources | All conversation/memory/artifact/co-work/connector/browser/device caps above enforced by owning tasks; shared `RunLimits` for review/browser loops. |
| Security | Verified identity owns every action; consent/permission rechecked on resume and fire; links authorized+expiring; tokens/paths/secrets/document-private data never enter model context, events, telemetry, or unauthorized exports. |

## Documentation and release ownership

- Task 0: this evidence page, `docs/index.md` link, and `docs.test.ts` Phase 9 regression guard.
- Task 1: `docs/conversations.md` (new) + server/session-store updates.
- Task 2: `docs/working-and-semantic-memory.md` + workflow/policy consent/capability notes.
- Task 3: `docs/work-artifacts-and-review.md` (new) + server/persistence updates.
- Task 4: `docs/ag-ui.md` co-work event tables + ACP parity notes.
- Task 5: `docs/credential-storage.md` + `docs/work-connectors.md` OAuth scope maps.
- Task 6: `docs/browser-automation.md` checkpoint/resume + device-contract deferral note in `docs/migration.md`.
- Task 7: canonical docs, examples, migration, index navigation.
- Task 8: 0.0.14 graph, `scripts/benchmark-0.0.14.mjs`, pack/install, supply-chain, dry-run publish, roadmap completion evidence.

No public implementation API changes land in Task 0. This page, `roadmap.md` Phase 9, and Plan 077 are authoritative until implementation; later tasks may tighten defaults but cannot widen scope, raise hard caps, add packages, ship channel/voice/desktop vendor implementations, store artifact file bodies, serialize browser internals, or broaden permissions without updating this evidence, tests, docs, and plan.
