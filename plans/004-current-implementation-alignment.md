# Phase 1 — Current Implementation Alignment

## Objectives
- Align the completed public-contract and provider/model code with the extensible target architecture before session runtime work begins.
- Settle the current provider selection, credential, registry, provider-event, and contract-organization decisions with the smallest useful code/docs changes.
- Keep provider and credential ownership explicit: no hidden globals, no secret storage in registries/events/history/docs.

## Expected Outcome
- Alignment decisions are recorded in this plan execution notes and, when public behavior changes, in `/docs`.
- Existing public exports either stay compatible or are deliberately changed with tests and docs.
- Provider event coverage is strong enough for the next runtime phase without adding a conformance framework prematurely.
- `npm run build`, `npm run typecheck`, and `command npm test` pass.

## Tasks

- [x] Inventory existing primitives and record alignment decisions
  - Acceptance Criteria:
    - Functional: Current primitives are inventoried for `AgentConfig.provider`, `AgentConfig.credentials`, provider/model registries, `ProviderEvent`, provider adapters, docs, and `src/contracts.ts` organization; each Phase 1 roadmap question has an explicit decision or a named follow-up task.
    - Performance: Inventory adds no runtime code, no package dependency, and no test slowdown.
    - Code Quality: Decisions prefer existing generic primitives and reject mode/domain-specific core logic; no one-off abstraction is introduced just to make the review look bigger.
    - Security: The inventory confirms there is no hidden provider/credential global and no plan to store secrets in registries, provider events, docs examples, or session-facing data.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 — Current implementation alignment and non-negotiable boundaries.
      - `plans/001-public-contracts.md`, `plans/002-provider-streaming-and-mock-provider.md`, and `plans/003-documentation-governance-and-implemented-api-wiki.md` follow-ups.
      - `docs/index.md`, `docs/public-contracts.md`, `docs/provider-layer.md`, `docs/providers/openai-compatible.md`, and `docs/credentials-and-redaction.md`.
      - `src/contracts.ts`, `src/providers.ts`, `src/models.ts`, `src/provider-events.ts`, `src/providers/openai-compatible.ts`, and existing `src/__tests__/*.test.ts`.
      - Context7 `/nodejs/node` docs, `doc/api/test.md`: `node --test` and ESM `import { describe, it } from "node:test"`.
    - Options Considered:
      - Redesign provider/session contracts now: rejected; session runtime and extension kernel are not implemented yet.
      - Inventory first and make only proven alignment changes: chosen; it keeps Phase 1 as cleanup, not speculative architecture.
    - Chosen Approach:
      - Create a short execution note in this plan during task execution listing each existing primitive, what it already covers, what is missing, and which later task owns any change.
      - Use existing TypeScript contracts, registries, and provider event helpers before adding any new primitive.
      - No Rust/editor-mode primitive applies in this TypeScript package; also reject any Prism-core logic specific to an app, provider brand, or host domain.
    - API Notes and Examples:
      ```ts
      import type { AgentConfig, AIProvider, ProviderEvent } from "prism";
      import { createModelRegistry, createProviderRegistry } from "prism";
      ```
    - Files to Create/Edit:
      - `plans/004-current-implementation-alignment.md`: add execution notes and decisions while completing the task.
      - `docs/public-contracts.md`: edit only if the review changes or clarifies public contract behavior.
      - `docs/provider-layer.md`: edit only if the review changes or clarifies registry/provider-event behavior.
    - References:
      - `roadmap.md` Phase 1 deliverables and acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation rules.
  - Test Cases to Write:
    - `npm run typecheck`: verifies the review did not break exported types.
    - `command npm test`: verifies existing public-boundary and docs checks still pass if docs are touched.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by the inventory itself; yes if it changes or clarifies public behavior, in which case later tasks must update docs.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan unless public API behavior changes.
    - `docs/index.md` update: No; no new docs page is planned for the inventory.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Inventory: `AgentConfig.provider` is an optional direct `AIProvider` for simple host-owned wiring; `AgentConfig.model.provider` plus `createProviderRegistry()`/`createModelRegistry()` already supports explicit host-managed provider/model selection without a hidden global. Follow-up: Task 2 should keep this model unless a concrete runtime blocker appears, and clarify docs rather than add fields if wording is enough.
    - Inventory: `AgentConfig.credentials` is an optional explicit `CredentialResolver`; `resolveCredentialValue()` accepts direct/callback/resolver sources and the OpenAI-compatible adapter resolves `apiKey` per request. No global credential store/env scan exists. Follow-up: Task 2 should preserve explicit credential injection and avoid putting credential resolvers in registries.
    - Inventory: `ProviderRegistry` and `ModelRegistry` live beside their runtime factories in `src/providers.ts` and `src/models.ts`, are root-exported from `src/index.ts`, and are documented in `docs/provider-layer.md`; they are not in `src/contracts.ts`. Decision for Task 3: keep them runtime-module interfaces unless implementation finds a real Phase 2 need to move them.
    - Inventory: `ProviderEvent` covers `message_start`, `content_delta` for text/thinking/images via `ContentBlock`, `tool_call_delta`, final `tool_call`, `usage`, `done` with optional usage, and redacted `error`. Follow-up: Task 4 should add minimal coverage for under-tested image content deltas and OpenAI reasoning/thinking mapping; no provider conformance framework yet.
    - Inventory: provider adapters currently include `createMockProvider()` and the `prism/providers/openai-compatible` subpath. The OpenAI-compatible adapter uses native/injected `fetch`, Chat Completions SSE, abort propagation, usage mapping, reasoning-to-thinking mapping, tool-call reconstruction, and redacted errors. Follow-up: Task 4 owns any small conformance tests; Responses API and broader multimodal mapping remain deferred until a real consumer needs them.
    - Inventory: docs already exist for public contracts, provider layer, credentials/redaction, and OpenAI-compatible adapter, with `src/__tests__/docs.test.ts` checking links/headings/secret-looking examples. No docs page was changed by this inventory-only task.
    - Inventory: `src/contracts.ts` remains one grouped file with public type-only contracts. Decision for Task 5: keep it as one file unless earlier tasks uncover real churn-reducing value in a split; root exports must remain stable if split later.
    - Security check: source/docs review found no hidden provider global, no hidden credential global, no registry credential storage, and no plan to put secrets in provider events, docs examples, or session-facing data.
    - Ran `npm run typecheck` and `command npm test`; both passed.

