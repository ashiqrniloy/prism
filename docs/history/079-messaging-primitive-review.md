# Plan 079 Task 1 — Messaging Channels: Primitive, Compatibility, and Threat-Model Review

Plan: [079-Prism-Messaging-Channels-Telegram-Signal.md](../../plans/079-Prism-Messaging-Channels-Telegram-Signal.md) Task 1
Baseline reviewed: working tree at `0.7.0` (2026-09-15). The plan text still names the 0.6.0 planning baseline; every source span below was re-verified against the 0.7.0 revision.
Target: Release `0.8.0` (channels moved off the 0.7.0 line; 0.7.0 shipped without them).
Date: 2026-09-15
Boundary update (2026-09-16, user-directed): Task 4 moved the implementation from `@arnilo/prism-core/integrations/channels` to `@arnilo/prism-channels`. The frozen symbol names, options and semantics recorded below still hold; the package specifier does not. The seven primitive probes stay in `prism-core`, because they examine core primitives rather than channels. Everywhere below read `@arnilo/prism-core/integrations/channels` as the pre-Task-4 location.

Executable evidence: [`packages/prism-core/src/__tests__/messaging-primitives.test.ts`](../../packages/prism-core/src/__tests__/messaging-primitives.test.ts) — 7 tests, run with `npm run build --workspace @arnilo/prism-core && node --test "packages/prism-core/dist/__tests__/messaging-primitives.test.js"`.

This is a frozen review record (history). Current-contract documentation for the implemented
subpaths belongs in `docs/` from Task 2 onward.

---

## 1. Executive summary

The review proves the messaging-channel runtime can be built entirely on existing Prism primitives:
`Agent`/`AgentSession` execution, `AgentRunResult`, durable run state, `AgentRunLifecycle`
resume, `AgentIdentity`/`OwnershipScope`, `CheckpointStore`/`LeaseStore`, and
`SecretRedactor`. No second agent engine, conversation store, npm package, provider, or
vendor branch in the core loop is needed.

Six compatibility gates were resolved with executable proofs, and four real limitations were
found that the channel runtime must absorb rather than paper over:

1. `ConversationService.continue()` cannot compose with a secure agent — it always forces
   `ownership` + `redactor` run overrides, which `executeRun` rejects for secure agents.
   **Default execution path is therefore a direct `AgentSession`; conversation-service
   composition is out of scope unless a generic fix is separately authorized.**
2. `RunOptions.idempotencyKey` is append deduplication, not execution deduplication. It
   only collapses an exact retry at the same branch parent; at a new tip the provider runs
   again. **Channel admission must claim the external operation (checkpoint CAS) before
   calling `session.run`.**
3. `createAgentRunLifecycle.resume()` accepts a `signal` but only pre-checks it; unlike
   `resumeStream()` it never threads cancellation into `resumeAgentRun`. **Channel resume
   uses `resumeStream`**, or Task 2 may add the one-line generic signal pass-through.
4. `buildRunResult()` projects the last assistant message in *history*, so failed runs can
   carry a previous turn's text and aborted/suspended runs carry empty or partial text.
   **The channel sends only the current operation's terminal output, never `result.text`
   for non-success statuses.**

Durable-state fit: the generic checkpoint/lease contracts are sufficient, but store
semantics impose three hard design rules — keys must embed tenant/user (ownership mismatch
throws, it does not miss), list pagination is OFFSET-based (unstable under concurrent
writes), and there is no multi-record transaction. Signal's policy/license gate resolves to
"experimental, opt-in, no GPL contagion from a socket client, acceptable-use decision
recorded by the operator before any supported claim".

---

## 2. Verified primitive inventory (0.7.0 revision)

