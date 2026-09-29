# Prism Code: User Home, Provider Connection, and Credentials

## Objectives

- Give Prism Code a user-level home at `~/.prism` (overridable with `PRISM_HOME`) that holds global config, remembered selections, durable credentials, sessions, installed binaries, and the global `agent/` content tree (skills and instructions; consumed by plan 137).
- Make provider connection work end-to-end from a clean machine: first launch onboards through `/provider`, API keys typed into the TUI are stored durably, OAuth logins (OpenAI Codex, xAI) are persisted, refreshed, and actually used by runs.
- Make `/provider`, `/model`, and Shift+Tab effort selection change the model that real runs, `/compact`, and observational memory (OM) use, and remember the selection across launches.
- Remove the credential-path inconsistencies found in the 0.12.0 analysis: env-only resolution, the OM resolver key mismatch, multiple credential-manager instances, and silent in-memory fallback.

## Expected Outcome

- `~/.prism/` layout exists on first launch (created lazily, `0700`):
  ```text
  ~/.prism/
    config.json        # global prism-code config (same schema as prism-code.json; project file wins per key)
    state.json         # app-written: last provider/model/effort, credential-store choice
    auth.json          # only when the user chose the file credential store (0600)
    sessions/          # plan 138
    bin/               # plan 140 curl installer target
    agent/             # plan 137: skills/, AGENTS.md
  ```
- Launching `prism-code` with no config and no env keys opens the provider picker instead of exiting; after entering a key (masked) the TUI is immediately usable and the next launch restores the same provider/model without prompting.
- With `ANTHROPIC_API_KEY` (or any known provider env var) set and no config, Prism Code auto-selects that provider and its catalog default model in both TUI and headless modes.
- `/model` and `/provider` switch the model used by the next run, `/compact`, and OM workers; Shift+Tab effort reaches the provider as `thinkingLevel`.
- Stored API keys and OAuth tokens live in the OS keychain when available; otherwise in a store the user explicitly chose (never a silent in-memory fallback). OAuth access tokens refresh automatically before expiry.
- One `PrismCodeCredentialManager` per process, shared by TUI, headless, ACP, `/compact`, and OM.
- `docs/prism-code.md` documents the home layout, config layering, credential stores, and provider login; `docs/index.md` entry updated.
- Depends on: plan 135 (Prism Code app, complete). Blocks: plans 137–140.

## Tasks