- [x] Align provider selection and credential ownership
  - Acceptance Criteria:
    - Functional: `AgentConfig.provider`, `AgentConfig.credentials`, `ModelConfig.provider`, and registry usage either remain valid for extension/config-driven provider selection or are minimally adjusted; no hidden provider or credential globals are introduced.
    - Performance: Provider/model lookup remains explicit and O(1) where registries are used; no network, filesystem, or credential lookup is added to registry resolution.
    - Code Quality: The public shape has one clear provider-selection story for hosts: direct provider for simple use, explicit registries/config for host-managed selection, and no speculative runtime resolver before the extension kernel.
    - Security: Credentials remain host-owned and resolved only at the edge that needs them; registries, docs examples, and test fixtures do not store real secrets.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` definitions of `AgentConfig`, `ModelConfig`, `AIProvider`, `CredentialResolver`, and `CredentialRequest`.
      - `src/providers.ts` and `src/models.ts` explicit registry factories.
      - `docs/public-contracts.md` extension/configuration notes.
      - `docs/provider-layer.md` registry security/performance notes.
      - `roadmap.md` target architecture sections for extension/package model and configuration/manifests.
    - Options Considered:
      - Add a global provider/credential resolver: rejected; violates host-controlled and no-hidden-globals boundaries.
      - Add registry fields to `AgentConfig` now: defer unless the inventory proves current contracts block Phase 2/3; runtime ownership is not implemented yet.
      - Keep direct provider plus explicit registries and document the intended selection path: preferred lazy path if tests/docs show it is enough.
    - Chosen Approach:
      - First try to keep the existing direct-provider and explicit-registry model.
      - If wording is ambiguous, update `docs/public-contracts.md` and `docs/provider-layer.md` rather than adding fields.
      - Only edit `src/contracts.ts` if the inventory finds a real type mismatch that blocks extension/config-driven selection.
    - API Notes and Examples:
      ```ts
      const providers = createProviderRegistry([provider]);
      const models = createModelRegistry([{ provider: provider.id, model: "demo" }]);
      const model = models.resolve(provider.id, "demo");
      const selected = providers.resolve(model);
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: only if `AgentConfig` or credential contracts need a real public type adjustment.
      - `src/__tests__/public-contracts.test.ts`: compile/boundary coverage for any changed contract.
      - `src/__tests__/registries.test.ts`: selection/fail-closed coverage if registry behavior changes.
      - `docs/public-contracts.md`: document any clarified provider/credential ownership behavior.
      - `docs/provider-layer.md`: document any clarified registry selection behavior.
      - `plans/004-current-implementation-alignment.md`: record final decision and any no-change rationale.
    - References:
      - `roadmap.md` non-negotiable boundaries: host controlled, secrets never enter history/events, docs ship with APIs.
      - `plans/002-provider-streaming-and-mock-provider.md` credential follow-up.
  - Test Cases to Write:
    - `host_can_select_provider_with_explicit_registries`: verifies model/provider registry resolution remains enough for host-managed selection.
    - `credential_resolver_is_explicit_not_global`: compile or runtime check that credential resolution is passed explicitly and not pulled from a hidden registry.
    - `public_contracts_do_not_mention_app_specific_tool_categories`: existing boundary check still passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes if contract fields or documented selection semantics change; provider/credential ownership is public behavior.
    - Docs pages to create/edit:
      - `docs/public-contracts.md`: update `AgentConfig`, `ModelConfig`, and credential notes if semantics change.
      - `docs/provider-layer.md`: update registry selection notes if semantics change.
    - `docs/index.md` update: No unless a new docs page is added; likely existing entries stay sufficient.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Kept the existing public contract shape: `AgentConfig.provider` remains an optional direct provider for simple host wiring; `ModelConfig.provider` with explicit `createProviderRegistry()` and `createModelRegistry()` remains the config-driven selection path.
    - Did not add provider registry fields to `AgentConfig` and did not add any global provider or credential resolver.
    - Updated `docs/public-contracts.md` to clarify direct-provider wiring versus explicit registry-based selection and to state credential resolvers should be passed only to the edge that needs a credential.
    - Updated `docs/provider-layer.md` to state credential resolvers stay outside provider/model registries.
    - Added `hosts can select providers with explicit registries` in `src/__tests__/registries.test.ts`.
    - Added `credential resolution is explicit and not global` in `src/__tests__/credentials-redaction.test.ts`.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 31 tests in 10 suites.

