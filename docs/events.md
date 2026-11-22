# Events

## What it does

Every run, session, and package reports what it is doing as a stream of `AgentEvent`s. The catalog
is frozen: there are exactly 23 event types, and each one is also an observe hook of the same name,
so `hooks.on("turn.completed", handler)` observes the event `session.stream()` yields.

Folds keep one event per occurrence. A tool call that fails, is blocked, or finishes is one
`tool.completed` carrying its `status`; a run that dies on a ceiling is one `run.failed` carrying
`limit` and `attribution`. A host never has to correlate a "started" event with a separate
"error" event to know what happened.

## When to use it

- Streaming a transcript or activity feed to a person.
- Persisting a durable audit trail (`AgentEventRecord`, `AgentEventSource`).
- Driving a TUI or a host protocol adapter (AG-UI, ACP).
- Reacting to a run without wrapping the loop (`hooks.on(event, …)`).

## Inputs

Every event carries `sessionId` and `runId`; `runId` is empty for session-scoped events. The
optional `origin` field (`EventOrigin`) is absent on a run's own events, meaning "this agent, executed by Prism". It is set
when activity comes from elsewhere (a driver-observed external agent, forwarded subagent work). It never replaces the
event's own `sessionId`/`runId`, and the redactor runs over every event as before. It replaces the removed `child` tag.

`EventOrigin` fields: `kind` (`"prism" | "external"`), `agent`, `agentId`, `depth` (0 is the run's own agent), and the optional
`vendor` (an opaque string set by the driver), `profile` (a profile name, never a credential), `remote`, `delegationId`,
`parentSessionId`, `parentToolCallId`, `subagentId`, and `executedBy` (`"prism" | "external"`: who ran a tool). The
`tool.call` hook payload carries the same optional `origin`; the kernel's own model-loop calls leave it absent.

### Remote attribution

`connectAgent` from `@arnilo/prism-hosts/remote` preserves each forwarded event's catalog type. An event without an origin gains `{ kind: "prism", agent, agentId, remote: endpointId, depth: 0 }` from the served agent. An existing origin retains its fields and gains `remote` only when absent: the innermost endpoint wins across multiple hops.

Every forwarded `tool.*` event sets `origin.executedBy: "external"`, including origins whose `kind` is `"prism"`. The remote agent ran its own tool gate; the connecting host's `tool.call` hook never fires for that activity. `remote` identifies the endpoint, while `executedBy` identifies execution relative to the connecting host. Neither changes the event's session or run id.

### External-agent activity

A driver loop reports vendor activity through `run.observe`. Tool activity emits the catalog `tool.started` / `tool.progress` /
`tool.completed` events with `origin.executedBy: "external"`; Prism did not run those tools and `tool.call` did not fire for them
(it fires for `run.ask`). Every other kind is a `package.event` owned by the loop slot owner, so the catalog count is unchanged:

| `name` | `data` |
| --- | --- |
| `agent.skill` | `{ name, source, resolved }` |
| `agent.file` | `{ path, change, diff?, source }` |
| `agent.plan` | `{ entries: { title, status }[] }` |
| `agent.subagent` | `{ phase, id, name?, parentToolCallId?, result? }`; `started` opens a nested `origin`, `completed` closes it |
| `agent.compaction` | `{ phase, summary? }` |
| `agent.notice` | `{ level, code, message }` |
| `agent.raw` | `{ vendor, type, data }` (redacted before emit) |

| Event | Payload | Fires when |
| --- | --- | --- |
| `session.opened` | `{ sessionId, restored }` | `agent.session()` resolved. `restored` is true when the session was resumed with `{ id }` or is a `fork`. Reaches hooks and `agent.subscribe()`. |
| `session.closed` | `{ sessionId, reason? }` | `session.close()` finished settling background tasks. |
| `run.started` | `{ resumed?, continued?, restore? }` | A run begins. `resumed: true` marks a durable resume of a suspended run; `continued: true` marks a `session.continue()` run, which takes no new input; `restore` is the audit of the external-state restore hooks that ran before the claim. |
| `run.completed` | `{ status, usage?, stopReason?, stopDetail?, output?, outputError? }` | The run ended cleanly. `status` is `"completed"` for a natural end and `"stopped"` when `stopReason` names a ceiling, a `turn.before` stop, or a continuation cap. `output` / `outputError` match `RunResult` when the run asked for structured output. |
| `run.failed` | `{ error, limit?, attribution? }` | The run failed. A configured ceiling adds `limit` (which axis, `scope?: "run" | "session"` — present as `"session"` for session-wide limits and absent for run limits, maximum, observed) and `attribution` (counters at exhaustion, closest other axes, hashes of recent tool calls). |
| `run.suspended` | `{ interruption, version }` | The run is staged for suspension on an unresolved `ask`. `interruption.pendingDecisions` holds the redacted requests. |
| `turn.started` | `{ turn, metadata, attempt?, retry? }` | A provider attempt began, once per attempt. `metadata` carries `providerId`, `model`, and `attempt`. A retry re-opens the same `turn` with `attempt` and `retry: { delayMs, error }` on that attempt's own `turn.started`. |
| `turn.completed` | `{ turn, metadata, usage?, error? }` | The attempt settled. `metadata` carries `latencyMs`, `stopReason`, `budgets`, and cache counts; `error` is redacted. With `error`, the attempt's deltas are void (see [Failed attempts](#failed-attempts)). |
| `message.delta` | `{ content }` | One streamed content block. Opens the message; there is no separate message-start event. |
| `message.completed` | `{ message }` | The assistant message was appended to history. |
| `tool.started` | `{ call }` | A tool call is about to run. |
| `tool.progress` | `{ toolCallId, name, progress?, metadata? }` | A tool reported progress. |
| `tool.completed` | `{ toolCallId?, name?, result, metadata, status, error?, reason? }` | The call settled. `status` is `finished`, `error`, or `blocked`; `reason` is present when blocked, `error` when it threw. |
| `decision.pending` | `{ decisions }` | An `ask` was staged for suspension. Carries redacted `PendingDecision` records — hashes and scopes, never raw arguments. |
| `decision.resolved` | `{ decisions, via }` | The staged batch settled: `via: "inline"` for a host answer, `"resume"` for a later `resume(decisions)`. Each entry is `{ toolCallId, outcome }`. |
| `compaction.started` | `{}` | Compaction began. |
| `compaction.completed` | `{ summary?, entriesCompacted?, trigger?, error? }` | Compaction finished, or failed with a redacted `error`. `trigger` is `"manual"`, `"auto"`, or `"overflow"` (context-overflow recovery). |
| `background.started` | `{ package?, name, taskId }` | A `SessionContext.background` task started. |
| `background.completed` | `{ package?, name, taskId, durationMs }` | The task finished. |
| `background.failed` | `{ package?, name, taskId, reason, error? }` | The task failed or `close()` aborted it. |
| `hook.error` | `{ hook, owner, error }` | A hook threw. The run continues; `owner` is kernel-set. Delivered to the session whose dispatch raised it, and to no other session; one raised outside any session reaches `agent.subscribe()` only. |
| `package.status` | `{ package, level, message, at }` | A package called `status.note`. Agent-scoped and redacted. |
| `package.event` | `{ package, name, data? }` | A package emitted a namespaced event, e.g. `memory.session.status`. Kernel modules use `package: "kernel"` until their owning phase gives them a dedicated name. A handler's `ctx.emit` is delivered like `hook.error`: to the session that dispatched the hook only, or to `agent.subscribe()` when no session did. Kernel events: `history.repaired` `{ count, callIds }` (a run's provider view answered tool calls the branch never answered; ids only); `model.call` `{ package, provider, model, outcome, latencyMs, usage? }` (one per model call a package made through `models.client`; delivered to the session passed in `generate(..., { session })`, else to `agent.subscribe()`; no message content). |

