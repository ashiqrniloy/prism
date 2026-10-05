# `@arnilo/prism-provider-commandcode`

Command Code provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `commandcode` provider, resolves its key through the credentials slot on every request, and ships the dual-route wire (Anthropic Messages and OpenAI Chat), the retry classification, the cache/thinking helpers, and the model catalog.

## Install

```sh
bun add @arnilo/prism-provider-commandcode
```

## Use

```ts
import commandcode from "@arnilo/prism-provider-commandcode";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "commandcode/claude-opus-5",
  packages: [commandcode({ apiKey: "env:COMMANDCODE_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [commandcode]` is the same as
`commandcode({ apiKey: "env:COMMANDCODE_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:COMMANDCODE_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://api.commandcode.ai/provider/v1` | Official base. |
| `zdr` | boolean | `false` | Enforce zero data retention: adds the provider-owned `x-cmd-zdr: 1` header, so requests route only through ZDR-capable upstreams. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`commandcode({ apiKey: "env:COMMANDCODE_API_KEY" })`) or through
`AgentConfig.packageConfig` (which wins). Factory-only options — `id` and `fetch` — are not JSON and
cannot come from a manifest.

## Behaviour

- **Two routes, one provider.** `compat.route: "anthropic"` (the `claude-*` ids) posts to `/messages` with `x-api-key` + `anthropic-version`; every other model posts to `/chat/completions` with a bearer token.
- **Zero data retention is opt-in.** `zdr: true` adds `x-cmd-zdr: 1`; a model with no ZDR upstream then fails with `422 cmd_zdr_no_providers`.
- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "commandcode: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A request then
  fails with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createCommandCodeProvider`, `COMMAND_CODE_ANTHROPIC_HOOKS`, `commandCodeChatBody`, `commandCodeChatEvents`, `serializeCommandCodeChatMessage`, `classifyCommandCodeError`, `commandCodeHttpError`, `applyCommandCodeCacheControl`, the thinking helpers, and the catalog (`commandCodeModels`, `defineCommandCodeModel`, `listCommandCodeModels`, `mapCommandCodeModel`, `routeForCommandCodeModel`).

## License

MIT
