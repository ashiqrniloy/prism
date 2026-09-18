# Telegram channel

## What it does

`@arnilo/prism-channels/telegram` is framework-free Telegram Bot API transport for text, with bounded attachment handling. It uses native `fetch`; importing it or creating a factory starts no listener, poller, credential lookup, environment lookup, or network request.

## When to use it

Use for official Telegram Bot API text and bounded media. Private DMs are the default; group/supergroup text (including forum topics) is opt-in per adapter with `allowGroups: true` and stays subject to host `authorize`. Optional ephemeral streaming previews (`sendDrafts`) are private-chat only. Opt-in host hooks add voice transcription, document extraction and speech synthesis; images reach a model only when it declares image input. Not for Secret Chats, unbounded or stored media, or model-selected destinations.

Install peer and channel package:

```bash
npm install @arnilo/prism @arnilo/prism-channels
```

## Inputs / request

`TelegramAdapterOptions` (polling): host `connectionId`, `botToken` (`CredentialValueSource`), service-owned `checkpoints`/`leases`/`cursorOwnership`, optional `allowGroups`, `sendDrafts`, `maxAttachmentBytes`, `transcribe`, `synthesize` and `extractDocumentText`. `TelegramWebhookHandlerOptions` add independent `webhookSecret` and the `admit` callback (intake only — outbound sends, drafts and `fetchAttachment` use an adapter instance, which works without `start()`). Importing or constructing starts no network.

## Request/response example