- [x] Task 1 (P0 prerequisite): Primitive review for home, config layering, credentials, and provider resolution
  - Acceptance Criteria:
    - Functional: record at `docs/history/136-primitive-review.md` inventories existing primitives and states what each can and cannot do for this plan: `createKeychainCredentialStore`, `createEncryptedCredentialStore`/`openEncryptedCredentialStore`, `StoredCredentialStore`, `createStoredCredentialResolver`, `createOAuthCredentialStoreAdapter`, `refreshOAuthCredential`/`revokeOAuthCredential`, `CredentialValueSource`, `RunOptions.model`/`providerSource`/`thinkingLevel`, `@arnilo/prism-providers/model-discovery`, provider catalog data, `openAICodexOAuthProvider`, `createXaiOAuthProvider`, and prism-code `PrismCodeCredentialManager`/`resolveProvider`/`hasUsableProvider`.
    - Functional: the record lists every generic primitive gap with a decision. Expected gaps to confirm or refute: (a) a plaintext `0600` file-backed `StoredCredentialStore` in `@arnilo/prism-core/credentials/node`; (b) a way to probe keychain availability without a write; (c) whether `providerSource` being synchronous requires a pre-resolved provider cache in the app (expected: yes, app-level, not core).
    - Performance: none (review only).
    - Code Quality: gaps that are app-specific stay in `packages/prism-code`; only store/probe primitives that other hosts would reuse go to `prism-core`.
    - Security: the record states the trust model for each store (keychain, encrypted file, plaintext `0600` file) and the rule that the app never falls back between them silently.
  - Approach:
    - Documentation Reviewed:
      - `docs/credential-storage.md` (factories, "no silent fallback from keychain to plaintext file storage")
      - `docs/credentials-and-redaction.md`
      - `packages/prism-core/src/credentials/node/{keychain-store,encrypted-store,resolver,vault}.ts`
      - `src/credentials.ts:11` (`CredentialValueSource`), `src/credentials.ts:91` (`refreshOAuthCredential`)
      - `src/contracts-protocol.ts:87-88` (`RunOptions.model`, `providerSource`)
      - `packages/prism-providers/src/model-discovery/index.ts`, `packages/prism-providers/src/openai/{codex,oauth}.ts`, `packages/prism-providers/src/xai/oauth.ts`
      - `packages/prism-code/src/{credentials,providers}.ts`, `packages/prism-code/bin/prism-code.ts`
    - Options Considered:
      - Put all fixes inside prism-code. Rejected for the file store: other Prism CLI hosts need the same `0600` store.
      - Add a core "provider cache" primitive. Rejected unless review proves another host needs it; the app owns provider lifetimes.
    - Chosen Approach: primitive-first review; build prism-code behavior on existing credential/OAuth seams and add only the store/probe primitives.
    - API Notes and Examples:
      ```ts
      import { createKeychainCredentialStore, createStoredCredentialResolver } from "@arnilo/prism-core/credentials/node";
      const store = createKeychainCredentialStore({ service: "prism-code" });
      const resolver = createStoredCredentialResolver(store);
      ```
    - Files to Create/Edit:
      - `docs/history/136-primitive-review.md`: review record
    - References:
      - `plans/135-Prism-Code-App.md` Task 2 (credential trust model), create-plan rule 6 (primitive-first)
  - Test Cases to Write:
    - none — review only; findings drive Tasks 2–7.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/136-primitive-review.md` (history archive).
    - `docs/index.md` update: no — history archive.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: `~/.prism` user home, global config layering, and remembered state
  - Acceptance Criteria:
    - Functional: `resolvePrismHome(env)` returns `PRISM_HOME` when set (absolute path required), else `join(os.homedir(), ".prism")`. Directories are created lazily with mode `0700`; files the app writes use `0600`.
    - Functional: config is merged in this order (later wins per top-level key, objects shallow-merged one level): built-in defaults → `~/.prism/config.json` → `<repo>/prism-code.json` (or `--config` path) → CLI flags. Relative paths in the global file resolve against `~/.prism`, in the project file against its directory (existing rule). Both files use the same `parsePrismCodeConfig` schema; unknown keys are rejected in either file.
    - Functional: project-only keys that must not be set globally (`cwd`) are rejected in the global file with a clear error.
    - Functional: `~/.prism/state.json` (app-written, not user config) stores `{ lastModel: { provider, model }, lastEffort, credentialStore }`. It is read at startup when neither config nor flags choose a model, and written on successful `/provider`, `/model`, and effort changes. A corrupt state file is renamed to `state.json.bak` and ignored with a notice, never fatal.
    - Functional: `bin/prism-code.ts` prints the version from `package.json` (compile-time define for the binary build in plan 140), not a literal.
    - Performance: at most two config reads and one state read at startup; no directory walk.
    - Code Quality: home resolution and state IO live in a new `src/home.ts`; `config.ts` receives already-read JSON objects (pure merge + validate); no module-level globals.
    - Security: global config is trusted (user-owned); project config keeps its existing trust boundary. Neither file may contain literal secrets; credential references stay env names or store references. The home dir is refused if it is a symlink to a location not owned by the current user (POSIX `stat.uid` check), with a clear error.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/config.ts` (`parsePrismCodeConfig`, `KNOWN_ROOT_KEYS`, relative-path rules)
      - Node `os.homedir()`, `fs.mkdir({ mode })`, `fs.stat().uid` (Node 26 docs)
      - `packages/prism-core/src/credentials/node/file-io.ts` (atomic write helper reuse)
    - Options Considered:
      - XDG split (`~/.config/prism`, `~/.local/share/prism`). Rejected: user decision is a single `~/.prism` home.
      - Deep-merge config. Rejected: surprising for arrays (`mcp.servers`, `tools.exclude`); per-key replace with one-level object merge is predictable and documented. Arrays that should accumulate across layers (`mcp.servers`, `skills.dirs`) are concatenated explicitly and de-duplicated by id/path.
    - Chosen Approach: one resolver + layered pure merge; state file separate from config so the app never rewrites user-authored config.
    - API Notes and Examples:
      ```ts
      export function resolvePrismHome(env: NodeJS.ProcessEnv = process.env): string {
        const override = env.PRISM_HOME;
        if (override) { if (!isAbsolute(override)) throw new PrismCodeConfigError("PRISM_HOME must be absolute"); return override; }
        return join(homedir(), ".prism");
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/home.ts`: new — `resolvePrismHome`, `ensureHomeDir`, `readGlobalConfig`, `readState`/`writeState`, ownership check
      - `packages/prism-code/src/version.ts`: new — manifest version at runtime, `PRISM_CODE_VERSION` define for plan 140 binaries
      - `packages/prism-code/src/config.ts`: layered merge (`mergePrismCodeConfigLayers`), layer parsers (`validatePrismCodeConfigLayer`, `validateGlobalPrismCodeConfigLayer`, `loadPrismCodeConfigLayer`), global-file key restrictions, array concatenation rules
      - `packages/prism-code/bin/prism-code.ts`: load layers, state fallback, version from manifest, TUI selection-state write callback
      - `packages/prism-code/src/tui/index.ts`: `onSelectionChange` fired after `/provider`, `/model`, and Shift+Tab effort changes
      - `packages/prism-code/src/index.ts`: export `resolvePrismHome`, `resolvePrismCodeVersion`, state/global-config helpers, and the layer-merge helpers
      - `packages/prism-code/src/__tests__/home.test.ts`: new
      - `packages/prism-code/src/__tests__/headless.test.ts`: isolate the spawned CLI binary with `PRISM_HOME`
    - References:
      - Analysis finding "Config is only the project-local `prism-code.json`"; `bin/prism-code.ts:51` hardcoded version
  - Test Cases to Write:
    - `PRISM_HOME` override and relative-path rejection.
    - Layer precedence: global sets `model`, project overrides it, `--model` overrides both.
    - `mcp.servers` from both layers concatenate; a duplicate `serverId` in the project layer replaces the global one.
    - Unknown key in the global file fails closed naming `~/.prism/config.json`.
    - Corrupt `state.json` is backed up and ignored; state writes are `0600`.
    - `--version` prints the manifest version.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new home directory, config layering, `PRISM_HOME`.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: new "User home (`~/.prism`)" and "Config layering" sections
    - `docs/index.md` update: yes — extend the Prism Code entry to mention the `~/.prism` user home and layered config.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Durable credential store selection and a single credential manager
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-core/credentials/node` gains `createFileCredentialStore({ path })`, a `StoredCredentialStore` (API keys + OAuth entries) persisted as JSON with atomic writes, file mode `0600`, and bounded size (reuse `file-io.ts` limits). It also gains `probeKeychainAvailability({ service })`, which returns `available | unavailable` using a read of a sentinel entry and never writes a secret.
    - Functional: prism-code store selection, driven by `credentials.store` in config (`"auto" | "keychain" | "file" | "encrypted-file" | "memory"`, default `"auto"`):
      - `auto`: keychain if the probe succeeds; otherwise the saved choice in `state.json`; otherwise the TUI asks once with a picker ("Save to ~/.prism/auth.json (file, owner-only)", "Encrypted file (passphrase each launch)", "Don't save (this session only)") and records the answer. Headless and ACP never prompt: they use the saved choice or fail with an actionable message only when a credential is actually needed and absent.
      - `encrypted-file`: `~/.prism/credentials.enc` via `openEncryptedCredentialStore`, passphrase from `PRISM_CREDENTIALS_PASSPHRASE` or the masked TUI prompt.
    - Functional: exactly one `PrismCodeCredentialManager` per process, created in `bin/prism-code.ts` and passed to TUI, headless, ACP, `/compact`, and the OM coordinator (`headless.ts:50` currently builds OM without one).
    - Functional: `createResolver()` resolves the same keys `setApiKey` writes (`{ name: "apiKey", provider }`); the OM `credentialRef` lookup (`credentials.ts:230`, `provider: "prism-code"`) is removed in favor of `getApiKey(provider)`.
    - Performance: keychain probe ≤ 1 lookup at startup; it is skipped when `credentials.store` is explicit.
    - Code Quality: no `as any` store access; the manager depends only on the `StoredCredentialStore` interface.
    - Security: the in-memory fallback at `credentials.ts:123` is deleted, and any non-keychain store is used only by explicit choice. The `auth.json` parent dir is `0700`; on read, the file is rejected when group/other permission bits are set (warn and refuse, with a fix-it message). Secrets never appear in logs, errors, TUI history, or session entries. Grep `scripts/`, `examples/`, and every workspace for `MemoryStoredCredentialStore` fallback assumptions and for the retired `provider: "prism-code"` lookup.
  - Approach:
    - Documentation Reviewed:
      - `docs/credential-storage.md`, `packages/prism-core/src/credentials/node/{encrypted-store,keychain-store,file-io,limits}.ts`
      - `@napi-rs/keyring` `AsyncEntry` API (as used in `keychain-store.ts:77`)
    - Options Considered:
      - Silent fallback to plaintext file (what several coding agents do). Rejected: violates the documented Prism rule; the explicit one-time choice keeps the same UX with consent.
      - Encrypted file only. Rejected as the sole fallback: needs a passphrase on every launch; kept as an option.
      - Machine-derived passphrase for the encrypted file. Rejected: security theater, since the key would sit next to the ciphertext.
    - Chosen Approach: keychain first, explicit recorded fallback choice, reusable file store in core.
    - API Notes and Examples:
      ```ts
      const store =
        choice === "keychain" ? createKeychainCredentialStore({ service: "prism-code" })
        : choice === "file" ? createFileCredentialStore({ path: join(home, "auth.json") })
        : choice === "encrypted-file" ? await openEncryptedCredentialStore({ path: join(home, "credentials.enc"), passphrase })
        : new MemoryStoredCredentialStore();
      const credentials = new PrismCodeCredentialManager({ store });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/credentials/node/file-store.ts`: new `createFileCredentialStore`
      - `packages/prism-core/src/credentials/node/keychain-store.ts`: `probeKeychainAvailability`
      - `packages/prism-core/src/credentials/node/index.ts`: exports
      - `packages/prism-core/src/credentials/node/{file-io,encrypted-store}.ts`: `chmod 600` fix-it in the permission error; passphrase errors raised by the store's own callback keep their typed, actionable message
      - `packages/prism-code/src/credentials.ts`: `selectCredentialStore` (explicit → probe → saved → pending TUI choice), `UnavailableStoredCredentialStore`, async `createResolver()`, no silent fallback
      - `packages/prism-code/src/config.ts`: `credentials.store` key
      - `packages/prism-code/src/providers.ts`: `CredentialResolver` may return a Promise; `resolveCredential`/`hasUsableProvider` became async (the resolver must reach async stores)
      - `packages/prism-code/src/{headless,acp,observational-memory}.ts`, `src/tui/index.ts` (+`tui/commands.ts`), `bin/prism-code.ts`: shared manager threading, `onCredentialStoreChoiceNeeded`/`promptCredentialStoreChoice`/`promptSecret`/`notify`, `/provider` masked input
      - `packages/prism-core/src/credentials/node/__tests__/file-store.test.ts`, `packages/prism-code/src/__tests__/credentials.test.ts`, `packages/prism-code/src/__tests__/tui-lifecycle.test.ts`, `packages/prism-code/src/__tests__/{config,flags,providers}.test.ts`
      - `docs/credential-storage.md`, `docs/prism-code.md`, `docs/index.md`
      - `scripts/compat-baseline/{arnilo__prism-core,arnilo__prism-code}.txt`: regenerated from current dist via `extractDeclaredSurface` (core: +9 Task-3 keys and 1 changed line; prism-code baseline is new, 153 entries). Final regeneration matches current dist with 0 removed/changed; the core file also carries unrelated in-flight working-tree exports, and the full `release:gate` runs in Task 8.
    - References:
      - Analysis findings: silent in-memory fallback, OM resolver mismatch, multiple manager instances
  - Test Cases to Write:
    - File store round-trips API keys and OAuth entries, writes `0600`, and refuses a group-readable file.
    - Keychain probe returns `unavailable` under a stub that throws `CredentialStoreUnavailableError`, without writing.
    - `auto` with the probe unavailable and no saved choice → TUI picker is requested; headless → no prompt.
    - A key saved via `/provider` is found by `getApiKey`, `createResolver`, and the OM worker resolver.
    - One manager instance is observed across TUI, `/compact`, and OM (identity assertion in an integration test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new core store factory/probe, new `credentials.store` config key.
    - Docs pages to create/edit:
      - `docs/credential-storage.md`: `createFileCredentialStore`, `probeKeychainAvailability`, and one line on the plaintext-at-rest trade-off (owner-only file vs keychain)
      - `docs/prism-code.md`: "Credentials" section (store choices, `PRISM_CREDENTIALS_PASSPHRASE`)
    - `docs/index.md` update: yes — Credential storage entry mentions the owner-only file store.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Provider resolution through the credential manager, env auto-detection, and adapter fixes
  - Acceptance Criteria:
    - Functional: `resolveProvider(model, credentials)` is async and resolves credentials in this order: explicit `credentialRef` env var → stored API key → stored OAuth (Task 5) → provider env vars (`PROVIDER_ENV_VARS`). `hasUsableProvider` becomes async and uses the same chain, so a key stored via `/provider` makes the next launch usable with no env vars.
    - Functional: with no configured or remembered model, startup auto-detects the first provider with a usable credential in a documented priority order (anthropic, openai, openai-codex, google, xai, openrouter, deepseek, ...) and selects that provider's catalog default model.
    - Functional: provider factory bugs are fixed:
      - Bedrock uses the exported `createBedrockConverseProvider` (`providers.ts:671`).
      - Azure requires `AZURE_OPENAI_ENDPOINT` or config and fails with a clear message instead of `https://example.azure.com` (`providers.ts:665`).
      - Every `(mod as any)` factory call is replaced by a typed import and verified against the adapter's export list.
    - Functional: `/provider` never selects the literal model `"default"` (`commands.ts:333`, `providers.ts:474/487`); it uses the provider's catalog default and then opens `/model`.
    - Performance: provider modules stay lazily imported (one literal `import()` per adapter so the plan 140 binary build can bundle them); credential resolution does at most one store read per provider per startup.
    - Code Quality: one provider descriptor table (id, env vars, auth kinds, factory, default model) drives `/provider`, auto-detection, and resolution; no parallel lists.
    - Security: credentials are passed to adapters as `CredentialValueSource` functions, not copied into config objects that could be logged; env values are never written to the store implicitly.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/providers.ts` (`resolveProvider`, `resolveCredential`, `hasUsableProvider`, factory switch)
      - `packages/prism-providers/src/{bedrock,azure,vertex}/index.ts` export lists
      - `docs/providers*.md` pages for the shipped adapters (existing provider docs in `docs/`)
    - Options Considered:
      - Keep sync resolution and pre-load all stored keys at startup. Rejected: forces keychain reads for every provider.
      - Lazy async resolution per selected provider. Chosen.
    - Chosen Approach: descriptor table + async resolution chain + typed factories.
    - API Notes and Examples:
      ```ts
      const provider = await resolveProvider(
        { provider: "anthropic", model: "claude-sonnet-4-5" },
        { credentialRef: config.credentialRef, resolver: credentials.createResolver(), credentialManager },
      );
      // inside: the manager is the store-first source; the resolver covers explicit refs.
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/providers.ts`: descriptor table now carries `envVars` / `autoDetectPriority` / `defaultModel` / `create`; `resolveCredential`/`hasUsableProvider`/`resolveProvider` took a `ProviderResolutionOptions` object (credentialRef, resolver, credentialManager); `getStaticModelsForProvider` is typed and returns `[]` instead of a fabricated `"default"`; new `defaultModelForProvider` and `autoDetectProvider`; typed factories replace every `(mod as any)` (Bedrock Converse, Azure endpoint/key fail-closed, Vertex project/location)
      - `packages/prism-code/bin/prism-code.ts`: auto-detect when config/flags/state have no model; both usability gates pass the shared manager
      - `packages/prism-code/src/tui/commands.ts`: extracted `applyModelSelection`/`showModelPicker`; `/provider` applies the catalog default then opens `/model` with it first
      - `packages/prism-code/src/{headless,acp,observational-memory}.ts`, `src/index.ts`: new resolution signature + new exports
      - `packages/prism-code/src/__tests__/{providers,flags,headless,tui-commands,credentials}.test.ts`
      - `docs/prism-code.md`: "Providers and models" section + `/provider` row
      - `scripts/compat-baseline/arnilo__prism-code.txt`: regenerated after the export/signature changes (4 added names, 7 changed signatures vs the Task-3 baseline — the package is unreleased, so Task 8 records this as the documented break with the migration note)
    - References:
      - Analysis findings: env-only resolution, Bedrock/Azure bugs, `model: "default"`
    - Execution notes:
      - `/provider` opens the model picker with the *static* catalog (default first) instead of running live discovery, so switching providers never pays the 6 s discovery timeout; `/model` still does live discovery.
      - Auto-detect skips providers with no shipped catalog default (alibaba; openrouter has the documented `openrouter/auto` literal) and never considers ambient/host-setup providers.
      - Bedrock/Vertex read host credentials from env (`AWS_*`, `GOOGLE_PROJECT_ID`); Vertex passes no credential callback and relies on the adapter's ADC failure message.
      - Stored-OAuth resolution is intentionally absent here; `resolveCredential` marks the insertion point for Task 5.
  - Test Cases to Write:
    - Stored key without env var → `hasUsableProvider` true and the provider is constructed. → `flags.test.ts`
    - Env auto-detect picks the first usable provider in priority order with its catalog default model. → `flags.test.ts`
    - Bedrock/Azure/Vertex factories resolve the correct exports; missing Azure endpoint errors clearly. → `providers.test.ts` (+ descriptor defaults exist in catalogs, catalogs never fabricate `"default"`)
    - Headless with `ANTHROPIC_API_KEY` and no config runs (mocked fetch), instead of exiting 1. → `headless.test.ts` (spawned bin with a `--preload` fetch stub)
    - `/provider` selection never yields model id `"default"`. → `tui-commands.test.ts`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider auto-detection and credential precedence.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Providers and models" section (precedence, auto-detect order, per-provider env vars)
    - `docs/index.md` update: no — the Prism Code entry from Task 2 already covers provider setup.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: OAuth login, token refresh, and logout
  - Acceptance Criteria:
    - Functional: for OAuth providers (`openai-codex`, `xai`), the adapter receives an access-token `CredentialValueSource` function that reads the stored `OAuthCredentials`, refreshes via the provider's `refresh` (`refreshOAuthCredential`) when expiry is within 60 s, and persists the refreshed tokens. `OPENAI_ACCESS_TOKEN` env remains an override.
    - Functional: `/logout [provider]` revokes (when the provider supports it) and deletes stored API key/OAuth entries; `/provider` shows per-provider status (`env`, `stored key`, `oauth (expires …)`, `not configured`) without revealing values.
    - Functional: concurrent refreshes are single-flight per provider.
    - Functional: Anthropic stays API-key only; the plan records that no Anthropic OAuth adapter exists in `@arnilo/prism-providers` and does not add one.
    - Performance: no refresh network call when the token is valid; refresh happens at most once per expiry window.
    - Code Quality: refresh logic is a small `createOAuthTokenSource(provider, oauthProvider, credentials)` helper in prism-code, built on core `refreshOAuthCredential`.
    - Security: refresh/revoke errors are redacted with `redactOAuthError`; tokens are never logged or placed in TUI history; a failed refresh keeps previous credentials and shows an actionable "run /provider to log in again" note.
  - Approach:
    - Documentation Reviewed:
      - `src/credentials.ts:91-130` (`refreshOAuthCredential`, `revokeOAuthCredential`), `src/oauth-device-code.ts:72` (`redactOAuthError`)
      - `packages/prism-providers/src/openai/{codex,oauth}.ts`, `packages/prism-providers/src/xai/oauth.ts:58` (`refresh`)
      - `packages/prism-code/src/tui/commands.ts:473-510` (`runOAuthLogin`)
    - Options Considered:
      - Refresh on 401 only. Rejected: first request after expiry fails visibly; proactive refresh with a 401 retry fallback is more robust.
    - Chosen Approach: proactive single-flight refresh inside the credential source. The 401-retry half of the original approach was dropped on purpose: the adapter owns its request path, and prism-code injects only the `CredentialValueSource`, so a retry hook would mean wrapping every adapter; proactive refresh plus serving a not-yet-expired token through a transient failure covers the same ground without adapter surgery. Documented in "Execution notes" below.
    - API Notes and Examples:
      ```ts
      const accessToken = createOAuthTokenSource("openai-codex", openAICodexOAuthProvider, credentials);
      createOpenAICodexProvider({ accessToken });
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/oauth.ts`: `createOAuthTokenSource` (batch/skew/persist/single-flight), `resolveOAuthProvider`, status helpers, `logoutProvider`
      - `packages/prism-code/src/providers.ts`: `ProviderFactoryContext.accessToken`; codex/xai factories use it; stored OAuth counts in `hasUsableProvider` and feeds live model discovery
      - `packages/prism-code/src/tui/commands.ts`: `/logout [provider]`; `/provider` rows show per-provider status
      - `packages/prism-code/src/index.ts`: public exports (oauth helpers, `executeLogoutCommand`)
      - `packages/prism-code/src/__tests__/oauth.test.ts` (new), `src/__tests__/tui-commands.test.ts`
      - `docs/prism-code.md`: OAuth precedence/refresh paragraph, `/provider` status labels, `/logout` row, public surface
      - `scripts/compat-baseline/arnilo__prism-code.txt`: regenerated (+10 names, 2 changed barrel re-export lines; package unreleased)
      - `packages/prism-code/src/__tests__/{headless,oauth}.test.ts`: subprocess tests got explicit timeouts (20–30 s) after the extra subprocess test made the 5 s default flaky under full-suite load
    - References:
      - Analysis finding: "openai-codex treats env apiKey as access token, no refresh; xai OAuth not wired"
    - Execution notes:
      - No Anthropic OAuth adapter exists in `@arnilo/prism-providers` and none was added; Anthropic stays `api_key`-only.
      - OpenAI Codex OAuth ships no `revoke`, so `/logout openai-codex` deletes locally without an upstream call; xAI revokes upstream first (best effort) and deletes locally either way.
      - `refreshOAuthCredential` writes through `manager.setOAuth`, which targets the default account slot — matching where `/provider` login stores tokens.
      - `/provider` statuses are store-first (`oauth` > `stored key` > env) and never print values; with an unavailable store they report `not configured` instead of failing the picker.
  - Test Cases to Write:
    - Expired token triggers exactly one refresh under concurrent requests; the new token is persisted. → `oauth.test.ts` (3 concurrent `source()` calls, `refreshCalls === 1`, store updated)
    - Refresh failure keeps old credentials and surfaces a redacted note. → `oauth.test.ts` (expired → rejects with `Run /provider to log in again`, no token substring; still-valid → keeps serving)
    - `/logout openai-codex` deletes the entry and the next run reports "not configured". → `oauth.test.ts` (unit + status assertion) and `tui-commands.test.ts` (`handleSlashCommand("/logout openai-codex")`)
    - `/provider` status list never contains token substrings. → `oauth.test.ts` and `tui-commands.test.ts` (stream scan)
    - Added: stored OAuth alone makes an OAuth provider usable (`hasUsableProvider`); subprocess e2e refreshes an expired stored xAI token, sends `Bearer fresh-token`, and persists it to `auth.json`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — OAuth login/refresh/logout behavior and the new `/logout` command.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: OAuth providers, refresh behavior, `/logout`
    - `docs/index.md` update: no — covered by the Prism Code entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Masked secret input and first-run onboarding in the TUI
  - Acceptance Criteria:
    - Functional: a masked single-line input component (echoes `•`, supports paste, Enter submits, Esc cancels) is wired as `promptSecret` in the slash-command context and as OAuth `onPrompt` (manual code paste). `/provider` API-key entry works end-to-end.
    - Functional: launching with no usable provider opens the TUI in onboarding state (provider picker → key/OAuth → model picker) instead of printing and exiting (`bin/prism-code.ts:83`). The agent is not constructed until a usable provider exists (plan 135 rule). Esc in onboarding exits cleanly.
    - Functional: headless/ACP without a usable provider exit non-zero with a message naming `prism-code` (TUI) or the env var to set.
    - Performance: onboarding renders within the existing startup budget (≤ 500 ms excluding provider init).
    - Code Quality: the masked input reuses the OpenTUI `InputRenderable`/`TextareaRenderable` in a `SecretInput` component; no bespoke key handling beyond masking.
    - Security: secret text is never stored in reducer state, entries, or history; the buffer is cleared after submit/cancel; the key is saved only after the provider's model list or a cheap validation call succeeds (with an explicit "save anyway" option when the provider has no validation endpoint).
  - Approach:
    - Documentation Reviewed:
      - `node_modules/@opentui/core/renderables/{Input,Textarea}.d.ts` (0.5.12)
      - `packages/prism-code/src/tui/components/{input,picker}.ts`, `src/tui/commands.ts:244-340`
      - `docs/history/135-opentui-spike.md` (masked credential entry decision)
    - Options Considered:
      - Read the secret from stdin outside the renderer. Rejected: conflicts with OpenTUI raw mode.
    - Chosen Approach: an in-renderer masked component plus an onboarding state in the TUI controller.
    - API Notes and Examples:
      ```ts
      const secret = await context.promptSecret("Enter ANTHROPIC_API_KEY for Anthropic: ");
      if (secret) await context.credentialManager.setApiKey("anthropic", secret);
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/components/secret-input.ts`: new masked `SecretInputComponent` (own buffer, paste, Enter/Esc)
      - `packages/prism-code/src/tui/index.ts`: `ensureUi()` split out of `start()` (idempotent renderer/layout/keybindings), `onboardProvider()` loop, secret/paste routing, web setup notes now read off the assembled definition
      - `packages/prism-code/src/tui/commands.ts`: `/provider` returns `provider_selection_cancelled` / `auth_cancelled` / `auth_failed`; new keys are verified before storage with an explicit save-anyway picker
      - `packages/prism-code/src/providers.ts`: `validateProviderKey()` + `ListModelsOptions.apiKey` (raw errors surface instead of the stale catalog when validating)
      - `packages/prism-code/bin/prism-code.ts`: TUI first run launches onboarding (agent assembled after selection), `missingCredentialGuidance()` for headless/ACP, ACP also fails closed without a usable provider
      - `packages/prism-code/src/__tests__/tui-onboarding.test.ts` (new), `src/__tests__/{tui-commands,providers}.test.ts`
      - `docs/prism-code.md`: "First run" section, `/provider` verification, secret-handling notes
      - `scripts/compat-baseline/arnilo__prism-code.txt`: regenerated (+`SecretInputComponent`, +`validateProviderKey`, +`type ProviderKeyValidation`, 7 changed barrel lines; package unreleased)
    - References:
      - Analysis findings: `promptSecret` never wired; first run exits
    - Execution notes:
      - `SecretInputComponent` does **not** wrap `InputRenderable`: OpenTUI 0.5.12 has no masking hook (no `mask`/`obscure` option, no draw override) and no password renderable, so reusing the edit buffer would either display the raw secret or require rewriting buffer contents every keystroke. The component therefore keeps the buffer private and renders only `•` glyphs; this is strictly safer (the secret never exists in an edit buffer, undo stack, or history) and is the only deviation from the "reuses InputRenderable" criterion.
      - `ensureUi()` runs the one-time credential-store picker (previously the last step of `start()`) so an onboarding key is written into the store the operator just chose. It sets `uiReady` before awaiting the callback, so `promptSecret`/`promptCredentialStoreChoice` re-entered from that callback cannot recurse.
      - `promptSecret()` is deliberately not `async` when the UI is up: the prompt must be visible before the call returns or an immediate Escape/paste would be routed to the input editor instead of the mask.
      - Onboarding loop semantics: Esc at the provider picker exits cleanly (bin exits 0); a cancelled/failed credential flow returns to the provider picker with a note naming the env vars that would also work.
      - Pre-existing gap recorded for Task 7: onboarding a host-defined-catalog provider (Azure/Bedrock/Vertex) keeps the current model id, which can still be the placeholder `mock/default`; Task 7's catalog/selection enrichment is the intended fix.
      - `/provider` verification adds one network call (5 s cap) on first key entry; previously-verified stored keys are not re-checked, and providers with no discovery endpoint are stored unchecked with an explicit message.
  - Test Cases to Write:
    - Onboarding: no provider → picker shown → key submitted → key stored → agent constructed → prompt runs (mock). → `tui-onboarding.test.ts` (asserts `anthropic/claude-sonnet-5`, key stored, then `start()` + mock run after onboarding)
    - Esc during secret entry stores nothing and returns to the picker. → `tui-onboarding.test.ts` (picker reopens, no key, Esc at picker returns `undefined`)
    - Reducer/history snapshots after entry contain no secret substring. → `tui-onboarding.test.ts` (typed and pasted secrets)
    - Headless without a provider exits 1 with the guidance message. → `tui-onboarding.test.ts` (subprocess: print and `--mode acp` both exit 1 naming `prism-code` + `ANTHROPIC_API_KEY`)
    - Added: paste strips newlines and stores the exact value; invalid key shows the save-anyway picker, `Discard` stores nothing and `Save anyway` is required to persist; `validateProviderKey` surfaces the raw error without echoing the key or falling back to the catalog, and reports `unverifiable` for providers with no endpoint.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — first-run behavior changes from exit to onboarding.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "First run" section
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7: Per-run model/provider/effort switching, catalog capabilities, and persistence
  - Acceptance Criteria:
    - Functional: the agent definition is built with `providerSource` (backed by the cache below) instead of a fixed `provider`. Core resolves `agent.config.provider ?? options.providerSource ?? agent.config.providerSource` (`src/agent-session/session.ts:641`), so an agent-level `provider` silently wins over every per-run override. This applies to `assembleAppAgent` (`headless.ts:96`) and the ACP assembly.
    - Functional: the TUI keeps a provider cache keyed by provider id (resolved asynchronously on selection, before the next run) and passes `model`, `providerSource`, and `thinkingLevel` in every `RunOptions`. `/model`, `/provider`, and Shift+Tab take effect on the next run without restarting.
    - Functional: `/compact` and the OM coordinator use the current selection (or the configured OM model) through the same cache and the shared credential manager.
    - Functional: the selected `ModelConfig` is enriched from the provider catalog/model discovery (context window, max output, reasoning capability/effort levels), so Shift+Tab effort levels and the compaction trigger (plan 137) have real limits. Unknown models fall back to conservative documented defaults with a status-bar hint.
    - Functional: selection changes are written to `~/.prism/state.json` (Task 2) and restored at the next launch.
    - Performance: switching models performs at most one provider construction and no network call unless discovery is uncached; the cache holds ≤ 1 instance per provider id.
    - Code Quality: `onUpdateModel` (`tui/index.ts:372`) updates one `ActiveSelection` value that run options derive from; no duplicated model state between footer, reducer, and runs.
    - Security: provider instances hold credential sources, not raw keys; the cache is cleared on `/logout`.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-protocol.ts:80-130` (`RunOptions`)
      - `packages/prism-providers/src/model-discovery/index.ts` (`mergeModelCatalog`, discovery factories)
      - `packages/prism-code/src/tui/index.ts:360-380`, `src/tui/commands.ts` `/model`, `/compact`, `/om-model`
      - `packages/prism-code/src/observational-memory.ts`
    - Options Considered:
      - Rebuild the agent definition on every switch. Rejected: expensive, and it drops MCP connections.
      - Per-run `providerSource` override (supported by core). Chosen, with the agent built on `providerSource` rather than `provider` so the override is not shadowed.
    - Chosen Approach: run-level overrides from a single active selection with a small provider cache.
    - API Notes and Examples:
      ```ts
      session.run(input, { model: selection.model, providerSource: (model) => cache.get(model), thinkingLevel: selection.effort });
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/providers.ts`: `createProviderCache`/`ProviderCache` (one instance per provider id, single-flight `prime`, sync `get`, `seed`, `clear`) and `enrichModelConfig`/`ModelEnrichment`/`UNKNOWN_MODEL_LIMITS`
      - `packages/prism-code/src/tui/selection.ts`: new `ActiveSelection` + `effortForRun`/`providerSourceFor`/`selectionRunOptions`
      - `packages/prism-code/src/tui/index.ts`: selection replaces `currentModel`, `setEffort()` (dedupes the three Shift+Tab branches), `ensureProvider()` before every run, definition cache adoption in `start()`, `initialEffort`/`modelNotice` options
      - `packages/prism-code/src/tui/commands.ts`: `providerCache` in `CommandContext`; `/compact` resolves through it; `/logout`, stored-key saves, and OAuth logins clear it
      - `packages/prism-code/src/headless.ts`: `assembleAppAgent` seeds/primes one cache and passes `providerSource` (never `provider`) to `defineAgent`; the OM coordinator gets `providerResolver: cache.prime`
      - `packages/prism-code/src/acp.ts`: `createAgent({ providerSource })` + optional `providerCache` on `createPrismCodeAcpAgent`/`serveAcp`
      - `packages/agent-sdk/src/define-agent.ts`: `AgentSdkConfig.provider` is now optional and `providerSource` accepted (`provider` or `providerSource` required)
      - `packages/prism-code/src/tui/reducer.ts`, `components/status.ts`: `UiFooterStatus.modelNotice` + `formatFooterDetails(..., modelNotice)`
      - `packages/prism-code/bin/prism-code.ts`: one shared cache; `enrichModelConfig` on the resolved/restored model; notice to the TUI footer (or stderr in headless/ACP); `initialEffort` from `state.json`
      - `packages/prism-code/src/__tests__/model-switching.test.ts` (new), `__tests__/{acp,tui-onboarding}.test.ts`
      - `docs/prism-code.md`: "Switching models" + footer/`/compact` notes; `docs/agent-sdk.md`: `provider` vs `providerSource`
    - References:
      - Analysis findings: `/model` has no effect; `providerSource` is synchronous; selection not persisted
    - Execution notes:
      - The blocker was structural, not in `assembleAppAgent`: `resolveRunProvider` is `agent.config.provider ?? options.providerSource ?? agent.config.providerSource`, and `defineAgent` required a provider, so the SDK type had to accept `providerSource` (additive; the compat baseline is unchanged because only the interface body, not its exported declaration, is tracked).
      - `provider` and `providerSource` remain mutually exclusive in effect: hosts that pass `provider` keep today's fixed-provider semantics; Prism Code passes `providerSource` everywhere so `RunOptions` wins.
      - One cache per process: `assembleAppAgent` attaches it to the definition, and `PrismCodeTui.start()` adopts it when the host supplied none, so the agent, runs, `/compact`, and OM workers share instances. A standalone TUI still builds its own cache from its credential manager/config.
      - `RunOptions.model` + `providerSource` are sent on every TUI run, but the resolver is synchronous, so the TUI awaits `ensureProvider()` first; a cache miss otherwise fails closed as `Unknown provider` (never a silent fallback).
      - Effort is normalized once (`effortForRun`): `off`/`unavailable`/`none` are UI labels and are not sent as `thinkingLevel`.
      - `enrichModelConfig` runs in the binary (all modes), not in the TUI constructor, so the host owns model resolution; an embedder constructing the TUI directly must pass an enriched `config.model` or the footer honestly shows `unavailable` effort.
      - `/model` and `/provider` already produce catalog-shaped `ModelConfig`s; enrichment exists for `config.model` and `state.json` restores (and keeps them cheap: static catalog only, no discovery call).
  - Test Cases to Write:
    - Two mock providers: `/model` switch → the next run's `provider_turn_started.metadata.providerId` matches the new provider (fails today because the agent-level `provider` shadows `providerSource`). → `model-switching.test.ts` (seeded `mock-a`/`mock-b`, `providerId` feed asserted as `["mock-a", "mock-b"]`, plus per-provider request capture and the "answer from B" stream check)
    - Headless and ACP assemblies construct the agent with `providerSource`, not `provider`. → `model-switching.test.ts` (`config.provider === undefined`, resolver returns the seeded instance) and `acp.test.ts` (no `provider` option; the run streams text from the cache-seeded instance)
    - Shift+Tab effort appears as `thinkingLevel` on the provider request. → `model-switching.test.ts` (`request.options.compat.reasoning_effort` is `low` after Shift+Tab and absent at `none`)
    - `/compact` uses the current selection. → `model-switching.test.ts` (only the cache-seeded instance receives the compaction request)
    - Restart restores the selection from `state.json`. → `model-switching.test.ts` (`initialEffort: "high"` is applied to the next run and a non-declared level is clamped to `none`)
    - Catalog enrichment supplies context window/effort levels; an unknown model uses documented defaults. → `model-switching.test.ts` (catalog entry → declared levels; unknown model → `UNKNOWN_MODEL_LIMITS`, no invented levels) + binary smoke (`prism-code: limits assumed (32,000 ctx) — "brand-new-model" is not in the mock catalog`)
    - Added: cache single-flight/one-instance-per-id/clear semantics, and `selectionRunOptions` derivation for every effort label.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — model switching semantics and persisted selection.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Switching models" section (shipped)
      - `docs/agent-sdk.md`: `provider` vs `providerSource` in the Inputs table (shipped)
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8: Verification, docs pass, and live provider smoke
  - Acceptance Criteria:
    - Functional: offline integration test covers clean `PRISM_HOME` → onboarding → stored key → restart restores selection → run → `/model` switch → `/logout`, using mock providers and the file credential store.
    - Functional: live smoke tests (skipped without secrets) cover one API-key provider (Anthropic or OpenAI) and one OAuth provider (OpenAI Codex, refresh path forced by a short expiry), added to the existing live matrix.
    - Functional: `bun run build`, package tests, `release:gate` are green; the compat baseline diff from Task 3 is recorded.
    - Performance: startup time with a warm keychain is measured and recorded in the task note (target ≤ 500 ms excluding provider init).
    - Code Quality: no `as any` remains in `credentials.ts`/`providers.ts`.
    - Security: a repo-wide grep confirms no secret-shaped strings in test snapshots; `security.yml` checks pass.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/live-matrix.yml`, `scripts/e2e-cli-live.test.mjs` (live test conventions)
    - Options Considered:
      - Live tests in the default CI run. Rejected: they need secrets; they stay in the live matrix only.
    - Chosen Approach: offline integration by default, gated live smoke in the live matrix.
    - API Notes and Examples:
      ```bash
      PRISM_HOME=$(mktemp -d) bun test packages/prism-code/dist/src/__tests__/home-providers.integration.test.js
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/__tests__/home-providers.integration.test.ts`: new
      - `scripts/e2e-prism-code-live.test.mjs`: new live smoke (gated)
      - `scripts/live-matrix.json`: new `code/live-smoke` suite entry (58 suites total)
      - `.github/workflows/live-matrix.yml`: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `PRISM_LIVE_CODEX_REFRESH_TOKEN` wired into the matrix env
      - `docs/live-testing.md`: regenerated matrix table (`bun scripts/generate-live-docs.mjs --write`)
      - `docs/prism-code.md`: consistency pass (added the missing `hyper` row; auto-detect prose already matched)
    - References:
      - Tasks 2–7
    - Execution notes:
      - `home-providers.integration.test.ts` runs the clean-home journey in-process against the real file store: `auth.json` is seeded through the production `selectCredentialStore(...).apply("file")` path, the key is verified on disk with `mode & 0o077 === 0`, `state.json` is written the way `onSelectionChange` does, and provider traffic is a mock bound to the real descriptor ids (`anthropic`) so the credential/selection plumbing is production code. A second leg spawns the real binary against the same home and asserts `limits assumed (32,000 ctx)` on stderr plus a successful run, i.e. restore + enrichment + assembly through `bin/prism-code.ts`.
      - Live smoke legs skip independently and skip-not-fail on provider-side 401/403: stored-key leg (provider env vars are stripped from the child, so the file store is the only possible credential source) and OAuth leg (an `openai-codex` entry with an access token expired an hour ago must be refreshed against the real token endpoint and persisted back with a moved-forward expiry and the refresh token carried forward).
      - Live smoke verified locally without a real secret: with a deliberately bogus `ANTHROPIC_API_KEY` the child reaches the provider using the *stored* key and the 401 becomes a printed skip — proving the store path executes while keeping the default suite hermetic. The OAuth leg is `it.skip` without `PRISM_LIVE_CODEX_REFRESH_TOKEN`.
      - Startup (warm keychain, excluding provider init): median **4.8 ms** (samples 4.4–7.7 ms over 3×5 runs) for `readState` + config validation + keychain probe + store construction + `enrichModelConfig`; full `bin/prism-code.ts -p hi --mode print` is ~307 ms with the keychain store vs ~306 ms with the file store (bun boot + provider init + one mock turn included). Target ≤ 500 ms met with two orders of magnitude of headroom. Reproduce with a throwaway home and a script that times `readState` → `validatePrismCodeConfig` → `selectCredentialStore` → `enrichModelConfig` with `node:perf_hooks` (one warm-up selection first, then 5 samples).
      - Compat baseline diff: `prism-core` +9 names and 1 changed line (Task 3: `FileCredentialStore`, `createFileCredentialStore`, `KEYCHAIN_PROBE_ACCOUNT`, `probeKeychainAvailability`, options/limits types); `prism-code` is a new baseline file (179 lines) that grew +4 names/7 changed (T4 async provider resolution), +10 names (T5 OAuth/logout), +1 name (T6 `SecretInputComponent`), +9 names/10 changed barrel lines (T7 cache/enrichment/selection); `prism-agent-sdk` unchanged (0 removed/0 changed). The root `@arnilo/prism` and `prism-work` baseline drift in the working tree comes from unrelated concurrent work and is not part of this plan.
      - Verification run: `bun run build` green; prism-code 368 src / 184 dist tests, agent-sdk 58, core credentials dist 94, script tests (live-matrix 14, live-doc-check + workflow-liveness 15, docs/package-truth 167) all 0 fail; `bun scripts/e2e-coverage-gate.mjs --baseline` 113/113 surfaces; `git ls-files | scan-secrets.mjs` 2689 files 0 findings; `bun audit --audit-level=moderate` 0 vulnerabilities; `bun run security:threat-suites` 83 pass; `bun run test:postgres` green against a throwaway `pgvector/pgvector:pg16` container (`PRISM_TEST_POSTGRES_URL=postgresql://postgres:prism@127.0.0.1:55432/prism`); `bun run release:gate` exits 0 with `release evidence: 47 surfaces, blocked=false` (only the release-profile `phase26-coding-journey` host leg is not runnable in this environment); running it also refreshed the generated `docs/_evidence/phase54-package-map.md` (12 → 14 manifests) as the new `@arnilo/prism-code` package enters the map.
      - Code quality/security acceptance: `grep -c "as any"` returns 0 in `credentials.ts` and `providers.ts`; a repo-wide scan for secret-shaped literals (`sk-`/`sk-ant-`/`xai-` + long random-looking values, `api_key = "…"`) finds no matches in test files or snapshots, and the live smoke keeps every fixture value non-secret-shaped.
  - Test Cases to Write:
    - The integration journey above; the live smoke for API-key and OAuth providers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `docs/prism-code.md` consistency pass only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- The live OAuth leg needs an operator-supplied `PRISM_LIVE_CODEX_REFRESH_TOKEN`; without it the leg skips. The forced-refresh determinism therefore relies on an access token seeded an hour in the past plus a post-run assertion that the stored token was replaced with a moved-forward expiry — it does not prove *why* the refresh happened, only that an expired stored token cannot serve a run.
