# Messaging channels

## What it does

`@arnilo/prism-channels` provides transport-neutral contracts and the Prism execution adapter for chat transports. A host authorizes an observed sender, binds them to an owned Prism session, and the runtime runs ordinary turns through the existing `AgentSession` API and projects only the current run's final text back to the bound destination.

The root export ships the runtime, contracts, limits and durable journal. The official Telegram adapter ships as `@arnilo/prism-channels/telegram`; experimental Signal support ships as the isolated Node-only `@arnilo/prism-channels/signal` subpath. Durable single-decision approval controls ship now.

Pass `checkpoints` (and optionally `leases`) to make bindings, admission dedup, the claim before provider work and outgoing replies durable; that is the restart-safe deployment. Without a store the runtime keeps bounded in-process state only — still the correct execution/authorization seam, but restart-unsafe. Recovery mechanics, record layout and the operator runbook: [Messaging channel operations](messaging-channel-operations.md).

## When to use it

Use when a host already operates a chat bot (or plans to) and wants selected Prism agents reachable by chat message without building another agent runtime or conversation database. Telegram admits private DMs by default and group/topic text only when the adapter opts in with `allowGroups` and the host grants the exact chat/thread/sender; Signal (experimental) stays direct-message only. Not for media, voice or proactive broadcasting in the current scope.

## Inputs / request

Install the required `@arnilo/prism` peer plus this package. `createMessagingRuntime` takes `MessagingRuntimeOptions`: `authorize`, `resolveAgent`, `deliver`, optional `limits` (`ChannelLimits`), `redactor`, `checkpoints`, `leases`, and `resolveBinding`. Durable writers are also constructed with `ChannelStateStoreOptions`, `ChannelDeliveryJournalOptions`, and `ChannelPairingStoreOptions`.

```bash
npm install @arnilo/prism @arnilo/prism-channels
```

## Request/response example

```ts
import { createMessagingRuntime } from "@arnilo/prism-channels";

const runtime = createMessagingRuntime({
  // Observed sender + action -> host-verified grant, or `false`.
  authorize: ({ connectionId, externalActorId, action }) => hostGrants.lookup(connectionId, externalActorId, action),
  // Authorized alias -> the host-configured agent for the current identity/ownership.
  resolveAgent: ({ agentAlias, identity, ownership }) => hostAgents.resolve(agentAlias, identity, ownership),
  // Delivery seam: normally the transport adapter's `send`, or a durable outbox.
  deliver: (reply) => transport.send(reply),
  // Optional preview seam: cumulative redacted assistant text while a turn runs (Telegram drafts).
  onAssistantDelta: (delta) => transport.sendDraft?.(delta),
  // Optional media seam: normally the adapter's own bounded `fetchAttachment`.
  // An image becomes model input only when the resolved model declares image input.
  fetchAttachment: (ref) => transport.fetchAttachment(ref),
  limits: { maxPendingPerBinding: 4 },
  redactor: hostRedactor,
  // Durable journal (optional but required for restart safety): any CheckpointStore/LeaseStore,
  // for example createMemoryCheckpointStore(), SQLite or PostgreSQL persistence.
  checkpoints: hostCheckpoints,
  leases: hostLeases,
});

// The adapter calls this before acknowledging transport receipt (Telegram offset / webhook 2xx).
const admission = await runtime.admit(event);
await runtime.drain({ deadlineMs: 5_000 }); // host shutdown / test settle
runtime.diagnostics(); // bounded counters, no text or external ids
await runtime.stop();

// Durable recovery, host-driven and never automatic:
await runtime.listUnresolved({ identity }); // bounded page: operations still needing attention
await runtime.reconcile({ identity, connectionId, operationId, expectedVersion, acknowledgeDuplicateRisk: true });
await runtime.prune({ identity }); // retention sweep; unresolved work is never deleted

// Opt-in host notice to one already-bound pair (no agent run, no tools, no queue):
// the grant must carry `notifications: true`, `notifyId` is the idempotency key.
await runtime.notify({
  identity,
  connectionId: "telegram-main",
  externalConversationId: "8241",
  notifyId: "job-123-done",
  text: "The nightly job finished.",
});
```

