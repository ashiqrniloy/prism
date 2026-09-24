# TypeSafe Jev provider package

## What it does

`@arnilo/prism-providers/typesafe` registers the TypeSafe Jev decision model. Jev does not generate free text, stream, or call tools. A request is valid only with `options.structuredOutput`: the JSON schema compiles to System One questions, the messages become the state, and one `POST /v1/systemone` round trip returns typed answers rendered as schema-valid JSON.

The package registers provider `typesafe`, models `jev-latest` and `jev-preview`, and an `api_key` auth method through `createExtensionKernel().load([...])`. Versioned pins (`jev-1.13.0`) go through `defineTypeSafeModel`.

## When to use it

Use it when a host wants a hosted yes/no, pick-one, or rubric decision and already has a JSON object schema. Do not use it as a general chat model, a tool-calling agent, or a streaming text model.

## Inputs / request

```ts
import {
  createTypeSafeProvider,
  createTypeSafeProviderPackage,
  defineTypeSafeModel,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_BASE_URL,
  typeSafeModels,
} from "@arnilo/prism-providers/typesafe";
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Bearer token. Hosts wire `TYPESAFE_API_KEY` through the credential seam. The library does not read `process.env`. |
| `fetch` | `typeof fetch` | Optional fetch for tests and hosts. |
| `baseUrl` | `string` | Overrides `https://api.typesafe.ai`. Trailing slashes are trimmed. `/v1/systemone` is appended per request. |
| `id` | `string` | Overrides the provider id (default `typesafe`). |
| `models` | `readonly ModelConfig[]` | Overrides `typeSafeModels`. |
| `maxRetries` | `number` | Retries after the first attempt. Default 2. Forwarded to the shared client. |

`generate()` accepts a normal `ProviderRequest` with these constraints:

| Field | Requirement |
| --- | --- |
| `options.structuredOutput` | Required. `{ name, schema }`. Missing schema fails before any fetch. |
| `tools` | Rejected. Decision model, no tool support. Fails before any fetch. |
| `options.compat.boolean_threshold` | Optional number in `0..1`. Default `0.5`. Out of range fails before any fetch. A boolean is true only when the noul probability is strictly greater than the threshold, so `0.5` renders `false` at the default. |
| `messages` | State only. A single user text message is sent as a string; otherwise the client sends `[{ role, text }]` and drops non-text parts. Do not write the question into the state — the model judges that text instead of answering it. |
| `model.model` | Sent verbatim. The responding version in the API body is not rewritten into the output. |
| `signal` | A signal already aborted throws before fetch. Abort during the round trip rejects the request. |

Schema mapping (unsupported shapes throw before any network call and name the field path):

| JSON Schema | Question |
| --- | --- |
| `boolean` | `noul`. Instructions come from `description`, then `title`, then the field path. |
| string `enum` of 2–255 values | `choice`. Criteria are the option labels unless `x-systemone.options` (or the `x-typesafe` alias) supplies descriptions. |
| integer `enum` equal to `0..N-1` with 2–10 described levels | `score`. Levels come from `x-systemone.levels` (alias `x-typesafe`), aligned to the declared enum order and sent in numeric order. An undescribed whole-number enum stays a `choice`. |
| nested object | One question per leaf, id `outer.inner`. |
| string, unbounded number, array, union, empty object | Rejected. |

Extension keys live on the property:

```json
{ "type": "boolean", "x-systemone": { "criteria": { "true": "destructive", "false": "safe" } } }
{ "type": "string", "enum": ["run", "reject"], "x-systemone": { "options": { "run": "safe", "reject": "destructive" } } }
{ "type": "integer", "enum": [0, 1, 2], "x-systemone": { "levels": ["opaque", "partial", "actionable"] } }
```

Limits rejected up front: more than 255 choice options, more than 10 score levels, more than 256 questions. Field names that contain a dot are rejected so dotted nesting stays unambiguous.

