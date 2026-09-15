# Prism Messaging Channels — Telegram and Signal

Status: requirements and implementation proposal; not implemented. Release vehicle: **0.8.0** — **moved off the 0.7.0 line on 2026-09-15 by user request** so the 0.7.0 cut stopped waiting on it. It had been assigned to 0.7.0 on 2026-09-14; 0.7.0 shipped on 2026-09-15 without it (six-plan cut: 072, 073, 074, 075, 077, 078), and no channel adapter exists in 0.7.0. The deviation is recorded in [073](073-Release-0-7-0-Host-Completeness.md) “Compromises Made”, [roadmap.md](../roadmap.md) and [plans/README.md](README.md).
Research updated: 2026-09-14.

## Objectives

- Let applications expose explicitly selected **Prism agents** through Telegram and Signal for bidirectional conversation, status, cancellation, and human approvals.
- Ship reusable TypeScript integrations in the Prism repository, independent of any particular consuming application, editor, desktop service, or UI.
- Reuse Prism's agent/session, identity, credential, checkpoint, lease, policy, and persistence primitives instead of creating another agent runtime or conversation database.
- Specify host responsibilities, platform prerequisites, security boundaries, recovery guarantees, tests, and documentation before implementation.

## Expected Outcome

A Node host can explicitly compose a channel adapter with a Prism agent, authenticated identity mapping, and durable storage. An authorized person's direct messages continue the correct owned session; final replies return to the same bound destination. Restart recovery does not blindly rerun tools or resend ambiguous messages. Telegram uses its official Bot API; Signal uses a version-pinned, externally operated signal-cli bridge and is labeled experimental.

This document **replaces** the previous, incorrectly application-specific plan 079. All implementation paths below are relative to this Prism repository. No downstream application changes are required by this plan. Release version **0.8.0** (reassigned 2026-09-15); publication requires operator authorization, and 0.8.0 needs its own cut plan because 073's Tasks 28–29 were specific to the 0.7.0 line.

## 1. Recommended scope and package boundary

Add optional subpaths to the existing `@arnilo/prism-core` family package:

| Proposed subpath — not yet exported | Responsibility |
| --- | --- |
| `@arnilo/prism-core/integrations/channels` | Small transport-neutral channel contracts, authorization/binding checks, Prism execution adapter, bounded delivery state and lifecycle. |
| `@arnilo/prism-core/integrations/channels/telegram` | Official Bot API adapter: long polling, separately mountable Web `Request`/`Response` webhook handler, text sends, callback controls. |
| `@arnilo/prism-core/integrations/channels/signal` | Node-only client for a host-selected signal-cli Unix socket; bounded JSON-RPC requests and receive notifications. |

Names are proposed and must be frozen after Task 1. Channel-specific types stay in this subpath unless another package demonstrates a need for root contracts. Do not add a new npm package, model provider, extension registry, framework server, or mandatory database driver. Telegram and Signal are messaging transports, not `AIProvider` implementations.

**First supported behavior:** direct-message text conversations; explicit sender grants; persistent session binding; host-selected agent aliases; `/help`, `/status`, `/new`, `/agent`, `/cancel`; narrow approve/deny controls; final answer delivery. Groups, topics, media, voice, message edits, reactions, proactive broadcasts, and rich streaming are follow-on scope. Unsupported inputs receive bounded feedback only for authorized humans, without invoking a model.

**Host-neutral does not mean hostless.** Prism supplies library integration and runnable examples. The embedding host still owns account provisioning, verified identity mapping, agent/provider selection, tool policy, storage deployment, process supervision, TLS, secrets and operational consent. No listener, poller, subprocess, credential lookup, or environment discovery starts on import or factory construction.

## 2. Existing Prism primitives and verified gaps

Baseline: current working tree, package manifests **0.6.0**, Node **>=22**, with pre-existing uncommitted work. Source and package exports take precedence over stale prose; implementation must revalidate against the final target revision. Do not import assumptions from a consuming application's dependency pin or runtime behavior.

| Primitive | Evidence | Reuse / limitation |
| --- | --- | --- |
| `Agent`, `AgentConfig`, `AgentSessionConfig` | `src/contracts-core/agent.ts:52–150`; `src/agent-session/create-agent.ts:5–12` | Host supplies selected provider, tools, identity, store and policy. Session ID and optional leaf reconnect history. |
| `AgentSession.run`, result and cancellation | `src/agent-session/session.ts:166–174,285–320`; `docs/agent-session-runtime.md` | Direct `AgentRunResult`, `AbortSignal`/`abort`, optional bounded subscription. No second execution engine needed. |
| Run admission, identity and limits | `src/agent-session/session/assemble.ts:296–461`; `src/contracts-protocol.ts:75–124` | One active run per session object, not a distributed lock for every object with the same ID. Run IDs are generated internally; `idempotencyKey` is not an exactly-once run API. |
| Durable terminal evidence | `src/agent-session/session/persist.ts:103–200` | Final session content and run ledger/checkpoints can support reconciliation. Channel outbox still needs its own durable delivery state. |
| Secure agent composition | `src/contracts-core/agent.ts:111–130`; `assemble.ts:308–318`; `docs/agent-session-runtime.md` | Reuse `createSecureAgent` or equivalent explicit restrictions; never downgrade its immutable defaults to make an adapter work. |
| Durable approval lifecycle | `src/agent-run-lifecycle.ts:22–117,173–366` | Existing ownership, definition revision/fingerprint, expected-version CAS, individual decisions and ambiguous-dispatched-tool denial. No parallel approval engine. |
| Identity and ownership | `docs/agent-identity.md` | Reuse `IdentityVerifier`, `AgentIdentity`, `ownershipFromIdentity`, activity and propagation checks. Telegram/Signal payload fields are not already verified Prism identities. |
| Conversation service | `packages/prism-core/src/runtime/server/conversations.ts:110–204,215–340`; `docs/conversations.md` | Optional thread create/list/archive/replay over existing sessions. Do not build a competing conversation model. Direct session execution remains the minimal default. |
| Generic checkpoint and lease stores | `src/contracts-core/persistence.ts:44–128`; `docs/sqlite-persistence.md`, `docs/postgres-persistence.md` | Existing versioned records, namespaces, categories, pagination, CAS and fencing can back a bounded reference channel journal without new SQL tables. No multi-record transaction is exposed by `CheckpointStore`. |
| PostgreSQL transactional messaging | `packages/prism-core/src/enterprise/postgres/erp-messaging.ts:44–69`; `docs/enterprise-postgres-state.md` | Existing inbox/outbox/unknown/dead-letter pattern for hosts that already need business-transaction coupling; not a reason to require PostgreSQL everywhere. |
| Credentials and redaction | `docs/credentials-and-redaction.md`, `docs/credential-storage.md` | `CredentialValueSource` / `resolveCredentialValue`, host resolvers, `SecretRedactor`; no new credential vault or hidden `process.env` lookup. |
| Server handler and deployment helpers | `docs/server.md` | Web-standard optional handlers, host authorization, drain/health and lease patterns. In-process channels call Prism directly, not loopback HTTP. |
| Outbound webhook notifier | `docs/server.md`, “Outbound webhooks” | Existing notifier is bounded and in-memory; it neither receives chat messages nor supplies cross-restart reply delivery. |

