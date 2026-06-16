# Phase 0 — Documentation Governance and Implemented API Wiki Catch-up

## Objectives
- Make `/docs` the source of truth for public Prism APIs, extension points, configuration surfaces, and replaceable defaults.
- Ensure every future implementation plan includes a per-task documentation/wiki assessment before code is written.
- Document the APIs already implemented in Phase 1 and Phase 2 so extension/package authors can use them without reading source.

## Expected Outcome
- `.agents/skills/create-plan/` enforces Prism documentation requirements for every future plan task.
- `/docs/index.md` exists and links functional API groups to detailed API pages.
- Current public contracts, provider/model registries, provider events, mock provider, credential/redaction helpers, and the OpenAI-compatible subpath are documented with examples.
- A cheap docs consistency check protects required page headings and broken local links.

## Tasks

- [x] Documentation governance primitive review and skill enforcement
  - Acceptance Criteria:
    - Functional: The create-plan skill requires `Documentation/Wiki Assessment` for every task and loads `.agents/skills/create-plan/references/prism-wiki.md` when present.
    - Performance: Governance adds no runtime package code and no new npm dependency.
    - Code Quality: Documentation requirements live in one reusable reference file, not copied into every plan manually.
    - Security: Governance requires docs for credential/security-sensitive APIs and forbids secret-bearing examples.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/SKILL.md` current workflow and required plan structure.
      - `.agents/skills/create-plan/references/prism-wiki.md` required docs/index and API page structure.
      - `roadmap.md` Phase 0 docs governance acceptance.
    - Options Considered:
      - Put documentation rules only in `roadmap.md`: rejected because plan writers may miss it.
      - Put documentation rules in create-plan reference plus required task section: chosen; one reusable rule source and every plan task must decide docs impact.
    - Chosen Approach:
      - Verify or update `SKILL.md` and `prism-wiki.md` so future plan creation loads the reference and every task includes docs assessment.
    - API Notes and Examples:
      ```markdown
      - Documentation/Wiki Assessment:
        - Public API or behavior impacted: yes/no and why
        - Docs pages to create/edit:
          - `docs/<page>.md`: planned docs change
        - `docs/index.md` update: yes/no and navigation entry
        - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
      ```
    - Files to Create/Edit:
      - `.agents/skills/create-plan/SKILL.md`: verify/update required docs assessment and reference loading.
      - `.agents/skills/create-plan/references/prism-wiki.md`: verify/update Prism docs structure and API page requirements.
      - `plans/003-documentation-governance-and-implemented-api-wiki.md`: record execution notes.
    - References:
      - `roadmap.md` Phase 0.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `create_plan_requires_docs_assessment`: grep/read check that `SKILL.md` includes `Documentation/Wiki Assessment` and loads `prism-wiki.md`.
    - `prism_wiki_reference_has_required_sections`: grep/read check for `/docs/index.md` rules and required API page headings.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No package API impact; this changes agent planning governance only.
    - Docs pages to create/edit:
      - `none`: `/docs` API pages are created in later tasks.
    - `docs/index.md` update: No; the index does not document internal planning skills.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Verified `.agents/skills/create-plan/SKILL.md` loads `.agents/skills/create-plan/references/prism-wiki.md` during project-specific requirement loading.
    - Verified the required plan structure includes `Documentation/Wiki Assessment` for every task.
    - Verified `.agents/skills/create-plan/references/prism-wiki.md` defines documentation-decision fields, `/docs/index.md` navigation rules, and required API page headings.
    - Ran grep/read checks for `Documentation/Wiki Assessment`, `prism-wiki.md`, `/docs/index.md`, and all required API page headings; all passed.
    - No runtime package code, dependencies, or `/docs` pages were added for this governance-only task.

- [x] Create docs navigation and API page template
  - Acceptance Criteria:
    - Functional: `/docs/index.md` exists with functional groups and links for all already implemented public API areas.
    - Performance: Docs are static Markdown only; no build step or site generator.
    - Code Quality: The index is short enough for AI agents to scan and points to detailed pages instead of duplicating all details.
    - Security: The index highlights credential/security docs and avoids real keys/tokens in examples.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` `/docs` structure and API page structure.
      - `README.md` current scope and provider-layer examples.
      - `roadmap.md` target architecture and Phase 0 deliverables.
    - Options Considered:
      - One large docs page: rejected because extension authors and AI agents need navigable API groups.
      - Small index plus a reusable page template: chosen; enough structure without a doc framework.
    - Chosen Approach:
      - Create `docs/index.md` and `docs/api-page-template.md`; link implemented API pages by functionality.
    - API Notes and Examples:
      ```markdown
      ## Provider and model connection
      - [Provider/model registries](provider-layer.md): register and resolve host-owned providers/models.
      ```
    - Files to Create/Edit:
      - `docs/index.md`: navigation map grouped by functionality.
      - `docs/api-page-template.md`: copyable API page structure matching `prism-wiki.md`.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `README.md` current public API overview.
  - Test Cases to Write:
    - `docs_index_exists`: `docs/index.md` exists and links all implemented API docs.
    - `api_template_matches_required_headings`: template contains required Prism wiki headings.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; this introduces the public documentation navigation surface.
    - Docs pages to create/edit:
      - `docs/index.md`: new functional navigation map.
      - `docs/api-page-template.md`: new API page template.
    - `docs/index.md` update: Yes; add groups for public contracts, provider/model connection, provider adapters, test/mock helpers, and security/credentials.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Created `docs/index.md` as a short functional navigation map for already implemented API areas and planned future areas.
    - Created `docs/api-page-template.md` with the required Prism wiki headings from `.agents/skills/create-plan/references/prism-wiki.md`.
    - Linked implemented API documentation targets for public contracts, provider layer, OpenAI-compatible provider, credentials/redaction, and mock/testing helpers; detailed target pages are created by later tasks in this plan.
    - Ran checks that `docs/index.md` exists, includes the implemented API links, `docs/api-page-template.md` contains required headings, and docs contain no real-looking `sk-` token examples.

