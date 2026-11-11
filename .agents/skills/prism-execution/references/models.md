# Models — model core, providers, credentials

Kernel model communication (the `ModelProvider` contract, registry, `ModelRef`, streaming normalization, retry, usage, the built-in `openai-compatible` provider, `models.client`), `@arnilo/prism/provider-kit`, provider packages, the credentials slot, OAuth, and the keyring.

## Target

- [roadmap.md](../../../../roadmap.md) §2.1 (Models and Credentials rows), §2.9 (provider and `credentials-keyring` rows). Built in roadmap Phase 5.
- **Built-in provider:** a host with no provider package can still reach any OpenAI-compatible endpoint through the kernel's `openai-compatible` provider.
- **Provider packages:** each one lives at `packages/providers/<vendor>` and registers through `prism.providers.register`.
- **Model refs:** a `ModelRef` is `"vendor/model"` or `{ provider, model, options }`.
- **Provider cache:** one per agent, so a per-run `RunOptions.model` switches provider as well. A fixed provider must never shadow a per-run switch (the deleted Prism Code lab shipped this bug).
- **Credentials:** the kernel ships only the `env:NAME` resolver; `credentials-keyring` fills the slot. OAuth is a provider package's auth method. It talks to the person through `host.ui` (`open-url`, `input`), stores tokens through the credentials slot, and never opens a browser itself.
- **Discovery:** `agent.models.list()` returns `[]` rather than throwing when no package offers discovery.
- **Shipped providers (owner decision 2026-10-16):** 0.13.0 ships only `hyper`, `opencode-go`, `typesafe` (Jev), and `laya`, the providers the owner can test live. Plan 182 deletes the other 17 provider packages and reduces `provider-kit` to the package shell, transport, three codecs (OpenAI Chat, Anthropic Messages, System One), `createRoutedProvider`, the cache planner, one usage contract, and conformance; plan 183 rebuilds the four on it. Do not add work to a provider package plan 182 deletes.

## Today

- Model core: `src/models/{registry,providers,ref,builtin,retry,events,estimate}.ts` (`ModelRef` parsing, the provider registry, the built-in `openai-compatible` provider, retry, usage estimation); contracts in `src/contracts-core/{provider,usage}.ts`.
- Credentials slot default: `src/credentials/{env,errors,index}.ts` (the `env:NAME` resolver). `src/credentials/legacy.ts` holds the migration-era `CredentialValueSource`, which plan 185 Task 3 retires in favor of `SecretSource`.
- `@arnilo/prism/provider-kit`: `src/provider-kit/` — today still the full 0.12-era set (`openai-compatible`, `openai-primitives`, `anthropic-messages`, `systemone*`, `transport`, `cache-helpers`, `provider-request-policy`, `conformance`, plus `openai-responses`, `openai-*`, `oauth*`, `image-generation`, `model-discovery`, which plan 182 deletes). After plan 182 the kept modules are grouped as `package`, `transport`, `codecs/{openai-chat,anthropic-messages,systemone}`, `routed-provider`, `cache`, `usage`, `conformance`, `wire-replay`.
- Provider packages: `packages/providers/<vendor>/` (21 today; 4 after plan 182). The keyring credentials slot: `packages/extensions/keyring`.
- Current docs: [models.md](../../../../docs/models.md), [provider-kit.md](../../../../docs/provider-kit.md), [credentials-and-redaction.md](../../../../docs/credentials-and-redaction.md), [providers/README.md](../../../../packages/providers/README.md), [`keyring`](../../../../packages/extensions/keyring/README.md). Each provider documents itself in `packages/providers/<vendor>/README.md`; read one only when the task names that vendor.

## Graft queries

- `graft ask "map usage provider wire to Usage" --source`
- `graft ask "provider cache prime seed per-run model switch" --source`
- `graft ask "oauth token source refresh credential resolver" --source`
- `graft grep "cacheWriteTokens"`

## Tests

- `packages/providers/<vendor>/src/__tests__/` (run from the package directory). Cross-vendor walks: `scripts/provider-{toolcall,thinking}-conformance.test.mjs`, `provider-tool-result-wire.test.mjs`, `provider-discovery-gate.test.mjs` (plan 182 Task 1 decides which survive).
- Kernel: `src/__tests__/model-ref.test.ts`, `providers.test.ts`, `provider-cache.test.ts`, `retry.test.ts`, `retry-http.test.ts`, `model-less-agent.test.ts`, `model-discovery.test.ts`, `usage-estimation*.test.ts`, `credentials-slot.test.ts`, `credentials-redaction.test.ts`
- Provider kit: `provider-kit.test.ts`, `provider-transport.test.ts`, `openai-compatible.test.ts`, `anthropic-messages.test.ts`, `cache-helpers.test.ts`, `provider-request-policy.test.ts`, `thinking.test.ts`, `provider-conformance.test.ts`
- Live: `bun run test:live` (`scripts/live-matrix.mjs`) with keys from `~/.config/prism/live.env`; never ask for a key in chat.

## Rules

- Usage: until plan 182 Task 4 lands, copy usage numbers from the provider wire. After it, `Usage.inputTokens` is the total prompt token count on every codec, with cache reads and writes as subsets; `cacheHitRate` and the cost formula follow that rule.
- A provider package never imports a sibling provider. Shared code goes in `provider-kit`.
- Resolve credentials only at the provider edge. Secrets never appear in `ModelRequest`, events, or errors.
- Other modalities (speech, embeddings, image, moderation, batch, realtime) are owned by the package that needs them (for example `memory-rag` owns embeddings). They do not enter the kernel model core.

Adjacent: [use-case-model-selection-0.12.md](../../../../docs/history/use-case-model-selection-0.12.md) (archived side-model binding; the target is `models.client`). The built-in OpenAI-compatible provider is in [models.md](../../../../docs/models.md).