## Outputs / response / events

`admit` authorizes first and returns `{ status: "accepted" | "denied" | "unsupported", reason?, operationId?, duplicate? }`. It resolves before any provider call and before the transport acknowledgment; accepted turns then run in the background.

`ChannelInboundEvent` carries only transport-observed fields: `connectionId`, `externalConversationId`, `externalActorId` (stable platform id, never a display name), `eventId` (the transport acknowledgment unit), `text`, optional `threadId`, `attachments`, `claims`, and an adapter-parsed opaque `approval` control. `claims` and transport ids are untrusted context for the host callback only — never authority.

`attachments` are bounded `ChannelAttachmentRef` values (`kind: "image" | "document" | "voice"`, transport file id, optional mime/size/name) — identifiers, never bytes and never model-selected. Voice and document become turn text in the adapter through host hooks (`transcribe`, `extractDocumentText`); only an `image` can become model input, and only when the resolved agent's model declares `image` input *and* the host wired `MessagingRuntimeOptions.fetchAttachment` (normally the adapter's `fetchAttachment`). Then the runtime fetches the current event's refs once, bounded by the channel cap, builds one image content block per ref next to the text, and stores nothing: an undeclared modality, a missing seam or a failed fetch produces `unsupported_media` with a bounded notice and no provider call. Declared attachment bytes above `maxAttachmentBytes` are denied (`reason: "oversized"`) before any fetch.

`MessagingRuntimeOptions.onAssistantDelta` is the optional outbound preview seam: while a turn runs, the runtime forwards the cumulative assistant text of the current message, already redacted with the reply `redactor`, as `ChannelAssistantDelta` (`connectionId`, `externalConversationId`, optional `threadId`, `text`). It fires once per streamed text chunk, only for turns that actually reach the provider, stops at cancel or `stop()`, and resets per assistant message so a tool-call preamble never leaks into the following answer. It is not a reply: nothing is journaled, delivery is not tracked, a throwing callback is ignored, and the terminal `ChannelReply` is unchanged. An adapter that has no preview capability simply ignores it.

`MessagingRuntime.notify` is the opt-in reverse direction: the host sends a `notice` (never a `final`) to one already-bound conversation/thread pair, without a model run, a tool call or a queue slot. It takes `identity`, the bound destination and a caller `notifyId`; the grant must be re-checked with `action: "notify"` and carry `notifications: true`, and `notifyId` is the idempotency key (`duplicate: true` on repeat). The notice is redacted, bounded by the reply cap, journaled as an operation of kind `notify` and staged through the same reply journal as an answer — so a crash between the answer and the send never turns into a silent notice and never re-runs anything. There is no broadcast or fan-out input: an unbound pair, another actor's binding, a foreign ownership scope, an ungranted or revoked identity and an unresolvable binding all fail closed with a bounded `reason`.

## Implementation example

Network-free host composition: [`examples/messaging-agent.ts`](../examples/messaging-agent.ts). Telegram: [`examples/telegram-agent.ts`](../examples/telegram-agent.ts). Experimental Signal: [`examples/signal-agent.ts`](../examples/signal-agent.ts).

## Security and performance notes

### Authorization

