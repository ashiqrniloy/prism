# Amazon Bedrock

## What it does

`@arnilo/prism-providers/bedrock` registers an Amazon Bedrock Runtime provider with two explicit routes:

| Route | Wire API | Select with |
| --- | --- | --- |
| `compatible` (default) | OpenAI-compatible Chat Completions at `/openai/v1/chat/completions` | `createBedrockProvider` / `api: "compatible"` |
| `converse` | Native model-agnostic `Converse` and `ConverseStream` | `createBedrockConverseProvider` / `api: "converse"` |

Hosts supply IAM/IRSA/assumed-role credentials; the package signs requests with SigV4 (no AWS SDK). Region and optional PrivateLink endpoint URLs are preserved.

## When to use it

Use it for enterprise Bedrock access under workload identity. Do not embed long-lived keys in fixtures. Use model-router residency policy to deny disallowed regions. Use the `converse` route when the model only exists on Converse (tool use, reasoning, prompt caching, and structured output for Anthropic/Nova/OpenAI families), and keep `compatible` when an OpenAI-shaped gateway is what the deployment standardizes on.

## Route selection

```ts
import { createBedrockConverseProvider, createBedrockProviderPackage } from "@arnilo/prism-providers/bedrock";

// Package form: one provider id, selected route, optional non-streaming mode.
createBedrockProviderPackage({
  region: "eu-west-1",
  credential: () => hostAwsCredentials(),
  api: "converse", // or "compatible" (default)
  stream: true, // native route only: ConverseStream (default) vs one Converse call
  models: [{ provider: "bedrock", model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0" }],
});

// Factory form (same options, no registry wiring):
const provider = createBedrockConverseProvider({ region: "us-east-1", credential });
```

Routes are mutually exclusive per provider id, so a host that needs both registers the second provider under a different `id` and model bindings. The package records the selected route in `ProviderPackage.metadata.route` and in the registered auth method metadata.

## Capability matrix

| Capability | `compatible` | `converse` |
| --- | --- | --- |
| Text streaming | yes (OpenAI SSE) | yes (`ConverseStream` event stream) |
| Non-streaming | n/a (always streams) | yes (`stream: false`, one `Converse` response mapped to deltas + done) |
| Images | model-dependent OpenAI image parts | `image` blocks (`png`/`jpeg`/`gif`/`webp`); unknown media types refuse before the request |
| PDF documents | n/a | `document` blocks (`format` from media type); non-PDF files refuse |
| Tools | OpenAI `tools` | `toolConfig.tools[].toolSpec`, streamed `toolUse` deltas, `toolResult` in the following user turn |
| Reasoning/thinking | sanitized `reasoning_effort` / `reasoning` object | Anthropic-family `thinking` (`enabled`/`disabled`/`adaptive`, budget validated) and OpenAI-family `reasoning_effort` in `additionalModelRequestFields`; reasoning deltas map to Prism thinking blocks with signatures |
| Prompt caching | none (no Prism cache fields emitted) | `cachePoint` blocks from Prism cache breakpoints, `ttl: "1h"` for long retention; usage reports `cacheReadTokens` / `cacheWriteTokens` |
| Structured output | body passthrough only | `outputConfig.textFormat` JSON schema (requires `capabilities.structuredOutput`) |
| Usage | OpenAI usage | `inputTokens`/`outputTokens`/`totalTokens` + cache read/write |

Every feature above is tested offline against recorded frame/body fixtures; the live probe below covers text, tools, and usage. Features are not inferred from compatible endpoints.

## Inputs / request

```ts
import { createBedrockProviderPackage } from "@arnilo/prism-providers/bedrock";

createBedrockProviderPackage({
  region: "eu-west-1",
  // endpoint: "https://vpce-….bedrock-runtime.eu-west-1.vpce.amazonaws.com",
  credential: () => hostAwsCredentials(),
  models: [{ provider: "bedrock", model: "anthropic.claude-3-haiku-20240307-v1:0" }],
});
```

| Field | Meaning |
| --- | --- |
| `region` | AWS region for signing + default endpoint |
| `endpoint` | Optional https PrivateLink / VPC interface base URL |
| `credential` | `{ accessKeyId, secretAccessKey, sessionToken? }` or async callback |
| `signRequest` | Optional host SigV4 override |

Default public base: `https://bedrock-runtime.{region}.amazonaws.com` → `/openai/v1/chat/completions`.

## Outputs / response / events

OpenAI-compatible SSE mapped to Prism provider events. Missing credentials fail closed before network I/O.

Native route: `ConverseStream` frames are decoded from `application/vnd.amazon.eventstream` (prelude/header lengths and both CRC32 checksums validated, 1 MiB default frame ceiling, 24 MiB hard spec ceiling) and mapped to Prism provider events. `:message-type: exception` frames become `error` events with the exception name and message; a stream that ends without `messageStop` or with an incomplete tool block fails loudly instead of returning partial output as success. Credentials are resolved once per request and redacted from provider errors.

## Request/response example