- [x] Decide provider/model registry interface placement
  - Acceptance Criteria:
    - Functional: The project records whether `ProviderRegistry` and `ModelRegistry` remain runtime-module interfaces exported from `providers.ts`/`models.ts`, move into `contracts.ts`, or get another minimal boundary; root exports and docs match the decision.
    - Performance: Registry implementation remains `Map`-backed with O(1) lookup and no added dependency.
    - Code Quality: The decision avoids a contracts-file dump if runtime-only interfaces are clearer; source organization changes only if they improve the next implementation phase.
    - Security: Registry docs/tests keep the rule that registries store provider/model metadata, not credentials or secret-bearing settings.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` current type-only public contracts.
      - `src/providers.ts` `ProviderRegistry` and `createProviderRegistry()`.
      - `src/models.ts` `ModelRegistry` and `createModelRegistry()`.
      - `src/index.ts` root type/value exports.
      - `docs/public-contracts.md` and `docs/provider-layer.md`.
    - Options Considered:
      - Move registry interfaces into `contracts.ts`: useful only if external packages need to implement registry contracts without importing runtime modules.
      - Keep registry interfaces beside their factory implementations: preferred unless a real Phase 2 extension API needs otherwise.
      - Hide registry interfaces: rejected because they are already public and documented.
    - Chosen Approach:
      - Keep the existing module-local registry interfaces unless Task 1 finds a concrete blocker.
      - If keeping them, document that they are public runtime API types, not core data contracts.
    - API Notes and Examples:
      ```ts
      import type { ModelRegistry, ProviderRegistry } from "prism";
      import { createModelRegistry, createProviderRegistry } from "prism";
      ```
    - Files to Create/Edit:
      - `src/providers.ts`: only if the provider registry interface moves or changes.
      - `src/models.ts`: only if the model registry interface moves or changes.
      - `src/contracts.ts`: only if registry interfaces are deliberately moved into public contracts.
      - `src/index.ts`: keep root exports accurate.
      - `docs/provider-layer.md`: document the final placement/meaning.
      - `docs/public-contracts.md`: edit only if `contracts.ts` changes or needs a note.
      - `plans/004-current-implementation-alignment.md`: record final decision.
    - References:
      - `roadmap.md` Phase 1 deliverable: decide whether registry interfaces belong in `contracts.ts` or runtime modules only.
      - `plans/001-public-contracts.md` compromise: split contracts by domain only when useful.
  - Test Cases to Write:
    - `registry_types_import_from_root`: compile coverage that public root exports still expose registry types.
    - `registry_lookup_remains_fail_closed`: existing or updated registry tests prove unknown provider/model throws before provider calls.
    - `provider_layer_docs_reference_existing_exports`: docs check or manual grep that documented registry APIs still exist.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes if interface placement or export path changes; otherwise only documentation clarification.
    - Docs pages to create/edit:
      - `docs/provider-layer.md`: update registry API notes if placement is clarified or changed.
      - `docs/public-contracts.md`: update only if registry interfaces move into `contracts.ts` or are discussed there.
    - `docs/index.md` update: No; existing Provider layer link remains the right navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Kept `ProviderRegistry` in `src/providers.ts` and `ModelRegistry` in `src/models.ts`, beside `createProviderRegistry()` and `createModelRegistry()`.
    - Did not move registry interfaces into `src/contracts.ts`; they are public runtime API types, not type-only data contracts.
    - Kept root exports stable from `src/index.ts`.
    - Updated `docs/provider-layer.md` to record the placement decision.
    - Added compile coverage in `src/__tests__/registries.test.ts` by importing `ProviderRegistry` and `ModelRegistry` from the root package and annotating registry instances.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 31 tests in 10 suites.

- [x] Review ProviderEvent shape and add minimal conformance coverage
  - Acceptance Criteria:
    - Functional: `ProviderEvent` shape is reviewed for `tool_call_delta`, final `tool_call`, `usage`, `done.usage`, thinking deltas, image content deltas, and provider errors; any change is reflected in helpers, adapters, docs, and tests.
    - Performance: New checks are small `node:test` tests with no network and no timers; the full suite remains under 10 seconds.
    - Code Quality: Do not add a generic provider conformance framework yet; use tiny table-style tests unless a second real adapter requires shared fixtures.
    - Security: Provider error tests keep secret redaction coverage, and docs examples do not include real-looking API keys.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ProviderEvent`, `ContentBlock`, `Usage`, and `ErrorInfo`.
      - `src/provider-events.ts` helper functions.
      - `src/providers/openai-compatible.ts` mapping for SSE text, reasoning content, tool-call fragments, usage, abort, and errors.
      - `src/__tests__/provider-events.test.ts`, `src/__tests__/mock-provider.test.ts`, and `src/__tests__/openai-compatible.test.ts`.
      - `docs/provider-layer.md` provider event helper docs.
      - `docs/providers/openai-compatible.md` adapter event mapping docs.
      - Context7 `/nodejs/node` docs, `doc/api/test.md`: `describe()`, `it()`, and `node --test`.
    - Options Considered:
      - Build a reusable provider-adapter conformance harness now: rejected; one real adapter does not justify framework code.
      - Add focused event/helper/adapter assertions for current gaps: chosen; smallest safety net before session runtime consumes events.
    - Chosen Approach:
      - Review the event union first.
      - Add or update helper tests for event shapes that are currently under-covered, especially image content deltas and provider errors.
      - Add OpenAI-compatible tests only for actual adapter gaps, such as reasoning/thinking mapping or malformed tool argument behavior.
    - API Notes and Examples:
      ```ts
      providerToolCallDelta({ index: 0, id: "call_1", name: "lookup", argumentsText: "{\"id\"" });
      providerContentDelta({ type: "image", url: "https://example.test/image.png" });
      providerError(new Error("bad fake-secret"), ["fake-secret"]);
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: only if the public event union changes.
      - `src/provider-events.ts`: only if helpers need to match an event shape change.
      - `src/providers/openai-compatible.ts`: only if adapter mapping needs alignment.
      - `src/__tests__/provider-events.test.ts`: event helper coverage.
      - `src/__tests__/openai-compatible.test.ts`: adapter coverage for current event expectations.
      - `docs/provider-layer.md`: update provider event docs for any shape/semantic change.
      - `docs/providers/openai-compatible.md`: update adapter mapping docs for any shape/semantic change.
      - `docs/public-contracts.md`: update `ProviderEvent` summary if the union changes.
    - References:
      - `roadmap.md` Phase 1 deliverable: review final `ProviderEvent` shape for tool calls, usage, thinking, images, and provider errors.
      - `plans/002-provider-streaming-and-mock-provider.md` follow-up on provider edge-case conformance tests.
  - Test Cases to Write:
    - `provider_event_helpers_cover_images_thinking_usage_tool_delta_and_errors`: validates helper-created event shapes and redaction.
    - `openai_adapter_maps_reasoning_to_thinking_delta`: validates reasoning content mapping if not already covered.
    - `openai_adapter_keeps_tool_delta_and_final_tool_call_contract`: validates fragment and final call behavior still match docs.
    - `docs_do_not_include_real_looking_secrets`: existing docs check still passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes if `ProviderEvent` shape, helper semantics, or adapter event mapping changes.
    - Docs pages to create/edit:
      - `docs/public-contracts.md`: update provider event contract summary if the union changes.
      - `docs/provider-layer.md`: update helper/event documentation if behavior changes.
      - `docs/providers/openai-compatible.md`: update adapter event mapping if behavior changes.
    - `docs/index.md` update: No; existing links still cover these APIs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Reviewed `ProviderEvent` and kept the current shape: `message_start`, `content_delta`, `tool_call_delta`, final `tool_call`, `usage`, `done`, and `error` cover the next runtime phase without a breaking contract change.
    - Did not add a provider conformance framework; one real adapter still does not justify it.
    - Added `providerContentDelta()` image coverage to `src/__tests__/provider-events.test.ts` alongside existing text, thinking, tool-call, usage, done, and redacted-error checks.
    - Added OpenAI-compatible reasoning-content coverage in `src/__tests__/openai-compatible.test.ts`, proving `reasoning_content` maps to a Prism `thinking` content delta.
    - Kept docs unchanged because public event shapes and documented adapter behavior did not change.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 32 tests in 10 suites.

- [x] Record `src/contracts.ts` organization decision
  - Acceptance Criteria:
    - Functional: The plan records whether `src/contracts.ts` remains one file or splits by domain now; if split, root type exports remain source-compatible for users.
    - Performance: Organization changes do not alter runtime output beyond type/module declarations and do not add dependencies.
    - Code Quality: Keep one file if splitting is churn; split only if it makes the next phase materially easier.
    - Security: Existing boundary tests still prove core public contracts avoid app/tool/domain leaks.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` current single-file contract groups.
      - `src/index.ts` root barrel exports.
      - `src/__tests__/public-contracts.test.ts` compile-only and boundary checks.
      - `docs/public-contracts.md` grouped contract documentation.
      - `plans/001-public-contracts.md` compromise to split by domain only when useful.
    - Options Considered:
      - Split contracts by domain now: useful only if Phase 2 implementation needs smaller imports or clearer ownership.
      - Keep `contracts.ts` as one file and group docs/tests by domain: preferred if no current implementation pain exists.
    - Chosen Approach:
      - Default to keeping `contracts.ts` as one file and recording that decision, unless earlier tasks uncover a concrete maintenance problem.
      - If a split is necessary, keep `src/index.ts` exports stable and add compile tests.
    - API Notes and Examples:
      ```ts
      import type { AgentConfig, ProviderEvent, ToolDefinition } from "prism";
      ```
    - Files to Create/Edit:
      - `plans/004-current-implementation-alignment.md`: record the organization decision.
      - `src/contracts.ts`: edit only if a split or small type alignment is chosen.
      - `src/index.ts`: update only if source files split.
      - `src/__tests__/public-contracts.test.ts`: update compile examples if files split or types change.
      - `docs/public-contracts.md`: update only if public docs need to explain a changed contract grouping.
    - References:
      - `roadmap.md` Phase 1 deliverable: record whether `src/contracts.ts` remains one file or splits by domain.
      - `plans/001-public-contracts.md` compromises/follow-ups.
  - Test Cases to Write:
    - `root_contract_type_exports_stay_stable`: compile-only import from `prism` for representative contract types.
    - `public_contracts_do_not_mention_app_specific_tool_categories`: existing boundary check still passes after any reorganization.
    - `npm run build`: confirms emitted declarations are valid if files move.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No if only an internal organization decision is recorded; yes if exported type names or docs grouping changes.
    - Docs pages to create/edit:
      - `docs/public-contracts.md`: update only for public grouping/export changes.
    - `docs/index.md` update: No; existing Public contracts entry remains sufficient.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Decision: keep `src/contracts.ts` as one grouped type-only contracts file for now.
    - Did not split contracts by domain; current grouping is still small enough, docs already group contracts by functionality, and Phase 2 can split only when implementation pressure makes it useful.
    - Kept `src/index.ts` root type exports unchanged.
    - No docs update was needed because public type names, import paths, and grouping semantics did not change.
    - Existing public-contract tests still compile representative root imports and check app/tool/domain boundary leaks.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 32 tests in 10 suites.

