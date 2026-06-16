# Phase 4 — Host-Owned Tool Harness

## Objectives
- Add host-owned tool registration, filtering, validation, middleware, and dispatch without shipping built-in app tools.
- Fail closed for unknown, denied, or malformed tool calls.
- Emit clear tool lifecycle events for blocked calls, progress, result, and error.
- Document every public tool API, event, permission, and middleware behavior under `/docs`.

## Expected Outcome
- Root exports include `createToolRegistry()` and small tool-harness helpers/types built on existing `ToolDefinition`, `ToolCallContent`, `ToolResult`, middleware, and contribution primitives.
- Tool lookup is `Map`-backed O(1), active allow/deny filtering works per agent/session/run, and tool arguments must be object-shaped before execution.
- Hosts can provide optional argument validation and extensions can add middleware, but dispatch enforces host permissions after middleware so middleware cannot bypass them.
- No shell, filesystem, browser, desktop, web-app, Synapta, network, or domain-specific tools are added to Prism core.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing primitives and lock the minimal Phase 4 public surface
  - Acceptance Criteria:
    - Functional: Existing tool contracts, contribution registries, middleware hooks, extension API, agent events, docs, tests, and roadmap Phase 4 requirements are inventoried; the task records which primitives are reused and which generic tool-harness additions are required.
    - Performance: Inventory adds no runtime code, dependency, provider call, filesystem discovery, package execution, network call, tool execution, or test slowdown.
    - Code Quality: The chosen surface rejects built-in tools, a sandbox, a JSON Schema validator dependency, per-app permission policy classes, and mode-specific Rust/Node logic; it plans only reusable TypeScript primitives.
    - Security: Design keeps tools host-owned, unknown tools fail closed, permissions remain host-controlled, arguments are object-shaped, and middleware cannot grant permissions by itself.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 4 and non-negotiable boundaries: no built-in app tools, host controlled, secrets never enter events/history, docs ship with APIs.
      - `src/contracts.ts` `ToolDefinition`, `ToolRegistry`, `ToolExecutionContext`, `ToolResult`, `ToolCallContent`, `AgentEvent`, `ExtensionAPI`, and `JsonObject`.
      - `src/contributions.ts` `ContributionRegistry<T>` and `ContributionRegistries.tools`.
      - `src/middleware.ts` `tool_call` and `tool_result` hooks.
      - `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/middleware-hooks.md`, `docs/extensions.md`, `docs/index.md`, and `docs/api-page-template.md`.
      - `src/__tests__/*.test.ts` existing `node:test` and compile-coverage patterns.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
    - Options Considered:
      - Reuse only `createContributionRegistry<ToolDefinition>()`: rejected; roadmap explicitly calls for `createToolRegistry()` and tool-specific name registration ergonomics.
      - Add JSON Schema validation dependency: rejected; Phase 4 only needs JSON Schema-compatible `parameters` pass-through plus optional host validator.
      - Build sandbox/permissions engine: rejected; Prism cannot sandbox host tools and only needs deterministic allow/deny filtering.
      - Add built-in shell/filesystem tools: rejected by roadmap boundary.
    - Chosen Approach:
      - Add a tiny `src/tools.ts` module with `createToolRegistry()`, allow/deny filter helpers, and `executeToolCall()`/`dispatchToolCall()` naming confirmed during inventory.
      - Reuse `ToolDefinition.parameters` as untouched JSON Schema-compatible metadata; do not interpret schema unless a host validator is supplied.
      - Reuse `MiddlewareRegistry.run("tool_call")` and `run("tool_result")`, but re-check registry/permissions/object args after middleware before execution.
      - Extend public events minimally for `tool_execution_blocked` and `tool_execution_progress` while reusing existing started/finished/error events.
    - API Notes and Examples:
      ```ts
      import { createToolRegistry } from "prism";

      const tools = createToolRegistry();
      tools.register({ name: "echo", execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }) });
      const echo = tools.get("echo");
      ```
    - Files to Create/Edit:
      - `plans/007-host-tool-harness.md`: record inventory decisions during execution.
      - `src/tools.ts`, `src/contracts.ts`, `src/index.ts`, tests, and docs in later tasks after inventory confirms exact names.
    - References:
      - `roadmap.md` Phase 4 deliverables and acceptance.
      - `plans/005-extension-kernel-and-contribution-registries.md` and `plans/006-configuration-manifests-and-resource-loading.md` decisions to keep registries/config host-explicit.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run typecheck`: proves inventory-only edits did not break exported types if the task updates source/docs.
    - `command npm test`: only needed if the inventory task changes docs/source beyond this plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document public APIs/events they add.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Inventory: `src/contracts.ts` already has the core tool data contracts: `ToolDefinition`, `ToolCallContent`, `ToolResultContent`, `ToolResult`, `ToolExecutionContext`, `ToolRegistry`, `JsonObject`, and existing tool lifecycle `AgentEvent` variants for started/finished/error. Reuse these; do not add parallel tool/result contracts.
    - Inventory: `ToolCallContent.arguments` and `ToolDefinition.execute(args, context)` are already typed as `JsonObject`, but runtime dispatch still needs an object-shape guard for provider/middleware input. Arrays, `null`, and primitives must fail before validation or execution.
    - Inventory: `src/contributions.ts` already has `ContributionRegistries.tools` as an inert extension contribution store. It is keyed by host-provided strings and `Map`-backed, but it is not the active tool registry or dispatcher. Keep contribution storage separate from active host selection.
    - Inventory: `src/extensions.ts` `ExtensionAPI.registerTool()` writes only to `registries.tools` by `tool.name`. Extensions can contribute definitions, but Phase 4 must require the host to copy/select/filter those tools before dispatch; no extension auto-enables execution.
    - Inventory: `src/middleware.ts` already has ordered `tool_call` and `tool_result` hooks. Reuse `MiddlewareRegistry.run()` for dispatch boundaries, then re-check the post-middleware tool name and active filters before execution so middleware cannot grant permission by mutation.
    - Inventory: docs already state middleware cannot bypass permissions in Phase 2 terms and registries perform no tool work. Phase 4 docs must tighten this for the actual dispatcher and move Tools out of `docs/index.md` future API areas.
    - Decision: add one new runtime module, `src/tools.ts`, root-exported from `src/index.ts`. No package subpath, no new dependency, no sandbox, no built-in tool pack, no filesystem/network helpers, no provider loop, and no app/domain-specific policy classes.
    - Decision: minimal public surface is `createToolRegistry()`, `filterTools()` for exact allow/deny filtering, `resolveTool()` only if useful as a tiny helper or registry method, `dispatchToolCall()` for execution, plus small option/result types needed to type those functions. Do not add `executeToolCall()` unless implementation proves a separate lower-level helper removes duplication.
    - Decision: `createToolRegistry()` should be a `Map<string, ToolDefinition>` wrapper with `register(tool)`, `get(name)`, `resolve(name)`, and `list()`. Extend the public `ToolRegistry` interface with `resolve(name)` during the registry task so `AgentConfig.tools` can accept the same shape.
    - Decision: filtering stays plain exact-name data: `allow?: readonly string[]`, `deny?: readonly string[]`. Compose agent/session/run filters by applying them in caller-provided order; deny wins, unknown names stay absent, and empty/missing allow means all currently registered tools except denied.
    - Decision: `ToolDefinition.parameters` remains JSON Schema-compatible metadata only. Prism will store/pass it through untouched; host-supplied validation is a callback over object args, not a built-in JSON Schema interpreter.
    - Decision: `dispatchToolCall()` takes explicit inputs only: `call`, `registry`, optional `filter`, optional `middleware`, optional `validate`, required `context`, optional `emit`, optional `secrets`, and optional progress callback. It returns a `ToolResult` for success, blocked calls, validator failures, and tool errors unless implementation finds a reason to rethrow host-abort errors.
    - Decision: dispatch order is lookup/filter/object-args precheck, `tool_call` middleware, lookup/filter/object-args recheck, host validator, `tool_execution_started`, tool execute, `tool_result` middleware, `tool_execution_finished`; blocked/error paths emit the matching event and never call `execute` after failure.
    - Decision: add only two new `AgentEvent` variants now: `tool_execution_blocked` with session/run/call-or-name/reason/error fields and `tool_execution_progress` with session/run/toolCallId/name/progress metadata. Reuse existing `tool_execution_started`, `tool_execution_finished`, and `tool_execution_error`.
    - Decision: redaction should use existing `errorToErrorInfo()`/`redactSecrets()` for thrown errors and validation/block messages. Do not put credentials or secret-bearing args into events by default.
    - Rejected: JSON Schema validator dependency, tool sandbox, built-in shell/filesystem/browser/network tools, glob/prefix permissions, global registry, DI container, policy class hierarchy, dynamic package loading, mode-specific Rust/Node logic, retries/queues/timers, and provider-agent runtime loops.
    - Tests/checks: no source or `/docs` files changed for this inventory-only task, so the task-specific `npm run typecheck` / `command npm test` gates were not required.

- [x] Add `createToolRegistry()` and active allow/deny filtering
  - Acceptance Criteria:
    - Functional: `createToolRegistry()` supports `register(tool)`, `get(name)`, `resolve(name)`, and `list()`; active filtering accepts allow and deny lists for agent/session/run scope with deny taking precedence and unknown tools excluded.
    - Performance: Registry lookup is O(1) via `Map`; filtering is O(tool count + rule count), dependency-free, and performs no tool execution, provider call, filesystem, network, credential, or resource work.
    - Code Quality: Reuse existing `ToolDefinition`/`ToolRegistry`; keep filters as plain data/functions; no DI container, inheritance hierarchy, global registry, or app-specific policy engine.
    - Security: Unknown and denied tool names fail closed; filters never add tools not already registered; `parameters` is stored and returned unchanged as JSON-compatible metadata.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ToolDefinition` and `ToolRegistry`.
      - `src/contributions.ts` generic registry shape and `Map` lookup pattern.
      - `docs/contribution-registries.md` O(1), fail-closed registry notes.
      - `roadmap.md` Phase 4 active allow/deny filtering and JSON Schema-compatible `parameters` pass-through.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Make tool registry an alias of contribution registry: rejected unless inventory proves it satisfies API and docs; tool-specific register-by-name is clearer and smaller for hosts.
      - Pattern/glob permissions: rejected; exact names are safer and enough for Phase 4.
      - Merge rules into `AgentConfig`: rejected for now; a standalone helper is reusable until Phase 6 runtime wires scopes together.
    - Chosen Approach:
      - Implement `src/tools.ts` with a `Map<string, ToolDefinition>` registry and small exact-name filter types such as `ToolFilter`, `ToolFilterScope`, or equivalent.
      - Provide a helper that resolves active tools from a registry plus ordered filters, with deny overriding allow and empty allow meaning all registered tools unless denied.
      - Root-export from `src/index.ts`.
    - API Notes and Examples:
      ```ts
      const active = filterTools(tools.list(), {
        allow: ["math.add"],
        deny: ["shell.exec"],
      });
      ```
    - Files to Create/Edit:
      - `src/tools.ts`: tool registry and filter helper implementation.
      - `src/contracts.ts`: add `resolve()` to `ToolRegistry` only if keeping interface aligned is worth the public change.
      - `src/index.ts`: root exports.
      - `src/__tests__/tools.test.ts`: registry/filter tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new public types.
      - `docs/tools.md`: document registry/filter APIs.
      - `docs/public-contracts.md`: update tool contract inventory if public types change.
      - `docs/index.md`: add Tools navigation entry.
      - `src/__tests__/docs.test.ts`: include docs/export checks.
    - References:
      - `roadmap.md` Phase 4 acceptance.
      - `docs/contribution-registries.md` registry behavior.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `tool_registry_register_get_resolve_list`: validates registration, O(1)-style keyed lookup behavior, insertion-order list, and fail-closed resolve errors.
    - `tool_registry_replaces_same_name`: validates deterministic replacement by name.
    - `tool_filter_denies_unknown_and_denied_tools`: validates unknown tools are absent and deny wins.
    - `tool_filter_allows_exact_names_only`: validates exact allow lists and no glob/prefix surprises.
    - `tool_parameters_are_passed_through`: validates schema-like JSON metadata is not transformed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public tool registry/filter APIs and possibly refines `ToolRegistry`.
    - Docs pages to create/edit:
      - `docs/tools.md`: create detailed API page for tool registry and filtering.
      - `docs/public-contracts.md`: update if `ToolRegistry` or related public types change.
      - `docs/index.md`: add Tools entry.
    - `docs/index.md` update: Yes; add `Tools - Tool registry, filtering, and dispatch` navigation entry and remove Tools from future API areas once dispatch docs land.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/tools.ts` with `createToolRegistry()` and `filterTools()` only; no dispatch, sandbox, provider loop, package loading, or built-in tools.
    - Extended `ToolRegistry` with `resolve(name)` so `AgentConfig.tools` can use the public active registry shape directly.
    - Root-exported `createToolRegistry`, `filterTools`, `ToolFilter`, and `ToolFilterInput` from `src/index.ts`.
    - Filtering uses exact names. Missing/empty allow lists allow all registered input tools unless denied; multiple allow lists compose by intersection; deny lists always win.
    - Added `src/__tests__/tools.test.ts` coverage for register/get/resolve/list, same-name replacement, parameters pass-through, unknown/denied exclusion, exact-name matching, and scoped filter composition.
    - Added compile coverage in `src/__tests__/public-contracts.test.ts` for the Phase 4 registry/filter exports.
    - Created `docs/tools.md`, linked it from `docs/index.md`, updated `docs/public-contracts.md` and `docs/contribution-registries.md`, and added docs/export checks in `src/__tests__/docs.test.ts`.
    - Verification passed: `npm run typecheck`; `command npm test`.

- [x] Add tool dispatch with object-argument checks, optional host validation, middleware, and events
  - Acceptance Criteria:
    - Functional: Dispatching an unknown, denied, or non-object-argument tool call returns/emits a blocked or error result and never calls `execute`; valid calls run `tool_call` middleware, host validation, tool execution, and `tool_result` middleware in deterministic order.
    - Performance: Dispatch does one registry lookup per enforcement point, no schema validation unless host provides a validator, no retries, no queues, no timers, no network, and no new dependency.
    - Code Quality: Dispatcher is a small function over explicit inputs (`registry`, filters, middleware, validator, context, emit/progress callback); no session runtime, no provider loop, no hidden globals, and no built-in tools.
    - Security: Permissions are checked after middleware and before execution; validators receive object args only; errors/events are redacted with existing helpers where applicable; middleware cannot bypass host allow/deny.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ToolCallContent`, `ToolExecutionContext`, `ToolResult`, `AgentEvent`, and `ErrorInfo`.
      - `src/middleware.ts` ordered hook behavior and error policy.
      - `docs/middleware-hooks.md` `tool_call`/`tool_result` extension notes.
      - `docs/credentials-and-redaction.md` error redaction helpers.
      - `roadmap.md` Phase 4 dispatch, validator, middleware, and event requirements.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Interpret JSON Schema in core: rejected; pass-through plus host validator is enough.
      - Let middleware return an already-authorized tool: rejected; host permissions must be re-checked after middleware.
      - Throw for all blocked calls: rejected; returning a structured `ToolResult` and emitting events is easier for future agent runtime.
      - Add progress as a full event emitter class: rejected; a callback on execution context/options is sufficient until Phase 6 runtime exists.
    - Chosen Approach:
      - Add a dispatcher helper with options for active filters, optional `validate(tool, args, context)`, optional middleware registry, optional `emit(event)`, optional secrets for redaction, and optional progress callback.
      - Introduce minimal event payloads for `tool_execution_blocked` and `tool_execution_progress`; reuse existing `tool_execution_started`, `tool_execution_finished`, and `tool_execution_error`.
      - Ensure non-object/array/null arguments are rejected before validator or execute.
    - API Notes and Examples:
      ```ts
      const result = await dispatchToolCall({
        call: { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } },
        registry: tools,
        context: { sessionId: "s1", runId: "r1", toolCallId: "call_1" },
        filter: { allow: ["echo"] },
        validate: (_tool, args) => typeof args.text === "string" ? undefined : "text is required",
      });
      ```
    - Files to Create/Edit:
      - `src/tools.ts`: dispatcher, validator/progress/event option types.
      - `src/contracts.ts`: add blocked/progress tool agent events and any reusable context fields.
      - `src/index.ts`: root exports.
      - `src/__tests__/tools.test.ts`: dispatch/middleware/event tests.
      - `src/__tests__/middleware.test.ts`: add tool hook interaction only if existing tests need coverage.
      - `docs/tools.md`: document dispatch, permissions, validation, middleware, and events.
      - `docs/middleware-hooks.md`: update tool middleware cannot bypass permissions.
      - `docs/public-contracts.md`: update tool event inventory.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: ensure Tools docs are linked/checked.
    - References:
      - `roadmap.md` Phase 4 deliverables and acceptance.
      - `docs/middleware-hooks.md` and `docs/credentials-and-redaction.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `dispatch_unknown_tool_fails_closed_without_execute`: validates unregistered calls are blocked.
    - `dispatch_denied_tool_fails_closed_after_middleware`: validates middleware cannot grant permissions.
    - `dispatch_rejects_non_object_args`: validates null, array, string, number, and boolean args do not reach validators/tools.
    - `dispatch_runs_validator_before_execute`: validates host validator can block bad object args.
    - `dispatch_runs_tool_call_and_result_middleware_in_order`: validates extension middleware order and result transformation.
    - `dispatch_emits_started_progress_finished_error_blocked_events`: validates event behavior for success, progress, tool throw, and blocked calls.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public dispatch behavior, validator hook, middleware semantics, and new tool events.
    - Docs pages to create/edit:
      - `docs/tools.md`: add dispatch/events sections.
      - `docs/middleware-hooks.md`: update tool hook security notes.
      - `docs/public-contracts.md`: update AgentEvent/tool result inventory.
      - `docs/index.md`: ensure Tools entry is active.
    - `docs/index.md` update: Yes; ensure `Tools - Tool registry, filtering, and dispatch` links to `docs/tools.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `dispatchToolCall()` in `src/tools.ts` with explicit `DispatchToolCallOptions` and `ToolValidator` types; root-exported both from `src/index.ts`.
    - Dispatch now prechecks active registry/filter/object arguments, runs `tool_call` middleware, then rechecks registry/filter/object arguments before validator or execution. Middleware cannot enable a denied or unknown post-middleware tool name.
    - Host validation is a callback over object-shaped args only. It can return `void`, a string, or `ErrorInfo`; blocked calls return `ToolResult.error` and emit `tool_execution_blocked` when `emit` is provided.
    - Extended `ToolExecutionContext` with optional `progress()` and added `tool_execution_progress` plus `tool_execution_blocked` to `AgentEvent`; existing started/finished/error events are reused.
    - Tool execution errors are caught into `ToolResult.error` and `tool_execution_error`; known secret values are redacted through existing redaction helpers.
    - Added dispatch tests in `src/__tests__/tools.test.ts` for unknown tools, post-middleware denial, non-object args, validator blocking, middleware order/result transformation, and started/progress/finished/error/blocked events.
    - Updated compile coverage in `src/__tests__/public-contracts.test.ts` for dispatch option/validator/event types.
    - Updated `docs/tools.md`, `docs/middleware-hooks.md`, `docs/public-contracts.md`, `docs/index.md`, and docs export checks for dispatch, events, middleware security, and root exports.
    - Verification passed: `npm run typecheck`; `command npm test`.