- [x] Document implemented public contracts
  - Acceptance Criteria:
    - Functional: Docs describe exported contracts for JSON/content/messages, providers/models, agents/sessions/run options, tools, context, skills, extensions, stores/resources/settings/credentials, and events.
    - Performance: Docs state contracts are type-only and do not create runtime work by themselves.
    - Code Quality: Examples compile conceptually from root `prism` imports and match exported names in `src/index.ts`.
    - Security: Docs explain that credentials remain host/provider-owned and should not enter messages, events, stores, or logs.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` current exported type shapes.
      - `src/index.ts` root `export type * from "./contracts.js"`.
      - `src/__tests__/public-contracts.test.ts` compile-only host examples and public boundary scan.
      - `plans/001-public-contracts.md` compromises and further actions.
    - Options Considered:
      - Document every type in a separate page: too much churn before runtime modules exist.
      - One contracts page grouped by functionality: chosen; covers current public type surface while contract organization is still one file.
    - Chosen Approach:
      - Create a grouped contracts doc with minimal request/response examples and TypeScript snippets for host-owned providers/tools/context/skills/extensions.
    - API Notes and Examples:
      ```ts
      import type { AgentConfig, AIProvider, ContextProvider, Skill, ToolDefinition } from "prism";
      ```
    - Files to Create/Edit:
      - `docs/public-contracts.md`: document current type-only contracts.
      - `docs/index.md`: link the contracts page under public contracts and extension fundamentals.
    - References:
      - `src/contracts.ts`.
      - `src/__tests__/public-contracts.test.ts`.
      - `plans/001-public-contracts.md`.
  - Test Cases to Write:
    - `public_contract_docs_have_required_sections`: docs consistency check validates headings on `docs/public-contracts.md`.
    - `public_contract_docs_reference_existing_exports`: cheap check or manual review that documented type names exist in `src/contracts.ts`/`src/index.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; documents the existing root type API.
    - Docs pages to create/edit:
      - `docs/public-contracts.md`: new detailed contract API page.
      - `docs/index.md`: add/update navigation entry.
    - `docs/index.md` update: Yes; add public contracts entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Created `docs/public-contracts.md` covering JSON/data, content/messages, providers/models, agents/sessions/run options, tools, context, skills, extensions, stores/resources/settings/credentials, and events.
    - Documented that contracts are type-only and do not create runtime work, registries, stores, clients, credentials, or network calls.
    - Included root `prism` import examples for host-owned providers, tools, context providers, skills, extensions, resources, settings, and credential resolvers.
    - Confirmed `docs/index.md` already links `docs/public-contracts.md` under Public contracts.
    - Ran checks for all required Prism wiki headings, documented exported contract names against `src/contracts.ts`, the index link, and no real-looking `sk-` secret examples.