| Primitive | Verified evidence | Reuse decision | Limitation the channel must absorb |
| --- | --- | --- | --- |
| `Agent`, `AgentConfig`, `AgentSessionConfig` | `src/agent-session/create-agent.ts:5-12`; `src/contracts-core/agent.ts:116-155` | Host resolves the agent; channel creates sessions by `{ id, leafId }` only | `AgentSessionConfig` has no ownership/identity field; authority comes from agent config or the run call |
| `AgentSession.run` / `AgentRunResult` | `src/agent-session/session.ts:190-191` (`run` → `randomId("run")`), `session.ts:318-344` (`buildRunResult`); `src/contracts-run-state.ts:284-320` | Direct execution is the default path | Run IDs are generated per call; `result.text` is history-derived (gate 4) |
| Run failure/abort shape | `src/agent-session/session/assemble.ts:462-501`; `src/contracts-run-state.ts:311-320` | Channel keys delivery off `AgentRunError.result.status/error/limit` | Failed runs **throw**; partial content may already be appended |
| Cancellation / abort | `src/agent-session/helpers.ts:155-168` (`bridgeAbort`, `throwIfAborted`); `src/agent-session/session/provider-round.ts:178-186` (`turnRequest.signal`) | Explicit `AbortSignal` propagation is proven end-to-end (probe: cancellation test) | "Cancellation is a request": an already-approved tool dispatch is not rolled back |
| Secure composition | `src/secure-agent.ts:26-80`; `src/agent-session/session/assemble.ts:348-357` | Reuse `createSecureAgent` unchanged; defaults immutable | Per-run `ownership`/`redactor`/`validate`/`effectStore`/`runState` overrides throw `AgentRunStateError` |
| Tool-scope narrowing | `src/tools.ts:170-187` (`selectRunTools`); `src/agent-session/session/assemble.ts:109` | `RunOptions.toolNames` narrows; checkpointed grant intersects on resume | A registry change without a revision bump fails fingerprint check on resume |
| Durable run state | `src/agent-run-state.ts:118-147` (`agentFingerprint`), `171-187` (`loadAgentRunState`), `189-208` (`saveAgentRunState`) | Existing namespace `agent-run-state`, versioned CAS | `AgentRunLifecycleRequest` carries ownership, not caller identity |
| Resume | `src/agent-run-lifecycle.ts:73-86` (`resume`), `88-101` (`resumeStream`), `174-363` (`prepareAgentRunResume`) | `resumeStream` is the channel resume path | Non-stream `resume` drops `signal` (gate 3, demonstrated gap) |
| Approvals / decisions | `src/agent-approval.ts` (`assertValidAgentRunResume`, `pendingDecisionsOf`, `resolveRunDecisions`); `src/agent-run-lifecycle.ts:216-300` | `RunDecision` with `expectedVersion` reuses lifecycle CAS | Partial batches resuspend; denied is terminal, not aborted |
| Ownership / identity | `src/identity.ts` (`assertIdentityActive`, `assertIdentityMatchesOwnership`); `src/contracts-core/persistence.ts:16-21` | `ownershipFromIdentity` projects verified identity to scope | Transport payload fields are never identity; host verifies |
| Conversation service | `packages/prism-core/src/runtime/server/conversations.ts:180-185` (options), `314-338` (`continue`) | **Not** the default execution seam | Incompatible with secure agents (gate 1, proven) |
| Checkpoint store | `src/contracts-core/persistence.ts:44-100`; memory `src/checkpoints.ts:26-89`; SQLite `packages/prism-core/src/sessions/sqlite/checkpoints.ts:114-150`; Postgres `packages/prism-core/src/sessions/postgres/checkpoints.ts:131` | Channel journal records; versioned CAS create `expectedVersion: 0` | Single-record CAS; OFFSET pagination; ownership mismatch throws; memory store evicts at 10 000 records / 1 MiB value |
| Lease store | `src/contracts-core/persistence.ts:105-128` | One receiver per connection; fencing token | Fences protect stored transitions, not a paused process's network side effects |
| Session-store idempotency | `src/contracts-core/session.ts:194-208`; memory `src/session-stores.ts:255-266`; SQLite `packages/prism-core/src/sessions/sqlite/persistence.ts:382-392`; Postgres `.../postgres/persistence.ts:291-301` | Correlation aid only | Dedup key is `(sessionId, idempotencyKey, expectedParentId)` (gate 2) |
| Redaction / credentials | `src/redaction.ts:205-223` (`errorToErrorInfo`), `src/credentials.ts` | `SecretRedactor` at error/event/journal/send boundaries | Exact-secret redaction is not DLP |
| PostgreSQL ERP messaging | `packages/prism-core/src/enterprise/postgres/erp-messaging.ts` | Optional host composition, not a channel requirement | Adds no external-send certainty |

Graph-wide searches for `telegram` and `signal-cli` still return no adapter in the repository.

---

## 3. Compatibility gates — resolution with evidence

### Gate 1 — Conversation vs secure agent (resolved: direct session)

