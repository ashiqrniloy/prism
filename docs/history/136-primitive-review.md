# Prism Code home, providers, and credentials primitive review (plan 136 Task 1)

Plan: [136-Prism-Code-Home-Providers-Credentials.md](../../plans/136-Prism-Code-Home-Providers-Credentials.md) Task 1
Date: 2026-09-27
Baseline: `@arnilo/prism` 0.12.0, `@arnilo/prism-core` 0.12.0, `@arnilo/prism-code` 0.12.0, `@arnilo/prism-providers` 0.12.0, Bun 1.4.2
Scope: read-only primitive inventory for the `~/.prism` home, config layering, credential stores, and provider/model resolution. No package change. Findings drive Tasks 2–7.

## 1. Verdict

Three generic gaps are real and must ship in `prism-core`; the rest are app-level fixes in `packages/prism-code`. No new core abstraction for provider lifetimes, OAuth refresh policy, or config layering is justified — only one host needs them, and the existing seams already carry the values.

| Gap | Status | Decision |
| --- | --- | --- |
| (a) Plaintext `0600` file-backed `StoredCredentialStore` in `@arnilo/prism-core/credentials/node` | Confirmed absent. Both existing stores are keychain (no list, no plaintext) and encrypted file (needs a passphrase). | Add `createFileCredentialStore({ path })` in `file-store.ts`. Reuses `parseVault`/`serializeVault`, `atomicWriteFile`, `readFileIfExists` (which already rejects group/other-readable files), and the vault byte limits. |
| (b) Keychain availability probe without a write | Confirmed absent. `createKeychainCredentialStore` performs no IO, so "is the backend usable?" is only discoverable by a per-call failure. | Add `probeKeychainAvailability({ service })` in `keychain-store.ts`. Reads a sentinel account through the existing `runKeychainOperation` timeout/error mapping; never writes. |
| (c) Pre-resolved provider cache in the app because `providerSource` is synchronous | Confirmed. `ProviderResolver = (model) => AIProvider \| undefined` (`src/contracts-core/provider.ts:118`); async credential resolution cannot happen inside it. | App-level `ActiveSelection` provider cache in `packages/prism-code` (Task 7). Core stays synchronous. |

Everything else the plan names already exists and is sufficient:

- Async credential resolution needs no core change — provider options already accept `CredentialValueSource` and resolve per request (`resolveCredentialValue`, `src/credentials.ts:125`; e.g. Anthropic `provider.ts:45`, `apiKey?: CredentialValueSource`).
- Expiry-aware refresh, single-flight, and status display are policy, not storage. `refreshOAuthCredential`/`revokeOAuthCredential` plus `createOAuthCredentialStoreAdapter` are the seam; the loop lives in prism-code (Task 5).
- Config layering, home resolution, `state.json`, env auto-detection, and `/provider` status are prism-code concerns. `prism-core` exposes no config or home primitive and should not gain one.

## 2. Credential primitives

### `StoredCredentialStore` (`packages/prism-core/src/credentials/node/encrypted-store.ts:22`)

The shape both stores implement: `resolve`/`get`/`set`/`delete` for API-key records, `setOAuth`/`getOAuth`/`deleteOAuth` for OAuth entries, and `list`/`listOAuth`. All methods may be sync or async.

- Can: serve as the single store interface for `createStoredCredentialResolver` and `createOAuthCredentialStoreAdapter`.
- Cannot: be listed by the keychain implementation; `get` keyed only by `{ name, provider }` returns a single `Credential` (`.value` holds the secret). It has no availability concept, so a store outage is indistinguishable from a missing credential at this layer.

### `createKeychainCredentialStore` (`keychain-store.ts:66`)