- [x] Wire extension/contribution integration and compile-time host examples
  - Acceptance Criteria:
    - Functional: Tool definitions registered through `ContributionRegistries.tools` or `ExtensionAPI.registerTool()` can be copied into or used by the host-owned tool harness without bypassing filters; examples compile from root exports.
    - Performance: Integration is in-memory and performs no dynamic import, manifest execution, filesystem, network, provider, credential, or tool work during registration.
    - Code Quality: Avoid parallel tool contribution systems; keep extension registration unchanged unless a tiny helper is required; tests document the intended bridge.
    - Security: Extensions can contribute tool definitions but cannot activate, allow, or execute them without host dispatch inputs and filters.
  - Approach:
    - Documentation Reviewed:
      - `src/extensions.ts` `ExtensionAPI.registerTool()` implementation.
      - `src/contributions.ts` `ContributionRegistries.tools`.
      - `docs/extensions.md` and `docs/contribution-registries.md` extension contribution behavior.
      - `roadmap.md` Phase 4 acceptance: extensions can add middleware but cannot bypass host permissions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Make extension registration auto-enable tools: rejected; host-owned permissions require explicit activation.
      - Replace contribution registry tools with `ToolRegistry`: rejected unless a tiny adapter is cleaner; current registries are broader contribution storage.
      - Add a helper to import registered contributions into a tool registry: chosen only if tests show repeated boilerplate.
    - Chosen Approach:
      - Add compile/runtime tests showing extension-contributed tools remain inert until the host registers/selects them for dispatch.
      - Add a tiny adapter such as `registerTools(registry, tools)` only if it removes duplicate code and remains generic.
      - Update docs to distinguish contribution, active filtering, and execution.
    - API Notes and Examples:
      ```ts
      const registries = createContributionRegistries();
      registries.tools.register("echo", echoTool);

      const activeTools = createToolRegistry();
      activeTools.register(registries.tools.resolve("echo"));
      ```
    - Files to Create/Edit:
      - `src/tools.ts`: optional tiny adapter helper if chosen.
      - `src/__tests__/tools.test.ts`: extension/contribution integration tests.
      - `src/__tests__/public-contracts.test.ts`: compile host example.
      - `docs/tools.md`: contribution vs activation docs.
      - `docs/extensions.md`: update tool contribution notes if behavior is clarified.
      - `docs/contribution-registries.md`: link to tool dispatch docs.
    - References:
      - `docs/extensions.md`, `docs/contribution-registries.md`, and `roadmap.md` Phase 4.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `extension_registered_tool_is_not_executed_without_host_dispatch`: validates contribution is inert.
    - `contributed_tool_can_be_registered_into_host_tool_registry`: validates bridge path.
    - `extension_middleware_cannot_bypass_host_tool_filter`: validates middleware limitation across extension API.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; clarifies extension/contribution behavior around tool activation and dispatch.
    - Docs pages to create/edit:
      - `docs/tools.md`: document contributed vs active tools.
      - `docs/extensions.md`: update `registerTool()` notes.
      - `docs/contribution-registries.md`: add related API link/clarification.
    - `docs/index.md` update: No new entry beyond the Tools entry unless docs structure changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Kept implementation code unchanged; no adapter helper was needed because `createToolRegistry([registries.tools.resolve(name)])` is already the smallest bridge.
    - Added `src/__tests__/tools.test.ts` contribution integration coverage: extension-registered tools remain inert without host dispatch, contributed tools can be selected into an active host registry, and extension middleware cannot bypass active host filters.
    - Updated `src/__tests__/public-contracts.test.ts` compile coverage to show a host loading an extension into `createContributionRegistries()`, resolving the contributed tool, registering it in `createToolRegistry()`, and dispatching with a filter.
    - Updated `docs/tools.md`, `docs/extensions.md`, and `docs/contribution-registries.md` to clarify that `ExtensionAPI.registerTool()` and `ContributionRegistries.tools` contribute inert definitions only; hosts must activate selected definitions with `createToolRegistry()` and `dispatchToolCall()`.
    - Verification passed: `npm run typecheck`; `command npm test`.