- The default (offline) integration journey stubs the model-list HTTP response for `/model` discovery; real discovery is only exercised by the gated live smoke. Everything else in the journey (store selection, masking, disk permissions, `state.json`, provider cache, `/logout`) runs against production code paths.
- `release:gate` was reproduced with a throwaway local Postgres; its release-profile `phase26-coding-journey` leg is not runnable in this environment (`bun scripts/blocked-gate.mjs` names it). The Postgres, NATS, and canary legs stay environment-gated by design.
- The live smoke strips provider env vars from the child so the stored key is provably the only credential source; ambient-env fallback is covered by unit tests instead (i.e. the live leg does not double-check the ambient path).

## Further Actions

- Wire a real `PRISM_LIVE_CODEX_REFRESH_TOKEN` secret into the `live-canaries` environment and run `PRISM_LIVE_FILTER=code/live-smoke bun run test:live` to prove the OAuth refresh leg end to end (medium; blocks only that leg's evidence).
- Add a pty-driven TUI smoke (spawn the real binary in a pseudo-terminal, drive onboarding keystrokes) so the first-run path is covered outside the in-process test renderer (medium).
- Extend the live smoke with a `/logout` leg against the real keychain store once the `live-canaries` runner has one; today `/logout` is covered offline and the live smoke uses the file store deliberately (low).
- The prune/OM worker and `/compact` now share the provider cache; a live leg that compacts a real session would close the last per-run-selection gap (low).
