# A2A 1.0 interoperability

## What it does

`@arnilo/prism-supervisor` implements bounded A2A 1.0 over the JSON-RPC/HTTPS binding. Supported operations: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, push-notification-config create/get/list/delete, and `GetExtendedAgentCard`. Agent Cards retain explicit ES256 verification. gRPC, HTTP+JSON, discovery registries, automatic JWK/OAuth fetching, and an internal task worker/store are absent.

## When to use it

Use it to expose a selected Prism agent or host-owned durable agent/workflow lifecycle to known A2A peers. Use direct `exposure` for backward-compatible text invocation. Supply `tasks` for durable/rich/reconnect operations and `push` only when host persistence and webhook delivery policy already exist.

## Inputs / request

```ts
const handler = createA2AHandler({
  card,
  exposure: { sessionFactory }, // text fallback
  authorize: authenticateEveryOperation,
  tasks: durableTaskAdapter,    // host-owned start/get/list/cancel/subscribe
  push: pushConfigAdapter,      // host-owned config persistence/delivery integration
  parts: {
    allowRaw: true,
    allowData: true,
    allowUrl: true,
    validateUrl: validatePinnedPublicHttpsUrl, // validation only; never fetched
  },
});
```

`A2ATaskLifecycle` receives validated messages, exact `A2AAuthorization`, abort signals, bounded pagination, and reconnect cursor. Adapter must map existing durable agent/workflow/checkpoint/persistence operations; Prism creates no worker, queue, task map, or database table. Unknown-owner task/config lookups return `undefined`, producing non-disclosing `TaskNotFoundError` (`-32001`). Missing task/push capability returns `UnsupportedOperationError` (`-32004`).

`A2APart` is an exact one-of:

| Part | Default | Rule |
| --- | --- | --- |
| `{ text }` | enabled | bounded UTF-8 text |
| `{ raw, mediaType?, filename? }` | disabled | strict base64 and decoded-byte cap |
| `{ data }` | disabled | bounded finite JSON, depth 64/properties 10,000 |
| `{ url, mediaType?, filename? }` | disabled | credential/fragment-free HTTPS plus required host URL policy; never dereferenced |

Parts, messages, artifacts, histories, metadata, and aggregate responses are untrusted. Rich content remains in A2A task/message/artifact contracts for host mapping; it is never promoted to system instructions or automatically loaded as a Prism resource.

## Implementation example

```ts
const client = createA2AClient({
  endpoint: "https://agent.example/a2a/v1",
  allowedOrigins: ["https://agent.example"],
  authorize: ownedAuthHeaders,
  verifyCard: (card) => verifyA2AAgentCard(card, { publicKey, keyId: "agent-key" }),
});
const task = await client.getTask("task-1");
for await (const event of client.subscribeToTask(task.id, { afterEventId: savedCursor })) persistCursor(event.eventId);
```

## Outputs / response / events

Streams use ordered SSE frames with `id:` and JSON-RPC `result` containing one `A2ATaskEvent`: full `task`, `statusUpdate`, or `artifactUpdate`. `SubscribeToTask({ id, afterEventId })` passes cursor to durable adapter for authorized bounded replay. Duplicate event IDs are rejected/server-bounded; client de-duplicates repeated IDs. Terminal, `INPUT_REQUIRED`, and `AUTH_REQUIRED` states close streams. String-oriented `client.stream()` reports interrupted states as `ERR_PRISM_A2A_INTERRUPTED`; task APIs preserve status for continuation.

Client APIs:

- `send()` / `stream()` preserve text-to-`AgentRunResult` compatibility.
- `sendMessage()` returns rich/durable `A2ATask`.
- `getTask()`, `listTasks()`, `cancelTask()`, `subscribeToTask()` operate on durable tasks.
- `createPushConfig()`, `getPushConfig()`, `listPushConfigs()`, `deletePushConfig()` expose declared push config operations.

Every protocol request sends/negotiates `A2A-Version: 1.0`. Client endpoint/card URLs require exact allow-listed HTTPS and `redirect: "error"`. Cards are parsed then optionally verified against host-pinned keys; no key URL is fetched.

## Request/response example

```json
{"jsonrpc":"2.0","id":1,"method":"SubscribeToTask","params":{"id":"task-1","afterEventId":"event-42"}}
```

## Extension and configuration notes

Handler requires `card.capabilities.pushNotifications` to exactly match supplied `push`; mismatch fails construction, preserving signed-card integrity and preventing false capability claims. Streaming remains available for direct text invocation. Push adapter owns exact-owner persistence, signing/auth credentials, and network transport. Host explicitly calls `deliverA2APushEvent()` from its durable update path; helper bounds event, timeout (10s default/60s hard), attempts (1 default/3 hard), and passes stable event ID as idempotency key to host `A2APushDelivery`. It starts no hidden sender and performs no network itself. Config handling validates IDs/count/bytes and requires same explicit URL policy used for URL parts. Returned push configs omit token and authentication credentials.

Defaults/hard caps include: request 64 KiB/1 MiB; response 1/8 MiB; event 64 KiB/1 MiB; stream 10/64 MiB and 10k/100k events; replay 1k/10k events; concurrency 16/256; timeout 120s/30m; IDs 256/4096 B; parts 32/256; part/raw 1/8 MiB; data 256 KiB/4 MiB; artifacts 32/256; history/page 100/1000; cursor 4/16 KiB; push configs 10/100. Hosts may narrow limits.

## Security and performance notes

- Authorize every operation; lifecycle/push adapters enforce exact owner again at durable storage boundary. Missing and foreign tasks/configs share `-32001`.
- URL policy must reject private, loopback, link-local, rebound, redirected, or otherwise disallowed destinations. Package never fetches file URLs. Host push delivery must repeat equivalent checks for every attempt/redirect and process event IDs idempotently.
- Push token/auth credentials are accepted only into host adapter input and removed from protocol reads/responses. Keep them out of task parts, events, telemetry, ledgers, and errors.
- Known-secret redaction applies before handler JSON/SSE output. Client redacts mapped text/errors. Raw/data/url content remains explicitly untrusted.
- Canceled/closed streams abort adapter signal, return iterator, clear timeout, and release concurrency slot. Task/push durability and replay retention belong to host adapter and must remain finite.
- Default tests use in-memory lifecycle/fake fetch only; no public network.

## Related APIs

- [Supervisor delegation](supervisors.md)
- [Agent/session runtime](agent-session-runtime.md)
- [Workflows](workflows.md)
- [Host security](host-security.md)
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): browser/editor protocol adapters over a Prism session; not an A2A card, task lifecycle, or remote-agent transport.
