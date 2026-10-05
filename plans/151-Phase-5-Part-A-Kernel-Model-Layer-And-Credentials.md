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

- [x] Task 1: Phase 5 review — model layer, provider-kit, credentials (read-only, both parts)
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
  - Notes (executed 2026-10-04):
    - **Verdict: proceed. No finding invalidates Tasks 2–7 or Part B.** Eight amendments below tighten Tasks 2–6; none re-cuts the plan. Part B (plan 152) needs no text change, because its Task 1 already re-derives the shared-module destinations and its Task 3 already uses `auth` + `ctx.credentials.store`.
    - **Baseline (working tree is dirty: 106 uncommitted paths from Phase 4 WIP).** `bun test --timeout=0 src packages` gives 34 unique failing test names, none related to model or credential code:
      - Prism Code: `--max-cost`, 100-tool-rounds, and 2 MCP-integration tests
      - ACP/stdio: 3 spawned-bin and real-provider journeys
      - `docs.test.ts`: 7 doc-matrix tests
      - packaging and install-smoke: `packaging guard` ×3, `install smoke` ×2, `packed-install host-composition`
      - run-lifecycle: 3 checkpoint tests, `passes only host active tools to provider`, `hooks.json run.end handlers`, `public contracts > host can configure agent…`
      - others: `scorePrefixStability` ×2, `snapshotRunBundle` ×2, `resolveAgentBundle > missing tool fails closed`, `optional package setup boundaries` ×3
      - Raw output was kept in the session scratchpad. A later task must not add to this set. Most are Phase 4 working-tree churn (`packaging`, `docs`, `install-smoke`).

    **Inventory** (every `file:line` re-read today; the plan's spans had drifted, corrected here)

    | Contract | Roadmap | Code today |
    | --- | --- | --- |
    | `AIProvider` {`id`, `generate`, optional `models()`} | §2.1, §2.2 | `src/contracts-core/provider.ts:74-82` |
    | `ProviderRequest` | §2.2 | `provider.ts:64-72`; `model: ModelConfig` |
    | `ProviderStopReason`, `mapProviderStopReason` | §2.1 (usage and stop-reason normalization) | `provider.ts:89-96`, `src/provider-events.ts:126` |
    | `ProviderResolver` | removed with `providerSource` | `provider.ts:123` |
    | `ModelConfig` | §2.3 | `src/contracts-core/content.ts:119-130` |
    | `createModelRegistry`, `createProviderRegistry`, `createProviderResolver` | §2.2 `models/` | `src/models.ts` (43 lines), `src/providers.ts:15,48` |
    | Run-path resolution | Phase 5 (no shadowing) | `src/agent-session/session.ts:1058-1068` (`config.provider ?? options.providerSource ?? config.providerSource ?? packages.provider(...)`) |
    | Package/host resolution | §2.6 `models.client` | `src/packages/loader.ts:487-492` (`resolveProvider`, same precedence), `models.client` at `:540-546`, `credentials.resolve` at `:549-558` |
    | `agent.models` | §2.3 | `src/agent/models.ts:15-48`; `resolve` demands an object |
    | Retry | §2.1 | `src/retry.ts` (policy), `provider-round.ts:221-258` (`generateWithRetry`); called only from `assemble.ts:523` |
    | Built-in provider | §2.1 | `src/providers/openai-compatible.ts:168` (`createOpenAICompatibleProvider`); `apiKey` is a `CredentialValueSource`, and the credential is resolved per `generate` at `:175` |
    | Subpaths | §2.2 | `package.json` exports `./providers/{openai-compatible,transport,openai,schema,media}` and `./testing/provider-conformance` |
    | Credentials | §2.5, §2.6 | `src/credentials.ts` (132 lines), slot default `src/slots/defaults.ts:8-22`, contracts `src/contracts-core/resources.ts:29-87` |
    | OAuth | §2.1 (out of kernel) | `src/oauth-device-code.ts` (214 lines), `credentials.ts:91-118`, root exports `src/index.ts:345-353,567-572` |
    | `host.ui` `secret` | §2.4 | `src/packages/loader.ts:360-390` (`askSecret`), `src/host/types.ts:36-73` |
    | Mock provider | §2.2 `/testing` | `src/mock-provider.ts` (19 lines), root export `src/index.ts:562` |

    **Findings that differ from the plan's premises**
    1. `CredentialResolver.store?(ref, value: string)` **already exists** (`resources.ts:41-49`, plan 148), and `askSecret` already calls it (`loader.ts:384`) and adds the value to `secrets`. Task 6 reshapes it to `store?(ref, secret: Secret, ctx)` plus `delete?`. It does not add `store`.
    2. `models.client` (`loader.ts:540-546`) calls `provider.generate` directly. It has **no retry, no redaction, no stop-reason handling**. Retry exists only in the session path (`generateWithRetry`, whose sole caller is `assemble.ts:523`). Task 3's "retry applies to `models.client`" is therefore new code, not a re-route. It must extract the retry loop from `session`, because `generateWithRetry` takes a `SessionHost`.
    3. `agent.models.list()` already never throws and always includes the configured model (`models.ts:34-35`). `publicModel` (`:10-13`) strips `parameters`, `compat`, and `metadata`. **Task 2 must also strip `baseUrl`, `credential`, and `options`** from `ModelSpec` listings, because an endpoint URL can carry userinfo or a tenant secret.
    4. `shared/openai-compat.ts:3` imports `../openai/models.js` (`openAIThinkingLevels`), a shared→vendor edge. Of the vendors, only hyper imports a sibling directly (`hyper/provider.ts:4` → `../openai/responses.js`). Plan 151 (g) said azure, bedrock, and commandcode import `openai/responses`. That is wrong: they import `shared/openai-compat` and `shared/anthropic-messages`. Part B Task 1 must move `openAIThinkingLevels` with `openai-compat`, or into provider-kit, before azure, bedrock, and vertex can lose the sibling edge.
    5. Outside `prism-providers`, only `packages/prism-core/src/credentials/node/{oidc,oauth2}.ts` import `@arnilo/prism/providers/transport` and the OAuth helpers (`abortableSleep`, `pollDeviceCodeToken`, `redactOAuthError`). They are not providers. They migrate to `@arnilo/prism/provider-kit` in Task 4, and Part B moves them with the keyring. `packages/mcp/src/auth.ts` only mentions `createOAuthCredentialStoreAdapter` in a comment and has no import to migrate.
    6. `turns(...)` is not "next step"; it clamps to the last script (`Math.min(turn++, length-1)`) at `examples/session.ts:13`, `approval.ts:24`, `host-hooks.ts:15`. Plan 149 Task 7 noted whole-script replay for `createMockProvider`. **`mockProvider(script)` must clamp to the last step** so the three examples keep their output, and a test pins it.
    7. `createEnvRefCredentialResolver` (`defaults.ts:8-22`) is already 15 lines and reads `request.name` as the ref. It reshapes to `(ref, ctx)` with the same body. The Task 6 "15 lines or fewer" criterion holds only if `Secret` metadata stays on the returned object.
    8. `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, and `createEnvCredentialResolver` (`credentials.ts:32-89`) are provider/`name`-keyed, not ref-keyed. They have no remaining kernel caller except `resolveCredentialValue` (`credentials.ts:124`, used by `openai-compatible.ts:175`).

    **Counts** (`rg -l/-c -g '!dist' -g '!node_modules' -g '!plans' <pattern> src packages examples scripts templates [docs]`; the docs column is outside Task 2's grep scope because `/docs` is excluded and `docs/next` is edited by hand)

    | Pattern | files / hits, code | docs files | Plan said |
    | --- | --- | --- | --- |
    | `\bAIProvider\b` | 161 / 544 (197 / 621 with docs) | 36 | 177 / 560 |
    | `providerSource` | 31 / 109 (src 15, prism-core 4, prism-code 6, examples 4, agent-sdk 1, scripts 1) | 25 | 30 / 110 |
    | `createMockProvider` | 155 / 495 (src 43, examples 48, memory 16, prism-code 15, agent-sdk 6, prism-core 9, scripts 7, coding-tools 5, integrations 3, others 4) | 30 | ~105 / 216 for direct sites |
    | `@arnilo/prism/providers/` | 62 / 90 (prism-providers 58, prism-core 2, scripts 1, src 1) | 28 | 98 |
    | `@arnilo/prism/testing/provider-conformance` | 54 / 55 (prism-providers 51, examples 1, scripts 1, src 1) | 17 | 70 |
    | `\bCredential\b` | 35 / 65 | — | — |
    | `vendorPackage` | 22 / 42 | — | — |
    | `OAuthCredentialStore` | 14 / 29 | — | — |

    The importer totals in the plan (98 + 70) are higher than today's 62 + 54 because the working tree has shrunk. Task 4 uses today's counts. Task 5's `provider:` setter sweep (a looser regex that also catches `ModelConfig.provider`) hit 76 files in `src` alone, so the codemod must be AST-based on the `createAgent`/`AgentConfig` literal, not regex.

    **Decisions**
    - **(a) `ModelRef` shape: accepted.** `ModelRef = string | ModelSpec`, `ModelSpec extends ModelConfig` with optional `options`, `baseUrl`, `credential` (ref only, `SECRET_REF`). The string form splits on the first `/` and resolves through the provider's `models()` entry when present, otherwise to bare `{ provider, model }`. **Roadmap amendment:** §2.3's `{ provider, model, options? }` becomes `ModelSpec`, with §2.11's `baseUrl` and `credential` on the same object (Task 2 edits `roadmap.md`).
    - **(b) Retiring `provider` / `providerSource`: accepted.** Sites to delete: `contracts-core/agent.ts:52` (`AgentDefinitionResolutionContext.providerSource`), `:65-66` (`AgentConfig.provider`, `.providerSource`), `contracts-protocol.ts:83` (`RunOptions.providerSource`), `agent-definitions.ts:69-71`, `node/agent-definitions.ts:31,222`, `session.ts:1058-1068`, `loader.ts:34,95-97,487-492`, `packages/api.ts:91` (doc comment), and `testing/prefix-stability-conformance.ts:16,20`. Codemod: `provider: P` → `packages: [providerPackage("<owner>", [P])]`; `provider: createMockProvider(x)` → `packages: [mockProvider(x)]`. It must **merge into an existing `packages` array** and **keep every other key**, and a scan test checks that (plan 149 Task 2's lossy codemod). **`createMockProvider` leaves the root export** and moves to `@arnilo/prism/testing`, because a kernel carrying a test double contradicts §2.2. `packages/prism-code/src/providers.ts:2` (its mock) re-imports it from `/testing`.
    - **(c) Rename `AIProvider` → `ModelProvider`: yes, Task 2, one codemod, no alias.** `graft callers createProviderResolver --depth all` and `rg` confirm 161 code files.
    - **(d) Built-in `openai-compatible`: accepted.** It is registered first and reserved. A package registering the id fails with `provider_conflict`. A missing `baseUrl` fails as `model_ref_invalid`. The credential is resolved through the slot per request.
    - **(e) Auth descriptors: accepted.** `ModelProvider.auth?: readonly AuthMethod[]`, with `{ kind: "api-key"; ref }` and `{ kind: "oauth"; id; login(ctx) }`. `AuthContext` = `{ host, credentials: { store, delete } }`. The kernel never runs `login`. Part B Task 3 already assumes this shape.
    - **(f) Credentials slot: accepted.** `resolve(ref, ctx)`, `store?(ref, secret, ctx)`, `delete?(ref, ctx)`; `Credential` → `Secret`. `PackageAPI.credentials.resolve` keeps accepting a string. The object `CredentialRequest` form is dropped. `OAuthCredentialStore` and `RevocableOAuthCredentialStore` are deleted (the slot's `store` and `delete` cover them). `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, and `createEnvCredentialResolver` are **deleted** as provider/`name`-keyed (finding 8); a caller that needs a memory store builds a `CredentialResolver` in 10 lines. `resolveCredentialValue` is deleted with the built-in provider's move to slot resolution.
    - **(g) Provider-kit contents.** Task 4 moves `src/providers/{transport,openai-compatible,openai-primitives,schema,media}.ts`, `src/testing/provider-conformance.ts`, and `vendorPackage` → `providerPackage`. Destinations for Part B Task 2 (confirming plan 152): `anthropic-messages.ts`, `openai-compat.ts` (with `openAIThinkingLevels`, finding 4), and `retry-http.ts` → provider-kit. `systemone*.ts` → provider-kit only if laya and typesafe stay two vendors. `openai/responses.ts` → provider-kit, because hyper imports it. `package.ts` → provider-kit in Task 4.
    - **(h) OAuth helpers → provider-kit in Part A Task 4: accepted.** The consumers are `prism-providers/{openai,xai}/oauth.ts`, `prism-code/src/oauth.ts`, and `prism-core/.../oauth2.ts`. Root exports `src/index.ts:345-353,567-572` are removed and baselines regenerated.
    - **(i) `agent.models.list()`: keep.** It never throws and includes the configured model (finding 3). The Phase 5 Done criterion is met by "never throws".
    - **(j) `src/models/` move: accepted.** Move `models.ts`, `providers.ts`, `retry.ts`, and `provider-events.ts`, with the model client factored out of `loader.ts`. `thinking.ts`, `usage-estimation.ts`, `provider-request-policy.ts`, and `cache-helpers.ts` stay (no roadmap line puts them in `models/`). Usage numbers are copied from the wire by each provider. The kernel normalizes only the stop reason (`provider-events.ts:126`) and charges usage through `recordProviderUsage` (`assemble.ts`).
    - **(k) Prism Code impact.** `providers.ts` (`AIProvider`, `createMockProvider`, `ModelConfig`, `ProviderEvent` from the root; also imports `CredentialResolver` from `./credentials.js`), `oauth.ts` (`OAuthCredentials`, `OAuthProvider`, `redactOAuthError`, `refreshOAuthCredential`, `revokeOAuthCredential` from the root → provider-kit), `credentials.ts` (`Credential`, `CredentialRecord`, `CredentialRequest`, `OAuthCredentials` → `Secret`; also `@arnilo/prism-core/credentials/node`), `headless.ts`, `acp.ts`, `web.ts`, `sessions.ts`, `observational-memory.ts`, `index.ts`, and `tui/{index,selection,commands}.ts` (`AIProvider`/`providerSource` hits), plus 18 `__tests__` files that build agents with `provider:`. 18 files hit `AIProvider`, 15 hit `createMockProvider`, 6 hit `providerSource`.

    **Secret paths**

    | Path | Redaction or test today | Gap for this plan |
    | --- | --- | --- |
    | Config refs | `SECRET_REF` guard, `src/packages/schema.ts:307` | none |
    | `ModelSpec.credential` | new | Task 2: `literal_credential_never_appears_in_error` |
    | Provider request headers | built-in puts the key in `authorization`/`api-key` (`openai-compatible.ts:175-200`), `secrets = [apiKey]`; `assertNoSecretLeak` and `assertProviderOwnedHeadersWin` in `provider-conformance.ts:146,166`; `openai-compatible.test.ts` | the resolved credential is not in the run's `requestSecrets` unless it came through `credentials.resolve`; Task 3 adds it to the set and tests an echoing 500 |
    | Retry errors | `provider-round.ts:233,241` redacts `requestSecrets` + `retry.secrets` | the `models.client` path has none (finding 2); Task 3 |
    | `host.ui` `secret` | `askSecret` (`loader.ts:360-390`) returns `value: undefined`, pushes to `secrets`; plan 148 tests | Task 6 canary |
    | OAuth tokens | `redactOAuthError` (`oauth-device-code.ts`), `credentials-redaction.test.ts`, `oauth-device-code.test.ts` | Task 6: persistence through `store`, canary across events, `inspect()`, entries, errors |
    | `inspect()` | `agent-inspect.test.ts` | Task 2 adds `ModelSpec` fields to the "never lists" assertion |

    **Amendments** applied below: Task 2 (strip `baseUrl`/`credential`/`options` from listings; `agent.models.resolve` accepts a string; roadmap §2.3/§2.11 edit; `createMockProvider` moves to `/testing`), Task 3 (extract the retry loop for `models.client`), Task 5 (AST codemod, clamp-to-last mock), Task 6 (delete the four `name`-keyed helpers and `resolveCredentialValue`).
- [x] Task 2: `ModelProvider` contract, `ModelRef`, and the `src/models/` module
  - Acceptance Criteria:
    - Functional: `AIProvider` is renamed `ModelProvider`, with no alias, and gains `auth?: readonly AuthMethod[]` per Task 1(e). `models?()` stays. Every caller in `src/`, `packages/`, `examples/`, `scripts/`, and `templates/` migrates in this task (Task 1(c) count).
    - Functional: `ModelRef` and `ModelSpec` per Task 1(a). `parseModelRef(ref)` returns a `ModelSpec`. These fail closed as `ModelRefError` with code `model_ref_invalid`:
      - an empty provider or model
      - a non-string `provider`
      - a `credential` that is not a ref
    - Functional: `AgentConfig.model` and `RunOptions.model` accept `ModelRef`. Every `ModelConfig`-typed reader inside the run gets the parsed `ModelSpec`. `agent.models.resolve(ref)` accepts a `ModelRef`.
    - Functional: The model layer moves under `src/models/` per Task 1(j). No export name changes except the rename.
    - Functional (Task 1 amendment): `createMockProvider` moves from the root export to `@arnilo/prism/testing` (Task 1(b)); `roadmap.md` §2.3 and §2.11 are edited to the `ModelSpec` shape (Task 1(a)); `agent.models.resolve` accepts a string; `agent.models.list()` strips `options`, `baseUrl`, and `credential` as well as `parameters`, `compat`, and `metadata` (`src/agent/models.ts:10-13`), with a test.
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
  - Notes (executed 2026-10-04):
    - **Changed.** `AIProvider` → `ModelProvider` (174 files, word-boundary sed; `\bAIProvider\b` now returns nothing outside released `/docs`, `docs/history`, and baselines). `models.ts`, `providers.ts`, `retry.ts`, `provider-events.ts` moved to `src/models/{registry,providers,retry,events}.ts`; new `src/models/ref.ts` (`parseModelRef`, `ModelRefError` extends `TypeError`, `resolveRunOptions`). New contract types `ModelSpec`, `ModelRef` (`content.ts`), `AuthMethod`, `AuthContext` (`provider.ts`), `ResolvedAgentConfig` (`agent.ts`), `ResolvedRunOptions` (`contracts-protocol.ts`). `createAgent` parses `config.model` once (an object ref keeps the host's own config object); `session.run`/`resume` parse `RunOptions.model` once at the edge, and the run internals take `ResolvedRunOptions`. `agent.models.resolve` and `models.client` accept a `ModelRef`; `list()` strips `options`, `baseUrl`, `credential`. Prism Code `headless.ts` parses before `enrichModelConfig`. Roadmap §2.3 edited to `ModelSpec`; §2.11 already had `baseUrl`/`credential`. Docs: `docs/next/models.md` (new), `docs/next/agent.md`, `CHANGELOG.md`.
    - **Tests.** `src/__tests__/model-ref.test.ts` (six listed cases, all pass); `agent-surface.test.ts` extended (list strips the new fields, string `resolve`); `agent-inspect.test.ts` asserts `ModelSpec` fields never reach `inspect()`; `public-export-contract` adds `ModelRefError`, `parseModelRef`; `core-boundaries` path follows the move. `bun run typecheck` green.
    - **Baseline diff** (`node scripts/release.mjs gate --update-baseline`, then `gate` clean): `arnilo__prism.txt` +`parseModelRef`, `ModelRefError`, `resolveRunOptions`; the moved modules' re-export lines now read `./models/*.js`; `AIProvider` → `ModelProvider` in signatures; `createAgentWith(input, …)`; `executeRun`/`generateWithRetry` take `ResolvedRunOptions`; `+CLI_PROVIDERS` is plan 150 drift that was never baselined, not this task. Also `prism-providers` (52 lines), `agent-sdk` (18), `prism-code` (4), `acp-agent` (2): all the rename only.
    - **Test baseline.** `bun test src` shows no new failures. The prism-code names that looked new (`tools.list is not a function`, `session.agent` undefined, skills disclosure) fail identically on a stash of HEAD, so Task 1's 34-name list undercounted; they are Phase 3/4 prism-code assembly breakage. `field policy microbenchmark` is timing-flaky.
    - **Findings for later tasks.** (1) `agent.models.resolve` is sync, so decision (a)'s "resolve through the provider's `models()` entry" cannot happen there; it returns the bare parsed `ModelSpec`. Task 3 may enrich in the run path if wanted. (2) `createMockProvider` stays in the root export until Task 5 (it moves with the codemod). (3) `AuthContext.credentials` is typed `{ store(ref, secret: string), delete(ref) }` now; Task 6 retypes it to `Secret` when the slot is reshaped. (4) Fixed provider (`AgentConfig.provider`) still wins over `RunOptions.model`; Task 3/5 remove that.

- [x] Task 3: The per-agent provider cache and the built-in `openai-compatible` provider
  - Acceptance Criteria:
    - Functional: One per-agent provider registry holds the kernel's built-in `openai-compatible` provider, then each package's providers in load order. The run path (`session.ts:1060-1066`), `models.client` (`loader.ts:539-544`), and `agent.models.resolve` all resolve through it by `ModelSpec.provider`. A duplicate id fails closed as `provider_conflict` (`PackageLoadError`), including a package that registers `openai-compatible`.
    - Functional: A run with `RunOptions.model` on another provider uses that provider. No configured provider can shadow it. A test runs two providers in one session and switches between them.
    - Functional: The built-in `openai-compatible` provider reads `baseUrl` and `credential` from the request's `ModelSpec`. It resolves the credential through the `credentials` slot per request, never at construction. A missing `baseUrl` fails closed as `model_ref_invalid`. An unresolvable credential fails the run with `credential_unavailable`, naming the ref but not a value.
    - Functional: Retry and backoff apply to `models.client` calls as well as run turns, with the same `AgentConfig.retry` policy. Usage and stop reasons are normalized through `mapProviderStopReason` on both paths.
    - Code Quality (Task 1 amendment): `models.client` has no retry or redaction today (`loader.ts:540-546`), and `generateWithRetry` takes a `SessionHost`. Extract the retry loop into `src/models/` so both paths share it, instead of copying it.
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
  - Notes (executed 2026-10-04):
    - **Changed.** One resolution function (`resolveProvider(model, runSource?)` in `src/packages/loader.ts`) serves the run (`session.resolveRunProvider`), `models.client`, and `agent.models.resolve`. The registry is the loader's `providerEntries`, seeded with the built-in `openai-compatible` (owner `kernel`), so a package registering that id fails `provider_conflict` with no new check. Order: a direct `AgentConfig.provider` whose id matches, the run's then the agent's `providerSource`, the registry, and last the direct provider for an unknown id (legacy; Task 5 deletes it with `provider`/`providerSource`). A fixed provider of another id no longer shadows `RunOptions.model`. New `src/models/builtin.ts` (`createBuiltinProvider`, `CredentialUnavailableError` with `code: "credential_unavailable"`) wraps `createOpenAICompatibleProvider`, which gained `resolveApiKey(request)`; `baseUrl` and `credential` come from the request's `ModelSpec` per request, `model_ref_invalid` on a missing `baseUrl`. `ProviderRequest.model` is now a `ModelSpec`. The credential lookup is `resolveCredentialRef`, shared with `PackageAPI.credentials.resolve`, and pushes the value into the agent's redaction set. Retry: `retryLoop`, `errorFromInfo`, and `mergeRetry` moved into `src/models/retry.ts`; `generateWithRetry` (run turns) and the new `models.client` path both use `retryLoop`. A `models.client` call retries only before its first event; later failures are redacted `error` events. `normalizeStopReason` (events.ts) puts `done.stopReason` on the closed taxonomy on both paths. `createProviderResolver` has callers on the `providerSource` path (examples, tests), so Task 5 deletes it. Docs: `docs/next/models.md`, `CHANGELOG.md`.
    - **Tests.** `provider-cache.test.ts` (`run_model_switch_uses_the_runs_provider_not_a_fixed_one`, `package_registering_openai_compatible_fails_closed`, `models_client_retries_with_agent_retry_policy`) and `openai-compatible-builtin.test.ts` (per-request `baseUrl` + credential, `missing_base_url_fails_closed`, `unresolvable_credential_fails_run_naming_ref_not_value`, `provider_error_echoing_auth_header_is_redacted`). The latter injects `fetch` through a new internal `CreateAgentInternals.fetch` seam, because `network-free-guard` forbids tests that touch `globalThis.fetch`. `package-contributions.test.ts` changed one assertion: the package's provider, not the fixed one, now answers a model on its id. `bun run typecheck` and `gate` are clean.
    - **Baseline diff.** `arnilo__prism.txt` gains the module-level exports `BUILTIN_PROVIDER_ID`, `CredentialUnavailableError`, `normalizeStopReason`, `retryLoop` (none are root exports of `index.ts`; `public-export-contract` still passes), `generateWithRetry` unchanged apart from Task 2's type; `createAgentWith` internals gain `fetch`. `CLI_PROVIDERS` is the plan 150 drift already noted under Task 2.
    - **Test baseline.** `bun test src`: the failures that were not already in Task 2's list were build-concurrent or timing flakes and pass in isolation (`agent-surface-freeze`, `examples_demos_run_to_completion_and_emit_no_secret`, context-meter and field-policy benchmarks, three `packaging guard` cases that depend on a finished build). The one real regression was `network-free-guard`, fixed by the seam above. The remaining failures are the pre-existing ones from Task 2 (`npm pack`, prism-code assembly).
    - **Findings for later tasks.** (1) `agent.models.resolve` still returns the bare parsed `ModelSpec` and picks the provider without consulting `models()`; no run-path enrichment was added. (2) Task 5 must delete the direct-provider branches in `resolveProvider` (two of the four lines) and the session fallback for an agent with no runtime. (3) `resolveCredentialValue` is still used by the `apiKey` option of `createOpenAICompatibleProvider` (vendors); Task 6 deletes it when the vendors move to slot refs. (4) `resolveApiKey` is a new option in the code Task 4 moves to provider-kit; it must move with it.

- [x] Task 4: `@arnilo/prism/provider-kit` and provider conformance
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
  - Notes (executed 2026-10-04):
    - **Changed.** `src/providers/*`, `src/oauth-device-code.ts`, and `src/testing/provider-conformance.ts` moved to `src/provider-kit/` (`conformance.ts` is the old testing file). New: `oauth.ts` (`refreshOAuthCredential`, `revokeOAuthCredential`, `RevocableOAuthCredentialStore`, moved out of `credentials.ts`), `package.ts` (`providerPackage(name, providers, description?)`, version from `KERNEL_VERSION`), and `index.ts` (`export *` of all). `conformance.ts` gains `assertModelsListValid`, `assertAuthDescriptorsWellFormed`, and `providerConformance(factory, options)`. The last requires a non-empty `secrets` and a `headers` block (`owned`, `caller`, `captured`), so the leak and header checks cannot be skipped. `usage` and `toolCalls` checks run when `expect.usage` or `toolCalls` are given. `package.json`: the six old exports are deleted and `./provider-kit` added; `tsconfig.packages.json` lost its provider-conformance path. All importers migrated (116 files via `@arnilo/prism/provider-kit`, plus root imports of the moved names in `packages/*`, with duplicate imports merged). The root no longer exports `pollDeviceCodeToken`, `abortableSleep`, `throwIfAborted`, `redactOAuthError`, `canonicalizeJsonSchema`, `refreshOAuthCredential`, `revokeOAuthCredential`, and the three OAuth types. Vendor names were scrubbed from provider-kit comments (OpenRouter, NeuralWatt, Azure, Z.AI, Codex). `docs/next/provider-kit.md` is new; `docs/provider-conformance.md`, `release-and-install.md`, `public-contracts.md`, and the other old pages carry the new specifier. `CHANGELOG.md` Unreleased. Also updated: `scripts/e2e-coverage.json`, `phase54-package-map.mjs`, the e2e journey fixture, `phase21-freeze.test.mjs` paths, `core-boundaries`, `public-export-contract`, and `docs.test.ts` expectations.
    - **Tests.** New `provider-kit.test.ts`: `provider_kit_exports_wire_helpers_package_helper_and_conformance`, `provider_kit_import_does_not_load_agent_runtime` (static value-import walk that ignores type-only and `import("…")` type expressions), `provider_kit_names_no_vendor`, `old_providers_subpaths_are_not_exported`, `builtin_openai_compatible_passes_provider_conformance`, plus negative cases (empty secrets, caller overriding auth, a leaking provider, malformed `auth`/`models()`) and `provider_package_registers_providers_in_order`. `provider-conformance.test.ts` now asserts the subpath moved. `bun run typecheck` and `gate` are clean.
    - **Baseline diff.** `arnilo__prism.txt`: removed `RevocableOAuthCredentialStore`, `OAuthTokenSuccessPayload`, `PollDeviceCodeTokenOptions` (root types; moved to provider-kit), and the changed `credentials.js` export lines; added `providerConformance`, `providerPackage`, `assertModelsListValid`, `assertAuthDescriptorsWellFormed`. The gate scans module-level exports of the one kernel package, not per subpath, so no separate `arnilo__prism-provider-kit.txt` exists (the plan's file is not needed; `manifest` and `testing` have none either).
    - **Sweep.** `@arnilo/prism/providers/` and `@arnilo/prism/testing/provider-conformance` return nothing over `src packages scripts examples docs` (excluding plans, history, evidence, `docs/next/provider-kit.md`'s removal note). Frozen history files (`phase21-baseline.json`, `phase21-freeze-manifest.json`, `phase25-dead-exports-raw.txt`) still cite the old `src/providers/` paths as historical records.
    - **Test baseline.** `bun test src packages`: 9357 pass, 181 fail. The failures are the pre-existing mid-migration set (packages calling `agent.session`, `activateKernel`, the stale snapshot copy under `packages/prism-code/node_modules/@arnilo/prism-core` that cannot resolve `@arnilo/prism/provider-kit`, ACP bin, docs-count drifts, phase21 count/roadmap checks, `e2e-coverage` for `./manifest`). `packages/prism-providers` passes in isolation (1340 pass).
    - **Findings for later tasks.** (1) `vendorPackage` still exists and is used by every vendor; Task 5 deletes it. `providerPackage` takes constructed providers, not a thunk, so vendors construct eagerly. (2) Part B Task 2 moves `anthropic-messages`, `openai-compat` (with `openAIThinkingLevels`), `retry-http`, `openai/responses`, and possibly `systemone*` into `src/provider-kit/`; add each to `index.ts` and re-run the vendor-name test. (3) `createOpenAICompatibleProvider`'s `apiKey` (via `resolveCredentialValue`) stays for Task 6. (4) The stale install copy under `packages/prism-code/node_modules` needs a reinstall to stop failing; unrelated to this plan.

- [x] Task 5: Retire `AgentConfig.provider` / `providerSource`; the mock provider becomes a `/testing` package
  - Acceptance Criteria:
    - Functional: `AgentConfig.provider`, `AgentConfig.providerSource`, `RunOptions.providerSource`, and the other `providerSource` fields Task 1(b) lists are deleted, with no alias. A config carrying them throws a `TypeError` naming `packages` and `providers.register`, the same way plan 149 handled `store`.
    - Functional: `@arnilo/prism/testing` exports `mockProvider(script, { id? })`, a `PackageInstance` that registers a `ModelProvider` (default id `mock`). Each `generate` call consumes the next script step, so the `turns(...)` helper in the three Phase 3 examples is deleted. `createMockProvider` stays as the raw `ModelProvider` factory for provider unit tests (Task 1(b) decides whether it leaves the root export).
    - Functional: `vendorPackage` (`packages/prism-providers/src/shared/package.ts:4`) is deleted, and every vendor calls `providerPackage` from `@arnilo/prism/provider-kit` (Task 4).
    - Functional: Every caller migrates in this task with a codemod (Task 1(b) count): `provider: createMockProvider(x)` becomes `packages: [mockProvider(x)]` with the `model` provider set to `mock`, and `provider: P` becomes `packages: [providerPackage("<owner>", [P])]`. The hand fixes Task 1 lists are made here too. That covers `examples/`, `scripts/`, `templates/package/` (plan 150, if landed), every workspace, and the `/testing` conformance suites (`prefix-stability-conformance.ts:16-20`, `loop-conformance`).
    - Functional: A repo-wide grep (exclusions as in Task 2) for `providerSource`, `provider: createMockProvider`, and `\bprovider:\s` inside `createAgent`/`AgentConfig` literals returns only the Task 1 residue (`ModelConfig.provider` strings are not residue).
    - Functional (Task 1 amendment): The codemod is AST-based on the `createAgent`/`AgentConfig` literal (a `provider:` regex also hits `ModelConfig.provider`), merges into an existing `packages` array, and keeps every other key. `mockProvider(script)` clamps to the last step once the script is exhausted, as the deleted `turns(...)` helpers do, and a test pins it. `createMockProvider` moves to `/testing`.
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
  - Notes (executed 2026-10-04):
    - **What changed.**
      - Deleted `AgentConfig.provider`, `AgentConfig.providerSource`, `RunOptions.providerSource`, `AgentDefinitionResolutionContext.providerSource`, `ResolveAgentBundleOptions.providerSource`, `LoadedPackages.resolveProvider`'s `runSource` argument, and the direct-provider branch of `resolveProvider` (`src/packages/loader.ts`). Resolution is now `providerEntries.get(model.provider)` and nothing else (`session.ts` `resolveRunProvider`).
      - `createAgent` throws `TypeError: AgentConfig.<field> was removed in Prism 1.0; list a package that registers the provider via AgentConfig.packages (providers.register) instead` for `provider` and `providerSource`. The message carries no config values. `defineAgent` (agent SDK) does the same through `AgentSdkConfigError`, and the SDK's own `provider` / `providerSource` fields are gone.
      - `src/testing/mock-provider-package.ts`: `mockProvider(script, { id?, onRequest? })`. `script` is `readonly (readonly ProviderEvent[])[]`, each `generate` call consumes the next step, and the last step repeats. `createMockProvider` is unchanged but **left the root export** (`src/index.ts`) for `@arnilo/prism/testing`. `packages/agent-sdk/src/index.ts` re-exports it from `/testing`.
      - `vendorPackage` is deleted. All 21 vendor entry points call `providerPackage(name, [providers], description)` (an AST-free text rewrite; the kimi block body and the alibaba trailing comma were fixed by hand). **Behaviour change:** the provider array is now built when the package factory is called, not inside `setup`.
      - Hand fixes the plan listed: `run-bundle.ts:135`, `agent-definitions.ts`, `node/agent-definitions.ts`, `prefix-stability-conformance.ts` (the fixture is installed as a `providerPackage`, and `model.provider` is pointed at the fixture id), `loop-conformance.ts`, `package-conformance.ts`, `host-composition.ts` (`hasProvider` removed; the missing-model error text is unchanged).
      - The `turns(...)` helper is deleted from `examples/session.ts`, `approval.ts`, and `host-hooks.ts`; each uses `mockProvider([...])`. `examples/manifest.ts` uses `mockProvider` with `onRequest` (docs.test pins that it imports only `/manifest` and `/testing`). `examples/provider-resolver.ts` now shows a host provider as a second package. `examples/tsconfig.json` mapped `@arnilo/prism/provider-kit` to the wrong declaration file (Task 4 residue); fixed.
    - **Codemod.** TypeScript 7 in `node_modules` has no JS API, so the codemod (`createAgent` / `defineAgent` / `createSecureAgent` / `createAgentWith` call, first-argument object literal) ran on TS 5 from the global bun install, in the session scratchpad. It rewrote 216 files: `provider: createMockProvider(E, O)` → `packages: [mockProvider([E], O')]` where `O'` adds `id` when the literal's `model` names another provider; any other `provider: P` → `packages: [providerPackage("test-provider", [P])]`; an existing `packages` array is merged (the rewritten literal is re-parsed and must keep no `provider` key and exactly one `packages` key). It also added imports (relative inside `src/`, `@arnilo/prism/{testing,provider-kit}` elsewhere) and dropped unused ones, and a second pass moved `createMockProvider` imports from the root to `/testing` in 62 files. Object literals built outside a call (`const config = { model, provider }`, `...agent.config` spreads, `SecureAgentOptions` helpers, code inside template strings in `install-smoke` and `post-publish-smoke`) were fixed by hand from typecheck and test failures. The scan test below locks the result; it skips three files whose literals sit inside template strings (`docs.test.ts`, `install-smoke.test.ts`, and itself).
    - **Findings that affect later tasks.**
      1. **A provider no longer serves every model id.** Before, `AgentConfig.provider` answered any `model.provider`. Now `P.id` must equal the model's provider id. About a dozen fixtures broke on this (`id: "mock-always-revising"`, `"compat-scripted"`, `"utf8-bytes"`, `"agent"`, `"prefix-stability-fixture"`) and were aligned by hand. The CHANGELOG entry says so. Task 7's examples and Part B's vendor tests must register the id they select.
      2. **Prism Code needs a forwarder.** It resolves a provider per run from `createProviderCache` (lazy, shared with `/compact` and OM). Task 5 adds `providerCachePackage(cache, extraIds?)` in `packages/prism-code/src/providers.ts`: one forwarding provider per `SHIPPED_PROVIDERS` id plus every id the cache holds at assembly, which primes on first use. `ProviderCache.ids()` was added and `providerSourceFor` is deleted. A provider id that is neither shipped nor seeded before assembly is unknown to the agent (the lab's `providers.ts` is deleted in Phase 12). A turn now reports `providerId` of the model's id (`mock`), not the underlying instance's id, and `model-switching.test.ts` was updated for that.
      3. **`createModelRouter().providerSource`** (`packages/prism-core/src/governance/model-router/`) is still a `ProviderResolver` facade that nothing consumes. It is not in Task 1(b)'s list; it goes with the model-router package in Phase 9. Recorded for the backlog handoff.
      4. **Local `node_modules` hid regressions.** `packages/*/node_modules/@arnilo/*/node_modules/@arnilo/prism` were 29 stale copies from 2026-10-02 (no `dist/provider-kit`), so every Prism Code test failed to load after Task 4 and the 62 Prism Code failures looked like baseline noise. They were replaced with symlinks to the repo root (gitignored, environment only). `bun install` was not run: the lockfile would change because `package.json` carries earlier uncommitted work.
      5. Plan 150's `templates/package/` has no `provider:` setters, so it needed no change.
    - **Verification.**
      - `bun run typecheck` (build, every workspace, `tsc -p examples`) is clean. `node scripts/release.mjs gate` passes after `--update-baseline`.
      - `bun test --timeout=0 src packages`: 33 unique failing names, every one in the Task 1 baseline groups (Prism Code ×3, ACP/stdio ×3, docs ×7, packaging ×3, install-smoke ×2, packed-install ×1, run-lifecycle ×6, `scorePrefixStability` ×2, `snapshotRunBundle` ×2, `resolveAgentBundle`, optional-package ×3). No name was added.
      - New tests, all passing: `agent_config_provider_and_provider_source_are_rejected` (`agents.test.ts`), and in `src/__tests__/mock-provider-package.test.ts` `mock_provider_package_gives_each_call_its_own_step`, `mock_provider_package_registers_its_id_and_reports_requests`, `mock_provider_package_passes_package_conformance`, `provider_package_registers_every_provider_in_order`, `codemod_preserved_model_and_packages_keys`.
      - Retirement sweep (`rg` over `src packages scripts examples templates docs/next`, excluding `dist`, the baseline files, and the released `docs/*.md` pages): `providerSource` remains only in the removal checks and their tests, the model-router facade (finding 3), and `docs.test.ts` assertions about released pages. `vendorPackage` and `provider: createMockProvider` inside an agent literal return nothing; the remaining `provider: createMockProvider` hits are the LLM compactor and OM worker options and the provider-conformance helpers.
      - Runtime: the pre-change run was not taken on a clean tree (the baseline run was killed after the kernel edits began). `bun test src packages` takes 121–125 s now against 216 s on the first post-codemod run (62 Prism Code files failed to load then), so no regression is evidenced.
    - **Baseline diff (`scripts/compat-baseline`, accumulated with Tasks 2–4).** Removals attributed to this task: `@arnilo/prism` loses `createMockProvider` and `MockProviderOptions` (moved to `/testing`); `@arnilo/prism-agent-sdk` re-exports `createMockProvider` from `@arnilo/prism/testing`; `@arnilo/prism-code` loses `providerSourceFor` and gains `providerCachePackage`; `@arnilo/prism-providers` loses nothing publicly (`vendorPackage` was internal). Added: `mockProvider` and `MockProviderPackageOptions` on `/testing`.
    - **Docs.** `docs/next/agent.md` (examples use packages), `docs/next/models.md` (removed fields, `providerPackage` and `mockProvider` snippet), `docs/next/packages.md` (`providers.register`), `docs/next/testing.md` (`mockProvider`), and the CHANGELOG entry. Released pages under `docs/*.md` still describe `providerSource`; they are the 0.12 contract and move with Task 7's docs close.
- [x] Task 6: The `credentials` slot — `Secret`, storage, and OAuth token persistence
  - Acceptance Criteria:
    - Functional: The `CredentialResolver` slot contract matches Task 1(f): `resolve(ref, ctx)`, plus optional `store?(ref, secret, ctx)` and `delete?(ref, ctx)`. `Credential` is renamed `Secret`, with no alias. `PackageAPI.credentials.resolve(ref)` returns `Promise<Secret | undefined>`.
    - Functional: The kernel default resolves `env:NAME` only, and has no `store`. A `secret` `host.ui` request against it answers `unavailable` (plan 148). A `keyring:` ref resolves to `undefined` under the default, so the asking package fails closed. A test covers this.
    - Functional: OAuth tokens persist through the slot. The provider-kit OAuth helpers (Task 4) take a `ref` and a `store`/`delete` sink and call `store(ref, secret, ctx)` for refreshed tokens (Task 6 amendment: the sink is `OAuthCredentialSink`, and `oauthCredentialsToSecret`/`secretToOAuthCredentials` encode the tokens). `OAuthCredentialStore` and `RevocableOAuthCredentialStore` (`src/credentials.ts:102`) are deleted.
    - Functional: `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, and `createEnvCredentialResolver` (`src/credentials.ts`) are kept, reshaped, or deleted per Task 1(f), with their callers migrated.
    - Functional (Task 1 decision, amended in execution): `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, and `createEnvCredentialResolver` are deleted, along with `OAuthCredentialStore` and `RevocableOAuthCredentialStore`. `store` already exists on the slot (`resources.ts:41-49`); this task reshapes it to `store(ref, secret, ctx)` and adds `delete`. **Amendment:** `resolveCredentialValue`, `CredentialValueSource`, and `CredentialRequest` are **kept** in `src/credentials/legacy.ts`, because the 21 vendor packages and `packages/memory` still call `resolveCredentialValue` with a name-keyed `CredentialRequest`; Part B Task 3/4 deletes them when the vendors move to slot refs. Deleting them now would break every vendor package. The `src/credentials/` module holds `env.ts` (the default) and `legacy.ts` (this temporary vendor bridge).
    - Functional: A repo-wide grep (exclusions as in Task 2) for the four deleted helpers and for `OAuthCredentialStore`/`RevocableOAuthCredentialStore` returns only the Task 1 residue (`ForgeCredentialResolverSource`, prism-core's own `ExtendedOAuthCredentialStore`, released `/docs` text). `resolveCredentialValue`/`CredentialValueSource` remain and are deleted in Part B.
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
    - `models_client_canary_never_leaks` (added in execution: the plan named the built-in provider only)
    - `credentials_resolve_returns_secret_type` (type-level)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the slot contract and the `Secret` rename.
    - Docs pages to create/edit:
      - `docs/next/slots.md`: credentials slot, including the per-request cost note.
      - `docs/next/packages.md`: `credentials`.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-04):
    - **Changed.**
      - Contracts (`src/contracts-core/resources.ts`): `Credential` → `Secret` with no alias; `CredentialResolver` is now `resolve(ref, ctx)`, optional `store?(ref, secret, ctx)`, optional `delete?(ref, ctx)`; new `CredentialContext { package?, signal? }`. `OAuthCredentialStore` is deleted and `OAuthProvider.getCredential` returns `Secret`. `CredentialRequest`, `CredentialRecord`, and `CredentialValueSource` are kept (see the amendment below).
      - `src/credentials.ts` moves to `src/credentials/`: `env.ts` (`createEnvRefCredentialResolver`, 14 lines, `env:NAME` only, no `store`), `legacy.ts` (`CredentialValueSource`, `CredentialRecord`, `resolveCredentialValue`), `index.ts`. `src/slots/defaults.ts` imports the default from `../credentials/index.js` and `src/slots/index.ts` re-exports it from there.
      - Loader (`src/packages/loader.ts`): `resolveCredentialRef(ref, ctx)` calls `resolver.resolve(ref, ctx)` and pushes `secret.value` into `secrets`; `askSecret` wraps the host's string answer as `{ type: "api_key", value }` and calls `resolver.store(ref, secret, { package: owner })`; `PackageAPI.credentials.resolve(ref)` is string-only and returns `Secret | undefined`. The built-in provider's `resolveCredential` is unchanged in shape, now `Secret`.
      - provider-kit (`src/provider-kit/oauth.ts`): `refreshOAuthCredential`/`revokeOAuthCredential` take `{ provider, credentials, ref, sink?, ctx? }` where `OAuthCredentialSink` is `{ store?, delete? }` (a `CredentialResolver` satisfies it); `oauthCredentialsToSecret`/`secretToOAuthCredentials` encode/decode the tokens (access in `value`, refresh/expires/accountId in `metadata`).
      - Prism Code: `packages/prism-code/src/{credentials,oauth,web}.ts` follow the `Secret` rename, the `ref`/`sink` OAuth shape, and a web credential source typed for the legacy `CredentialValueSource`.
      - Prism Core: `packages/prism-core/src/credentials/node/{encrypted-store,file-store,vault,types}.ts` use `Secret`; `resolver.ts` reshapes `createStoredCredentialResolver` to `resolve(ref, ctx)` and adds `createOAuthCredentialSink(store, provider, accountId?)`; `work-token.ts` refreshes through it.
      - Docs: `docs/next/slots.md` (contract, `store`/`delete`, per-request cost note), `docs/next/packages.md` (`credentials.resolve` returns a `Secret`), `docs/settings-auth-trust-security.md` (the released security page's credential helpers were deleted, so its example and related-APIs list now show the slot contract), `CHANGELOG.md`.
    - **Amendment — `resolveCredentialValue`/`CredentialValueSource` are not deleted here.** The plan said delete them with the built-in provider's move to slot resolution, but the 21 vendors in `packages/prism-providers` and `packages/memory` still call `resolveCredentialValue(source, { name, provider })`; the vendors move to slot refs in Part B Task 3/4. Deleting them now would break the tree. They live in `src/credentials/legacy.ts` and Part B deletes them. `CredentialRequest` is kept for the same reason (prism-core's name-keyed stores still address records by it). Task 6's sweep therefore checks the four deleted helpers and the two OAuth-store types, not `resolveCredentialValue`.
    - **Findings for later tasks.**
      1. **`createStoredCredentialResolver` is lossy.** The slot ref is a string, so the bridge passes `{ name: ref }` and drops the old `provider` scope; a provider-scoped record is not found. The prism-core test was changed to a providerless record. Part B Task 7's keyring package owns the real ref-keyed store.
      2. **OAuth tokens are `Secret`-encoded.** `oauthCredentialsToSecret` puts the access token in `value` (so the kernel redactor masks it) and refresh/expires/accountId in `metadata`; the refresh token in metadata is not pushed to the kernel redactor by `resolve`. A caller that echoes a refresh token in an error must redact it itself (prism-code and prism-core keep their own `redactOAuthError`).
      3. **Stale `dist/` hid removed exports from the baseline.** The kernel's `dist/credentials.d.ts` (and `dist/models.d.ts`, `dist/providers.d.ts`, `dist/retry.d.ts`, `dist/provider-events.d.ts`) survived the source moves, so `release.mjs gate` still recorded `createMemoryCredentialStore` etc. as exported. After `rm -rf` of every workspace `dist/` and a clean `bun run build`, the baseline drops them; the gate is clean. Any later task that deletes a source file must clean `dist/` before regenerating the baseline.
      4. `AgentEvent` has no bare `error` member; the new models.client canary test records thrown errors as `unknown`, not `AgentEvent`.
    - **Verification.**
      - `bun run typecheck` (build every workspace + `tsc -p examples`) is clean. `node scripts/release.mjs gate` passes after `--update-baseline` on a clean `dist/`.
      - New `src/__tests__/credentials-slot.test.ts`: `env_default_resolves_env_refs_only`, `keyring_ref_under_default_resolves_undefined_and_package_fails_closed`, `secret_request_without_store_answers_unavailable`, `oauth_refresh_persists_through_slot_store`, `secret_canary_never_in_events_inspect_entries_or_errors`, `models_client_canary_never_leaks`, `credentials_resolve_returns_secret_type` — all pass. `slot-registry`, `host-ui`, `public-contracts`, `credentials-redaction`, `settings-security`, `openai-compatible-builtin`, `package-contributions`, `agent-inspect`, `public-export-contract` updated and passing.
      - `bun test --timeout=0 src`: the same 33 unique failing names as Task 1/5's baseline (Prism Code ×3, ACP/stdio ×3, docs ×7, packaging ×3, install-smoke ×2, packed-install ×1, run-lifecycle ×6, `scorePrefixStability` ×2, `snapshotRunBundle` ×2, `resolveAgentBundle`, optional-package ×3). No new name. `packages/prism-core` credentials tests: 80 pass. `packages/prism-providers` openai/xai: 125 pass; the one `loading_one_vendor_never_evaluates_another` failure is cwd-dependent and passes from the repo root.
      - Sweep (`rg` over `src packages examples scripts templates docs/next`): the four deleted helpers and `OAuthCredentialStore`/`RevocableOAuthCredentialStore` return only `ForgeCredentialResolverSource` (forge's own mirror), prism-core's `ExtendedOAuthCredentialStore`, and released-`/docs` assertions. `\bCredential\b` as a type returns only messages, comments, and the AWS SigV4 `Credential=` literal.
    - **Baseline diff (`scripts/compat-baseline`, Task 6 attribution on a clean build).** `arnilo__prism.txt` loses `createChainedCredentialResolver`, `createEnvCredentialResolver`, `createExplicitCredentialResolver`, `createMemoryCredentialStore`, `MemoryCredentialStore`, `RevocableOAuthCredentialStore`; `CredentialRecord`/`CredentialValueSource` now come from `./credentials/index.js`; adds `oauthCredentialsToSecret` and `secretToOAuthCredentials` (`Secret`, `CredentialContext`, and `OAuthCredentialSink` are star-re-exported contract types, so the extractor does not list them). `arnilo__prism-core.txt` adds `createOAuthCredentialSink` and `getCredentialEntry` returns `Secret`. `prism-code`, `prism-providers`, `agent-sdk`, and `acp-agent` changes are the accumulated Tasks 2–5 rename/move plus this task's `Secret`/OAuth-sink follow-through.

- [x] Task 7: Part A examples and the docs close
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
  - Notes (executed 2026-10-04):
    - **Changed.**
      - `examples/openai-compatible.ts` (new): loopback `Bun.serve` fake Chat Completions endpoint that 401s without `Authorization: Bearer`, a `ModelSpec` object with `baseUrl: ${server.url}v1` and `credential: "env:EXAMPLE_LOCAL_KEY"`, one streamed turn and a second `RunResult`, and the endpoint asserting the bearer arrived. Imports only `@arnilo/prism`.
      - `examples/side-call.ts` (new): a `models`-capability `definePackage` whose `ask_side` tool calls `prism.models.client("side/side")` mid-turn on two `mockProvider` packages (`main`, `side`), with the side provider called exactly once (`onRequest` counter). Imports only `@arnilo/prism` and `@arnilo/prism/testing`.
      - `examples/README.md`: both files in the run list and the Files list; `openai-compatible.ts` is marked Bun-only because of `Bun.serve`.
      - `src/__tests__/docs.test.ts`: both files added to the `examples_demos_run_to_completion_and_emit_no_secret` demo list, plus `phase_5a_examples_import_only_prism_and_testing` and `phase_5a_examples_cover_the_builtin_provider_and_a_side_call`.
      - `scripts/e2e-coverage.json`: both examples added to the `@arnilo/prism` `.` suites.
      - `docs/next/models.md` and `docs/next/provider-kit.md`: rewritten to the API page structure (`What it does`, `When to use it`, `Inputs / request`, `Outputs / response / events`, `Request/response example`, `Implementation example`, `Extension and configuration notes`, `Security and performance notes`, `Related APIs`), with implementation examples from `examples/openai-compatible.ts` and `examples/side-call.ts`. `provider-kit.md` keeps its export table and `Removed` section.
      - `CHANGELOG.md`: one `Unreleased > Added` bullet.
    - **Fixes while closing (pre-existing, not Task 7 fallout).** The examples-execution gate was red on `examples/behavior-evaluation.ts` and `examples/guardrail-packs.ts`: the Task 5 `provider:` → `providerPackage` migration left their provider id (`mock-behavior-provider`, `guardrail-packs-mock`) different from `model.provider` (`mock`), so the run failed as unknown provider. Set both provider ids to `mock` to match the model ref. The e2e-coverage gate was red on the plan 150 `./manifest` and `./manifest/schema.json` surfaces (unannotated) and a stale `summary.total` of 113; annotated both with their manifest suites and set the count to 110 (114 − the retired plan 147 extension subpath − the five `./providers/*` + `./testing/provider-conformance` (Task 4) + `./provider-kit` and the two `./manifest` surfaces).
    - **Compromise.** The examples tsconfig is Node-typed (`bun-types/test.d.ts` only), so `examples/openai-compatible.ts` declares the one Bun global it uses (`declare const Bun: { serve(...) }`) instead of pulling full `bun-types` into the examples project, which would have made `typeof fetch` require `preconnect` and broken ten unrelated examples. If a later task wants real Bun types in examples, change the shared tsconfig deliberately.
    - **Verification.** `bun run typecheck` clean (all 12 workspaces + `tsc -p examples`). `bun test --timeout=0 src/__tests__/{model-ref,provider-cache,openai-compatible-builtin,provider-kit,credentials-slot,agent-surface-freeze,package-api-freeze,kernel-imports-no-package,public-export-contract}.test.ts`: 260 pass, 0 fail. `bun test src/__tests__/docs.test.ts`: the two new tests and the demo test pass; the same 7 Task 1-baseline failures remain. `bun test scripts/examples-execution.test.mjs`: 2 pass (66 spawned, 1 skipped). `bun test scripts/e2e-coverage.test.mjs`: 8 pass. Both examples run in ~75 ms each (`bun examples/openai-compatible.ts` → `sawBearer: true`; `bun examples/side-call.ts` → `sideCalls: 1`, `sideText: "side answer"`). `node scripts/release.mjs gate`: clean, no update.

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

- **`resolveCredentialValue`/`CredentialValueSource`/`CredentialRequest` survive Task 6.** They live in `src/credentials/legacy.ts` and stay root-exported because the 21 `@arnilo/prism-providers` vendors and `packages/memory` still call them; Part B Task 3/4 deletes them when the vendors move to slot refs. Deleting them in Part A would have broken every vendor package for the whole of Part B's build-up. Recorded as an amendment in Task 6 and as a Task 1 bullet in plan 152.
- **`createStoredCredentialResolver` is lossy.** The slot ref is a string, so the prism-core bridge passes `{ name: ref }` and drops the old `provider` scope; a provider-scoped record is no longer found. The prism-core test was changed to a providerless record. Part B Task 7's keyring package owns the real ref-keyed store.
- **OAuth refresh tokens are not in the kernel redactor.** `oauthCredentialsToSecret` keeps the access token in `Secret.value` (redacted) and puts `refresh`/`expires`/`accountId` in `metadata`; a caller that echoes a refresh token in an error must redact it itself (prism-code and prism-core keep their own `redactOAuthError`).
- **Bun types in examples.** `examples/openai-compatible.ts` declares the one Bun global it uses rather than enabling full `bun-types` for the examples project (which would break ten unrelated `fetch` stubs).
- **Pre-existing gates closed, not caused by Part A.** `examples/behavior-evaluation.ts` and `examples/guardrail-packs.ts` provider-id mismatch (Task 5 residue) and the plan 150 `./manifest` e2e-coverage annotation and surface count were fixed here because Part A's close runs the whole gate.

## Further Actions

- **Part B (plan 152) must delete the legacy credential helpers.** `resolveCredentialValue`, `CredentialValueSource`, and `CredentialRequest` in `src/credentials/legacy.ts`, plus the root exports, go when the vendors and `packages/memory` use slot refs (plan 152 Task 1 bullet). `packages/prism-providers` deletion also removes the cwd-dependent `loading_one_vendor_never_evaluates_another` failure.
- **Clean `dist/` before regenerating the release baseline.** A deleted or moved source file leaves a stale `dist/*.d.ts`, and the compat-baseline extractor scans `dist/`, so removed exports linger in `scripts/compat-baseline/*.txt` and a clean CI build would then fail the gate. Either clean `dist/` in the build script or make the extractor skip stale files (priority: medium; the Task 6 note records the full stale-file list).
- **`createStoredCredentialResolver` provider scope.** Decide whether the prism-core bridge should reject a ref it cannot map or keep the lossy name-only behavior until Part B Task 7 replaces it (priority: low; Part B owns it).
- **`AgentEvent` error test helper.** The models.client canary test records thrown errors as `unknown` because the frozen 23-name catalog has no bare `error` event; if `/testing` gains a helper for a failed `models.client` call, the test can use it (priority: low).
