# Models — model core, providers, credentials

Kernel model communication (the `ModelProvider` contract, registry, `ModelRef`, streaming normalization, retry, usage, the built-in `openai-compatible` provider, `models.client`), `@arnilo/prism/provider-kit`, provider packages, the credentials slot, OAuth, and the keyring.

## Target

- [roadmap.md](../../../../roadmap.md) §2.1 (Models and Credentials rows), §2.9 (provider and `credentials-keyring` rows). Built in roadmap Phase 5.
- **Built-in provider:** a host with no provider package can still reach any OpenAI-compatible endpoint through the kernel's `openai-compatible` provider.
- **Provider packages:** each one lives at `packages/providers/<vendor>` and registers through `prism.providers.register`.
- **Model refs:** a `ModelRef` is `"vendor/model"` or `{ provider, model, options }`.
- **Provider cache:** one per agent, so a per-run `RunOptions.model` switches provider as well. A fixed provider must never shadow a per-run switch; Prism Code already hit this bug.
- **Credentials:** the kernel ships only the `env:NAME` resolver; `credentials-keyring` fills the slot. OAuth is a provider package's auth method. It talks to the person through `host.ui` (`open-url`, `input`), stores tokens through the credentials slot, and never opens a browser itself.
- **Discovery:** `agent.models.list()` returns `[]` rather than throwing when no package offers discovery.

## Today (0.12 code being replaced)

- Contracts: `src/contracts-core/provider.ts` (`AIProvider`, `ProviderResolver`, `ProviderRequest`), `src/providers.ts`, `src/models.ts`, `src/provider-events.ts`, `src/retry.ts`, `src/thinking.ts`, `src/usage-estimation.ts`.
- Shared wire → `provider-kit`: `src/providers/{openai-compatible,openai-primitives,transport,schema,media}.ts`.
- Vendors → provider packages: `packages/providers/<vendor>/` (21 standalone `@arnilo/prism-provider-<vendor>` packages; the retired `packages/prism-providers` family is deleted in plan 152 Task 8).
- Credentials: `src/credentials.ts`, `src/oauth-device-code.ts`, `packages/prism-core/src/credentials/`.
- Lab resolution being deleted: `packages/prism-code/src/{providers.ts,oauth.ts,credentials.ts}`.
- Current docs (released contract): [provider-layer.md](../../../../docs/provider-layer.md), [provider-packages.md](../../../../docs/provider-packages.md), [provider-primitives.md](../../../../docs/provider-primitives.md), [provider-request-policies.md](../../../../docs/provider-request-policies.md), [provider-caching.md](../../../../docs/provider-caching.md), [thinking-and-reasoning.md](../../../../docs/thinking-and-reasoning.md), [model-registry.md](../../../../docs/model-registry.md), [credentials-and-redaction.md](../../../../docs/credentials-and-redaction.md), [credential-storage.md](../../../../docs/credential-storage.md). Vendor pages live at `docs/providers/<vendor>.md`; read one only when the task names that vendor.

## Graft queries

- `graft ask "map usage provider wire to Usage" --source`
- `graft ask "provider cache prime seed per-run model switch" --source`
- `graft ask "oauth token source refresh credential resolver" --source`
- `graft grep "cacheWriteTokens"`

## Tests

- `packages/providers/*/src/__tests__/` (run from the package directory); the cross-vendor conformance walks live in `scripts/provider-*.test.mjs`.
- `src/__tests__/providers.test.ts`, `provider-request-policy.test.ts`, `thinking.test.ts`, `cache-helpers.test.ts`
- Provider conformance: `@arnilo/prism/testing/provider-conformance` today; `provider-kit` in the target

## Rules

- Copy usage numbers from the provider wire. Only Google folds `thoughtsTokenCount` into the total.
- Do not normalize inclusive vs exclusive cache tokens across vendors.
- A provider package never imports a sibling provider. Shared code goes in `provider-kit`.
- Resolve credentials only at the provider edge. Secrets never appear in `ModelRequest`, events, or errors.
- Other modalities (speech, embeddings, image, moderation, batch, realtime) are owned by the package that needs them (for example `memory-rag` owns embeddings). They do not enter the kernel model core.

Adjacent: [use-case-model-selection.md](../../../../docs/use-case-model-selection.md) (side-model binding; the target is `models.client`), [providers/openai-compatible.md](../../../../docs/providers/openai-compatible.md).
