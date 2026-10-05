# `@arnilo/prism-provider-anthropic`

Anthropic Messages provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the
`anthropic` provider, resolves its key through the credentials slot on every request, and ships the
Messages wire, the model catalog, and the cache/thinking helpers.

## Install

```sh
bun add @arnilo/prism-provider-anthropic
```

## Use

```ts
import anthropic from "@arnilo/prism-provider-anthropic";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "anthropic/claude-sonnet-4-5",
  packages: [anthropic({ apiKey: "env:ANTHROPIC_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [anthropic]` is the same as
`anthropic({ apiKey: "env:ANTHROPIC_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:ANTHROPIC_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://api.anthropic.com/v1` | Official Messages base. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`anthropic({ apiKey: "env:ANTHROPIC_API_KEY" })`) or through
`AgentConfig.packageConfig` (which wins). Factory-only options — `id`, `fetch`, `userAgent` — are not
JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "anthropic: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createAnthropicMessagesProvider`,
`anthropicMessagesBody`, `anthropicMessagesEvents`, `anthropicOwnedHeaders`, the thinking/cache
helpers, and the catalog (`anthropicModels`, `defineAnthropicModel`, `listAnthropicModels`,
`mapAnthropicModel`).

## License

MIT
