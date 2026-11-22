# @arnilo/prism-hosts/channels

Host library connecting one Prism `Agent` to Telegram, Signal, Slack, and Discord messaging channels without building another agent runtime, conversation store, or turn queue.

## Overview

- **One Agent per connection** — `connectTelegram(agent, options)`, `connectSignal(agent, options)`, `connectSlack(agent, options)`, and `connectDiscord(agent, options)` bind one host-configured Prism `Agent` directly to chat transports. Each inbound conversation binds to `agent.session({ id })` in the channel state store and runs turns through `session.run(text, { interactive: false })`.
- **Durable journal** — bindings, `/new` generations, admission deduplication, claims, and staged replies live in host-owned checkpoint and lease stores. Recovery is explicit via `reconcile()`, never an uncoordinated replay. The package declares the two store shapes it accepts locally (`src/checkpoint-contract.ts`, not re-exported) instead of depending on the workflows engine that owns the `checkpoints`/`leases` services.
- **Durable approvals** — when a tool call suspends the run (`RunResult.pending`), opaque one-use controls bind the decision to the external sender, conversation, and expiry. Telegram renders inline callback buttons; Slack renders Block Kit buttons; Discord renders message-component buttons; Signal renders `/approve <token>` and `/deny <token>` commands. The user's reply maps directly to `session.resume(decisions, { interactive: false })`.
- **Ref-only credentials** — Telegram bot tokens, the Telegram `webhookSecret`, and Signal account credentials MUST be references (`env:<VAR>` or `keyring:<KEY>`), resolved through the agent's assigned credentials slot (`AgentConfig.slots.credentials`, else the kernel's `env:` resolver). Literal credentials fail immediately at connection time with `ChannelTokenLiteralError` (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`). The low-level `createTelegramAdapter` / `createTelegramWebhookHandler` take `botToken` and `webhookSecret` as a `ChannelSecretSource` (`() => Promise<string>`), never a literal string. Tokens and webhook secrets never leak into delivered messages, errors, or diagnostics.
- **Deny by default** — transport inputs are never trusted implicitly. Inbound updates pass through host authorization (`authorize`), verified principal identity, and ownership scopes before any session work begins.
- **Streaming previews** — opt-in drafts (`sendDrafts: true`) forward partial text through Telegram `sendMessageDraft` previews while the turn is generating. Previews are never journaled and never replace the final reply.
- **Bounded attachments** — attachments carry identifiers only (kinds, transport file IDs, byte counts), never raw bodies or URLs. Inbound voice and document text resolve through host transcribe and extraction hooks before admission.

## Answering `HostUi` requests

`channelHostUi({ connection, chat, ownership, kinds? })` lets a paired Telegram or Signal chat answer questions from another agent. Replies pass through the connection's existing `authorize` callback and never start a channel agent turn.

```ts
import { channelHostUi, connectTelegram, createChannelPairingStore } from "@arnilo/prism-hosts/channels";

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
import { connectTelegram } from "@arnilo/prism-hosts/channels/telegram";

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
import { connectSignal } from "@arnilo/prism-hosts/channels/signal";

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

### Slack

```ts
import { connectSlack } from "@arnilo/prism-hosts/channels/slack";

const slack = await connectSlack(agent, {
  token: "env:SLACK_BOT_TOKEN",                 // xoxb- bot token
  signingSecret: "env:SLACK_SIGNING_SECRET",    // Events API over HTTP
  // appToken: "env:SLACK_APP_TOKEN",           // or Socket Mode (xapp-, connections:write)
  checkpoints, leases,
  authorize: (input) => allowList.has(input.externalActorId) && { identity: identityFor(input), grantRevision: "1" },
});
Bun.serve({ port: 8791, fetch: (request) => slack.handle(request) }); // Events API
await slack.start();                                                   // Socket Mode only
```

- **Setup.** Create a Slack app with the bot scopes `app_mentions:read`, `chat:write`, and `im:history`, and subscribe to the `app_mention` and `message.im` bot events. For the Events API, point Event Subscriptions and Interactivity at the mounted handler. For Socket Mode, enable it and pass an app-level token with `connections:write` instead; no public URL is needed. Both transports feed one parser.
- **Verification.** Over HTTP every request is checked before its body is parsed: `X-Slack-Signature` must be the HMAC-SHA256 of `v0:<timestamp>:<raw body>` under the signing secret, compared in constant time, and the timestamp must be within 5 minutes. Anything else answers 401, including every request when no `signingSecret` is configured. The `url_verification` challenge is answered only when signed. Socket Mode trusts the socket opened with the app token.
- **Acknowledgement.** The capability is `acknowledgement: "deadline"`: each event is admitted (authorized and claimed in the journal) and then acknowledged, within Slack's 3-second rule. A retryable admission (`capacity`, `unavailable`, `stopped`) answers 503, or leaves the Socket Mode envelope unacknowledged, so Slack redelivers.
- **Events.** Only `app_mention` and direct messages (`message` with `channel_type: "im"`) start turns. Events with `bot_id` or any `subtype` (edits, joins, file shares, the bot's own messages) are ignored. Events deduplicate on `event_id`, so a Slack retry runs once; a button click deduplicates on message ts + action ts + user.
- **Binding.** `externalConversationId` is `<team>:<channel>` and `externalActorId` is `<team>:<user>`; `claims.teamId` and `claims.channelType` carry the rest. A mention starts (or continues) a thread on its message, and each thread is its own session. A DM is one session unless the user replies in a thread. A follow-up in a channel thread must mention the bot again. Slack treats a leading `/` as a slash command, so `!new`, `!status`, `!cancel`, `!help`, and `!answer` are accepted for the runtime commands.
- **Deny by default.** `authorize` is required. Without it every event is denied; Slack never falls back to the runtime's open default.
- **Replies.** Replies post in the bound thread with `chat.postMessage`, split at 40,000 characters (3,000 when buttons are attached, the Block Kit section limit), with `&`, `<`, and `>` escaped so model text cannot ping `@channel` or forge links, and with link unfurling off. A 429 is waited out for its `Retry-After` (at most 60 s, 5 attempts); delivery is journaled and reconciled like Telegram's.
- **Approvals.** The decision the runtime presents renders as Allow once / Deny buttons. A click is honored only from the bound user in the bound conversation and thread, before `approvalTtlMs`, once.
- **Previews.** With `sendDrafts: true`, one preview message shows the tail of the answer, updated with `chat.update` at most once per `draftIntervalMs` (default 1,000). It is deleted with `chat.delete` after the reply is delivered. A preview write that fails is dropped.
- **Not supported.** Slack file attachments are not read, and thread replies without a mention are not admitted.

### Discord

```ts
import { connectDiscord } from "@arnilo/prism-hosts/channels/discord";

const discord = await connectDiscord(agent, {
  token: "env:DISCORD_BOT_TOKEN", applicationId: "1234567890",
  // publicKey: "env:DISCORD_PUBLIC_KEY",       // only with an Interactions Endpoint URL
  checkpoints, leases,
  authorize: (input) => allowed(input.externalActorId) && { identity: identityFor(input), grantRevision: "1" },
});
await discord.start(); // opens the Gateway and resolves on READY
// Optional Interactions endpoint: Bun.serve({ port: 8792, fetch: (request) => discord.handle(request) });
```

- **Setup.** Create an application with a bot, enable the privileged **Message Content** intent in the developer portal, and invite the bot with the `Send Messages`, `Read Message History`, and `Send Messages in Threads` permissions. The connection identifies with `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and `MESSAGE_CONTENT` (`DISCORD_GATEWAY_INTENTS`). Without Message Content, guild text arrives empty except for mentions.
- **Gateway.** `start()` reads `GET /gateway/bot`, connects to Gateway v10, and resolves on READY. The client sends the first heartbeat after `heartbeat_interval × jitter`, treats a missed ACK as a dead connection, and resumes on `resume_gateway_url` with the last sequence. It resumes on op 7, identifies afresh on op 9 with `d: false` (or close 4007/4009), and reconnects with backoff (1 s doubling to 30 s). A fatal close (4004 bad token, 4014 intents not enabled, and the other 401x codes) stops reconnecting; before READY it rejects `start()`. The only periodic work is the heartbeat.
- **Interactions.** Component clicks arrive over the Gateway by default and are acknowledged with `DEFERRED_UPDATE_MESSAGE` (callback type 6) on the interaction callback route, alongside admission and within Discord's 3-second deadline. With an Interactions Endpoint URL configured, pass `publicKey` (hex, or an `env:`/`keyring:` ref) and mount `handle(request)`: each request is verified with Ed25519 over `X-Signature-Timestamp` + raw body before parsing (and refused outside a 5-minute window), PING answers PONG, and the HTTP response carries the type 6 acknowledgement. Without `publicKey` every request answers 401.
- **Messages.** Guild messages start turns only when they mention the bot; DMs always do. The bot's own messages are always ignored; messages from other bots, system users, and webhooks are ignored unless `allowBots: true`. Only default and reply messages are read. Messages deduplicate on the message id and clicks on the interaction id.
- **Binding.** `externalConversationId` is `<guild>:<channel>` (or `dm:<channel>`) and `externalActorId` is the Discord user id; `claims.guildId` and `claims.channelType` carry the rest. A Discord thread is its own channel, so each thread is its own session. Leading bot mentions are stripped, and `!new`, `!status`, `!cancel`, `!help`, and `!answer` work alongside the `/` forms.
- **Deny by default.** `authorize` is required. Without it every event is denied; Discord never falls back to the runtime's open default.
- **Replies.** Replies post in the bound channel, split at 2,000 characters on code-point boundaries, with `allowed_mentions: { parse: [] }` so model text cannot ping `@everyone`, and with embeds suppressed. Per-route rate-limit buckets are honored: an exhausted bucket (`X-RateLimit-Remaining: 0`) blocks its route until `X-RateLimit-Reset-After`, and a 429 blocks its route (or every route when `global`) for `retry_after` before the send is retried (at most 60 s, 5 attempts). Delivery is journaled and reconciled like Telegram's.
- **Approvals.** The decision the runtime presents renders as Allow once / Deny buttons. A click is honored only from the bound user in the bound conversation, before `approvalTtlMs`, once.
- **Previews.** With `sendDrafts: true`, one preview message shows the tail of the answer, edited at most once per `draftIntervalMs` (default 1,000) and deleted after the reply is delivered.
- **Not supported.** Slash commands, attachments, and sharding. Two processes connected with the same bot both receive every event; the runtime's journal admits each message once.

## Connection Handle

`connectTelegram`, `connectSignal`, `connectSlack`, and `connectDiscord` return a `ChannelConnectionHandle`:

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
- `start()`: begins polling or socket subscription (Discord: opens the Gateway and resolves on READY).
- `drain()`: waits for all in-flight turns and reply deliveries to settle.
- `close()` / `stop()`: closes network listeners and shuts down the channel runtime cleanly.

## Security & Failure Containment

- **Fail-closed authentication**: unverified identities and expired/foreign approval callbacks are immediately rejected.
- **Secret redaction**: bot tokens and credentials are automatically registered with the agent's secret redactor and redacted from logs, traces, and outgoing chat replies.
- **Retried attempts in previews**: `onAssistantDelta` previews are cumulative per run; a provider attempt that ends with `error` drops its text, so the next preview restarts from the retried attempt ([Events](../../../docs/events.md#failed-attempts)).
- **No agent construction**: the channel host library never calls `createAgent` internally; the host constructs the `Agent` and passes it in.

## Examples

- [examples/telegram-agent.ts](../../../examples/telegram-agent.ts) — Telegram bot with polling and webhook mounting.
- [examples/channel-slack.ts](../../../examples/channel-slack.ts) — Slack Events API, signed requests, and an approval button on a scripted Web API.
- [examples/channel-discord.ts](../../../examples/channel-discord.ts) — Discord Gateway handshake, a mention, and a sender-bound approval button on a scripted Gateway and REST API.
- [examples/signal-agent.ts](../../../examples/signal-agent.ts) — Signal adapter over signal-cli.
- [examples/messaging-agent.ts](../../../examples/messaging-agent.ts) — SQLite-backed network-free demo.
- examples/messaging-outbox.ts — PostgreSQL ERP-outbox composition.