- Can: `get`/`set`/`delete`/`getOAuth`/`setOAuth`/`deleteOAuth` against the OS secret service, keyed by account name derived from `credentialKey(name, provider)` / `oauthKey(provider, accountId)` (`vault.ts:8,12,16`). Each account holds a serialized vault JSON payload; `runKeychainOperation` bounds every call by `timeoutMs` (default 5000, hard cap 30000) and maps native failures to `CredentialStoreLockedError` / `CredentialStoreTimeoutError` / `CredentialStoreUnavailableError`.
- Cannot: `list()`/`listOAuth()` throw `CredentialStoreUnavailableError` by design — status UIs must probe per credential. It exposes no availability check and the factory does no IO, so construction cannot detect a broken backend. A missing payload returns `undefined` (treated as not-found, not an error), which is what makes gap (b) probeable without a write.
- `readVaultForKey` already treats a falsy payload as "no entry" (`keychain-store.ts:80`) — a probe can reuse exactly this path against a sentinel account name.

### `createEncryptedCredentialStore` / `openEncryptedCredentialStore` (`encrypted-store.ts:69`, `:147`)

- Can: full `StoredCredentialStore` including `list`/`listOAuth`, `reload()`, `flush()`; AES-256-GCM envelope with scrypt KDF, atomic `0600` writes, versioned on-disk format, bounded by `maxFileBytes`/`maxVaultBytes`/`maxScryptMemoryBytes`. `openEncryptedCredentialStore` adds the initial `reload()`; the plain factory starts with an empty in-memory vault and reads nothing until `reload()`.
- Cannot: operate without a passphrase callback on every load and persist; there is no cached unlock or OS-bound key (deliberate — a machine-derived key would sit next to the ciphertext). `rotateEncryptedCredentialStorePassphrase` exists for rotation.
- Task 3 uses `openEncryptedCredentialStore` for `credentials.enc`; no change needed.

### `createStoredCredentialResolver` (`resolver.ts:4`)

- Can: adapt any `StoredCredentialStore` to the core `CredentialResolver` seam (`resolve(request) → store.get(request)`), including the async keychain/file stores.
- Cannot: chain environment variables or express precedence; callers compose chains themselves (prism-code Task 4). This is the right primitive for the manager's resolver once the `provider: "prism-code"` key mismatch is removed.

### `createOAuthCredentialStoreAdapter` (`resolver.ts:17`)

- Can: adapt a store to `ExtendedOAuthCredentialStore` (`set`/`get`/`delete`), which satisfies `RevocableOAuthCredentialStore` for `revokeOAuthCredential`.
- Cannot: carry an `accountId` through `set` — `OAuthCredentialStore.set(provider, credentials)` has no account argument (`src/contracts-core/resources.ts:51`). `refreshOAuthCredential` therefore persists single-account providers correctly (OpenAI Codex, xAI), but a multi-account provider would need its own wrapper. prism-code is single-account; acceptable.

### `refreshOAuthCredential` / `revokeOAuthCredential` (`src/credentials.ts:91`, `:111`)

- Can: `refreshOAuthCredential` calls `provider.refresh` when present and persists the result through the store; `revokeOAuthCredential` attempts upstream revoke (best-effort) then requires a local store delete, so a failed upstream revoke never leaves a usable token.
- Cannot: check expiry, deduplicate concurrent refreshes, or retry on 401. Those are the Task 5 helper (`createOAuthTokenSource`) in prism-code. `revokeOAuthCredential` already deletes via `store.delete(provider.id, credentials.accountId)`, matching the adapter.

### `CredentialValueSource` (`src/credentials.ts:11`)

`string | (() => string | undefined | Promise<string | undefined>) | CredentialResolver`. Every shipped provider adapter takes `apiKey?: CredentialValueSource` and resolves it at request time through `resolveCredentialValue` (`src/credentials.ts:124`). An async function source is therefore sufficient for both stored API keys and refreshed OAuth access tokens — no core change and no secret copied into a config object.

### `createMemoryCredentialStore` (`src/credentials.ts:32`)

Memory-only, process-lifetime, no persistence; `allowProviderFallback` defaults to serving a providerless record to every provider. Suitable as the explicit "don't save" session store, never as a silent keychain failure fallback.

