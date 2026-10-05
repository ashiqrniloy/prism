# `@arnilo/prism-provider-zai`

Z.AI provider package for Prism: registers the zai provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire, thinking controls, and model catalog.

## Install

```sh
bun add @arnilo/prism-provider-zai
```

## Use

```ts
import zai from "@arnilo/prism-provider-zai";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "zai/glm-4.7",
  packages: [zai({ apiKey: "env:ZAI_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [zai]` is the same as
`zai({ apiKey: "env:ZAI_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:ZAI_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | vendor default | Official international Chat Completions base; defaults to `https://api.z.ai/api/paas/v4`. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`zai({ apiKey: "env:ZAI_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "zai: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createZaiProvider`, the wire helpers, and the
catalog.

## License

MIT