Graph-wide indexed-source searches for `telegram` and `signal-cli` returned no existing adapters.

### Primitive-review gates that affect implementation

1. **Conversation/secure-agent compatibility:** current `ConversationService.continue()` passes `ownership` and `redactor` as run overrides (`conversations.ts:329–338`); secure agents reject those fields (`assemble.ts:308–318`). Default channel execution should call an already correctly configured agent/session directly. If a conversation-service convenience composition is included, prove it with a regression test and make only a generic fix; do not weaken secure defaults or promise unchanged compatibility.
2. **Idempotency is not execution deduplication:** `session.run()` generates a new run ID on every call. `ConversationService.continue().requestId` flows into append/run metadata but does not itself prove provider/tool work is skipped. Channel admission must claim the external operation before invoking either API.
3. **Resume identity and cancellation:** `AgentRunLifecycleRequest` carries ownership but no caller identity; `resumeAgentRun` has a different cancellation surface from `resumeAgentRunStream`. Re-resolve the agent under current verified authority before resume. Prove identity, tool-scope, finite-limit and cancellation propagation through initial run and resume; use existing stream plus persisted terminal evidence or a demonstrated generic primitive fix, not a transport-specific bypass.
4. **Final-output provenance:** `buildRunResult` derives output from session history, including on failure/suspension. Send only the current operation's approved final text. Never blindly send `.text` for every status or dump a previous turn, thinking blocks, raw tool arguments/results, or transcript history.
5. **Persistence fit:** checkpoint stores offer single-record CAS, not an atomic “inbox + cursor + agent side effect” transaction. Review commit order, recovery of partially staged operations, bounded listing and retention. Do not claim transactional guarantees that the chosen primitives cannot provide.
6. **Version truth:** SQLite documentation contains an older peer version/example; current `packages/prism-core/package.json` declares optional `better-sqlite3 ^13.0.3`, `pg ^8.23.0`. Use exact manifests and executable examples, not a copied stale installation snippet.

## 3. Prism-specific requirements

### R1 — Explicit composition and minimal dependencies

- A host registers a finite set of connection IDs and permitted agent aliases. Unknown aliases fail closed without provider calls.
- Expose a small common adapter shape only for the two implemented transports: bounded receive, send, capability description, explicit start/stop. Transport acknowledgment belongs to the transport implementation; Signal must not pretend to support Telegram-style acknowledgment.
- Common types use existing Prism message/run/identity/error concepts. Do not pass raw transport objects into core runtime contracts or add Telegram/Signal branches to the agent loop.
- Use native `fetch` for the small Telegram API subset and native Node socket/JSON framing for Signal. Signal imports must not be pulled in through Telegram or the generic barrel.
- Host supplies storage capabilities and credentials; examples demonstrate existing SQLite persistence. PostgreSQL uses the same generic store contracts and must pass their channel conformance tests before shared-host claims.

### R2 — Authentication, pairing and scoped grants

- Mandatory authorization callback maps a **transport-observed** account/sender/conversation to an active host-verified `AgentIdentity`, exact `OwnershipScope`, allowed agent aliases, and a grant revision. Never accept tenant/user/scopes from message text or unchecked JSON.
- Pairing is an optional reusable helper for hosts without preconfigured grants: trusted host creates a >=128-bit one-use token, stores its hash and intended grant with proposed 5-minute expiry, then confirms observed sender through its trusted admin interface. No first-message enrollment. Host owns that interface; Prism does not mandate a desktop UI.
- Scope every read/write/status/cancel/resume/output by exact connection, external identity, ownership and binding. Cross-user/tenant errors must not reveal whether a foreign session exists.
- Use stable Telegram user IDs and Signal service identity/UUID, not names or phone-number display strings as sole authorization keys. Normalize external IDs to bounded strings without 32-bit truncation.
- Reauthorize queued execution, approval consumption and unsent output. Revocation invalidates controls and pending work, requests active cancellation, and blocks future sends; it cannot retract already completed effects or platform-accepted messages.
- Connection credentials and cursor administration have host/service ownership; user session and operation state have their authorized ownership. Explicitly namespace connection/tenant/account/user keys; never use an unscoped scan as tenant authorization.

### R3 — Session routing and concurrency

Binding identity:

```text
connection ID + external conversation ID + optional thread ID
+ external actor grant + permitted agent alias -> owned Prism session ID + optional branch leaf
```

- Dedicated sessions per binding by default. Same display name across channels does not merge histories. A host may explicitly link an existing session only after verifying ownership and agreeing on shared execution admission.
- `/new` changes the binding to a fresh session; it is not history deletion. `/agent` selects only authorized aliases and their associated sessions. Transport thread IDs remain in the envelope for future topic support, but groups/topics are rejected in MVP.
- Serialize turns per **logical session ID**, including multiple runtime objects. Bound process concurrency across independent sessions; no daemon-wide single-run restriction inherited from another application.
- Durable suspended/unknown operations block later ordinary turns on that binding until resolved. Control messages bypass the prompt queue to prevent approval/cancel deadlocks.
- If another API/UI can drive the same session, all producers must use the same host admission/lease mechanism. Otherwise reject shared-session binding; a channel-only mutex does not constrain unrelated callers.
- Restore the correct store/leaf/agent definition after restart. Do not rely on an in-memory session map as persistence.

### R4 — Safe Prism execution

- Host selects provider/model, instructions, tools, resources, policies, identity and finite `RunLimits`. Message text cannot replace `AgentConfig`, `RunOptions`, credentials, filesystem roots, MCP servers, or definition revision.
- Default example exposes a tool-free agent; tool-enabled example uses `createSecureAgent` or equivalent explicit permission/trust/schema/guardrail/checkpoint composition.
- Use existing `RunOptions.toolNames` only where available on the target revision; the configured tool registry and permission policy remain the security boundary. Scope narrowing must survive resume.
- Treat text, links, quoted messages and attachments as untrusted user input, never system instructions. Do not dispatch arbitrary host `CommandDefinition`s simply because text starts with `/`.
- Explicit command allow-list only: `/help`, `/status`, `/new`, `/agent <alias>`, `/cancel`, and opaque approval controls. Account administration and registry/config mutation stay in trusted host APIs.
- Preserve provider/tool abort propagation. Transport disconnection is not automatic user cancellation: accepted work may finish into the outbox. Explicit user cancellation and host shutdown are distinct signals.
- Failures return bounded redacted status; partial output is sent only if deliberately enabled and labeled. Cancellation is a request, not rollback or proof an external side effect stopped.