`ConversationService.continue()` resolves the thread, builds a session from `sessionFactory`,
then calls `session.run(message, { ...runOptions, ownership, redactor, idempotencyKey, ... })`
(`conversations.ts:330-338`). `executeRun` rejects exactly those fields for a secure agent
(`assemble.ts:348-357`). Probe evidence:

- `rejects per-run ownership and redactor overrides for a secure agent, including through the
  conversation service` — direct `session.run("go", { ownership })` rejects with
  `AgentRunStateError`; `service.continue()` rejects with
  `"Secure agent defaults cannot be replaced per run"`; provider calls stay at 1.

**Decision:** the channel's default and only MVP execution path is
`agent.createSession({ id, leafId }).run(text, { signal, idempotencyKey })`. The plan's
`runBoundTurn` snippet compiles and is exercised by the reopen probe. Conversation-service
threads may be layered later; that requires an explicitly scoped generic fix (e.g. an opt-out
so the service stops forcing redactor/ownership for an already-secure session) and is not part
of Task 2's default scope.

### Gate 2 — Idempotency is append dedup, not execution dedup (resolved: claim first)

Probe `does not treat idempotencyKey as execution deduplication at a new branch tip`:

- Run 1 succeeds, one provider call. `result.runId` is generated per call.
- Exact retry with the same session id, no leaf, same `idempotencyKey` → rejected with
  `AgentRunError` whose `result.error.code === "session_append_conflict"` and
  `idempotencyDuplicate: true`; provider calls stay 1.
- Same key retried at the advanced tip (`leafId: result.leafId`) → the append is a new
  `(sessionId, key, expectedParentId)` tuple, so the provider runs a second time.

**Decision:** channel admission claims the external operation by checkpoint CAS **before**
`session.run`; `idempotencyKey` is set to the operation ID for correlation and append-level
retry safety only. No exactly-once execution claim.

### Gate 3 — Resume identity, tool scope, limits, cancellation (resolved: lifecycle + stream)

Probe `re-resolves ownership and the current agent definition on durable resume, refusing drift` proves:

- Wrong ownership → `Checkpoint ownership mismatch` before any work.
- Stale `expectedVersion` → `AgentRunStateError`.
- Wrong `agentId` capability → `"Agent run capability mismatch"`.
- Same `definitionRevision` but a widened tool registry → `"Agent definition revision or
  fingerprint mismatch on resume"` (`agentFingerprint` includes tool name/schema/effect,
  instructions, guardrails, loop revision).
- A clean resume re-runs `resolveAgent({ agentId, ownership })` and dispatches the approved
  tool exactly once.

Tool narrowing survives resume through `selectRunTools(listed, options.toolNames, resumed?.state?.toolNames)`
(`assemble.ts:109`): the checkpointed grant is the ceiling, a new request can only intersect it.

**Demonstrated gap:** `createAgentRunLifecycle.resume()` (`agent-run-lifecycle.ts:73-86`)
pre-checks `request.signal` but does not pass it to `resumeAgentRun`; `AgentRunResumeOptions`
(`src/contracts-run-state.ts:229-247`) has no `signal` field at all. Only
`resumeAgentRunStream`/`resumeStream` accept and thread one (`agent-run-lifecycle.ts:99`), and
an early consumer return aborts the resumed run (`agent-run-lifecycle.ts:130-145`).

**Decision:** the channel resolves approval decisions with `lifecycle.resumeStream` (bounded
`maxQueuedEvents` + `overflow: "close"`), which also yields the event evidence the delivery
journal needs. Task 2 may instead add `signal?: AbortSignal` to `AgentRunResumeOptions` and
thread it — a one-field generic fix — but that is not required for MVP.

Probe `cancels resumed work through the resume stream only; non-stream resume drops the signal`:

- Pre-aborted signal on `lifecycle.resume` → rejects, the run stays `suspended`, zero tool
  dispatch.
- Abort during a live resumed provider turn reaches `request.signal` in the in-flight turn,
  ends the run as `aborted`, persists the `aborted` state, and does **not** roll back the
  already-approved dispatch (exactly one call) — matching R4's "cancellation is a request".

### Gate 4 — Final-output provenance (resolved: project current-run output)

Probe `can expose stale or empty result text on failed and suspended runs`:

- Turn 1 succeeds with `answer 1`.
- Turn 2 fails before producing an assistant message: the thrown `AgentRunError.result` has
  `status: "failed"` and **`text: "answer 1"`** — a previous turn's text.
