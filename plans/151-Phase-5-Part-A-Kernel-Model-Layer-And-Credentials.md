# Phase 5 Part A — Kernel model layer, provider-kit, and credentials slot

## Objectives

- Make the kernel's model layer match roadmap §2.1 and §2.2 `models/`:
  - the `ModelProvider` contract: `id`, streaming `generate`, optional `models()` discovery, and auth method descriptors
  - a provider registry
  - `ModelRef` parsing (`"vendor/model"` or an object)
  - retry and backoff
  - usage and stop-reason normalization
  - the built-in `openai-compatible` provider
- Resolve providers through one per-agent provider cache keyed by the model's provider id, so a run's `model` is never shadowed by a fixed provider. Retire `AgentConfig.provider`, `AgentConfig.providerSource`, and `RunOptions.providerSource`.
- Publish `@arnilo/prism/provider-kit`: SSE, HTTP transport, OpenAI-compatible wire mapping, a provider-package helper, and provider conformance. It replaces the `./providers/*` and `./testing/provider-conformance` subpaths. The mock provider lives in `/testing` as a package.
- Finish the `credentials` slot: the `env:` default resolver, `Secret` (renamed from `Credential`), secret storage, and OAuth token persistence through the slot. Secrets never appear in events, `inspect()`, or errors.
- Ship two of the three Phase 5 examples: an OpenAI-compatible endpoint with no packages, and a package making a side call through `models.client`.

## Expected Outcome

- `createAgent({ model: "openai-compatible/llama-3.3-70b" … })` or the §2.11 object form with `baseUrl` and `credential: "env:LOCAL_KEY"` reaches any OpenAI-compatible endpoint with no package installed.
- `AgentConfig.model` and `RunOptions.model` accept a `ModelRef`.
  - A string splits on its first `/`, so `"openrouter/anthropic/claude-sonnet-4-5"` is provider `openrouter`, model `anthropic/claude-sonnet-4-5`.
  - An unknown provider id fails closed when the run (or `agent.models.resolve`) needs it. The error names the id and the registered ids.
- A run with `RunOptions.model` on a different provider resolves that provider from the per-agent cache. There is no `provider` field left that could shadow it.
- `ModelProvider` replaces `AIProvider`, with no alias. Every caller in every workspace migrates in the same task.
- `@arnilo/prism/provider-kit` exports the transport, SSE, OpenAI-compatible wire mapping, `providerPackage`, and `providerConformance`. The subpaths `./providers/openai-compatible`, `./providers/transport`, `./providers/openai`, `./providers/schema`, `./providers/media`, and `./testing/provider-conformance` are gone.
- `@arnilo/prism/testing` exports `mockProvider(script)`, a `PackageInstance` that registers provider id `mock` and gives each call its own script step. The examples' `turns(...)` helper is deleted.
- `agent.models.list()` returns `[]`, never a throw, when no provider offers discovery and no model is configured as a discoverable entry. Task 1 records whether the configured model still appears.
- `docs/next/models.md`, `docs/next/provider-kit.md`, and the `credentials` section of `docs/next/slots.md` document the contract. `examples/openai-compatible.ts` and `examples/side-call.ts` run under the execution gate.

This plan is Part A of roadmap **Phase 5 — Models, providers, and credentials**. Task 1 is the phase review for both parts. It is required because this part changes kernel contracts (`ModelProvider`, `ModelRef`, `AgentConfig`/`RunOptions` model fields, the credentials slot) and publishes a new subpath.

[Part B (plan 152)](152-Phase-5-Part-B-Provider-Packages-And-Keyring.md) ports the 21 vendors from `@arnilo/prism-providers` to `@arnilo/prism-provider-<vendor>` packages and ships `@arnilo/prism-credentials-keyring`. Until Part B lands, `@arnilo/prism-providers` compiles against this plan's renamed contract, and its subpaths keep working.

Phases 4, 5, and 6 may run in parallel. Task 5 here (retiring `AgentConfig.provider`) rewrites `createAgent` calls in several hundred files, so it should not run concurrently with a sibling task that also edits many `createAgent` calls. Land it first, or rebase the sibling onto it.

Lab impact (probe 12): `packages/prism-code/src/providers.ts`, `oauth.ts`, and `credentials.ts` cannot be deleted yet, because the TUI must answer `host.ui` first (Phase 12). Their kernel imports migrate in each task here.

This plan does not ship a version bump, a publish, a `/docs` change, or any vendor package (Part B).

## Tasks