- `authorize` receives the bounded text and action (`"message"`, `"command"`, or `"approval"`) and must return a host-verified `AgentIdentity` (`verified: true`, non-empty scopes, unexpired, unrevoked) plus permitted `agentAliases` and a `grantRevision`. Anything else fails closed with a bounded `reason` and no provider call.
- Ownership is always derived with `ownershipFromIdentity`; the event, message text and `claims` cannot set or widen it. The run receives the verified `identity` and the runtime never passes a `per-run ownership` override, so `createSecureAgent` defaults cannot be replaced by a channel adapter.
- Every turn re-checks the grant and `assertIdentityActive` before provider work and before delivery: a revoked identity neither runs nor sends, and no reply is sent after revocation.
- Unknown aliases, malformed ids, oversized text, ungranted senders and capacity pressure are denied without provider or tool calls. Cross-tenant errors stay bounded and never reveal whether a foreign session exists.
- **Media boundary.** Attachment refs are validated (count, ids, metadata, safe-integer sizes) and malformed refs are denied `malformed`; sizes above `maxAttachmentBytes` are denied `oversized` before a fetch. The runtime fetches only refs of the event it is running and passes bytes straight into one run call — the same address the model cannot influence. Nothing media-shaped is written to the journal or the delivery seam: operation and reply records stay text-only, and an attachment the host did not opt into produces a bounded notice rather than a prompt-injection surface.

### Execution semantics

- **Binding.** Connection + conversation + thread + actor + alias maps to a deterministic owned session id (`chan-<sha256 prefix>`); the host may supply `resolveBinding` to persist its own mapping. Same display name on another connection or tenant is a different session; `/new` starts a fresh session for the current binding. With `checkpoints`, the binding — including the `/new` generation, the branch leaf and a suspended marker — is journaled and reused after a restart.
- **Serialization.** Turns are serialized per logical session id and bounded per binding, per process and by active-session concurrency. Core sessions do not serialize two runtime objects that share an id, so a channel-only mutex is not shared-session arbitration: if another API can drive the same session, use a shared host admission/lease mechanism instead.
- **Host notices.** `notify` never allocates a binding or a route and never touches the turn queue; it requires an existing binding and re-checks identity, ownership, the `notifications: true` grant flag and the bound alias on every call. When the host has more than one binding for the same pair (the conversation moved alias), the current selection is addressed and anything ambiguous fails closed. Notices count against `maxPendingPerProcess` and reuse the staged-reply path, so a delivery failure is recorded rather than retried.
- **Output.** Only the current run's terminal `succeeded` text is delivered. Failed, aborted or suspended runs send a bounded notice (redacted), never a previous turn's text and never partial deltas. Responses are truncated to the channel response cap.
- **Cancellation.** `/cancel` aborts an active run via its `AbortSignal` and marks queued turns cancelled. For a suspended durable run it submits core's CAS-checked terminal denial; an already dispatched tool is never rolled back. Transport disconnection is not user cancellation; `stop()` marks queued turns cancelled and aborts active runs on host shutdown.
- **Suspension and approval.** A suspended tool decision blocks ordinary turns (`reason: "awaiting_decision"`) and `/new` cannot bypass it. The runtime persists two short-lived opaque controls for the first pending tool decision: `allow_once` and `reject_once`. Each is bound to exact principal, connection, conversation/thread, agent alias/revision, session, run, approval id and checkpoint version. It is consumed atomically before resume; stale, expired, forwarded, replayed or revoked controls fail closed. Resume reauthorizes the sender and resolves current agent policy before core dispatches the decision. Subsequent pending decisions re-suspend and issue fresh controls. Unsupported elicitation stays blocked for authenticated host handling.
- **Controls.** `/help`, `/status`, `/new`, `/agent <alias>` and `/cancel` are the only ordinary commands. `/status` reports only the bound operation state; controls bypass the prompt queue. The experimental Signal adapter maps `/approve <token>` and `/deny <token>` to the same opaque records. Any other slash input (including registry/config mutation) never reaches a model.
- **Durable intake.** With `checkpoints`, every authorized event is recorded before it is acknowledged, deduplicated by connection + event id across processes, and moved `accepted` → `executing` by a compare-and-swap claim *before* the provider is called. A duplicate event is acknowledged with `duplicate: true` and never runs twice; a denial leaves no record behind, so a legitimate retry still works.
- **Durable replies.** A reply is persisted before `deliver` runs, so a crash between the answer and the send never loses it and never reruns the model. An ambiguous send (`deliver` threw) is recorded as `delivery_unknown` and is never resent automatically; only an authorized `reconcile` call with an explicit `acknowledgeDuplicateRisk` resends the persisted text.
- **Crash truth.** A claimed operation whose process died stays unresolved and is never replayed; `reconcile` files it as `execution_unknown`, which is a dead-letter for host review, not a retry. There is no exactly-once claim: side effects already accepted by the platform (or already dispatched tools) are not retractable.

