# `@arnilo/prism-provider-ollama`

Ollama Cloud / local provider package for Prism: registers the ollama provider, resolves its optional key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire and model catalog.

## Install

```sh
bun add @arnilo/prism-provider-ollama
```

## Use

```ts
import ollama from "@arnilo/prism-provider-ollama";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "ollama/gpt-oss:20b",
  packages: [ollama({})],
});
```

The bare definition uses the schema defaults, so `packages: [ollama]` is the same as
`ollama({})`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | — (optional) | Ollama Cloud key. Omit for an unauthenticated local `ollama serve`; an absent ref adds no status note. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | vendor default | Explicit OpenAI-compatible base; wins over `preset`. Defaults to the `cloud` preset. |
| `preset` | string | vendor default | Named deployment preset. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`ollama({})`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **No key required.** A local Ollama needs no credential, so an absent `apiKey` is not a
  warning and sends no `Authorization` header. A configured ref that resolves to nothing fails the
  run with `credential_unavailable`.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createOllamaProvider`, the wire helpers, and the
catalog.

## License

MIT