- Turn 3 suspends on a tool approval: `status: "suspended"`, `text: ""` (the tool-call
  assistant message has no text blocks).
- Aborted resume: `text: ""` although the provider yielded a `"partial"` delta.

**Decision:** the channel projects final text from the current operation's terminal event
stream plus persisted run evidence, and sends only for a `succeeded` operation whose output
is the current run's terminal assistant message. Never send `result.text` for `failed`,
`aborted`, `suspended`, `denied`, or `execution_unknown`, and never dump history, thinking
blocks, raw tool arguments, or previous turns.

### Gate 5 — Persistence fit (resolved: bounded journal, no fiction)

| Question | Verified answer | Consequence |
| --- | --- | --- |
| Value size cap | Memory store defaults `maxValueBytes = 1 MiB`, `maxRecords = 10 000` (`src/checkpoints.ts:22-30`); SQLite/Postgres checkpoint tables have no value-size cap | 128 KiB channel record cap is a consumer bound; enforce before save |
| Page size | SQLite and Postgres clamp `limit` to `[1, 500]`, default 100; memory defaults `maxPageSize = 500` | Journal page default 100, hard max 500 |
| Pagination stability | Checkpoint cursors are numeric OFFSETs (`decodeCheckpointCursor`, `src/sessions/codecs/checkpoint.ts:30-34`) | A page walk is not a consistent snapshot under concurrent writes; recovery must resolve explicit keys, not rely on scan completeness |
| Multi-record atomicity | `CheckpointStore` exposes single-record CAS only (`saveCheckpoint`/`loadCheckpoint`/`listCheckpoints`/`deleteCheckpoint`) | Commit order is explicit: operations (with dispositions) before cursor advance; reply before send; replay/dedup on partial batch |
| Ownership keying | Record identity is `namespace + key` (`src/checkpoints.ts:123-125`); a mismatched scope throws `"Checkpoint ownership mismatch"` (`src/checkpoints.ts:151-155`) | Keys must embed connection/tenant/user so a foreign lookup misses; an unscoped key leaks existence via the mismatch error |
| Fencing | `LeaseStore.tryAcquireLease`/`renewLease`/`releaseLease` with monotonic `fencingToken`; checkpoint saves accept a fence | Takeover fences stored transitions; a paused process's already-issued network call is not retracted |

### Gate 6 — Version truth (resolved)

- Root `package.json` is `0.7.0`; `@arnilo/prism-core` is `0.7.0`; root has zero runtime
  dependencies; `@arnilo/prism-core` runtime deps are `@napi-rs/keyring ^2.0.0`, `ajv ^8.17.1`.
- Optional peers: `better-sqlite3 ^13.0.3`, `pg ^8.23.0`, NATS `^3.4.0`, `@arnilo/prism-memory`.
- Node `>=22` engines; export surfaces are declared per subpath in the package manifest (no
  barrel imports of optional drivers).
- The plan's "baseline 0.6.0" sentence is historical; the reviewed revision and the 0.8.0
  target are recorded above. `docs/history/0.7.0-primitive-review.md` remains the prior-line record.

---

## 4. Frozen proposed channel surface

Subpath names are frozen as proposed; Task 2 may refine option **fields** without renaming
symbols or moving transport types into the root package.

| Subpath | Frozen values | Frozen types |
| --- | --- | --- |
| `@arnilo/prism-core/integrations/channels` | `createMessagingRuntime` | `MessagingRuntime`, `MessagingRuntimeOptions`, `MessagingRuntimeDrainResult`, `ChannelAdapter`, `ChannelCapabilities`, `ChannelInboundEvent`, `ChannelReply`, `ChannelSendResult`, `ChannelAuthorizeInput`, `ChannelAuthorization`, `ChannelAgentResolverInput`, `ChannelLimits`, `ChannelAdmission`, `ChannelDiagnostics` |
| `@arnilo/prism-core/integrations/channels/telegram` | `createTelegramAdapter`, `createTelegramWebhookHandler` | `TelegramAdapterOptions`, `TelegramWebhookHandlerOptions` |
| `@arnilo/prism-core/integrations/channels/signal` | `createSignalAdapter` | `SignalAdapterOptions` |

Minimum lifecycle shape fixed for Task 2 (field names may be refined):

