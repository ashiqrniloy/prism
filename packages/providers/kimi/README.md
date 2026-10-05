# `@arnilo/prism-provider-kimi`

Kimi provider package for Prism: registers the Kimi For Coding provider (and an optional Moonshot Open Platform provider), resolves each key from an `env:`/`keyring:` ref per request, and ships the Anthropic Messages and OpenAI Chat Completions wires.

## Install

```sh
bun add @arnilo/prism-provider-kimi
```

## Use

```ts
import kimi from "@arnilo/prism-provider-kimi";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "kimi-coding/k3",
  packages: [kimi({ apiKey: "env:KIMI_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [kimi]` is the same as
`kimi({ apiKey: "env:KIMI_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:KIMI_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `kimiApiKey` | `env:`/`keyring:` ref | `env:KIMI_API_KEY` | Kimi For Coding key. |
| `moonshotApiKey` | `env:`/`keyring:` ref | `env:MOONSHOT_API_KEY` | Moonshot Open Platform key (not interchangeable with a Coding key). |
| `includeMoonshotModels` | boolean | `false` | Register the Moonshot Open Platform provider too. |
| `baseUrl` | string | vendor default | Kimi For Coding base; defaults to `https://api.kimi.com/coding`. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`kimi({ apiKey: "env:KIMI_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `moonshotId`, `userAgent`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "kimi: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.
- **Two providers.** `kimi-coding` is always registered; `moonshot` only when
  `includeMoonshotModels` is set. The two keys are not interchangeable.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createKimiCodingProvider`, the wire helpers, and the
catalog.

## License

MIT
