# @arnilo/prism-hosts/a2a

Host library for the [A2A protocol](https://a2a-protocol.org) 1.0, JSON-RPC binding: `serveA2A` serves one Prism `Agent` to agents built on other frameworks, and `connectA2A` calls such an agent as a local `Agent`.

## Install

```bash
bun add @arnilo/prism @arnilo/prism-hosts
```

This is a host library, not a native package: import it in the host; do not add it to an agent's manifest or `packages` list. It registers no tools, skills, commands, hooks, slots, or services, and importing it opens no socket and starts no timer.

## What it does

`serveA2A(agent, options)` returns a web handler `(request: Request) => Promise<Response>`. Mount it on any server that speaks `Request`/`Response`, for example `Bun.serve({ fetch: handle })`. It constructs no agent.

- `GET /.well-known/agent-card.json` serves the Agent Card. `capabilities` is filled from what the handler implements: `streaming: true`, `pushNotifications: false`, `extendedAgentCard: false`, and the Prism decisions extension.
- `POST` to the path of the card's JSONRPC interface serves these methods:

| Method | What runs |
| --- | --- |
| `SendMessage` | `session.stream(input)` (or `session.resume(decisions)` on a task that waits for input); answers once the task is terminal or interrupted. `configuration.returnImmediately: true` answers with the `TASK_STATE_WORKING` task as soon as the run starts. |
| `SendStreamingMessage` | Same, as SSE. The first frame is the task; then `artifactUpdate` frames carry assistant text deltas (`append: true` after the first chunk) and a final `statusUpdate` closes the stream. |
| `GetTask` | The task snapshot. `historyLength` adds up to that many stored user and assistant messages of the context (capped by `limits.maxHistory`). |
| `CancelTask` | `session.abort()` on a working task, then answers the `TASK_STATE_CANCELED` task. |
| `SubscribeToTask` | A task snapshot, then the live frames of a working task until it ends. |

Every call runs through `session.stream` / `session.resume`, so approvals, hooks, guardrails, and run limits apply. The handler never dispatches a tool itself.

### Contexts and tasks

- A `contextId` is one session: `agent.session({ id: contextId, create: true, ownership })`. A message without `contextId` gets a new one.
- A task is one run plus every resume that continues it. Its id is issued by the server and names its context and run.
- The handler keeps a bounded in-process task registry. A task suspended for input survives a restart: `GetTask` or a follow-up message reads the suspension back from the session. A settled task that is no longer in the registry answers `-32001` TaskNotFound.
- A context runs one task at a time, and refuses a new task while one of its tasks waits for decisions (`-32602`). Answer the decisions, or reject them, first.

### Run status → task state

| Run | Task state |
| --- | --- |
| `completed`, or `stopped` for any reason but `denied` | `TASK_STATE_COMPLETED` |
| `stopped` with `stopReason: "denied"` | `TASK_STATE_REJECTED` |
| `suspended` | `TASK_STATE_INPUT_REQUIRED` |
| `failed` | `TASK_STATE_FAILED` (the redacted error message in `status.message`) |
| aborted by `CancelTask` | `TASK_STATE_CANCELED` |

`TASK_STATE_AUTH_REQUIRED` is never emitted.

### Approvals: `TASK_STATE_INPUT_REQUIRED`

A run that suspends reports `TASK_STATE_INPUT_REQUIRED`. `status.message.parts` holds one `data` part per pending decision: `{ approvalId, kind, toolName?, reason, elicitationSchema? }`. The reason is already redacted by the kernel.

The peer answers with a follow-up `SendMessage` on the same `taskId` that lists the Prism decisions extension in `message.extensions` and carries one `data` part `{ decisions: [{ approvalId, outcome, reason?, elicitation? }] }`. `outcome` is `allow_once`, `allow_for_run`, `reject_once`, or `reject_for_run`. The handler calls `session.resume(decisions)`.

```json
{
  "messageId": "m-2",
  "role": "ROLE_USER",
  "taskId": "<task id>",
  "extensions": ["https://prism.arnilo.dev/a2a/extensions/decisions/v1"],
  "parts": [{ "data": { "decisions": [{ "approvalId": "<approval id>", "outcome": "allow_once" }] } }]
}
```

A follow-up without decisions answers `-32602` and the task stays `TASK_STATE_INPUT_REQUIRED`. `CancelTask` on a waiting task answers `-32002`: send reject decisions instead. `modifiedArguments` is refused unless `allowModifiedArguments: true`, and the kernel re-gates it.

### Parts

| Part | Becomes |
| --- | --- |
| `text` | a text block |
| `data` (other than decisions) | one canonical-JSON text block |
| `raw` with `image/*` | an image block, only if the model declares `image` input |
| `raw` with `audio/*` | an audio block, only if the model declares `audio` |
| `raw` with `application/pdf` or `text/*` | a document block, only if the model declares `document` |
| other `raw` | a file block, only if the model declares `file` |
| `url` | refused with `-32005`; never fetched |

Declared input kinds are `agent.config.model.capabilities.input` (text only when absent). A kind the model does not declare answers `-32005`.

### Unsupported

| Call | Error |
| --- | --- |
| `ListTasks` | `-32004` UnsupportedOperation |
| push-notification config methods, or `configuration.taskPushNotificationConfig` | `-32003` PushNotificationNotSupported |
| `GetExtendedAgentCard` | `-32007` ExtendedAgentCardNotConfigured |
| `SendMessage` to a terminal task, `SubscribeToTask` on a terminal task | `-32004` |
| an unknown method | `-32601` |
| `A2A-Version` other than `1.0` (a missing header means 0.3) | `-32009` VersionNotSupported |

The gRPC and HTTP+JSON bindings, and replay of past events after a restart, are not served.

## Configuration

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `card` | `A2AAgentCard` | required | The card to serve. Each interface must be `JSONRPC`, `protocolVersion: "1.0"`, and `https:` (`http:` only on a loopback host). The first interface's path is the RPC path. |
| `authorize` | `({ request, method, signal }) => { principal, ownership? } \| false`, optionally async | required | Verifies the caller. Without it, or when it returns `false` or throws, every call answers HTTP 401. |
| `ownershipFor` | `(principal) => OwnershipScope` | absent | Ownership when `authorize` returns none. |
| `signing` | `{ key, keyId }` | absent | Signs the served card with ES256. `key` is an `env:` / `keyring:` ref to a PKCS#8 P-256 PEM. |
| `credentials` | `CredentialResolver` | the agent's credentials slot, else `env:` | Resolves `signing.key`. |
| `allowModifiedArguments` | boolean | `false` | Accept `modifiedArguments` in decisions. |
| `redactor` | `SecretRedactor` | absent | Passed to every run, and applied to failure messages. |
| `limits` | `A2ALimitOptions` | below | Bounds; each must be a positive integer, and the host's value is the cap (hours for `taskTimeoutMs` are allowed). A resume's decision count is bounded by the agent's `ceilings.pendingDecisions`. |

| Limit | Default | Hard cap |
| --- | --- | --- |
| `maxRequestBytes` | 64 KiB | 1 MiB |
| `maxResponseBytes` | 1 MiB | 8 MiB |
| `maxStreamBytes` | 10 MiB | 64 MiB |
| `maxStreamEvents` | 10,000 | 100,000 |
| `maxStreamMs` | 120 s | 30 min |
| `taskTimeoutMs` | 120 s | 30 min |
| `maxConcurrentTasks` (working, per principal) | 16 | 256 |
| `maxTasks` (registry) | 1,024 | 16,384 |
| `maxContexts` (open sessions) | 256 | 4,096 |
| `maxParts` | 32 | 256 |
| `maxHistory` | 100 | 1,000 |

`maxStreamMs` closes one SSE response; the task keeps running and can be resubscribed. `taskTimeoutMs` aborts a run segment and fails the task. Too many concurrent tasks, tasks, or contexts answers HTTP 429 with `-32000`.

The handler's `close()` aborts working tasks and closes every open session.

## Security

- **Deny by default.** `authorize` is required. The card is public discovery; every RPC call needs `authorize`. `securitySchemes` on the card only declares what `authorize` checks.
- **Ownership comes from `authorize`, never from the request.** A context opens under the caller's ownership. A task or context of another principal, or of another scope, answers `-32001` TaskNotFound, never "forbidden". Without an ownership scope, contexts are unscoped: a multi-principal host should return one.
- **Secrets stay refs.** `signing.key` must be an `env:` or `keyring:` ref; a literal throws `A2ALiteralSecretError` at construction. No key material reaches the card, a response, or an error.
- **Errors carry fixed text.** JSON-RPC errors never echo request or agent data. A failed run's message passes the kernel redactor and `options.redactor` and is bounded to 2 KiB.
- **Bounded.** Request, response, stream, history, registry, and concurrency limits are enforced; see Configuration.

## Example

```ts
import { serveA2A } from "@arnilo/prism-hosts/a2a";

const handle = serveA2A(agent, {
  card: {
    name: "Reviewer",
    description: "Reviews diffs.",
    version: "1.0.0",
    supportedInterfaces: [{ url: "https://agents.example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [{ id: "review", name: "Review", description: "Reviews a diff.", tags: ["code"] }],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
  },
  authorize: ({ request }) => verifyBearer(request), // → { principal, ownership } | false
});
Bun.serve({ port: 8790, fetch: handle });
```

Runnable, offline: [`examples/a2a-server.ts`](../../../examples/a2a-server.ts).

## Connecting to an A2A agent

`connectA2A(endpoint, options?)` reads a peer's Agent Card and returns an `Agent` proxy. It goes wherever an `Agent` goes, for example a workflow node:

```ts
import { connectA2A } from "@arnilo/prism-hosts/a2a";
import { agentNode } from "@arnilo/prism-extensions/workflows";

const reviewer = await connectA2A({ url: "https://agents.example.com/reviewer", token: "env:REVIEWER_TOKEN" });
agentNode({ agent: reviewer, input: (ctx) => ctx.upstream.diff });
```

- **Card.** Unless `url` ends in `agent-card.json`, the card is read from the URL origin's `/.well-known/agent-card.json` (one fetch per connection, at most 1 MiB). `endpoint.card` supplies a card instead. Either way, the card must name a JSONRPC `1.0` interface on the card URL's origin. Another origin is refused with `a2a_invalid_card`, unless it is listed in `options.allowedOrigins`.
- **Sessions and tasks.** `agent.session({ id? })` is one A2A context: `id` is the `contextId`, and a new one is generated when it is absent. `parent`, `ownership`, `actor` and `metadata` are accepted and stay local, because A2A has no equivalent. Each `run`/`stream` sends one message and follows the task it starts. Over SSE (`SendStreamingMessage`) when the card declares `streaming`; otherwise it calls blocking `SendMessage`, and polls `GetTask` once a second only while the peer reports the task working. A stream that ends before the task does, for example at `maxStreamMs`, is read back with `GetTask` and followed with `SubscribeToTask`.
- **Events.** The proxy emits `run.started`, `message.delta` (artifact text), `message.completed`, and then `run.completed`, `run.failed`, or `run.suspended`. Each event carries `origin: { kind: "external", agent: <card name>, vendor: "a2a", remote: <endpoint origin or options.endpointId>, executedBy: "external" }`. The peer ran the work, so no local `tool.call` hook gated it. `session.subscribe()` sees the same events.
- **Task state → `RunResult.status`.** `COMPLETED` → `completed`; `REJECTED` → `stopped` with `stopReason: "denied"`; `CANCELED` → `aborted`; `FAILED` → `failed` (the peer's status text, with the token scrubbed out); `AUTH_REQUIRED` → `failed` with code `a2a_auth_required`; `INPUT_REQUIRED` → `suspended`.
- **Input required.** A peer's `TASK_STATE_INPUT_REQUIRED` becomes a suspended `RunResult` whose `pending` lists the status message's `data` items (`{ approvalId, kind, toolName?, reason }`, as `serveA2A` writes them). `session.resume(decisions)` sends them back through the Prism decisions extension, and the task continues. With `options.host.ui`, each decision is asked locally instead (a `confirm` per approval, an `input` per elicitation) and the task continues in the same run; an `unavailable` answer leaves the run suspended. The task a context waits on is held in this process: after a restart, `resume` throws `a2a_no_pending_task`.
- **Abort.** `session.abort()`, the run's `signal`, or a consumer that stops reading a stream sends `CancelTask` and settles the run `aborted`. `taskTimeoutMs` bounds one run's wall clock; when it fires, the proxy cancels the task and fails the run with `a2a_timeout`.
- **Input.** Text blocks become `text` parts. Image, audio, document and file blocks with inline base64 `data` become `raw` parts. Anything else, or a non-user message, throws `a2a_unsupported`.
- **Unsupported.** `commands`, `models`, `reload`, `sessions.*`, and the session members `continue`, `continueStream`, `steer`, `entries`, `compact`, `checkout`, `fork` and `contextMeter` throw `A2AClientError` with code `a2a_unsupported`. `messages()` returns the local transcript: the inputs sent and the replies received. `tools` and `skills` are empty, and `inspect()` returns an `a2a` block with the endpoint, `protocolVersion` and the card's name, version and skill ids.

| Option | Default | Purpose |
| --- | --- | --- |
| `endpoint.url` | required | The card URL, or any URL on the peer's origin. |
| `endpoint.token` | absent | `env:` / `keyring:` ref to a Bearer token. A literal throws `A2ALiteralSecretError`. |
| `endpoint.card` | absent | A card to use instead of fetching one. |
| `host.ui` | absent | Answers input-required decisions locally. |
| `limits` | `A2A_LIMITS` | Uses `maxRequestBytes`, `maxResponseBytes`, `maxStreamBytes`, `maxStreamEvents`, `maxStreamMs`, `taskTimeoutMs` and `maxParts`; the host's values are the caps. |
| `allowLoopback` | `false` | Allow a loopback peer, including `http:`. |
| `allowedOrigins` | none | More origins the card's endpoint may be on. |
| `credentials` | the kernel `env:` resolver | Resolves `token`. Pass a keyring-capable resolver for `keyring:` refs. |
| `endpointId` | the endpoint origin | `origin.remote` on events. |

Security:

- **SSRF.** Every request goes through the kernel's DNS-pinned `pinnedFetch` (`@arnilo/prism/net`). Private, link-local and metadata addresses are refused, redirects are refused, and the socket is pinned to the checked address. Plain `http:` is allowed only for a loopback peer with `allowLoopback`. The endpoint is checked at connect, so a bad card fails before any run.
- **The token** is resolved once at connect. It is sent only to the card's JSON-RPC endpoint, never with the card fetch, and is scrubbed from peer text that the proxy forwards (deltas, failure messages, decision reasons, JSON-RPC errors).
- **Bounds.** Responses, streams (bytes, frames, duration) and run duration are bounded by `limits`. Errors are `A2AError` (a JSON-RPC error from the peer, with its spec code) or `A2AClientError` (`a2a_transport`, `a2a_invalid_card`, `a2a_invalid_response`, `a2a_busy`, `a2a_no_pending_task`, `a2a_unsupported`).

Runnable, offline (Bun, loopback peer): [`examples/a2a-client.ts`](../../../examples/a2a-client.ts).
