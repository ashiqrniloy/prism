# `@arnilo/prism-provider-google`

Google Gemini generateContent provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `google` provider, resolves its key through the credentials slot on every request, and ships the `generateContent` wire, the model catalog and caller-gated discovery, the Gemini `ModelDiscovery` adapter, and the thinking helpers.

## Install

```sh
bun add @arnilo/prism-provider-google
```

## Use

```ts
import google from "@arnilo/prism-provider-google";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "google/gemini-2.5-flash",
  packages: [google({ apiKey: "env:GEMINI_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [google]` is the same as `google({ apiKey: "env:GEMINI_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:GEMINI_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://generativelanguage.googleapis.com/v1beta` | Gemini API base; sent as `POST <baseUrl>/models/<id>:streamGenerateContent?alt=sse`. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks `GET <baseUrl>/models` (caller-gated). |

Set config through the code instance or through `AgentConfig.packageConfig` (which wins). Factory-only
options — `id`, `fetch`, `userAgent` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing credential.** `createAgent` still succeeds. Setup records a `warn` status note naming the
  ref and registers the provider anyway, so `agent.models` still lists the catalog and the failure is
  not `Unknown provider`. A run then fails with `credential_unavailable`, naming the ref and never a
  value.
- **Discovery is caller-gated.** Nothing fetches during setup.
- **Secrets never surface.** Every resolved credential joins the agent's redaction set, so it is masked
  in events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createGoogleGenerateContentProvider`, `googleGenerateContentBody`/`googleGenerateContentEvents`, `googleOwnedHeaders`, the thinking helpers, the catalog (`googleModels`, `defineGoogleModel`, `listGoogleModels`, `mapGoogleModel`, `stripModelsPrefix`), and the host-facing `createGoogleModelDiscovery`.

## License

MIT