```ts
interface ChannelAdapter {
  readonly connectionId: string;
  readonly capabilities: ChannelCapabilities; // { acknowledgement: "telegram_offset" | "none"; controls: "callback" | "command"; maxTextCodeUnits: number }
  start(receive: (event: ChannelInboundEvent) => Promise<void>): Promise<void>;
  send(reply: ChannelReply): Promise<ChannelSendResult>;
  stop(): Promise<void>;
}

interface MessagingRuntime {
  admit(event: ChannelInboundEvent): Promise<ChannelAdmission>; // durable before the adapter confirms transport receipt
  drain(options?: { deadlineMs?: number }): Promise<MessagingRuntimeDrainResult>;
  diagnostics(): ChannelDiagnostics;
  stop(): Promise<void>;
}
```

Rules frozen with the names:

- `admit` resolves authorization and capability binding before any provider call and returns a
  bounded outcome; adapters await it before transport acknowledgment (Telegram offset advance
  or webhook 2xx).
- `ChannelCapabilities.acknowledgement` is `"none"` for Signal — the shared runtime has no
  acknowledgment step it could pretend to honor.
- Transport-specific types never enter root `@arnilo/prism` contracts; no Telegram/Signal
  branch is added to the agent loop.
- Factories perform no I/O; adapters never receive provider or tool registries.
- New subpaths must be added to `packages/prism-core/package.json` exports and pass
  `scripts/budget-gate.test.mjs` export ceilings plus `scripts/phase54-package-map.test.mjs`,
  `scripts/packaging-current.test.mjs`, and `scripts/import-hygiene.test.mjs` before release.

---

## 5. Authority, idempotency, and recovery resolution (R2–R6)

| Requirement | Resolution on verified primitives |
| --- | --- |
| R2 verified identity / scoped grants | Host `authorize(observed sender + action)` returns a verified `AgentIdentity` + exact `OwnershipScope` + alias grant + revision. Ownership is passed to `session.run`/lifecycle requests; identity is on agent config (secure) or run `identity` with `assertIdentityMatchesOwnership`. Transport fields are never trusted directly. |
| R2 pairing | Channel-owned one-use token record in `prism.channels.control.*` with hash, binding, grant revision and 5-minute expiry; confirmation stays in the trusted host interface. |
| R2 key namespacing | Journal/binding keys embed connection + tenant/account/user + external actor so a foreign read misses instead of colliding (`recordKey` is scope-free; mismatch throws). |
| R2 revocation | Re-check grant revision before dispatch, before approval consumption, and before each send; revoke cancels active runs via the same `AbortSignal` seam and blocks future sends. Already-accepted platform effects are not retractable. |
| R3 routing / concurrency | Binding = connection + external conversation + actor grant + alias → owned session + optional leaf. Core gives *no* cross-object serialization (probe: two objects on one session ID both run), so the runtime serializes per logical session ID and bounds process concurrency. |
| R3 shared-session arbitration | If another producer can drive the same session, the host must share the same admission/lease; otherwise the channel refuses shared-session binding. |
| R4 safe execution | Host resolves `AgentConfig`; text cannot replace model/instructions/tools/policy/limits; slash text maps only to the fixed command allow-list; tool-free default example; `createSecureAgent` example for tool use. |
| R4 failed/suspended output | Gate 4: send only the current run's terminal text on `succeeded`. Bound the failure notice and redact it. |
| R4 approval resume | Gate 3: `resumeStream` with bounded subscription and the existing `expectedVersion`/fingerprint checks; approval tokens are opaque server records, `allow_once`/`reject_once` only. |
| R5 durable intake | Checkpoint records in `prism.channels.*`; operation save precedes cursor advance; operation claim via CAS precedes `session.run`; reply persisted before send; `delivery_unknown` on ambiguous send; no automatic rerun of `executing` after crash. |
| R5 evidence-based reconciliation | Only exact-owned run-correlated session/ledger/checkpoint evidence; otherwise `execution_unknown` → host review. |
| R5 ambiguity truth | No exactly-once model/tool execution and no lossless Signal intake claim; operator replay requires authorization + expected version + explicit duplicate-risk acknowledgment. |
| R6 status/cancel | `/status` reads the bound operation/session only; `/cancel` aborts the active run via `AbortSignal` or cancels queued work; suspended runs use the existing CAS-checked denial path and are documented as `denied`, never hand-edited. |
| R7 observability | Bounded diagnostics from runtime counters; no message text, phone numbers, pairing links, token URLs, or key material in logs/metrics; redactor applied at error/event/journal/send boundaries. |