- [x] Document provider/model registries, provider events, and mock provider
  - Acceptance Criteria:
    - Functional: Docs cover `createProviderRegistry`, `ProviderRegistry`, `createModelRegistry`, `ModelRegistry`, provider event helper functions, `toolCallContent`, `createMockProvider`, and `MockProviderOptions`.
    - Performance: Docs state registry lookup is `Map`-backed/O(1) and mock provider uses scripted events without timers/network.
    - Code Quality: Examples use current root exports and no hidden global registry.
    - Security: Docs state registries do not store credentials and mock provider should not be used to hide real secrets in fixtures.
  - Approach:
    - Documentation Reviewed:
      - `src/providers.ts` provider registry implementation.
      - `src/models.ts` model registry implementation.
      - `src/provider-events.ts` event helper functions.
      - `src/mock-provider.ts` scripted provider implementation.
      - `src/__tests__/registries.test.ts`, `src/__tests__/provider-events.test.ts`, and `src/__tests__/mock-provider.test.ts` examples.
      - `plans/002-provider-streaming-and-mock-provider.md` compromises/follow-ups.
    - Options Considered:
      - Separate page for every helper: rejected; helpers are tiny and belong with provider streaming docs.
      - One provider-layer page with sections per API: chosen; easy to scan and enough for extension authors.
    - Chosen Approach:
      - Create `docs/provider-layer.md` with registry, event helper, and mock provider sections following the required API page structure.
    - API Notes and Examples:
      ```ts
      import { createModelRegistry, createMockProvider, createProviderRegistry, providerTextDelta } from "prism";

      const provider = createMockProvider([providerTextDelta("Hello"), { type: "done" }]);
      const providers = createProviderRegistry([provider]);
      const models = createModelRegistry([{ provider: "mock", model: "demo" }]);
      ```
    - Files to Create/Edit:
      - `docs/provider-layer.md`: document registries, event helpers, and mock provider.
      - `docs/index.md`: link provider/model and mock/testing docs.
    - References:
      - `src/providers.ts`.
      - `src/models.ts`.
      - `src/provider-events.ts`.
      - `src/mock-provider.ts`.
      - Phase 2 tests.
  - Test Cases to Write:
    - `provider_layer_docs_have_required_sections`: docs consistency check validates headings on `docs/provider-layer.md`.
    - `provider_layer_docs_reference_existing_exports`: cheap check or manual review that documented functions are exported from `src/index.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; documents existing provider/model runtime APIs and mock helper.
    - Docs pages to create/edit:
      - `docs/provider-layer.md`: new detailed provider-layer API page.
      - `docs/index.md`: add provider/model connection and testing/mock helper entries.
    - `docs/index.md` update: Yes; add provider/model and mock/testing entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Created `docs/provider-layer.md` covering `createProviderRegistry`, `ProviderRegistry`, `createModelRegistry`, `ModelRegistry`, provider event helpers, `toolCallContent`, `createMockProvider`, and `MockProviderOptions`.
    - Documented explicit factory-returned registries, O(1) `Map` lookup, fail-closed unknown provider/model resolution before provider execution, and no hidden global registry.
    - Documented mock provider behavior as deterministic scripted events with no timers, credentials, SDKs, or network.
    - Confirmed `docs/index.md` already links `docs/provider-layer.md` under provider/model connection and testing/examples.
    - Ran checks for required Prism wiki headings, documented root exports against `src/index.ts`, the index link, and no real-looking `sk-` secret examples.

- [x] Document credentials, redaction, and OpenAI-compatible provider subpath
  - Acceptance Criteria:
    - Functional: Docs cover `resolveCredentialValue`, `CredentialValueSource`, `redactSecrets`, `errorToErrorInfo`, `createOpenAICompatibleProvider`, and `OpenAICompatibleProviderOptions`.
    - Performance: Docs state credential resolution happens per request and OpenAI-compatible streaming uses native/injected `fetch` with no SDK dependency.
    - Code Quality: Examples use current imports: root `prism` for credential/redaction helpers and `prism/providers/openai-compatible` for the adapter.
    - Security: Examples use fake keys only, mention host-owned credentials, redaction limits, abort propagation, and no real network in tests.
  - Approach:
    - Documentation Reviewed:
      - `src/credentials.ts` credential source helper.
      - `src/redaction.ts` recursive string/object redaction and error conversion.
      - `src/providers/openai-compatible.ts` adapter options, request mapping, SSE streaming, tool-call reconstruction, abort signal, and redaction.
      - `src/__tests__/credentials-redaction.test.ts` and `src/__tests__/openai-compatible.test.ts`.
      - `package.json` `./providers/openai-compatible` subpath export.
      - `plans/002-provider-streaming-and-mock-provider.md` adapter compromises/follow-ups.
    - Options Considered:
      - Put adapter docs on provider-layer page: rejected because the package subpath and security notes deserve their own page.
      - Two pages, one for security helpers and one for adapter: chosen; keeps credential guidance easy to find.
    - Chosen Approach:
      - Create `docs/credentials-and-redaction.md` and `docs/providers/openai-compatible.md`; link both from `docs/index.md`.
    - API Notes and Examples:
      ```ts
      import { createOpenAICompatibleProvider } from "prism/providers/openai-compatible";

      const provider = createOpenAICompatibleProvider({
        baseUrl: "https://api.openai.com/v1",
        apiKey: () => process.env.OPENAI_API_KEY,
      });
      ```
    - Files to Create/Edit:
      - `docs/credentials-and-redaction.md`: credential and redaction helper docs.
      - `docs/providers/openai-compatible.md`: adapter subpath docs.
      - `docs/index.md`: link security and adapter docs.
    - References:
      - `src/credentials.ts`.
      - `src/redaction.ts`.
      - `src/providers/openai-compatible.ts`.
      - `package.json` exports.
  - Test Cases to Write:
    - `credential_docs_have_required_sections`: docs consistency check validates headings on `docs/credentials-and-redaction.md`.
    - `openai_adapter_docs_have_required_sections`: docs consistency check validates headings on `docs/providers/openai-compatible.md`.
    - `openai_adapter_docs_avoid_real_secret_literals`: scan docs for known real-key-looking examples and require fake placeholders only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; documents existing credential/security helpers and provider adapter subpath.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: new detailed security helper API page.
      - `docs/providers/openai-compatible.md`: new detailed adapter API page.
      - `docs/index.md`: add/update security and provider adapter entries.
    - `docs/index.md` update: Yes; add credential/redaction and OpenAI-compatible adapter entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Created `docs/credentials-and-redaction.md` covering `resolveCredentialValue`, `CredentialValueSource`, `redactSecrets`, and `errorToErrorInfo`.
    - Created `docs/providers/openai-compatible.md` covering `createOpenAICompatibleProvider`, `OpenAICompatibleProviderOptions`, subpath imports, native/injected `fetch`, streaming event mapping, abort propagation, tool-call reconstruction, and adapter limits.
    - Documented that credentials are host-owned, resolved per request, not stored in registries/events, and that redaction only removes known supplied secret values.
    - Confirmed `docs/index.md` already links both docs pages.
    - Ran checks for required Prism wiki headings, documented exports against source files, index links, and no real-looking `sk-` secret examples.

- [x] Add lightweight docs consistency check
  - Acceptance Criteria:
    - Functional: A `node:test` check fails when a linked local docs page is missing or an API page lacks required Prism wiki headings.
    - Performance: Check runs under 1 second locally and adds no dependency.
    - Code Quality: Test is small, stdlib-only, and easy to update when docs pages are added.
    - Security: Test includes a simple guard against real-looking secret examples in docs.
  - Approach:
    - Documentation Reviewed:
      - `package.json` current `npm test` command builds and runs `dist/__tests__/*.test.js`.
      - Existing tests use `node:test`, `node:assert/strict`, and `node:fs` from stdlib.
      - `.agents/skills/create-plan/references/prism-wiki.md` required API page headings.
    - Options Considered:
      - Add a Markdown linter dependency: rejected; unnecessary for link/heading checks.
      - One tiny `node:test` file: chosen; matches existing test style and keeps dependency count flat.
    - Chosen Approach:
      - Add `src/__tests__/docs.test.ts` that reads `docs/index.md`, validates local Markdown links exist, validates required headings for known API pages, and scans docs for real-looking secret examples.
    - API Notes and Examples:
      ```ts
      import { readFileSync, existsSync } from "node:fs";
      import { describe, it } from "node:test";
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: docs consistency test.
      - `docs/index.md`: only if link paths need adjustment during test implementation.
    - References:
      - Existing `src/__tests__/*.test.ts` style.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `docs_index_links_exist`: all local Markdown links in `docs/index.md` point to existing files.
    - `api_docs_have_required_headings`: required API pages include Prism wiki headings.
    - `docs_do_not_include_real_looking_secrets`: docs avoid `sk-`-style concrete tokens except obvious fake placeholders if needed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No API change; this protects documentation quality.
    - Docs pages to create/edit:
      - `none`: no new API docs page required for an internal test.
    - `docs/index.md` update: No, unless test implementation exposes bad links.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/__tests__/docs.test.ts` using only `node:test`, `node:assert/strict`, `node:fs`, and `node:path`.
    - The test validates local Markdown links in `docs/index.md`, required Prism wiki headings on implemented API pages, and absence of real-looking `sk-` secret examples in docs.
    - Kept the check dependency-free and no-network.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 29 tests in 10 suites.

- [x] Verify Phase 0 and link README to docs
  - Acceptance Criteria:
    - Functional: `npm run build`, `npm run typecheck`, and `command npm test` pass; README points users to `/docs/index.md` for detailed API docs.
    - Performance: Full test suite remains under 10 seconds and docs checks do not perform network I/O.
    - Code Quality: README stays concise and does not duplicate detailed docs.
    - Security: README and docs keep secret guidance consistent: hosts own credentials and secrets must not be placed in prompts, messages, events, stores, logs, or docs examples.
  - Approach:
    - Documentation Reviewed:
      - `README.md` current public contracts and provider layer sections.
      - `package.json` scripts.
      - `docs/index.md` created in this phase.
    - Options Considered:
      - Expand README into full API guide: rejected; `/docs` is the detailed API source.
      - Add a short README docs pointer and run final checks: chosen.
    - Chosen Approach:
      - Add one README link to docs, run final verification, and record actual compromises/follow-ups in this plan.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `README.md`: add concise docs pointer.
      - `plans/003-documentation-governance-and-implemented-api-wiki.md`: mark tasks complete after checks and fill compromises/further actions.
    - References:
      - `docs/index.md`.
      - `package.json` scripts.
  - Test Cases to Write:
    - `npm run build`: validates docs test compiles.
    - `npm run typecheck`: validates strict TypeScript.
    - `command npm test`: validates existing runtime tests plus docs consistency.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No API behavior change; this updates top-level navigation to public docs.
    - Docs pages to create/edit:
      - `none`: detailed docs are created by prior tasks.
    - `docs/index.md` update: No, unless final review finds missing navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added a concise `README.md` docs section linking to `docs/index.md`.
    - Kept detailed API content in `/docs` instead of duplicating it in README.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 29 tests in 10 suites.

## Compromises Made
- The docs consistency check is intentionally small: it validates local links, required headings, and obvious `sk-`-style secrets only. Full Markdown linting and exhaustive API/export drift detection are deferred.
- Current docs cover implemented Phase 1/2 APIs only. Future runtime, extension, config, session, tool-dispatch, compaction, CLI/RPC, and security/trust APIs remain listed as future areas in `docs/index.md` until implemented.
- API examples are concise and compile conceptually; they are not extracted/compiled as standalone docs examples yet.

## Further Actions
- Priority high: Every future implementation plan must include `/docs` updates for public APIs, extension points, events, strategies, config surfaces, and package subpaths.
- Priority high: Phase 1 current-implementation alignment should update docs if contracts or provider event shapes change.
- Priority medium: Add stronger docs/export drift checks once public API volume grows.
