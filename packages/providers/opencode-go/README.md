# `@arnilo/prism-provider-opencode-go`

OpenCode Go provider package for Prism: registers the opencode-go provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible and Anthropic Messages wires plus the model catalog.

## Install

```sh
bun add @arnilo/prism-provider-opencode-go
```

## Use

```ts
import opencodeGo from "@arnilo/prism-provider-opencode-go";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "opencode-go/gpt-5.1-go",
  packages: [opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [opencodeGo]` is the same as
`opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:OPENCODE_GO_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | vendor default | Official base; defaults to `https://opencode.ai/zen/go/v1`. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "opencode-go: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createOpenCodeGoProvider`, the wire helpers, and the
catalog.

## License

MIT
