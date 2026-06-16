# Phase 5 — Input, Prompt, Context, and Skills Pipeline

## Objectives
- Make provider input assembly explicit, inspectable, and replaceable before the agent/session runtime is built.
- Add default runtime primitives for user input, attachments/resources, history, summaries, tool results, context blocks, skills, active tools, and host metadata.
- Add ordered context resolution, a replaceable prompt composer, a host-owned skill registry, and tiny prompt-template expansion.
- Keep tools, resources, credentials, and permissions host-controlled; skills must not grant tool permissions.
- Document every public input/prompt/context/skill API under `/docs` as it is added.

## Expected Outcome
- Root exports include default input/prompt helpers, context resolution helpers, `createSkillRegistry()`, and prompt-template expansion helpers, with exact names finalized by the primitive review.
- Hosts can assemble a `ProviderRequest`-ready value from common inputs without starting an agent runtime, calling a provider, executing tools, loading packages, or resolving credentials.
- Extensions can contribute input builders, prompt builders, context providers, and skills through existing contribution registries, and middleware can intercept `input_assembly`, `context`, and `prompt_build` stages only when the host/runtime calls those stages.
- Skill disclosure is explicit and progressive: only host-selected skills are included, and referenced `toolNames` are validated against active host tools without adding tools or bypassing filters.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing primitives and lock the minimal Phase 5 public surface
  - Acceptance Criteria:
    - Functional: Existing input/prompt/context/skill contracts, contribution registries, extension API, middleware hooks, resource helpers, tool harness, docs, tests, and roadmap Phase 5 requirements are inventoried; the task records reused primitives and the smallest generic additions needed.
    - Performance: Inventory adds no runtime code, dependency, provider call, tool execution, resource load, filesystem discovery, package execution, network call, timer, watcher, or test slowdown.
    - Code Quality: The chosen surface rejects an agent/session loop, DI container, template engine dependency, prompt DSL, app-specific context logic, mode-specific runtime code, and duplicate tool permission system.
    - Security: Design keeps resources and tools host-owned, secrets out of assembled prompts/events by default, context/skill output explicit, and skill `toolNames` unable to grant permissions.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5 and non-negotiable boundaries: host controlled, replaceable defaults, secrets never enter history/events, docs ship with APIs.
      - `src/contracts.ts` `Message`, `ContentBlock`, `ProviderRequest`, `AgentConfig`, `InputBuilder`, `PromptBuilder`, `ContextProvider`, `ContextBlock`, `Skill`, `SkillRegistry`, `ToolDefinition`, `ToolRegistry`, `ToolResult`, `ResourceLoader`, and `SessionEntry`.
      - `src/contributions.ts` `ContributionRegistries.inputBuilders`, `promptBuilders`, `contextProviders`, and `skills`.
      - `src/extensions.ts` `ExtensionAPI.registerInputBuilder()`, `registerPromptBuilder()`, `registerContextProvider()`, and `registerSkill()`.
      - `src/middleware.ts` `input_assembly`, `prompt_build`, and `context` hooks.
      - `src/resources.ts`, `docs/resource-loading.md`, `src/tools.ts`, and `docs/tools.md` for host-owned resources/tools.
      - `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, `docs/index.md`, and `docs/api-page-template.md`.
      - `package.json` scripts and `tsconfig.json` strict `NodeNext`/declaration settings.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
    - Options Considered:
      - Build the Phase 6 agent/session loop now: rejected; Phase 5 only prepares provider input.
      - Add one orchestration helper plus small default strategies: preferred if inventory confirms it keeps host code simple without hiding runtime behavior.
      - Add a full prompt template language: rejected; CLI/RPC only need safe variable substitution.
      - Let skills activate tools automatically: rejected; active tools come only from the host tool registry/filter path.
      - Add separate modules for every stage: rejected unless implementation size requires it; prefer one or two small modules.
    - Chosen Approach:
      - Reuse current `InputBuilder`, `PromptBuilder`, `ContextProvider`, `Skill`, `ToolDefinition`, `ResourceLoader`, contribution registry, extension API, and middleware primitives.
      - Add minimal runtime helpers, tentatively in `src/input.ts` and `src/skills.ts`: default input builder, context resolver, default prompt builder, provider-input assembly helper, skill registry/selection helper, and template expansion helper.
      - Keep helpers pure/in-memory except explicit calls to caller-provided `ResourceLoader` and `ContextProvider.resolve()`.
      - Do not add package subpaths or dependencies.
    - API Notes and Examples:
      ```ts
      import { assembleProviderInput, createDefaultInputBuilder, createDefaultPromptBuilder } from "prism";

      const request = await assembleProviderInput({
        model: { provider: "mock", model: "demo" },
        input: "Explain this file",
        inputBuilder: createDefaultInputBuilder(),
        promptBuilder: createDefaultPromptBuilder(),
        tools: activeTools.list(),
        metadata: { host: "demo" },
      });
      ```
    - Files to Create/Edit:
      - `plans/008-input-prompt-context-skills-pipeline.md`: record inventory decisions during execution.
      - Tentative later files: `src/input.ts`, `src/skills.ts`, `src/contracts.ts`, `src/index.ts`, `src/__tests__/input-pipeline.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/docs.test.ts`, `docs/input-and-prompt-assembly.md`, `docs/context-and-skills.md`, `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 5 deliverables and acceptance.
      - `plans/005-extension-kernel-and-contribution-registries.md`, `plans/006-configuration-manifests-and-resource-loading.md`, and `plans/007-host-tool-harness.md` closeout decisions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run typecheck`: proves inventory-only edits did not break exported types if the task updates source/docs.
    - `command npm test`: only needed if the inventory task changes docs/source beyond this plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document public APIs and behavior they add.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Inventory: `src/contracts.ts` already has the base Phase 5 contracts: `Message`, `ContentBlock`, `ProviderRequest`, `InputBuilder`, `PromptBuilder`, `ContextProvider`, `ContextBlock`, `Skill`, `SkillRegistry`, `ToolDefinition`, `ToolRegistry`, `ToolResult`, `ResourceLoader`, and `SessionEntry`. Reuse these; do not add parallel message/tool/context contracts.
    - Inventory: `src/contributions.ts` and `src/extensions.ts` already support inert contributions for input builders, prompt builders, context providers, and skills through `ContributionRegistries` and `ExtensionAPI`. Keep contribution storage separate from active host selection.
    - Inventory: `src/middleware.ts` already has `input_assembly`, `context`, and `prompt_build` hooks. Phase 5 helpers should call them only when a caller passes a middleware registry.
    - Inventory: `src/resources.ts` decodes text/JSON/manifest resources through caller-provided loaders only. Phase 5 may load explicit prompt/attachment text resources, but must not add filesystem, network, package discovery, or URI routing.
    - Inventory: `src/tools.ts` already enforces host-owned active tools. Phase 5 must pass host-supplied tools through and never activate tools from skills or middleware.
    - Decision: add one runtime module, `src/input.ts`, for `createDefaultInputBuilder()`, `resolveContextProviders()`, `createDefaultPromptBuilder()`, `assembleProviderInput()`, and `renderPromptTemplate()`. Add `src/skills.ts` for `createSkillRegistry()` and `resolveActiveSkills()`. Root exports only; no package subpath.
    - Decision: add only the public option/result types needed by those helpers, tentatively `AgentInput`, `InputAttachment`, `PromptInstruction`, `DefaultInputBuildContext`, `DefaultInputBuilder`, `ResolveContextOptions`, `AssembleProviderInputOptions`, `PromptTemplateOptions`, and active-skill selection types. If implementation can expose fewer names without losing type safety, expose fewer.
    - Decision: do not change `ProviderRequest`, `PromptBuilder`, or `ContextProvider` contracts for Phase 5. Do not add a `developer` message role now; default developer instructions should be represented as explicit system/developer instruction text in assembled messages until provider adapters need role-specific mapping.
    - Decision: avoid expanding base `InputBuildContext` unless implementation proves it is required. Prefer a `DefaultInputBuildContext` used by the default builder so third-party `InputBuilder` implementations stay simple.
    - Decision: default input assembly converts strings to user text messages, preserves supplied `Message`/`Message[]`, includes host-provided history, summaries, instructions, attachments/resources, and tool results as data only, and never calls providers, executes tools, resolves credentials, or reads paths directly.
    - Decision: `resolveContextProviders()` runs context providers sequentially in caller order, forwards session/run/message/metadata/signal context, and returns blocks without hidden caching or retries. Default prompt composition may order context by `ContextBlock.priority` with stable original order for ties.
    - Decision: middleware payloads stay boring: `input_assembly` transforms assembled messages, `context` transforms resolved context blocks, and `prompt_build` transforms `PromptBuildRequest` before the prompt builder. `assembleProviderInput()` should reapply host-supplied tools after prompt middleware so middleware cannot grant tool permission.
    - Decision: `createDefaultPromptBuilder()` returns provider-ready messages from messages, context blocks, selected skills, summaries, and metadata without model-specific formatting. `assembleProviderInput()` returns a `ProviderRequest` using exactly the host-supplied model/tools/metadata/signal plus composed messages/context.
    - Decision: `createSkillRegistry()` should mirror the tool registry shape with `register()`, `get()`, `resolve()`, and `list()`; extend the public `SkillRegistry` interface with `resolve(name)` during implementation. Same-name registration replaces deterministically.
    - Decision: progressive disclosure is explicit. `resolveActiveSkills()` should select only requested skill names; missing/empty requested names selects no skills by default. Unknown skills or `toolNames` missing from host-active tools fail closed. Skills never register, activate, allow, or execute tools.
    - Decision: prompt templates stay tiny: `renderPromptTemplate(template, variables, options?)` supports top-level `{{name}}` variables only, defaults to throwing on missing variables, stringifies JSON values deterministically, and never evaluates expressions, filters, loops, or partials.
    - Rejected: Phase 6 agent/session runtime, token budgeting/compaction, provider-specific prompt adapters, semantic skill ranking, template engine dependency, schema validator dependency, DI container, package activation graph, hidden globals, filesystem/network loaders, automatic contribution activation, and duplicate tool permission logic.
    - Docs impact: no `/docs` changes in this inventory task. Later tasks must create `docs/input-and-prompt-assembly.md` and `docs/context-and-skills.md`, update `docs/index.md`, and update existing public-contract/extension/contribution/middleware/tool docs as their public APIs land.
    - Verification: ran `npm run typecheck`; it passed. No source files or `/docs` pages changed, so `command npm test` was not required for this inventory-only task.

- [x] Add default input assembly for common host input
  - Acceptance Criteria:
    - Functional: Default assembly converts string, `Message`, and `Message[]` input into messages; includes optional system/developer instructions, attachments/resources, history, summaries, tool results, and host metadata without calling providers or tools.
    - Performance: Assembly is linear in supplied messages/attachments/tool results, loads only explicitly referenced resources through the caller-provided `ResourceLoader`, and adds no dependency, cache, scan, watcher, timer, provider call, or tool execution.
    - Code Quality: Reuse `Message`, `ContentBlock`, `InputBuilder`, `ResourceLoader`, `ToolResult`, and `ContextBlock`; keep attachment/resource handling small and data-shaped; no prompt DSL or app-specific file handling.
    - Security: Resource loading is explicit and host-controlled; binary/image attachments preserve media metadata without secret logging; tool results are included only when supplied by the host/runtime; metadata is passed through without credential resolution.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `Message`, `ContentBlock`, `InputBuilder`, `InputBuildContext`, `ToolResult`, `ToolResultContent`, `ContextBlock`, `ResourceLoader`, and `ResourceLoadContext`.
      - `docs/public-contracts.md` message/content and input contract examples.
      - `docs/resource-loading.md` explicit caller-provided loader behavior.
      - `docs/tools.md` `ToolResult` and no built-in tool execution boundary.
      - `docs/middleware-hooks.md` `input_assembly` hook behavior.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Expand `InputBuildContext` with optional assembly fields while keeping `InputBuilder.build(input, context)`: preferred if inventory confirms compatibility with current contracts.
      - Replace `InputBuilder` with a new incompatible interface: rejected unless current shape cannot express attachments/history/tool results.
      - Read files directly from attachment paths: rejected; hosts must provide resources or already-loaded data.
    - Chosen Approach:
      - Add a default input builder/helper that handles raw input plus optional assembly context fields for instructions, attachments, resource URIs, history messages, summary context, tool results, and metadata.
      - Convert string input to a user text message; preserve supplied `Message` objects; append host-supplied tool results as `tool` messages with `tool_result` content.
      - Convert text resources/attachments through existing `loadTextResource()` only when a `ResourceLoader` and URI are provided.
      - Run `input_assembly` middleware only when a caller passes a `MiddlewareRegistry`.
    - API Notes and Examples:
      ```ts
      const messages = await createDefaultInputBuilder().build("Summarize", {
        history,
        attachments: [{ name: "notes.md", text: "# Notes" }],
        toolResults: [{ toolCallId: "call_1", name: "lookup", value: { ok: true } }],
        metadata: { requestId: "r1" },
      });
      ```
    - Files to Create/Edit:
      - `src/input.ts`: default input builder/helper, attachment/resource types if needed, and input assembly option/result types.
      - `src/contracts.ts`: extend `InputBuildContext` only if needed for optional assembly fields.
      - `src/index.ts`: root exports.
      - `src/__tests__/input-pipeline.test.ts`: input assembly tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new public types/helpers.
      - `docs/input-and-prompt-assembly.md`: document input assembly APIs and defaults.
      - `docs/public-contracts.md`: update input contract inventory/examples if contracts change.
      - `docs/index.md`: add Input and prompt assembly navigation entry.
      - `src/__tests__/docs.test.ts`: include docs/export checks.
    - References:
      - `roadmap.md` Phase 5 default input assembler deliverable.
      - `plans/006-configuration-manifests-and-resource-loading.md` resource helper decisions.
      - `plans/007-host-tool-harness.md` no built-in tools/no execution boundary.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `default_input_builder_turns_string_into_user_text_message`: validates common prompt input.
    - `default_input_builder_preserves_message_and_history_order`: validates host-supplied messages/history are not rewritten unexpectedly.
    - `default_input_builder_adds_text_attachment_and_resource_text`: validates explicit resource loading through a fake `ResourceLoader`.
    - `default_input_builder_adds_tool_result_messages_without_executing_tools`: validates tool result inclusion is data-only.
    - `input_assembly_middleware_runs_only_when_supplied`: validates extension interception is explicit and ordered.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds default input assembly behavior, likely new root exports/types, and maybe optional `InputBuildContext` fields.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: create detailed API page for input assembly defaults.
      - `docs/public-contracts.md`: update if `InputBuildContext` or related contracts change.
      - `docs/index.md`: add `Input and prompt assembly - Default input assembly and prompt composition` navigation entry.
    - `docs/index.md` update: Yes; move Input and prompt assembly from future API areas to an active linked docs group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/input.ts` with `createDefaultInputBuilder()` plus exported `AgentInput`, `DefaultInputBuilder`, `DefaultInputBuildContext`, `InputAttachment`, and `PromptInstruction` types.
    - Default assembly now converts string input to a user text message, preserves supplied `Message` and `Message[]` input, prepends host history, and includes host-supplied system/developer/custom instructions, summaries, text/content attachments, explicit URI text resources through `ResourceLoader`, and tool results as `tool_result` messages.
    - `input_assembly` middleware runs only when `DefaultInputBuildContext.middleware` is supplied, and it transforms the final message array; no global middleware lookup was added.
    - Resource handling remains explicit: URI attachments and `resourceUris` require a caller-provided `ResourceLoader`; no direct path reads, URI routing, discovery, network calls, provider calls, tool execution, or credential resolution were added.
    - Exported the default input builder/types from `src/index.ts`; no package subpath or dependency was added.
    - Added `src/__tests__/input-pipeline.test.ts` for string conversion, message/history order, instructions/summaries/attachments/resource loading, tool result inclusion, and explicit middleware behavior.
    - Updated `src/__tests__/public-contracts.test.ts` with a root-export compile/runtime example for Phase 5 default input assembly.
    - Created `docs/input-and-prompt-assembly.md`, linked it from `docs/index.md`, updated `docs/public-contracts.md`, and extended `src/__tests__/docs.test.ts` docs/export checks.
    - Verification: `npm run typecheck` passed; `npm run build && command npm test` passed with 91 tests across 22 suites and 0 failures.

