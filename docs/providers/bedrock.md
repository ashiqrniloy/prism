# Amazon Bedrock

## What it does

`@arnilo/prism-provider-bedrock` registers an Amazon Bedrock Runtime OpenAI-compatible Chat Completions provider. Hosts supply IAM/IRSA/assumed-role credentials; the package signs requests with SigV4 (no AWS SDK). Region and optional PrivateLink endpoint URLs are preserved.

## When to use it

Use it for enterprise Bedrock access under workload identity. Do not embed long-lived keys in fixtures. Use model-router residency policy to deny disallowed regions.

## Inputs / request

```ts
import { createBedrockProviderPackage } from "@arnilo/prism-provider-bedrock";

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
- Private endpoint hosts are not rewritten to public DNS.
- Credential secrets are redacted from provider errors.
- No credential prefetch at import.

## Related APIs

- [OpenAI-compatible provider](openai-compatible.md)
- [Model routing](../model-routing.md)
- [Provider packages](../provider-packages.md)
- Package README: [`@arnilo/prism-provider-bedrock`](../../packages/provider-bedrock/README.md)
