# Context and skills

## What it does

`resolveContextProviders()` runs host-selected `ContextProvider` objects in caller order and returns explicit `ContextBlock[]`. It is the default context pipeline for Phase 5 input/prompt assembly.

This page currently documents ordered context resolution. Skill registry and progressive disclosure are added in the next Phase 5 task.

## When to use it

Use it when a host wants project/session/context blocks resolved before prompt composition. Pass only providers the host selected.

Do not use it as an agent loop, package discovery mechanism, context cache, token budgeter, retrier, credential resolver, or tool permission system.

## Inputs / request

```ts
import { resolveContextProviders } from "prism";

const context = await resolveContextProviders({
  providers: [projectContext],
  messages,
  sessionId: "s1",
  runId: "r1",
  metadata: { requestId: "r1" },
  signal,
});
```

`ResolveContextOptions` accepts `providers`, `messages`, optional session/run ids, metadata, abort signal, and optional middleware.

## Outputs / response / events

The helper returns `readonly ContextBlock[]` in provider order. If a middleware registry is supplied, the `context` hook can transform the final block array.

## Request/response example

```json
{
  "providers": ["project"],
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Explain" }] }]
}
```

```json
[
  { "title": "Project", "content": "Project context" }
]
```

## Implementation example

```ts
import { assembleProviderInput, createDefaultPromptBuilder, resolveContextProviders } from "prism";

const blocks = await resolveContextProviders({ providers, messages });

const request = await assembleProviderInput({
  model: { provider: "mock", model: "demo" },
  input: "Explain this file",
  contextProviders: providers,
  promptBuilder: createDefaultPromptBuilder(),
  tools: activeTools,
});
```

## Extension and configuration notes

Extensions can contribute context providers with `registerContextProvider()`, but those contributions stay inert until the host selects providers and passes them to `resolveContextProviders()` or `assembleProviderInput()`.

`context` middleware runs only when a middleware registry is supplied to the helper. Middleware transforms context data; it does not grant tool access.

## Security and performance notes

- Context providers run sequentially and deterministically in caller order.
- The helper performs no provider calls, tool execution, resource loading, package discovery, filesystem/network access, retries, timers, or watchers by itself.
- Context output is host/extension data. Do not include secrets unless the host explicitly accepts that prompt exposure.
- Active tools remain host-supplied; context and prompt middleware do not activate tools.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): default prompt builder and provider-input assembly helper.
- [Public contracts](public-contracts.md): `ContextProvider`, `ContextResolutionContext`, `ContextBlock`, `PromptBuilder`, and `PromptBuildRequest`.
- [Middleware hooks](middleware-hooks.md): `context` and `prompt_build` hooks.
- [Contribution registries](contribution-registries.md): inert context provider contributions.
- [Tools](tools.md): host-owned active tools and permissions.