---

## 6. Durable limits and admission strategy (Performance acceptance)

Channel-imposed caps, compatible with the verified store limits (store ceiling in the last
column; the channel cap is the one enforced):

| Resource | Channel default | Hard cap | Store-derived ceiling |
| --- | --- | --- | --- |
| Accepted input text | 32 KiB UTF-8 | 64 KiB | run `maxRequestBytes` (process HARD caps stay) |
| Pending ordinary turns | 8 per binding, 100 per process | 32 / 500 | runtime queue, not store |
| Active independent sessions | 4 per process; same logical session always serial | host-configurable | runtime |
| Outgoing logical response | 64 KiB UTF-8, bounded overflow policy | 128 KiB | platform text limit (Telegram 4096 chars/msg) |
| Channel checkpoint record | 128 KiB encoded JSON after escaping/metadata | 512 KiB | memory store 1 MiB value cap |
| Journal list page | 100 records | 500 records | checkpoint list clamp `[1, 500]` |
| Send attempts | 5 known-retryable | 5 | runtime |
| Pair/control expiry | 5 minutes | host-tightenable | runtime |
| Processed transport payload retention | 7 days | host policy | runtime tombstones |

Admission strategy: in-process serial queue keyed by logical session ID (core provides
none across runtime objects — proven), process-wide concurrency bound, durable CAS claim
before provider work, control messages bypass the prompt queue, and capacity/storage
unavailability fails admission explicitly instead of evicting accepted work. No network or
background work is introduced by this review.

---

## 7. Threat-model resolution

| Threat | Control | Evidence |
| --- | --- | --- |
| Forged transport identity (username, phone string, JSON field) | Host-verified `AgentIdentity` keyed on stable platform IDs; ownership mismatch fails closed | identity contracts; checkpoint ownership probe |
| Cross-tenant session probe | Keyed bindings; ownership mismatch throws; foreign lookups return miss | `src/checkpoints.ts:123-155` |
| Prompt-driven privilege escalation (slash/config/service text) | Fixed command allow-list; text is untrusted input; agent/tools/policy are host-resolved | R4 rules; toolNames/secure guard |
| Replay/duplicate external events | Durable operation dedup by connection-scoped external event key before claim | R5 invariants; checkpoint CAS |
| Crash between claim and provider call | `executing` never auto-rerun; evidence reconciliation or `execution_unknown` | Gate 2 + Gate 5 |
| Ambiguous send (timeout after accept) | `delivery_unknown`; authorized replay with version + duplicate-risk acknowledgment | R5 invariant 6 |
| Second receiver / stale worker | Lease + fencing token; no redispatch of old `sending`/`executing` | lease contract |
| Approval token forwarding/replay | Opaque token bound to principal/connection/chat/session/run/approval/version/grant+expiry; stale/foreign fail closed | R6; lifecycle expectedVersion |
| Secret leakage in errors/logs/URLs | `SecretRedactor` at boundaries; Telegram token URL redaction; Signal key material excluded | `errorToErrorInfo`, redaction contracts |
| GPL obligation from signal-cli | Adapter is a JSON-RPC socket client; no linking, copying, bundling or redistribution of GPL code | signal-cli API surface only |
| Signal acceptable-use violation | DM-only, user-initiated/paired, no bulk or automated registration; operator acceptable-use decision before supported release | Signal terms (below) |

---

## 8. Platform fact re-verification (2026-09-15)

Telegram Bot API facts confirmed against `https://core.telegram.org/bots/api`:

- `getUpdates` and webhooks are mutually exclusive; an outgoing webhook makes `getUpdates`
  fail, and a set webhook blocks `getUpdates`.
- Updates are stored until received but not longer than 24 hours.
- `offset` must be one higher than the highest received `update_id`; an offset above an
  `update_id` confirms it; negative offsets forget prior updates.
- `getUpdates.limit` accepts 1–100 (default 100); `timeout` is the long-poll seconds.
- `sendMessage.text` is 1–4096 characters after entity parsing.
- `callback_data` is 1–64 bytes.
- `setWebhook.secret_token` is 1–256 chars from `A-Za-z0-9_-`, delivered as
  `X-Telegram-Bot-Api-Secret-Token`.
- `ResponseParameters.retry_after` is the flood-control wait in seconds.
- All calls use `https://api.telegram.org/bot<token>/METHOD_NAME` — the token is always in
  the URL path, so URL redaction is mandatory.