- [x] Final verification and wiki consistency check
  - Acceptance Criteria:
    - Functional: Phase 4 acceptance is covered by tests/docs: unregistered tools fail closed, args are object-shaped, and extension middleware cannot bypass host permissions.
    - Performance: Test suite remains fast and offline; no new dependencies, timers, watchers, network calls, filesystem scans, package discovery, or built-in tools were added.
    - Code Quality: Public exports, docs links, examples, and tests are consistent; implementation remains minimal and host-owned.
    - Security: Docs and tests explicitly state Prism does not sandbox tools, does not ship app tools, does not auto-enable extension tools, and does not serialize secrets in tool events/errors.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md` Tools entry and future API areas.
      - `docs/tools.md`, `docs/public-contracts.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/middleware-hooks.md`, and `docs/credentials-and-redaction.md`.
      - `src/__tests__/docs.test.ts` docs/export checks.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add an extra docs tooling dependency: rejected; existing docs test is enough.
      - Add broad end-to-end agent runtime tests: rejected; Phase 6 owns provider/tool loop runtime.
      - Add sample shell/filesystem tools for demonstration: rejected by roadmap boundary.
    - Chosen Approach:
      - Run `npm run build`, `npm run typecheck`, and `command npm test`.
      - Fix only direct Phase 4 breakage.
      - Update this plan with execution notes, compromises, and further actions after checks pass.
    - API Notes and Examples:
      ```sh
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/007-host-tool-harness.md`: mark completed tasks and fill closeout sections after successful verification.
      - Directly affected docs/tests only if verification finds an inconsistency.
    - References:
      - `roadmap.md` Phase 4 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: validates emitted JS/types and package exports.
    - `npm run typecheck`: validates strict TypeScript types.
    - `command npm test`: validates runtime tests and docs checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new API by verification alone; it validates docs for APIs added by earlier tasks.
    - Docs pages to create/edit:
      - `none`: only update docs if verification finds missing/incorrect Phase 4 documentation.
    - `docs/index.md` update: No unless verification finds navigation missing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Ran final Phase 4 verification: `npm run build`, `npm run typecheck`, and `command npm test`.
    - Verification passed with 84 tests across 21 suites and 0 failures.
    - Docs checks passed for linked pages, required API headings, root export references, non-goals, and secret-like examples.
    - Acceptance coverage confirmed in tests/docs for unknown tools failing closed, object-shaped arguments, post-middleware permission enforcement, inert extension tool contributions, no built-in app tools, no new dependencies, and host-owned activation/dispatch.
    - No verification-only source or docs fixes were required.

## Compromises Made
- No JSON Schema interpreter was added; `parameters` remains pass-through metadata and hosts provide validation callbacks when needed.
- No sandbox or built-in shell/filesystem/browser/network tool pack was added; Prism only dispatches host-registered tools.
- No adapter helper was added for contribution-to-active-tool registration; direct `createToolRegistry([registries.tools.resolve(name)])` kept the public surface smaller.

## Further Actions
- Phase 6 agent/session runtime should wire provider-emitted tool calls into this dispatcher when runtime loops are implemented.
- Add schema validation only if host validators prove repetitive enough to justify a tiny optional helper; do not add a dependency by default.
