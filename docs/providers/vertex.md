# Google Vertex AI

## What it does

`@arnilo/prism-provider-vertex` registers a Vertex AI OpenAPI-compatible Chat Completions provider authenticated with host ADC / workload identity tokens. It is intentionally separate from `@arnilo/prism-provider-google` (consumer Gemini API keys).

## When to use it

Use it for GCP enterprise Vertex deployments with Application Default Credentials or workload identity federation. Do not use the consumer Google package for Vertex auth semantics.

## Inputs / request

```ts
import vertex from "@arnilo/prism-provider-vertex";

// Default export: the package definition — call it, or pass the result to `packages: [...]`.
vertex(options: VertexProviderPackageOptions & VertexProviderConfig): PackageInstance

// Named exports.
createVertexProvider(options: VertexProviderOptions): ModelProvider
vertexOpenApiBaseUrl(options): string
```

| Config field | Type | Purpose |
| --- | --- | --- |
| `project` | string | Google Cloud project id (checked in setup). |
| `location` | string | Vertex location / region, e.g. `us-central1` (checked in setup). |
| `endpoint` | string | Optional full OpenAPI-compatible base URL (private endpoint); must be https. |
| `credential` | secret ref | Resolved by the credentials slot to a bearer access token; ADC/workload identity stays host-owned. |
| `models` | `ModelConfig[]` | Static catalog; Vertex publishes no unauthenticated model listing. |

| Factory-only option | Type | Purpose |
| --- | --- | --- |
| `id` | string | Provider id; defaults to `vertex`. |
| `fetch` | `typeof fetch` | Test seam: the transport every request uses. |

`models()` returns the configured `models` array when set, otherwise `[]` — Vertex publishes no unauthenticated model listing. Pass the ids you intend to use in config.

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
import { createAgent } from "@arnilo/prism";
import vertex from "@arnilo/prism-provider-vertex";

const agent = await createAgent({
  model: { provider: "vertex", model: "gemini-2.5-flash" },
  packages: [
    vertex({
      project: "my-project",
      location: "us-central1",
      credential: "env:PRISM_VERTEX_ACCESS_TOKEN", // minted by host ADC
    }),
  ],
});

const models = await agent.models.list(); // the configured catalog, no fetch
await agent.dispose();
```

## Extension and configuration notes

`@arnilo/prism-provider-google` remains API-key Gemini (`generativelanguage.googleapis.com`) and must not register Vertex OAuth/ADC. Load this package explicitly for Vertex.

## Request construction (0.5.1)

Agent sessions stamp `sessionId`/`cacheKey` without a host policy. Session/cache keys are correlation ids, never secrets.

| | |
| --- | --- |
| P1 session wire | none |
| Mandatory | no |
| P2 default cache | host-owned, no Prism cache fields |

See [Provider request policies](../provider-request-policies.md).

## Security and performance notes

- No Google Cloud SDK dependency in the package.
- Custom/private endpoint hosts are preserved.
- Tokens redacted from errors; no import-time credential prefetch — the credential is resolved exactly once per request (a rotating `CredentialValueSource` is never consumed twice; the same resolved token drives the wrapper check and the inner auth header).
- Conformance-proven (Task 6): package `setup()` performs zero fetch and zero credential resolution; an already-aborted signal fails fast; a truncated SSE stream (no `data: [DONE]`) ends in an `error` event; native Vertex cached-content lifecycle is intentionally unsupported on the OpenAI-compatible route — no cache wire fields are emitted even when the request carries Prism cache hints (use `@arnilo/prism-provider-google`'s `extra.cachedContent` on that package, or manage cache resources host-side).
- Pair with model-router residency allow-lists on `location`.

## Live probe

Opt-in smoke against Vertex's OpenAI-compatible endpoint. The suite takes a pre-minted bearer token (host ADC/workload identity stays host-owned):

```bash
PRISM_LIVE_PROVIDER_TESTS=1 GOOGLE_VERTEX_PROJECT=my-project \
  PRISM_VERTEX_ACCESS_TOKEN=$(gcloud auth print-access-token) \
  bun test packages/providers/vertex/src/__tests__/live.test.ts
```

`GOOGLE_VERTEX_LOCATION` (default `us-central1`) and `PRISM_LIVE_VERTEX_MODEL` (default `gemini-2.5-flash`) are optional. Missing project or token → skip.

## Thinking and reasoning

Vertex AI OpenAI-compat chat uses the same sanitized thinking-compat forwarding as Azure: `reasoning_effort` (aliases `effort`/`reasoningEffort`) or a `reasoning` object, snapped to the model's declared levels (Gemini → `low/medium/high`). `reasoning_effort` and `extra_body.google.thinking_config` are mutually exclusive upstream — send one. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [Google Gemini (consumer)](google.md)
- [OpenAI-compatible provider](openai-compatible.md)
- [Provider packages](../provider-packages.md)
- [Model routing](../model-routing.md)
- Package README: [`@arnilo/prism-provider-vertex`](../../packages/providers/vertex/README.md)
