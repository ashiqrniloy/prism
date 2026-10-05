# Provider kit

## What it does

`@arnilo/prism/provider-kit` is the wire code that model providers share: bounded HTTP and SSE reading, the
OpenAI Chat Completions mapping, JSON-schema and media helpers, the OAuth device-code, refresh and revoke
helpers, a package helper, and the provider conformance suite. It holds no vendor catalog, endpoint, or
credential default: the protocol wire mappings it does carry (Anthropic Messages, OpenAI Responses, System One,
OpenAI-compatible) are named for their protocol and are injected with per-provider behavior. A provider package
imports it; the kernel's built-in `openai-compatible` provider imports it from `src/provider-kit/`.

Importing it does not load the agent runtime (no `createAgent`, no session).

## When to use it

- A native provider package builds its `ModelProvider` on `createOpenAICompatibleProvider`, the transport
  helpers, or a vendor-specific wire helper that other vendors also need.
- A native provider package wraps itself in `defineProviderPackage` and exports the factory split from
  `providerPackageInstance` instead of hand-copying the schema, credential source, and envelope.
- A package or host wraps an existing `ModelProvider` in a `definePackage` instance with `providerPackage`.
- A provider package test asserts the shared stream/secret/usage/auth contract with `providerConformance`.

## Inputs / request

```ts
createOpenAICompatibleProvider({
  id: "acme",
  baseUrl: "https://api.acme.test/v1",
  resolveApiKey: (request) => credentials.resolve(request.model.credential!), // wins over apiKey
  fetch,                                                                     // test seam
  authStyle: "bearer",                                                       // | "api-key" | "none"
  buildBodyExtra: (request) => ({ /* provider-specific body fields */ }),
  transformBody: (body) => body,
  strictCompletion: true,                                                    // fail-closed by default
});
```

`apiKey` may be a value, a function, or a legacy resolver; `resolveApiKey(request)` wins and is called on every
request. The kernel's built-in provider uses it to read the credential from the request's `ModelSpec`.

```ts
providerConformance(() => createMyProvider({ fetch: fakeFetch }), {
  request,                        // a request the provider can serve
  secrets: ["sk-test"],           // required, non-empty
  headers: { owned: { authorization: "Bearer sk-test" }, caller: { authorization: "x", "x-trace": "1" }, captured: () => lastHeaders },
  toolCalls: true,                // optional
  expect: { usage: true },        // optional
});
```

## Outputs / response / events

- `createOpenAICompatibleProvider` returns a `ModelProvider` whose `generate` yields the shared `ProviderEvent`
  stream (`content_delta`, `tool_call_delta`, `tool_call`, `usage`, `error`, `done`).
- `openAIChatEvents(body, options)` maps an OpenAI Chat Completions SSE body to that same stream and is exported
  for providers with their own transport.
- `providerPackage(name, providers, description?)` returns a `PackageInstance` that registers each provider in
  order; the loader gives it the `providers` registrar and no implicit capabilities.
- `defineProviderPackage({ name, description, config, capabilities?, setup })` returns a `PackageDefinition`
  with the kernel version, the `prism` requirement, and `capabilities: ["credentials"]` (pass `[]` for a
  package that resolves none) already set; the vendor supplies its config schema and `setup` body.
- `providerPackageInstance(definition, definitionFor, factoryKeys, options)` is the named factory: it moves
  `factoryKeys` (non-JSON options such as `id`, `fetch`, a host model) out of the validated config, and picks
  `definitionFor` only when at least one factory option is set. An explicitly `undefined` factory option
  counts as unset.
- `secretRefProperty(ref?, description?)`, `baseUrlProperty(description?)`, and `modelsProperty(description?)`
  build the three config properties every provider package repeats; `modelEntrySchema` is the shared
  `ModelConfig` subset `modelsProperty` embeds.
- `refSource(resolve, ref)` and `optionalRefSource(resolve, ref)` are `CredentialValueSource`s that resolve
  `ref` through the credentials slot per call; the first throws `CredentialUnavailableError` when the ref
  resolves to nothing or to an empty string, the second yields `undefined`.
- `providerConformance` and the per-capability `run*Conformance` helpers throw on a violation and return
  `undefined` otherwise.

| Group | Exports |
| --- | --- |
| Transport | `readSseEvents`, `readSseData`, `readBoundedResponseText`, `readBoundedResponseJson`, `httpStatusError`, `ProviderTransportError`, `classifyProviderFailure`, `parseRetryAfterMs`, `parseJsonObjectArguments` |
| OpenAI-compatible | `createOpenAICompatibleProvider`, `openAIChatEvents`, `buildOpenAIChatBody`, `serializeOpenAIChatMessage`, `serializeOpenAITool`, `mapOpenAIChatUsage`, structured-output helpers |
| Wire mappings | `anthropicMessagesBody`/`anthropicMessagesEvents` (Anthropic Messages), `createOpenAIResponsesProvider`/`resolveOpenAIReasoning`/`openAIThinkingLevels` (OpenAI Responses), `openAICompatThinkingExtra`/`declaredThinkingLevelsFor` (gateway `reasoning_effort`), `askSystemOneDecisions` and the System One client/schema (plan 152 Task 2) |
| Retry | `providerHttpError`, `parseErrorBody`, `readRetryAfterMs`, `RETRYABLE_STATUSES` |
| Model discovery | `createOpenAiCompatibleModelDiscovery`, `createCachedModelDiscovery`, `mergeModelCatalog`, `createFakeModelDiscovery`, `runModelDiscoveryConformance` |
| Schema, media | `canonicalizeJsonSchema`, `resolveProviderMediaMessages`, `assertProviderMediaCapability`, upload-cache helpers |
| OAuth | `pollDeviceCodeToken`, `refreshOAuthCredential`, `revokeOAuthCredential`, `redactOAuthError` |
| Package | `providerPackage(name, providers, description?)` |
| Provider package | `defineProviderPackage`, `providerPackageInstance`, `secretRefProperty`, `baseUrlProperty`, `modelsProperty`, `modelEntrySchema`, `refSource`, `optionalRefSource`, `ProviderPackageDefinitionSpec` |
| Conformance | `providerConformance`, `assertProviderStreamConforms`, `assertAbortIsObserved`, `assertNoSecretLeak`, `assertProviderOwnedHeadersWin`, `assertUsageAccounting`, `assertModelsListValid`, `assertAuthDescriptorsWellFormed`, and the per-capability `run*Conformance` helpers |