- [x] Add ordered context resolution and a replaceable prompt composer
  - Acceptance Criteria:
    - Functional: Context providers resolve in caller order with `sessionId`, `runId`, messages, metadata, and abort signal; default prompt composition combines messages, context blocks, active skills, active tools, summaries, and metadata into provider-ready messages/request data.
    - Performance: Context resolution is sequential and deterministic, does no parallel fan-out, caching, provider calls, tool execution, filesystem/network access, or retries; prompt composition is linear in supplied blocks/messages/tools/skills.
    - Code Quality: Reuse `ContextProvider.resolve(ctx)`, `ContextBlock.priority`, `PromptBuilder`, `PromptBuildRequest`, `ProviderRequest`, `ToolDefinition`, and `Skill`; no agent loop, token estimator, compaction strategy, or model-specific prompt adapter.
    - Security: Context provider output is treated as untrusted host/extension data and never gets credential resolution; tool definitions are included as metadata only; middleware cannot add active tools beyond the host-supplied list.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ContextProvider`, `ContextResolutionContext`, `ContextBlock`, `PromptBuilder`, `PromptBuildRequest`, `ProviderRequest`, `ToolDefinition`, and `Skill`.
      - `docs/public-contracts.md` context/prompt contract inventory.
      - `docs/middleware-hooks.md` `context` and `prompt_build` hooks.
      - `docs/contribution-registries.md` context provider and prompt builder contribution storage.
      - `docs/tools.md` active tool registry/filter distinction.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Resolve context providers concurrently: rejected for the default; ordered output and predictable side effects matter more than speed at this layer.
      - Hard-code provider-specific prompt formats: rejected; provider adapters and model constraints remain separate.
      - Add token budgeting now: rejected; compaction/token policy belongs to later runtime/compaction phases.
    - Chosen Approach:
      - Add `resolveContextProviders()` (name tentative) that calls each provider in order, runs optional `context` middleware, and returns context blocks with stable ordering, using `priority` only as a documented default tie-break/ordering rule after inventory.
      - Add `createDefaultPromptBuilder()` and a small `assembleProviderInput()` helper that calls input assembly, context resolution, and prompt composition, then returns a `ProviderRequest`-compatible object.
      - Run `prompt_build` middleware only when a caller passes a `MiddlewareRegistry`.
      - Keep provider tools exactly equal to the host-supplied active tool definitions.
    - API Notes and Examples:
      ```ts
      const context = await resolveContextProviders([projectContext], {
        messages,
        sessionId: "s1",
        runId: "r1",
      });

      const messagesForProvider = await createDefaultPromptBuilder().build({
        messages,
        context,
        skills: activeSkills,
        tools: activeTools.list(),
      });
      ```
    - Files to Create/Edit:
      - `src/input.ts`: context resolver, default prompt builder, provider-input assembly helper, and option/result types.
      - `src/contracts.ts`: extend `PromptBuildRequest` only if needed for instructions/summaries metadata.
      - `src/index.ts`: root exports.
      - `src/__tests__/input-pipeline.test.ts`: context and prompt composition tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new exports.
      - `docs/input-and-prompt-assembly.md`: prompt composition and provider-input assembly docs.
      - `docs/context-and-skills.md`: context provider resolution docs.
      - `docs/middleware-hooks.md`: clarify `context`/`prompt_build` middleware use in the new helpers.
      - `docs/contribution-registries.md`: link context/prompt contributions to runtime helpers.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: docs navigation/check updates.
    - References:
      - `roadmap.md` Phase 5 context pipeline and replaceable prompt composer deliverables.
      - `plans/005-extension-kernel-and-contribution-registries.md` middleware and contribution decisions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `resolve_context_providers_runs_in_order_and_passes_context`: validates ordered provider calls and context fields.
    - `resolve_context_providers_respects_abort_signal`: validates abort is forwarded and no later providers run after abort if implementation checks it.
    - `context_middleware_can_transform_blocks_in_order`: validates explicit extension interception.
    - `default_prompt_builder_includes_context_skills_tools_and_messages`: validates provider-ready prompt shape.
    - `assemble_provider_input_does_not_call_provider_or_execute_tools`: validates Phase 5 boundary.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public context resolution, default prompt composition, provider-input assembly behavior, and root exports.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: document prompt builder and assembly helper.
      - `docs/context-and-skills.md`: document ordered context resolution.
      - `docs/middleware-hooks.md`: update `context` and `prompt_build` hook examples/notes.
      - `docs/contribution-registries.md`: link contributed context/prompt builders to runtime use.
      - `docs/index.md`: add Context and skills runtime navigation entry when the context docs page lands.
    - `docs/index.md` update: Yes; add `Context and skills - Ordered context resolution` entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Extended `src/input.ts` with `resolveContextProviders()`, `createDefaultPromptBuilder()`, and `assembleProviderInput()`, plus exported `ResolveContextOptions`, `DefaultPromptBuilder`, and `AssembleProviderInputOptions`.
    - `resolveContextProviders()` runs host-selected providers sequentially in caller order, forwards `sessionId`, `runId`, `messages`, `metadata`, and `signal`, checks abort before each provider, and runs `context` middleware only when a registry is supplied.
    - `createDefaultPromptBuilder()` composes provider-ready messages from context blocks, selected skills, active tool descriptions, and assembled messages without provider-specific formatting, token budgeting, compaction, caching, or retries.
    - `assembleProviderInput()` wires input assembly, ordered context resolution, optional `prompt_build` middleware, and prompt composition into a `ProviderRequest` without calling providers or executing tools.
    - Tool security decision: `assembleProviderInput()` reapplies the host-supplied `tools` list after `prompt_build` middleware, so middleware cannot grant provider tool access by adding tools to the prompt request.
    - Updated root exports in `src/index.ts`; no package subpath or dependency was added.
    - Added context/prompt tests in `src/__tests__/input-pipeline.test.ts` for ordered provider calls, abort forwarding, context middleware, default prompt composition, and provider-input assembly without provider/tool execution.
    - Updated `src/__tests__/public-contracts.test.ts` with compile/runtime examples for `resolveContextProviders()`, `createDefaultPromptBuilder()`, and `assembleProviderInput()`.
    - Created `docs/context-and-skills.md`, expanded `docs/input-and-prompt-assembly.md`, updated `docs/index.md`, `docs/public-contracts.md`, `docs/middleware-hooks.md`, and `docs/contribution-registries.md`, and extended docs checks in `src/__tests__/docs.test.ts`.
    - Verification: `npm run typecheck` passed; `npm run build && command npm test` passed with 97 tests across 23 suites and 0 failures.

- [ ] Add `SkillRegistry` implementation with progressive disclosure and tool checks
  - Acceptance Criteria:
    - Functional: `createSkillRegistry()` supports explicit host/extension registration, lookup, fail-closed resolve if chosen, and list; active skill selection includes only host-selected skills and validates each skill's `toolNames` against host-active tools.
    - Performance: Registry lookup is `Map`-backed/O(1), skill selection is O(skill count + tool count), and no skill operation executes tools, loads resources, imports packages, calls providers, or resolves credentials.
    - Code Quality: Reuse existing `Skill`, `SkillRegistry`, `ToolDefinition`, `ContributionRegistries.skills`, and `ExtensionAPI.registerSkill()`; do not add a skill runtime, semantic matcher, permission policy class, or dependency.
    - Security: Skills cannot register missing tools, activate tools, or grant permissions; missing/denied tool names fail closed or are reported without adding them to provider tools; skill instructions are disclosed only when selected by the host/runtime.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `Skill`, `SkillRegistry`, `ToolDefinition`, and `AgentConfig.skills`.
      - `src/contributions.ts` `ContributionRegistries.skills` and `src/extensions.ts` `ExtensionAPI.registerSkill()`.
      - `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/extensions.md`, and `docs/tools.md` skill/tool contribution notes.
      - `roadmap.md` Phase 5 acceptance: skills cannot register missing tools or grant permissions by themselves.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Make `ContributionRegistries.skills` the active registry: rejected; contribution storage is inert and hosts need active selection.
      - Auto-enable tools named by a skill: rejected; violates host-owned tool permissions.
      - Add semantic skill discovery/ranking: rejected; progressive disclosure only needs explicit selection in Phase 5.
    - Chosen Approach:
      - Implement a small `createSkillRegistry()` parallel to `createToolRegistry()` but for `Skill` objects.
      - Add a helper, tentatively `selectSkills()` or `resolveActiveSkills()`, that takes requested skill names plus active tools and returns selected skills or a typed missing-tool error/result.
      - Update default prompt composition to include selected skill instructions/context only; provider `tools` remains the host-supplied active tool list.
      - Keep extension-contributed skills inert until copied/selected by the host.
    - API Notes and Examples:
      ```ts
      const skills = createSkillRegistry([{
        name: "brief",
        instructions: "Answer in one paragraph.",
        toolNames: ["echo"],
      }]);

      const active = resolveActiveSkills({
        registry: skills,
        names: ["brief"],
        tools: activeTools.list(),
      });
      ```
    - Files to Create/Edit:
      - `src/skills.ts`: skill registry and active skill selection/tool validation helpers.
      - `src/contracts.ts`: add `resolve(name)` to `SkillRegistry` only if chosen for fail-closed symmetry.
      - `src/input.ts`: integrate active skills into prompt assembly if needed.
      - `src/index.ts`: root exports.
      - `src/__tests__/input-pipeline.test.ts` or `src/__tests__/skills.test.ts`: skill registry/selection tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage.
      - `docs/context-and-skills.md`: skill registry and progressive disclosure docs.
      - `docs/tools.md`: link skill `toolNames` to active host tools if needed.
      - `docs/extensions.md` and `docs/contribution-registries.md`: clarify skill contributions are inert.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: docs checks.
    - References:
      - `roadmap.md` Phase 5 skill registry deliverable and acceptance.
      - `plans/007-host-tool-harness.md` host-owned tool permissions decisions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `skill_registry_register_get_resolve_list_and_replace`: validates active registry behavior.
    - `active_skill_selection_includes_only_requested_skills`: validates progressive disclosure.
    - `skill_referencing_missing_tool_fails_closed`: validates no missing tool is added or silently granted.
    - `extension_registered_skill_is_inert_until_host_selects_it`: validates contribution/activation separation.
    - `prompt_builder_includes_selected_skill_instructions_only`: validates unselected skills stay out of prompts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public skill registry/selection behavior and clarifies skill/tool permissions.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: create/update detailed API page for skill registry, selection, and progressive disclosure.
      - `docs/public-contracts.md`: update if `SkillRegistry` contract changes.
      - `docs/extensions.md`: clarify `registerSkill()` contribution behavior.
      - `docs/contribution-registries.md`: clarify contributed skills are inert.
      - `docs/tools.md`: note skills reference but do not activate tools.
      - `docs/index.md`: add/update Context and skills navigation entry.
    - `docs/index.md` update: Yes; add `Context and skills - Skill registry and progressive disclosure` entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Add safe prompt template expansion for CLI/RPC callers
  - Acceptance Criteria:
    - Functional: A tiny public helper expands `{{name}}`-style variables from caller-supplied JSON-compatible values and can feed the default input assembly path for CLI/RPC prompt strings.
    - Performance: Expansion is a single pass over the template plus matched variables, dependency-free, and performs no filesystem, network, resource loading, package import, provider call, tool execution, or eval.
    - Code Quality: Use a small documented syntax only; no loops, conditionals, partials, filters, arbitrary JS, global variables, or template engine dependency.
    - Security: Missing variables fail closed or remain unchanged by a documented option; values are stringified without code execution; secrets are not logged or stored by the helper.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5 prompt template expansion for CLI/RPC use.
      - `src/contracts.ts` `JsonObject`/`JsonValue` and `InputBuilder` contracts.
      - `docs/configuration-and-manifests.md` JSON-compatible config/defaults guidance.
      - `docs/resource-loading.md` prompt resource notes.
      - `docs/credentials-and-redaction.md` secret handling.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add Handlebars/Mustache/etc.: rejected; too much surface and a dependency for simple CLI/RPC substitution.
      - Support only exact `{{name}}` replacements: chosen unless inventory shows dotted JSON paths are needed now.
      - Use JavaScript template literals/eval: rejected.
    - Chosen Approach:
      - Add a helper, tentatively `renderPromptTemplate(template, variables, options?)`, in the input module.
      - Accept `JsonObject` variables; stringify primitives directly and objects/arrays with `JSON.stringify()`.
      - Make missing-variable behavior explicit and tested.
      - Document using this helper before `createDefaultInputBuilder()` for CLI/RPC prompts; do not add CLI/RPC command code in Phase 5.
    - API Notes and Examples:
      ```ts
      const prompt = renderPromptTemplate("Review {{file}} for {{focus}}", {
        file: "src/index.ts",
        focus: "public exports",
      });
      ```
    - Files to Create/Edit:
      - `src/input.ts`: template expansion helper and option types.
      - `src/index.ts`: root exports.
      - `src/__tests__/input-pipeline.test.ts`: template tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage.
      - `docs/input-and-prompt-assembly.md`: template syntax, examples, and security notes.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: docs/export checks.
    - References:
      - `roadmap.md` Phase 5 template deliverable.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `render_prompt_template_replaces_variables`: validates basic CLI/RPC substitution.
    - `render_prompt_template_stringifies_json_values`: validates objects/arrays/primitives are deterministic.
    - `render_prompt_template_missing_variable_fails_closed`: validates documented missing-variable behavior.
    - `render_prompt_template_does_not_eval_expressions`: validates `{{constructor}}`/expression-like input is data-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public prompt template expansion helper and syntax.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: document template helper, supported syntax, examples, and non-goals.
      - `docs/index.md`: ensure Input and prompt assembly entry mentions prompt templates.
    - `docs/index.md` update: Yes; update Input and prompt assembly description to include template expansion.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Wire extension/contribution integration and compile-time host examples
  - Acceptance Criteria:
    - Functional: Input builders, prompt builders, context providers, and skills registered through `ContributionRegistries` or `ExtensionAPI` can be selected by the host and used by the Phase 5 helpers without becoming active automatically.
    - Performance: Integration is in-memory and performs no dynamic import, manifest execution, filesystem/network access, provider call, credential resolution, or tool execution during registration/selection.
    - Code Quality: Avoid parallel contribution systems; keep extension API registration methods unchanged unless a tiny public helper removes repeated host boilerplate.
    - Security: Extension-contributed context/skills/builders are inert until selected; middleware can transform assembly payloads only at explicit helper calls; skills still cannot activate missing or denied tools.
  - Approach:
    - Documentation Reviewed:
      - `src/contributions.ts` and `docs/contribution-registries.md` contribution registry behavior.
      - `src/extensions.ts` and `docs/extensions.md` `ExtensionAPI` registration behavior.
      - `src/middleware.ts` and `docs/middleware-hooks.md` ordered middleware behavior.
      - `src/__tests__/public-contracts.test.ts` compile coverage patterns.
      - `roadmap.md` Phase 5 extension interception acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Auto-load all contributed input/context/skill/prompt definitions into the default pipeline: rejected; hosts must select active behavior.
      - Add adapters for every contribution category: rejected unless code repetition appears in tests.
      - Add only examples/tests for direct selection: preferred; existing `resolve()`/constructors are likely enough.
    - Chosen Approach:
      - Add tests showing contributed builders/providers/skills are inert until the host resolves/registers/selects them.
      - Add compile examples using root exports for common Phase 5 host wiring.
      - Update docs to distinguish contribution, active selection, middleware interception, and prompt assembly.
    - API Notes and Examples:
      ```ts
      const kernel = createExtensionKernel();
      await kernel.load([extension]);

      const contextProviders = [kernel.registries.contextProviders.resolve("project")];
      const promptBuilder = kernel.registries.promptBuilders.resolve("default");
      ```
    - Files to Create/Edit:
      - `src/__tests__/input-pipeline.test.ts`: contribution/extension integration tests.
      - `src/__tests__/public-contracts.test.ts`: compile host examples for Phase 5 APIs.
      - `docs/input-and-prompt-assembly.md`: contribution and middleware examples.
      - `docs/context-and-skills.md`: extension contribution examples.
      - `docs/extensions.md`: update registration notes for input/prompt/context/skill helpers.
      - `docs/contribution-registries.md`: add related links/clarifications.
      - `docs/middleware-hooks.md`: add/adjust input/context/prompt hook notes.
      - `docs/index.md` and `src/__tests__/docs.test.ts`: docs checks.
    - References:
      - `roadmap.md` Phase 5 acceptance: extensions can replace/intercept assembly/composition stages.
      - `plans/005-extension-kernel-and-contribution-registries.md` extension/contribution decisions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `extension_registered_input_builder_is_inert_until_host_uses_it`: validates no auto activation.
    - `extension_registered_context_provider_is_selected_explicitly`: validates host-owned selection.
    - `extension_registered_prompt_builder_can_replace_default`: validates replacement strategy.
    - `input_context_prompt_middleware_runs_in_documented_order`: validates interception order.
    - `phase_5_public_exports_compile_from_root`: validates root export examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; clarifies public extension/contribution behavior for Phase 5 helpers and examples.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: contribution/middleware usage examples.
      - `docs/context-and-skills.md`: extension-contributed context/skill examples.
      - `docs/extensions.md`: clarify registration methods remain contribution-only.
      - `docs/contribution-registries.md`: link to active Phase 5 helper docs.
      - `docs/middleware-hooks.md`: clarify helper call sites for `input_assembly`, `context`, and `prompt_build`.
      - `docs/index.md`: ensure active Phase 5 docs are linked.
    - `docs/index.md` update: No new group beyond prior Phase 5 entries unless docs structure changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Final verification and wiki consistency check
  - Acceptance Criteria:
    - Functional: Phase 5 acceptance is covered by tests/docs: common host input assembles, extensions can replace/intercept stages, context resolves in order, skills are progressively disclosed, and skills cannot grant missing tool permissions.
    - Performance: Test suite remains fast/offline; no new dependencies, background workers, timers, watchers, network calls, filesystem scans, package discovery, provider calls, tool execution, or hidden globals were added.
    - Code Quality: Public exports, docs links, examples, and tests are consistent; implementation remains small and reusable by the future Phase 6 runtime.
    - Security: Docs/tests state resources/tools are host-owned, templates do not eval, contributed definitions are inert until selected, and secrets/credentials are not resolved into prompts/events by these helpers.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md`, `docs/input-and-prompt-assembly.md`, `docs/context-and-skills.md`, `docs/public-contracts.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/middleware-hooks.md`, `docs/resource-loading.md`, `docs/tools.md`, and `docs/credentials-and-redaction.md`.
      - `src/__tests__/docs.test.ts` docs/export checks.
      - `package.json` scripts.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add a broad end-to-end agent runtime test: rejected; Phase 6 owns runtime loops.
      - Add token-budget/golden prompt fixtures now: rejected unless direct Phase 5 behavior needs one small fixture.
      - Add docs tooling dependency: rejected; existing `node:test` docs checks are enough.
    - Chosen Approach:
      - Run `npm run build`, `npm run typecheck`, and `command npm test`.
      - Fix only direct Phase 5 inconsistencies.
      - Update this plan with execution notes, compromises, and further actions after checks pass.
    - API Notes and Examples:
      ```sh
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/008-input-prompt-context-skills-pipeline.md`: mark completed tasks and fill closeout sections after successful verification.
      - Directly affected docs/tests only if verification finds an inconsistency.
    - References:
      - `roadmap.md` Phase 5 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: validates emitted JS/types and package exports.
    - `npm run typecheck`: validates strict TypeScript types.
    - `command npm test`: validates runtime tests and docs checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new API by verification alone; it validates docs for APIs added by earlier tasks.
    - Docs pages to create/edit:
      - `none`: only update docs if verification finds missing/incorrect Phase 5 documentation.
    - `docs/index.md` update: No unless verification finds navigation missing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
