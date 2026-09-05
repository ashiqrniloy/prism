# Amazon Bedrock

## What it does

`@arnilo/prism-providers/bedrock` registers an Amazon Bedrock Runtime OpenAI-compatible Chat Completions provider. Hosts supply IAM/IRSA/assumed-role credentials; the package signs requests with SigV4 (no AWS SDK). Region and optional PrivateLink endpoint URLs are preserved.

## When to use it

Use it for enterprise Bedrock access under workload identity. Do not embed long-lived keys in fixtures. Use model-router residency policy to deny disallowed regions.

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

Live canaries stay opt-in behind host credentials; default tests are network-free.

## Extension and configuration notes

Uses Bedrock’s OpenAI-compatible runtime route (not Converse eventstream). Hosts needing Converse-only models should supply a custom provider or AI SDK bridge.

## Security and performance notes

- No AWS SDK; package-local SigV4 only for `bedrock` service.
- Input headers are normalized once before signing: names are lowercased and duplicate-case keys merge last-wins, so the canonical request always matches the signed header list (no duplicate-case mismatch); query parameters are canonicalized sorted by encoded key then value.
- Private endpoint hosts are not rewritten to public DNS.
- Conformance-proven (Task 6): package `setup()` performs zero fetch and zero credential resolution; an already-aborted signal fails fast; a truncated SSE stream (no `data: [DONE]`) ends in an `error` event; native Bedrock caching (`Converse cachePoint`) is intentionally unsupported on the OpenAI-compatible route — no cache wire fields are emitted even when the request carries Prism cache hints.
- Credential secrets are redacted from provider errors.
- No credential prefetch at import.

## Live probe

Opt-in smoke over real AWS Bedrock (package-local SigV4, static keys or session token):

```bash
PRISM_LIVE_PROVIDER_TESTS=1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
  node --test packages/prism-providers/dist/bedrock/__tests__/live.test.js
```

`PRISM_LIVE_BEDROCK_MODEL` overrides the probed model (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`). Without credentials the suite skips.

## Thinking and reasoning

Bedrock OpenAI-compat chat expects snake_case `reasoning_effort` (with `effort`/`reasoningEffort` aliases) or a sanitized `reasoning` object. OpenAI-family models on Bedrock snap effort to their declared levels (gpt-5.1 → `none/low/medium/high`); non-OpenAI models pass through untouched. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [OpenAI-compatible provider](openai-compatible.md)
- [Model routing](../model-routing.md)
- [Provider packages](../provider-packages.md)
- Package README: [`@arnilo/prism-providers` family README](../../packages/prism-providers/README.md)