## Request/response example

```jsonc
// the SSE body openAIChatEvents consumes
data: {"choices":[{"delta":{"content":"Hi"}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"lookup","arguments":"{\"q\":"}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"x\"}"}}]}}]}
data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}
data: [DONE]
```

## Implementation example

The kernel's built-in provider is a thin `createOpenAICompatibleProvider` that reads `baseUrl` and `credential`
from each request; `examples/openai-compatible.ts` drives it against a loopback endpoint and asserts the bearer
token arrived:

```ts
const inner = createOpenAICompatibleProvider({
  id: "openai-compatible",
  baseUrl: "",
  chatCompletionsUrl: (request) => `${trimTrailingSlashes((request.model as ModelSpec).baseUrl as string)}/chat/completions`,
  async resolveApiKey(request) {
    const ref = (request.model as ModelSpec).credential;
    if (ref === undefined) return undefined;
    const credential = await resolveCredential(ref);
    if (!credential?.value) throw new CredentialUnavailableError(ref);
    return credential.value;
  },
});
```

A provider package exports the same factory wrapped in a package. `examples/side-call.ts` registers two such
packages through `mockProvider` (which uses `providerPackage` internally) and reaches one of them with
`PackageAPI.models.client`:

```ts
mockProvider([[providerTextDelta("side answer"), providerDone()]], { id: "side", onRequest: () => void (sideCalls += 1) });
```

```ts
export default () => providerPackage("acme-models", [createAcmeProvider({ fetch })]);
```

A native provider package is the same shape plus validated config. The shared surface is what keeps the 21
`@arnilo/prism-provider-<vendor>` packages to their vendor-specific parts:

```ts
import type { JsonSchema, ModelConfig, PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";

export const ACME_DEFAULT_API_KEY_REF = "env:ACME_API_KEY";

export interface AcmeProviderConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
}

export interface AcmeProviderPackageOptions {
  readonly id?: string;
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(ACME_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: AcmeProviderPackageOptions) {
  return defineProviderPackage<AcmeProviderConfig>({
    name: "@arnilo/prism-provider-acme",
    description: "Acme provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "acme";
      const ref = prism.config.apiKey ?? ACME_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `acme: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createAcmeProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          return configured ?? listAcmeModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

export default definition;

export function acme(options: AcmeProviderPackageOptions & AcmeProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}
```

## Extension and configuration notes

- Credentials stay factory options or `ModelSpec.credential` refs, never package config. A provider that needs a
  key takes a `resolveApiKey(request)` callback and lets the caller resolve the ref through the `credentials`
  slot; a provider *package* takes a `x-prism-secret` ref from config and wraps it with `refSource`.
- `secretRefProperty` defaults its description to the canonical ref sentence; a vendor-specific field (an
  optional key, a second key, a session token) passes its own.
- `defineProviderPackage` fixes `version` and `requires.prism` to the kernel version, so every provider package
  stays in lockstep without a hand-copied literal.
- Protocol wire code shared by two or more providers lives here, named for its protocol (`anthropic-messages`,
  `openai-responses`, `systemone`) and driven by per-provider hooks; a provider's own catalog, endpoint,
  credential default, and product-specific factory stay in its package. A test keeps provider-kit free of vendor
  ids in code.
- `providerConformance`'s factory is called once per check, so a provider must be cheap to construct.

## Security and performance notes

- The secret-leak and header-ownership checks cannot be turned off, and `secrets` must name at least one value.
- Byte caps in the transport (`maxEventBytes`, `maxBufferBytes`, response body caps) stay on by default.
- A conformance run is network-free: the provider's `fetch` is the test's fake.
- `strictCompletion` is `true` by default: a stream without `[DONE]` and a `finish_reason` yields an `error`, so
  partial output is never marked `done`.

## Related APIs

- `docs/next/models.md`: `ModelRef`/`ModelSpec`, the provider registry, and the built-in provider.
- `@arnilo/prism/testing`: `mockProvider` and the provider event helpers.
- `docs/next/packages.md`: `definePackage`, `providerPackage`, and the `providers` registrar.
- `packages/providers/<vendor>/src/index.ts`: the 21 provider packages built on the surface above.

## Removed

The subpaths `@arnilo/prism/providers/{openai-compatible,transport,openai,schema,media}` and
`@arnilo/prism/testing/provider-conformance` are gone. The root no longer exports `pollDeviceCodeToken`,
`abortableSleep`, `throwIfAborted`, `redactOAuthError`, `canonicalizeJsonSchema`, `refreshOAuthCredential`
or `revokeOAuthCredential`; import them from `@arnilo/prism/provider-kit`.
