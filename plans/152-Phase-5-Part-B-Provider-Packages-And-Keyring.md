# Phase 5 Part B — Provider packages and the keyring credentials package

## Objectives

- Port each of the 21 vendors in `@arnilo/prism-providers` to its own native package, `@arnilo/prism-provider-<vendor>` under `packages/providers/<vendor>/`. The vendors are anthropic, openai, google, azure, bedrock, vertex, deepseek, xai, zai, alibaba, kimi, clinepass, commandcode, hyper, laya, neuralwatt, ollama, opencode-go, openrouter, typesafe, and ai-sdk.
- Each package:
  - is a `definePackage` default export
  - takes credentials as refs in config
  - passes `providerConformance`
  - imports no sibling provider
  - runs OAuth only through `host.ui` (`open-url`, `input`) and the `credentials` slot, and never opens a browser itself
- Move the wire code that vendors share into `@arnilo/prism/provider-kit`.
- Ship `@arnilo/prism-credentials-keyring`, which fills the `credentials` slot with the OS keyring and an encrypted file store.
- Delete the `@arnilo/prism-providers` workspace once every caller has moved.
- Ship the third Phase 5 example (the Anthropic package with a per-run model switch) and record the Phase 5 Done criteria.

## Expected Outcome

- `packages/providers/<vendor>/` holds 21 packages with the roadmap §2.10 shape. A vendor's `README.md` is its page.
- `import anthropic from "@arnilo/prism-provider-anthropic"` evaluates no other provider package. A test loads each package in a fresh process and inspects the module graph.
- Each package passes `providerConformance` from `@arnilo/prism/provider-kit` against a fake `fetch`, plus `packageConformance` from `@arnilo/prism/testing`.
- Each package declares its API key as a secret config field with a default `env:` ref, such as `{ apiKey: "env:ANTHROPIC_API_KEY" }`, and resolves it through `prism.credentials.resolve` on each request. A missing key produces a `status.note` and no failed `createAgent`. A literal key fails config validation.
- OpenAI (Codex) and xAI OAuth run as `ModelProvider.auth` descriptors over `host.ui`. With no UI they answer `unavailable` and fail closed. Tokens persist through the `credentials` slot.
- `@arnilo/prism-credentials-keyring` claims the `credentials` slot. It resolves `keyring:name` and stores `secret` answers and OAuth tokens. It delegates `env:` refs to `prism.slots.credentials.default`. `@napi-rs/keyring` loads only inside this package.
- `packages/prism-providers/` is deleted, its exports are gone, and every importer has moved. `examples/anthropic-model-switch.ts` runs under the execution gate.

This plan is Part B of roadmap **Phase 5 — Models, providers, and credentials**. It depends on [plan 151](151-Phase-5-Part-A-Kernel-Model-Layer-And-Credentials.md) being complete, because it needs `ModelProvider`, `ModelRef`, `provider-kit`, `providerPackage`, `providerConformance`, the reshaped `credentials` slot, and the `auth` descriptors. The phase review is plan 151 Task 1. Task 1 here is a read-only entry check of the vendor map against the post-Part-A code.

Placement (probe 1): every vendor is a package, wire code shared by two or more vendors goes to `@arnilo/prism/provider-kit` (`prism.md` §1), and the keyring is a package filling a slot. The kernel gains no vendor name. A test keeps provider-kit free of vendor ids (plan 151 Task 4).

Versioning follows `@arnilo/prism-hooks-json` (plan 147): each new package is version `0.12.1` in lockstep with the kernel until Phase 11, with `requires.prism` set to the same range. Nothing is published.

Lab impact (probe 12): `packages/prism-code/src/providers.ts` (1075 lines) and `oauth.ts` change their imports to the provider packages in Task 8, but are not deleted. Prism Code still wires providers itself and answers OAuth in its TUI, which Phase 12 replaces with `loadManifest` and `HostUi`. `packages/prism-code/src/credentials.ts` keeps its store selection until Phase 12 and reads the keyring through the package's named exports.

This plan does not ship a version bump, a publish, a `/docs` change, or npm deprecation of `@arnilo/prism-providers` (Phase 11).

## Tasks

