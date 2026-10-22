# `@arnilo/prism-provider-opencode-go`

OpenCode Go provider package for [Prism](https://github.com/ashiqrniloy/prism): registers the `opencode-go` provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the dual-route wire (Anthropic Messages and OpenAI Chat) plus the model catalog.

## Install

```sh
bun add @arnilo/prism-provider-opencode-go
```

## Use

```ts
import opencodeGo from "@arnilo/prism-provider-opencode-go";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "opencode-go/mimo-v2.5",
  packages: [opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [opencodeGo]` is the same as
`opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:OPENCODE_GO_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://opencode.ai/zen/go/v1` | Official base. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Two routes, one provider.** Built on the routed provider builder (`createRoutedProvider`). `compat.route` or `routeForOpenCodeGoModel` picks the wire: `anthropic` (`minimax-*`, `qwen*`) posts to `/messages` with `x-api-key` + `anthropic-version`, and default `openai` posts to `/chat/completions` with bearer token. Replays thinking (`reasoning_content` on chat route; thinking blocks on Anthropic route).
- **Session correlation requirement.** Fails closed with `ProviderRequirementError` before any fetch if `options.sessionId` is missing.
- **Session affinity.** Injects `x-opencode-session` header derived from sanitized `cacheKey ?? sessionId` (max 128 characters) to maintain worker cache affinity across forks.
- **Structured output.** Native `json_schema` supported on live-verified models (`mimo-v2.5`, `mimo-v2.5-pro`). Unverified models (e.g. `deepseek-v4-pro`) reject before dispatch.
- **Prompt caching.** Implicit caching on the OpenAI Chat route; explicit `cache_control` breakpoints with optional `ttl: "1h"` long retention on the Anthropic Messages route.
- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "opencode-go: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createOpenCodeGoProvider`, `OPENCODE_GO_CHAT_ROUTE`, `OPENCODE_GO_MESSAGES_ROUTE`, `opencodeSession`, `OPENCODE_SESSION_ID_MAX_LENGTH`, and the catalog (`openCodeGoModels`, `defineOpenCodeGoModel`, `listOpenCodeGoModels`, `mapOpenCodeGoModel`, `routeForOpenCodeGoModel`, `openCodeGoThinkingLevels`, `openCodeGoThinkingFamily`).

## License

MIT
