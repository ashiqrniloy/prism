# Hooks

## What it does

A hook is a named extension point in the kernel. Every hook has one of four kinds, and the kind
decides how handlers compose:

| Kind | Handler shape | Combination |
| --- | --- | --- |
| `observe` | `(payload, ctx) => void` | Fan-out. Every handler runs; nothing is transformed. |
| `transform` | `(value, ctx) => value \| undefined \| ctx.reject(reason)` | Ordered. Each handler sees the previous result; `undefined` keeps the current value. |
| `decide` | `(payload, ctx) => decision \| undefined` | Per-hook rule (table below). |
| `around` | `(payload, next, ctx) => Promise<result>` | Nested by priority; the highest priority is outermost. |

The catalog is fixed and typed: a handler for `tool.call` gets the `tool.call` payload and result,
with no string hook names and no `any`. `HOOK_CATALOG` lists every name and kind.

## When to use it

A host or package author registers a hook when it wants to observe or shape a run without replacing
the loop. Hooks are how the kernel exposes its safety gates: replacing the loop does not bypass
`tool.call`, `model.request`, or `model.call`, because those fire inside the kernel primitives.

## Inputs / request

Register with `AgentConfig.hooks` (host hooks) or through the package API. Each registration carries:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `priority` | `number` | `0` | Higher runs first. Ties run in registration (load) order. |
| `id` | `string` | none | Optional suffix; the full id is `<owner>:<hook>[#<id>]`. |
| `onError` | `"ignore"` | none | Transform hooks only: a throw emits `hook.error` and keeps the current value. |

The owner is set by the kernel (host or package name); a handler cannot choose it. Registering an
unknown hook name, a duplicate id (same owner, hook, and `id`), a non-function handler, a
non-finite priority, or `onError` on a non-transform hook fails closed.

### `context.session`

Every handler receives `context.session` (a `SessionContext`, see [packages](packages.md)) bound to
the **registering owner**, so a package's `session.background(...)` is checked against that package's
capabilities. The view is built once per owner per session; dispatch builds one context per owner per
call and nothing when no handler is registered. `removeOwner(owner)` removes every registration an
owner holds, which unwinds and disposes a package.

### `context.sessionId` and `context.runId`

Every handler's context names the session and the run it is serving. A payload that carries them
(a decide hook such as `turn.before` or `run.end`) supplies them directly; a transform payload is
often a bare value — a message, a message list, a `ProviderRequest` — so the kernel supplies the run
identity at dispatch, and `context.runId` is set from the run that is transforming rather than `""`.
A package can therefore key per-run state on `context.runId` from `run.input`, `message.append`,
`context.build`, `model.request`, and `model.response`, and reset it on the `run.started`
event (an observe hook) that opens each run. `context.sessionId`/`context.runId` are
`""` where no run identity exists (setup, session-level calls, package events).

### Registration ids and owners

Every registration has the id `<owner>:<hook>[#<id>]`, for example `host:tool.call#net` or
`pkg-a:context.build`. The owner is a property of the registrar the kernel hands out (the bus's
`registrar(owner)`), never of a registration option, so a package cannot register under another
owner's name.

- Two owners may use the same `id` suffix. Under one owner and hook, an explicit `id` is unique.
  Registrations without an `id` may repeat and share one id.
- `HookError.owner`, the `tool.call` deny text (`<owner>:<hook>: <message>`), and `hook.error` events
  name the registering owner.
- `registrations()` lists `{ id, owner, name, kind, priority }` in execution order per hook: priority
  descending, then registration order.
- `remove(id)` unregisters every registration with that id and returns whether any existed. It backs
  `disable.hooks` and package dispose.
- A session registers its guardrail-pack hooks under the owner `kernel` with a `#session-<n>` id
  suffix. The durable fingerprint ignores that suffix, but it does cover every other id: a suspended
  run resumes only against an agent whose `<owner>:<hook>[#id]` set is the same, so changing the
  package set fails the resume closed.

## Outputs / response / events

Catalog (roadmap §2.4). `payload → result` is the handler's value; the error policy is per kind.