- [ ] Task 1: Part B entry check — the vendor map after Part A (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record, per vendor directory in `packages/prism-providers/src/`:
      - non-test line count
      - imports from `../shared/*` and from sibling vendors. Today: hyper imports `../openai/responses.js`, azure, bedrock, and commandcode import from `../openai/`, and laya and typesafe import the System One client.
      - third-party dependencies (`@ai-sdk/provider` is an optional peer of `ai-sdk`)
      - OAuth code (`openai/codex.ts`, `openai/oauth.ts`, `xai/oauth.ts`)
      - discovery (`models()`) support
      - the factory options that are not JSON (`fetch`, functions), which stay test-only factory parameters
    - Functional: Fix the destination of every shared module, confirming or amending plan 151 Task 1(g):
      - `shared/anthropic-messages.ts` → provider-kit (Anthropic Messages wire)
      - `openai/responses.ts` and the OpenAI chat and thinking helpers that other vendors import → provider-kit (OpenAI Responses wire)
      - `shared/openai-compat.ts`, `shared/retry-http.ts` → provider-kit
      - `shared/systemone*.ts` → provider-kit only if laya and typesafe stay two vendors; otherwise into the one package that owns the System One endpoint
      - `decisions/` → the package Task 1 names (default: the System One owner, as a named export)
      - `model-discovery/` → the OpenAI-compatible `/models` adapter to provider-kit, and the Google adapter to `provider-google`
    - Functional: Decide whether a vendor package whose key ref resolves to nothing still registers its provider. Default: yes, with a `status.note`, so `agent.models` still lists its catalog and a run on it fails with `credential_unavailable`. The alternative, registering nothing (§2.6, "register nothing and call `status.note`"), makes a run fail with `Unknown provider` instead. Record which reading of §2.6 applies to providers.
    - Functional: Count every importer of `@arnilo/prism-providers` outside its own workspace, grouped by workspace and by vendor subpath. Today that is 133 files and 491 hits across `scripts/`, `examples/`, `src/__tests__/`, `packages/prism-code`, `packages/acp-agent`, and `packages/memory`. Each vendor task migrates its own importers.
    - Functional: Confirm how `scripts/compat-baseline/` maps the existing virtual names `arnilo__prism-provider-<vendor>.txt` (from the `@arnilo/prism-providers/<vendor>` subpaths) to the new real package names. Record whether the release gate's package map (`scripts/phase54-package-map.mjs` or its successor) needs an update.
    - Functional: Inventory the keyring sources: `packages/prism-core/src/credentials/node/{keychain-store,encrypted-store,file-store,envelope,file-io}.ts` and `packages/prism-code/src/credentials.ts` (`PRISM_CODE_KEYCHAIN_SERVICE` at `:160`). Name what moves and what stays in `prism-core`'s `./credentials/node` subpath: oidc, vault, kms, the work-token and Google Workspace helpers stay for Phase 9/11.
    - Functional: Record the current failing-test set of `bun test src packages` as this plan's baseline.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites the `graft` or `rg` command that produced it.
    - Security: List every place a vendor sends or logs a key, a token, or an `Authorization` header, and the redaction that covers each one. Name any vendor that opens a browser or spawns a process (`rg "Bun.spawn|child_process|xdg-open|open\("`), which Tasks 3–6 must remove.
  - Approach:
    - Documentation Reviewed:
      - plan 151 Task 1 Notes; `roadmap.md` §2.9 providers and credentials-keyring rows, Phase 5
      - `packages/prism-providers/src/*/index.ts`, `packages/prism-providers/src/shared/*`
    - Options Considered:
      - Reuse plan 151's counts. Rejected: Part A renamed `AIProvider`, moved the subpaths, and rewrote every `provider:` site, so the import map changed.
    - Chosen Approach:
      - Re-run graft and rg per vendor and record a table.
    - API Notes and Examples:
      ```bash
      graft callers createAnthropicMessagesProvider --depth all
      rg -l "@arnilo/prism-providers/anthropic" src packages examples scripts
      ```
    - Files to Create/Edit:
      - `plans/152-Phase-5-Part-B-Provider-Packages-And-Keyring.md`: Notes and amendments only.
    - References:
      - plan 149 Task 1 (entry-check precedent)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Shared vendor wire code into provider-kit, and the `packages/providers/*` layout
  - Acceptance Criteria:
    - Functional: The shared modules Task 1 assigned to provider-kit move there with their tests:
      - the Anthropic Messages wire
      - the OpenAI Responses wire and thinking-level helpers
      - `retry-http`
      - the OpenAI-compatible model discovery adapter
      - System One, if Task 1 put it there

      `packages/prism-providers` imports them from `@arnilo/prism/provider-kit` in this task, so the old workspace stays green until its vendors move.
    - Functional: Sibling-vendor imports are gone. `rg "from \"\.\./(openai|anthropic|google|…)/" packages/prism-providers/src` over non-test files returns nothing.
    - Functional: The grouped layout `packages/providers/<vendor>/` is wired into the tooling. Each line below names its check:
      - root `workspaces` gains `packages/providers/*` (or explicit entries, matching how plan 147 did `packages/integrations/hooks-json`)
      - `workspacePackageCounts()` in `scripts/package-truth.mjs` counts it
      - the `packaging.test.ts` package list accepts TypeScript-source exports for it
      - `scripts/independent-packages.json` records the lockstep decision for it
    - Functional: provider-kit still names no vendor (`provider_kit_names_no_vendor` from plan 151 stays green), so wire mappings are named for their protocol (`anthropic-messages`, `openai-responses`), not their vendor.
    - Performance: Importing provider-kit does not pull in any wire module a provider does not use. Each wire module is its own file, re-exported from the index without side effects. The task note records the module-graph size before and after.
    - Code Quality: There is one copy of each wire mapping. Vendor directories keep only vendor-specific code.
    - Security: The moved modules keep their redaction (`redactSecrets` in `retry-http`), and their tests move with them.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism.md` §1 (wire code shared by providers), §5 (tooling assumptions)
      - plan 147 Task 5 (grouped-layout tooling), Task 1 Notes
    - Options Considered:
      - Let hyper depend on `@arnilo/prism-provider-openai`. Rejected: a provider must not import a sibling provider (`prism.md` §4).
    - Chosen Approach:
      - Move the shared code to provider-kit first, so every later vendor task is a self-contained move.
    - API Notes and Examples:
      ```ts
      import { anthropicMessagesBody, anthropicMessagesEvents, openAIResponsesEvents, providerHttpError } from "@arnilo/prism/provider-kit";
      ```
    - Files to Create/Edit:
      - `src/provider-kit/{anthropic-messages.ts,openai-responses.ts,openai-thinking.ts,retry-http.ts,model-discovery.ts,…}`: moved, as Task 1 names them. `src/provider-kit/index.ts`.
      - `packages/prism-providers/src/**`: imports retargeted; `shared/` emptied of the moved files.
      - Root `package.json` `workspaces`, `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`.
      - `scripts/compat-baseline/arnilo__prism-provider-kit.txt`, `arnilo__prism-providers.txt`, and the vendor-subpath baselines: regenerate with `node scripts/release.mjs gate --update-baseline`, with the diff and its attribution in the task note.
      - `docs/next/provider-kit.md`: the wire mappings. `CHANGELOG.md`.
    - References:
      - plan 151 Task 4
  - Test Cases to Write:
    - `provider_kit_anthropic_messages_wire_round_trips` (moved test)
    - `provider_kit_openai_responses_wire_round_trips` (moved test)
    - `no_vendor_imports_a_sibling_vendor` (an `rg` scan test over `packages/prism-providers/src` and, later, `packages/providers/*/src`)
    - `package_truth_counts_grouped_provider_workspaces`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider-kit gains wire mappings.
    - Docs pages to create/edit:
      - `docs/next/provider-kit.md`: wire mapping sections.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The flagship packages — `@arnilo/prism-provider-anthropic` and `@arnilo/prism-provider-openai`
  - Acceptance Criteria:
    - Functional: Each package:
      - has the §2.10 shape: `package.json` with `"exports": { ".": "./src/index.ts" }`, `src/index.ts`, `src/__tests__/`, and `README.md`
      - default-exports `definePackage` with `name: "@arnilo/prism-provider-<vendor>"`, the lockstep version, `requires.prism`, and `capabilities: ["credentials"]` (plus `host-ui` for openai's OAuth)
      - has a config schema with `apiKey` (`x-prism-secret`, default `env:ANTHROPIC_API_KEY` / `env:OPENAI_API_KEY`), `baseUrl`, and `models`
      - registers its provider through `prism.providers.register`
      - resolves the key through `prism.credentials.resolve` per request
    - Functional: A missing key does not fail `createAgent`. It records `status.note("warn", "<vendor>: no API key at <ref>")`, and a run on that provider fails with `credential_unavailable`. Task 1 records whether the provider still registers in that case; the default is to register, so `agent.models` still lists its catalog.
    - Functional: The OpenAI package exposes Codex OAuth as an `auth` descriptor (plan 151 Task 1(e)). `login` sends `open-url` and `input` requests through `ctx.host`, exchanges the code, and stores tokens with `ctx.credentials.store("keyring:openai-codex", …)`. On `unavailable` it throws `OAuthUnavailableError`. It never spawns a process or opens a browser.
    - Functional: Named exports keep the raw factories for tests and advanced hosts: `createAnthropicMessagesProvider`, the OpenAI Responses and chat factories, and the model catalogs. Each accepts `fetch` as a factory option.
    - Functional: Both vendor directories are deleted from `packages/prism-providers`, together with their `exports` subpaths. Every importer Task 1 counted for these two vendors migrates in this task, including the `packages/prism-code/src/providers.ts` entries for anthropic and openai.
    - Functional: A repo-wide grep (exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, the released `/docs` pages, and historical `CHANGELOG` sections) for `@arnilo/prism-providers/anthropic`, `@arnilo/prism-providers/openai`, and `anthropicPackage(` / `openaiPackage(` returns nothing.
    - Performance: Importing a package evaluates only its own modules and provider-kit. The test `loading_one_provider_package_never_evaluates_another` spawns `bun -e 'await import(...)'` and asserts no other `packages/providers/*` path appears in the loaded modules.
    - Code Quality: There is no `vendorPackage` shim. Each package's `setup` is under 20 lines.
    - Security:
      - A literal `apiKey` fails config validation (`secret_literal`).
      - The key never appears in events, `inspect()`, or errors. `providerConformance`'s no-secret-leak check uses a canary key.
      - An OAuth token never appears in a `host.ui` request.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9 providers row, §2.6 (`status.note` for a package that cannot operate), §2.10 package shape; `prism.md` §4 provider package checklist
      - `packages/prism-providers/src/anthropic/*`, `packages/prism-providers/src/openai/{oauth,codex}.ts`, `packages/integrations/hooks-json/` (package precedent)
    - Options Considered:
      - Keep credentials as factory options (`apiKey: CredentialValueSource`). Rejected: config must carry refs only (§1.4), and functions are not manifest-expressible.
    - Chosen Approach:
      - Ref-only config, per-request resolution through the slot, OAuth as an `auth` descriptor, and the raw factories kept as named exports.
    - API Notes and Examples:
      ```ts
      import anthropic from "@arnilo/prism-provider-anthropic";
      const agent = await createAgent({ model: "anthropic/claude-sonnet-4-5", packages: [anthropic({ apiKey: "env:ANTHROPIC_API_KEY" })] });
      ```
      ```jsonc
      { "name": "@arnilo/prism-provider-anthropic", "version": "^0.12.1", "integrity": "sha512-…", "config": { "apiKey": "env:ANTHROPIC_API_KEY" } }
      ```
    - Files to Create/Edit:
      - `packages/providers/anthropic/{package.json,src/**,README.md,CHANGELOG.md,LICENSE,tsconfig.json,bunfig.toml}`: new, moved from `packages/prism-providers/src/anthropic/`.
      - `packages/providers/openai/…`: same, from `packages/prism-providers/src/openai/`.
      - `packages/prism-providers/package.json`: the two `exports` entries deleted. `packages/prism-providers/src/{anthropic,openai}/`: deleted.
      - Importers per Task 1 (`examples/`, `scripts/`, `src/__tests__/`, `packages/prism-code/src/providers.ts`, `packages/acp-agent`, `packages/memory` tests).
      - `scripts/compat-baseline/arnilo__prism-provider-anthropic.txt`, `arnilo__prism-provider-openai.txt`, `arnilo__prism-providers.txt`: regenerate, with the diff in the task note.
      - Enforcement rows: `workspaces` (if listed explicitly), `scripts/package-truth.mjs` counts, the `packaging.test.ts` list, and `scripts/independent-packages.json`.
      - `CHANGELOG.md`.
    - References:
      - plan 147 Task 5 (moving `packages/hooks` to `packages/integrations/hooks-json`)
  - Test Cases to Write (per package):
    - `<vendor>_passes_provider_conformance`
    - `<vendor>_passes_package_conformance`
    - `<vendor>_missing_key_notes_status_and_does_not_fail_create_agent`
    - `<vendor>_literal_api_key_fails_config_validation`
    - `loading_one_provider_package_never_evaluates_another`
    - `openai_codex_oauth_uses_host_ui_and_stores_through_slot`
    - `openai_codex_oauth_without_ui_fails_closed`
    - `provider_packages_spawn_no_process_and_open_no_browser` (an `rg` scan test)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two new packages, and two subpaths removed.
    - Docs pages to create/edit:
      - `packages/providers/anthropic/README.md`, `packages/providers/openai/README.md`: package page structure, with a manifest entry, the config table, OAuth (openai), and failure behaviour.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: OpenAI-compatible vendors — deepseek, xai, zai, alibaba, kimi, openrouter, ollama, opencode-go, neuralwatt, clinepass
  - Acceptance Criteria:
    - Functional: Each of the ten vendors becomes `@arnilo/prism-provider-<vendor>` with the same criteria as Task 3, and the same tests for each package:
      - shape and `definePackage`
      - ref-only key with its vendor's default `env:` ref
      - per-request resolution
      - a missing key gives a status note
      - raw factory named exports
      - conformance
      - no sibling import

      `ollama` has no required key, so its `apiKey` is optional with no default, and an absent key adds no status note.
    - Functional: xAI OAuth (`xai/oauth.ts`) follows the openai pattern from Task 3: an `auth` descriptor over `host.ui`, tokens through the slot, and fail-closed on `unavailable`.
    - Functional: Vendors with live discovery implement `models()` through the provider-kit OpenAI-compatible discovery adapter, using its TTL cache. Vendors without it return their static catalog.
    - Functional: The ten directories and their `exports` subpaths leave `packages/prism-providers`. Their importers migrate, and the per-vendor grep (exclusions as in Task 3) returns nothing.
    - Performance: Each package passes `loading_one_provider_package_never_evaluates_another` (parameterized over every package). Discovery runs only when `agent.models.list()` is called, never at `setup`.
    - Code Quality: Every vendor uses the provider-kit OpenAI-compatible wire. A vendor directory contains only its id, defaults, catalog, quirks, and package definition.
    - Security: Same as Task 3. A discovery error names the vendor and HTTP status, but never the key or the request headers.
  - Approach:
    - Documentation Reviewed:
      - Task 1 vendor table; `packages/prism-providers/src/<vendor>/*`
    - Options Considered:
      - One package for all OpenAI-compatible vendors. Rejected: §2.9 lists one package per vendor, and "loading one provider package never evaluates another".
    - Chosen Approach:
      - Repeat Task 3's template per vendor, parameterizing the shared tests over a vendor list.
    - API Notes and Examples:
      ```ts
      import deepseek from "@arnilo/prism-provider-deepseek";
      packages: [deepseek()] // apiKey defaults to "env:DEEPSEEK_API_KEY"
      ```
    - Files to Create/Edit:
      - `packages/providers/{deepseek,xai,zai,alibaba,kimi,openrouter,ollama,opencode-go,neuralwatt,clinepass}/…`: new, moved.
      - `packages/prism-providers/package.json` and `src/<vendor>/`: deleted.
      - Importers per Task 1.
      - `scripts/compat-baseline/arnilo__prism-provider-<vendor>.txt` (one per vendor that has a baseline) and `arnilo__prism-providers.txt`: regenerate, with the diff in the task note.
      - Enforcement rows as in Task 3.
      - `src/__tests__/provider-packages.test.ts` (or a package-level shared test): the vendor list grows.
      - `CHANGELOG.md`.
    - References:
      - Task 3
  - Test Cases to Write:
    - The Task 3 per-package tests, parameterized over the ten vendors.
    - `xai_oauth_uses_host_ui_and_fails_closed_without_ui`
    - `discovery_runs_only_on_models_list`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — ten new packages, and ten subpaths removed.
    - Docs pages to create/edit:
      - `packages/providers/<vendor>/README.md` × 10: package page structure.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Composite-wire vendors — commandcode, hyper, laya, typesafe
  - Acceptance Criteria:
    - Functional: Each of the four becomes `@arnilo/prism-provider-<vendor>` with the Task 3 criteria and tests. Each uses only provider-kit wire mappings:
      - hyper: OpenAI Responses and Anthropic Messages
      - commandcode: Anthropic Messages, retry-http, and the OpenAI model helpers
      - laya and typesafe: System One, wherever Task 1 placed it
    - Functional: `decisions` (the typed System One decision call) ships where Task 1 decided, as a named export, with its tests.
    - Functional: The four directories, `decisions/`, and their `exports` subpaths leave `packages/prism-providers`. Importers migrate, and the per-vendor grep (exclusions as in Task 3) returns nothing.
    - Performance: Same as Task 4.
    - Code Quality: No vendor imports another vendor. `no_vendor_imports_a_sibling_vendor` covers `packages/providers/*/src`.
    - Security: Same as Task 3. `decisions` keeps its no-synthetic-answer rule: a timeout is an error, never a neutral answer. Its test moves with it.
  - Approach:
    - Documentation Reviewed:
      - Task 1 vendor table; `packages/prism-providers/src/{commandcode,hyper,laya,typesafe,decisions}/*`
    - Options Considered:
      - Merge laya and typesafe into one `systemone` package. Rejected unless Task 1 finds they are one vendor: §2.9 names both.
    - Chosen Approach:
      - Port each one onto the provider-kit wire mappings from Task 2.
    - API Notes and Examples:
      ```ts
      import hyper from "@arnilo/prism-provider-hyper";
      ```
    - Files to Create/Edit:
      - `packages/providers/{commandcode,hyper,laya,typesafe}/…`: new, moved.
      - `packages/prism-providers/src/{commandcode,hyper,laya,typesafe,decisions}/` and the `exports` entries: deleted.
      - Importers per Task 1.
      - `scripts/compat-baseline/*` for the moved subpaths: regenerate, with the diff in the task note.
      - Enforcement rows as in Task 3.
      - `CHANGELOG.md`.
    - References:
      - Task 2, Task 3
  - Test Cases to Write:
    - The Task 3 per-package tests, parameterized over the four vendors.
    - `decisions_timeout_is_an_error_not_a_neutral_answer` (moved)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — four new packages, and five subpaths removed.
    - Docs pages to create/edit:
      - `packages/providers/<vendor>/README.md` × 4, including `decisions` in its owner's README.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Cloud and adapter vendors — google, vertex, azure, bedrock, ai-sdk
  - Acceptance Criteria:
    - Functional: Each of the five becomes `@arnilo/prism-provider-<vendor>` with the Task 3 criteria and tests. Vendor-specific config, with every credential field `x-prism-secret` and ref-only:
      - azure: `resourceName`, `deployment`, and `apiVersion`
      - vertex: `project`, `location`, and a service-account ref
      - bedrock: `region`, plus `accessKeyId` and `secretAccessKey` refs, or a profile
    - Functional: `google` owns the Google discovery adapter that Task 1 assigned to it.
    - Functional: `ai-sdk` keeps `@ai-sdk/provider` as an optional peer of its own package only. When the peer is missing, it records a status note and registers nothing (§2.6), instead of throwing at `setup`. The version-matrix check stays.
    - Functional: The five directories and the `model-discovery` subpath leave `packages/prism-providers`, which now has no vendor left. Importers migrate, and the per-vendor grep (exclusions as in Task 3) returns nothing.
    - Performance: `@ai-sdk/provider` is imported only when `ai-sdk` is listed. A test asserts it is absent from the module graph of an agent that lists any other provider package.
    - Code Quality: Same as Task 4.
    - Security: Cloud signing secrets (bedrock SigV4, the vertex service account) resolve per request through the slot and are added to the redactor. A canary test covers each one.
  - Approach:
    - Documentation Reviewed:
      - Task 1 vendor table; `packages/prism-providers/src/{google,vertex,azure,bedrock,ai-sdk,model-discovery}/*`
    - Options Considered:
      - Leave `ai-sdk` in the old workspace. Rejected: §2.9 lists `@arnilo/prism-provider-ai-sdk`.
    - Chosen Approach:
      - Same template. Heavy or peer dependencies stay local to their package.
    - API Notes and Examples:
      ```jsonc
      { "name": "@arnilo/prism-provider-bedrock", "config": { "region": "us-east-1", "accessKeyId": "env:AWS_ACCESS_KEY_ID", "secretAccessKey": "env:AWS_SECRET_ACCESS_KEY" } }
      ```
    - Files to Create/Edit:
      - `packages/providers/{google,vertex,azure,bedrock,ai-sdk}/…`: new, moved.
      - `packages/prism-providers/src/{google,vertex,azure,bedrock,ai-sdk,model-discovery}/` and the `exports` entries: deleted.
      - Importers per Task 1.
      - `scripts/compat-baseline/*` for the moved subpaths: regenerate, with the diff in the task note.
      - Enforcement rows as in Task 3.
      - `CHANGELOG.md`.
    - References:
      - Task 3
  - Test Cases to Write:
    - The Task 3 per-package tests, parameterized over the five vendors.
    - `ai_sdk_missing_peer_notes_status_and_registers_nothing`
    - `ai_sdk_peer_not_loaded_unless_listed`
    - `cloud_signing_secret_canary_never_leaks`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — five new packages, and six subpaths removed.
    - Docs pages to create/edit:
      - `packages/providers/<vendor>/README.md` × 5.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: `@arnilo/prism-credentials-keyring`
  - Acceptance Criteria:
    - Functional: `packages/credentials/keyring/` holds a package with the §2.10 shape:
      - `capabilities: ["slot:credentials"]`
      - config `{ backend: "os" | "file" = "os", service: string = "prism", file?: { path, keyRef } }`, where `keyRef` is `x-prism-secret` and ref-only
      - it claims the slot with `prism.slots.credentials.provide(...)`
      - `resolve("keyring:<name>")` reads the backend
      - `env:` and any other ref delegate to `prism.slots.credentials.default`
      - `store` and `delete` write the backend
    - Functional: The `secret` `host.ui` request and the provider-kit OAuth helpers persist through it. A test runs plan 148's secret flow and the openai Codex OAuth test with this package listed, and both now succeed instead of answering `unavailable`.
    - Functional: The OS backend is moved from `packages/prism-core/src/credentials/node/keychain-store.ts`, and the file backend from `encrypted-store.ts`, `file-store.ts`, `envelope.ts`, and `file-io.ts`, with their tests. Their `prism-core` exports are deleted, and every importer migrates in this task (`packages/prism-code/src/credentials.ts` uses the package's named exports). The rest of `prism-core`'s `./credentials/node` stays (Task 1 list).
    - Functional: When the OS keyring is unavailable (no Secret Service, CI), `backend: "os"` records a status note and the package still claims the slot. Then `keyring:` refs resolve `undefined`, `store` throws `KeyringUnavailableError`, and the asking package fails closed. It never silently falls back to a plaintext file.
    - Functional: Two packages claiming `credentials` fail closed until assigned (plan 144). A test lists keyring and a second credentials fixture.
    - Performance: `@napi-rs/keyring` is imported lazily inside the OS backend, only when the package is listed and the backend is `os`. A test asserts the module is absent from the graph of an agent without this package. `resolve` makes one backend read per call, with no cache by default, and the README states that cost.
    - Code Quality: The package depends on `@napi-rs/keyring`, and `prism-core` drops that dependency if nothing else in it uses it (Task 1 confirms).
    - Security:
      - Stored values never appear in events, `inspect()`, status notes, or errors (canary test).
      - The file backend refuses a literal `keyRef` and refuses a world-readable file. The existing `file-store` permission checks move with it.
      - `inspect()` shows only the backend kind and the service name.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9 credentials-keyring row, §2.5 credentials slot; plan 151 Task 6 (slot contract)
      - `packages/prism-core/src/credentials/node/{keychain-store,encrypted-store,file-store,envelope}.ts`, `packages/prism-code/src/credentials.ts`
    - Options Considered:
      - Put the keyring in the kernel. Rejected: §2.1 says "Keyring, encrypted vaults" are not in the kernel, and it is a native dependency.
      - Fall back to a plaintext file when there is no keyring. Rejected: secrets would leave the edge silently.
    - Chosen Approach:
      - A slot package with two backends, delegating to the kernel default for `env:`.
    - API Notes and Examples:
      ```ts
      import keyring from "@arnilo/prism-credentials-keyring";
      packages: [keyring({ backend: "os", service: "prism" }), anthropic({ apiKey: "keyring:anthropic" })]
      ```
    - Files to Create/Edit:
      - `packages/credentials/keyring/{package.json,src/**,README.md,CHANGELOG.md,LICENSE,tsconfig.json,bunfig.toml}`: new.
      - `packages/prism-core/src/credentials/node/{keychain-store,encrypted-store,file-store,envelope,file-io}.ts` and their tests: moved. `packages/prism-core/src/credentials/node/index.ts` and `packages/prism-core/package.json` (dependency): updated.
      - `packages/prism-code/src/credentials.ts`: imports.
      - `scripts/compat-baseline/arnilo__prism-credentials-keyring.txt` (new) and `arnilo__prism-credentials-node.txt`: regenerate, with the diff in the task note.
      - Enforcement rows: `workspaces`, `scripts/package-truth.mjs`, `packaging.test.ts`, `scripts/independent-packages.json`.
      - `CHANGELOG.md`.
    - References:
      - plan 136 (Prism Code durable credential store selection)
  - Test Cases to Write:
    - `keyring_resolves_keyring_refs_and_delegates_env_to_default`
    - `secret_host_request_stores_through_keyring`
    - `oauth_tokens_persist_through_keyring`
    - `unavailable_os_keyring_notes_status_and_fails_closed_without_plaintext_fallback`
    - `two_credentials_slot_claims_fail_closed_until_assigned`
    - `napi_keyring_not_loaded_unless_listed`
    - `keyring_package_passes_package_conformance`
    - `stored_secret_canary_never_leaks`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package; moved `prism-core` exports.
    - Docs pages to create/edit:
      - `packages/credentials/keyring/README.md`: package page structure, including the per-resolve cost and the no-plaintext-fallback rule.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Delete the `@arnilo/prism-providers` workspace
  - Acceptance Criteria:
    - Functional: `packages/prism-providers/` is deleted. Root `workspaces`, `scripts/package-truth.mjs`, the `packaging.test.ts` list, `scripts/budgets.json`, and the release package map drop it. Its compat baseline `arnilo__prism-providers.txt` is removed by the regeneration.
    - Functional: A repo-wide grep for `@arnilo/prism-providers` over `src/ packages/ apps/ scripts/ examples/ docs/ templates/` returns only the residue Task 1 allowed, such as `scripts/phase*-freeze` history. Exclusions as in Task 3.
    - Functional: `packages/prism-code/src/providers.ts` and `oauth.ts` import only provider packages and provider-kit. Their behaviour tests stay green.
    - Performance: n/a — deletion.
    - Code Quality: No re-export shim is left behind for the old package name.
    - Security: n/a — no new surface.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9 Retired ("deprecated on npm once their native replacements ship", Phase 11)
    - Options Considered:
      - Keep an empty `@arnilo/prism-providers` that re-exports the vendors until Phase 11. Rejected: an alias. npm deprecation in Phase 11 does not need the workspace.
    - Chosen Approach:
      - Delete it once the vendor tasks have emptied it.
    - API Notes and Examples:
      ```bash
      rg -l "@arnilo/prism-providers" src packages scripts examples docs templates
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/`: deleted.
      - Root `package.json`, `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/budgets.json`, the release package map.
      - `scripts/compat-baseline/`: regenerate, with the diff in the task note.
      - `CHANGELOG.md`: the `@arnilo/prism-providers` replacement note (packages listed).
    - References:
      - plan 147 Task 5 (deleting `packages/hooks`)
  - Test Cases to Write:
    - `no_workspace_imports_prism_providers` (an `rg` scan test, with the Task 1 allow-list)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the old family package leaves the tree.
    - Docs pages to create/edit:
      - `CHANGELOG.md`: Unreleased.
      - Released `/docs/provider-packages.md`: none — it describes 0.12.1 until Phase 11.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: The Anthropic model-switch example and the Phase 5 close
  - Acceptance Criteria:
    - Functional: `examples/anthropic-model-switch.ts` lists `@arnilo/prism-provider-anthropic` with `apiKey: "env:EXAMPLE_ANTHROPIC_KEY"`, set in-process, and a fake `fetch` installed through the package's test hook (Task 3 decides between a config `baseUrl` to a local `Bun.serve` and an exported factory option; default: `baseUrl` to a local fake server). It runs one turn on `anthropic/claude-sonnet-4-5`, then a second with `RunOptions.model: "anthropic/claude-haiku-4-5"`, and prints both model ids the server received.
    - Functional: The example imports only `@arnilo/prism`, `@arnilo/prism/testing`, and `@arnilo/prism-provider-anthropic`. It is added to the demo list of `examples_demos_run_to_completion_and_emit_no_secret`, to `examples/README.md`, and to `scripts/e2e-coverage.json`.
    - Functional: The task note records each Phase 5 Done criterion with its proof:
      - a host with no provider package reaches any OpenAI-compatible endpoint (plan 151 `examples/openai-compatible.ts`)
      - loading one provider package never evaluates another (`loading_one_provider_package_never_evaluates_another`, over all 21)
      - each provider package passes provider conformance (`<vendor>_passes_provider_conformance` × 21)
      - `agent.models.list()` never throws when no package offers discovery (plan 151 Task 1(i) and its test)
    - Functional: `docs/next/models.md` gains a "Provider packages" section listing the 21 packages and linking each README by path.
    - Performance: The example finishes in under 2 s.
    - Code Quality: No internal seam.
    - Security: The fake server asserts it received the key, and the demo gate's no-secret check asserts the key is not printed.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5 Examples and Done; plan 151 Task 7
    - Options Considered:
      - Call the real Anthropic API. Rejected: the execution gate runs offline.
    - Chosen Approach:
      - One example against a local fake Messages endpoint, then the Done record.
    - API Notes and Examples:
      ```ts
      const r2 = await session.run("again", { model: "anthropic/claude-haiku-4-5" });
      ```
    - Files to Create/Edit:
      - `examples/anthropic-model-switch.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts`: demo list.
      - `docs/next/models.md`: provider packages section. `CHANGELOG.md`.
      - `plans/README.md`: status for plans 151 and 152.
    - References:
      - plan 149 Task 7
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret`: extended.
    - `anthropic_model_switch_example_hits_both_models`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API — an example and docs.
    - Docs pages to create/edit:
      - `docs/next/models.md`: provider packages section.
      - `examples/README.md`: entry.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`: every `packages/providers/*` and `packages/credentials/keyring` suite green, and no failure outside the Task 1 baseline set.
- `bun test --timeout=0 src/__tests__/provider-kit.test.ts src/__tests__/provider-packages.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/anthropic-model-switch.ts && bun examples/openai-compatible.ts && bun examples/side-call.ts`
- The per-vendor `rg` sweeps and `rg -l "@arnilo/prism-providers"`, which return only the Task 1 residue.
- `node scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