## Extension and configuration notes

`resolveChannelLimits` rejects `ChannelLimits` values outside `[1, hard cap]`.

| Limit | Default | Hard cap |
| --- | --- | --- |
| `maxInputBytes` | 32 KiB | 64 KiB |
| `maxResponseBytes` | 64 KiB | 128 KiB |
| `maxPendingPerBinding` | 8 | 32 |
| `maxPendingPerProcess` | 100 | 500 |
| `maxActiveSessions` | 4 | 16 |
| `maxRoutes` | 1000 | 10000 |
| `maxSeenEventsPerConnection` | 1000 | 10000 |
| `stopDeadlineMs` | 30 s | 5 min |
| `retentionDays` | 7 | 90 |
| `maxJournalPage` | 100 | 500 |
| `maxJournalRecordBytes` | 128 KiB | 512 KiB |
| `leaseTtlMs` | 30 s | 5 min |
| `approvalTtlMs` | 5 min | 5 min |
| `maxAttachmentBytes` | 1 MiB | 4 MiB |

Capacity pressure fails admission (`reason: "capacity"`) instead of evicting accepted work, and an unusable journal fails admission with `reason: "unavailable"` rather than running unclaimed work. Without `checkpoints` the in-process seen-event set is bounded and is not a durable deduplication guarantee.

## Telegram

Use [`@arnilo/prism-channels/telegram`](telegram-channel.md) for explicit long polling or a separately mounted webhook handler. Both require a service-owned receiver lease; polling also persists its offset after `admit` settles. The adapter uses only native `fetch`, resolves the bot token at each transport request, never follows redirects, sends plain text in Unicode-safe chunks, and records timeout/network sends as ambiguous so the durable reply journal never blindly resends them. Private DMs are the default; `allowGroups: true` adds `group`/`supergroup` text (forum topics keep their topic id as `threadId`) and only ever hands observed `(chat, thread?, sender)` tuples to the host `authorize` — membership is never an identity.

## Signal (experimental)

Use [`@arnilo/prism-channels/signal`](signal-channel.md) only with an externally supervised, pinned signal-cli v0.14.8 private Unix socket and an explicit operator acceptable-use/GPL policy attestation. It admits only direct UUID text envelopes after durable writer readiness, pauses on account/storage/lease trouble, sends only to the authorized bound UUID, and does not claim lossless receive or end-to-end encryption through Prism/model providers. Group envelopes are always dropped (no Signal group or topic support).

A network-free host composition is `examples/messaging-agent.ts` (sqlite journal, mock agent, `drain`/`stop`). Telegram polling/webhook helpers live in `examples/telegram-agent.ts`; the experimental Signal helper is `examples/signal-agent.ts`. Opt-in live probes skip without credentials — see [Live and end-to-end testing](live-testing.md).

## Related APIs

- [Telegram channel](telegram-channel.md) — polling, webhook mounting, credentials, limits and failure behavior.
- [Signal channel (experimental)](signal-channel.md) — daemon prerequisites, policy gate, manual subscription and reliability limits.
- [Messaging channel operations](messaging-channel-operations.md) — durable records, recovery, reconciliation and the operator runbook.
- [Agent session runtime](agent-session-runtime.md) — `AgentSession.run`, results, interruption and resume.
- [Agent identity](agent-identity.md) — `AgentIdentity`, `IdentityVerifier`, ownership projection.
- [Host security](host-security.md) — host-owned authority and side-effect policy.
- [Package README](../packages/prism-channels/README.md) — package boundary and peer-only install.