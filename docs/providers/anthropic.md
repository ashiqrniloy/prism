# Anthropic provider package

## What it does

`@arnilo/prism-provider-anthropic` is the first-party Anthropic Messages provider for Prism (`POST /v1/messages`). Setup is side-effect-free: no network, env scan, or keychain lookup during import/setup. Wire format is package-local (OpenCode Go / Kimi Anthropic routes are pattern-only, not a shared core serializer).

## When to use it

Use for native Claude Messages (tools, `cache_control`, thinking/reasoning, media, usage, abort). Prefer this over the AI SDK escape hatch when Anthropic is a primary coding host.

Do **not** use for OpenCode Go Anthropic *route* hosting (`@arnilo/prism-provider-opencode-go`), automatic credential discovery, Claude Code credential-file/setup-token import, or Claude.ai subscription login/routing. This package is API-key-only.

## Inputs / request

```ts
import anthropic from "@arnilo/prism-provider-anthropic";

// Default export: the package definition — call it, or pass the result to `packages: [...]`.
anthropic(options?: AnthropicProviderPackageOptions & AnthropicProviderConfig = {}): PackageInstance

// Named exports.
createAnthropicMessagesProvider(options?: AnthropicMessagesProviderOptions): ModelProvider
listAnthropicModels(options?: ListAnthropicModelsOptions): Promise<ModelConfig[]>
defineAnthropicModel(config: AnthropicModelConfig): ModelConfig
```

| Config field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | secret ref | Resolved by the credentials slot; default `env:ANTHROPIC_API_KEY`. A literal value is rejected. |
| `baseUrl` | string | Official Messages base; defaults to `https://api.anthropic.com/v1`. |
| `models` | `ModelConfig[]` | Static catalog; when absent, `models()` asks the vendor's `/models` endpoint. |

| Factory-only option | Type | Purpose |
| --- | --- | --- |
| `id` | string | Provider id; defaults to `anthropic`. |
| `fetch` | `typeof fetch` | Test seam: the transport every request uses. |
| `userAgent` | string | Sent as `user-agent` on every request (provider-owned). |

Featured offline aliases: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`. `models()` returns the configured `models` array when set; otherwise it calls `listAnthropicModels()` (`GET {baseUrl}/models`) — only when `agent.models.list()` runs, never during setup.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Stream | Prism text, thinking deltas, tool-call delta/final, usage (incl. cache read/create when present), `done`, redacted `error`. |
| Cache | Featured models use `cache.kind: "cache_control"`; markers on selected breakpoints (`long` → `ttl: "1h"`). A `system_prompt` breakpoint serializes `system` as native text blocks with the marker (plain string otherwise). |
| Thinking | Model-family aware (`adaptive` vs `enabled`+`budget_tokens`); helpers `anthropicThinking` / `anthropicEffort` / `anthropicPreserveThinking`. |
| Auth | `api_key` for provider id; provider-owned `content-type`, `x-api-key`, `anthropic-version` win over caller headers. No OAuth descriptor or subscription adapter is registered. |

## Request/response example

```json
{
  "model": "claude-sonnet-5",
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Hello" }] }],
  "stream": true,
  "max_tokens": 1024
}
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import anthropic from "@arnilo/prism-provider-anthropic";

const agent = await createAgent({
  model: { provider: "anthropic", model: "claude-sonnet-5" },
  packages: [anthropic({ apiKey: "env:ANTHROPIC_API_KEY" })],
});

const models = await agent.models.list(); // discovery runs only here
await agent.dispose();
```

## Extension and configuration notes

- Register by listing the package in `createAgent({ packages: [...] })`; there is no auto-discovery.
- The package formerly exported `createAnthropicProviderPackage`; that helper is retired — the package now ships the default package export plus the `anthropic(...)` factory.
- AI SDK (`@arnilo/prism-provider-ai-sdk`) remains an escape hatch, not the primary Anthropic path.
- Live smoke: `PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY`.
- Anthropic says OAuth is for purchasers' ordinary Claude Code/native-app use; developers building products must use Claude Console API keys or a supported cloud provider and may not offer Claude.ai login or route Free/Pro/Max credentials ([legal and compliance](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance)). Prism therefore has no Anthropic subscription OAuth API or token-import shortcut.

## Request construction (0.5.1)

Agent sessions stamp `sessionId`/`cacheKey` without a host policy. Session/cache keys are correlation ids, never secrets.

| | |
| --- | --- |
| P1 session wire | `x-client-request-id` from `sessionId` |
| Mandatory | no |
| P2 default cache | `cache_control` on `system_prompt` + `last_stable_message`; `cacheRetention: "short"` |

See [Provider request policies](../provider-request-policies.md).

## Security and performance notes

- No network during import/setup/default tests; credentials host-owned and late-bound.
- Provider-owned auth headers cannot be overridden by caller headers.
- Media/SSRF bounds reuse `@arnilo/prism/provider-kit` / transport helpers.
- Offline conformance: `@arnilo/prism/provider-kit`.

## Thinking and reasoning

Anthropic models route through the `output_config_effort` family: the adapter merges `compat.output_config.effort` (from `applyThinkingLevelForModel`) and the provider emits `output_config: { effort }` on Messages bodies. Declared levels per generation (from `capabilities.thinkingLevels`): Opus 4.8/4.7, Sonnet 5, Fable/Mythos 5, Opus 5 accept `low`–`max` incl. `xhigh`; Mythos Preview, Opus 4.6, Sonnet 4.6 accept `low/medium/high/max`; Opus 4.5 accepts `low/medium/high`; Haiku 4.5 declares `none`–`high` (upstream effort support undocumented — live-probe pending). Undeclared levels snap to the nearest declared level (ladder distance, ties up); values below the minimum snap up. Thinking type: `adaptive` on 4.6+/Sonnet 5/Fable/Mythos (bare `enabled` maps to `adaptive`); legacy 4.5 models get `enabled` plus a `budget_tokens` default of 10000 when absent. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [Provider packages](../provider-packages.md): package setup + discovery contract.
- [Provider caching](../provider-caching.md): `cache_control` breakpoints.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable thinking helpers.
- [Provider conformance](../provider-conformance.md): network-free assertions.
- Package README: [`@arnilo/prism-provider-anthropic`](../../packages/providers/anthropic/README.md)