### R5 — Durable intake, replies and recovery

Use existing `CheckpointStore`/`LeaseStore` for the bounded reference implementation, in a distinct proposed `prism.channels.*` namespace. Store only channel binding/operation/control/delivery metadata and bounded reply payloads; transcripts, run history and approvals remain in their existing stores.

Conceptual records:

- Binding: exact ownership, session/leaf, permitted alias, grant revision and suspended/unknown barrier.
- Operation: connection-scoped external event key, admitted input, arrival order, operation ID, session/run correlation and execution state.
- Reply: operation ID + reply revision/chunk index, fixed destination, sanitized payload, send state and platform result. Reply data can live inside the operation record when within the record cap.
- Connection cursor: receiver identity, next Telegram offset and receiver lease fence; no token secret.
- Control: token hash, binding/run/approval/version/expiry and consume state.

Required invariants:

1. Persist and deduplicate incoming operations before confirming Telegram receipt. Save all required batch records/dispositions **before** advancing its cursor. These can be ordered durable writes, not a fictional multi-record checkpoint transaction. Crash after partial batch save must replay/deduplicate safely.
2. Claim operation via CAS **before** any provider call. Record correlation ID before dispatch and run ID as soon as available. An `executing` operation found after crash is never automatically rerun merely because no result row exists.
3. Reconcile only from exact-owned, run-correlated durable session/ledger/checkpoint evidence. Missing or contradictory evidence becomes `execution_unknown`, requiring host review. No custom private-table queries in the channel runtime.
4. Persist final response and chunk state before external sends. Send failures never rerun the agent. Retry only known-unsent/retryable chunks; keep already sent chunk IDs.
5. Distinguish at least queued, executing, waiting-approval, succeeded, failed, cancelled, execution-unknown; delivery separately tracks pending, sending, sent, retryable, unknown, dead-letter. A completed agent is not proof of delivered or read reply.
6. External timeout after send is ambiguous. Persist `delivery_unknown`; do not blindly replay approvals or sensitive output. Operator replay requires authorization, expected version, evidence and explicit duplicate-risk acknowledgment.
7. One receiver per connection; renew lease and stop intake/dispatch on lease loss. CAS and fences protect stored transitions, **not** a paused process's external network side effects. Takeover must not redispatch an old `sending`/`executing` record.
8. Bound listings, active queue, record size, retry count, retention and tombstones. Recovery must handle pagination and concurrent state changes without starvation. Fail admission explicitly when capacity/storage is unavailable; do not evict accepted active work.
9. Never promise exactly-once model/tool execution or external delivery. Telegram replay is bounded by its retention; Signal has no documented application-acknowledged receive log.

A PostgreSQL host needing atomic business updates plus outbound events should evaluate `createPostgresErpMessaging` rather than invent another SQL outbox. This optional composition is not required for basic channel support and cannot remove external-send ambiguity.

### R6 — Approvals and status

- Use `PendingDecision` / `RunDecision`, `resumeAgentRun` or the existing lifecycle/stream adapters. Do not create a channel-specific decision engine or edit core run-state blobs.
- Telegram button payload and Signal `/approve <token>` / `/deny <token>` reference a short-lived server-side record, not raw authority. Bind token to exact principal, connection, chat, session, run, approval ID, expected version, action and grant revision.
- Initially allow only `allow_once` and `reject_once`; no blanket legacy “approve all,” approval-with-edits, sticky grant or free-form “yes.” Duplicate/stale/forwarded/revoked controls fail closed.
- Recheck current identity, agent revision/fingerprint, tool permissions and decision version before resume. Update controls after partial decisions bump the run version.
- Acknowledge Telegram callbacks promptly, then process the authorized decision without waiting in the prompt queue.
- Send redacted action/scope details sufficient for informed approval. If safe detail cannot be shown remotely, require an authenticated host UI. Do not ask a person to approve an unexplained arguments hash.
- `/status` exposes only the bound operation/session. `/cancel` aborts active execution or cancels queued work. For a suspended run, use existing CAS-checked terminal denial where appropriate, document the `denied` result, and never hand-edit a checkpoint to invent cancellation.
- General elicitation schemas and provider-specific approval flows stay out of MVP; unsupported interaction remains suspended with clear host-action guidance.

### R7 — Output, resource bounds and observability

Proposed configurable defaults, not existing Prism/platform guarantees:

| Resource | Default target |
| --- | --- |
| Accepted input text | 32 KiB UTF-8 |
| Pending ordinary turns | 8 per binding, 100 per process |
| Active independent sessions | 4 per process; same logical session always serial |
| Outgoing logical response | 64 KiB UTF-8; bounded overflow policy, never silently truncated |
| Channel checkpoint record | 128 KiB encoded JSON, enforced after escaping/metadata |
| Journal list page | 100 records |
| Send attempts | 5 for known-retryable failures; unknown is not retryable |
| Pair/control expiry | 5 minutes, host-tightenable |
| Processed transport payload retention | 7 days; shorter if host policy requires |

Task 1 must set compatible hard caps and polling/scan ceilings using actual store limits. Overflow policy returns a bounded “response too large; use host interface” result or host-authorized artifact link; never spill secret content into an unsolicited file.

- Project final text only; redact known credentials at error, event, journal and send boundaries. Exact-secret redaction is not general DLP.
- Expose bounded diagnostics: connection readiness, last successful intake/send, queue depth, retries, unauthorized/dedup counts, dead letters, unknown outcomes and correlation IDs. Message text, phone numbers, pairing links, bot-token URLs and Signal key material stay out of logs/metrics.
- Application host owns fair per-principal rate/usage admission and daily budget enforcement; reuse configured Prism model-router/governance when needed. Per-run limits alone are not daily or multi-replica budgets. Do not invent a billing service.
- Stop/drain releases only resources owned by the channel runtime. Host-owned stores, providers and externally managed signal-cli remain host-owned. Disabled/unstarted integration has zero background work.

## 4. Platform-specific requirements and deployment

### Telegram — official Bot API

Documented facts: `getUpdates` and webhooks are mutually exclusive; unreceived updates retained no more than 24 hours; an offset greater than `update_id` confirms receipt; polling batch limit 100; text limit 4096 characters after entity parsing; callback data limit 64 bytes; webhook secret header and `retry_after` are supported. [T1,T2]

Requirements:

