# Providers — adapters, requests, cache, thinking, usage

Provider registration, request construction, cache hints, thinking levels, usage
mapping, vendor adapter subpaths.

## Docs (current contracts)

- [provider-layer.md](../../../../docs/provider-layer.md): register providers/models, duplicate policy, streaming, mock provider.
- [provider-packages.md](../../../../docs/provider-packages.md): `@arnilo/prism-providers/<adapter>` subpath rules, package construction.
- [provider-request-policies.md](../../../../docs/provider-request-policies.md): kernel defaults, `ProviderRequestPolicy` overlays.
- [provider-caching.md](../../../../docs/provider-caching.md): `PromptCacheHints`, breakpoints, per-provider cache matrix.
- [thinking-and-reasoning.md](../../../../docs/thinking-and-reasoning.md): `thinkingLevel` snapping and per-family legality.
- [model-registry.md](../../../../docs/model-registry.md): `ModelConfig` capabilities, limits, cost, cache metadata.
- [provider-primitives.md](../../../../docs/provider-primitives.md): shared bounded transport + OpenAI serialization helpers.
- [use-case-model-selection.md](../../../../docs/use-case-model-selection.md): model binding for compaction/memory jobs.

Vendor adapter pages live at `docs/providers/<adapter>.md` — read only when the
task names that vendor.

## Graft queries

- `graft ask "map usage provider wire to Usage" --source`
- `graft ask "provider request options cache breakpoints" --source`
- `graft grep "cacheWriteTokens"`

## Tests

- `packages/prism-providers/src/**/__tests__/` (per-adapter suites run from the workspace dir)
- `src/__tests__/providers.test.ts`, `provider-request-policy.test.ts`, `thinking.test.ts`, `cache-helpers.test.ts`

## Don't do

- Don't add math to usage mapping — copy provider wire numbers; only Google folds `thoughtsTokenCount` into total.
- Don't normalize inclusive-vs-exclusive cache tokens across vendors.
- Don't import one adapter from another; subpath imports never evaluate siblings.

Adjacent: `embeddings.md`, `speech.md`, `image-generation.md`, `moderation.md`, `batch-jobs.md` (same contract shape per modality), `providers/openai-compatible.md` (base class).
