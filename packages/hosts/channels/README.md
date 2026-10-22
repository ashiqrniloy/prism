# @arnilo/prism-channels

Host library connecting one Prism `Agent` to Telegram and Signal messaging channels without building another agent runtime, conversation store, or turn queue.

## Overview

- **One Agent per connection** — `connectTelegram(agent, options)` and `connectSignal(agent, options)` bind one host-configured Prism `Agent` directly to chat transports. Each inbound conversation binds to `agent.session({ id })` in the channel state store and runs turns through `session.run(text, { interactive: false })`.
- **Durable journal** — bindings, `/new` generations, admission deduplication, claims, and staged replies live in host-owned checkpoint and lease stores. Recovery is explicit via `reconcile()`, never an uncoordinated replay. The package declares the two store shapes it accepts locally (`src/checkpoint-contract.ts`, not re-exported) instead of depending on the workflows engine that owns the `checkpoints`/`leases` services.
- **Durable approvals** — when a tool call suspends the run (`RunResult.pending`), opaque one-use controls bind the decision to the external sender, conversation, and expiry. Telegram renders inline callback buttons; Signal renders `/approve <token>` and `/deny <token>` commands. The user's reply maps directly to `session.resume(decisions, { interactive: false })`.
- **Ref-only credentials** — Telegram bot tokens and Signal account credentials MUST be references (`env:<VAR>` or `keyring:<KEY>`). Literal credentials fail immediately at connection time with `ChannelTokenLiteralError` (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`). Tokens never leak into delivered messages, errors, or diagnostics.
- **Deny by default** — transport inputs are never trusted implicitly. Inbound updates pass through host authorization (`authorize`), verified principal identity, and ownership scopes before any session work begins.
- **Streaming previews** — opt-in drafts (`sendDrafts: true`) forward partial text through Telegram `sendMessageDraft` previews while the turn is generating. Previews are never journaled and never replace the final reply.
- **Bounded attachments** — attachments carry identifiers only (kinds, transport file IDs, byte counts), never raw bodies or URLs. Inbound voice and document text resolve through host transcribe and extraction hooks before admission.

## Answering `HostUi` requests

`channelHostUi({ connection, chat, ownership, kinds? })` lets a paired Telegram or Signal chat answer questions from another agent. Replies pass through the connection's existing `authorize` callback and never start a channel agent turn.

```ts
import { channelHostUi, connectTelegram, createChannelPairingStore } from "@arnilo/prism-channels";

// checkpoints, ownership, channelAgent and authorizePairedSender belong to the host.
// The authorizer verifies the exact sender/chat/thread and returns an active identity
// in this ownership scope plus the current grantRevision, or false.
const connection = await connectTelegram(channelAgent, {
  token: "env:TELEGRAM_TOKEN", checkpoints, authorize: authorizePairedSender,
});
const pairings = createChannelPairingStore({ checkpoints });
const pairing = await pairings.create({
  ...ownership, connectionId: "telegram-default",
  externalConversationId: "101", externalActorId: "202", grantRevision: "1",
});
// Consume only after the operator confirms the pairing in a trusted host interface.
const confirmed = await pairings.consume({ ...ownership, connectionId: "telegram-default", token: pairing.token });
if (confirmed.status !== "consumed") throw new Error("Pairing was not confirmed");
const ui = channelHostUi({
  connection, chat: `pair:${pairing.token}`, ownership,
  kinds: ["confirm", "select", "input", "notify"],
});
// Pass ui as another agent's host.ui, or as a routeHostUi route.
const answer = await ui.request({ kind: "confirm", title: "Deploy the release?" });
```

`chat` is a reference to a consumed pairing token in the connection's checkpoint store, scoped to `ownership`; it is not a chat id or alias. Keep the reference in trusted host configuration. `ChannelPairingStore.resolve` reads the confirmed destination; an unconsumed token is refused. The pairing token's initial expiry bounds confirmation; continued use of a consumed pairing requires the authorizer's active grant at the same revision. Revoke or change that grant to disable it. HostUi uses the existing `approval` authorization action, including for notifications. The outbound check supplies the paired ids, a synthetic `ui-...` event id and empty text; it carries no transport claims. Incoming checks carry the actual reply context. Connections constructed by `connectTelegram` or `connectSignal` support this private binding; fabricated connection objects return `unavailable`. Signal must be started before it can send.

| Request | Chat behavior |
| --- | --- |
| `confirm` | Telegram Yes/No buttons; Signal equivalent `/answer <token> 0` or `1` commands. No returns `answered: false`. |
| `select` | Up to eight unique values; Telegram buttons or Signal indexed reply commands. Multi-select lists zero-based indexes and expects `/answer <token> 0,2`. |
| `input` | Prompt expects `/answer <token> <text>` on either transport, so concurrent questions stay distinct. Initial input values are not echoed. |
| `notify` | Sends the message and returns `answered` only when delivery and its journal update succeed. |
| Other kinds | `unavailable`; no outbound message. |

Prompts and labels are plain text, with credential redaction. One bounded message is sent per request: the rendered prompt, including Signal command controls, must fit 2,000 UTF-16 code units and `limits.maxResponseBytes`; overlong prompts/labels return `unavailable`. Both connect functions accept existing channel `limits`, including `approvalTtlMs`, `maxPendingPerBinding`, and `maxPendingPerProcess`. These limits are shared across HostUi instances on the same connection runtime. No dependency or model call is added.

Each question writes a hashed-token correlation record and stages the outbound prompt in the existing delivery journal before sending; settlement consumes the token with CAS. The journal holds outbound prompts and controls, never input answers. Identity, principal, grant revision, ownership, conversation, actor and thread must match at reply time. Missing authorizers, unconfirmed pairings, revoked identities, changed grants, persistence failures and failed delivery fail closed. `/answer` is reserved: malformed, unknown, expired and already-consumed replies cannot become ordinary prompts. An authenticated reply to a settled/expired question gets an expired notice; foreign senders get no notice.

Waiters expire within `approvalTtlMs` (default and hard maximum five minutes) and resolve `unavailable` when the connection closes. A router timeout does not cancel a channel question: late inline answers are discarded by the router, and a fresh suspension offer can duplicate the prompt. Neither transport currently exposes message editing through this library. Waiters and answer values are not persisted; after restart, offer the suspended decision again. Old tokens receive an expired notice and cannot answer the fresh offer. Original channel-owned `/approve` and `/deny` approvals retain their durable resume behavior.

## Usage

### Telegram

```ts
import { createAgent } from "@arnilo/prism";
import { connectTelegram } from "@arnilo/prism-channels/telegram";

const agent = await createAgent({
  id: "support-agent",
  model: "anthropic:claude-3-5-sonnet",
});

// Connect to Telegram using an environment variable reference
const bot = await connectTelegram(agent, {
  token: "env:TELEGRAM_BOT_TOKEN",
  sendDrafts: true,
});

// Long polling
await bot.start();

// Or mount directly into an HTTP server (e.g. Bun.serve / Hono / Node http)
export default {
  port: 8080,
  fetch: (req: Request) => bot.handle(req),
};
```

### Signal

```ts
import { createAgent } from "@arnilo/prism";
import { connectSignal } from "@arnilo/prism-channels/signal";

const agent = await createAgent({
  id: "signal-bot",
  model: "anthropic:claude-3-5-sonnet",
});

// Connect to signal-cli via Unix domain socket
const bot = await connectSignal(agent, {
  account: "env:SIGNAL_ACCOUNT",
  socketPath: "/run/prism/signal.sock",
});

await bot.start();
```

## Connection Handle

Both `connectTelegram` and `connectSignal` return a `ChannelConnectionHandle`:

```ts
export interface ChannelConnectionHandle {
  handle(update: unknown): Promise<unknown>;
  start(): Promise<void>;
  close(): Promise<void>;
  stop(): Promise<void>;
  drain(options?: { readonly deadlineMs?: number }): Promise<ChannelDrainResult>;
}
```

- `handle(update)`: synchronously admits an inbound message, callback query, or webhook Request to the runtime queue and returns an admission result.
- `start()`: begins polling or socket subscription.
- `drain()`: waits for all in-flight turns and reply deliveries to settle.
- `close()` / `stop()`: closes network listeners and shuts down the channel runtime cleanly.

## Security & Failure Containment

- **Fail-closed authentication**: unverified identities and expired/foreign approval callbacks are immediately rejected.
- **Secret redaction**: bot tokens and credentials are automatically registered with the agent's secret redactor and redacted from logs, traces, and outgoing chat replies.
- **No agent construction**: the channel host library never calls `createAgent` internally; the host constructs the `Agent` and passes it in.

## Examples

- [examples/telegram-agent.ts](../../../examples/telegram-agent.ts) — Telegram bot with polling and webhook mounting.
- [examples/signal-agent.ts](../../../examples/signal-agent.ts) — Signal adapter over signal-cli.
- [examples/messaging-agent.ts](../../../examples/messaging-agent.ts) — SQLite-backed network-free demo.
- examples/messaging-outbox.ts — PostgreSQL ERP-outbox composition.