- [x] Final verification and Phase 1 closeout
  - Acceptance Criteria:
    - Functional: All Phase 1 decisions and code/docs changes are complete; this plan has checked tasks, execution notes, compromises, and further actions filled in.
    - Performance: `command npm test` completes under 10 seconds and provider/docs tests use no network.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; public docs match exported APIs.
    - Security: Final review confirms no hidden globals, no real-looking secrets in docs, and credential behavior remains explicit.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts: `build`, `typecheck`, and `test`.
      - `src/__tests__/docs.test.ts` docs link/heading/secret checks.
      - `docs/index.md` navigation after any edits.
      - Context7 `/nodejs/node` docs, `doc/api/test.md`: `node --test` command behavior.
    - Options Considered:
      - Add a separate lint/doc tool: rejected; current `node:test` docs check is enough.
      - Run the existing build/typecheck/test commands and record results: chosen.
    - Chosen Approach:
      - Run the existing scripts once after all prior tasks.
      - Fill `Compromises Made` and `Further Actions` with actual deviations only after checks pass.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/004-current-implementation-alignment.md`: mark completed tasks and fill closeout sections.
      - `docs/index.md`: edit only if previous public docs edits require navigation changes.
      - Any docs/source/test file touched by previous tasks: final consistency fixes only.
    - References:
      - `roadmap.md` Phase 1 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: compiles TypeScript and declarations.
    - `npm run typecheck`: validates strict type checking.
    - `command npm test`: runs runtime, public-boundary, provider, adapter, and docs checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by verification itself; it confirms prior public docs updates.
    - Docs pages to create/edit:
      - `none`: verification does not add API docs by itself.
    - `docs/index.md` update: No unless prior tasks added a new detailed page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Verified all Phase 1 tasks are checked and have execution notes.
    - Confirmed final decisions: keep direct provider plus explicit registries, keep credentials explicit and edge-resolved, keep registry interfaces in runtime modules, keep current `ProviderEvent` shape, and keep `src/contracts.ts` as one file.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 32 tests in 10 suites.
    - Test duration reported by Node was 214.553259ms, under the 10 second target.
    - Docs checks passed, including local links, required API headings, and no real-looking `sk-` secret examples.

## Compromises Made
- Kept provider selection unchanged: direct `AgentConfig.provider` for simple wiring and explicit provider/model registries for host-managed selection. No runtime resolver was added before the extension kernel exists.
- Kept `ProviderRegistry` and `ModelRegistry` in runtime modules instead of moving them into `src/contracts.ts`; they remain public root-exported types.
- Kept the current `ProviderEvent` union and added only focused coverage for image content deltas and OpenAI reasoning-to-thinking mapping. No adapter conformance framework yet.
- Kept `src/contracts.ts` as one grouped file; splitting by domain is deferred until implementation pressure makes it worth the churn.

## Further Actions
- Priority high: Phase 2 should build the extension kernel and contribution registries on top of the explicit provider/model registry pattern, without hidden globals.
- Priority high: Future credential/settings work must keep credentials edge-resolved and out of registries, events, docs examples, prompts, and stores.
- Priority medium: Add a shared provider adapter conformance harness only after a second real adapter exists or repeated edge-case tests start duplicating code.
- Priority low: Revisit contract file splitting after extension/session runtime code creates a concrete maintenance need.
