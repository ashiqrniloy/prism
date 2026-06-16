# Phase 2 — Extension Kernel and Contribution Registries

## Objectives
- Establish Prism's extension setup lifecycle before the agent/session runtime hardens behavior.
- Add explicit, host-owned contribution registries for every Phase 2 contribution category without hidden globals.
- Provide ordered events, error isolation, and middleware hooks as reusable primitives, not app-specific runtime logic.
- Document every new public extension point, registry, event, hook, and export under `/docs` as it lands.

## Expected Outcome
- Root exports include the extension kernel, event bus, contribution registries, and middleware registry APIs.
- Extensions can register provider, model, tool, context, skill, command, agent, builder, strategy, store, resource, settings, and credential contributions through `ExtensionAPI`.
- Extension setup/listener/middleware errors become redacted `extension_error` events by default and only throw when the host opts into that policy.
- Hosts can ignore extension loading and use the registries directly.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing primitives and finalize the minimal Phase 2 public surface
  - Acceptance Criteria:
    - Functional: Existing contracts, provider/model registries, docs, tests, and roadmap Phase 2 deliverables are inventoried; the task records which existing primitives are reused and which generic primitives must be added.
    - Performance: Inventory adds no runtime code, dependency, network call, filesystem discovery, or test slowdown.
    - Code Quality: The chosen surface rejects a DI container, app-specific plugin categories, and agent/session runtime behavior; it plans only reusable registries, event bus, kernel setup, and middleware primitives.
    - Security: The design keeps providers, credentials, settings, stores, resources, and extension loading host-controlled; errors planned for events use redacted `ErrorInfo`, never raw thrown values.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 — Extension kernel and contribution registries, target architecture, and non-negotiable boundaries.
      - `plans/001-public-contracts.md`, `plans/002-provider-streaming-and-mock-provider.md`, `plans/003-documentation-governance-and-implemented-api-wiki.md`, and `plans/004-current-implementation-alignment.md` follow-ups.
      - `docs/index.md`, `docs/public-contracts.md`, `docs/provider-layer.md`, `docs/credentials-and-redaction.md`, and `docs/api-page-template.md`.
      - `src/contracts.ts`, `src/providers.ts`, `src/models.ts`, `src/provider-events.ts`, `src/redaction.ts`, `src/index.ts`, and existing `src/__tests__/*.test.ts` patterns.
      - `package.json` scripts and `tsconfig.json` `NodeNext`/strict/declaration settings.
      - Node.js Test runner docs (`nodejs.org/api/test.html`, search result for v26.3.0): `node:test`, `describe`/`it`, and `node --test` behavior.
      - TypeScript TSConfig Reference (`typescriptlang.org/tsconfig`): Node ESM module options and declaration emit context.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
    - Options Considered:
      - Full plugin/DI container with manifests, dependency resolution, activation conditions, and lifecycle graph: rejected; Phase 3 owns manifests/config and no current consumer needs a container.
      - One generic `Map`-backed registry primitive plus a typed registry bundle: preferred; it covers many contribution categories with the least code.
      - Bespoke classes for every registry category: rejected unless Task 2 finds a category-specific behavior that a generic registry cannot handle.
      - Implement agent/session runtime behavior now: rejected; Phase 6 owns runtime loops.
    - Chosen Approach:
      - Reuse `createProviderRegistry()` and `createModelRegistry()` for providers/models.
      - Add one generic contribution registry for named/id-keyed contribution categories and a `createContributionRegistries()` bundle.
      - Add a small extension kernel that owns only setup order, `ExtensionAPI`, event bus, registry writes, middleware registration, and error policy.
      - Keep all new APIs root-exported only; do not add package subpaths unless a real user needs them.
    - API Notes and Examples:
      ```ts
      import { createExtensionKernel } from "prism";

      const kernel = createExtensionKernel();
      await kernel.load([extension]);

      const tools = kernel.registries.tools.list();
      ```
    - Files to Create/Edit:
      - `plans/005-extension-kernel-and-contribution-registries.md`: record primitive inventory decisions during execution.
      - `src/contracts.ts`: edit only after inventory confirms the minimal contract additions.
      - `docs/extensions.md`, `docs/contribution-registries.md`, `docs/middleware-hooks.md`: create/edit in later tasks based on the final surface.
    - References:
      - `roadmap.md` Phase 2 deliverables and acceptance.
      - `plans/004-current-implementation-alignment.md` decisions to keep explicit registries and no hidden provider/credential globals.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run typecheck`: proves inventory-only edits did not break exported types.
    - `command npm test`: only needed if the inventory task edits docs or source.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; yes if execution changes public surface, which later implementation tasks must document.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Inventory: `src/contracts.ts` already has generic provider, model, tool, context, skill, extension, session store, resource loader, settings provider, credential resolver, message/content, usage, and error contracts. Keep these as the base; do not add app-specific contribution categories.
    - Inventory: `createProviderRegistry()` and `createModelRegistry()` are explicit `Map`-backed registries, root-exported, documented, and tested. Reuse them unchanged inside the Phase 2 registry bundle instead of replacing them.
    - Inventory: credential helpers and docs already require edge resolution and known-secret redaction. Registries must not store credential values; `CredentialResolver` may be registered as a resolver contribution, but resolved `Credential.value` stays out of events, docs, tests, and registry metadata.
    - Inventory: `Extension`, `ExtensionAPI`, `ExtensionEvent`, and lifecycle event names exist as contracts only. Phase 2 should turn them into a runtime kernel while keeping extension loading host-explicit: no package discovery, manifests, filesystem config, activation graph, or hidden global kernel.
    - Decision: add `src/contributions.ts` with one generic `ContributionRegistry<T>` / `createContributionRegistry<T>()` plus `createContributionRegistries()`. The bundle should contain existing provider/model registries plus generic registries for tools, context providers, skills, commands, agents, input builders, prompt builders, compaction strategies, store factories, resource loaders, settings providers, and credential resolvers.
    - Decision: add only missing generic contribution contracts in `src/contracts.ts`: `CommandDefinition`, `CommandExecutionContext`, `CommandResult`, `AgentDefinition`, `InputBuilder`, `PromptBuilder`, `CompactionStrategy`, and `StoreFactory`. Keep names boring and root-exported; no package subpath.
    - Decision: registry keys are explicit strings. Use existing ids/names where contracts have them (`provider.id`, model provider/model key, `tool.name`, `contextProvider.name`, `skill.name`); new contracts should expose `name`. Same-key registration replaces the previous value deterministically so hosts can override defaults.
    - Decision: add `src/extensions.ts` with `createExtensionEventBus()` and `createExtensionKernel()`. Kernel owns only setup order, runtime `ExtensionAPI`, event dispatch, registry writes, middleware registration, and error policy. It must not run agents, tools, providers, filesystem loaders, or config discovery.
    - Decision: extension event dispatch is ordered by registration. Default error policy is `event`; setup/listener/middleware errors become redacted `extension_error` events using `ErrorInfo`. Opt-in `errorPolicy: "throw"` rethrows/rejects for hosts that want fail-fast behavior.
    - Decision: add `src/middleware.ts` with a generic ordered middleware registry. Minimal hook names are `provider_request`, `provider_response`, `input_assembly`, `prompt_build`, `context`, `tool_call`, `tool_result`, `retry`, `compaction`, `session_start`, and `session_shutdown`. Middleware only transforms/observes payloads when a host/runtime explicitly calls it.
    - Rejected: DI container, service locator, extension dependency graph, manifest/config loading, filesystem/package discovery, provider SDK wiring, tool execution, prompt assembly, compaction implementation, retry implementation, and agent/session runtime loops. Later phases own those.
    - Docs impact: no `/docs` changes in this inventory task. Tasks 2-5 remain responsible for documenting each public API before final verification.
    - Ran `npm run typecheck`; it passed. No source/docs changes were made, so `command npm test` was not needed for this task.

- [x] Add contribution contracts and direct registry APIs
  - Acceptance Criteria:
    - Functional: Public registries cover providers, models, tools, context providers, skills, commands, agents, input builders, prompt builders, compaction strategies, store factories, resource loaders, settings providers, and credential resolvers; unknown lookups fail closed.
    - Performance: Registry lookup is `Map`-backed/O(1), list order is deterministic, and no registry operation performs network, filesystem, provider, credential, or tool work.
    - Code Quality: Use one small generic registry primitive where possible; keep existing provider/model registry APIs stable; do not introduce a service locator or hidden singleton.
    - Security: Registries store contribution objects or resolver functions only, not credential values; docs/tests forbid secret-looking examples and raw credential serialization.
  - Approach:
    - Documentation Reviewed:
      - `src/providers.ts` and `src/models.ts` existing explicit registry APIs and O(1) behavior.
      - `docs/provider-layer.md` registry security/performance notes.
      - `src/contracts.ts` existing `ToolDefinition`, `ContextProvider`, `Skill`, `Agent`, `SessionStore`, `ResourceLoader`, `SettingsProvider`, and `CredentialResolver` contracts.
      - `roadmap.md` Phase 2 contribution registry list.
      - TypeScript TSConfig Reference for `NodeNext` ESM/declaration compatibility.
    - Options Considered:
      - Add one `createContributionRegistry<T>()` and a typed `createContributionRegistries()` bundle: chosen; it avoids a dozen duplicate classes.
      - Add category-specific factories for every contribution type now: rejected; most would be identical `Map` wrappers.
      - Put all registries into `src/contracts.ts`: rejected; contracts stay type-focused and factories live in runtime modules.
    - Chosen Approach:
      - Create `src/contributions.ts` with `ContributionRegistry<T>`, `createContributionRegistry<T>()`, `ContributionRegistries`, and `createContributionRegistries()`.
      - Reuse `ProviderRegistry` and `ModelRegistry` inside the bundle instead of replacing them.
      - Add only the minimal missing contribution contracts needed for the registry surface, likely `CommandDefinition`, `CommandExecutionContext`, `CommandResult`, `AgentDefinition`, `InputBuilder`, `PromptBuilder`, `CompactionStrategy`, and `StoreFactory` in `src/contracts.ts`; names are tentative until Task 1 records the final surface.
      - Let same-key registration replace the previous value deterministically so hosts/extensions can override defaults deliberately.
    - API Notes and Examples:
      ```ts
      import { createContributionRegistries } from "prism";

      const registries = createContributionRegistries();
      registries.tools.register("echo", tool);
      registries.credentialResolvers.register("openai", resolver);

      const echo = registries.tools.resolve("echo");
      ```
    - Files to Create/Edit:
      - `src/contributions.ts`: generic registry and registry bundle.
      - `src/contracts.ts`: minimal missing contribution contract types.
      - `src/index.ts`: root exports for new registry APIs and types.
      - `src/__tests__/contributions.test.ts`: direct registry behavior and isolation tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new public contract types.
      - `docs/contribution-registries.md`: public docs for registry APIs.
      - `docs/public-contracts.md`: add new contract names and notes.
      - `docs/index.md`: add Extensions/plugins registry navigation entry.
    - References:
      - `roadmap.md` Phase 2 acceptance: users can skip extension loading and use registries directly.
      - `plans/004-current-implementation-alignment.md` registry placement decision.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `contribution_registry_register_get_resolve_list_and_replace`: validates generic registry behavior and deterministic replacement.
    - `contribution_registry_unknown_key_fails_closed`: verifies `resolve()` throws before calling contribution code.
    - `contribution_registries_cover_phase_2_categories`: registers one fake contribution for every required category.
    - `separate_registry_bundles_do_not_share_state`: proves no hidden global registry exists.
    - `new_contract_types_import_from_root`: compile coverage for new exported types.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; this adds public registry APIs, contribution contracts, and root exports.
    - Docs pages to create/edit:
      - `docs/contribution-registries.md`: create detailed API page for generic registry and registry bundle.
      - `docs/public-contracts.md`: update contract inventory and examples for new contribution contracts.
      - `docs/index.md`: add `Extensions/plugins` entry for contribution registries.
    - `docs/index.md` update: Yes; add `Extensions/plugins - Contribution registries` navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/contributions.ts` with `ContributionRegistry<T>`, `ContributionRegistryOptions`, `createContributionRegistry<T>()`, `ContributionRegistries`, and `createContributionRegistries()`.
    - Kept existing `ProviderRegistry` and `ModelRegistry` unchanged and reused them as `registries.providers` and `registries.models`.
    - Added generic contribution registries for `tools`, `contextProviders`, `skills`, `commands`, `agents`, `inputBuilders`, `promptBuilders`, `compactionStrategies`, `storeFactories`, `resourceLoaders`, `settingsProviders`, and `credentialResolvers`.
    - Added missing contribution contracts in `src/contracts.ts`: `CommandDefinition`, `CommandExecutionContext`, `CommandResult`, `AgentDefinition`, `InputBuilder`, `InputBuildContext`, `PromptBuilder`, `PromptBuildRequest`, `CompactionStrategy`, `CompactionContext`, `CompactionResult`, and `StoreFactory`.
    - Root-exported the new registry factories/types through `src/index.ts`; no package subpath was added.
    - Registry behavior is `Map`-backed, deterministic, explicit-object state only. `register()` replaces same-key contributions, `get()` returns `undefined`, `resolve()` fails closed with `Unknown <label>: <key>`, and `list()` returns insertion order values.
    - Added `src/__tests__/contributions.test.ts` for register/get/resolve/list/replace behavior, fail-closed unknown lookup, all Phase 2 registry categories, and no shared state between registry bundles.
    - Updated `src/__tests__/public-contracts.test.ts` with compile/runtime coverage for new public contribution contract types.
    - Created `docs/contribution-registries.md`, updated `docs/public-contracts.md`, updated `docs/index.md`, and added the new page to `src/__tests__/docs.test.ts` required-heading checks.
    - Security decision: registries may hold `CredentialResolver` objects but never resolved credential values; docs state no tokens, headers, or secret-bearing settings belong in registries.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 37 tests in 11 suites. Test duration reported by Node was 266.923441ms.

