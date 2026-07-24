# @arnilo/prism-provider-vertex

Google Vertex AI enterprise adapter for Prism. Host supplies ADC/workload identity tokens. Separate from `@arnilo/prism-provider-google` (consumer API-key Gemini).

## Install

```bash
npm install @arnilo/prism-provider-vertex @arnilo/prism
```

## Usage

```ts
import { createVertexProviderPackage } from "@arnilo/prism-provider-vertex";

createVertexProviderPackage({
  projectId: "my-gcp-project",
  location: "europe-west1",
  credential: () => hostAdcTokenProvider(), // ADC / workload identity
  models: [{ provider: "vertex", model: "google/gemini-2.0-flash-001" }],
});
```

See [Google Vertex AI](../../docs/providers/vertex.md).
