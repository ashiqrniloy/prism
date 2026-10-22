# Provider kit

## What it does

`@arnilo/prism/provider-kit` is the wire code that model providers share: bounded HTTP and SSE reading, the
routed-provider builder (`createRoutedProvider`), protocol codecs (`openai-chat`, `anthropic-messages`),
System One client helpers, JSON-schema and media helpers, package helpers (`defineProviderPackage`, `providerPackageInstance`),
and the provider conformance suite. It holds no vendor catalog, endpoint, or credential default: the protocol wire mappings
it carries are named for their protocol and are configured through route declarations and codec options.
A provider package imports it; the kernel's built-in `openai-compatible` provider imports it from `src/provider-kit/`.

Importing it does not load the agent runtime (no `createAgent`, no session).

## When to use it

- A native provider package builds its `ModelProvider` on `createRoutedProvider` (or `createOpenAICompatibleProvider`),
  the protocol codecs (`openAIChatBody`/`openAIChatEvents`, `anthropicMessagesBody`/`anthropicMessagesEvents`), or transport helpers.
- A native provider package wraps itself in `defineProviderPackage` and exports the factory split from
  `providerPackageInstance` instead of hand-copying the schema, credential source, and envelope.
- A package or host wraps an existing `ModelProvider` in a `definePackage` instance with `providerPackage`.
- A provider package test asserts the shared stream/secret/usage/auth contract with `providerConformance` or verifies
  offline wire fidelity with `replayFetch` and `assertRecordedStreamConforms`.

## Inputs / request

Provider kit functions consume normalized kernel `ProviderRequest` objects:

```ts
export interface ProviderRequest {
  readonly model: ModelSpec;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly limits?: ProviderLimits;
  readonly options?: ProviderRequestOptions;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}
```

A routed provider is configured with `createRoutedProvider(options)`:
- `id`: Provider ID string.
- `baseUrl`: Base URL string.
- `apiKey`: Direct secret string, `CredentialValueSource`, or request-time resolver.
- `routes`: Record of route definitions keyed by route name (`RoutedProviderRoute`). Each route declares `path`, `format` (`"openai-chat" | "anthropic-messages"`), `auth`, optional `codec` options, `affinity`, and optional `require`.
- `fetch`: Optional custom or replay `fetch` implementation.

## Outputs / response / events