| Hook | Kind | Payload → result | Combination / error policy |
| --- | --- | --- | --- |
| `run.input` | transform | messages → messages | ordered; throw fails the run |
| `turn.before` | decide | turn counters → `{ stop }` | any stop stops; throw fails closed |
| `context.build` | transform | context draft → draft | ordered; throw fails closed |
| `model.request` | transform | request → request | ordered; throw fails closed |
| `model.call` | around | request, `next` → event stream | nested by priority; throw fails the operation |
| `model.response` | transform | assistant message → message | ordered; throw fails closed |
| `tool.call` | decide | call → allow / deny / ask / rewrite / respond | deny wins; a rewrite is applied and the gate runs again on the final arguments (see below); throw is a deny |
| `tool.execute` | around | call, `next` → tool result | nested by priority; throw fails the operation |
| `tool.result` | transform | result → result | ordered; throw fails closed |
| `message.append` | transform | message → message | ordered; throw fails closed |
| `run.end` | decide | transcript view → `{ continue }` | first continue wins, capped by `limits.maxContinuations`; throw fails closed |
| `compaction.when` | decide | context estimate → `{ compact: true }` | while a handler is registered it is the whole decision; otherwise `CompactionOptions.thresholdEntries` (the kernel default trigger) is the fallback; throw fails closed |

Context engineering is package work, not a kernel stage: `@arnilo/prism-context-engineering` registers
one `context.build` handler that composes tool-result folding, tool search, attention, and budget
eviction in a fixed order at the lowest first-party priority (so a budget sees every block another
handler added this turn), plus a `compaction.when` handler when attention is configured and the
`search_tools` tool when disclosure is `"search"`. A host therefore sees the stages where it sees
every other contribution — `inspect().hooks["context.build"]` filtered by owner — and a kernel run
without the package trims nothing. `contextBudget`, `toolResultFold`, `toolsDisclosure`,
`toolsSearch`, and `attentionCompiler` are gone from `AgentConfig` and `RunOptions`.
| every `AgentEvent["type"]` | observe | the event | fan-out; a throw emits `hook.error` and the run continues |

