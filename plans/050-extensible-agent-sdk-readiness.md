# Extensible Agent SDK Readiness

## Objectives
- Make Prism ready as an extensible agent SDK for third-party host apps, excluding first-party coding-agent tools.
- Lock public contracts, docs, examples, tests, and release gates so hosts can bring their own providers, tools, skills, context, storage, credentials, UI, and extensions safely.
- Keep core small: no built-in app tools, no MCP bridge, no TUI, no production DB adapter unless a later plan explicitly scopes one.

## Expected Outcome
- A host app can install `@arnilo/prism`, register or resolve its own providers/tools/skills/context/storage, customize runtime behavior, stream events, persist sessions, package extensions, and verify adapters with conformance helpers.
- The SDK readiness gate is executable and documented: build, typecheck, offline tests, workspace tests, pack/install smoke, docs coverage, and optional live provider smoke tests.
- Public docs use current `@arnilo/prism*` names and match implementation behavior.

## Tasks

- [x] Primitive/API inventory and SDK boundary review

  ### Inventory Findings (evidence-backed)

  **Public core surface (`@arnilo/prism`, `src/index.ts`)** — exported primitives grouped by category:
  - Agent/session runtime: `createAgent`, `createAgentSession` (`src/agents.ts`); loop strategies `singleShotLoop`, `generateValidateReviseLoop`, `resolveLoop`, `isAgentLoopOptions` (`src/agent-loops.ts`); `resolveAgentDefinition` (`src/agent-definitions.ts`).
  - Providers/models: `createProviderRegistry`, `createProviderResolver` + `ProviderResolver` (`src/providers.ts`); `createModelRegistry` (`src/models.ts`); provider event helpers `providerTextDelta`/`providerThinkingDelta`/`providerContentDelta`/`providerToolCallDelta`/`providerToolCall`/`providerUsage`/`providerDone`/`providerError`/`toolCallContent` (`src/provider-events.ts`); `createMockProvider` (`src/mock-provider.ts`); `defineProviderPackage`, `authMethodKey`, `systemPromptContributionKey` (`src/provider-packages.ts`); request policies `createProviderRequestPolicyChain`, `createSessionCachePolicy`, `mergeProviderRequestOptions` (`src/provider-request-policy.ts`); cache helpers `applyCacheControl`, `cacheHitRate`, `cacheSavings`, `cacheUsageReport`, `mapCacheRetention`, `sanitizeCacheKey` (`src/cache-helpers.ts`).
  - Tools: `createToolRegistry`, `dispatchToolCall`, `filterTools` + `ToolValidator` (`src/tools.ts`). No built-in app tools.
  - Skills/context: `createSkillRegistry`, `resolveActiveSkills` (`src/skills.ts`); `resolveContextProviders` (`src/input.ts`); `resolveInstructionInjectors`, `runInstructionInjectors` (`src/instruction-injection.ts`).
  - Input/prompt: `createDefaultInputBuilder`, `createDefaultPromptBuilder`, `assembleProviderInput`, `renderPromptTemplate` (`src/input.ts`); `composeSystemPrompt`, `mergeSystemPromptConfig` (`src/system-prompts.ts`).
  - Extensions/middleware: `createExtensionKernel`, `createExtensionEventBus` (`src/extensions.ts`); `createMiddlewareRegistry` (`src/middleware.ts`); `createContributionRegistries`, `createContributionRegistry`, `registerDiscoveredContributions` (`src/contributions.ts`); `definePrismManifest`, `parsePrismManifest` (`src/manifests.ts`); `parseSkillFile`, `parseAgentFile` (`src/contribution-parsing.ts`).
  - Stores: `createMemorySessionStore`, `createSessionEntry`, `getSessionBranchEntries`, `listSessionBranches`, `rebuildSessionContext` (`src/session-stores.ts`). `ProductionPersistenceStore`/`RunLedger` types from `contracts.ts`.
  - Config/resources/settings/credentials/security/redaction/retry/compaction: `loadConfigLayers`, `mergeConfigLayers`, `assertJsonObject`, `isJsonObject` (`src/config.ts`); `loadTextResource`, `loadJsonResource`, `loadManifestResource` (`src/resources.ts`); `createStaticSettingsProvider`, `createChainedSettingsProvider` (`src/settings.ts`); `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, `createEnvCredentialResolver`, `resolveCredentialValue`, `refreshOAuthCredential` (`src/credentials.ts`); `createStaticPermissionPolicy`, `createStaticTrustPolicy`, `assertPermission`, `assertTrusted`, `checkPermission`, `isTrusted`, `PermissionDeniedError`, `TrustDeniedError` (`src/security.ts`); `createSecretRedactor`, `redactMessage`/`redactAgentEvent`/`redactSessionEntry`/`redactProviderRequest`/`redactRunLedgerRecord`/`redactSecrets`, `errorToErrorInfo` (`src/redaction.ts`); `createDefaultRetryPolicy`, `isTransientErrorInfo`, `waitForRetry` (`src/retry.ts`); `createDefaultCompactionStrategy`, `isCompactionEntryData` (`src/compaction.ts`).
  - CLI/RPC: `src/cli.ts` (bin), `src/cli-runner.ts`, `src/rpc.ts` (not re-exported via `index.ts`; bin-only entry `dist/cli.js`).

  **Public subpaths (`package.json` `exports`)** — 11 total: `.` root; `./providers/openai-compatible`; `./testing/provider-conformance`; `./node/config`, `./node/settings`, `./node/trust`, `./node/session-store-jsonl`, `./node/contribution-discovery`, `./node/instruction-injectors`, `./node/system-prompts`, `./node/agent-definitions`. All map to `dist/**/*.{js,d.ts}`.

  **Conformance helpers** — only `src/testing/provider-conformance.ts` exists today (stream order, abort, tool-call reconstruction, usage/cache, content coverage, header ownership, secret leak). No `tool-conformance`, `session-store-conformance`, `extension-conformance`, or `compaction-conformance` subpaths exist yet → Task 4 may add them if duplication justifies it.

  **First-party workspace packages (10 code + 3 umbrella)** — all use `@arnilo/prism*` names, all declare non-optional `peerDependencies: { "@arnilo/prism": "0.0.1" }`:
  - Providers (each exports a `create*ProviderPackage(): ProviderPackage` factory): `provider-openai` (`createOpenAIProviderPackage`), `provider-opencode-go` (`createOpenCodeGoProviderPackage`), `provider-openrouter` (`createOpenRouterProviderPackage`), `provider-zai` (`createZaiProviderPackage`), `provider-kimi` (`createKimiProviderPackage`), `provider-neuralwatt` (`createNeuralWattProviderPackage`).
  - Compaction: `compaction-llm` (`createLlmCompactionStrategy`, `createLlmCompactionExtension`, prepare/serialize/tokens/prompt helpers), `compaction-observational-memory` (`createObservationalMemoryExtension`, `createObservationalMemoryRuntime`, recall/ledger/projection/commands helpers).
  - Umbrellas (manifest-only): `prism-providers` (deps on all 6 providers), `prism-compaction` (deps on both compaction packages), `prism-all` (deps on core + providers + compaction).

  **Live-test guards** — every provider/compaction package ships `src/__tests__/live.test.ts`; all gated by `PRISM_LIVE_PROVIDER_TESTS` / `PRISM_LIVE_COMPACTION_TESTS` / `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`; `src/__tests__/network-free-guard.test.ts` asserts each live file carries a `PRISM_LIVE_*` guard. Bodies are currently placeholders → Task 6 replaces with real smoke.

  **Release gates** — `package.json` scripts: `build`, `typecheck` (core + workspaces + `tsc -p examples --noEmit`), `test` (build + `node --test dist/__tests__/*.test.js` + `npm run test --workspaces --if-present`), `pack:dry-run`, `release:dry-run` (`npm test && npm run pack:dry-run`). Meta-tests: `packaging.test.ts`, `install-smoke.test.ts`, `docs.test.ts`, `public-export-contract.test.ts`, `network-free-guard.test.ts`, phase boundary tests. Note: `release:dry-run` does not run `npm run typecheck` separately (typecheck's examples pass runs only via explicit `npm run typecheck`) → Task 11 considers folding it into one `sdk:ready` gate.

  **Docs surface** — 40 markdown pages under `docs/`, all linked from `docs/index.md`. Existing pages cover every SDK category above; no dedicated extension-authoring, host-security, or customization map guide yet → Tasks 8–10 add them.

  **SDK boundary reaffirmation (grep evidence):**
  - No built-in app tools: core `src/*.ts` (excluding CLI/RPC entrypoints) defines no shell/exec/fs/glob tool definitions; `tools.ts` only provides the host-owned registry/dispatch harness.
  - No hidden globals: no `globalThis`/`global.` registry singletons — `globalThis` used only for `crypto.randomUUID` id generation in `agents.ts`, `tools.ts`, `session-stores.ts`, `agent-loops.ts`.
  - No automatic package execution: no `import()`/`require()` in core runtime or `src/node/*`; comments in `contributions.ts`, `node/agent-definitions.ts`, `node/contribution-discovery.ts`, `node/instruction-injectors.ts` explicitly state descriptor-only/inert contributions with host-owned `import()`.
  - No `process.env` reads in core runtime `src/*.ts` (only the host-run `cli-runner.ts`/`rpc.ts`/`node/*` paths, which are opt-in entrypoints); credential env reads are caller-supplied via `createEnvCredentialResolver(env, map)`.
  - Host-owned credentials/storage/UI: `createAgent`/`session.run` do not call `settings.get()`/`credentials.resolve()`; `AgentConfig.settings`/`credentials` are host-owned metadata; `SessionStore`/`ProductionPersistenceStore`/`RunLedger` are adapter-facing contracts with no DB/ORM dependency in core.

  **Constraints for later tasks:** the existing primitives already cover Tasks 2–11's needs — later tasks should reuse these and add only (a) conformance helper subpaths where test duplication justifies, (b) host-app examples, (c) real live smoke bodies, (d) new guide docs, (e) one `sdk:ready` script alias. No new core runtime primitives are required for SDK readiness.
  - Acceptance Criteria:
    - Functional: Inventory existing primitives for public exports, provider resolution, tools, skills, context, input/prompt builders, extensions, stores, conformance helpers, live-test guards, and release gates before adding new code.
    - Performance: No new runtime work is introduced by this task; output is documentation-only inventory.
    - Code Quality: Identify reusable generic primitives before planning any package- or test-specific additions; reject SDK-surface changes that only serve coding-agent tools.
    - Security: Reaffirm no built-in app tools, no hidden globals, no automatic package execution, and host-owned credentials/storage/UI.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md`: public docs map and SDK surface inventory.
      - `docs/public-contracts.md`: root contract/export groups.
      - `docs/provider-layer.md`: provider registry/resolver/mock/conformance entry points.
      - `docs/tools.md`: host-owned active tool harness and no built-in app tools boundary.
      - `docs/extensions.md`: inert contribution and extension-kernel behavior.
      - `docs/session-stores.md`: `SessionStore` seam and production persistence pointer.
      - `.agents/skills/create-plan/references/prism-wiki.md`: required plan documentation assessment structure.
    - Options Considered:
      - Add new SDK surfaces immediately; rejected because existing primitives may already cover most needs.
      - Inventory first, then only add missing generic conformance/release primitives; chosen to avoid speculative API bloat.
    - Chosen Approach:
      - Create a short SDK readiness inventory in the task implementation notes or docs issue section, then use it to constrain later tasks.
    - API Notes and Examples:
      ```ts
      import {
        createAgent,
        createProviderResolver,
        createToolRegistry,
        createSkillRegistry,
        createExtensionKernel,
        createMemorySessionStore,
      } from "@arnilo/prism";
      ```
    - Files to Create/Edit:
      - `plans/050-extensible-agent-sdk-readiness.md`: update task notes if inventory changes task scope.
      - `docs/index.md`: no edit expected unless inventory finds missing navigation.
      - `docs/public-contracts.md`: no edit expected unless inventory finds exported-but-undocumented APIs.
    - References:
      - `src/contracts.ts`, `src/agents.ts`, `src/tools.ts`, `src/input.ts`, `src/extensions.ts`, `src/session-stores.ts`.
  - Test Cases to Write:
    - Existing docs/export tests only; add assertions only if inventory finds undocumented public exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit:
      - `none`: unless drift is found during inventory.
    - `docs/index.md` update: no unless missing SDK surface is found.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Freeze and verify public SDK API surface
  - Acceptance Criteria:
    - Functional: Public root exports and documented subpaths are covered by contract tests; pack contents include only intended public files; accidental internals/tests/maps remain excluded.
    - Performance: Export/pack tests stay inside the offline test budget documented in `docs/release-and-install.md`.
    - Code Quality: Tests assert behavior via package manifests/exports rather than duplicated hand-maintained lists where possible; explicit lists remain for intentional API pins.
    - Security: Tarballs exclude `src/`, `plans/`, `.agents/`, tests, maps, fixtures, and secret-looking docs examples.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`: tarball whitelist, public import specifiers, release checklist, offline budget.
      - `docs/public-contracts.md`: public root export contract groups.
    - Options Considered:
      - Manual release checklist only; rejected because drift returns.
      - Extend existing `public-export-contract.test.ts`, `packaging.test.ts`, and `docs.test.ts`; chosen because current gates already own this surface.
    - Chosen Approach:
      - Audit current tests, add missing public-export/subpath/package assertions only where gaps exist, and keep old plan docs out of published package checks.
    - API Notes and Examples:
      ```bash
      npm test
      npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - `src/__tests__/public-export-contract.test.ts`: add missing export/subpath assertions if needed.
      - `src/__tests__/packaging.test.ts`: add pack-content assertions if needed.
      - `src/__tests__/docs.test.ts`: add docs coverage assertions if needed.
      - `docs/release-and-install.md`: update release checklist if gates change.
    - References:
      - `package.json` `exports`, `files`, `bin`.
      - `docs/release-and-install.md` release checklist.
  - Test Cases to Write:
    - Public export contract: every documented subpath resolves to built JS and `.d.ts` under `dist/`.
    - Pack audit: core/package tarballs exclude internals and include required docs/license/changelog files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if test audit finds undocumented or newly pinned public surface.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: release gates and public import specifiers if changed.
      - `docs/public-contracts.md`: root export list if changed.
    - `docs/index.md` update: only if a new docs page/subpath category is added.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Fix public documentation and implementation drift
  - Acceptance Criteria:
    - Functional: Provider precedence, package names, runtime defaults, live-test descriptions, and release-budget claims match code and tests.
    - Performance: No runtime overhead beyond any bug fix required to align behavior.
    - Code Quality: Drift fixes are minimal and covered by one focused test per behavior; prefer docs fix when implementation is already sane.
    - Security: Drift fixes do not weaken fail-closed provider/tool/skill/permission behavior.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-layer.md`: currently states `AgentConfig.provider` bypasses `providerSource`.
      - `docs/agent-session-runtime.md`: runtime provider and session behavior.
      - `docs/release-and-install.md`: package names and test-budget claims.
      - `README.md`: install/package table.
    - Options Considered:
      - Change runtime precedence to match docs; possible breaking behavior if tests expect current order.
      - Change docs to match runtime and tests; likely smaller if current tests intentionally pin behavior.
    - Chosen Approach:
      - Inspect `src/agents.ts` and `src/__tests__/agents.test.ts`, decide canonical precedence, then align docs/code/tests together.
    - API Notes and Examples:
      ```ts
      await session.run("Hi", { providerSource: createProviderResolver([runProvider]) });
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: only if runtime precedence is wrong.
      - `src/__tests__/agents.test.ts`: pin canonical precedence.
      - `docs/provider-layer.md`: align prose and example.
      - `docs/agent-session-runtime.md`: align runtime/provider wording.
      - `README.md`, `docs/release-and-install.md`: fix stale package-name/budget wording if found.
    - References:
      - Existing `RunOptions.providerSource overrides AgentConfig.providerSource per run` and direct-provider precedence tests.
  - Test Cases to Write:
    - Provider precedence: direct provider vs `providerSource`, `RunOptions.providerSource` vs config source, miss fails closed before provider call.
    - Docs drift: docs test asserts provider-layer includes canonical precedence wording.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider resolution precedence is runtime behavior.
    - Docs pages to create/edit:
      - `docs/provider-layer.md`: provider precedence.
      - `docs/agent-session-runtime.md`: runtime provider selection if needed.
      - `docs/release-and-install.md`: package/test-budget wording if stale.
    - `docs/index.md` update: no; existing pages already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Complete SDK conformance helpers
  - Acceptance Criteria:
    - Functional: Conformance helpers cover provider adapters, tool dispatch/permission, session stores/branch reads, extension packages, and compaction strategies without network or credentials.
    - Performance: Helpers use small in-memory fixtures and no timers; default suite remains under release budget.
    - Code Quality: Helpers are dependency-free, runner-agnostic, throw plain `Error`, and live under public testing subpaths only when intended.
    - Security: Helpers assert fail-closed behavior, secret redaction where relevant, and no credential/env reads.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md`: current provider conformance helper pattern.
      - `docs/tools.md`: dispatch blocked reasons and permission/validator ordering.
      - `docs/session-stores.md`: append/idempotency/branch semantics.
      - `docs/extensions.md`: inert contribution behavior and error isolation.
      - `docs/compaction-and-retry.md`: compaction/retry strategy contracts.
    - Options Considered:
      - Put all helpers in one large conformance module; rejected because surfaces differ.
      - Add small focused helpers under `@arnilo/prism/testing/*`; chosen if current tests show repeated contract fixtures.
      - Use docs-only recipes for lower-value surfaces; acceptable where helper would only wrap one assertion.
    - Chosen Approach:
      - Extend existing provider conformance only where needed, then add minimal `testing/tool-conformance`, `testing/session-store-conformance`, `testing/extension-conformance`, and `testing/compaction-conformance` subpaths only if duplication justifies them.
    - API Notes and Examples:
      ```ts
      import { assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";

      await assertProviderStreamConforms({ provider, request, expect: { text: "Hello" } });
      ```
    - Files to Create/Edit:
      - `src/testing/provider-conformance.ts`: extend only if provider gaps exist.
      - `src/testing/tool-conformance.ts`: create if useful.
      - `src/testing/session-store-conformance.ts`: create if useful.
      - `src/testing/extension-conformance.ts`: create if useful.
      - `src/testing/compaction-conformance.ts`: create if useful.
      - `src/__tests__/*conformance*.test.ts`: tests for helper behavior.
      - `package.json`: add exports for new testing subpaths.
      - `docs/provider-conformance.md` or new `docs/*-conformance.md`: document public helpers.
      - `docs/index.md`: add testing entries for new public docs pages.
    - References:
      - Existing `src/testing/provider-conformance.ts` dependency-free style.
  - Test Cases to Write:
    - Tool conformance: unknown/denied/invalid/permission/validator-blocked calls do not execute tool.
    - Session store conformance: duplicate ids, expected-parent miss, idempotency duplicate, branch-path reader semantics.
    - Extension conformance: setup order, inert contributions, redacted extension errors.
    - Compaction conformance: summary result, no secret leak, abort/error shape if supported.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if new testing subpaths/helpers are exported.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`: update existing provider helper list if changed.
      - New `docs/*-conformance.md`: for any new public helper subpath.
    - `docs/index.md` update: yes for any new conformance docs page under Testing and examples.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add host-app SDK examples without coding tools
  - Acceptance Criteria:
    - Functional: Examples demonstrate minimal embed, custom tools/skills/context, custom input/prompt builders, custom session store, extension package registration, and event streaming.
    - Performance: Examples run quickly with mock providers and no network; compile under `examples/tsconfig.json`.
    - Code Quality: Examples are short, typed, import only public package specifiers, and avoid duplicated framework scaffolding.
    - Security: Examples use fake secrets only, do not read `process.env` directly unless demonstrating caller-supplied env objects, and do not include filesystem/shell/browser coding tools.
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md`: current example inventory and run/typecheck rules.
      - `docs/input-and-prompt-assembly.md`: custom builder usage.
      - `docs/context-and-skills.md`: active skill selection.
      - `docs/extensions.md`: extension registration pattern.
      - `docs/session-stores.md`: custom store seam.
    - Options Considered:
      - One giant host-app example; rejected as harder to scan.
      - Several tiny examples plus one external-app reference; chosen because examples remain focused and compile-checked.
    - Chosen Approach:
      - Fill only missing SDK adoption examples; reuse existing examples when they already cover an item.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({ model, provider, tools, skills, context });
      const session = agent.createSession({ store });
      await Promise.all([consume(session.subscribe()), session.run("Hi")]);
      ```
    - Files to Create/Edit:
      - `examples/README.md`: list SDK examples and mark runnable/type-only.
      - `examples/minimal-host-app.ts`: create if missing.
      - `examples/custom-tools-skills-context.ts`: create if missing.
      - `examples/custom-builders.ts`: create if missing.
      - `examples/custom-session-store.ts`: create if missing.
      - `examples/extension-package.ts`: create if missing.
      - `src/__tests__/docs.test.ts`: include new examples in compile/run/docs coverage.
      - `docs/index.md`: only if adding a dedicated examples docs page.
    - References:
      - Existing `examples/provider-registration.ts`, `examples/provider-resolver.ts`, `examples/external-app-db-backed.ts`, `examples/extensions.ts`.
  - Test Cases to Write:
    - Examples compile via `npm run typecheck`.
    - Runnable demos exit 0 and emit no real-looking secrets via existing docs example runner.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; examples clarify SDK usage.
    - Docs pages to create/edit:
      - `examples/README.md`: update inventory.
      - `docs/index.md`: no unless adding a docs examples page.
    - `docs/index.md` update: no by default; examples directory already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement opt-in live provider smoke tests
  - Acceptance Criteria:
    - Functional: First-party live smoke tests are real when env-gated: text response, tool-call loop if provider supports tools, abort, and no secret leak for at least OpenAI and OpenRouter first; other providers either implement or explicitly skip unsupported checks.
    - Performance: Default test suite remains network-free; live tests run only when `PRISM_LIVE_PROVIDER_TESTS=1` and provider-specific credentials are present.
    - Code Quality: Live tests share small helper utilities and do not duplicate provider-specific setup more than needed.
    - Security: Live tests read only documented env vars, skip safely when missing, never log credentials, and use fake/non-sensitive prompts.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`: live tests are currently opt-in placeholders and default suite is network-free.
      - `docs/provider-conformance.md`: offline conformance helpers and live-test boundary.
      - `docs/provider-packages.md` and `docs/providers/*.md`: first-party provider setup/auth behavior.
    - Options Considered:
      - Add live tests to default CI; rejected because SDK release gate must stay offline.
      - Add provider-specific live smoke under existing gated `live.test.ts`; chosen.
    - Chosen Approach:
      - Start with OpenAI/OpenRouter because generic text/tool-call paths are common, then document skips for providers needing account-specific capabilities.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_PROVIDER_TESTS=1 OPENAI_API_KEY=... npm run test --workspace=@arnilo/prism-provider-openai
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/__tests__/live.test.ts`: real gated live smoke.
      - `packages/provider-openrouter/src/__tests__/live.test.ts`: real gated live smoke.
      - `packages/provider-*/src/__tests__/live.test.ts`: add explicit skip reasons or smoke tests.
      - `docs/release-and-install.md`: document env vars and live-test scope.
      - `docs/provider-conformance.md`: clarify offline vs live.
    - References:
      - Existing workspace live tests and `network-free-guard.test.ts`.
  - Test Cases to Write:
    - Default suite: verifies live tests skip without env and no network is used.
    - Live suite: text generation; tool call; abort; `assertNoSecretLeak()` against known credential values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: behavior of test suite/documented release process changes, not runtime API.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: live env vars and scope.
      - `docs/provider-conformance.md`: live smoke guidance.
    - `docs/index.md` update: no; existing pages linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Strengthen production persistence SDK story without shipping a DB adapter
  - Acceptance Criteria:
    - Functional: Hosts have adapter contracts, schema reference, conformance guidance/helpers, and a working external-app mock/reference example.
    - Performance: Guidance requires `readBranchPath`/pagination for production and avoids full-session loads for large branches.
    - Code Quality: No ORM/database dependency enters core; any helper remains adapter-neutral.
    - Security: Docs state credentials/provider instances/raw secrets never belong in session, ledger, branch, or idempotency records.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores.md`: `SessionStore`, branch helpers, `readBranchPath`.
      - `docs/database-persistence.md`: production schema and queries.
      - `docs/runs-and-usage.md`: durable run/event/tool/usage ledger.
      - `examples/external-app-db-backed.ts`: reference external-app persistence mock.
    - Options Considered:
      - Build Postgres/SQLite adapter now; rejected per SDK-only scope.
      - Ship conformance helper + docs/examples only; chosen.
    - Chosen Approach:
      - Add or improve adapter conformance helper from Task 4 and make docs point to the external-app reference.
    - API Notes and Examples:
      ```ts
      import type { SessionStore, ProductionPersistenceStore, RunLedger } from "@arnilo/prism";
      ```
    - Files to Create/Edit:
      - `docs/session-stores.md`: adapter conformance link and production guidance.
      - `docs/database-persistence.md`: conformance/checklist updates.
      - `docs/runs-and-usage.md`: ledger conformance guidance if needed.
      - `examples/external-app-db-backed.ts`: keep reference current if contracts shift.
      - `src/testing/session-store-conformance.ts`: if created in Task 4.
    - References:
      - `src/session-stores.ts`, `src/contracts.ts` persistence types.
  - Test Cases to Write:
    - SessionStore conformance helper tests from Task 4.
    - External app example still typechecks/runs and redacts secrets.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if conformance helper/subpath is exported; otherwise docs behavior guidance only.
    - Docs pages to create/edit:
      - `docs/session-stores.md`: conformance/use guidance.
      - `docs/database-persistence.md`: production adapter checklist.
      - `docs/runs-and-usage.md`: ledger checklist if changed.
    - `docs/index.md` update: yes only if adding a new conformance docs page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Write extension author guide
  - Acceptance Criteria:
    - Functional: Third-party authors can publish an extension package that registers inert providers/models/auth/tools/context/skills/builders/strategies/commands and documents how hosts activate them.
    - Performance: Guide makes clear extension loading has no provider/tool/resource side effects unless host code invokes them.
    - Code Quality: Examples use public `Extension` and `ExtensionAPI` only, no internal registries except documented factories.
    - Security: Guide covers trust, permission, secret redaction, no auto-discovery, no sandbox, and inert-until-selected contributions.
  - Approach:
    - Documentation Reviewed:
      - `docs/extensions.md`: kernel and event bus.
      - `docs/contribution-registries.md`: inert registry storage.
      - `docs/contribution-discovery.md`: opt-in filesystem scanner boundary.
      - `docs/configuration-and-manifests.md`: data-only manifests.
      - `docs/settings-auth-trust-security.md`: permission/trust boundaries.
    - Options Considered:
      - Fold into `docs/extensions.md`; okay if short.
      - Create dedicated `docs/extension-authoring.md`; chosen if guide would be easier to link from README/index.
    - Chosen Approach:
      - Create one focused author guide and link related low-level API pages.
    - API Notes and Examples:
      ```ts
      import type { Extension } from "@arnilo/prism";

      export const extension: Extension = {
        name: "demo",
        setup(api) {
          api.registerSkill({ name: "brief", instructions: "Be brief." });
        },
      };
      ```
    - Files to Create/Edit:
      - `docs/extension-authoring.md`: new guide.
      - `docs/index.md`: add under Extensions/plugins.
      - `README.md`: optional link if quick-start needs it.
      - `src/__tests__/docs.test.ts`: add API page/docs coverage.
    - References:
      - `docs/extensions.md`, `docs/contribution-registries.md`, `docs/configuration-and-manifests.md`.
  - Test Cases to Write:
    - Docs test: page has required API sections and is linked from `docs/index.md`.
    - Optional snippet compile if docs snippet runner supports it; otherwise covered by examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; public extension authoring behavior documented.
    - Docs pages to create/edit:
      - `docs/extension-authoring.md`: new guide.
      - `docs/index.md`: add navigation entry.
    - `docs/index.md` update: yes, Extensions/plugins entry for extension authoring.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Write host security guide
  - Acceptance Criteria:
    - Functional: Host developers know how to handle credentials, settings, redaction, trust roots, permission policies, session/ledger persistence, extension loading, and tool validation.
    - Performance: Guide calls out security checks as bounded explicit calls, not watchers/background scans.
    - Code Quality: Guidance references existing APIs and examples instead of inventing a new security abstraction.
    - Security: Guide is fail-closed by default and explicitly says Prism does not sandbox tools/extensions or detect arbitrary secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/settings-auth-trust-security.md`: central security controls.
      - `docs/credentials-and-redaction.md`: credential resolver and redaction behavior.
      - `docs/tools.md`: permission and validation order.
      - `docs/extensions.md`: extension error redaction and no auto-execute.
      - `docs/session-stores.md`, `docs/runs-and-usage.md`: persistence redaction boundaries.
    - Options Considered:
      - Expand existing security page; possible if one page remains readable.
      - Add `docs/host-security.md` as a high-level checklist; chosen because P1 asks for a guide.
    - Chosen Approach:
      - Add checklist page with links to existing API pages for details.
    - API Notes and Examples:
      ```ts
      const redactor = createSecretRedactor([apiKey]);
      const permission = createStaticPermissionPolicy({ allow: ["tool:echo:execute"] });
      ```
    - Files to Create/Edit:
      - `docs/host-security.md`: new checklist guide.
      - `docs/index.md`: add under Security and credentials.
      - `docs/settings-auth-trust-security.md`: link to guide if useful.
      - `src/__tests__/docs.test.ts`: add docs coverage.
    - References:
      - `docs/settings-auth-trust-security.md` boundary hardening table.
  - Test Cases to Write:
    - Docs tests: page linked, required sections, no real-looking secret examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; documents required host security behavior.
    - Docs pages to create/edit:
      - `docs/host-security.md`: new guide.
      - `docs/index.md`: add navigation entry.
    - `docs/index.md` update: yes, Security and credentials entry for host security.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Write SDK customization guide
  - Acceptance Criteria:
    - Functional: Host developers can see where to customize provider resolution, middleware, context, prompt/input builders, instruction injectors, agent loops, compaction, retry, stores, and skills.
    - Performance: Guide explains replaceable hooks are explicit and run only when wired, with no hidden global middleware.
    - Code Quality: Guide uses small snippets and links to detailed API pages; no new abstraction layer.
    - Security: Guide notes customization cannot grant tools/permissions unless host explicitly activates them and that injectors grant no capabilities.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-layer.md`: provider resolver.
      - `docs/middleware-hooks.md`: hook ordering.
      - `docs/input-and-prompt-assembly.md`: builder replacement.
      - `docs/instruction-injection.md`: inert injectors.
      - `docs/agent-loops.md`: custom loop strategy.
      - `docs/compaction-and-retry.md`: strategies.
      - `docs/context-and-skills.md`: selection/activation.
    - Options Considered:
      - Add customization paragraphs to every API page only; rejected because adoption needs a map.
      - Add one `docs/customization.md` map; chosen.
    - Chosen Approach:
      - Write high-level customization map with exact entry points and one tiny snippet per category.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({
        model,
        providerSource,
        inputBuilder,
        promptBuilder,
        middleware,
        compaction,
        retry,
      });
      ```
    - Files to Create/Edit:
      - `docs/customization.md`: new guide.
      - `docs/index.md`: add under Agent/session runtime or Input/prompt assembly.
      - `src/__tests__/docs.test.ts`: add docs coverage.
    - References:
      - Existing detailed docs pages listed above.
  - Test Cases to Write:
    - Docs tests: page linked, required sections, no stale package specifiers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; documents customization behavior.
    - Docs pages to create/edit:
      - `docs/customization.md`: new guide.
      - `docs/index.md`: add navigation entry.
    - `docs/index.md` update: yes, SDK customization entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Add single SDK readiness release gate
  - Acceptance Criteria:
    - Functional: One command runs build, typecheck, offline tests, workspace tests, pack dry-run, docs/export/package smoke checks, and reports optional live-test instructions separately.
    - Performance: Gate stays within documented offline budget or updates budget with measured baseline and rationale.
    - Code Quality: Script composes existing npm scripts; no custom test runner unless absolutely required.
    - Security: Gate remains network-free by default and does not read live provider credentials.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`: `npm run release:dry-run`, offline budget, release checklist.
      - `package.json`: existing scripts.
    - Options Considered:
      - Keep multiple manual commands only; rejected because SDK readiness should be one repeatable gate.
      - Alias existing `release:dry-run` plus `typecheck`; chosen if it already covers everything else.
    - Chosen Approach:
      - Add `sdk:ready` or update `release:dry-run` only if current script omits typecheck/workspace tests; keep shortest command path.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      # Optional, separate:
      PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present
      ```
    - Files to Create/Edit:
      - `package.json`: add or adjust SDK readiness script.
      - `docs/release-and-install.md`: document command and optional live gate.
      - `README.md`: mention command if useful.
      - `.github/workflows/release.yml`: only if CI should use the new alias.
    - References:
      - Existing `npm test`, `npm run typecheck`, `npm run pack:dry-run`, `npm run release:dry-run`.
  - Test Cases to Write:
    - Run `npm run sdk:ready` locally after implementation.
    - Docs test ensures release page mentions current command.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime API; release workflow behavior changes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: readiness command and budget.
      - `README.md`: optional script table update.
    - `docs/index.md` update: no; release page already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

### Task 3 — Fix public documentation and implementation drift
- **Canonical precedence chosen: implementation changed to match docs/test intent.** The released `src/agents.ts` resolved `options.providerSource ?? config.providerSource ?? config.provider`, making `AgentConfig.provider` a last-resort fallback. Both docs (`provider-layer.md`, `agent-session-runtime.md`) and the `agents.test.ts` test name stated the opposite intent: direct provider takes first precedence and the resolver is bypassed. Rather than rewrite docs to codify the surprising fallback semantics, the runtime was aligned to the documented intent (`config.provider ?? options.providerSource ?? config.providerSource`). This is a behavioral change but safe at 0.0.1: no production code sets both `provider` and `providerSource` (`agent-definitions.ts` returns one or the other), and no existing test expected the resolver to win over a direct provider. The existing `direct provider takes precedence` test was strengthened to use a resolver that *also contains the model's provider id*, so it now proves bypass rather than relying on a resolver miss.
- **Other drift items verified clean, no changes needed:** package names (no stale `@prism/` in docs/README/examples; `@arnilo/prism*` throughout), release budget (`npm test` measured 41.5s, within the documented `<60s` with ~45s baseline), and live-test descriptions (docs accurately state gated live tests are empty placeholders — Task 6 replaces them).
- **Added a docs drift guard test** (`provider_resolution_precedence_docs_match_implementation`) pinning the precedence wording in both pages so docs/code/tests cannot drift again; verified it fails when the wording is corrupted.

### Task 4 — Complete SDK conformance helpers
- **Created four adapter conformance helpers** mirroring the existing `provider-conformance` pattern (dependency-free, runner-agnostic, throw plain `Error`, public `@arnilo/prism/testing/*` subpath): `session-store-conformance` (highest value — real duplication across memory/JSONL/external-app adapters, supports Task 7's DB-adapter story), `compaction-conformance` (secret-leak assertion duplicated in core + compaction-llm), `tool-conformance` (blocked-reason matrix), `extension-conformance` (inert contributions + redacted/rethrown setup errors).
- **Ponytail judgment on duplication criterion:** session-store and compaction had clear cross-implementation duplication; tool and extension have a single core implementor each but capture non-trivial public contracts (5 blocked reasons; inertness + error-policy) that hosts/adapter authors validate once and reuse, so small focused helpers were justified over docs-only recipes.
- **Boundary fix:** the `phase13_core_does_not_default_to_llm_compaction` test scans `src/*.ts` for `@arnilo/prism-compaction-llm`; the initial compaction-conformance comment contained that string and tripped the boundary. Reworded the comment to avoid the literal package name.
- **Tool-conformance execution observation:** chosen to observe `tool_execution_started`/`tool_execution_blocked` events rather than mutating the caller's tool `execute` (an earlier draft used a `WeakMap` wrap that mutated the input object — rejected as a side effect).
- **Extension-conformance negative coverage:** the leak-detection negative is hard to construct without injecting a custom non-redacting kernel (the helper builds its own kernel, which always redacts known secrets), so redaction is asserted positively (helper succeeds because the kernel redacts) rather than via a forced-leak negative. The expectThrow path is asserted positively too.
- **Added 17 conformance tests** (`conformance-helpers.test.ts`) including negatives (lenient store, no-conflict store, leaking/empty compaction strategy, non-executing tool, missing blocked event) and subpath-exported assertions; all 828 core tests pass.
- **Docs:** created `docs/session-store-conformance.md`, `docs/compaction-conformance.md`, `docs/tool-conformance.md`, `docs/extension-conformance.md` (full API-page structure), linked from `docs/index.md`, added to `docs.test.ts` apiPages + a new `adapter conformance docs cover testing subpaths and helpers` test (62 docs tests pass).
- **Added a docs drift guard test** (`provider_resolution_precedence_docs_match_implementation`) pinning the precedence wording in both pages so docs/code/tests cannot drift again; verified it fails when the wording is corrupted.

### Task 5 — Add host-app SDK examples without coding tools
- **Created five focused host-app examples** (all runnable demos with the `main()` + `import.meta.url` guard, mock provider, no network, no real secrets): `minimal-host-app.ts` (canonical minimal embed + event streaming via concurrent `Promise.all([drain, session.run])`), `custom-builders.ts` (replace `InputBuilder` + `PromptBuilder`), `custom-session-store.ts` (implement the `SessionStore` contract + `createSessionEntry`), `custom-tools-skills-context.ts` (host-owned tool + skill + context in one agent with a `providerToolCall` loop), `extension-package.ts` (bundle tool+skill+context in one `Extension`, load via kernel, build agent from `kernel.registries.*.list()`).
- **Ponytail judgment on reuse:** the plan listed 5 files to create; existing `tools.ts`/`skills.ts`/`context.ts` cover each seam alone and `external-app-db-backed.ts` combines them with heavy DB scaffolding, but a focused combined example without the DB ledger is a distinct SDK adoption path, so all 5 were created as planned (each short, no duplicated scaffolding). `custom-builders` was the only genuinely missing seam — no prior example exercised `InputBuilder`/`PromptBuilder` replacement.
- **Type-shape corrections during typecheck:** first draft used a `Message.type` field and `ContextBlock.body` that do not exist on the contracts (`Message` is `role`+`content`; `ContextBlock` is `title?`+`content: string | ContentBlock[]`); also `SessionStore` has no `name` field and `SessionEntryKind` has no `"note"` (used `"custom"`). Fixed all five to match the real contracts.
- **Event-field correction:** first draft read `event.toolCall.name` and `event.text` from `AgentEvent`; the real variants are `tool_execution_started` with `event.call.name` and `message_delta` with `event.content` (a `ContentBlock`). Fixed `custom-tools-skills-context.ts` accordingly.
- **Coding-tool guard test refinement:** the new `host_app_sdk_examples_cover_adoption_seams_without_coding_tools` test initially used bare forbidden words `shell`/`browser`/`exec(`, which false-matched the examples' own "No filesystem/shell/browser coding tools" comments. Refined the forbidden list to actual API-usage tokens (`from "fs"`, `readFileSync`, `execSync`, `spawnSync`, `child_process`, `glob(`) so the guard catches real usage, not anti-comments.
- **`custom-tools-skills-context` double text delta:** the runtime emits two `message_delta` events per `providerTextDelta` (delta + flush); the demo records both, which is illustrative of real streaming behavior rather than a bug. Left as-is.
- **Docs/test wiring:** updated `examples/README.md` (run list + file descriptions), added the 5 files to `docs.test.ts` `exampleFiles`, added them to the `examples_demos_run_to_completion_and_emit_no_secret` runner (verified exit 0 + no real-looking secret), and added the focused `host_app_sdk_examples_cover_adoption_seams_without_coding_tools` test (64 docs tests pass). No `docs/index.md` change needed (index already references `examples/`).
- **Gates:** core 829 pass/0 fail, typecheck (core+9 workspaces+examples) exit 0, 8 workspace suites 0 fail, `npm test` exit 0, `npm run pack:dry-run` exit 0.

### Task 6 — Implement opt-in live provider smoke tests
- **Replaced all 6 provider placeholder live tests with real env-gated smoke tests.** Each `packages/provider-*/src/__tests__/live.test.ts` now exercises the real provider API when `PRISM_LIVE_PROVIDER_TESTS=1` AND a provider-specific API key are set, and skips safely when either is missing. Tests cover: text generation (stream conforms + non-empty text + no secret leak), tool-call loop (stream conforms + tool-call name if emitted + no secret leak), abort (`assertAbortIsObserved`), and error response (no secret leak on a deliberately bad request).
- **Provider-specific key env vars:** `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `KIMI_API_KEY`, `ZAI_API_KEY`, `NEURALWATT_API_KEY`, `OPENCODE_API_KEY`. NeuralWatt was previously gated only by `NEURALWATT_API_KEY`; aligned it to require both `PRISM_LIVE_PROVIDER_TESTS=1` AND `NEURALWATT_API_KEY` for consistency with all other providers.
- **Shared helper pattern:** no shared live-test helper module was created (ponytail). Each live test imports the already-published `@arnilo/prism/testing/provider-conformance` helpers (`assertProviderStreamConforms`, `assertAbortIsObserved`, `assertNoSecretLeak`, `collectProviderEvents`) and inlines ~6 lines of env-reading + skip-reason logic. Provider-specific setup (factory, model, request) is inherently per-package and not shareable.
- **Abort test design:** `assertAbortIsObserved` pre-aborts the signal before the first fetch, testing that the provider checks the signal before making a network call. A mid-stream abort would be more realistic but requires a timer + real streaming response and is harder to make deterministic across providers; kept the pre-abort check for consistency with the offline conformance pattern.
- **Tool-call test design:** the tool call is best-effort — the model may answer in text instead. The test asserts the stream conforms (terminal event, no error) and checks tool-call name only if a `tool_call` event was emitted. This avoids flakiness from non-deterministic model behavior while still exercising the tool-call code path when the model cooperates.
- **Security:** API keys are read from env only when both gates are set, used as bearer tokens, never logged. `assertNoSecretLeak(events, [API_KEY])` verifies the key value does not appear in any streamed event. Prompts are non-sensitive ("Reply with exactly the word: pong", "What is the weather in Paris?").
- **Boundary test additions:** strengthened `phase12_live_tests_are_skipped_by_default` with explicit error messages and added `phase12_live_tests_reference_provider_specific_api_key_env` asserting each provider live test references its correct key env var and uses the three required conformance helpers. Core 830 pass/0 fail (+1 new boundary test).
- **Docs:** updated `docs/release-and-install.md` (provider live tests are now real smoke tests, not placeholders; enumerated all 6 provider-specific key env vars; compaction live tests remain placeholders) and `docs/provider-conformance.md` (offline vs live clarification with cross-link). Updated `docs.test.ts` to assert the 6 provider key env vars are documented and that "placeholder" still appears for compaction. 64 docs tests pass.
- **Gates:** core 830 pass/0 fail, typecheck (core+9 workspaces+examples) exit 0, 8 workspace suites pass with 4 live tests skipped per provider, `npm test` exit 0, `npm run pack:dry-run` exit 0.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
