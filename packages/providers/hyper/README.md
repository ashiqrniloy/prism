# `@arnilo/prism-provider-hyper`

Charm Hyper provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `hyper` provider, resolves its key through the credentials slot on every request, and ships the triple-route wire (OpenAI Responses, Anthropic Messages, and OpenAI Chat), the quota and telemetry helpers, the cache/thinking helpers, and the model catalog.

## Install

```sh
bun add @arnilo/prism-provider-hyper
```

## Use

```ts
import hyper from "@arnilo/prism-provider-hyper";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "hyper/deepseek-v4-pro",
  packages: [hyper({ apiKey: "env:HYPER_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [hyper]` is the same as
`hyper({ apiKey: "env:HYPER_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:HYPER_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://hyper.charm.land/v1` | Official base. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`hyper({ apiKey: "env:HYPER_API_KEY" })`) or through
`AgentConfig.packageConfig` (which wins). Factory-only options — `id` and `fetch` — are not JSON and
cannot come from a manifest.

## Behaviour

- **Three routes, one provider.** `compat.route` picks the wire: `responses` reuses the provider-kit OpenAI Responses machinery, `anthropic` posts to `/messages` with `x-api-key` + `anthropic-version`, and everything else posts to `/chat/completions` with a bearer token.
- **Quota and usage cost stay host-callable.** `getHyperCredits` and `parseHyperUsageCost` are named exports; the provider never calls them itself.
- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "hyper: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A request then
  fails with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createHyperProvider`, `hyperChatBody`, `hyperChatEvents`, `serializeHyperChatMessage`, `classifyHyperError`, `hyperHttpError`, `applyHyperAnthropicCacheControl`, `getHyperCredits`, `parseHyperUsageCost`, the thinking helpers, and the catalog (`hyperModels`, `defineHyperModel`, `listHyperModels`, `mapHyperModel`, `routeForHyperModel`, `costFromHyperPricing`).

## License

MIT
