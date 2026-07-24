# Google Vertex AI

## What it does

`@arnilo/prism-provider-vertex` registers a Vertex AI OpenAPI-compatible Chat Completions provider authenticated with host ADC / workload identity tokens. It is intentionally separate from `@arnilo/prism-provider-google` (consumer Gemini API keys).

## When to use it

Use it for GCP enterprise Vertex deployments with Application Default Credentials or workload identity federation. Do not use the consumer Google package for Vertex auth semantics.

## Inputs / request

```ts
import { createVertexProviderPackage } from "@arnilo/prism-provider-vertex";

createVertexProviderPackage({
  projectId: "my-gcp-project",
  location: "europe-west1",
  credential: () => hostAdcAccessToken(),
  models: [{ provider: "vertex", model: "google/gemini-2.0-flash-001" }],
});
```

| Field | Meaning |
| --- | --- |
| `projectId` | GCP project |
| `location` | Vertex location / region |
| `endpoint` | Optional full https OpenAPI base (private/custom); otherwise location-scoped default |
| `credential` | Bearer access token source (ADC / WIF) |

Default base: `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/endpoints/openapi`.

## Outputs / response / events

OpenAI-compatible SSE → Prism provider events. Missing ADC token fails closed before `fetch`.

## Request/response example

```http
POST https://europe-west1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/europe-west1/endpoints/openapi/chat/completions
Authorization: Bearer <adc-token>
```

## Implementation example

```ts
const provider = createVertexProvider({
  projectId: "my-gcp-project",
  location: "us-central1",
  credential: async () => (await GoogleAuth.getAccessToken()),
});
```

## Extension and configuration notes

`@arnilo/prism-provider-google` remains API-key Gemini (`generativelanguage.googleapis.com`) and must not register Vertex OAuth/ADC. Load this package explicitly for Vertex.

## Security and performance notes

- No Google Cloud SDK dependency in the package.
- Custom/private endpoint hosts are preserved.
- Tokens redacted from errors; no import-time credential prefetch.
- Pair with model-router residency allow-lists on `location`.

## Related APIs

- [Google Gemini (consumer)](google.md)
- [OpenAI-compatible provider](openai-compatible.md)
- [Provider packages](../provider-packages.md)
- [Model routing](../model-routing.md)
- Package README: [`@arnilo/prism-provider-vertex`](../../packages/provider-vertex/README.md)
