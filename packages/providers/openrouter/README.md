# `@arnilo/prism-provider-openrouter`

OpenRouter provider package for Prism: registers the openrouter provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire and model catalog.

## Install

```sh
bun add @arnilo/prism-provider-openrouter
```

## Use

```ts
import openrouter from "@arnilo/prism-provider-openrouter";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openrouter/anthropic/claude-sonnet-4",
  packages: [openrouter({ apiKey: "env:OPENROUTER_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [openrouter]` is the same as
`openrouter({ apiKey: "env:OPENROUTER_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:OPENROUTER_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | vendor default | Official Chat Completions base; defaults to `https://openrouter.ai/api/v1`. |
| `appUrl` | string | — | OpenRouter app URL (attribution header). |
| `appTitle` | string | — | OpenRouter app title (attribution header). |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`openrouter({ apiKey: "env:OPENROUTER_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "openrouter: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createOpenRouterProvider`, the wire helpers, and the
catalog.

## License

MIT
