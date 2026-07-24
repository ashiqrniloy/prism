# @arnilo/prism-provider-bedrock

Amazon Bedrock enterprise adapter for Prism. Host supplies IAM/IRSA credentials; package signs OpenAI-compatible `bedrock-runtime` requests with SigV4 (no AWS SDK). Region and optional VPC endpoint are preserved.

## Install

```bash
npm install @arnilo/prism-provider-bedrock @arnilo/prism
```

## Usage

```ts
import { createBedrockProviderPackage } from "@arnilo/prism-provider-bedrock";

createBedrockProviderPackage({
  region: "eu-west-1",
  // endpoint: "https://vpce-….bedrock-runtime.eu-west-1.vpce.amazonaws.com",
  credential: () => hostAwsCredentialProvider(), // IRSA / instance role / assume-role
  models: [{ provider: "bedrock", model: "anthropic.claude-3-haiku-20240307-v1:0" }],
});
```

See [Amazon Bedrock](../../docs/providers/bedrock.md).