A `tool.call` `{ ask }` ends one of two ways. With a `HostUi` present and an interactive run, the kernel sends a
`confirm` request inline. Otherwise the run suspends (`status: "suspended"`, `pending`), the suspension is
written through the `store` slot, and the host continues it with `session.resume(decisions)`, in the same
process or a new one. See [agent.md](agent.md#runresult-and-sessionresume).

A `tool.call` decision is evaluated in at most two rounds per call. Round 1 collects every handler's
decision: any `deny` wins, and if one or more handlers returned `rewrite`, the merged rewrite becomes the
call's arguments and round 1's `ask`/`respond` is discarded. Round 2 runs the gate again on those arguments,
and its `deny`, `ask`, or `respond` applies to the call that executes. A round-2 `rewrite` that changes the
arguments again denies with `rewrite_unstable`; two round-1 rewrites that set one key to different values
deny with `rewrite_conflict`. A rewrite equal to the round's input is dropped, so an `ask` on
already-rewritten arguments is not hidden. The payload `args` is a deep-frozen copy per round, so an
in-place mutation throws and is treated as a deny. A handler may therefore run twice for a rewritten call:
a gate that prompts the host sees the final arguments, so it may prompt once per round that needs a
decision. `tool.execute` is wrap-only: a handler that calls `next()` with a different name or arguments
raises `HookError` `ERR_PRISM_HOOK_EXECUTE_REWRITE` and the tool does not run.

`session.resume()` replays a suspended call through the same two rounds, then `tool.execute`,
`tool.result`, and the transcript append. The decision that answered the `ask` satisfies it again only
for the exact arguments it approved: a rewrite that moved the call off them is staged as a new pending
decision and the run suspends, and a `deny` on the final arguments still wins.

Observe hooks are named for the event they carry, so the observe hook for a text delta is
`message.delta` (and every other `AgentEvent["type"]` has one). They run synchronously and
are never awaited, so an observer never delays a run. A throwing observer (or a rejected returned
promise) emits a `hook.error` event with the owner and hook.

The catalog is the 23 names in [events.md](./events.md) — nothing else is legal, and
`src/hooks/catalog.ts` is keyed by the event union so a new event type fails to compile until it
is listed there too.

### Session, status, and background events

Six observe hooks carry no run. They use the dotted names the roadmap fixed for new events
(`hook.error` and `package.event` set the precedent), and each has an empty `runId`.

| Hook | Payload | Fired by |
| --- | --- | --- |
| `session.opened` | `{ sessionId, restored }` | `agent.session()`, as it resolves: eager, so `session()` awaits the hooks but a run does not. `restored` is true when the session was resumed with `{ id }` or is a `fork` (its branch was read or copied and package state hydrated) and false for a new session, which reads nothing. |
| `session.closed` | `{ sessionId, reason? }` | The end of `session.close()`, after background tasks settle. |
| `package.status` | `{ package, level, message, at }` | `status.note`. Agent-scoped (`sessionId` is empty) and redacted. |
| `background.started` | `{ sessionId, package?, name, taskId }` | `SessionContext.background`. `package` is set when a loaded package started the task. |
| `background.completed` | `{ sessionId, package?, name, taskId, durationMs }` | The task's promise resolved. |
| `background.failed` | `{ sessionId, package?, name, taskId, reason, error? }` | The task rejected (`reason: "error"`, redacted `error`), or `close()` gave up on it (`reason: "aborted"`, no error). |

`session.opened` and `session.closed` reach hooks and `agent.subscribe()`, not a session's own
stream, so a stream still starts with the run's own `run.started`. The other four reach session
subscribers as well, because they report work a host may want to show. An event raised outside a run
is redacted with the agent's own redactor, since no run redactor is active.

## Request/response example

```json
{
  "hooks": {
    "tool.call": { "priority": 100, "id": "deny-network" },
    "message.delta": {}
  }
}
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openai:gpt-4.1",
  hooks: {
    // transform: reject a prompt, or return a new value
    "run.input": (messages, ctx) => (messages.length === 0 ? ctx.reject("empty input") : messages),
    // decide: deny a capability
    "tool.call": (call) => (call.effects.includes("network") ? { deny: "network tools are disabled" } : "allow"),
    // observe: never blocks, never fails the run
    "message.delta": (event) => process.stdout.write(event.delta.type === "text" ? event.delta.text : ""),
  },
});
```

## Extension and configuration notes

- Host hooks load last, after every package hook, and are unnamed (the owner is `host`).
- A package registers hooks under its package name; the same hook can be contributed by several
  packages and composes by the kind's rule.
- `RunController.emit(name, data)` and `HookContext.emit(name, data)` emit a `package.event` and nothing else. The
  loop's emit is owned by the loop slot's owner; a hook's emit is owned by its registering package. A catalog event
  name throws `emit_reserved_name`. The bus emits `hook.error`. Both are observe hooks.
- The catalog and slot contracts are frozen; new hooks are added to the catalog table,
  not to control flow.

## Security and performance notes

- `hook.error` events and hook error messages pass through the redactor; a secret in a thrown
  message is replaced with `[REDACTED]` before it reaches an event or an error.
- A throwing `transform` or `decide` handler fails closed. For `tool.call`, a throw is returned as a
  deny whose reason names the owner and hook.
- Registering hooks is O(1). Handler lists sort once at first dispatch, and dispatching with zero
  handlers allocates nothing.

## Related APIs

- `RunController`: fires `turn`, `executeTools`, `append`, `end`, and `emit`; the only path that
  reaches the hook bus.
- `HOOK_CATALOG`: the frozen name-and-kind table.
- `ToolDefinition.effects`: the capability annotation reported to `tool.call`.

## Frozen surface

The catalog above, the four slot names in [slots.md](slots.md), and the decide-hook combination
rules are public contract. `src/__tests__/hook-catalog-freeze.test.ts` pins all three as
data: an addition or rename is a one-line diff in that test plus this page, reviewed
together.