- [x] Implement extension event bus, setup lifecycle, and runtime `ExtensionAPI`
  - Acceptance Criteria:
    - Functional: Extensions load in host-provided order; `ExtensionAPI` can register all Phase 2 contribution categories, subscribe to events, emit lifecycle events, and access the host-owned registry bundle.
    - Performance: Event dispatch is in registration order, uses no timers or background workers, and adds no dependency; setup only runs when the host explicitly calls `load()`.
    - Code Quality: Kernel state is held in explicit objects returned by factories; no module-level mutable registries, no filesystem/package discovery, no manifest loading.
    - Security: Setup/listener errors become redacted `extension_error` events by default; raw thrown objects and credential values are not emitted; host opt-in `throw` policy is tested.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` current `Extension`, `ExtensionAPI`, `ExtensionEvent`, and `ExtensionLifecycleEventName` contracts.
      - `src/redaction.ts` `errorToErrorInfo()` behavior.
      - `docs/public-contracts.md` extension/configuration notes.
      - `roadmap.md` kernel/event bus/error isolation boundaries.
      - Node.js Test runner docs for async `node:test` tests.
    - Options Considered:
      - Global extension loader: rejected; violates host-controlled loading.
      - Event bus as `EventTarget`: rejected for now; async ordered handlers and error isolation would need wrapper code anyway.
      - Tiny custom event bus with `on()`/`emit()` and explicit error policy: chosen; least code and matches current contracts.
    - Chosen Approach:
      - Create `src/extensions.ts` with `createExtensionEventBus()` and `createExtensionKernel()`.
      - Add `ExtensionKernelOptions` with default `errorPolicy: "event"` and opt-in `"throw"`; include a host-supplied error redactor or secret-aware redaction hook if Task 1 confirms the exact shape.
      - Implement `load(extensions)` by calling each `setup(api)` sequentially and catching errors through the same policy.
      - Expand `ExtensionAPI` registration methods to cover every contribution category and expose `registries` only as explicit kernel state.
    - API Notes and Examples:
      ```ts
      import { createExtensionKernel } from "prism";

      const kernel = createExtensionKernel({ errorPolicy: "event" });
      kernel.events.on("extension_error", (event) => console.error(event.error.message));
      await kernel.load([
        {
          name: "demo",
          setup(api) {
            api.registerProvider(provider);
            api.registerModel({ provider: "mock", model: "demo" });
            api.registerTool(tool);
          },
        },
      ]);
      ```
    - Files to Create/Edit:
      - `src/extensions.ts`: event bus, kernel factory, runtime API implementation, error policy.
      - `src/contracts.ts`: update `ExtensionAPI`, event names, and error event type as needed.
      - `src/index.ts`: root exports for extension kernel/event bus APIs.
      - `src/__tests__/extensions.test.ts`: setup order, API registration, event order, and error policy tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for expanded `ExtensionAPI`.
      - `docs/extensions.md`: public extension kernel/event bus docs.
      - `docs/public-contracts.md`: update extension contract summary.
      - `docs/index.md`: add extension kernel navigation entry.
    - References:
      - `roadmap.md` Phase 2 acceptance: extension errors become events and do not crash unless host policy says so.
      - `docs/credentials-and-redaction.md` redaction rules.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `extension_kernel_loads_extensions_in_order`: records setup order and registered events.
    - `extension_api_registers_all_contribution_categories`: loads one extension and resolves each contribution from kernel registries.
    - `event_bus_emits_handlers_in_registration_order`: proves ordered lifecycle dispatch.
    - `extension_setup_error_becomes_extension_error_event_by_default`: verifies redacted error event and no thrown rejection.
    - `extension_error_policy_throw_rejects_load`: verifies host opt-in crash behavior.
    - `event_handler_error_is_isolated`: verifies one failing listener does not stop later listeners under default policy.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; this adds extension kernel/event bus APIs and changes the public `ExtensionAPI` runtime behavior.
    - Docs pages to create/edit:
      - `docs/extensions.md`: create detailed API page for `Extension`, `ExtensionAPI`, event bus, kernel setup, and error policy.
      - `docs/public-contracts.md`: update extension contract list and examples.
      - `docs/index.md`: add `Extensions/plugins - Extension kernel and event bus` navigation entry.
    - `docs/index.md` update: Yes; add extension kernel entry under Extensions/plugins.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/extensions.ts` with `createExtensionEventBus()`, `createExtensionKernel()`, `ExtensionEventBus`, `ExtensionKernel`, `ExtensionKernelOptions`, `ExtensionErrorPolicy`, and ordered async event dispatch.
    - Expanded `ExtensionAPI` in `src/contracts.ts` with explicit `registries`, `on()`, `emit()`, and registration methods for providers, models, tools, context providers, skills, commands, agents, input builders, prompt builders, compaction strategies, store factories, resource loaders, settings providers, and credential resolvers.
    - Extended `ExtensionEvent` with optional `extension` and `error` fields and uses `type: "extension_error"` for isolated setup/listener failures.
    - Root-exported extension kernel/event bus APIs through `src/index.ts`; no package subpath or global kernel was added.
    - Default `errorPolicy: "event"` catches setup/listener errors, redacts known secrets through `errorToErrorInfo()`, emits `extension_error`, and continues later handlers/extensions. Opt-in `errorPolicy: "throw"` rejects/throws for fail-fast hosts.
    - Event handlers run in registration order and `on()` returns an unsubscribe function.
    - Kernel loading is host-explicit and sequential. It does not discover packages, read manifests/config, run providers, execute tools, load resources, or start sessions.
    - Added `src/__tests__/extensions.test.ts` covering ordered event handlers, listener error isolation/redaction, extension setup order, all contribution-category registration through `ExtensionAPI`, setup error events, and opt-in throw policy.
    - Created `docs/extensions.md`, updated `docs/index.md`, updated `docs/public-contracts.md`, and added the new page to `src/__tests__/docs.test.ts` required-heading checks.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 43 tests in 13 suites. Test duration reported by Node was 273.390418ms.