Curated models declare `capabilities: { input: ["text"], output: ["text"], tools: false, streaming: false, structuredOutput: "json_schema" }`, `limits: { contextWindow: 32000, maxOutputTokens: 0 }`, and `cost: { input: 0.04, output: 0, currency: "USD", unit: "per_million_tokens" }`.

## Outputs / response / events

| Event | Behavior |
| --- | --- |
| `message_start` | One, before the answer. |
| `content_delta` | One text block. The text is `JSON.stringify` of the schema-shaped object. |
| `usage` | `inputTokens` from the API. `outputTokens` is `0`. `totalTokens` equals `inputTokens`. Omitted when the API sends no usage. |
| `done` | `stopReason: "end_turn"`, same usage when present. |
| `error` | Terminal event for gate failures, HTTP failures, and render failures. `401` is not retried. `422` is not retried and the message includes the API field detail. `429` and `5xx` (including `529`) retry, honoring `Retry-After`. |

Booleans come from noul vs `boolean_threshold`. Enums come from the choice string (whole-number options stay numbers). Rubric integers are `Math.round` of the score, half rounds up, clamped to the rubric. Nested objects are reassembled from dotted ids. Confidence, probabilities, and score distributions are not copied onto events; the text must stay schema-valid.

## Request/response example

```json
{
  "model": "jev-latest",
  "state": "rm -rf ./build",
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "How should this be handled?",
      "criteria": { "run": "run", "reject": "reject", "ask": "ask" }
    },
    "irreversible": { "type": "noul", "instructions": "Would running this destroy data?" }
  }
}
```

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "verdict": { "type": "choice", "choice": "ask" },
    "irreversible": { "type": "noul", "noul": 0.91 }
  },
  "usage": { "input_tokens": 96, "output_tokens": 0 }
}
```

Rendered text: `{"verdict":"ask","irreversible":true}`.

## Implementation example

```ts
import { createEnvCredentialResolver, createExtensionKernel } from "@arnilo/prism";
import { createTypeSafeProviderPackage, TYPESAFE_API_KEY_ENV } from "@arnilo/prism-providers/typesafe";

const kernel = createExtensionKernel();
await kernel.load([
  createTypeSafeProviderPackage({
    apiKey: createEnvCredentialResolver(process.env, { typesafe: TYPESAFE_API_KEY_ENV }),
  }),
]);
```

A request must carry `options.structuredOutput`. The answer arrives as one text delta.

## Extension and configuration notes

- Replace the catalog with `models` or register extra pins via `defineTypeSafeModel({ model: "jev-1.13.0" })`. Defaults (capabilities, 32k context, zero output tokens, $0.04/1M input) still apply.
- `compat.boolean_threshold` is the only request knob. There is no temperature, tool choice, or streaming flag.
- `baseUrl` points the same client at a proxy. It does not change the wire shape.
- No model listing runs at setup or during `generate()`.

## Security and performance notes

- **Egress.** State text and compiled questions leave the process for TypeSafe's hosted API (`https://api.typesafe.ai` unless `baseUrl` overrides it). Do not put secrets in the state.
- **Credentials.** The bearer token is resolved at the provider edge and redacted from error events. It is never logged.
- **Cost and latency.** One `POST /v1/systemone` round trip per structured-output request. Questions are free in parallel; state tokens are the cost. Output tokens are not billed (`output: 0`). There is no streaming and no second hop for model discovery.
- **Fail closed.** Missing schema, tools, an out-of-range threshold, and unsupported fields fail before fetch.

## Related APIs

- [Laya](laya.md): same wire and schema mapping against a self-hosted `laya-serve`.
- [Structured output](../structured-output.md): `options.structuredOutput` contract this adapter requires.
- [Provider packages](../provider-packages.md): registration and auth-method shape.
- [Credentials and redaction](../credentials-and-redaction.md): `CredentialValueSource` and `createEnvCredentialResolver`.