- Owner provisions bot through BotFather and verifies token/account with `getMe`. Ordinary users initiate conversation; no unsolicited first contact. Token is a host credential source, resolved at the transport edge.
- Default long polling, e.g. 30-second timeout. No public ingress/domain/tunnel required. Never silently delete an existing webhook, use negative offsets, or drop pending updates.
- Optional Web-standard webhook handler for hosted deployments: host mounts HTTPS route, adapter validates independent secret header in constant time, bounds body, admits durably, then returns 2xx. Storage/capacity failure must not receive success acknowledgment. Do not wait for a model turn in the HTTP request.
- Plain text first. Conservative Unicode-safe chunks, e.g. <=3500 UTF-16 code units including labels without splitting surrogate pairs; no malformed Markdown. Honor per-chat/account rate control and actual `retry_after`.
- Ignore bot-origin, echo, service, edited and unsupported group/topic traffic. Do not rely on old documentation asserting bot-origin messages are impossible.
- API token appears in URL path. Redact request URLs, nested causes and proxy logs; forbid redirects. Default origin is the official API; alternate endpoints are trusted host configuration behind existing network/SSRF policy, never message-selected.
- Bots are not Telegram Secret Chats; do not advertise E2EE. Optional draft streaming comes later and must end in a durable final send.

Protocol examples (placeholders only):

```http
POST https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
Content-Type: application/json

{"offset":<DURABLE_NEXT_OFFSET>,"timeout":30,"limit":100,"allowed_updates":["message","callback_query"]}
```

```json
{"chat_id":"<BOUND_CHAT_ID>","text":"Prism agent: task completed."}
```

Second JSON is a `sendMessage` body; destination is fixed by the authorized binding, never chosen by the model. A webhook's inline-response API call is unsuitable for tracked delivery because its send result cannot be observed. [T2]

### Signal — experimental signal-cli adapter

Use version-pinned **signal-cli v0.14.8** as the researched baseline, not a floating/latest runtime download. It is unofficial; its pinned README requires JRE 25 for JVM distribution and native libsignal/platform compatibility, warns old releases can stop working after server changes, and declares GPLv3. [S1]

Requirements:

- Host operator provisions account and installs/supervises signal-cli. Prefer dedicated account linked as secondary device. Registering the same number can unregister another primary client: do not automate registration or relinking from chat.
- Initial supported transport is private Unix socket on a compatible Node/Linux host. No Signal Desktop automation, custom Signal cryptography, REST wrapper requirement, public TCP bridge, or implicit process spawn from package import.
- Start with manual receiving; subscribe only after durable writer is ready, unsubscribe/pause when it becomes unavailable. Handle manual-mode `params.result.envelope` wrapper and pinned-release error shapes.
- Bound line/frame bytes, pending request map, reconnection, backoff and send payload. Route by host-validated destination/account and stable sender identity; filter receipts, reactions, sync echoes, stories, edits, groups and attachments before model invocation.
- Protect socket and account-key directory (0700 directory / restricted files), encrypted disk/backup, no secrets in argv logs. Never auto-trust changed identity keys; require operator verification and reauthorization.
- Signal transport is E2EE to signal-cli; host code, stores and model providers process decrypted text. Explain that disappearing/deleted messages do not automatically erase transcripts, memory or provider logs.
- Signal policy is a release gate: terms prohibit illegal/impermissible communications including auto-messaging. Obtain/record an acceptable-use decision for intended operation; do not imply official bot approval or hide uncertainty. Distribution must review GPL obligations. [S3]
- Document residual receive-to-commit loss window. Manual subscription reduces subscriber-gap exposure, but JSON-RPC notifications provide no documented application acknowledgment/replay guarantee. Strict lossless intake is not an established capability. [S2]
- Account linkage, subscription health and test delivery matter; HTTP `/api/v1/check` alone means only daemon liveness. Account/device inactivity rules must be checked against current official guidance, not hard-coded from conflicting search excerpts.

Documented protocol illustration:

```sh
signal-cli --data-dir /private/prism-signal -a +15550001111 \
  daemon --socket=/private/run/prism-signal.sock --receive-mode=manual
```

```json
{"jsonrpc":"2.0","id":"subscribe-1","method":"subscribeReceive"}
{"jsonrpc":"2.0","id":"send-1","method":"send","params":{"recipient":["+15550002222"],"message":"Prism agent: task completed."}}
```

Operator recipe must also disable unused attachment/story/avatar/sticker downloads with flags verified against the pinned CLI manual. Example number syntax is not an authorization key; production validates the pinned release's stable-identity/destination mapping.

### Host prerequisites and deployment choices

- Node >=22 compatible with selected optional persistence peers; existing provider/model credentials, agent configuration and restrictive tool policy.
- Durable `SessionStore`, run evidence/ledger, `CheckpointStore` and `LeaseStore` for restart-aware operation. Memory-only mode is explicitly demo/test-only, not advertised as durable; memory checkpoint capacity eviction cannot be used for accepted production work.
- SQLite example for local/small single-host use; PostgreSQL for validated shared persistence. Host owns database backup, restore, retention, encryption and legal holds.
- Awake running process and outbound network access. Always-on operation needs an always-on host; no laptop relay is required or planned. Signal needs its separately managed bridge in addition to Node.
- Telegram webhooks optionally need domain, TLS and mounted ingress; polling and Unix socket do not.
- Host admin integration for pairing/revoke/status/reconcile, not a mandatory new UI or CLI product. Examples wire native shutdown signals and a process-manager recipe.
- Privacy notice covers platform transport, model/tool vendors, transcript and journal storage, optional memory ingestion and deletion limitations. Conversation deletion does not automatically delete external platform messages or semantic memory; host must coordinate each store's retention/hold APIs.
- Costs: ordinary Telegram bot usage within platform limits, hosting, Signal account/number and maintenance, storage and model/tool usage. No pricing quote or performance benchmark was verified in this planning task.

## 5. Proposed composition and trust flow

```text
Telegram poll / authenticated webhook     Signal network -> signal-cli -> private socket
                    \                         /
                     bounded transport parsing
                               |
                  host authorization / pairing grant
                               |
                 durable operation + owned session binding
                               |
                per-session admission + finite process budget
                               |
                 host-resolved Prism Agent / AgentSession
                               |
            existing policy, tools, checkpoints, ledger and resume
                               |
               final-text projection -> persisted reply state
                               |
                    fixed bound destination transport
```

**Proposed API vocabulary**, not existing exports or an executable example:

```ts
// @arnilo/prism-core/integrations/channels (proposed)
createMessagingRuntime({
  checkpoints, leases, redactor,
  authorize,       // observed sender + action -> verified identity/ownership/grant, or false
  resolveAgent,    // authorized alias + identity + binding -> host-configured Agent
  limits,
});
// Runtime explicitly admits adapter events, drains work, reports diagnostics and stops.
// Telegram/Signal factories never receive provider or tool registries.
```

The exact small lifecycle/adapter shape is a Task 1 output. Do not create both custom transport and custom execution plugin frameworks: transport varies twice; execution is the existing Prism runtime.