A provider's `generate(request)` returns an `AsyncIterable<ProviderEvent>` yielding standard provider events:
- `content_delta`: Incremental text and thinking deltas (`TextContentDelta`, `ThinkingContentDelta`).
- `tool_call_delta` / `tool_call`: Streaming and complete tool call descriptions.
- `usage`: Normalized inclusive usage tokens (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`).
- `done`: Terminal event with `stopReason` taxonomy and optional final usage.
- `error`: Terminal event with sanitized error code and message.

`providerConformance` and `assertRecordedStreamConforms` verify that streams strictly produce terminal events without secret leaks or out-of-order events.

## Tool results on the wire

A `role: "tool"` message carries one `tool_result` block plus any image blocks. One projection, `serializeToolResultText(message)`, feeds every codec:

- text results reach the model as text — a joined `result` string is sent byte-for-byte, so quotes, tabs, and newlines are no longer JSON-escaped;
- a structured `ToolResult.value` is still `JSON.stringify`'d;
- an error is sent as its `message`, and the Anthropic Messages route also sets `is_error: true`;
- `EMPTY_TOOL_RESULT_TEXT` is sent unchanged.

Images follow the route. Anthropic Messages puts them in `tool_result.content` as `text` and `image` blocks (resolved through `resolveProviderMediaMessages`, so `tool_result` media needs no separate path). OpenAI Chat Completions accepts only text in a `tool` message, so `openAIChatBody` appends one `user` message — `Images returned by <tool> (<toolCallId>):` plus the images — after that round's contiguous `tool` replies. When the model declares no image input, both routes send `[image omitted: the model does not accept images]` as text instead, and `assertMessagesSupportModelCapabilities` no longer fails for an image inside a tool message (images in any other message still fail closed).

## Request/response example

```ts
const request: ProviderRequest = {
  model: { provider: "acme", model: "acme-fast" },
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
};
```

When sent to an `openai-chat` route, `openAIChatBody` serializes the JSON payload:
```json
{
  "model": "acme-fast",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

And `openAIChatEvents` normalizes incoming SSE frames into provider events:
```jsonc
data: {"choices":[{"delta":{"content":"Hi there"}}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}
data: [DONE]
```

## Implementation example

`examples/custom-provider.ts` provides a runnable, offline example of a multi-route custom provider built using `createRoutedProvider` and `replayFetch`.

## Writing a provider package

Writing a provider package follows a clear 5-step progression:
1. **Package shell**: Define package configuration and schema using `defineProviderPackage`, and split non-JSON factory options (`id`, `fetch`) from user config using `providerPackageInstance`.
2. **Routes table**: Declare provider routes using `createRoutedProvider`, configuring endpoint paths, auth headers, and protocol codecs.
3. **Codec options**: Configure serializer and parser behaviors (reasoning replay modes, image capability gating, completion token field names, thinking level resolvers).
4. **Catalog**: Provide static models or implement dynamic discovery in `models()`.
5. **Conformance & fixtures**: Assert stream and safety contracts with `providerConformance`, and verify wire fidelity using recorded recordings with `replayFetch` and `assertRecordedStreamConforms`.

### 1. Package shell

A provider package takes validated JSON configuration (`apiKey` secret ref, optional `baseUrl`, optional `models` catalog) and factory options (`id`, custom `fetch`):

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
```

`defineProviderPackage` binds the kernel version and required API level, defaulting `capabilities: ["credentials"]`. `providerPackageInstance` extracts factory-only options like `fetch` and `id` so they never appear in serialized JSON config.

### 2. Routes table and `createRoutedProvider`

`createRoutedProvider` handles multi-route model providers without vendor-specific branching:
- Dispatches each request to a configured route by reading `request.model.compat?.route` (or defaulting to the first route in `routes`). Unknown routes fail closed with `ProviderRequirementError` (`requirement: "route"`).
- Enforces pre-fetch requirements before calling `fetch` (e.g. `require.sessionId: true` fails closed with `ProviderRequirementError` (`requirement: "sessionId"`)).
- Resolves credentials exactly once per request via `resolveApiKey` / `apiKey` (either a direct string, `CredentialValueSource`, or request resolver).
- Enforces header precedence: provider-owned auth and `content-type` headers are applied after caller headers, preventing caller header hijacking (`assertProviderOwnedHeadersWin`).
- Enforces bounded error extraction with secret redaction (`assertNoSecretLeak`).

```ts
import type { CredentialValueSource, ModelProvider } from "@arnilo/prism";
import { createRoutedProvider } from "@arnilo/prism/provider-kit";

export function createAcmeProvider(options: { apiKey: CredentialValueSource; baseUrl?: string; fetch?: typeof fetch }): ModelProvider {
  return createRoutedProvider({
    id: "acme",
    baseUrl: options.baseUrl ?? "https://api.acme.example/v1",
    apiKey: options.apiKey,
    fetch: options.fetch,
    routes: {
      openai: {
        format: "openai-chat",
        path: "/chat/completions",
        auth: "bearer",
        codec: {
          reasoningReplay: "reasoning_content",
          imageInput: "capability-gated",
          maxTokensField: "max_tokens",
        },
      },
      anthropic: {
        format: "anthropic-messages",
        path: "/messages",
        auth: "x-api-key+bearer",
      },
    },
  });
}
```

### 3. Codec options

Each route binds a wire protocol codec:
- **OpenAI Chat (`openai-chat`)**:
  - `reasoningReplay`: Controls how previous thinking content is replayed to the model:
    - `"reasoning_content"`: emitted as OpenAI-compatible `reasoning_content` field on assistant messages.
    - `"fold"`: folded into `content` as `<thought>...</thought>`.
    - `"drop"`: omitted from the message payload.
  - `imageInput`:
    - `"capability-gated"` (default): throws `ProviderRequirementError` (`requirement: "images"`) if images are sent to a model without `image_input` capability.
    - `"always"`: passes image content parts through regardless of declared model capabilities.
  - `maxTokensField`:
    - `"max_tokens"` (default): uses standard OpenAI `max_tokens`.
    - `"max_completion_tokens"`: uses `max_completion_tokens` (for reasoning models such as o1/o3).
  - Thinking and compat resolvers:
    - `resolvePreserveThinking(req)` / `preserveThinking`
    - `resolveReasoningEffort(req, levels?)` / `reasoningEffort`: snaps reasoning effort to declared model levels.
    - `resolveThinkingObject(req)` / `thinkingObject`: transforms thinking into `{ type: "enabled", budget_tokens }`.
    - `resolveReasoningObject(req)` / `reasoningObject`: transforms reasoning into `{ effort }`.
    - `stripOwnedCompat(compat, extraKeys)`: cleans vendor-owned compat keys so they are not leaked to upstream providers.
- **Anthropic Messages (`anthropic-messages`)**:
  - `anthropicMessagesBody(request, hooks)`: builds Anthropic `/v1/messages` JSON payload with effort, thinking, and message mapping.
  - `anthropicMessagesEvents(body, options)`: parses SSE events into `ProviderEvent` stream, normalizing usage via `normalizeUsage` and mapping stop reasons.

### 4. Catalog

The package exposes available models either via static configured models (`prism.config.models`) or by querying the provider's `/models` endpoint:

```ts
prism.providers.register({
  ...provider,
  async models() {
    return prism.config.models ?? listAcmeModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
  },
});
```

### 5. Conformance and recorded fixtures

A provider package asserts contract compliance using `providerConformance` and verifies wire behavior against offline fixtures using `replayFetch` and `assertRecordedStreamConforms`:

```ts
import { providerConformance, replayFetch, assertRecordedStreamConforms } from "@arnilo/prism/provider-kit";

// Contract validation: secret redaction, header priority, usage accounting, stream order
await providerConformance(() => createAcmeProvider({ apiKey: async () => "sk-test", fetch: fakeFetch }), {
  request,
  secrets: ["sk-test"],
  headers: {
    owned: { authorization: "Bearer sk-test" },
    caller: { authorization: "x-spoof", "x-trace": "1" },
    captured: () => lastHeaders,
  },
});

// Offline recorded replay fixture:
const recording = JSON.parse(readFileSync("path/to/fixture.json", "utf8"));
const provider = createAcmeProvider({
  apiKey: async () => "dummy-key",
  fetch: replayFetch(recording),
});
await assertRecordedStreamConforms({
  provider,
  request,
  recording,
  expect: { text: "Hello from recorded model" },
});
```

### Complete package implementation

`examples/custom-provider.ts` provides a runnable, offline example of a multi-route custom provider using `createRoutedProvider` and `replayFetch`.
The complete native package brings these pieces together:

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
      const provider = createAcmeProvider({ apiKey, baseUrl, fetch: options.fetch });
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

### 4. System One decision providers (`systemOneProviderPackage`)

Prism decision models (such as `@arnilo/prism-provider-typesafe` and `@arnilo/prism-provider-laya`) follow a single standardized shape over `provider-kit`:
- **`systemOneProviderPackage(spec)`**: Generates the package definition and instance factory from a uniform specification (`name`, `providerId`, `label`, `defaultBaseUrl`, `defaultKeyRef`, `keyRequired`, `models`, and optional `createProvider`).
- **`createSystemOneDecisionProvider(options)`**: Implements the `ModelProvider` contract over `POST /v1/systemone`. Validates fail-closed that requests provide `options.structuredOutput` with a JSON schema, forbids `tools`, and checks `boolean_threshold` in `request.options.compat`.
- **Plaintext endpoint warning (`warnIfPlaintextRemote`)**: Warns if a non-loopback `baseUrl` uses unencrypted `http://`. Prints the origin only (no path, query, or credentials) so userinfo is never leaked. Loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) connect cleanly without warning.
- **Key-required vs key-optional**: Cloud hosted providers (e.g. TypeSafe Jev) declare `keyRequired: true` (missing key emits `status.note("warn", ...)`); local/self-hosted providers (e.g. Laya) declare `keyRequired: false` (missing key notes nothing and outgoing requests omit `Authorization` headers).
- **`systemOneConformance(options)`**: Comprehensive conformance test covering tool rejections, schema rendering, 401/422 status mapping, malformed success responses, single credential resolution per request, secret redaction, and wire fixture replay.

## Shared surface inventory

| Group | Exports |
| --- | --- |
| Transport | `readSseEvents`, `readSseData`, `readBoundedResponseText`, `readBoundedResponseJson`, `httpStatusError`, `ProviderTransportError`, `classifyProviderFailure`, `parseRetryAfterMs`, `parseJsonObjectArguments` |
| Routed provider | `createRoutedProvider`, `assertNotAborted`, `resolveProviderApiKey`, `createOpenAICompatibleProvider` |
| Codecs | `openAIChatBody`, `buildOpenAIChatBody`, `openAIChatEvents`, `serializeOpenAIChatMessage`, `serializeOpenAITool`, `mapOpenAIChatUsage`, `anthropicMessagesBody`, `anthropicMessagesEvents` |
| Wire replay | `replayFetch`, `assertRecordedStreamConforms` |
| System One | `createSystemOneDecisionProvider`, `systemOneProviderPackage`, `systemOneConformance`, `warnIfPlaintextRemote`, `askSystemOneDecisions`, `createSystemOneClient`, System One schema and options |
| Usage | `normalizeUsage`, `mapOpenAIChatUsage`, `mapSystemOneUsage` |
| Retry | `providerHttpError`, `parseErrorBody`, `readRetryAfterMs`, `RETRYABLE_STATUSES` |
| Thinking | `normalizeThinkingLevel`, `snapThinkingLevel`, `applyThinkingLevel`, `applyThinkingLevelForModel`, `THINKING_LEVELS`, `resolvePreserveThinking`, `preserveThinking`, `resolveReasoningEffort`, `reasoningEffort`, `resolveThinkingObject`, `thinkingObject`, `resolveReasoningObject`, `reasoningObject`, `stripOwnedCompat`, `DEFAULT_OWNED_COMPAT_KEYS` |
| Cache | `anthropicCacheEnabled`, `applyCacheControl`, `resolvePromptCachePlan`, `sanitizeCacheKey`, `systemCacheControlField`, `cacheUsageReport`, `cacheHitRate`, `cacheSavings` |
| Request policy | `applyDefaultProviderRequestOptions`, `mergeProviderRequestOptions`, `ProviderRequirementError` |
| Structured output | `validateStructuredOutputOptions`, `assertStructuredOutputRequestSupported`, `StructuredOutputError` |
| Schema, media | `canonicalizeJsonSchema`, `resolveProviderMediaMessages`, `assertProviderMediaCapability`, upload-cache helpers |
| Package | `providerPackage(name, providers, description?)` |
| Provider package | `defineProviderPackage`, `providerPackageInstance`, `secretRefProperty`, `baseUrlProperty`, `modelsProperty`, `modelEntrySchema`, `refSource`, `optionalRefSource`, `ProviderPackageDefinitionSpec` |
| Conformance | `systemOneConformance`, `providerConformance`, `assertProviderStreamConforms`, `assertAbortIsObserved`, `assertNoSecretLeak`, `assertProviderOwnedHeadersWin`, `assertUsageAccounting`, `assertModelsListValid`, `assertAuthDescriptorsWellFormed`, and the per-capability `run*Conformance` helpers |

## Extension and configuration notes

- Credentials stay factory options or `ModelSpec.credential` refs, never package config. A provider that needs a
  key takes a `resolveApiKey(request)` callback and lets the caller resolve the ref through the `credentials`
  slot; a provider *package* takes a `x-prism-secret` ref from config and wraps it with `refSource`.
- `secretRefProperty` defaults its description to the canonical ref sentence; a vendor-specific field (an
  optional key, a second key, a session token) passes its own.
- `defineProviderPackage` fixes `version` to the kernel version and declares `requires.api` (the current
  kernel API level), so every provider package stays in lockstep without a hand-copied literal.
- Protocol wire code shared by two or more providers lives here, named for its protocol (`openai-chat`, `anthropic-messages`,
  `systemone`) and driven by per-provider hooks and route definitions; a provider's own catalog, endpoint,
  credential default, and product-specific factory stay in its package. A test keeps provider-kit free of vendor
  ids in code.
- `providerConformance`'s factory is called once per check, so a provider must be cheap to construct.

## Security and performance notes

- The secret-leak and header-ownership checks cannot be turned off, and `secrets` must name at least one value.
- Byte caps in the transport (`maxEventBytes`, `maxBufferBytes`, response body caps) stay on by default.
- A conformance run is network-free: the provider's `fetch` is the test's fake.
- `strictCompletion` is `true` by default: a stream without `[DONE]` and a `finish_reason` yields an `error`, so
  truncated answers fail closed.

## Anthropic Messages codec

The Anthropic Messages codec in `@arnilo/prism/provider-kit` (`src/provider-kit/codecs/anthropic-messages.ts`)
handles request serialization and SSE event parsing for providers implementing the Anthropic Messages protocol
(such as `opencode-go` and `hyper`):

- `anthropicMessagesBody(request, hooks)`: builds the JSON payload for Anthropic `/v1/messages` (or vendor routes).
  - Handles message and content block transformation, tool definitions, and system prompts.
  - Injects `output_config.effort` and generation-aware `thinking` options.
  - Supports thinking replay: signed thinking blocks replay with their signature, redacted thinking blocks replay
    verbatim as `type: "redacted_thinking"`, and unsigned thinking replays as text when `preserveThinking: true`.
- `anthropicMessagesEvents(body, options)`: parses the Anthropic SSE event stream into the shared `ProviderEvent` stream.
  - Handles `message_start`, `content_block_start`, `content_block_delta` (`text_delta`, `input_json_delta`, `thinking_delta`, `signature_delta`), `content_block_stop`, `message_delta`, and `message_stop`.
  - Merges wire usage across `message_start` and `message_delta` field-by-field and normalizes inclusive usage via `normalizeUsage`.
  - Maps `message_delta.stop_reason` through `mapProviderStopReason` and yields `providerUsage` with stop reason.
  - Ignores `event: ping` keep-alive frames.
  - Captures `signature_delta` and associates it with thinking content blocks.
  - Parses `redacted_thinking` content blocks into `ThinkingContent` with `redacted: true` and `data`.
  - Maps upstream stream `error` events to `providerError` with vendor error codes (`overloaded_error` and `api_error` marked transient, others permanent).
  - Terminal stream errors are emitted on malformed SSE frames or JSON parse failures.

## Prompt cache planning and affinity routing

`@arnilo/prism/provider-kit` provides unified prompt cache planning (`resolvePromptCachePlan`) and empty-block safe stamping (`applyCacheControl`):

- `resolvePromptCachePlan(messages, breakpoints, options)`: resolves a deterministic cache plan:
  - Supports breakpoint locations: `system_prompt`, `last_message` (newest message `messages.length - 1`), `last_stable_message` (`messages.length - 2` or `messages.length - 1`), `first_user_message`, and `tools`.
  - When `tools` is present in breakpoints, `markTools: true` marks the **last tool definition** on codecs supporting definition-level caching (e.g. Anthropic `tools` array). `resolveBreakpoint` returns `-1` for `tools`, bypassing message indices.
  - De-duplicates target message indices before enforcing `maxBreakpoints` (e.g., if multiple breakpoints point to the same message index, they consume only 1 slot towards `maxBreakpoints`).
  - When tool definition caching is enabled (`hasTools: true`), message breakpoints are clamped to `maxBreakpoints - 1` (defaulting to 3 message breakpoints when max is 4).
- Empty-block safety: `applyCacheControl` inspects blocks in reverse order (looking back up to 20 blocks) to place markers strictly on non-empty content blocks, skipping empty strings, whitespace-only text, and empty tool results.
- `affinity` on routed providers and codecs:
  - Both `createRoutedProvider` and individual codecs (`openai-chat`, `anthropic-messages`) accept route affinity hooks: `routes[x].affinity?: (request: ProviderRequest) => Record<string, string>`.
  - Route affinity headers (e.g., `sanitizeCacheKey(modelSpec.options?.promptCache?.key)`) are merged into outgoing request headers after caller headers and before provider-owned auth/content-type headers, allowing sticky routing to the same backend node.

## Wire replay and stream conformance

`@arnilo/prism/provider-kit` exports offline replay fixtures and stream conformance verification:

- `replayFetch(exchanges)`: returns a `fetch` implementation that serves recorded exchanges in strict order. It asserts the request path matches `exchange.path` (and optional `method`), failing fast on unexpected paths or if requests exceed the recorded exchange count. Responses preserve the status, content-type header, and raw response body.
- `assertRecordedStreamConforms({ provider, request, recording, expect })`: runs `assertProviderStreamConforms` on the provider stream, verifying terminal event ordering (`done` or `error`), expected text content, and usage metrics against the recorded exchange. For HTTP status >= 400 recordings, it verifies the provider stream terminates with an `error` event.
- `providerConformance(factory, options?)`: runs comprehensive provider conformance checks. When `recordings` (a directory path, string path, or file/directory `URL`) is supplied, it discovers recorded scenarios (such as `text`, `tool-loop`, `thinking`, `cache`, `error`), reconstructs realistic multi-turn requests from recorded payloads, and replays each scenario through `replayFetch` with signature tracking:
  - Verifies event ordering and terminal `done` or `error` events.
  - Verifies tool call delta reconstruction and complete argument parsing.
  - Verifies usage token invariants: `cacheReadTokens + cacheWriteTokens <= inputTokens`.
  - Verifies thinking signature round-trip, throwing if thinking content is replayed onto the wire without a signature (`conformance_fails_on_unsigned_thinking_replay`).
  - Verifies abort pre-check (`assertAbortIsObserved`), header ownership (`assertProviderOwnedHeadersWin`), and secret leak scanning (`assertNoSecretLeak`).
  - Returns `ProviderConformanceResult` containing `{ ok: boolean, scenarios: ProviderConformanceScenarioResult[] }`.

```ts
import { providerConformance } from "@arnilo/prism/provider-kit";
import { createHyperProvider, hyperModels } from "@arnilo/prism-provider-hyper";

const result = await providerConformance(
  () => createHyperProvider({ apiKey: "test-key" }),
  {
    recordings: new URL("./wire/anthropic", import.meta.url),
    models: hyperModels,
  },
);
```

## Scaffolding a new provider package

Hosts and package authors can scaffold a new standalone native provider package using:

```bash
prism new package --provider <name>
```

This generates a complete modern 0.13.0 package skeleton:
- `createRoutedProvider` with routes table and fail-closed resolution.
- One-model static catalog in `models()`.
- Package shell using `defineProviderPackage` with `secretRefProperty` and `providerPackageInstance`.
- `package.test.ts` running `providerConformance({ recordings })` offline.
- `wire/` directory with `README.md` recording instructions.
- `live.test.ts` integration skeleton skipping without live credentials.

## Shipping a provider: what the repo requires

Every provider package in `packages/providers/<vendor>` is enforced by the supported-provider packaging gate (`src/__tests__/packaging.test.ts`). No untested or unverified provider package can ship. To pass the packaging gate, a provider package must include:

1. **Wire recordings (`src/__tests__/wire/`)**: A non-empty directory containing recorded HTTP and SSE exchanges for offline replay. Routed providers record `text`, `tool-loop`, `thinking`, `cache`, `structured-output`, and error scenarios per route; System One decision providers record decision and error exchanges.
2. **Offline conformance test (`src/__tests__/*.test.ts`)**: A package test invoking `providerConformance({ recordings })` (for routed chat and messages providers) or `systemOneConformance` (for decision providers). Conformance runs entirely offline over `replayFetch` with zero network access and verifies event ordering, header precedence, usage invariants, thinking signature verification, and secret non-leakage.
3. **Live scenario suite (`src/__tests__/live.test.ts`)**: An integration test running shared tier-1 scenarios via `runProviderLiveScenarios` or `runSystemOneLiveScenarios` from `@arnilo/prism/testing`. The test must skip cleanly when credentials or opt-in flags are absent.
4. **Active matrix row (`scripts/live-matrix.json`)**: An entry under `suites` with `id: "providers/<vendor>"`, `status: "active"`, and declared credentials (`requires`), model overrides, and expected request bounds.

## Related APIs

- `docs/models.md`: `ModelRef`/`ModelSpec`, the provider registry, and the built-in provider.
- `@arnilo/prism/testing`: `mockProvider` and the provider event helpers.
- `docs/packages.md`: `definePackage`, `providerPackage`, and the `providers` registrar.
- `packages/providers/<vendor>/src/index.ts`: the 4 provider packages built on the surface above.

## Removed

- The historical subpaths `@arnilo/prism/providers/{openai-compatible,transport,openai,schema,media}` and `@arnilo/prism/testing/provider-conformance` are gone.
- OpenAI Responses: `createOpenAIResponsesProvider`, `resolveOpenAIReasoning`, `applyOpenAIResponsesStructuredOutput`, `serializeOpenAIResponsesStructuredOutput`, and Responses media helpers `openAIAudioFormat`, `serializeOpenAIResponsesInputFile`, `serializeOpenAIResponsesInputAudio`.
- OpenAI uploads, prompt cache, and thinking: `createOpenAIFileUploadManager`, `promptCacheKey`, `promptCacheRetention`, `promptCacheOptions`, `applyPromptCacheBreakpoints`, `openAIThinkingLevels`, `openAIDefaultEffort`, `openAICompatThinkingExtra`, `declaredThinkingLevelsFor`.
- OAuth and device-code: `oauthCredentialsToSecret`, `secretToOAuthCredentials`, `refreshOAuthCredential`, `revokeOAuthCredential`, `pollDeviceCodeToken`, `redactOAuthError`, `abortableSleep`, `throwIfAborted` (from provider-kit).
- Image generation and model discovery: `ImageGenerationError`, `assertImageGenerationSupported`, `modelSupportsImageGeneration`, `runImageGenerationConformance`, `ModelDiscoveryError`, `createOpenAiCompatibleModelDiscovery`, `createCachedModelDiscovery`, `createFakeModelDiscovery`, `runModelDiscoveryConformance`, `assertModelsListValid`, `failDiscoveryOnStatus`, `mergeModelCatalog`, `resolveDiscoveryBearerToken`.