- [ ] Task 1: Phase 5 review — model layer, provider-kit, credentials (read-only, both parts)
  - Acceptance Criteria:
    - Functional: The Notes inventory every contract both parts touch, each citing §2.1, §2.2, §2.3, §2.6, or §2.9 and the current code at `file:line`:
      - `AIProvider` (`src/contracts-core/provider.ts:74-82`), `ProviderRequest` (`:64-72`), `ProviderStopReason` and `mapProviderStopReason` (`:89-96`, `src/provider-events.ts`), `ProviderResolver` (`:123`)
      - `ModelConfig` (`src/contracts-core/content.ts:119-130`), `createModelRegistry` (`src/models.ts`), `createProviderRegistry` and `createProviderResolver` (`src/providers.ts`)
      - provider resolution in the run path (`src/agent-session/session.ts:1060-1066`: a fixed `config.provider` wins over the run's model) and in packages (`src/packages/loader.ts:484-486`, `models.client` at `:539-544`), plus `agent.models` (`src/agent/models.ts`)
      - retry (`src/retry.ts`, `generateWithRetry` at `src/agent-session/session/provider-round.ts:221`)
      - the built-in provider (`src/providers/openai-compatible.ts:168`), transport (`src/providers/transport.ts`), and the root `exports` subpaths `./providers/*` and `./testing/provider-conformance`
      - credentials: `src/credentials.ts`, the slot default `createEnvRefCredentialResolver` (`src/slots/defaults.ts:8-22`), `CredentialResolver` / `Credential` / `CredentialRequest`, `PackageAPI.credentials.resolve`, and `host.ui` `secret` storage (plan 148)
      - `src/oauth-device-code.ts`, `refreshOAuthCredential`, and `revokeOAuthCredential` (`src/credentials.ts:91-118`). §2.1 puts OAuth flows outside the kernel.
      - the mock provider (`src/mock-provider.ts`), its whole-script replay behaviour, and the `turns(...)` helper in `examples/session.ts`, `examples/approval.ts`, and `examples/host-hooks.ts`
    - Functional: Classify each Phase 5 Scope bullet and record these decisions:
      - **(a) `ModelRef` shape.** §2.3 sketches `{ provider, model, options? }`; §2.11 shows `baseUrl` and `credential` on the object. Default: `ModelRef = string | ModelSpec`, where `ModelSpec` is the existing `ModelConfig` plus optional `options`, `baseUrl`, and `credential` (ref only, validated by `SECRET_REF`). That gives one model type, not two. The string form resolves through the provider's `models()` entry when present, and otherwise to bare `{ provider, model }`. Record as a roadmap amendment.
      - **(b) Retiring `AgentConfig.provider` / `providerSource`.** Count every setter with `graft grep` and `rg`, grouped by workspace. A rough count today: `providerSource` appears in 30 files and 110 hits, and direct mock-provider sites in about 105 files and 216 hits. Decide the codemod: `provider: P` becomes `packages: [providerPackage(P)]`, or `packages: [mockProvider(script)]` where `P` is a mock. Also decide `RunOptions.providerSource`, `AgentDefinitionResolutionContext.providerSource` (`src/contracts-core/agent.ts:52`), and `src/contracts-protocol.ts:83`.
      - **(c) Renaming `AIProvider` to `ModelProvider`.** 177 files and 560 hits. Decide whether to rename in this plan (default: yes, Task 2, one codemod, no alias).
      - **(d) Built-in `openai-compatible`.** It is registered by the kernel under the reserved id `openai-compatible`. A package registering that id fails closed (`provider_conflict`). `baseUrl` and `credential` come from the `ModelSpec`, and the credential resolves through the `credentials` slot on each request. Decide whether a host must pass `baseUrl` (default: yes; a missing one fails closed as `model_ref_invalid`).
      - **(e) Auth method descriptors.** Default: `ModelProvider.auth?: readonly AuthMethod[]`, where `AuthMethod` is either `{ kind: "api-key"; ref: string }` (the default ref, such as `env:ANTHROPIC_API_KEY`) or `{ kind: "oauth"; id: string; login(ctx: AuthContext): Promise<void> }`. `AuthContext` carries `host` and a `credentials` handle that stores through the slot. These are data for hosts (Phase 12 renders login). The kernel never runs a login on its own.
      - **(f) Credentials slot shape.** §2.5 says `resolve(ref, ctx)`; today the slot takes `resolve(request: CredentialRequest)` with `request.name` as the ref. Decide whether to reshape (default: yes, to `resolve(ref, ctx)`) and how storage works. Default: an optional `store?(ref, secret)` and `delete?(ref)`, which the `secret` host request and OAuth token persistence use. A resolver without `store` answers `unavailable` (plan 148 behaviour). Rename `Credential` to `Secret` (backlog P3, plan 146).
      - **(g) Provider-kit contents.** Kernel code: `src/providers/{transport,openai-compatible,openai-primitives,schema,media}.ts` and `src/testing/provider-conformance.ts`. Shared provider code in `packages/prism-providers/src/shared/` that Part B needs:
        - `anthropic-messages` (commandcode, hyper, opencode-go)
        - `openai-compat` thinking helpers (azure, bedrock, vertex)
        - `retry-http` (commandcode, hyper, neuralwatt)
        - `systemone*` (laya, typesafe, decisions)
        - `package.ts` (`vendorPackage`, used by every vendor)
        - `openai/responses.js`, which hyper, azure, bedrock, and commandcode import across the vendor boundary

        Per `prism.md` §1, wire code shared by providers goes in provider-kit. Default: Part A moves the kernel files and `vendorPackage` (renamed `providerPackage`). Part B Task 2 moves the vendor-shared wire code once its owners are packages. Record each item's destination.
      - **(h) OAuth flow helpers.** `src/oauth-device-code.ts` and the OAuth refresh and revoke helpers are used by OpenAI Codex and xAI (`packages/prism-providers/src/{openai,xai}/oauth.ts`) and by Prism Code (`packages/prism-code/src/oauth.ts`). Default: move them to provider-kit in Part A, because §2.1 says not in the kernel and at least two providers need them.
      - **(i) `agent.models.list()` with no discovery.** Phase 5 Done says "returns an empty list, not a throw, when no package offers discovery". Plan 149 makes `list()` always include the configured model. Decide whether that stays (default: yes; the list is never a throw, and it is empty only when nothing is configured, which cannot happen because `model` is required). Record that the Done criterion is met by "never throws".
      - **(j) Usage and stop-reason normalization.** Confirm where they live today (`mapProviderStopReason`, `Usage` accounting) and whether the `src/models/` module move (§2.2) is done in this plan. Default: move `models.ts`, `providers.ts`, `retry.ts`, `provider-events.ts`, and the model client into `src/models/`. That is an internal path change with no export change.
      - **(k) Prism Code impact.** List each `packages/prism-code` import this part changes (`providers.ts`, `oauth.ts`, `credentials.ts`, `headless.ts`, `tui/*`).
    - Functional: Record the current failing-test set of `bun test src packages` as this plan's baseline.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut both parts.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites the `graft` or `rg` command that produced it.
    - Security: List every path a secret takes: config refs, `ModelSpec.credential`, provider request headers, retry errors (`retry?.secrets`, `provider-round.ts:233`), `host.ui` `secret`, and OAuth tokens. Name the redaction or test that covers each one.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1, §2.2, §2.3, §2.5 (credentials slot), §2.6 (`models`, `credentials`), §2.9 providers row, §2.11 "Minimal host", Phase 5
      - plan 146 Task 5 (`models.client`), plan 148 (secret storage through the slot), plan 149 Further Actions (P2 provider `models()`)
    - Options Considered:
      - Two separate reviews, one per part. Rejected: Part B depends on (a), (e), (f), (g), and (h), so one review fixes them once.
    - Chosen Approach:
      - Run graft and rg per symbol, read the cited spans, and decide (a)–(k) with stop rules.
    - API Notes and Examples:
      ```bash
      graft callers createProviderResolver --depth all
      graft grep "providerSource"
      rg -c "\bAIProvider\b" src packages examples scripts templates
      ```
    - Files to Create/Edit:
      - `plans/151-Phase-5-Part-A-Kernel-Model-Layer-And-Credentials.md`: Notes and amendments only.
      - `plans/152-Phase-5-Part-B-Provider-Packages-And-Keyring.md`: amendments only, if a finding changes Part B.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §1–§3
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `ModelProvider` contract, `ModelRef`, and the `src/models/` module
  - Acceptance Criteria:
    - Functional: `AIProvider` is renamed `ModelProvider`, with no alias, and gains `auth?: readonly AuthMethod[]` per Task 1(e). `models?()` stays. Every caller in `src/`, `packages/`, `examples/`, `scripts/`, and `templates/` migrates in this task (Task 1(c) count).
    - Functional: `ModelRef` and `ModelSpec` per Task 1(a). `parseModelRef(ref)` returns a `ModelSpec`. These fail closed as `ModelRefError` with code `model_ref_invalid`:
      - an empty provider or model
      - a non-string `provider`
      - a `credential` that is not a ref
    - Functional: `AgentConfig.model` and `RunOptions.model` accept `ModelRef`. Every `ModelConfig`-typed reader inside the run gets the parsed `ModelSpec`. `agent.models.resolve(ref)` accepts a `ModelRef`.
    - Functional: The model layer moves under `src/models/` per Task 1(j). No export name changes except the rename.
    - Functional: A repo-wide grep for `\bAIProvider\b` over `src/ packages/ apps/ scripts/ examples/ docs/` returns nothing. Exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, the released `/docs` pages, and historical `CHANGELOG` sections.
    - Performance: `parseModelRef` runs once per `createAgent` and once per run that passes `RunOptions.model`, not per turn.
    - Code Quality: One model type (`ModelSpec` extends `ModelConfig`). The rename is a mechanical codemod with a word-boundary pattern.
    - Security: A `ModelSpec.credential` literal fails closed before any network request. A test asserts the literal is absent from the error message.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (`model: ModelRef`), §2.11 "Minimal host"; Task 1(a), (c), (e), (j)
      - `src/contracts-core/provider.ts`, `src/contracts-core/content.ts:119`, `src/agent/models.ts`
    - Options Considered:
      - Keep `AIProvider` and add a `ModelProvider` alias. Rejected: §1.4 forbids aliases.
      - A new `ModelRef` object type unrelated to `ModelConfig`. Rejected: two shapes carrying the same limits and capabilities.
    - Chosen Approach:
      - Rename, extend `ModelConfig` into `ModelSpec`, and parse at the edges.
    - API Notes and Examples:
      ```ts
      export type ModelRef = string | ModelSpec;
      export interface ModelSpec extends ModelConfig {
        readonly options?: JsonObject;
        readonly baseUrl?: string;
        readonly credential?: string; // env:NAME | keyring:name
      }
      parseModelRef("openrouter/anthropic/claude-sonnet-4-5"); // { provider: "openrouter", model: "anthropic/claude-sonnet-4-5" }
      ```
    - Files to Create/Edit:
      - `src/models/{ref.ts,registry.ts,providers.ts,retry.ts,events.ts,index.ts}`: new home per Task 1(j). The old `src/models.ts`, `src/providers.ts`, `src/retry.ts`, and `src/provider-events.ts` are moved.
      - `src/contracts-core/provider.ts`, `src/contracts-core/content.ts`, `src/contracts-core/agent.ts`, `src/contracts-run-state.ts` (`RunOptions.model`).
      - Every `AIProvider` caller (Task 1(c) list), including `packages/prism-providers/**`, `packages/prism-code/**`, and `packages/ag-ui/**`.
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/agent-surface-freeze.test.ts`, `src/__tests__/package-api-freeze.test.ts`: deliberate updates.
      - `scripts/compat-baseline/*.txt` for every touched workspace: `node scripts/release.mjs gate --update-baseline`, with the diff and its attribution in the task note.
      - `src/__tests__/model-ref.test.ts`: new.
      - `docs/next/models.md`: new (`ModelProvider`, `ModelRef`). `docs/next/agent.md`: `model` field. `CHANGELOG.md`.
    - References:
      - plan 149 Task 3 (rename codemod precedent)
  - Test Cases to Write:
    - `model_ref_string_splits_on_first_slash`
    - `model_ref_object_keeps_limits_and_capabilities`
    - `model_ref_rejects_empty_parts_and_literal_credential`
    - `literal_credential_never_appears_in_error`
    - `run_options_model_accepts_string_ref`
    - `model_provider_type_has_exactly_the_documented_members` (type-level)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the provider contract name and the model field types.
    - Docs pages to create/edit:
      - `docs/next/models.md`: new (API page structure).
      - `docs/next/agent.md`: `AgentConfig.model`, `RunOptions.model`.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The per-agent provider cache and the built-in `openai-compatible` provider
  - Acceptance Criteria:
    - Functional: One per-agent provider registry holds the kernel's built-in `openai-compatible` provider, then each package's providers in load order. The run path (`session.ts:1060-1066`), `models.client` (`loader.ts:539-544`), and `agent.models.resolve` all resolve through it by `ModelSpec.provider`. A duplicate id fails closed as `provider_conflict` (`PackageLoadError`), including a package that registers `openai-compatible`.
    - Functional: A run with `RunOptions.model` on another provider uses that provider. No configured provider can shadow it. A test runs two providers in one session and switches between them.
    - Functional: The built-in `openai-compatible` provider reads `baseUrl` and `credential` from the request's `ModelSpec`. It resolves the credential through the `credentials` slot per request, never at construction. A missing `baseUrl` fails closed as `model_ref_invalid`. An unresolvable credential fails the run with `credential_unavailable`, naming the ref but not a value.
    - Functional: Retry and backoff apply to `models.client` calls as well as run turns, with the same `AgentConfig.retry` policy. Usage and stop reasons are normalized through `mapProviderStopReason` on both paths.
    - Performance: The registry is built once per agent. Resolution is a map lookup. The built-in provider is constructed once and reads the credential per request, with no per-request object graph beyond the fetch.
    - Code Quality: One resolution function, shared by the session, `models.client`, and `agent.models`. `createProviderResolver` (`src/providers.ts:48-56`) is deleted here if Task 1(b) finds no caller outside the `providerSource` path. Otherwise Task 5 deletes it with that path.
    - Security: The resolved credential is added to the run's redaction set before the request, so a provider error that echoes the `Authorization` header is redacted. A test uses a fake endpoint that echoes headers in a 500.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5 ("per-run model switch through one per-agent provider cache, so a fixed provider never shadows a run's model"), §2.11 "Minimal host"
      - `src/packages/loader.ts:440-486`, `src/agent-session/session.ts:1050-1075`, `src/agent-session/session/provider-round.ts:221-260`, `src/providers/openai-compatible.ts:168`
    - Options Considered:
      - Construct the built-in provider per `ModelSpec`. Rejected: per-run construction, and a second cache to manage. Reading the spec per request is enough.
    - Chosen Approach:
      - One registry and one resolver, with the built-in provider registered first and conflicts failing closed.
    - API Notes and Examples:
      ```ts
      const agent = await createAgent({
        model: { provider: "openai-compatible", model: "llama-3.3-70b", baseUrl: "http://localhost:8080/v1", credential: "env:LOCAL_KEY" },
      });
      await (await agent.session()).run("hi", { model: "mock/other" }); // a package-registered provider
      ```
    - Files to Create/Edit:
      - `src/models/providers.ts`: the per-agent registry and resolver.
      - `src/packages/loader.ts`, `src/agent-session/session.ts`, `src/agent-session/session/provider-round.ts`, `src/agent/models.ts`, `src/agent-session/create-agent.ts`.
      - `src/providers/openai-compatible.ts`: spec-driven `baseUrl` and `credential`.
      - `src/__tests__/provider-cache.test.ts`, `src/__tests__/openai-compatible-builtin.test.ts`: new.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate if an export changed, with the diff in the task note.
      - `docs/next/models.md`: resolution and the built-in provider. `CHANGELOG.md`.
    - References:
      - plan 146 Task 5, plan 149 Task 5 (`agent.models`)
  - Test Cases to Write:
    - `run_model_switch_uses_the_runs_provider_not_a_fixed_one`
    - `package_registering_openai_compatible_fails_closed`
    - `builtin_openai_compatible_reads_base_url_and_credential_per_request`
    - `missing_base_url_fails_closed`
    - `unresolvable_credential_fails_run_naming_ref_not_value`
    - `provider_error_echoing_auth_header_is_redacted`
    - `models_client_retries_with_agent_retry_policy`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider resolution and the built-in provider.
    - Docs pages to create/edit:
      - `docs/next/models.md`: resolution, the built-in provider, retry.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: `@arnilo/prism/provider-kit` and provider conformance
  - Acceptance Criteria:
    - Functional: `@arnilo/prism/provider-kit` exports:
      - transport and SSE (`src/providers/transport.ts`)
      - the OpenAI-compatible wire mapping (`openai-compatible.ts`, `openai-primitives.ts`)
      - `schema` and `media` helpers
      - `providerPackage(name, providers)`, a `PackageInstance` that registers each provider in order. It generalizes `vendorPackage` (`packages/prism-providers/src/shared/package.ts:4`), which Task 5 deletes.
      - the OAuth helpers per Task 1(h): device code, refresh, and revoke
      - `providerConformance(factory, options)`, which composes the existing `assert*` functions of `src/testing/provider-conformance.ts`: stream shape, abort, tool-call deltas, header ownership, no secret leak, usage accounting, `models()` returning a valid list or being absent, and `auth` descriptors well-formed
    - Functional: The root `exports` entries `./providers/openai-compatible`, `./providers/transport`, `./providers/openai`, `./providers/schema`, `./providers/media`, and `./testing/provider-conformance` are deleted. All 98 + 70 importing files (Task 1 count) move to `@arnilo/prism/provider-kit` in this task. The kernel source moves to `src/provider-kit/`.
    - Functional: The kernel's built-in `openai-compatible` provider imports its wire mapping from `src/provider-kit/`. That is a kernel-internal import, not a package import, so the kernel-imports-no-package gate stays green.
    - Functional: A repo-wide grep (exclusions as in Task 2) for `@arnilo/prism/providers/` and `@arnilo/prism/testing/provider-conformance` returns nothing.
    - Performance: Importing `@arnilo/prism/provider-kit` does not import the agent runtime. A test checks the module graph.
    - Code Quality: provider-kit holds only wire code shared by providers (`prism.md` §1). No vendor name appears in it, and a test greps for the 21 vendor ids.
    - Security: `providerConformance` includes `assertNoSecretLeak` and the header-ownership check by default. A provider cannot opt out of them.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.2 (`provider-kit/` subpath), Phase 5 Subpaths; Task 1(g), (h)
      - `src/testing/provider-conformance.ts` (skeleton: `assertProviderStreamConforms:78`, `assertAbortIsObserved:91`, `assertNoSecretLeak:166`, `assertUsageAccounting:204`)
    - Options Considered:
      - Keep the `./providers/*` subpaths and add provider-kit beside them. Rejected: two paths to the same code, which is an alias.
    - Chosen Approach:
      - Move the files, delete the old subpaths, migrate the importers, and add one composed conformance entry point.
    - API Notes and Examples:
      ```ts
      import { providerConformance, readSseEvents, providerPackage } from "@arnilo/prism/provider-kit";
      test("conforms", () => providerConformance(() => createMyProvider({ fetch: fakeFetch }), { secrets: ["sk-test"] }));
      ```
    - Files to Create/Edit:
      - `src/provider-kit/{transport.ts,openai-compatible.ts,openai-primitives.ts,schema.ts,media.ts,oauth-device-code.ts,oauth.ts,conformance.ts,package.ts,index.ts}`: moved and new. `src/providers/` and `src/oauth-device-code.ts`: deleted.
      - `package.json`: `exports["./provider-kit"]`, with the six old entries deleted.
      - Every importer per Task 1 (`packages/prism-providers/**`, `packages/prism-code/**`, `src/__tests__/**`, `scripts/**`, `examples/**`).
      - `scripts/compat-baseline/arnilo__prism.txt` and a new `arnilo__prism-provider-kit.txt`, with the old subpath baselines removed: regenerate, with the diff in the task note.
      - `src/__tests__/provider-kit.test.ts`: new. `src/__tests__/provider-conformance.test.ts`: retargeted.
      - `src/__tests__/packaging.test.ts`: the subpath list.
      - `docs/next/provider-kit.md`: new. `CHANGELOG.md`.
    - References:
      - plan 147 Task 2 (`/testing` subpath precedent)
  - Test Cases to Write:
    - `provider_kit_exports_wire_helpers_package_helper_and_conformance`
    - `provider_kit_import_does_not_load_agent_runtime`
    - `provider_kit_names_no_vendor`
    - `builtin_openai_compatible_passes_provider_conformance`
    - `old_providers_subpaths_are_not_exported`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new subpath, and six removed.
    - Docs pages to create/edit:
      - `docs/next/provider-kit.md`: new (API page structure).
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Retire `AgentConfig.provider` / `providerSource`; the mock provider becomes a `/testing` package
  - Acceptance Criteria:
    - Functional: `AgentConfig.provider`, `AgentConfig.providerSource`, `RunOptions.providerSource`, and the other `providerSource` fields Task 1(b) lists are deleted, with no alias. A config carrying them throws a `TypeError` naming `packages` and `providers.register`, the same way plan 149 handled `store`.
    - Functional: `@arnilo/prism/testing` exports `mockProvider(script, { id? })`, a `PackageInstance` that registers a `ModelProvider` (default id `mock`). Each `generate` call consumes the next script step, so the `turns(...)` helper in the three Phase 3 examples is deleted. `createMockProvider` stays as the raw `ModelProvider` factory for provider unit tests (Task 1(b) decides whether it leaves the root export).
    - Functional: `vendorPackage` (`packages/prism-providers/src/shared/package.ts:4`) is deleted, and every vendor calls `providerPackage` from `@arnilo/prism/provider-kit` (Task 4).
    - Functional: Every caller migrates in this task with a codemod (Task 1(b) count): `provider: createMockProvider(x)` becomes `packages: [mockProvider(x)]` with the `model` provider set to `mock`, and `provider: P` becomes `packages: [providerPackage("<owner>", [P])]`. The hand fixes Task 1 lists are made here too. That covers `examples/`, `scripts/`, `templates/package/` (plan 150, if landed), every workspace, and the `/testing` conformance suites (`prefix-stability-conformance.ts:16-20`, `loop-conformance`).
    - Functional: A repo-wide grep (exclusions as in Task 2) for `providerSource`, `provider: createMockProvider`, and `\bprovider:\s` inside `createAgent`/`AgentConfig` literals returns only the Task 1 residue (`ModelConfig.provider` strings are not residue).
    - Performance: No change per run. The test suite's runtime is recorded before and after; a regression over 10% is investigated in the task note.
    - Code Quality: One way to give an agent a provider: a package. The mock is a package like any other.
    - Security: n/a for secrets — the mock carries none. The `TypeError` for removed fields carries no config values.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (`AgentConfig` has no `provider`), §2.6 (`providers.register`), Phase 5 Subpaths (the mock provider in `/testing`)
      - plan 149 Task 2 (the `store` codemod and its lossy-codemod finding), plan 149 Task 7 note (whole-script replay)
    - Options Considered:
      - Keep `AgentConfig.provider` for tests. Rejected: it is the field that shadows a run's model, and §1.4 forbids aliases.
      - Add `AgentConfig.providers: ModelProvider[]`. Rejected: §2.3 has no such field, and a package already does this.
    - Chosen Approach:
      - Delete the fields and run a codemod that checks its own output: re-parse each rewritten literal and assert the `model` and `packages` keys survive. Plan 149 Task 2 found a lossy codemod that dropped arguments.
    - API Notes and Examples:
      ```ts
      import { createAgent } from "@arnilo/prism";
      import { mockProvider } from "@arnilo/prism/testing";
      const agent = await createAgent({ model: "mock/demo", packages: [mockProvider([turnA, turnB])] });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-run-state.ts`, `src/contracts-protocol.ts`, `src/agent-definitions.ts:44-75`, `src/node/agent-definitions.ts:31,222`, `src/run-bundle.ts:135`.
      - `src/testing/mock-provider-package.ts` (new), `src/testing/index.ts`, `src/mock-provider.ts`.
      - `packages/prism-providers/src/shared/package.ts`: `vendorPackage` deleted; vendors call `providerPackage`.
      - Every caller per Task 1(b), including `examples/session.ts`, `examples/approval.ts`, `examples/host-hooks.ts` (the `turns` helper deleted), and `examples/define-package.ts`.
      - `src/__tests__/public-export-contract.test.ts`, the freeze tests, and `scripts/compat-baseline/*.txt`: regenerate, with the diff and its attribution in the task note.
      - `docs/next/agent.md`, `docs/next/testing.md` (`mockProvider`), `docs/next/models.md`. `CHANGELOG.md`.
    - References:
      - plan 149 Task 2 Notes ("Findings that affect later tasks")
  - Test Cases to Write:
    - `agent_config_provider_and_provider_source_are_rejected`
    - `mock_provider_package_gives_each_call_its_own_step`
    - `mock_provider_package_passes_package_conformance`
    - `provider_package_registers_every_provider_in_order`
    - `codemod_preserved_model_and_packages_keys` (a scan test over the rewritten files)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removes two `AgentConfig` fields and adds `mockProvider` / `providerPackage`.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: the removed fields.
      - `docs/next/testing.md`: `mockProvider`.
      - `docs/next/models.md`: giving an agent a provider.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The `credentials` slot — `Secret`, storage, and OAuth token persistence
  - Acceptance Criteria:
    - Functional: The `CredentialResolver` slot contract matches Task 1(f): `resolve(ref, ctx)`, plus optional `store?(ref, secret, ctx)` and `delete?(ref, ctx)`. `Credential` is renamed `Secret`, with no alias. `PackageAPI.credentials.resolve(ref)` returns `Promise<Secret | undefined>`.
    - Functional: The kernel default resolves `env:NAME` only, and has no `store`. A `secret` `host.ui` request against it answers `unavailable` (plan 148). A `keyring:` ref resolves to `undefined` under the default, so the asking package fails closed. A test covers this.
    - Functional: OAuth tokens persist through the slot. The provider-kit OAuth helpers (Task 4) take a `credentials` handle and call `store(ref, secret)` for refreshed tokens. `OAuthCredentialStore` and `RevocableOAuthCredentialStore` (`src/credentials.ts:102`) are deleted if Task 1(f) finds the slot covers them.
    - Functional: `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, and `createEnvCredentialResolver` (`src/credentials.ts`) are kept, reshaped, or deleted per Task 1(f), with their callers migrated.
    - Functional: A repo-wide grep (exclusions as in Task 2) for `\bCredential\b` as a type and for any deleted helper returns only the Task 1 residue.
    - Performance: `resolve` runs per request for the built-in provider, without caching. The cost note says so, and states that a caching resolver is a package's choice.
    - Code Quality: One slot contract, and the default is 15 lines or fewer.
    - Security:
      - A resolved secret is added to the agent's redactor (`secrets`, `src/packages/loader.ts:36`) before use.
      - Tests assert a secret never appears in events, `inspect()`, persisted entries, or thrown errors, using a canary value through the built-in provider and through `models.client`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.5 (credentials slot), §2.6 (`credentials.resolve` returns `Secret`), §1.4 (secrets stay at the edge), Phase 5 ("OAuth token persistence through the slot")
      - `src/slots/defaults.ts:8-22`, `src/credentials.ts`, plan 148 Task 2 (secret answers stored through the slot), backlog "Rename `Credential` to `Secret`"
    - Options Considered:
      - Keep a separate `OAuthCredentialStore`. Rejected: the roadmap persists tokens through the slot, and two stores would drift.
    - Chosen Approach:
      - Reshape the slot once, rename the type, and route OAuth persistence through `store`.
    - API Notes and Examples:
      ```ts
      export interface CredentialResolver {
        resolve(ref: string, ctx: CredentialContext): Secret | undefined | Promise<Secret | undefined>;
        store?(ref: string, secret: Secret, ctx: CredentialContext): Promise<void>;
        delete?(ref: string, ctx: CredentialContext): Promise<void>;
      }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/*` (credential types), `src/slots/defaults.ts`, `src/slots/types.ts`, `src/credentials.ts` (moved to `src/credentials/` per §2.2), `src/packages/api.ts`, `src/packages/loader.ts`, `src/host/*` (secret storage).
      - `src/provider-kit/oauth.ts`: persistence through the slot.
      - Callers: `packages/prism-providers/src/{openai,xai}/oauth.ts`, `packages/prism-code/src/{credentials,oauth,providers}.ts`, `packages/prism-core/src/credentials/node/*` (types only; the implementations move in Part B).
      - The freeze tests, `public-export-contract.test.ts`, and `scripts/compat-baseline/*.txt`: regenerate, with the diff and its attribution in the task note.
      - `src/__tests__/credentials-slot.test.ts`: new.
      - `docs/next/slots.md`: credentials section. `docs/next/packages.md`: `credentials.resolve` returns `Secret`. `CHANGELOG.md`.
    - References:
      - plan 148 Task 2
  - Test Cases to Write:
    - `env_default_resolves_env_refs_only`
    - `keyring_ref_under_default_resolves_undefined_and_package_fails_closed`
    - `secret_request_without_store_answers_unavailable`
    - `oauth_refresh_persists_through_slot_store`
    - `secret_canary_never_in_events_inspect_entries_or_errors`
    - `credentials_resolve_returns_secret_type` (type-level)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the slot contract and the `Secret` rename.
    - Docs pages to create/edit:
      - `docs/next/slots.md`: credentials slot, including the per-request cost note.
      - `docs/next/packages.md`: `credentials`.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Part A examples and the docs close
  - Acceptance Criteria:
    - Functional: `examples/openai-compatible.ts` starts a local `Bun.serve` fake OpenAI-compatible endpoint that requires a bearer token. It creates an agent with the §2.11 object `ModelRef` and `credential: "env:EXAMPLE_LOCAL_KEY"`, which the example sets for its own process. It runs one streamed turn and prints the text and `RunResult.status`. No package is listed.
    - Functional: `examples/side-call.ts` defines a package with the `models` capability that registers a tool. The tool calls `prism.models.client("mock/side").generate(…)` and returns the side model's text. It runs on two `mockProvider` packages (`main`, `side`), and the side provider receives exactly one call.
    - Functional: Both examples import only `@arnilo/prism` and `@arnilo/prism/testing`. Each is added to the demo list of `examples_demos_run_to_completion_and_emit_no_secret`, to `examples/README.md`, and to `scripts/e2e-coverage.json`.
    - Functional: `docs/next/models.md` and `docs/next/provider-kit.md` are complete in the API page structure, with implementation examples from these files.
    - Performance: Each example finishes in under 2 s.
    - Code Quality: No internal seam, and no deprecated export.
    - Security: The demo gate's no-secret check covers both. The fake endpoint asserts the bearer token arrived, and the printed output does not contain it.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5 Examples, §2.11 "Minimal host"; `examples/session.ts` (precedent)
    - Options Considered:
      - Reach a real local LLM server in the example. Rejected: the execution gate runs offline.
    - Chosen Approach:
      - An in-process fake endpoint and mock side model.
    - API Notes and Examples:
      ```ts
      const server = Bun.serve({ port: 0, fetch: fakeChatCompletions });
      const agent = await createAgent({ model: { provider: "openai-compatible", model: "demo", baseUrl: `${server.url}v1`, credential: "env:EXAMPLE_LOCAL_KEY" } });
      ```
    - Files to Create/Edit:
      - `examples/openai-compatible.ts`, `examples/side-call.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts`: demo list.
      - `docs/next/models.md`, `docs/next/provider-kit.md`: implementation examples. `CHANGELOG.md`.
    - References:
      - plan 149 Task 7
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret`: extended with both files.
    - `phase_5a_examples_import_only_prism_and_testing`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API — examples and docs.
    - Docs pages to create/edit:
      - `docs/next/models.md`, `docs/next/provider-kit.md`: implementation examples.
      - `examples/README.md`: two entries.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`: no failure outside the Task 1 baseline set.
- `bun test --timeout=0 src/__tests__/model-ref.test.ts src/__tests__/provider-cache.test.ts src/__tests__/openai-compatible-builtin.test.ts src/__tests__/provider-kit.test.ts src/__tests__/credentials-slot.test.ts`
- `bun test --timeout=0 src/__tests__/agent-surface-freeze.test.ts src/__tests__/package-api-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/openai-compatible.ts && bun examples/side-call.ts && bun examples/session.ts && bun examples/approval.ts && bun examples/host-hooks.ts`
- The Task 2, 4, 5, and 6 `rg` sweeps, which return only the Task 1 residue.
- `node scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
