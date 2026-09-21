# Middleware hooks

## What it does

Middleware hooks are ordered, host-owned functions that transform a payload only when a host/runtime explicitly calls `run()`. They are a primitive for provider, input, tool, compaction, retry, and session runtime phases.

APIs:

- `createMiddlewareRegistry()` / `MiddlewareRegistry`
- `MiddlewareHookName`, `Middleware<T>`, and `MiddlewareNext<T>`
- `ExtensionAPI.use()` for extension registration

## When to use it

Use middleware hooks when a host wants extension/package code to observe or transform a value at a named runtime boundary.

Do not use middleware hooks as a provider adapter, prompt builder, retry policy, compaction strategy, tool dispatcher, permission system, or agent/session runtime. Per-turn tool menus use `AgentConfig.toolNarrowing` / `RunOptions.toolNarrowing`, not a middleware hook — see [Tools](tools.md). Run-end decisions use stop hooks (`AgentConfig.stopHooks` / `RunOptions.stopHooks`) — see [Hooks](hooks.md) — not a middleware hook.

## Inputs / request

```ts
createMiddlewareRegistry(options?: MiddlewareRegistryOptions): MiddlewareRegistry
```

Built-in hook names:

- `beforeProviderTurn`
- `provider_request`
- `input_assembly`
- `prompt_build`
- `context`
- `tool_call`
- `tool_result`
- `retry`
- `compaction_request`
- `compaction`
- `session_start`
- `session_shutdown`

`MiddlewareRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `use(hook, middleware)` | hook name and middleware | Registers middleware in order and returns an unsubscribe function. |
| `run(hook, value)` | hook name and payload | Runs registered middleware and returns the final payload. |
| `list(hook)` | hook name | Returns registered middleware for inspection. |

`Middleware<T>` receives `(value, next)` and returns a value or promise. Calling `next(updatedValue)` passes an updated value to later middleware. Two rules are enforced: call `next()` **at most once** — a second call throws (routed through the registry `errorPolicy`) naming hook and index; and **either** `return next(v)` **or** return a new value, never both — when `next(v)` was already called, a conflicting return is discarded and diagnosed via `onError` (the `next()` value wins).

## Outputs / response / events

`run()` returns the transformed value. If no middleware is registered for a hook, `run()` returns the original value. `assembleProviderInput()` calls Phase 5 hooks in this order when middleware is supplied: `input_assembly`, then `context`, then `prompt_build`. The `input_assembly` call is unconditional — it runs after whatever `InputBuilder` produced the messages, so host middleware at that hook cannot be skipped by a custom builder. The agent/session runtime runs `beforeProviderTurn` once per turn after the request is assembled and before any provider-round work, then applies configured provider request policies, then invokes `provider_request` once with the `ProviderRequest` before `AIProvider.generate()`, invokes `tool_call` and `tool_result` through `dispatchToolCall()` for complete provider tool calls, invokes `compaction_request` with the strategy's `CompactionContext` before the strategy runs — only when compaction triggers (manual `session.compact()` and auto-compaction both route through it), so a handler rewrites `entries`, `keepRecentEntries`, `metadata`, or `secrets` for the strategy — then invokes `compaction` with `{ context, result }` after the strategy returns and before the runtime appends its standard compaction entry, and invokes `retry` with `{ context, decision }` before scheduling a provider-turn retry. There is no `provider_response` hook; observing provider output belongs to the provider adapter or subscriber events.

Session lifecycle hooks are dispatched by the agent/session runtime, once each:

| Hook | When | Payload |
| --- | --- | --- |
| `session_start` | First run start of a session, after `agent_started`/`agent_resumed` and before the first provider turn. A session rebuilt from a durable checkpoint is a new runtime session, so it opens again. | `{ sessionId, runId }` |
| `session_shutdown` | `session.close()`, before every subscriber is closed. Idempotent — calling `close()` twice dispatches once. | `{ sessionId }` |

Both are one dispatch per session, never per turn, and both honor the registry `errorPolicy` exactly like every other hook: with `"event"` a throw becomes an `extension_error` event and the run continues, with `"throw"` it surfaces (for `session_start`, `session.run()` rejects; for `session_shutdown`, `close()` rejects after closing subscribers).

With default `errorPolicy: "event"`, middleware errors become `extension_error` events when `onError` is provided, and later middleware still runs with the current value. With `errorPolicy: "throw"`, `run()` rejects on the first middleware error.

## Request/response example

```json
{
  "hook": "provider_request",
  "before": { "metadata": {} },
  "after": { "metadata": { "source": "demo" } }
}
```

## Implementation example

```ts
import { createMiddlewareRegistry } from "@arnilo/prism";