## 3. Run and provider resolution seams

- `RunOptions.model`, `RunOptions.providerSource`, `RunOptions.thinkingLevel` all exist (`src/contracts-protocol.ts:87-93`) and are per-run. `thinkingLevel` overrides `AgentConfig.thinkingLevel`.
- Core resolution order is `agent.config.provider ?? options.providerSource?.(model) ?? agent.config.providerSource?.(model)` (`src/agent-session/session.ts:641`). An agent built with a concrete `provider` shadows every per-run `providerSource` — prism-code's `assembleAppAgent` currently passes `provider` (`packages/prism-code/src/headless.ts:95-97`), so `/model` cannot take effect (Task 7 fixes both, and ACP must be checked for the same shape).
- `ProviderResolver` is synchronous (`src/contracts-core/provider.ts:118`), so the provider instance must exist before the run call; async credential resolution and async provider imports happen when the cache entry is built (gap (c)).

## 4. Provider catalogs, discovery, and OAuth

- `@arnilo/prism-providers/model-discovery`: `createOpenAiCompatibleModelDiscovery` and `createGoogleModelDiscovery` (TTL-cached, bounded responses, `CredentialValueSource` auth) and `mergeModelCatalog(models, catalog)` which overlays host catalog entries by model id. It covers OpenAI-compatible and Google listings only; it is not a universal per-provider discovery layer.
- Provider catalog data already carries the Task 7 enrichment fields: `ModelConfig.limits.contextWindow`, `limits.maxOutputTokens`, and `capabilities.thinkingLevels` (e.g. `packages/prism-providers/src/anthropic/models.ts:179-183`, `:201-238`). prism-code's current source for this is `listModelsForProvider` (live discovery per provider) plus `getStaticModelsForProvider` static catalogs, both in `packages/prism-code/src/providers.ts`. The latter reads catalogs through `(mod as any).xModels` (`providers.ts:439-468`) — typed imports are part of Task 4's cleanup.
- OAuth providers: `openAICodexOAuthProvider` (JSON-body refresh, PKCE + device code, bearer `getCredential`; exported `packages/prism-providers/src/openai/index.ts:87`) and `createXaiOAuthProvider` (form-body refresh, device code only, best-effort `revoke`, refresh-skew of 300 s baked into parsing; exported `packages/prism-providers/src/xai/index.ts:48`). Both satisfy `OAuthProvider` and need no provider-package change.
- Anthropic ships no OAuth provider in `@arnilo/prism-providers` (API key only). Plan 136 does not add one; `/provider` must not offer Anthropic OAuth.

## 5. prism-code app layer today

- `PrismCodeCredentialManager` (`packages/prism-code/src/credentials.ts`): constructor picks `createKeychainCredentialStore` whenever `disableKeychain` is false. The `try/catch → MemoryStoredCredentialStore` fallback is dead code — the factory does no IO and cannot throw for an unavailable backend — so the analysis's "silent in-memory fallback" is really "silent per-call failure": `getApiKey`/`hasCredentials` swallow store errors and continue to env-only (`credentials.ts:144`, `:207`). Task 3 deletes the fallback and makes store choice explicit.
- `createResolver()` (`credentials.ts:224-238`) is synchronous, reads `process.env[ref]` first, then calls `(store as any).resolve?.({ name: ref, provider: "prism-code" })`. The key is wrong (writers use the real provider id, not `"prism-code"`) and any keychain/file resolve returns a Promise that is never awaited, so `.value` is always `undefined`. Stored keys are effectively invisible to the resolver. Task 3/4 replace this with the async manager API.
- `resolveProvider`/`hasUsableProvider`/`resolveCredential` (`providers.ts:232`, `:246`, `:487+`) are synchronous and env-only; `hasUsableProvider` also requires `config.model.provider`, so env vars alone never enable startup. Factory bugs confirmed: Azure defaults to `https://example.azure.com` (`providers.ts:665`), Bedrock calls `(mod as any).createBedrockProvider` (the OpenAI-compatible route) instead of the native `createBedrockConverseProvider` (`packages/prism-providers/src/bedrock/provider.ts:76`, `:132`), and Vertex/typesafe/laya/hyper also go through `(mod as any)` without checking the export list.
- `/provider` sets the literal model `"default"` (`tui/commands.ts:331-333`) and its API-key branch only prompts when `context.promptSecret` is provided — which the TUI never wires. OAuth login (`commands.ts:473+`) is invoked only when `!isAuthed`, so re-auth cannot refresh an existing entry.
- First run: the TUI branch prints guidance and returns (`bin/prism-code.ts:80-87`); headless exits 1 via the sync `hasUsableProvider` check (`bin/prism-code.ts:109-112`). `--version` prints the literal `"0.12.0"` (`bin/prism-code.ts:50-52`).
- OM: `ObservationalMemoryCoordinator.getOrAttach` resolves the worker provider with `resolveProvider(model, config.credentialRef, credentialManager?.createResolver())` (`observational-memory.ts:248`), i.e. through the broken resolver; `headless.ts` constructs the coordinator without a credential manager (defaults absent), so TUI/headless/ACP/OM can each hold different managers. Task 3 threads one manager.