```http
POST https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1/chat/completions
Authorization: AWS4-HMAC-SHA256 Credential=…/eu-west-1/bedrock/aws4_request, …
X-Amz-Security-Token: …
```

## Implementation example

```ts
const provider = createBedrockProvider({
  region: "us-east-1",
  credential: async () => fromNodeProviderChain()(),
});
```

Native route request:

```http
POST https://bedrock-runtime.eu-west-1.amazonaws.com/model/eu.anthropic.claude-haiku-4-5-20251001-v1%3A0/converse-stream
Accept: application/vnd.amazon.eventstream
Authorization: AWS4-HMAC-SHA256 Credential=…/eu-west-1/bedrock/aws4_request, …

{ "messages": [{ "role": "user", "content": [{ "text": "hi" }] }],
  "inferenceConfig": { "maxTokens": 4096 } }
```

The `Converse` and `ConverseStream` operations share one request body; `accept` and the URL suffix select the operation. Inference-profile model ids (`eu.`/`us.` prefixes) are percent-encoded into the path, and region/endpoint policy is unchanged from the compatible route.

Live canaries stay opt-in behind host credentials; default tests are network-free.

## Extension and configuration notes

The compatible route uses Bedrock’s OpenAI-compatible runtime route (not Converse eventstream). The native route (`api: "converse"`) covers Converse-only models and features; both stay explicit, and neither silently falls back to the other.

Model-specific fields (for example `top_k`) come from `ModelConfig.parameters` leftovers plus the sanitized `compat.thinking` / `compat.reasoning_effort` keys; opaque `compat` keys are not spread onto the Converse body, and `toolChoice` is only forwarded when it is `auto`/`any`/`required` or `{ tool: { name } }`.

## Request construction (0.5.1)

Agent sessions stamp `sessionId`/`cacheKey` without a host policy. Session/cache keys are correlation ids, never secrets.

| | |
| --- | --- |
| P1 session wire | none |
| Mandatory | no |
| P2 default cache | host-owned, no Prism cache fields |

See [Provider request policies](../provider-request-policies.md).

## Security and performance notes

- No AWS SDK; package-local SigV4 only for `bedrock` service on both routes.
- Input headers are normalized once before signing: names are lowercased and duplicate-case keys merge last-wins, so the canonical request always matches the signed header list (no duplicate-case mismatch); query parameters are canonicalized sorted by encoded key then value.
- Private endpoint hosts are not rewritten to public DNS.
- Conformance-proven (Task 6): package `setup()` performs zero fetch and zero credential resolution; an already-aborted signal fails fast; a truncated SSE stream (no `data: [DONE]`) ends in an `error` event; native Bedrock caching (`Converse cachePoint`) is intentionally unsupported on the OpenAI-compatible route — no cache wire fields are emitted even when the request carries Prism cache hints.
- Native route: `ConverseStream` frames are capped at 1 MiB (24 MiB hard spec ceiling) and a non-streaming `Converse` body is read under a 4 MiB ceiling (`BEDROCK_CONVERSE_RESPONSE_MAX_BYTES`), so a hostile or runaway response cannot exhaust memory.
- Native route: denied/unknown capabilities (`streaming: false` with the streaming route, `tools: false` with tools, `structuredOutput` undeclared, `reasoning: false` with a thinking/effort request, unsupported media types) refuse before any request is sent; corrupt or oversized event-stream frames terminate the stream rather than resyncing.
- Credential secrets are redacted from provider errors.
- No credential prefetch at import on either route.

## Live probe

Opt-in smoke over real AWS Bedrock (package-local SigV4, static keys or session token):

```bash
PRISM_LIVE_PROVIDER_TESTS=1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
  node --test packages/prism-providers/dist/bedrock/__tests__/live.test.js
```

`PRISM_LIVE_BEDROCK_MODEL` overrides the probed model (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`). The same suite also probes the native route (streaming text/tools/usage and one non-streaming `Converse` call). Without credentials the suite skips.

## Thinking and reasoning

Compatible route: Bedrock OpenAI-compat chat expects snake_case `reasoning_effort` (with `effort`/`reasoningEffort` aliases) or a sanitized `reasoning` object. OpenAI-family models on Bedrock snap effort to their declared levels (gpt-5.1 → `none/low/medium/high`); non-OpenAI models pass through untouched.

Native route: Anthropic-family models take `additionalModelRequestFields.thinking` (`{type: "enabled"|"disabled"|"adaptive", budget_tokens?}`); a bare `enabled` gets a default budget so it can never reach the wire without one, and historical thinking blocks replay with signatures when `compat.preserveThinking` is on (default: when the model declares `capabilities.reasoning`). OpenAI-family models take `additionalModelRequestFields.reasoning_effort`, snapped to declared levels. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [OpenAI-compatible provider](openai-compatible.md)
- [Model routing](../model-routing.md)
- [Provider packages](../provider-packages.md)
- Package README: [`@arnilo/prism-providers` family README](../../packages/prism-providers/README.md)
