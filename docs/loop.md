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
only path to provider generation and `executeTools` is the only path to tool dispatch. Prove it with
[`assertGateIntegrity`](testing.md#assertgateintegrity), the published conformance check that reruns
a rewritten call, an `ask` that keeps another handler's rewrite, a resumed call, and `dispose()`
against the loop.

## Inputs / request

`RunController` exposes exactly:

| Member | Meaning |
| --- | --- |
| `session` | the live session |
| `input` | the run input |
| `signal` | the run abort signal |
| `limits` | the run limit tracker |
| `turn(options?)` | one provider turn; returns `{ stopped, toolCalls, finishReason?, usage? }` |
| `executeTools(calls, { concurrency?, origin? })` | dispatch tool calls; returns the `ToolResult[]` in input order |
| `append(message)` | append a transcript message |
| `end()` | natural loop end; `{ continue: true, reason }` means re-enter and inject `reason`; callable from any async context during `run()` |
| `observe(activity)` | record external-agent activity (driver loops); never fires `tool.call` |
| `state(key)` | an append-only archive for what an external agent keeps outside Prism: `append(entries)` / `load()` over bounded, redacted `external_state` entries |
| `ask(request, support?)` | put an external agent's tool call to the `tool.call` gate |
| `steers()` | async iterable of `session.steer()` input, after `run.input` |
| `emit(name, data)` | emit one `package.event` owned by the loop's slot owner (`"kernel"` for the default loop) |

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
   decisions and the run suspends (`status: "suspended"`, `pending`). The
   round's allowed calls still run first, then the run suspends at the next turn boundary or loop
   end.

The kernel writes one `suspended_run` session entry through the store slot, as a child of the branch
leaf, so it is the branch tip. It carries the pending decisions, the loop's `snapshot()` when the loop
declares one, the loop `name`/`revision`, the hook registration-id set, and the full run state. No
host store is needed. Continue it with `session.resume(decisions)` on
`agent.session({ id })`, in the same process or a new one over the same store (see
[agent.md](agent.md#runresult-and-sessionresume)). `loadSuspendedRunEntry(store, sessionId)` reads the
entry directly. A changed loop revision or hook-id set fails the resume closed.

```ts
const result = await session.run("delete the tmp dir");
// result.status === "suspended"; result.pending[0].scope.toolName === "shell"
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

The runnable [`examples/custom-loop.ts`](../examples/custom-loop.ts) supplies a plan-then-act loop and a host
`tool.call` gate that denies a `network` tool; the denial reaches the model as a tool result.

## Model-less loops and `run.model`

A loop strategy may declare two optional fields:

- `usesModel: false`: the loop never calls `turn()`, so `createAgent` accepts a config with no `model`. Any other loop without a model fails creation with `model_required`. `createAgent` resolves the loop slot to check this, so a slot conflict now surfaces at creation.
- `runModel`: `"passthrough"` (default) exposes `RunOptions.model` as `run.model`; `"none"` fails the run with `run_model_unsupported` before the loop starts. Any other value fails `createAgent` with `invalid_run_model_mode`.

`run.model` is `RunOptions.model`, else the agent's model, and is `undefined` on a model-less agent. `run.turn()` on a model-less agent throws `no_model`, which fails the run. A `usesModel: false` loop never resolves a Prism provider, so a passed-through `RunOptions.model` is not looked up. The errors are `ModelError`s with those `code`s.

## Driver primitives

A loop that drives an external agent never calls `turn()`; it reports what the agent does and asks before the agent acts.

- `observe(activity: ExternalActivity)`: text and thinking go through `message.delta` / `message.append` (redacted, persisted with `origin`). `tool.started` / `tool.progress` / `tool.completed` emit the catalog `tool.*` events with `origin.executedBy: "external"`, and `tool.started` charges `maxToolCalls`. `skill`, `file`, `plan`, `subagent`, `compaction`, `notice`, and `raw` emit `package.event`s named `agent.<kind>`, owned by the loop slot owner. A `subagent` `started` opens a nested `origin` (`depth + 1`, `subagentId`, `parentToolCallId`) that later activity inherits until it `completed`. `usage` folds into `RunResult.usage` and the limits. `observe` never fires `tool.call`, so a driver cannot claim Prism executed a vendor tool.
- `ask(request, { rewrite?, respond? })`: fires `tool.call` with `origin` and `request.effects`. `allow` returns `{ allow: true }`; `deny` returns `{ allow: false, reason }`; `rewrite` and `respond` pass through only when the matching flag is set, else deny `rewrite_unsupported` / `respond_unsupported`. `ask` resolves inline through `host.ui`. With no answer it stages a suspension on a resumable loop (`snapshot` and `restore`, or the default loop) and returns `approval_pending`; the run suspends when `run()` returns. A non-resumable loop returns `non_interactive`. A throwing gate, a `dismissed` answer, and a declined confirm are all denies.
- `steers()`: yields each message `session.steer()` queues, after the `run.input` transform. It adds no polling, and ends when the run aborts or the consumer stops. A loop that never calls it keeps today's behavior: steers apply at `turn()`.
- `state(key)`: `append(entries)` persists one `external_state` record (`{ vendor, key, seq, data }`; `vendor` is the loop's `name`, `seq` counts records per key) and `load()` returns the key's entries in append order. Each entry is JSON, redacted before it is measured, and at most 64 KiB; a key holds at most 10 000 entries and 8 MiB per branch, and passing a cap rejects with `external_state_limit` (a non-JSON entry rejects with `state_not_json`). The records ride the session's branch, so `fork()` copies them and deleting the session deletes them; `session.messages()` never shows them, and they appear in no event or `inspect()`. Why not `prism.state.log`: that log belongs to a package, has no per-key caps, and shares its kind with values tools and folds read.
- `end()`: first `run.end` continue wins, capped by `limits.maxContinuations` (then `{ continue: false }`).

## Extension and configuration notes

- `revision` joins the durable fingerprint; a custom loop on a durable run must declare `snapshot`
  and `restore`.
- `emit(name, data)` can produce only a `package.event`. A `name` equal to a catalog event or hook name
  (`tool.completed`, `run.started`, …) throws `emit_reserved_name`, so a loop cannot forge an event a primitive owns.
- `executeTools` is re-entrant: several overlapping calls (a broker answering concurrent callbacks) each fire
  `tool.call` once per call and append their results as they finish. Results come back in input order, and a
  denied call comes back as a `hook_denied` result and an approval-pending call as a result with
  `metadata.approvalPending`. A throwing `tool.call` hook denies only its own call. `maxToolRounds` is checked in `turn()`, so
  concurrent rounds only increment the counter.
- `origin` (an `EventOrigin`) is passed to the `tool.call` payload and stamped on that call's `tool.started`/`tool.completed`
  events. Absent means "this agent, executed by Prism".
- `compaction.when` fires at the existing auto-compaction check point. Handlers vote `true` (compact), `false` (veto), or `undefined` (abstain); the configured `trigger`/`thresholdEntries` decides only when every registered handler abstains or none is registered.
- A provider rejection for size recovers once inside the same turn. `classifyProviderFailure` stamps `context_overflow` from the route's body (`context_length_exceeded`, `maximum context length`, `context window exceeds limit`, `prompt is too long` on 400/413/422); a route with no distinguishable body still recovers when its 400/413/422 arrives while our estimated input exceeds the model's declared window. The session then compacts through the `compaction` slot with `trigger: "overflow"` (the provider already decided, so `compaction.when` is not consulted), rebuilds the request through `context.build`/`model.request`, and retries the call once. `maxTurns` is not charged again, and the rejected attempt records no projected usage. A second overflow, an overflow after output started, or a failing compaction fails the run with `ContextOverflowError` (`code: "context_overflow"`), whose message carries the estimated input and the declared window — never prompt text.

## Security and performance notes

- `RunController` exposes no registry, provider, or dispatch handle; a test asserts its own keys.
- With no hooks registered, `turn` adds no provider request, store write, or per-turn allocation
  beyond the wrapper object.
- A `turn.before` stop leaves a resumable state; the run ends cleanly, not as a failure.
- Overflow recovery costs nothing unless a provider rejects: then one compaction (the slot owner's cost) plus one retried model call.

## Related APIs

- `defaultLoop`: the kernel loop.
- `RunController`: the only handle a loop gets.
- `run.end` / `turn.before`: the loop's decision hooks.
- `askEveryTool`: ask before every tool call.
- `loadSuspendedRunEntry`: read a suspended run from the store slot.
- [`examples/custom-loop.ts`](../examples/custom-loop.ts): a plan-then-act loop with a host tool gate.
- [Driver kit](drivers.md): a loop that runs an external agent on a vendor binary, with `usesModel: false` and the
  `driverPackage` slot claim.
