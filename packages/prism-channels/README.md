# @arnilo/prism-channels

Messaging channels for Prism: run selected Prism agents over chat transports without building another agent runtime, conversation store or queue.

- Transport-neutral runtime — authorize an observed sender, bind them to an owned Prism session, run turns through the existing `AgentSession`, project only the current run's final text back to the bound destination.
- Durable journal — bindings, `/new` generations, admission dedup, claims and staged replies live in the host's `CheckpointStore`/`LeaseStore`; recovery is explicit (`reconcile`), never an automatic replay.
- Deny by default — transport fields are never authority; a host grant, verified identity, ownership scope and a re-check before provider work and before every send.
- Durable approvals — opaque one-use controls bind a pending core decision to exact sender, binding, agent revision and expiry; Telegram renders them as callback buttons, the experimental Signal subpath as `/approve` / `/deny` command text.
- Streaming previews — opt-in `MessagingRuntimeOptions.onAssistantDelta` forwards the cumulative redacted answer while a turn runs; the Telegram subpath renders it as ephemeral `sendMessageDraft` previews (coalesced, private-chat only). Previews are never journaled and never replace the final reply.
- Opt-in host notices — `MessagingRuntime.notify({ identity, connectionId, externalConversationId, notifyId, text })` sends one `notice` to one already-bound pair with no agent run and no queue slot: the grant is re-checked with `action: "notify"` and must carry `notifications: true`, `notifyId` is the idempotency key, the text is redacted and bounded, and the reply goes through the same staged journal as an answer. There is no fan-out, no broadcast and no binding creation — unbound, foreign, ambiguous, revoked or ungranted targets fail closed.
- Bounded attachments — events carry refs (id, mime, size, kind), never bytes. The Telegram subpath fetches one capped body per admitted media event: voice goes through a host `transcribe`, documents through a host `extractDocumentText`, and an image reaches the model only when it declares `image` input (via `fetchAttachment`). Oversize and unprocessable media fail closed with a bounded notice, `synthesize` adds an optional voice note next to a final reply, and nothing media-shaped is ever journaled.

```ts
import { createMessagingRuntime } from "@arnilo/prism-channels";

const runtime = createMessagingRuntime({
  authorize,      // observed sender + action -> verified identity/aliases/grant revision, or false
  resolveAgent,   // authorized alias + identity/ownership -> host-configured Agent (re-resolved per turn)
  deliver,        // host delivery seam, normally the adapter's send
  checkpoints,    // durable bindings, admission dedup, claims and staged replies
  leases,         // per-binding fencing
});

const admission = await runtime.admit(event); // accepts/denies before any transport acknowledgment
await runtime.drain();
```

- Peer `@arnilo/prism` (peer) and no third-party peers. Subpaths: `.` (runtime/journal), `./telegram` (Bot API; private DMs by default, opt-in `allowGroups` for granted group/topic text, `sendDrafts` for streaming previews, and `maxAttachmentBytes`/`transcribe`/`synthesize`/`extractDocumentText` for bounded media), `./signal` (experimental signal-cli). Importing `.` or `./telegram` never loads `./signal`. The package adds no I/O at import or factory construction: no listener, poller, subprocess, credential lookup or environment discovery starts on its own.

- Runtime and authorization semantics: [docs/messaging-channels.md](../../docs/messaging-channels.md)
- Telegram polling/webhook transport: [docs/telegram-channel.md](../../docs/telegram-channel.md)
- Signal private-socket transport (experimental): [docs/signal-channel.md](../../docs/signal-channel.md)
- Durable records, recovery and the operator runbook: [docs/messaging-channel-operations.md](../../docs/messaging-channel-operations.md)
- Fault injection and soak: `scripts/fixtures/messaging-restart-worker.mjs` (SIGTERM → `stop()` cancels claimed work; SIGKILL → `reconcile`) and `scripts/fixtures/messaging-soak.mjs --durationMs 3000` (bounded admit/drain/reconcile/prune loop on temp sqlite with a mock provider; the 72h operator recipe is the same script with `--durationMs 259200000`).
- Network-free host demo: [examples/messaging-agent.ts](../../examples/messaging-agent.ts)