### Failed attempts

A provider attempt can fail after it streamed output, and the run may retry it (`retry.afterOutput`,
[Models](models.md#retry)). The rule a consumer follows: **discard the deltas of a turn attempt that ends with
`error`.** Nothing of that attempt reaches the branch, no `message.completed` is emitted for it, and none of its
tool calls run.

```text
turn.started {turn: 3, metadata.attempt: 1} → message.delta… → turn.completed {turn: 3, error}
turn.started {turn: 3, attempt: 2, retry} → message.delta… → turn.completed {turn: 3} → message.completed
```

The first-party host libraries apply the rule:
ACP holds each attempt's chunks until it completes, AG-UI ends the failed attempt's messages and names them in a
`prism.retry` custom event, and channel previews restart. `remote` and `devtools` forward events unchanged, so
their clients apply it.

### Delivery under caps

`message.delta` events are delivered as the provider yields them, whatever limits are set. A turn whose usage
breaches a ceiling (`maxOutputTokens`, `maxTotalTokens`, `maxCost`) is reported once it has streamed, in the
failed-attempt shape above, and the same discard rule applies:

```text
turn.started → message.delta… → turn.completed {error} → run.failed {limit, attribution}
```

Nothing of the breaching turn is appended to the session. A host that must not show any output of a turn that
breaches a cap sets `limits.bufferOutput: true` (agent or run; `true` at either layer wins): each turn's deltas
are then held until its usage has been charged, and a breaching turn emits `turn.started` →
`turn.completed {error}` → `run.failed` with no deltas. Buffering gives up streaming: every delta of a turn
arrives together, just before `turn.completed`.

### Subscribers and backpressure

Each subscriber (`session.subscribe()`, `session.stream()`/`resume()`, `agent.subscribe()`) has its own queue,
and pushing never waits, so a slow consumer cannot pace the run or another subscriber. The queue holds
`SubscribeOptions.maxQueuedEvents` events (default 4,096; a whole coding run is about 120). What happens when a
consumer falls behind follows `SubscribeOptions.overflow`:

| Policy | Behavior |
| --- | --- |
| `coalesce` (default) | While the consumer is not awaiting, a `message.delta` whose text (or thinking, when neither side is `redacted` and neither has `data`) continues the queue's last delta of the same run and origin is merged into it, up to 16 KiB of text per merged delta. A queued `tool.progress` is replaced by a newer one for the same `toolCallId`, which takes the newer one's position. Nothing else merges, and order across types holds. When the bound is reached by events that cannot be merged, the iterator rejects with `SubscriberOverflowError`. |
| `close` | No merging; the iterator rejects with `SubscriberOverflowError` at the bound. |
| `drop_oldest` / `drop_newest` | No merging; the oldest queued event, or the new one, is dropped. |

A merged delta's text is exactly what concatenating its parts gives. Events are redacted before they reach any
queue, so merging cannot reassemble a secret the redactor masked. A consumer that needs every delta boundary
(per-delta timing, say) passes `overflow: "close"`.

`session.stream()` and `session.resume()` abort the run when the consumer stops (`break`, `return`, or a throw
from the loop body). An overflow is not a stop: the generator throws `SubscriberOverflowError` and the run
continues to its result. Its messages land in the session (`session.messages()`), its terminal event reaches
any other subscriber (an `acrossRuns` `session.subscribe()` sees `run.completed` / `run.failed`), and the ledger
records it. A new `run()` on that session rejects until it settles.

## Outputs

`session.stream(input, options)` yields the events of one run; `session.subscribe(options)` yields
a session's events across runs; `agent.subscribe()` yields agent-scoped ones. `session.entries()`
returns the persisted branch, whose `event` field holds the same objects.

## Example

```ts
for await (const event of session.stream("summarise the log")) {
  if (event.type === "message.delta" && event.content.type === "text") process.stdout.write(event.content.text);
  if (event.type === "tool.completed" && event.status !== "finished") console.warn(event.name, event.status, event.reason);
  if (event.type === "run.failed") console.error(event.limit ? `limit ${event.limit.limit}` : event.error.message);
  if (event.type === "run.completed") console.log(event.status, event.stopReason ?? "end_turn");
}
```

A host that watches the whole agent subscribes once and sees `package.status`, `background.*` and
`session.*` across every session, and a resumed run's `decision.resolved` followed by `run.started`
(`resumed: true`) comes from `session.resume`:

```ts
for await (const event of agent.subscribe()) {
  if (event.type === "package.status") log(event.package, event.level, event.message);
}
const resumed: string[] = [];
for await (const event of session.resume(decisions)) resumed.push(event.type);
// ["decision.resolved", "run.started", "tool.started", "tool.completed", "turn.started", …, "run.completed"]
```

`examples/session.ts`, `examples/approval.ts` and `examples/host-hooks.ts` print these streams.

## Fail-closed notes

- A subscriber whose queue overflows under `coalesce` (default) or `close` has its iterator **rejected**
  with `SubscriberOverflowError`; the kernel never synthesizes a marker event. `drop_oldest` and
  `drop_newest` are the lossy alternatives. An overflow ends the iterator, not the run.
- A projection that reads a stored event whose type is no longer in the catalog **skips** it. No
  reader switches on a persisted event type, and no event reaches a durable resume.
- `decision.pending` and `run.failed` carry redacted reasons and hashes; raw tool arguments never
  appear in an event.

## Extension notes

- Adding an event type means editing `AgentEventPayload`, `OBSERVE_HOOKS`, the known-type table behind
  `isKnownAgentEventType` (the build fails until it is listed), this page, and the frozen catalog test in one change.
- A later minor may add event types and fields. A host ignores a type or field it does not know, or filters with
  `isKnownAgentEventType(type)`; see [compatibility.md](compatibility.md).
- Kernel modules that emit through `package.event` are listed in the migration table in
  `CHANGELOG.md`; each moves to a dedicated name when its phase lands.

## Driver events

An external agent's activity reaches the stream through `RunController.observe`. The standard `agent.*` names
(`agent.skill`, `agent.file`, `agent.plan`, `agent.subagent`, `agent.compaction`, `agent.notice`, `agent.raw`) and their
constructors are described with the driver kit: see [driver kit](drivers.md#agent-events).
