# `@arnilo/prism-provider-vertex`

Google Vertex AI provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `vertex` provider, resolves the host ADC credential through the credentials slot on every request, and targets the location-scoped OpenAPI-compatible endpoint.

## Install

```sh
bun add @arnilo/prism-provider-vertex
```

## Use

```ts
import vertex from "@arnilo/prism-provider-vertex";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "vertex/google/gemini-2.5-flash",
  packages: [
    vertex({
      project: "my-project",
      location: "us-central1",
      credential: "env:PRISM_VERTEX_ACCESS_TOKEN",
    }),
  ],
});
```

`project` and `location` are required, so a bare `packages: [vertex]` needs them from `packageConfig`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `project` | string | — (required at setup) | Google Cloud project id. |
| `location` | string | — (required at setup) | Vertex location / region (e.g. `us-central1`); preserved for residency. |
| `endpoint` | https URL | — | Optional private / custom OpenAPI-compatible base URL. |
| `credential` | `env:`/`keyring:` ref | `env:PRISM_VERTEX_ACCESS_TOKEN` | Resolves to a **bearer access token** through the credentials slot on every request; a literal value is rejected (`secret_literal`). |
| `models` | `ModelConfig[]` | — | Static catalog; Vertex publishes no unauthenticated model listing. |

Set config through the code instance or through `AgentConfig.packageConfig` (which wins). Factory-only
options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing credential.** `createAgent` still succeeds. Setup records a `warn` status note naming the
  ref and registers the provider anyway, so `agent.models` still lists the catalog and the failure is
  not `Unknown provider`. A run then fails with `credential_unavailable`, naming the ref and never a
  value.
- **Discovery is caller-gated.** Nothing fetches during setup.
- **Secrets never surface.** Every resolved credential joins the agent's redaction set, so it is masked
  in events, `inspect()`, status notes, and errors.
- **ADC stays host-owned.** The package never reads a service-account file: a host that owns ADC mints a token (or supplies its own `CredentialValueSource` through the factory) and the token joins the agent's redaction set. A missing token fails the run with `credential_unavailable`.
## Named exports

The raw factories stay public for tests and advanced hosts: `createVertexProvider`, `vertexOpenApiBaseUrl`.

## License

MIT
