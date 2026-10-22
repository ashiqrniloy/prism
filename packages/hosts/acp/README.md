# @arnilo/prism-acp

Host library that serves one existing Prism `Agent` over ACP v1. It does not construct an agent.

## What it does

`serveAcp(agent, options)` speaks ACP on stdio or an in-memory `Stream`. Prompts call `session.stream` with `interactive: false`. An approval suspends the run. The library sends one `session/request_permission` per pending decision and continues with `session.resume`.

`acpHost()` is the optional `HostPort` for package `host.ui` requests. Kernel asks (no `package` field) answer `unavailable`, so they take the permission path instead of a boolean confirm.

## When to use it

A process that already has an `Agent` and needs an ACP client (an editor, a test, the retired `prism` ACP adapter) to drive it.

## Inputs / request

```ts
serveAcp(agent, { stdio: true });
serveAcp(agent, { stream, authorize? });
```

`authorize` returning false is a JSON-RPC error. No session is created. The default allows the peer.

`session/new` and `session/load` accept `mcpServers: []`. A non-empty list is a JSON-RPC error and creates no session. This library does not advertise `mcpCapabilities`.

## Outputs / response / events

`serveAcp` returns `{ closed, close() }`. A prompt resolves with an ACP `StopReason`:

| Run | StopReason |
| --- | --- |
| completed, or no finish reason | `end_turn` |
| `token_limit` | `max_tokens` |
| `turn_limit` | `max_turn_requests` |
| `refusal`, `denied` | `refusal` |
| `hook_stop`, `hook_limit` | `end_turn` |
| abort or `session/cancel` | `cancelled` |
| failed | JSON-RPC error, not a fake `end_turn` |

Approval kinds:

| ACP `kind` | `ApprovalOutcome` |
| --- | --- |
| `allow_once` | `allow_once` |
| `allow_always` | `allow_for_run` |
| `reject_once` | `reject_once` |
| `reject_always` | `reject_for_run` |
| cancelled, unknown option | `reject_once` |

HostUi kind:

| Kind | ACP |
| --- | --- |
| kernel ask `confirm` (no `package`) | `unavailable`, then `session/request_permission` |
| package `confirm` / `select` / `input` | `elicitation/create` when the client advertised elicitation, else `unavailable` |
| `notify` / `open-url` | `session/update` text |
| `secret` / `terminal` | `unavailable` |
| unbound session | `unavailable` |

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import { acpHost, serveAcp } from "@arnilo/prism-acp";
import approval from "@arnilo/prism-approval";

const agent = await createAgent({
  model,
  packages: [approval({ mode: "ask" })],
  host: acpHost(),
});
const server = serveAcp(agent, { stdio: true });
await server.closed;
```

## Security and performance notes

Unknown session, rejected or cancelled permission, a client without elicitation, and `authorize: false` fail closed. Nothing is allowed by default. Package titles and elicitation text are sent as plain text. Events pass through the agent's redactor.

No work per connection beyond the agent's own runs. Notification text is capped at 64 KiB (`maxTextBytes`). A prompt stops forwarding after 10,000 updates (`maxStreamEvents`). Load replays at most 100 message chunks (`maxReplayEvents`). Diffs are capped at 64 KiB, images at 256 KiB, and command lists at 32. These are the `packages/ag-ui/src/limits.ts` defaults.

## Related APIs

- `session.resume`: continues a suspended approval
- `@arnilo/prism-approval`: ask mode that suspends when the host cannot confirm inline