const middleware = createMiddlewareRegistry();

middleware.use("provider_request", async (request, next) => {
  return next({
    ...request,
    metadata: { ...request.metadata, source: "demo" },
  });
});

const request = await middleware.run("provider_request", { metadata: {} });
console.log(request.metadata.source);
```

Extensions can register middleware through the runtime API:

```ts
import type { Extension } from "@arnilo/prism";

export const extension: Extension = {
  name: "demo-middleware",
  setup(api) {
    api.use("session_start", (event) => {
      // Once per session: provision session-scoped state here.
      return event;
    });
  },
};
```

`session_shutdown` runs on `await session.close()`, which then closes every subscriber:

```ts
const session = createAgent({ model, provider, middleware }).createSession();
await session.run("hello");
await session.close(); // session_shutdown middleware once, then every subscriber closes
```

## Pre-compaction rewrite (`compaction_request`)

`compaction_request` is the input side of the compaction pair: it runs once per compaction event, right
after `compaction_started` and before the strategy's `compact()`, and its return value **is** the
strategy's input. The payload is the same `CompactionContext` the strategy would have received
(`sessionId`, `entries`, `keepRecentEntries`, `trigger`, `secrets`, `metadata`, `signal`), and the
post-strategy `compaction` hook then observes that rewritten context — so a subscriber always sees
what actually compacted.

```ts
import { createMiddlewareRegistry, type CompactionContext } from "@arnilo/prism";

const middleware = createMiddlewareRegistry();
middleware.use<CompactionContext>("compaction_request", (context, next) =>
  next({ ...context, entries: pinCriticalFacts(context.entries) }),
);
```

Contract:

- Only compaction events dispatch it: ordinary turns no-op, even with auto-compaction configured but not triggered.
- Returning `undefined` without `next()` leaves the original context in place; the registry's `next()`-shape rules apply as everywhere else.
- A throw follows the registry `errorPolicy`: with `"event"` the error is reported and compaction proceeds on the last committed context; with `"throw"` `session.compact()` (or the run, on the auto path) rejects and no compaction entry is appended.
- The seam rewrites input, it cannot skip compaction: an empty or invalid entry set is the strategy's own error, not `"do nothing"`.
- Validation stays where it already was. Entries are redacted on append and the strategy owns its input expectations; the hook is host code inside the same trust boundary as `AgentConfig.compaction`, not a remote endpoint.

## No-model turns (`beforeProviderTurn`)

`beforeProviderTurn` lets the host answer a turn from data it already has — teaching empty states, canned flows, deterministic lookups — without any provider request. The payload is `BeforeProviderTurnPayload` (`sessionId`, `runId`, `turn`, `userText`) and middleware returns it unchanged or with `answer: DeterministicTurnAnswer` set:

```ts
export interface DeterministicTurnAnswer {
  readonly content: readonly ContentBlock[];
  readonly provenance: { readonly middleware: string };
}
```

```ts
import { createAgent, createMiddlewareRegistry, type BeforeProviderTurnPayload } from "@arnilo/prism";

const DESK_ANSWERS = new Map([["what can you do?", "I answer from local records; ask about an order id."]]);
const middleware = createMiddlewareRegistry();
middleware.use<BeforeProviderTurnPayload>("beforeProviderTurn", (payload, next) => {
  const text = DESK_ANSWERS.get(payload.userText);
  return text ? { ...payload, answer: { content: [{ type: "text", text }], provenance: { middleware: "desk" } } } : next(payload);
});