- The page no longer supports a blanket "bots never see other bots" assumption (bot-to-bot
  communication exists when both sides enable it), so bot-origin updates are filtered
  explicitly rather than assumed impossible.

signal-cli v0.14.8 facts confirmed against the pinned tag:

- Repository description: "unofficial commandline, JSON-RPC and dbus interface for the
  Signal messenger"; license GPL-3.0.
- JVM distribution requires "at least Java Runtime Environment (JRE) 25".
- "signal-cli releases older than three months may not work correctly" — the pinned version
  is a researched baseline, not a floating download.
- Registering "will unregister any existing client associated with the same number" —
  registration/relinking is never automated from chat.
- `--receive-mode=manual` disables automatic receiving; `subscribeReceive` starts receiving
  and returns a subscription id; manual notifications are wrapped as
  `params.result.envelope`; `unsubscribeReceive` stops the subscription.
- `send` takes `recipient`/`message`; no application-acknowledged receive log or replay
  guarantee is documented, and `GET /api/v1/check` only reports daemon liveness.
- No single-receiver guarantee: one receiver per account is a host operating rule.

Signal legal facts confirmed against `https://signal.org/legal/`:

- Users must not use the service in ways that "involve sending illegal or impermissible
  communications such as bulk messaging, auto-messaging, and auto-dialing".
- Accounts must not be created "through unauthorized or automated means".
- Signal "may modify, suspend, or terminate your access ... if you violate the letter or
  spirit of our Terms".

**Policy/license gate resolution:** Signal support ships only as experimental/opt-in,
externally supervised, DM-only, with no automated registration, no bulk or proactive
broadcast, and an operator-recorded acceptable-use decision before any "supported" claim.
The GPLv3 obligation is not triggered by a JSON-RPC client over a Unix socket; distribution
must not bundle or redistribute the binary or patched libraries. Prism remains MIT.

---

## 9. New seams justified

| New seam | Why the primitives do not already cover it | Explicitly not created |
| --- | --- | --- |
| Channel envelope/event/reply types | Transport-neutral mapping for two transports with different receipt/ack semantics | No transport objects in core contracts |
| `ChannelAdapter` interface | Two real implementations; receive/send/capabilities/start/stop vary | No third abstraction layer or plugin registry |
| `MessagingRuntime` facade | Admission, per-session serialization, diagnostics, drain are not in core | No second agent runtime; execution stays `AgentSession` |
| Journal record schemas (`prism.channels.*`) | Core has no operation/delivery state machine | No new SQL schema; no duplicate conversation model |
| Pairing/token mapping | Transport controls must become existing `RunDecision`s | No channel-specific approval engine |
| Telegram/Signal wire clients | Vendor protocols | No bot SDK dependency, no provider, no model router |

Core changes are **not** proposed by this review. The only demonstrated generic gap
(`resume` signal pass-through) has a working alternative (`resumeStream`) and stays a Task 2
conditional item; any core fix must be generic and regression-tested.

---

## 10. Evidence and reproduction

Executable evidence (7 passing tests):

```sh
npm run build --workspace @arnilo/prism-core
node --test "packages/prism-core/dist/integrations/channels/__tests__/primitives.test.js"
```

Covered proofs: store reopen + two turns via the proposed `runBoundTurn`; two runtime
objects on one logical session ID both execute; secure override conflict direct and through
`createConversationService`; resume ownership/version/agentId/fingerprint drift refusal plus
approved-dispatch-once; pre-abort leaves the run suspended and zero side effects; stream
resume abort reaches the provider turn, persists `aborted`, and does not roll back the
approved dispatch; `idempotencyKey` dedup exact-retry only and run IDs per call; stale/empty
result text on failed/suspended/aborted runs.

Task 4 moved the test to `packages/prism-core/src/__tests__/messaging-primitives.test.ts` and
adds its explicit `dist/__tests__/messaging-primitives.test.js` entry to the prism-core package
test script. The other nested prism-core suites (`runtime/server`, `sessions/*`, `governance/*`)
still expose the pre-existing shell-glob topology gap: `dist/**/__tests__/*.test.js` collapses
to one level under the shell. Run this review's evidence with the explicit command above; Node's
own quoted glob (`node --test "packages/prism-core/dist/**/__tests__/*.test.js"`) also matches
nested paths.