**Existing Prism execution seam**, valid independently of any proposed channel factory:

```ts
import type { Agent } from "@arnilo/prism";

async function runBoundTurn(
  agent: Agent, // already resolved with verified identity, ownership, policy and durable store
  binding: { sessionId: string; leafId?: string },
  text: string,
  operationId: string,
  signal: AbortSignal,
) {
  const session = agent.createSession({ id: binding.sessionId, leafId: binding.leafId });
  return session.run(text, { signal, idempotencyKey: operationId });
}
```

Admission, authorization, current-run output validation, and durable outbox wrap this call. `operationId` aids correlation/append semantics; it does not make this function safe to execute twice. Persisted `AgentConfig` is never reconstructed from chat JSON; the host resolves its own definition and current authority.

## Tasks

Expected paths are tentative until Task 1 freezes the primitive review and export shape. Each implementation task must refine its exact file list before coding. Do not create speculative files just to match this inventory. All tasks are Prism work, not downstream integration work.

- [ ] **Task 1 — Primitive, compatibility and threat-model review**
  - Acceptance Criteria:
    - Functional: prove direct session continuation, result evidence, cancellation, secure-agent execution and durable approval resume using current public APIs; decide default execution path and exact proposed channel exports.
    - Performance: record queue/record/list hard caps and single-session admission strategy; no network/background work added by this review.
    - Code Quality: inventory existing primitives and justify each new seam; no new agent engine, conversation store, npm family package or vendor-specific core branch.
    - Security: resolve R2–R6 authority propagation, secure/conversation conflict, resumable identity/cancellation, idempotency limits and Signal policy/license gates.
  - Approach:
    - Documentation Reviewed: [P1–P8], [T1–T3], [S1–S3]; exact source spans in section 2 and current manifests.
    - Options Considered: direct `AgentSession` (minimal and chosen default); `ConversationService.continue` (useful but current secure override conflict); HTTP/ACP/MCP detour (extra boundary, rejected); custom agent runtime (rejected).
    - Chosen Approach: keep execution on existing Prism primitives; record only demonstrated generic gaps. No Rust/editor primitive applies to this TypeScript SDK integration. Any core fix must be generic, regression-tested and scoped separately in Task 2.
    - API Notes and Examples: compile/test `runBoundTurn` above; probe `resumeAgentRun` and `resumeAgentRunStream`, and `createConversationService` with a secure agent rather than trusting a prose compatibility claim.
    - Files to Create/Edit: `docs/history/079-messaging-primitive-review.md`; this plan; `packages/prism-core/src/integrations/channels/__tests__/primitives.test.ts` if retaining executable compatibility evidence.
    - References: `assemble.ts:296–461`, `conversations.ts:314–340`, `agent-run-lifecycle.ts:22–117,173–366`; manifest peer/export inventory.
  - Test Cases to Write: two turns plus store reopen; same session ID on two objects; secure override conflict; identity/tool-scope on resume; cancel resumed work; repeated request ID invokes no unclaimed operation in proposed admission model; output error/suspension never reuses old text.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; review and probes only.
    - Docs pages to create/edit: `docs/history/079-messaging-primitive-review.md` for historical decisions/evidence.
    - `docs/index.md` update: no; no public behavior delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (history/current-contract separation).

