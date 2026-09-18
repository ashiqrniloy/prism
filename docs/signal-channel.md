# Signal channel (experimental)

## What it does

`@arnilo/prism-channels/signal` is a Node-only, experimental adapter for an **externally supervised** [signal-cli v0.14.8](https://github.com/AsamK/signal-cli/tree/v0.14.8) Unix-socket daemon. It is not an official Signal bot API, does not make a bot official, and must be enabled only after an operator records the acceptable-use and GPL distribution decisions required for its deployment.

Importing or constructing the adapter does nothing: it never downloads, spawns, registers, links, relinks, configures, or health-checks `signal-cli`; opens no network connection; and has no environment or credential lookup. Host owns that lifecycle, account, state directory, encryption, backup/retention and process supervisor.

## When to use it

Use only after an operator records acceptable-use and GPL distribution decisions for an already-operated Signal account. Not an official bot API; not for groups, topics, attachments, identity linking, bulk messaging (including `MessagingRuntime.notify`, which is unicast to one existing DM binding only), automated account creation, or streaming previews (Signal has no Bot API draft equivalent, so this adapter ignores `MessagingRuntimeOptions.onAssistantDelta`).

```bash
npm install @arnilo/prism @arnilo/prism-channels
```

## Inputs / request

`SignalAdapterOptions`: host `connectionId`, absolute private `socketPath`, daemon `account`, `signalCliVersion` (must equal `SIGNAL_CLI_VERSION`), `policy` attestation, and service-owned `checkpoints`/`leases`/`cursorOwnership`. `signal-cli` is a host-operated binary, not an npm peer.

## Host setup

Use only a private, host-selected Unix socket on the same Node/Linux host. Do not expose a TCP or HTTP bridge. Protect socket parent/state directories with service-only permissions (for example `0700`) and protect backups. Signal transport decrypts at `signal-cli`; Prism stores and model providers receive plaintext according to host policy.

The supported daemon shape is manual receive mode, selected by the host for the pinned CLI version:

```sh
signal-cli --data-dir /private/prism-signal -a +15550001111 \
  daemon --socket=/private/run/prism-signal.sock --receive-mode=manual
```

`signal-cli` is GPLv3 and its upstream compatibility can change after Signal service changes. It requires the pinned release's documented JRE/native dependencies (v0.14.8 documents JRE 25). Account registration/relinking may disrupt existing clients; never automate it from Prism or chat input. Consult current Signal terms and operator policy before enabling automated replies; terms/policy can prohibit an intended deployment.

## Request/response example

```ts
import { createMessagingRuntime } from "@arnilo/prism-channels";
import { createSignalAdapter, SIGNAL_CLI_VERSION } from "@arnilo/prism-channels/signal";

const adapter = createSignalAdapter({
  connectionId: "support-signal",
  socketPath: "/private/run/prism-signal.sock",
  account: "+15550001111",       // host daemon account, never taken from a message
  signalCliVersion: SIGNAL_CLI_VERSION,
  policy: {
    acceptableUse: "operator_approved",
    gplDistribution: "operator_approved",
    termsVersion: "2026-09-review", // host's recorded policy review, not a Signal approval
  },
  checkpoints: serviceCheckpoints,
  leases: serviceLeases,
  cursorOwnership: { tenantId: "signal-service" },
  // multiAccount: true, // only for a daemon where account is supplied on RPC requests
});

const runtime = createMessagingRuntime({
  authorize: hostAuthorizeSignalSender, // verify observed Signal UUID -> Prism identity/grant
  resolveAgent: hostResolveAgent,
  deliver: (reply) => adapter.send(reply),
  checkpoints: userCheckpoints,
  leases: userLeases,
});

await adapter.start((event) => runtime.admit(event));
// Shutdown: await adapter.stop(); await runtime.stop();
```

## Implementation example

[`examples/signal-agent.ts`](../examples/signal-agent.ts) contains the same host composition helper.

`start()` acquires `prism.channels.v1.signal.receiver`, probes its checkpoint writer, connects the persistent Unix socket, then calls only `subscribeReceive`. It renews its receiver lease; loss fails closed by pausing intake. `stop()` unsubscribes when possible, closes its socket, aborts reconnection and releases only its lease. A second receiver under the same service ownership cannot subscribe.

The adapter accepts manual `params.result.envelope` notifications only when they name the selected account and contain a direct text `dataMessage` from a valid Signal UUID. It ignores receipts, sync echoes, reactions, stories, edits, groups (including group topics, which have no supported thread mapping) and attachments before `admit`. UUID (not display name or phone number) becomes the external actor/conversation ID; the runtime must still authorize it. An account mismatch pauses the adapter before admission. `health()` reports independent bounded `bridge`, `subscription`, and `account` states for host monitoring without message text, phone numbers, socket path or key material.

## Outputs / response / events

`send()` accepts only replies for its configured `connectionId` and a UUID destination fixed by the runtime's authorized binding. It calls only `send`; chat text cannot choose an RPC method, account, socket, recipient or identity action. Replies are plain text and chunked at 2,000 UTF-16 code units without splitting surrogate pairs.

A server-issued approval control is rendered as plain reply text:

```text
Reply /approve <opaque-token> to allow once.
Reply /deny <opaque-token> to deny.
```

Only the shared runtime validates and consumes that opaque token. Free-form text remains untrusted input; no Signal reaction, attachment, identity-trust or linking action is exposed.

Known daemon errors map to a bounded reason (`signal_rate_limited`, `signal_captcha_required`, `signal_relink_required`, `signal_identity_changed`, or `signal_rpc_error`). A changed/untrusted identity stops normal sends until an operator verifies it and current authorization is re-established. Timeout/socket loss after a write — or a failure after an earlier chunk — throws an ambiguous-delivery error; the durable reply journal records `delivery_unknown` and must not automatically resend it.

## Extension and configuration notes

| Setting | Default | Range |
| --- | ---: | ---: |
| JSON-RPC line/frame | 128 KiB | 1 KiB–512 KiB |
| Pending RPC requests | 16 | 1–64 |
| Pending admitted notifications | 32 | 1–128 |
| RPC timeout | 10 s | 100 ms–60 s |
| Reconnect delay | 1 s | 1 ms–60 s (exponential, 30 s default max) |
| Receiver lease | 90 s | 5 s–5 min |
| Outbound chunk | 2,000 UTF-16 units | fixed |

The adapter pauses/unsubscribes on journal admission capacity/storage failure, malformed/oversized frames, account mismatch, or lease loss. It reconnects with bounded backoff after an established bridge loss and rechecks writer readiness before subscribing. It has **no documented application acknowledgment or replay log**: a daemon notification received before a crash and before durable commit can be lost. This adapter does not claim lossless intake, exactly-once execution, message read status, or end-to-end encryption through a model/provider.

## Security and performance notes

Construction is inert: no spawn, TCP/HTTP, environment lookup, or credential read. Chat text cannot choose RPC method, account, socket, recipient, or identity action. UUID (not phone or display name) is the only observed actor id. A changed identity stops sends until an operator verifies it. Receive-to-commit can lose a notification; treat that as a documented loss window, not a retry.

## Related APIs

- [Messaging channels](messaging-channels.md): authorization and durable replies.
- [Messaging channel operations](messaging-channel-operations.md): recovery and operator review.