## 6. Trust model (fixed by this plan)

| Store | At-rest protection | Availability rule |
| --- | --- | --- |
| OS keychain (`createKeychainCredentialStore`) | OS secret service; no Prism-managed plaintext | Preferred whenever the probe succeeds. No silent fallback away from it. |
| Owner-only file (`createFileCredentialStore`, new) | Plaintext JSON at `0600` under a `0700` home; group/other bits refused on read | Used only after the user explicitly chooses it (recorded in `state.json`). Plaintext-at-rest trade-off documented. |
| Encrypted file (`openEncryptedCredentialStore`) | AES-256-GCM + scrypt; passphrase per launch | Used only when configured or chosen; passphrase from `PRISM_CREDENTIALS_PASSPHRASE` or the masked prompt. |
| Memory (`createMemoryCredentialStore` / prism-code `MemoryStoredCredentialStore`) | Process lifetime only | Explicit "don't save (this session only)" choice. Never an automatic fallback. |

Rules: the app never moves a credential between stores implicitly; env vars are never written to a store implicitly; a configured env var remains an override above stored values (`credentialRef` env → stored key → stored OAuth → provider env vars); secrets never enter argv, logs, events, TUI history, or `state.json`/`config.json`.

## 7. Rulings carried into Tasks 2–7

1. Task 2: home resolution, layered merge, and `state.json` are prism-code-only. `config.ts` keeps the fail-closed validator; the layer merge is a pure function over already-parsed objects. No core home/config primitive.
2. Task 3: add only `createFileCredentialStore` and `probeKeychainAvailability` to `@arnilo/prism-core/credentials/node`; reuse `vault.ts`, `file-io.ts`, and `limits.ts` rather than a new format. Regenerate the compat baseline (`node scripts/release.mjs gate --update-baseline`) because the subpath exports grow.
3. Task 4: keep provider descriptors in one table; resolve credentials asynchronously and pass `CredentialValueSource` functions into adapters (already supported). Env auto-detection and `/provider` status are app logic.
4. Task 5: `createOAuthTokenSource` (expiry window, single-flight, persist-on-refresh, redacted failures) is prism-code policy over `refreshOAuthCredential`/`revokeOAuthCredential`. Do not add expiry/single-flight to core.
5. Task 7: the provider cache is an app-level map keyed by provider id; `providerSource` stays synchronous. Build agents with `providerSource` (never a concrete `provider`) so the run override is not shadowed.
6. `list()`/`listOAuth()` on the keychain store stay unsupported; `/provider` status and `hasUsableProvider` query per provider. Do not add listing to the keychain primitive.
7. Plaintext file-store reads reuse `readFileIfExists`, which already fails closed on permissive modes and enforces `maxVaultBytes` — no new permission or size logic.