- [ ] **Task 2 — Channel contracts, authorization and Prism execution adapter**
  - Acceptance Criteria:
    - Functional: frozen optional channel subpath exposes explicit runtime lifecycle, host authorization/agent resolution, dedicated session binding and controls common to both transports.
    - Performance: no import/factory I/O; bounded per-session/process admission; controls remain responsive while run queue is busy.
    - Code Quality: use existing `AgentSession`, `AgentIdentity`, ownership, credentials and result contracts; no duplicate conversation model; core changes only for gaps demonstrated in Task 1.
    - Security: deny by default; grant checked before session access; secure defaults immutable; ownership/tools/identity preserved on create, continue, reopen and resume; arbitrary slash/config input inert.
  - Approach:
    - Documentation Reviewed: [P1–P5], current `packages/prism-core/package.json` subpath conventions.
    - Options Considered: new package/root registry (unnecessary); adapter per application (not reusable); optional existing-family subpaths (chosen).
    - Chosen Approach: transport-neutral envelope plus small runtime facade, scoped agent resolver and operation authorizer. Direct owned-session execution avoids unnecessary HTTP and secure/conversation override conflict. Optional conversation metadata composes without becoming mandatory persistence.
    - API Notes and Examples: proposed factory and existing `runBoundTurn` in section 5; use `ownershipFromIdentity`/`assertIdentityMatchesOwnership` instead of hand-written ownership projection.
    - Files to Create/Edit: `packages/prism-core/src/integrations/channels/{index,types,limits,runtime}.ts`; `packages/prism-core/src/integrations/channels/__tests__/runtime.test.ts`; `packages/prism-core/package.json`; `docs/messaging-channels.md`; `docs/core.md`. Conditional only: `src/agent-run-lifecycle.ts`, `src/contracts-protocol.ts`, `src/__tests__/agent-run-state.test.ts`, or `packages/prism-core/src/runtime/server/conversations.ts` and its existing tests if a generic compatibility fix is selected.
    - References: R1–R4; exact compatibility gates in section 2. Recheck callers before any core/shared-service change.
  - Test Cases to Write: unknown alias/sender; forged ownership; two tenants with same external IDs; same-user different connection isolation; no import I/O; same logical session concurrency; cancellation while queued; failure/old-message output; revoked identity; secure composition; provider/tool call counters remain zero on denial.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, channel contracts/subpath and host composition.
    - Docs pages to create/edit: `docs/messaging-channels.md`, `docs/core.md`; `docs/agent-session-runtime.md` or `docs/conversations.md` only if corresponding existing contract changes.
    - `docs/index.md` update: yes, “Messaging channels” under Third-party integrations, with one current-contract sentence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] **Task 3 — Durable bindings, pairing, intake and reply journal**
  - Acceptance Criteria:
    - Functional: restart-safe pairing/bindings and deduplicated operations; durable replies, cursor ordering, unknown/dead-letter states and authorized reconciliation; no reexecution caused by send failure.
    - Performance: bounded CAS records/queue/listing, configurable retention; proposed durable-admission p95 <100 ms on reference Linux SSD excluding network/model, to be measured.
    - Code Quality: reuse `CheckpointStore` and `LeaseStore`; no new SQL schema by default; explicit non-atomic commit-order recovery proof and conformance for SQLite/PostgreSQL implementations.
    - Security: one-use token hashing, exact ownership, lease loss fail-closed behavior, reauthorization before work/send, no accepted-work eviction, protected payload retention.
  - Approach:
    - Documentation Reviewed: [P3–P6]; `src/contracts-core/persistence.ts:44–128`; [T1] acknowledgment semantics and [S2] receive limits.
    - Options Considered: memory maps (no restart guarantee); custom SQL inbox/outbox (more schema work); bounded existing checkpoint records (chosen); existing ERP outbox for business-transaction hosts (optional, not duplicated).
    - Chosen Approach: freeze record schemas, key namespacing, durable staging/claim/cursor sequence and bounded recovery. Save operations before cursor; CAS before provider work; reply persisted before send. Use fenced receiver/session ownership without claiming fences stop external network calls. Keep final result and reply transitions together where record limits permit.
    - API Notes and Examples: `checkpoints.saveCheckpoint({ namespace, key, ...ownership, expectedVersion: 0, version: 1, value })` creates an operation; later updates use current expected version plus one. No network call inside a storage transaction/critical section.
    - Files to Create/Edit: `packages/prism-core/src/integrations/channels/{state,pairing,delivery}.ts`; `__tests__/state.test.ts`, `__tests__/recovery.test.ts`, `__tests__/postgres.integration.test.ts` in that directory; `docs/messaging-channels.md`; `docs/messaging-channel-operations.md`.
    - References: R2, R3, R5, R7; reuse existing persistence state-concurrency conformance patterns.
  - Test Cases to Write: partial batch commit; cursor failure/replay; duplicate events; forged/colliding ownership keys; pair expiry/double consume; process kill before/after claim/run completion/send; storage unavailable; queue cap; stale receiver; fenced takeover; paused old worker; retention with active/unknown records; pagination under state changes; restart never automatically reruns unknown effects.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, persistence/recovery/pairing contracts and limits.
    - Docs pages to create/edit: `docs/messaging-channels.md`, `docs/messaging-channel-operations.md`; database pages only if existing persistence contracts actually change.
    - `docs/index.md` update: yes, messaging entry plus operations guide under Server/API or Agent/session runtime.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] **Task 4 — Telegram adapter: polling and optional webhook ingress**
  - Acceptance Criteria:
    - Functional: authorized text DM routes to correct session and final reply; durable polling cursor; separately mountable webhook handler; polling/webhook mode cannot run simultaneously for one connection.
    - Performance: intake never waits on model execution; webhook responds only after bounded durable admission; send throttling/chunking honors actual API errors and delay.
    - Code Quality: native fetch and bounded parsers; no framework/bot SDK; explicit network lifecycle and abort; reuse common journal/control handling.
    - Security: independent webhook secret, fixed trusted endpoint, no redirects or token URL leakage; ignore unsupported bots/groups/events; no model-selected destination.
  - Approach:
    - Documentation Reviewed: [T1–T3], [P7] existing Web handler/network patterns.
    - Options Considered: polling only (simple local deployment); webhook only (forces public ingress); one adapter with explicit mutually exclusive modes (chosen); grammY (defer until API/middleware complexity justifies dependency).
    - Chosen Approach: small Bot API subset (`getMe`, `getUpdates`, `sendMessage`, callback acknowledgment, deliberate webhook administration); framework-free receiver handler beside existing Prism handlers. Polling is default, no listener starts itself.
    - API Notes and Examples: section 4 HTTP bodies; webhook validates `X-Telegram-Bot-Api-Secret-Token`, durably admits, returns 2xx; `sendMessage` used separately for observable result IDs.
    - Files to Create/Edit: `packages/prism-core/src/integrations/channels/telegram.ts`; shared `output.ts` if needed by both adapters; `__tests__/telegram.test.ts`; `packages/prism-core/package.json`; `examples/telegram-agent.ts`; `docs/telegram-channel.md`.
    - References: R1/R5/R7; [T1] `Update`, `getUpdates`, `setWebhook`, `sendMessage`, `CallbackQuery`, `ResponseParameters`.
  - Test Cases to Write: duplicate/out-of-order IDs; week-gap update ID; 401/403/429/retry_after; existing webhook; wrong secret; oversized/malformed body; failure before cursor commit; timeout after send; blocked bot; Unicode chunks; bot echo; unsupported media; all error URL variants redacted; unauthorized `/status`; webhook overload not acknowledged as success.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, Telegram subpath, config and ingress.
    - Docs pages to create/edit: `docs/telegram-channel.md`, `docs/messaging-channels.md`, `docs/server.md` for optional mount composition.
    - `docs/index.md` update: yes, Telegram adapter under Third-party integrations.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] **Task 5 — Approval, status and cancellation integration**
  - Acceptance Criteria:
    - Functional: both channels resolve exactly one authorized pending decision; status and cancel work for queued, active and suspended states with truthful outcomes.
    - Performance: control processing independent of prompt backlog; Telegram callback acknowledgment target <1 s with fake transport/load, excluding platform delivery.
    - Code Quality: reuse core versioned decisions/resume and native abort; one shared mapping with adapter presentation only, no checkpoint surgery or parallel decision engine.
    - Security: bind actor/chat/grant/session/run/approval/version/expiry; reject stale/foreign/forwarded controls; recheck identity and current agent policy before side effects.
  - Approach:
    - Documentation Reviewed: [P1,P2], `src/agent-run-lifecycle.ts`, [T1] callback byte limits, [S2] text transport.
    - Options Considered: plain “yes”/reaction (ambiguous, rejected); raw run ID as permission (rejected); opaque short-lived server record (chosen).
    - Chosen Approach: token maps to current `PendingDecision`; per-decision allow_once/reject_once only; safe action summary or authenticated host fallback; reuse reviewed resume/cancellation seam from Task 1.
    - API Notes and Examples: `{ expectedVersion: 3, decisions: [{ approvalId: "<BOUND_PENDING_ID>", outcome: "allow_once" }] }` is core resume input; transport cannot choose ownership or definition revision.
    - Files to Create/Edit: `packages/prism-core/src/integrations/channels/approvals.ts`; runtime and adapter files; `__tests__/approvals.test.ts`; `docs/messaging-channels.md`, `docs/telegram-channel.md`, `docs/signal-channel.md` when Signal ships. Generic resume changes, if proven necessary, belong to Task 2.
    - References: R4/R6; fingerprint/version/dispatched checks in `agent-run-lifecycle.ts:173–353`.
  - Test Cases to Write: duplicate click; wrong sender/chat/tenant; token forwarding/expiry/revoke; changed agent/tool schema; partial decisions bump version; restart while suspended; cancellation during resume; no prior-turn text leak; denied versus aborted status; unsupported elicitation remains blocked.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, channel controls and approval rules.
    - Docs pages to create/edit: `docs/messaging-channels.md` and each implemented adapter page.
    - `docs/index.md` update: yes, messaging description includes authorized controls/approvals.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] **Task 6 — Experimental Signal adapter and policy/compatibility gate**
  - Acceptance Criteria:
    - Functional: paired text DMs and replies via pinned signal-cli socket; explicit start/stop/manual subscription; health distinguishes bridge, subscription and account failures.
    - Performance: persistent daemon/socket, not process-per-message; bounded frames/RPC map/reconnect; benchmark memory during soak without promising lossless intake.
    - Code Quality: version-pinned fixtures and documented binary matrix; transport isolated in explicit Node subpath; no binary download/spawn dependency or custom Signal protocol.
    - Security: policy/license decision recorded before supported release; private socket/state, identity-change denial, no registration or arbitrary RPC/recipient from chat, no key material in telemetry.
  - Approach:
    - Documentation Reviewed: [S1–S3], pinned CLI manual; [P2,P5] identity/credential boundaries.
    - Options Considered: direct signal-cli JSON-RPC (chosen); REST wrapper (extra service boundary); Desktop UI automation/custom cryptography (rejected).
    - Chosen Approach: host owns external bridge, runtime subscribes after durable writer readiness. Normalize pinned envelopes and explicitly classify unsupported events. Stop receiving when writer unavailable; document remaining crash window and experimental status.
    - API Notes and Examples: `subscribeReceive`, `unsubscribeReceive`, `send` and Unix-socket command in section 4; manual notifications use `params.result.envelope`.
    - Files to Create/Edit: `packages/prism-core/src/integrations/channels/signal.ts`; `__tests__/signal.test.ts`; `__tests__/fixtures/signal/` pinned sanitized JSON; `packages/prism-core/package.json`; `examples/signal-agent.ts`; `docs/signal-channel.md`; `docs/messaging-channel-operations.md`.
    - References: R2/R5/R7; Signal version/policy/reliability requirements in section 4.
  - Test Cases to Write: UUID sender without phone number; sync/receipt/reaction/group filtering; manual wrapper; account mismatch; disconnect before/after subscription; kill between receipt and commit; storage unavailable; ambiguous send; changed identity; rate limit/CAPTCHA/relink errors; oversized frame; no import spawn/network; unrelated socket RPC never exposed to chat.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, Signal subpath, configuration and experimental contract.
    - Docs pages to create/edit: `docs/signal-channel.md`, `docs/messaging-channel-operations.md`, `docs/messaging-channels.md`.
    - `docs/index.md` update: yes, Signal entry explicitly says experimental/unofficial bridge.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] **Task 7 — Host examples, deployment and fault-injection verification**
  - Acceptance Criteria:
    - Functional: network-free end-to-end example plus opt-in live Telegram/Signal examples; SQLite reopen and PostgreSQL conformance; shutdown/drain/revoke/reconcile demonstrated without another application.
    - Performance: measure configured caps, local admission target and bounded memory; proposed 72-hour operator-gated soak; no idle/unstarted background work, unbounded scans or retained subscribers.
    - Code Quality: TypeScript examples compile; tests use existing Node test harness/fake fetch/socket patterns; live tests skip without explicit credentials and target consent.
    - Security: no live contact/account creation by default; redacted fixtures, least-privilege host recipe, protected state, graceful lease loss and authenticated admin operations.
  - Approach:
    - Documentation Reviewed: [P3–P8], `docs/testing.md`, `docs/live-testing.md`, current root/package test scripts.
    - Options Considered: application-specific demo (wrong scope); full UI/CLI product (unnecessary); reusable SDK examples plus operations recipe (chosen).
    - Chosen Approach: mock agent/channel for CI, optional SQLite standalone host, explicit webhook mount example, externally supervised Signal recipe. Exercise process crashes at every claim/cursor/run/send boundary. Confirm no need for a new SQL adapter before claiming persistence support.
    - API Notes and Examples: `createSqlitePersistence({ filename })` supplies `store`/`runLedger` on `AgentConfig`, and `checkpoints`/`leases` to channel runtime; host closes persistence after drain. `npm run typecheck`, `npm run test -w @arnilo/prism-core`, `npm run test:postgres` follow existing build/config gates.
    - Files to Create/Edit: `examples/messaging-agent.ts`, `examples/telegram-agent.ts`, `examples/signal-agent.ts`, `examples/README.md`; `packages/prism-core/src/integrations/channels/__tests__/{end-to-end,telegram-live,signal-live}.test.ts`; `scripts/fixtures/messaging-restart-worker.mjs`; `scripts/live-matrix.json`, `scripts/live.env.example`; `docs/messaging-channel-operations.md`, `docs/live-testing.md`.
    - References: R1–R7, platform setup sections, existing `examples/conversation-durable-replay.ts` and `examples/secure-agent.ts` patterns.
  - Test Cases to Write: mock message -> run -> persisted reply; queue flood; two host instances; shared session arbitration; SIGTERM/abrupt kill; revoke before dispatch/send; state backup/restore; no replayed tool after timeout; unknown outcome review; token rotation; subscriber outage; all secrets absent from logs, diagnostics and packed examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, supported composition, operational limits and live-test configuration.
    - Docs pages to create/edit: `docs/messaging-channel-operations.md`, `docs/live-testing.md`, `docs/messaging-channels.md`.
    - `docs/index.md` update: yes, operations and testing descriptions for supported channel deployment.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] **Task 8 — Packaging, current-contract documentation and final verification**
  - Acceptance Criteria:
    - Functional: new subpaths load from packed package with only declared peers; unrelated/root/Telegram imports never load Signal socket code or require optional DB peers; all documented examples match implementation.
    - Performance: existing startup/export budgets pass; any adjustment is measured/justified, not blanket budget inflation.
    - Code Quality: typecheck, lint, format, relevant unit/integration/security/docs/package gates pass; reconcile exact export inventory and refresh graph after code work. No automatic publish/version bump from this proposal.
    - Security: default tests remain offline; secret scan clean; Signal support claims match policy and crash tests; unresolved blockers remain visible, not relabeled passing.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`, `docs/peer-dependencies.md`, `docs/options-index.md`, `.agents/skills/create-plan/references/prism-wiki.md`, current manifest/scripts and implementation evidence.
    - Options Considered: docs only in package README (insufficient); scattered release recaps (wrong docs contract); canonical `/docs` plus thin README/index links (chosen).
    - Chosen Approach: one final current-contract/source reconciliation covering API inputs/outputs/examples/config/security/performance/related pages. Historical design remains in `docs/history`; release deltas go to changelog when assigned. Keep tests/reference examples in package truth without adding a new family package.
    - API Notes and Examples: run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run pack:dry-run`; include relevant security suites and configured database/live probes. Packed smoke tests import each proposed subpath with network/spawn traps.
    - Files to Create/Edit: `packages/prism-core/package.json`, `packages/prism-core/README.md`; `src/__tests__/{docs,packaging,install-smoke,public-export-contract}.test.ts`; `packages/prism-core/src/__tests__/core-conformance.test.ts`; relevant package-map/export-truth scripts identified in Task 1; `docs/{index,core,options-index,peer-dependencies,messaging-channels,telegram-channel,signal-channel,messaging-channel-operations}.md`; assigned changelog entries; this plan and `plans/README.md` task/status; graph output after implementation.
    - References: task test evidence, current package exports and all source links in this proposal.
  - Test Cases to Write: tarball imports with absent optional peers; no root/Telegram Signal transitive load; SDK example compilation; docs/index links and export truth; no secrets/raw vendor fixtures in tarball; cold import budget regression; failure/skip evidence classified correctly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, final distributable subpaths and documented support/peer surface.
    - Docs pages to create/edit: canonical adapter/common/operations pages plus `docs/core.md`, `docs/options-index.md`, `docs/peer-dependencies.md`; current-contract sections, no historical recap.
    - `docs/index.md` update: yes, final one-sentence functional entries for messaging, Telegram, experimental Signal and operations.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## 6. Sequencing, estimates and acceptance gates

