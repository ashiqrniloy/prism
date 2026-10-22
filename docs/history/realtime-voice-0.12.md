# Realtime voice

## What it does

`createRealtimeVoiceBridge` in `@arnilo/prism-core/runtime/realtime` runs an existing `RealtimeSession` through ordinary host tool dispatch, device admission, barge-in, reconnect dedupe, and transcript privacy. OpenAI Realtime (`createOpenAIRealtimeSession`) maps host `function_call` items onto `RealtimeEvent.tool_call`, emits `usage`, and returns results with `completeTool`.

## When to use it

Use it when microphone audio should drive the same tools, approvals, usage ledger, and memory consent as a text run. Do not use it as a second agent loop or a voice-specific policy engine. One-shot TTS/STT stays on [Speech and transcription](speech.md).

## Inputs / request

```ts
import { resolveDevicePolicy } from "@arnilo/prism";
import { createOpenAIRealtimeSession } from "@arnilo/prism-providers/openai";
import { createRealtimeVoiceBridge } from "@arnilo/prism-core/runtime/realtime";

const policy = resolveDevicePolicy(
  { kind: "voice", enabled: true, requireApproval: true, sandbox: "voice" },
  { runLimits: { maxTurns: 8, maxToolCalls: 32 } },
);
const session = createOpenAIRealtimeSession({
  ownerId: "user-1",
  model: { provider: "openai", model: "gpt-realtime" },
  apiKey,
  tools: [{ name: "lookup", parameters: { type: "object" } }],
});
const bridge = createRealtimeVoiceBridge({
  session,
  policy,
  admit: { approved: true, activeSessions: 0 },
  toolNames: ["lookup"],
  strictGovernance: true,
  retainTranscripts: false,
  execute: (call, ctx) => dispatchToolCall({ call, signal: ctx.signal }),
  recordUsage: (usage) => router.recordUsage({ identity, provider: "openai", model, tokens: usage.totalTokens, kind: "generation" }),
});
```

| Field | Meaning |
| --- | --- |
| `session` | Existing `RealtimeSession` (`sendAudio` / `events` / `interrupt` / `close`). |
| `policy` + `admit` | `assertDeviceAdmit` on construct, each `sendAudio`, and reconnect (new bridge). |
| `execute` | Host dispatch (approvals, `toolNames`, effect store). Not provider-hosted calls. |
| `toolNames` | Same names-only grant as `RunOptions.toolNames`. Omitted = all host tools; `[]` = none. |
| `strictGovernance` | Provider-hosted tools are unknown, never dispatched. |
| `seenCallIds` | Reconnect skip list. Duplicate ids are not replayed. |
| `retainTranscripts` | Default `false`. Audio is never retained. |

## Outputs / response / events

`bridge.run()` consumes `session.events()` until close. `snapshot()` reports pending/completed/cancelled/unknown call ids, `interrupted`, `consent`, `effectAfterInterrupt`, and `usageMissing`. Barge-in aborts queued calls before `execute`; an execute that still succeeds after interrupt sets `effectAfterInterrupt` (072 invariant 0). Outbound `audio_delta` is dropped after interrupt until the next `sendAudio`.

## Request/response example

```json
{
  "type": "response.function_call_arguments.done",
  "call_id": "call_001",
  "name": "lookup",
  "arguments": "{\"q\":\"x\"}"
}
```

## Implementation example

See `examples/realtime-voice-host.ts` (network-free mock session, keyboard-free barge-in). Hosts that need a text approval UI call `execute` through the same `dispatchToolCall` / durable-approval path as a text run.

## Extension and configuration notes

OpenAI `session.update` advertises at most 32 host function tools. `completeTool` sends `conversation.item.create` (`function_call_output`) then `response.create`. Optional `completeTool` on `RealtimeSession` is the generic gap; transports that cannot complete tools omit it. Transcript memory uses Task 16 `remember` only when `retainTranscripts` is true and the host passes `onTranscript`.

## Security and performance notes

- Microphone consent is not tool approval. `revokeConsent` closes the session; later `sendAudio` throws `ERR_PRISM_REALTIME_CONSENT`.
- Re-admit on every reconnect. Side effects never replay from `seenCallIds`.
- Raw audio is not made safe by text redaction and is not uploaded or stored by the bridge.
- Ambiguous outcomes after interrupt stay `unknown`, never fabricated success.
- Event/audio caps stay on the Realtime session (`maxAudioEventsPerSecond` / `maxBytesPerSecond` / `maxWallMs`). Pending host calls cap at 32.

## Related APIs

- [Device adapters](device-adapters.md): deny-by-default voice admission.
- [Speech and transcription](speech.md): one-shot TTS/STT.
- [Tools](tools.md): `RunOptions.toolNames` grant used by the bridge.
- [Runs and usage ledger](runs-and-usage.md): voice tokens settle as `kind: "generation"`.
- [OpenAI provider](providers/openai.md): `createOpenAIRealtimeSession`.
