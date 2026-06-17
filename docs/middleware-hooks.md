# Middleware hooks

## What it does

Middleware hooks are ordered, host-owned functions that transform a payload only when a host/runtime explicitly calls `run()`. They are a primitive for future provider, input, tool, retry, compaction, and session runtime phases.

APIs:

- `createMiddlewareRegistry()` / `MiddlewareRegistry`
- `MiddlewareHookName`, `Middleware<T>`, and `MiddlewareNext<T>`
- `ExtensionAPI.use()` for extension registration

## When to use it

Use middleware hooks when a host wants extension/package code to observe or transform a value at a named runtime boundary.

Do not use middleware hooks as a provider adapter, prompt builder, retry policy, compaction implementation, tool dispatcher, permission system, or agent/session runtime.

## Inputs / request

```ts
createMiddlewareRegistry(options?: MiddlewareRegistryOptions): MiddlewareRegistry
```

Built-in hook names:

- `provider_request`
- `provider_response`
- `input_assembly`
- `prompt_build`
- `context`
- `tool_call`
- `tool_result`
- `retry`
- `compaction`
- `session_start`
- `session_shutdown`

`MiddlewareRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `use(hook, middleware)` | hook name and middleware | Registers middleware in order and returns an unsubscribe function. |
| `run(hook, value)` | hook name and payload | Runs registered middleware and returns the final payload. |
| `list(hook)` | hook name | Returns registered middleware for inspection. |

`Middleware<T>` receives `(value, next)` and returns a value or promise. Calling `next(updatedValue)` passes an updated value to later middleware.

## Outputs / response / events

`run()` returns the transformed value. If no middleware is registered for a hook, `run()` returns the original value. `assembleProviderInput()` calls Phase 5 hooks in this order when middleware is supplied: `input_assembly`, then `context`, then `prompt_build`. The agent/session runtime also invokes `tool_call` and `tool_result` through `dispatchToolCall()` for complete provider tool calls.

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
import { createMiddlewareRegistry } from "prism";

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
import type { Extension } from "prism";

export const extension: Extension = {
  name: "demo-middleware",
  setup(api) {
    api.use("session_start", (event) => event);
  },
};
```

## Extension and configuration notes

- Middleware registration is explicit through `createMiddlewareRegistry()` or `ExtensionAPI.use()`.
- Middleware runs only when the host/runtime calls `run()` or passes the registry to a helper that documents a call site.
- The registry does not discover packages, read manifests, load config, call providers, execute tools, read resources, or start sessions.
- Hosts may pass a middleware registry into `createExtensionKernel({ middleware })` to share it with direct host code.

## Security and performance notes

- Middleware is in-memory, ordered, dependency-free, and synchronous-or-async.
- Default error handling can emit redacted `extension_error` events through the extension kernel.
- Do not put resolved credential values, tokens, headers, secret settings, or permission grants into middleware payloads unless the host boundary explicitly allows it.
- Tool dispatch re-checks registry lookup, active allow/deny filters, and object arguments after `tool_call` middleware, so middleware cannot bypass host tool permissions by changing a tool name. `assembleProviderInput()` also keeps provider `tools` equal to the host-supplied active tool list after `prompt_build` middleware.

## Related APIs

- [Extension kernel and event bus](extensions.md): `ExtensionAPI.use()` and shared error policy.
- [Contribution registries](contribution-registries.md): direct contribution registration separate from middleware.
- [Agent/session runtime](agent-session-runtime.md): bounded tool loop call site for `tool_call` and `tool_result` hooks.
- [Tools](tools.md): tool dispatch behavior that runs `tool_call` and `tool_result` hooks.
- [Input and prompt assembly](input-and-prompt-assembly.md): `input_assembly` and `prompt_build` helper call sites.
- [Context and skills](context-and-skills.md): `context` helper call site.
- [Public contracts](public-contracts.md): provider, tool, context, session, and extension contracts that runtimes can pass through hooks.