Sequence: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8. Signal policy/account feasibility can be reviewed during Task 1; Telegram release need not wait for Signal approval. Task 5 common controls can be tested with fake adapters before Signal implementation.

Planning estimate for one engineer familiar with Prism, not measured commitment:

| Work | Engineer-days |
| --- | ---: |
| Primitive/security/API review | 2–3 |
| Common runtime, authorization and durable state | 5–8 |
| Telegram polling/webhook/text adapter | 3–5 |
| Durable controls/approval integration | 2–4 |
| Signal adapter and pinned compatibility checks | 4–6 |
| Examples, fault testing, package/docs verification | 4–6 |
| **Total** | **20–32 (~4–7 working weeks)** |

Signal policy/account issues or newly demonstrated core gaps may extend calendar time. A tool-free Telegram pilot is smaller than the whole release; groups/media/voice and a complete management UI are not included in this estimate.

**Completion gates:**

- A standalone Prism host demonstrates both channels without another application's runtime or API.
- Unauthorized sender, foreign session and stale approval produce zero provider/tool calls.
- Correct owned history survives restart; independent sessions can run concurrently within bounds.
- Known admitted Telegram updates survive tested crash boundaries without automatic duplicate agent execution; ambiguous states are explicit.
- Send failure never reruns tools; accepted-send ambiguity is not reported as definitely undelivered or read.
- Signal limitations, license, policy and exact supported binary versions are documented and tested; no unsupported lossless/E2EE-through-LLM claim.
- Secure initial/resume identity and policy checks pass; output contains only authorized current-run text/status.
- Unstarted integration does no network/subprocess/storage work. Default tests are network-free; package/docs/export gates pass.