Polling is explicit and restart-safe only with a service-owned `CheckpointStore` cursor and `LeaseStore` receiver lease. `start()` verifies the token with `getMe`, refuses to poll if `getWebhookInfo` reports an existing webhook, then runs 30-second `getUpdates` requests. It accepts private `message.text`/`caption` updates from non-bot senders, plus `group`/`supergroup` text and media when `allowGroups: true`. `photo`, `voice` and `document` become bounded attachment *refs* — see [Attachments and voice](#attachments-and-voice). Service, edit and bot-echo updates are acknowledged without agent execution, as are channel/anonymous-admin `sender_chat` messages and forum topics that fail the host grant.

A parsed group message keeps the admission keys transport-exact: `externalConversationId` is the chat id (negative for groups), `externalActorId` is `from.id`, and `message_thread_id` becomes `threadId`. Only `claims` carry untrusted context (`chatType`, `isForum`, `forwarded`), and `authorize` receives them so a host can refuse forwarded messages or non-forum groups. Threads and senders are separate sessions and separate grants: a grant for `(chat A, topic 7, user X)` admits neither user Y, chat B, nor topic 8.

```ts
import { createMessagingRuntime } from "@arnilo/prism-channels";
import { createTelegramAdapter } from "@arnilo/prism-channels/telegram";

const adapter = createTelegramAdapter({
  connectionId: "support-telegram",
  botToken: hostCredentials.telegramBotToken, // string, function, or CredentialValueSource
  checkpoints: serviceCheckpoints,
  leases: serviceLeases,
  cursorOwnership: { tenantId: "service" }, // service scope, not a Telegram claim
  allowGroups: true, // opt-in groups/topics; still deny-by-default at authorize()
  maxAttachmentBytes: 1024 * 1024, // per `getFile` download; hard ceiling 4 MiB
  transcribe: (audio, format) => transcription.transcribe({ model: "whisper-1", audio, format }), // voice -> turn text
  synthesize: (text) => speech.synthesize({ model: "tts-1", input: text }), // text -> voice note, final replies only
  extractDocumentText: (bytes, mimeType) => hostExtractor(bytes, mimeType), // documents are inert without this
});

const runtime = createMessagingRuntime({
  // Exact observed tuple: chat id, optional topic id, sender id. Display names are never keys.
  authorize: ({ externalConversationId, threadId, externalActorId, claims }) =>
    claims?.forwarded === true
      ? false
      : (hostGrants.get(externalConversationId, threadId, externalActorId) ?? false),
  resolveAgent: hostResolveAgent,
  deliver: (reply) => adapter.send(reply),
  onAssistantDelta: (delta) => adapter.sendDraft(delta), // opt-in previews; needs sendDrafts: true
  fetchAttachment: (ref) => adapter.fetchAttachment(ref), // lets a model that declares image input receive the image
  checkpoints: userCheckpoints,
  leases: userLeases,
});

await adapter.start((event) => runtime.admit(event));
// shutdown: await adapter.stop(); await runtime.stop();
```

[`examples/telegram-agent.ts`](../examples/telegram-agent.ts) exposes same composition as a host-supplied helper.

The adapter awaits `runtime.admit()` before advancing `offset`. Return the admission result from the callback: `capacity`, `unavailable`, and `stopped` keep Telegram's update unacknowledged; all other settled dispositions advance the durable cursor. The operation journal then deduplicates any replay before model or tool work.

A connection receiver lease (`prism.channels.v1.telegram.receiver`) is held for the poll loop. A second poller or a webhook worker using the same `connectionId`, service ownership and `LeaseStore` receives no work. This fences stored intake state; it cannot retract an already accepted platform request from a paused process.

## Implementation example

Mount `createTelegramWebhookHandler` on a host HTTPS route. It is a Web-standard `(Request) => Promise<Response>` handler; Prism does not create a listener, configure DNS/TLS, or call `setWebhook` for you.

```ts
import { createTelegramWebhookHandler } from "@arnilo/prism-channels/telegram";

const telegramWebhook = createTelegramWebhookHandler({
  connectionId: "support-telegram",
  botToken: hostCredentials.telegramBotToken,
  webhookSecret: hostSecrets.telegramWebhookSecret, // 1–256 URL-safe characters
  admit: (event) => runtime.admit(event),
  leases: serviceLeases,
  cursorOwnership: { tenantId: "service" },
  allowGroups: true, // must match the poller you are replacing
});

// Example host adapter: route only this fixed HTTPS path to telegramWebhook(request).
```

Configure Telegram deliberately after the route, TLS and independent secret exist. Do not set `drop_pending_updates` and do not remove an active webhook merely to switch modes.

```sh
curl --fail-with-body \
  -H 'content-type: application/json' \
  -d '{"url":"https://bot.example/telegram","secret_token":"<independent-secret>","allowed_updates":["message","callback_query"]}' \
  "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook"
```

The handler requires `POST` + JSON, verifies `X-Telegram-Bot-Api-Secret-Token` with a fixed-length hash comparison before body parsing, bounds body bytes, acquires the same receiver lease, and calls `admit` before returning `204`. Bad secret/body returns `401`/`400`/`413`; lease, capacity, stopped runtime, or journal unavailability returns `503` so Telegram retries. Untrusted but final inputs (bot/media/unknown sender/anonymous admin, or group updates when `allowGroups` is off) return `204` without an agent call. `allowGroups` is parsed identically in both modes; set it the same on the webhook worker and the poller you replaced.

`callback_query` is promptly acknowledged with `answerCallbackQuery` and only accepts the runtime's `p:a:<opaque-token>` / `p:d:<opaque-token>` callback shape from a non-bot sender in an admitted private, group, or topic conversation (a topic callback keeps its `message_thread_id` as `threadId`). The adapter maps it to an `approval` event; callback data never becomes model input. The runtime validates its short-lived server-side binding before core resume.

## Outputs / response / events

`send()` accepts only replies addressed to its own `connectionId`; the runtime fixes `externalConversationId` and the reply `threadId` from the authorized binding, so a topic answer posts to that topic's `message_thread_id` and the model cannot choose either. It sends plain text, chunks at 3,500 UTF-16 code units without splitting surrogate pairs, and retries documented `retry_after` delays up to five attempts. A bounded server-issued control set renders as an inline keyboard on the final chunk; arbitrary model text cannot create buttons. There is no Markdown parse mode.

Known API failures return `{ delivered: false, reason }`. A network/timeout outcome, or a later failure after a prior chunk was accepted, rejects with a bounded ambiguous-delivery error. The common durable reply journal records thrown delivery as `delivery_unknown`; do not automatically resend it. Bot token URLs are never included in adapter errors and redirects are forbidden.

Telegram's `getUpdates` and webhooks are mutually exclusive. Updates remain available for at most 24 hours; the cursor is an ordering/acknowledgment record, not an exactly-once agent execution guarantee. Bots are not Secret Chats.

### Streaming previews (drafts)

With `sendDrafts: true` and `MessagingRuntimeOptions.onAssistantDelta: (delta) => adapter.sendDraft(delta)`, the adapter renders the answer while it is produced through Bot API `sendMessageDraft`: same chat and `message_thread_id` as the bound turn, `draft_id` fixed at one preview slot per chat, text capped to the last 3,500 UTF-16 code units. Previews are coalesced — one request in flight, the latest partial wins — so a token stream never floods the API, and failures are ignored because a draft is only a preview. Cancel, `stop()` and run end stop further previews. Drafts are private-chat only: group and supergroup chats are skipped even when `allowGroups` and `sendDrafts` are both on. No draft is ever a `ChannelReply`: nothing is journaled, no controls or attachments can ride along, and the terminal `sendMessage` remains the only message the user keeps.

### Attachments and voice

A `photo`, `voice` or `document` message is parsed into at most eight `ChannelAttachmentRef` values on the event: `kind`, `transportFileId` (Telegram `file_id`), optional `mimeType`, `byteLength` and `fileName`. A photo collapses to its largest size. The event never carries bytes, a URL, a caption-as-identity, or a model-chosen id, and nothing here can be addressed by model output.

Before `admit`, the adapter runs the one bounded fetch the host opted into (Bot API `getFile` plus a capped download):

- `voice` + host `transcribe` → the transcript becomes ordinary turn text (`caption`, then transcript). The audio is discarded after the call.
- `document` + host `extractDocumentText` → the extracted text becomes turn text. Without the hook the document stays inert: the message admits with an attachment ref and no text, and the runtime answers with a bounded "cannot be processed" notice instead of a model call.
- `photo` is never fetched by the adapter. The runtime fetches it (through `fetchAttachment`) only when the resolved agent's model declares `image` input, then sends it as one image content block next to the caption; otherwise the turn is refused with the same notice and no model call. `image` is the only attachment kind that becomes model input — audio/documents are text-only because Prism receives their host-produced text.

Oversize fails closed twice: the runtime denies an event whose *declared* sizes exceed `maxAttachmentBytes` (`denied: oversized`, no fetch, no model call), and the adapter refuses to buffer a body whose `Content-Length` or streamed size exceeds the same cap. Failures (network, credential, API, malformed `file_path`) yield no bytes, so the turn is refused rather than run without the attachment.

Outbound, `synthesize` adds a Bot API `sendVoice` next to the text for `final` replies: same bound chat and `message_thread_id`, OGG/OPUS, MP3 or M4A formats only, best-effort — a synthesis or upload failure never fails or re-sends the delivered text reply. Notices stay text-only. Nothing hangs a voice note on model-selected destinations.

## Extension and configuration notes

| Setting | Default | Range |
| --- | ---: | ---: |
| Poll timeout | 30 s | 1–50 s |
| Poll batch | 100 | 1–100 |
| Receiver lease | 90 s | poll timeout + 10 s–5 min |
| Webhook/API body | 128 KiB | 1 KiB–1 MiB |
| Outbound chunk | 3,500 UTF-16 units | fixed (under Telegram's 4,096 limit) |
| Known-send attempts | 5 | fixed |
| Group/topic text (`allowGroups`) | off | boolean |
| Streaming previews (`sendDrafts`) | off | boolean (private chats only) |
| Attachment bytes (`maxAttachmentBytes`) | 1 MiB | 1 B–4 MiB |
| Voice transcription (`transcribe`) | off | host `TranscriptionProvider` wrapper |
| Speech synthesis (`synthesize`) | off | host `SpeechProvider` wrapper (final replies) |
| Document text (`extractDocumentText`) | off | host extractor |

## Security and performance notes

The webhook secret is independent of the bot token and compared with a fixed-length hash before body parsing. Redirects are forbidden; bot-token URLs never appear in adapter errors. Polling and webhooks are mutually exclusive. Model text cannot create inline buttons.

Groups and topics are off by default and never self-authorize: the adapter only parses an observed `(chat id, topic id?, user id)` and the host grant decides, so a group membership claim is not an identity. Chat titles, usernames and display names are never actor ids. Bots, `sender_chat` (channel posts and anonymous admins), and non-text updates are dropped before admission; forwarded messages are admitted but flagged in `claims` so the grant can refuse them. In groups Telegram privacy mode limits what a bot receives (commands and replies to it) unless an operator disables it in BotFather; Prism does not work around that platform behavior. Signal stays DM-only.

Drafts are display-only and cannot become input: they carry no controls or attachments, the destination chat/thread always comes from the bound event (never from model output or from the delta), text is redacted with the same redactor as finals, and the 3,500-unit cap keeps the request inside Bot API limits. Since `sendDraft` is fire-and-forget and failures are swallowed, a draft can never fail a turn, mask a delivery failure, or replace the journaled final reply.

Media is bounded on every axis. Only the current event's refs are ever fetched (`fetchAttachment` takes a ref, and the runtime only passes refs of the event it is running), the cap is enforced twice (declared size and streamed body), and downloads use the same fixed origin with redirects forbidden. Bytes live only for the fetch call: they are never journaled (`ChannelOperationRecord` and `ChannelReplyRecord` store text only), never logged, and never written to disk. A `file_id` is not a capability — the bot proves nothing to Telegram by holding one, and a caller-supplied or model-invented id yields at most one bounded request inside the cap. Hosts wire `transcribe`/`synthesize`/`extractDocumentText` to their own provider wrappers; `@arnilo/prism-channels` never depends on `@arnilo/prism-providers`.

## Related APIs

- [Messaging channels](messaging-channels.md): authorization, durable operations and reply recovery.
- [Web-standard server handler](server.md): mounting a `Request`/`Response` handler in a Node or framework host.