const session = createAgent({ model, provider, middleware }).createSession();
await session.run("what can you do?"); // no provider call; assistant message recorded
```

Contract:

- Returning the payload without `answer` (or returning `undefined`) sends the turn to the provider exactly as if the hook were absent.
- `answer.provenance.middleware` is mandatory and validated as a bounded id (1–64 chars: letters, digits, `.` `_` `:` `-`); a deterministic turn can never masquerade as model output.
- `answer.content` accepts assistant-visible content blocks (`text`, `image`, `audio`, `file`, `document`, `video`, `thinking`). Tool-call blocks are rejected — no provider ran to authorize a call — and an empty block array throws `DeterministicTurnError` (`ERR_PRISM_DETERMINISTIC_TURN`), failing the run closed instead of falling through to the provider.
- Content passes the same output guardrails as provider output and is charged against `maxResponseBytes`, but the turn records no usage: usage is absent, never zero, and the run timeline shows a `deterministic` step named after the answering middleware.
- Provenance persists: the assistant message carries `metadata.deterministic = { middleware }`, so a transcript loaded back from any session store still proves the turn had no model behind it. `summarizeTimeline()`/`summarizeSession()` report `turns: { model, deterministic }`, and `createDeterministicTurnScorer()` (from `@arnilo/prism-core/governance/evals`) grades a trajectory for no-model coverage — failing a turn that both answered deterministically and still issued a provider request.

## Extension and configuration notes

- Middleware registration is explicit through `createMiddlewareRegistry()` or `ExtensionAPI.use()`.
- `provider_request` middleware sees generic `ProviderRequest.options` after request policies have run; do not add secrets unless a redactor/policy secret list covers that boundary.
- Middleware runs only when the host/runtime calls `run()` or passes the registry to a helper that documents a call site.
- `session_start`/`session_shutdown` dispatch only when the host passes its registry to `AgentConfig.middleware`; a session that never runs never starts, and one the host never closes never shuts down. Closing an idle session is fine — the hook still does not fire twice. There is no `session_start` for a session that only calls `compact()` or `contextMeter()`.
- `beforeProviderTurn` runs only for turns that reach the provider boundary; a turn already ended by a run limit, host turn policy, or durable suspension never reaches it, and host middleware is trusted code — it must not use the hook to bypass `RunLimits` or guardrails.
- `compaction` middleware may adjust the compaction result summary/data, but runtime still owns session store append ordering and branch parent ids.
- `compaction_request` runs once per compaction event with the strategy's context as payload; the runtime still redacts the summary, appends the compaction entry, and rebuilds history. Neither hook can skip compaction (an empty entry set is the strategy's error), and neither runs on ordinary turns.
- `retry` middleware may stop retrying or adjust delay, but runtime still owns retry event emission, abort-aware waiting, and provider-turn boundaries.
- The registry does not discover packages, read manifests, load config, call providers, execute tools, read resources, or start sessions.
- Hosts may pass a middleware registry into `createExtensionKernel({ middleware })` to share it with direct host code.
- For OpenTelemetry export, prefer `session.subscribe()` + `@arnilo/prism-core/governance/observability` (see [Observability](observability.md)) rather than adding a parallel event bus. Middleware hooks remain for transforming payloads at named boundaries.

## Security and performance notes

- Middleware is in-memory, ordered, dependency-free, and synchronous-or-async.
- Default error handling can emit redacted `extension_error` events through the extension kernel.
- Do not put resolved credential values, tokens, headers, secret settings, or permission grants into middleware payloads unless the host boundary explicitly allows it.
- Tool dispatch re-checks registry lookup, active allow/deny filters, and object arguments after `tool_call` middleware, so middleware cannot bypass host tool permissions by changing a tool name. `assembleProviderInput()` also keeps provider `tools` equal to the host-supplied active tool list after `prompt_build` middleware.

## Related APIs

- [Middlewares vs restore hooks](durable-runs.md#restore-hooks-all-or-nothing): middleware transforms payloads at named boundaries; `restoreHooks` restore external state before a durable resume and are not middleware.
- [Extension kernel and event bus](extensions.md): `ExtensionAPI.use()` and shared error policy.
- [Contribution registries](contribution-registries.md): direct contribution registration separate from middleware.
- [Agent/session runtime](agent-session-runtime.md): provider request policy/middleware timing, bounded tool loop call site for `tool_call`/`tool_result` hooks, and runtime call sites for `compaction` and `retry`.
- [Tools](tools.md): tool dispatch behavior that runs `tool_call` and `tool_result` hooks.
- [Hooks](hooks.md): the hook model, the Claude Code / Codex event map, the `hooks.json` adapter, and the run-end stop hooks that are separate from payload-transforming middleware.
- [Input and prompt assembly](input-and-prompt-assembly.md): `input_assembly` and `prompt_build` helper call sites.
- [Compaction and retry policies](compaction-and-retry.md): compaction/retry middleware payloads and runtime timing, including the pre-strategy `compaction_request` seam.
- [Context and skills](context-and-skills.md): `context` helper call site.
- [Observability](observability.md): optional OpenTelemetry adapter over `AgentEvent` streams.
- [Public contracts](public-contracts.md): provider, tool, context, session, and extension contracts that runtimes can pass through hooks.

Permission checks for tools, extensions, and resources are hard guards; middleware can transform payloads but cannot bypass a denied `PermissionPolicy`.