## Compromises Made

Known proposal constraints, not completed implementation decisions:

- DM/text first; Telegram officially supported path, Signal experimental and externally operated.
- Existing optional family subpaths and checkpoint/lease primitives, not a new package, SQL schema or queue dependency.
- Direct session execution by default; full conversation management remains existing optional service.
- Bounded small-host reference journal; measured high-throughput or business-transaction needs can justify the existing PostgreSQL outbox composition later. Mark any real implementation scan/throughput ceiling with a `ponytail:` comment and upgrade path.
- No exactly-once claim and no established lossless Signal intake; ambiguous side effects require evidence-based review.

## Further Actions

To be filled after implementation and tests pass. Follow-on candidates, not required tasks: group/topic ownership policy; Telegram draft streaming; bounded image/document attachments; voice-note transcription/synthesis using Prism's existing modality APIs; proactive opt-in completion notifications; optional shared business-transaction outbox composition. Each needs its own security, retention, budget and delivery review.

## Sources

Primary platform documentation and local source were rechecked for this replacement. No accounts, messages, installs of Signal binaries, credentials, live integrations or performance benchmarks were used. New API names/defaults above are proposed, not claims about existing exports.

### Prism

- **[P1]** `docs/agent-session-runtime.md`; source spans in section 2 — direct sessions, results, concurrency, secure composition, interruption/resume.
- **[P2]** `docs/agent-identity.md`, `docs/host-security.md` — host verification, ownership, scope narrowing, side-effect policy.
- **[P3]** `docs/conversations.md`; `packages/prism-core/src/runtime/server/conversations.ts:110–340` — existing conversation service, request-id semantics and secure composition limitation.
- **[P4]** `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/database-persistence.md`; `src/contracts-core/persistence.ts:44–128` — exact checkpoint/lease contracts; manifests determine current peers.
- **[P5]** `docs/credentials-and-redaction.md`, `docs/credential-storage.md` — explicit credential sources, late resolution and exact-secret redaction.
- **[P6]** `docs/enterprise-postgres-state.md`; `packages/prism-core/src/enterprise/postgres/erp-messaging.ts:44–69` — existing transactional inbox/outbox and unknown outcomes.
- **[P7]** `docs/server.md`, `docs/operations.md` — explicit Web handlers, no auto listeners, deployment and non-durable webhook boundaries.
- **[P8]** `docs/testing.md`, `docs/live-testing.md`, root/package manifests — existing test and package conventions, Node >=22 baseline.

### Telegram

- **[T1]** Official Bot API: https://core.telegram.org/bots/api — `getUpdates`, `Update`, `setWebhook`, `sendMessage`, `CallbackQuery`, `InlineKeyboardButton`, `ResponseParameters`. Current official facts directly fetched; Context7 resolved `/websites/core_telegram_bots` and queried acknowledgment/webhook semantics.
- **[T2]** Bots FAQ and setup: https://core.telegram.org/bots/faq and https://core.telegram.org/bots — user-initiated contact, ordinary rate guidance, webhook inline-response limitations. Prefer current API reference where older FAQ statements conflict.
- **[T3]** Deep linking and privacy: https://core.telegram.org/bots/features#deep-linking and https://telegram.org/faq#q-how-are-secret-chats-different .

### Signal

- **[S1]** Pinned signal-cli README: https://github.com/AsamK/signal-cli/blob/v0.14.8/README.md — unofficial status, JRE/native requirements, linking/registration, maintenance and GPLv3. Retrieved directly via raw GitHub.
- **[S2]** Pinned JSON-RPC manual: https://github.com/AsamK/signal-cli/blob/v0.14.8/man/signal-cli-jsonrpc.5.adoc — manual subscription, notification envelope, send, account selection and HTTP health scope. CLI flags must also be checked against https://github.com/AsamK/signal-cli/blob/v0.14.8/man/signal-cli.1.adoc before implementation.
- **[S3]** Signal terms: https://signal.org/legal/ — acceptable use, impermissible automated messaging, account security and service termination. Policy review here is a requirement, not legal advice or evidence of Signal approval.
