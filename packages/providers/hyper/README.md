# `@arnilo/prism-ai/hyper`

Charm Hyper provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `hyper` provider, resolves its key through the credentials slot on every request, and ships the dual-route wire (Anthropic Messages and OpenAI Chat), the quota and telemetry helpers, and the model catalog.

## Install

```sh
bun add @arnilo/prism-ai
```

## Use

```ts
import hyper from "@arnilo/prism-ai/hyper";
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

- **Two routes, one provider.** Built on the routed provider builder (`createRoutedProvider`). `compat.route` or `routeForHyperModel` picks the wire: `anthropic` posts to `/messages` with `x-api-key` + `anthropic-version`, and default `openai` posts to `/chat/completions` with a bearer token. Replays thinking (`reasoning_content` on chat route; thinking blocks on Anthropic route).
- **Monetization and usage telemetry.** Automatically surfaces Hyper's `usage.cost` (USD) into `Usage.cost`/`currency` and `Usage.metadata.hyper` (`usd`, `hypercredits`, `remainingHypercredits`).
- **Error classification.** Maps HTTP errors into redacted errors; 402 `billing_error` is classified as non-retryable permanent failure.
- **Quota stays host-callable.** `getHyperCredits` and `parseHyperUsageCost` are named exports; the provider never calls them itself.
- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "hyper: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A request then
  fails with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createHyperProvider`, `HYPER_CHAT_ROUTE`, `HYPER_MESSAGES_ROUTE`, `withHyperCost`, `getHyperCredits`, `parseHyperUsageCost`, and the catalog (`hyperModels`, `defineHyperModel`, `listHyperModels`, `mapHyperModel`, `routeForHyperModel`, `costFromHyperPricing`).

## License

MIT
