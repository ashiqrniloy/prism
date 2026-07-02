# Provider request policies

## What it does

Provider request policies are small host/package hooks that can adjust `ProviderRequest.options` before `AIProvider.generate()` runs.

Public helpers:

- `createProviderRequestPolicyChain(policies)` runs policies in order.
- `createSessionCachePolicy(options)` sets legacy `cacheKey` / `cacheRetention` aliases from `sessionId`.
- `mergeProviderRequestOptions(base, patch)` merges request options, including structured `cache` hints.

## When to use it

Use provider request policies when an app or provider package needs to set generic per-request options such as cache hints, caller-owned headers, `compat`, or `extra` without changing every provider call site.

Do not use request policies to resolve credentials, read env vars, perform OAuth refresh, fetch model lists, or override provider-owned auth/session/security headers.

## Inputs / request

```ts
import type { ProviderRequestPolicy, ProviderRequestPolicyContext, ProviderRequestOptions } from "@arnilo/prism";
```

| API | Input | Purpose |
| --- | --- | --- |
| `ProviderRequestPolicy.apply(context)` | `{ sessionId?, request, options? }` | Returns a patched request or options. |
| `createProviderRequestPolicyChain(policies)` | ordered policies | Applies patches in order. |
| `createSessionCachePolicy({ retention?, cacheKey? })` | optional cache defaults | Sets legacy aliases. |
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
  createProviderRequestPolicyChain,
  createSessionCachePolicy,
  mergeProviderRequestOptions,
  type ProviderRequestPolicy,
} from "@arnilo/prism";

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

Provider packages can register request policies during `defineProviderPackage().setup(api)`. Hosts decide which packages/policies load and in which order. Prism has no hidden provider request policy registry and no automatic provider-specific cache behavior in core.

Policy output should stay generic: use `ProviderRequestOptions.cache`, `headers`, `compat`, and `extra` instead of provider-name branches in core.

## Security and performance notes

- Request policies must not store or log credentials.
- Caller headers are advisory; provider adapters must apply provider-owned auth/session/security headers last.
- Cache keys must never be credentials.
- Policy chains are O(number of policies) plus option merge cost.
- Policies should be pure and synchronous unless the host explicitly accepts async work.

## Related APIs

- [Provider caching](provider-caching.md): structured cache hints and helpers.
- [Provider packages](provider-packages.md): registering policies from extension packages.
- [Provider layer](provider-layer.md): provider request flow and `AIProvider.generate()`.
- [Public contracts](public-contracts.md): `ProviderRequestPolicy`, `ProviderRequestOptions`, and cache types.
