# `@arnilo/prism-provider-alibaba`

Alibaba Cloud (Model Studio / DashScope) provider package for Prism: registers the alibaba provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire plus the embedding, image, and video providers.

## Install

```sh
bun add @arnilo/prism-provider-alibaba
```

## Use

```ts
import alibaba from "@arnilo/prism-provider-alibaba";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "alibaba/qwen-plus",
  packages: [alibaba({ apiKey: "env:DASHSCOPE_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [alibaba]` is the same as
`alibaba({ apiKey: "env:DASHSCOPE_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:DASHSCOPE_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | vendor default | Explicit OpenAI-compatible base; wins over `preset`. Defaults to the `singapore` preset. |
| `preset` | string | vendor default | Named deployment preset. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`alibaba({ apiKey: "env:DASHSCOPE_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "alibaba: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createAlibabaProvider`, the wire helpers, and the
catalog.

## License

MIT
