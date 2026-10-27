# Loop

## What it does

A `LoopStrategy` decides how a run advances: how many provider turns, when to dispatch tools, and
when the run ends. It receives one handle, `RunController`, and reaches the kernel only through it.

```ts
interface LoopStrategy {
  readonly name: string;
  readonly revision?: string;
  run(run: RunController): Promise<void>;
  snapshot?(): JsonValue;
  restore?(snapshot: JsonValue): void;
}
```

The kernel ships `defaultLoop`: provider turns until the model stops calling tools, then a natural
`run.end`.

## When to use it

Replace the loop slot when the run shape is not "turn, tools, turn, …" — for example a plan turn
with tools off before the acting loop. A custom loop cannot bypass the safety gates: `turn` is the
only path to provider generation and `executeTools` is the only path to tool dispatch.

## Inputs / request

`RunController` exposes exactly:

| Member | Meaning |
| --- | --- |
| `session` | the live session |
| `input` | the run input |
| `signal` | the run abort signal |
| `limits` | the run limit tracker |
| `turn(options?)` | one provider turn; returns `{ stopped, toolCalls, finishReason?, usage? }` |
| `executeTools(calls, { concurrency? })` | dispatch tool calls |
| `append(message)` | append a transcript message |
| `end()` | natural loop end; `{ continue: true }` means re-enter |
| `emit(event)` | emit a package event |

`turn` options: `tools: false` sends no tools; `tools: [names]` narrows the run grant; `system`
overrides the system prompt for that turn.

## Asking for approval

A `tool.call` handler may return `{ ask: reason }`. The kernel resolves every ask in a round the same
way:

1. **Inline.** When `AgentConfig.host.ui` is attached, the kernel sends one `confirm` request per
   asked call. The title names the tool; the detail carries the reason and a redacted argument
   preview. `answered: true` executes the call, `answered: false` and `dismissed` return a denied
   tool result.
2. **Suspend.** With no UI, or on `unavailable`, the round's asked calls are staged as pending
   decisions and the run suspends (`status: "suspended"`, `interruption.pendingDecisions`). The
   round's allowed calls still run first, then the run suspends at the next turn boundary or loop
   end.

The kernel writes one `suspended_run` session entry through the store slot. It carries the pending
decisions, the loop's `snapshot()` when the loop declares one, the loop `name`/`revision`, the hook
registration-id set, and the full run state. Find it with `loadSuspendedRunEntry(store, sessionId)`
and continue with `session.resumeDurable(entry.state, runState, …, decisions)` in a new process over
the same store. A changed loop revision or hook-id set fails the resume closed.

```ts
const result = await session.run("delete the tmp dir");
// result.status === "suspended"; result.interruption.pendingDecisions[0].scope.toolName === "shell"
```

`askEveryTool(reason?)` is a host registrar that asks before every tool — the successor to the
retired `interruptBeforeTool` run option. Prefer a narrower handler that matches only the calls that
need a decision.

## Outputs / response

`turn` fires, in order: `turn.before`, `context.build`, `model.request`, `model.call`,
`model.response`, `message.append`. `executeTools` fires, per call: `tool.call`, `tool.execute`,
`tool.result`, `message.append`. `end` fires `run.end`; the first `{ continue }` re-enters the loop,
capped by the continuation limit. A `turn.before` `{ stop }` ends the run with `stopReason:
"hook_stop"`.

## Request/response example

```json
{
  "slots": {
    "loop": {
      "name": "plan-then-act",
      "revision": "1"
    }
  }
}
```

## Implementation example

```ts
import { createAgent, type LoopStrategy } from "@arnilo/prism";

const planThenAct: LoopStrategy = {
  name: "plan-then-act",
  revision: "1",
  async run(run) {
    await run.turn({ tools: false, system: "Plan." });
    for (;;) {
      const t = await run.turn();
      if (t.stopped || t.toolCalls.length === 0) return;
      await run.executeTools(t.toolCalls);
    }
  },
};

const agent = await createAgent({ model, slots: { loop: planThenAct } });
```

The runnable [`examples/custom-loop.ts`](../../examples/custom-loop.ts) supplies a plan-then-act loop and a host
`tool.call` gate that denies a `network` tool; the denial reaches the model as a tool result.

## Extension and configuration notes

- `revision` joins the durable fingerprint; a custom loop on a durable run must declare `snapshot`
  and `restore`.
- `emit` carries a `package.event`-shaped event; Phase 3 freezes the full event catalog.
- `compaction.when` fires at the existing auto-compaction check point. While a handler is registered it owns the decision; the configured `trigger`/`thresholdEntries` decides only when no handler is registered.

## Security and performance notes

- `RunController` exposes no registry, provider, or dispatch handle; a test asserts its own keys.
- With no hooks registered, `turn` adds no provider request, store write, or per-turn allocation
  beyond the wrapper object.
- A `turn.before` stop leaves a resumable state; the run ends cleanly, not as a failure.

## Related APIs

- `defaultLoop`: the kernel loop.
- `RunController`: the only handle a loop gets.
- `run.end` / `turn.before`: the loop's decision hooks.
- `askEveryTool`: ask before every tool call.
- `loadSuspendedRunEntry`: read a suspended run from the store slot.
- [`examples/custom-loop.ts`](../../examples/custom-loop.ts): a plan-then-act loop with a host tool gate.