- [x] Add ordered middleware hook registry
  - Acceptance Criteria:
    - Functional: Public middleware hooks exist for provider requests/responses, input assembly, prompt building, context, tool calls/results, retry, compaction, session start, and session shutdown; extensions can register middleware through `ExtensionAPI`.
    - Performance: Middleware execution is ordered, synchronous-or-async, dependency-free, and performs no runtime work unless the host/runtime explicitly invokes a hook.
    - Code Quality: Middleware is generic and reusable; it does not implement provider adapters, tool dispatch, prompt assembly, retry policy, compaction policy, or session runtime behavior.
    - Security: Middleware errors use the same redacted error policy as extension events; middleware cannot bypass host permissions because Phase 2 only registers/runs hooks, not tools/resources.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 middleware hook list and target architecture middleware/strategy invocation order.
      - `src/contracts.ts` `ExtensionLifecycleEventName`, `ProviderRequest`, `ProviderEvent`, `ContextBlock`, `ToolCallContent`, `ToolResult`, and session/compaction event contracts.
      - `docs/public-contracts.md` event and runtime contract notes.
      - `docs/provider-layer.md` provider request/event docs.
    - Options Considered:
      - Domain-specific middleware APIs for every future runtime phase: rejected; those phases can add typed wrappers when real payloads exist.
      - Generic ordered middleware registry keyed by hook name: chosen; smallest primitive that future runtime can reuse.
      - Middleware that can execute host tools/resources directly: rejected; Phase 4/6 own permissioned execution.
    - Chosen Approach:
      - Create `src/middleware.ts` with `MiddlewareHookName`, `Middleware<T>`, `MiddlewareRegistry`, and `createMiddlewareRegistry()`.
      - Add `api.use(hook, middleware)` or equivalent to `ExtensionAPI`, backed by the kernel's middleware registry.
      - Provide a tiny runner such as `run(hook, value)` that composes registered middleware in order and returns the transformed value; exact stop/continue shape is finalized in Task 1, but must stay generic.
      - Emit `extension_error` for middleware failures under default policy and throw only when configured.
    - API Notes and Examples:
      ```ts
      const middleware = createMiddlewareRegistry();

      middleware.use("provider_request", async (request, next) => {
        return next({ ...request, metadata: { ...request.metadata, source: "demo" } });
      });

      const request = await middleware.run("provider_request", originalRequest);
      ```
    - Files to Create/Edit:
      - `src/middleware.ts`: middleware registry and runner.
      - `src/extensions.ts`: wire kernel/API middleware registration and error policy.
      - `src/contracts.ts`: add public middleware hook names/types if they belong with contracts.
      - `src/index.ts`: root exports for middleware APIs.
      - `src/__tests__/middleware.test.ts`: ordered run, transform, isolation, and error policy tests.
      - `src/__tests__/extensions.test.ts`: extension API can register middleware.
      - `docs/middleware-hooks.md`: public middleware docs.
      - `docs/extensions.md`: mention `api.use()`/middleware registration.
      - `docs/index.md`: add middleware hooks navigation entry.
    - References:
      - `roadmap.md` Phase 2 deliverable: middleware hooks for provider, input, context, tools, retry, compaction, and session lifecycle.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `middleware_runs_in_registration_order`: two hooks mutate a payload in deterministic order.
    - `middleware_can_transform_payload_without_runtime_side_effects`: validates pure transform behavior.
    - `extension_api_can_register_middleware`: extension setup registers a hook and direct run observes it.
    - `middleware_error_emits_extension_error_by_default`: verifies redacted error and no crash under default policy.
    - `middleware_error_policy_throw_rejects_run`: verifies host opt-in throw behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; this adds public middleware hook names, registry APIs, and `ExtensionAPI` middleware registration.
    - Docs pages to create/edit:
      - `docs/middleware-hooks.md`: create detailed API page for hook names, middleware registration, runner behavior, and error policy.
      - `docs/extensions.md`: update extension API examples for middleware.
      - `docs/index.md`: add `Extensions/plugins - Middleware hooks` navigation entry.
    - `docs/index.md` update: Yes; add middleware hooks under Extensions/plugins and relate to future provider/input/tool/session runtime areas.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/middleware.ts` with `MiddlewareHookName`, `MiddlewareNext<T>`, `Middleware<T>`, `MiddlewareRegistryOptions`, `MiddlewareRegistry`, and `createMiddlewareRegistry()`.
    - Built-in hook names are `provider_request`, `provider_response`, `input_assembly`, `prompt_build`, `context`, `tool_call`, `tool_result`, `retry`, `compaction`, `session_start`, and `session_shutdown`.
    - Middleware registration is ordered and returns an unsubscribe function. `run(hook, value)` runs only when a host/runtime explicitly invokes it and returns the transformed value; no provider, tool, resource, retry, compaction, or session behavior is implemented.
    - Default middleware `errorPolicy: "event"` emits redacted `extension_error` events through an optional `onError` callback and continues later middleware with the current value. Opt-in `errorPolicy: "throw"` rejects on the first middleware error.
    - Wired `createExtensionKernel()` to create or accept a host-owned `MiddlewareRegistry`, expose it as `kernel.middleware`, and pass it to `ExtensionAPI` as `api.middleware` plus `api.use()`.
    - Updated `ExtensionAPI` contracts with `middleware` and `use<T>(hook, middleware)`.
    - Root-exported middleware APIs through `src/index.ts`; no package subpath or global middleware registry was added.
    - Added `src/__tests__/middleware.test.ts` for ordered execution, pure transform behavior, redacted error events with continuation, and opt-in throw policy.
    - Updated `src/__tests__/extensions.test.ts` to verify extension setup can register middleware and hosts can run it through `kernel.middleware`.
    - Created `docs/middleware-hooks.md`, updated `docs/extensions.md`, `docs/public-contracts.md`, `docs/index.md`, and added the new page to `src/__tests__/docs.test.ts` required-heading checks.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 48 tests in 14 suites. Test duration reported by Node was 274.664665ms.

- [x] Update public docs and docs consistency checks for Phase 2 APIs
  - Acceptance Criteria:
    - Functional: New docs pages cover extension kernel/event bus, contribution registries, and middleware hooks using the Prism API page structure; `docs/index.md` links each new public surface.
    - Performance: Docs checks remain static file checks with no site generator, network, or new dependency.
    - Code Quality: Docs examples import only actual root exports, avoid future-only runtime claims, and clearly state that manifests/config/agent runtime are later phases.
    - Security: Docs include extension error redaction, no hidden globals, credential-resolver safety, and no real-looking `sk-` tokens.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` required API page sections.
      - `docs/api-page-template.md` current template.
      - `src/__tests__/docs.test.ts` required headings, index link, and secret-example checks.
      - New source/test files from Tasks 2–4.
    - Options Considered:
      - Add docs pages during each implementation task only: useful but easy to miss final index/test wiring.
      - Dedicated docs consistency task after public APIs exist: chosen; still keep implementation tasks responsible for their docs, then verify all links/headings together.
    - Chosen Approach:
      - Create/update `docs/contribution-registries.md`, `docs/extensions.md`, and `docs/middleware-hooks.md` following the required headings.
      - Update `docs/index.md` Extensions/plugins group and remove Phase 2 items from the future-only list where applicable.
      - Update `src/__tests__/docs.test.ts` `apiPages` to include the new docs pages.
    - API Notes and Examples:
      ```ts
      import {
        createContributionRegistries,
        createExtensionKernel,
        createMiddlewareRegistry,
      } from "prism";
      ```
    - Files to Create/Edit:
      - `docs/contribution-registries.md`: detailed registry page.
      - `docs/extensions.md`: detailed extension kernel/event bus page.
      - `docs/middleware-hooks.md`: detailed middleware page.
      - `docs/public-contracts.md`: add new contract inventory and examples.
      - `docs/index.md`: navigation updates.
      - `src/__tests__/docs.test.ts`: include new API docs in required-heading checks.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `roadmap.md` non-negotiable boundary: docs ship with APIs.
  - Test Cases to Write:
    - `docs_index_links_new_phase_2_pages`: verifies all new local links exist.
    - `phase_2_api_pages_include_required_headings`: extends docs required-heading check to new pages.
    - `phase_2_docs_reference_existing_root_exports`: cheap check or manual grep for documented new exports in `src/index.ts`.
    - `docs_avoid_real_looking_secret_examples`: existing check still passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; this task publishes/validates the docs for all Phase 2 public APIs.
    - Docs pages to create/edit:
      - `docs/contribution-registries.md`: create/update.
      - `docs/extensions.md`: create/update.
      - `docs/middleware-hooks.md`: create/update.
      - `docs/public-contracts.md`: update.
      - `docs/index.md`: update.
    - `docs/index.md` update: Yes; add links for contribution registries, extension kernel/event bus, and middleware hooks under Extensions/plugins.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Reviewed Phase 2 public docs pages and navigation: `docs/contribution-registries.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, `docs/public-contracts.md`, and `docs/index.md`.
    - Confirmed `docs/index.md` links all implemented Phase 2 pages under `Extensions/plugins` and leaves only later-phase areas in `Future API areas`.
    - Confirmed Phase 2 API pages follow the required wiki/API headings already enforced by `src/__tests__/docs.test.ts`.
    - Added `phase_2_docs_reference_existing_root_exports` coverage to `src/__tests__/docs.test.ts` for `createContributionRegistry`, `createContributionRegistries`, `createExtensionKernel`, `createExtensionEventBus`, and `createMiddlewareRegistry`.
    - Kept docs static: no site generator, network access, or new dependency.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 49 tests in 14 suites. Test duration reported by Node was 301.266682ms.

- [x] Final verification and Phase 2 closeout
  - Acceptance Criteria:
    - Functional: All Phase 2 tasks are complete; extension registration, direct registry usage, event error isolation, and middleware hook behavior are covered by tests and docs.
    - Performance: `command npm test` stays under 10 seconds and uses no network, timers, provider SDKs, or filesystem discovery beyond static docs/source reads.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; root exports, declaration files, docs examples, and tests agree.
    - Security: Final review confirms no hidden globals, no credential values in registries/events/docs/tests, redacted extension errors, and host opt-in throw policy.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts: `build`, `typecheck`, and `test`.
      - `docs/index.md` and all Phase 2 API pages after edits.
      - `src/index.ts` root exports and emitted `dist/*.d.ts` after build.
      - Node.js Test runner docs for `node --test` behavior.
    - Options Considered:
      - Add lint/API-extractor tooling: rejected for now; strict TypeScript, root export tests, and docs checks are enough.
      - Run existing scripts and record closeout notes: chosen.
    - Chosen Approach:
      - Run `npm run build`, `npm run typecheck`, and `command npm test` after all source/docs changes.
      - Update this plan's checkboxes, execution notes, `Compromises Made`, and `Further Actions` only after checks pass.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/005-extension-kernel-and-contribution-registries.md`: mark tasks complete and fill closeout sections during execution.
      - Any touched Phase 2 source/docs/test file: final consistency fixes only.
    - References:
      - `roadmap.md` Phase 2 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: emits JavaScript and declaration files.
    - `npm run typecheck`: validates strict TypeScript types.
    - `command npm test`: runs runtime, public-boundary, extension, registry, middleware, provider, and docs checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by verification itself; it confirms docs for prior public API changes.
    - Docs pages to create/edit:
      - `none`: verification does not add API docs by itself.
    - `docs/index.md` update: No unless final verification reveals a missing navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Verified all Phase 2 task checkboxes are complete.
    - Ran `npm run build`; it passed and emitted declarations.
    - Ran `npm run typecheck`; it passed under strict TypeScript.
    - Ran `command npm test`; it passed with 49 tests in 14 suites. Test duration reported by Node was 286.383541ms.
    - Final review confirmed Phase 2 root exports, docs pages, docs tests, registry tests, extension tests, middleware tests, and public contract tests agree.
    - Final security review confirmed no hidden globals, no credential values in registries/events/docs/tests, redacted extension/middleware error paths, and host opt-in throw policy coverage.

## Compromises Made
- Kept middleware payloads generic instead of adding domain-specific provider/tool/session payload contracts; later runtime phases can add typed wrappers when real callers exist.
- Kept extension loading host-explicit only: no manifest parsing, package discovery, dependency graph, activation conditions, or config loader.
- Kept registries as simple `Map`-backed in-memory objects; no persistence, priorities, namespaces, or collision policy beyond deterministic replacement.

## Further Actions
- Phase 3: add host-controlled configuration/manifests only if needed by the roadmap, wiring them into explicit registries/kernel objects rather than globals.
- Phase 4/6: add typed middleware payload helpers at the first real provider/tool/session runtime call sites.
- Before publishing, review generated declaration files as part of release packaging, not as a new Phase 2 abstraction.
