# Provider request policies

## What it does

Provider request policies are small host/package hooks that can adjust `ProviderRequest.options` before `AIProvider.generate()` runs.

Public helpers:

- `applyDefaultProviderRequestOptions(request, { sessionId, thinkingLevel })` is the kernel constructor. Fill-if-missing `sessionId` / `cacheKey`; default cache breakpoints + `cacheRetention: "short"` when `model.cache.kind` is `cache_control` or `explicitBreakpoints` is true; optional `thinkingLevel` patches via `applyThinkingLevelForModel` after those fills. Host values win. Agent sessions, observational-memory workers, and LLM compaction already call it.
- `ProviderRequirementError` (`ERR_PRISM_PROVIDER_REQUIREMENT`) is the fail-fast typed error adapters throw when a mandatory option is still missing (OpenCode Go `sessionId` → `x-opencode-session`). Thrown before fetch; messages contain no request bodies or secrets.
- `createProviderRequestPolicyChain(policies)` runs policies in order.
- `createSessionCachePolicy(options)` is a host overlay that sets legacy `cacheKey` / `cacheRetention` aliases from `sessionId`. Not required for request success.
- `mergeProviderRequestOptions(base, patch)` merges request options, including structured `cache` hints.

## When to use it

Use `createAgent({ thinkingLevel })` / `session.run(input, { thinkingLevel })` for session intent. Use `applyDefaultProviderRequestOptions` on custom `provider.generate` sites. Use provider request policies only as overlays (custom `cacheKey`, extra headers, `compat`/`extra`) — never to make a request valid.

Do not use request policies to resolve credentials, read env vars, perform OAuth refresh, fetch model lists, or override provider-owned auth/session/security headers. Session and cache keys are correlation ids, never secrets.

## Inputs / request

```ts
import type { ProviderRequestPolicy, ProviderRequestPolicyContext, ProviderRequestOptions } from "@arnilo/prism";
```

| API | Input | Purpose |
| --- | --- | --- |
| `applyDefaultProviderRequestOptions(request, ctx)` | `{ sessionId?, thinkingLevel? }` | Fill-if-missing `sessionId` / `cacheKey`; cache defaults from `model.cache`; thinking patch. |
| `ProviderRequirementError` | `message`, `{ requirement, providerId? }` | Typed missing-requirement error. |
| `ProviderRequestPolicy.apply(context)` | `{ sessionId?, request, options? }` | Returns a patched request or options. |
| `createProviderRequestPolicyChain(policies)` | ordered policies | Applies patches in order. |
| `createSessionCachePolicy({ retention?, cacheKey? })` | optional cache overlay | Sets legacy aliases after kernel defaults. |
| `mergeProviderRequestOptions(base, patch)` | two option bags | Shallow merges scalars and structurally merges `cache`. |

`mergeProviderRequestOptions()` behavior:

- Patch scalar fields win.
- `headers`, `compat`, and `extra` shallow-merge.
- `cache` shallow-merges; patch `mode`, `key`, and `retention` win.
- `cache.breakpoints` concatenate in base-then-patch order.
- Legacy-only `cacheKey` / `cacheRetention` merges remain unchanged and do not add a `cache` property.

## Outputs / response / events

A policy chain returns either a full `ProviderRequest` or `{ request, options }` style result, normalized by the chain before the next policy runs. The final request is what the agent/session runtime passes to the provider.

No agent events are emitted by the policy chain itself.

## Request/response example

```json
{
  "before": { "options": { "cacheRetention": "short" } },
  "patch": { "options": { "cache": { "key": "stable", "retention": "long" } } },
  "after": {
    "options": {
      "cacheRetention": "short",
      "cache": { "key": "stable", "retention": "long" }
    }
  }
}
```

## Implementation example

```ts
import {
  applyDefaultProviderRequestOptions,
  createProviderRequestPolicyChain,
  createSessionCachePolicy,
  mergeProviderRequestOptions,
  ProviderRequirementError,
  type ProviderRequestPolicy,
} from "@arnilo/prism";

const stamped = applyDefaultProviderRequestOptions(request, {
  sessionId: session.id,
  thinkingLevel: "low",
});
// stamped.options.sessionId === request.options?.sessionId ?? session.id
// cache_control models also get default cache.breakpoints unless the host set mode/off / retention/none / explicit breakpoints

const structuredCache: ProviderRequestPolicy = {
  name: "demo.structured-cache",
  apply({ request }) {
    return {
      ...request,
      options: mergeProviderRequestOptions(request.options, {
        cache: {
          mode: "on",
          key: request.options?.sessionId,
          retention: "long",
          breakpoints: [{ location: "system_prompt" }],
        },
      }),
    };
  },
};

const chain = createProviderRequestPolicyChain([
  createSessionCachePolicy({ retention: "short" }),
  structuredCache,
]);
```

## Extension and configuration notes

Provider packages can register request policies during `defineProviderPackage().setup(api)`. Hosts decide which overlay policies load and in which order. Prism has no hidden provider request policy registry. Kernel construction (`applyDefaultProviderRequestOptions`) already fills session/cache/thinking from `model.cache` and run intent — package-registered policies are never auto-activated and never required for success.

Policy output should stay generic: use `ProviderRequestOptions.cache`, `headers`, `compat`, and `extra` instead of provider-name branches in core.

## Security and performance notes

- Request policies must not store or log credentials.
- Caller headers are advisory; provider adapters must apply provider-owned auth/session/security headers last.
- Cache keys must never be credentials.
- Policy chains are O(number of policies) plus option merge cost.
- Policies should be pure and synchronous unless the host explicitly accepts async work.
- Optional `@arnilo/prism-core/governance/model-router` returns a `ProviderRequestPolicy` that strips `openRouterRouting` unless governance allows it — chain it with other policies.

## Related APIs

- [Model routing](model-routing.md): governance facade that emits a chainable OpenRouter routing gate policy.
- [Provider caching](provider-caching.md): structured cache hints and helpers.
- [Provider packages](provider-packages.md): registering policies from extension packages.
- [Provider layer](provider-layer.md): provider request flow and `AIProvider.generate()`.
- [Public contracts](public-contracts.md): `ProviderRequestPolicy`, `ProviderRequestOptions`, and cache types.
