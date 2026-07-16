# A2A interoperability

## What it does

`@arnilo/prism-supervisor` implements a bounded text-only subset of Agent2Agent (A2A) protocol 1.0: Agent Cards, JSON-RPC `SendMessage`, `SendStreamingMessage`, `GetExtendedAgentCard`, SSE task updates, ES256 JWS card signatures, and an explicit remote client.

## When to use it

Use it to expose one explicitly selected Prism agent at an A2A endpoint or call a known remote A2A agent. Do not use it as endpoint discovery, a generic proxy, credential forwarding, or a replacement for local workflows.

## Inputs / request

| API/field | Meaning |
| --- | --- |
| `createA2AAgentCard(card)` | Validates/freeze a JSONRPC protocol-1.0 HTTPS text card. |
| `signA2AAgentCard(card, { privateKey, keyId, expiresAt })` | Adds detached-payload ES256 JWS signature using WebCrypto. |
| `verifyA2AAgentCard(card, { publicKey, keyId?, now?, maxAgeMs? })` | Pins ES256/key/expiry and verifies canonical unsigned card. |
| `createA2AHandler({ card, exposure, authorize })` | Web-standard card/JSON-RPC/SSE `Request` to `Response` handler. |
| `createA2AClient({ endpoint, allowedOrigins })` | Explicit HTTPS remote client with optional card verifier/auth callback. |
| `A2ALimits` | Request 64 KiB, response 1 MiB, event 64 KiB, stream 10 MiB/10k events, concurrency 16, timeout 120s, card 64 KiB defaults; finite hard caps apply. |

## Outputs / response / events

The handler serves `GET /.well-known/agent-card.json` and its configured POST endpoint. JSON-RPC returns `{ result: { task } }` or a bounded error. Streaming returns backpressure-driven SSE task envelopes. Client `send()` maps a terminal remote task to `AgentRunResult`; `stream()` yields validated/redacted text artifacts.

## Request/response example

```json
{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"user","messageId":"m1","parts":[{"text":"Check sources"}]}}}
```

## Implementation example

```ts
import { createA2AClient, createA2AHandler, verifyA2AAgentCard } from "@arnilo/prism-supervisor";

const handler = createA2AHandler({
  card,
  exposure: { sessionFactory: ({ ownership }) => agent.createSession({ metadata: ownership }) },
  authorize: ({ request }) => authenticate(request),
});

const client = createA2AClient({
  endpoint: "https://agent.example/a2a/v1",
  allowedOrigins: ["https://agent.example"],
  authorize: () => ({ authorization: `Bearer ${resolveOwnedToken()}` }),
  verifyCard: (remoteCard) => verifyA2AAgentCard(remoteCard, { publicKey, keyId: "agent-key" }),
});

const result = await client.send("Check sources");
```

## Extension and configuration notes

The package owns no listener or credential store. Mount the handler in a host server and resolve authentication/authorization on every request. Client auth executes only after body/card validation and serialization. Injectable `fetch` supports host transports/tests; redirects are disabled.

Only `text` parts are accepted. File/data parts, push notifications, task persistence/query/cancel, gRPC, HTTP+JSON binding, automatic JWK fetching, and endpoint discovery are intentionally absent.

## Security and performance notes

- Endpoints and card URLs must be HTTPS and exactly origin-allow-listed before fetch; `redirect: "error"` prevents redirect SSRF.
- Treat every remote card, error, task, status, artifact, and SSE frame as untrusted. Shape/count/byte/time limits apply before mapping.
- Card verification pins `alg=ES256`, optional key ID, issue/expiry, optional maximum age, and canonical unsigned-card payload. Hosts provision trusted public keys; remote `jku` is never fetched automatically.
- Card discovery is public; extended-card and invoke methods call host authorization. Use TLS, rate limits, and replay controls at the host edge.
- Credentials remain in the client auth callback or server authorizer and never enter cards, messages, events, or metrics.
- Offline conformance is authoritative. Live endpoints are optional operator smoke tests.

## Related APIs

- [Supervisor delegation](supervisors.md): local child boundary.
- [Web-standard server](server.md): non-A2A Prism routes.
- [Host security](host-security.md): authentication, SSRF, and untrusted-output policy.
- [Agent/session runtime](agent-session-runtime.md): mapped local execution/result.
