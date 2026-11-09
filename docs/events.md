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

`connectAgent` from `@arnilo/prism-remote` preserves each forwarded event's catalog type. An event without an origin gains `{ kind: "prism", agent, agentId, remote: endpointId, depth: 0 }` from the served agent. An existing origin retains its fields and gains `remote` only when absent: the innermost endpoint wins across multiple hops.

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
| `run.started` | `{ resumed?, restore? }` | A run begins. `resumed: true` marks a durable resume of a suspended run; `restore` is the audit of the external-state restore hooks that ran before the claim. |
| `run.completed` | `{ status, usage?, stopReason?, stopDetail? }` | The run ended cleanly. `status` is `"completed"` for a natural end and `"stopped"` when `stopReason` names a ceiling, a `turn.before` stop, or a continuation cap. |
| `run.failed` | `{ error, limit?, attribution? }` | The run failed. A configured ceiling adds `limit` (which axis, maximum, observed) and `attribution` (counters at exhaustion, closest other axes, hashes of recent tool calls). |
| `run.suspended` | `{ interruption, version }` | The run is staged for suspension on an unresolved `ask`. `interruption.pendingDecisions` holds the redacted requests. |
| `turn.started` | `{ turn, metadata, attempt?, retry? }` | A provider attempt began. `metadata` carries `providerId`, `model`, and `attempt`. A retry re-opens the turn with `retry: { delayMs, error }`. |
| `turn.completed` | `{ turn, metadata, usage?, error? }` | The attempt settled. `metadata` carries `latencyMs`, `stopReason`, `budgets`, and cache counts; `error` is redacted. |
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
| `hook.error` | `{ hook, owner, error }` | A hook threw. The run continues; `owner` is kernel-set. |
| `package.status` | `{ package, level, message, at }` | A package called `status.note`. Agent-scoped and redacted. |
| `package.event` | `{ package, name, data? }` | A package emitted a namespaced event, e.g. `memory.session.status`. Kernel modules use `package: "kernel"` until their owning phase gives them a dedicated name. |

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

- A subscriber whose queue overflows under the default `close` policy has its iterator **rejected**
  with `SubscriberOverflowError`; the kernel never synthesizes a marker event. `drop_oldest` and
  `drop_newest` are the lossy alternatives.
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
