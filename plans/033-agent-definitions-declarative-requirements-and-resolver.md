# Phase 33 — Agent definitions: declarative requirements and resolver

## Objectives

- Let third-party packages and file bundles ship an agent as a unit with declaratively referenced tools, skills, context providers, model, system prompt, and loop.
- Reuse existing Prism seams (`AgentDefinition`, contribution registries, `ProviderResolver`, `resolveActiveSkills`, context providers, system-prompt composition, loop resolution) instead of adding parallel lookup machinery.
- Provide a single `resolveAgentDefinition(def, context)` helper that resolves name-referenced dependencies from in-scope registries and returns an `Agent` ready for `createSession()`.
- Support two equal delivery vehicles: code-package agents registered via `ExtensionAPI.registerAgent()` and filesystem agents declared by `<dir>/AGENTS.md` discovered under `.agents/agents/<name>/`.
- Preserve host control: `overrides` win, missing dependencies fail closed, and no agent declaration can grant permissions or bypass `toolNames` enforcement.

## Expected Outcome

- `AgentDefinition` carries optional declarative requirement fields (`model`, `tools`, `skills`, `context`, `systemPrompt`, `instructions`, `loop`) while `create(config?)` becomes an optional escape hatch.
- `AgentDefinitionResolutionContext` and `resolveAgentDefinition()` are exported from `src/index.ts`.
- A code-package agent registered with `tools: ["read-file", "synapta/validate"]` and `skills: ["schema-skill"]` resolves against the same registries used by first-party packages and produces the same runtime behavior as an equivalent `AGENTS.md` bundle.
- Declaring a missing tool, skill, context provider, or model fails closed at resolution time, before any provider turn.
- `AGENTS.md` frontmatter maps 1:1 to declarative `AgentDefinition` fields; colocated `skills/<name>/SKILL.md` and `tools/<name>/TOOL.md` register into an agent-scoped registry and resolve through `resolveAgentDefinition`.
- Host `overrides` can drop a tool, swap the model, disable a skill, or replace the loop.
- `/docs/agent-definitions.md` documents both delivery vehicles, resolution scope/merge rules, and a mixed first-party + third-party example.

## Tasks

- [x] Task 1 — Primitive review: confirm existing seams cover Phase 33
  - Acceptance Criteria:
    - Functional: A `Primitive Review` subsection is appended under this task documenting, for each Phase 33 concern (agent factory contract, contribution registries, provider/model resolution, tool lookup, skill activation with `toolNames`, context provider lookup, system-prompt layering, loop selection, `AGENTS.md` discovery envelope), which existing primitive covers it and why no new core architecture is needed.
    - Performance: Review performs no I/O; read + write of analysis text only.
    - Code Quality: Every proposed new file is justified against an existing seam; no new registry concept, no new runtime module beyond a single resolver helper.
    - Security: Review explicitly states that declarative resolution must not bypass host permissions, tool validation, or secret redaction, and that `AGENTS.md` execution remains host-controlled.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AgentDefinition`, `AgentConfig`, `Agent`, `ModelConfig`, `AIProvider`, `ProviderResolver`, `ToolDefinition`, `ToolRegistry`, `Skill`, `SkillRegistry`, `ContextProvider`, `SystemPromptConfig`, `AgentLoopStrategy`, `AgentLoopOptions` — existing contracts.
      - `src/contributions.ts` `ContributionRegistries`, `createContributionRegistries()`, `registerDiscoveredContributions()` — existing registry bundle and discovery wiring.
      - `src/providers.ts` `createProviderResolver()` and `src/agents.ts` `resolveRunProvider()` — existing provider resolution seam (Phase 24).
      - `src/skills.ts` `createSkillRegistry()`, `resolveActiveSkills()` — existing skill activation and `toolNames` enforcement (Phase 26).
      - `src/tools.ts` `createToolRegistry()`, `dispatchToolCall()` — existing tool lookup and validation seam (Phase 25).
      - `src/input.ts` `resolveContextProviders()` — existing context-provider pipeline.
      - `src/system-prompts.ts` `composeSystemPrompt()`, `mergeSystemPromptConfig()` — existing system-prompt layering (Phase 31).
      - `src/agent-loops.ts` `resolveLoop()` — existing loop selection (Phase 27).
      - `src/node/contribution-discovery.ts` `discoverContributions()`, `parseAgentsFile()`, plus `src/contributions.ts` `stubAgent()` — existing AGENTS.md discovery envelope (Phase 29).
      - Roadmap Phase 33 and non-negotiable boundaries: no built-in app tools, no hidden globals, host-controlled scope.
    - Options Considered:
      - Add a new `AgentRegistry` with its own lookup rules: rejected — `ContributionRegistries.agents` already exists; reuse it.
      - Add declarative resolution directly into `RuntimeAgentSession.run`: rejected — resolution belongs at agent-creation time, not per turn, and must work for both package and file agents.
      - Build a separate resolver per delivery vehicle: rejected — `resolveAgentDefinition` is a single helper used by both `ExtensionAPI.registerAgent()` code agents and `AGENTS.md` file agents.
    - Chosen Approach:
      - Document reuse of Phases 24–31 primitives.
      - Add only `AgentDefinition` declarative fields, `AgentDefinitionResolutionContext`, and `resolveAgentDefinition()`.
    - API Notes and Examples:
      ```ts
      // Existing seams composed by the resolver
      const agent = resolveAgentDefinition(def, {
        registries: kernel.registries,
        providerSource: createProviderResolver([...]),
        tools: hostToolRegistry,
        skillsRegistry: hostSkillRegistry,
        overrides: { model: { provider: "mock", model: "override" } },
      });
      ```
    - Files to Create/Edit:
      - `plans/033-agent-definitions-declarative-requirements-and-resolver.md` (this file): append `Primitive Review` subsection once complete.
    - References:
      - `src/contracts.ts`, `src/contributions.ts`, `src/providers.ts`, `src/agents.ts`, `src/skills.ts`, `src/tools.ts`, `src/input.ts`, `src/system-prompts.ts`, `src/agent-loops.ts`, `src/node/contribution-discovery.ts`.
      - Plans 024–032.
  - Test Cases to Write:
    - (No code; Task 2–6 cover verification.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — Task 1 is analysis only.
    - Docs pages to create/edit: none for this task.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Primitive Review** (Task 1 output — no code; read + write of analysis only):
    - **Agent factory contract:** Covered. `AgentDefinition` (`src/contracts.ts:172`) already carries `name`, `description`, `metadata`, and a `create(config?)` factory that returns `Agent`. `createAgent(config)` (`src/agents.ts:44`) turns any `AgentConfig` into an `Agent` with `createSession()`. Phase 33 only needs to make `create` optional and add declarative fields; the factory and session contracts do not change. → **No new core architecture.**
    - **Contribution registries:** Covered. `ContributionRegistries` (`src/contributions.ts:58`) already includes `agents`, `tools`, `contextProviders`, `skills`, and `models`. `createContributionRegistries()` returns a fresh, host-controlled bundle, and `registerDiscoveredContributions()` (`src/contributions.ts:81`) wires discovered file contributions into those registries. Phase 33 resolves agent declarations against these existing registries. → **No new registry concept.**
    - **Provider/model resolution:** Covered. `ProviderResolver = (model: ModelConfig) => AIProvider | undefined` (`src/contracts.ts:151`) plus `createProviderResolver(source: ProviderRegistry | readonly AIProvider[])` (`src/providers.ts:47`) lets a host hand Prism a resolver. `RuntimeAgentSession.run` resolves per run via `options.providerSource ?? config.providerSource ?? config.provider` (`src/agents.ts:resolveRunProvider`). Model ids resolve through `registries.models` (`createModelRegistry` in `src/models.ts`). Phase 33 declarative `model: string` will use `registries.models.resolve(id)` and then `providerSource(model)`. → **No new provider/model lookup machinery.**
    - **Tool lookup and host filtering:** Covered. `createToolRegistry(tools)` and `activeTools(config.tools)` (`src/tools.ts` and `src/agents.ts:434`) provide host-owned tool lookup. `dispatchToolCall({call, registry, validate, ...})` executes after validation/permissions. Declarative `tools: readonly string[]` will resolve each name against the active tool registry and fail closed on missing names. → **No new tool registry or dispatch code.**
    - **Skill activation with `toolNames` enforcement:** Covered. `createSkillRegistry(skills)` and `resolveActiveSkills({registry, names, tools})` (`src/skills.ts`) select skills by name and throw if a demanded tool is missing from the active tool set. `RuntimeAgentSession.run` already merges `activeSkills.flatMap(s => s.context ?? [])` after host `AgentConfig.context` (`src/agents.ts` around line 261). Phase 33 declarative `skills: readonly string[]` routes through `resolveActiveSkills`. → **No new skill machinery.**
    - **Context provider lookup:** Covered. `resolveContextProviders({providers, messages, ...})` (`src/input.ts:111`) resolves a list of `ContextProvider` into `ContextBlock[]`. The default prompt builder already includes context blocks before skill instructions and tool definitions. Phase 33 declarative `context: readonly string[]` will resolve names to providers from `registries.contextProviders` and pass them to the existing assembler. → **No new context pipeline.**
    - **System-prompt layering:** Covered. `composeSystemPrompt(contributions, {base})` and `mergeSystemPromptConfig(config, override)` (`src/system-prompts.ts`) layer `SystemPromptContribution` with `AgentConfig.instructions` and `RunOptions.systemPrompt`. Phase 33 declarative `systemPrompt` and `instructions` map directly to these existing helpers. → **No new prompt layering code.**
    - **Loop selection:** Covered. `resolveLoop(options, config)` (`src/agent-loops.ts`) selects `singleShotLoop` or `generateValidateReviseLoop(...)` from `AgentConfig.loop` / `RunOptions.loop`. Phase 33 declarative `loop` will be passed through `resolveLoop` exactly like `AgentConfig.loop`. → **No new loop orchestration.**
    - **`AGENTS.md` discovery envelope:** Covered. `discoverContributions({kinds:["agent"], ...})` (`src/node/contribution-discovery.ts`) scans `.agents/agents/<name>/AGENTS.md` and returns `DiscoveredContribution` envelopes. `parseAgentsFile(text, path)` (`src/contribution-parsing.ts`) extracts frontmatter name and metadata. `registerDiscoveredContributions()` registers a `stubAgent()` (`src/contributions.ts:180`) that currently fails closed with `PHASE_33_AGENT_ERROR`. Phase 33 replaces the stub's `create` with one that reads the file and delegates to `resolveAgentDefinition`. → **Only new code is the file-to-resolver bridge; discovery and parsing already exist.**
    - **Security/trust boundaries:** Preserved. Declarative agents are inert until a host calls `resolveAgentDefinition`. The host controls scope by which registries it passes. `overrides` are final. Tool permissions, validation, and secret redaction happen in existing runtime paths (`dispatchToolCall`, `redactAgentEvent`, `redactProviderRequest`); declarative resolution does not bypass them. `AGENTS.md` remains a text file loaded by the host/CLI filesystem loader; no automatic module execution occurs during discovery.
    - **Conclusion:** Every Phase 33 concern can be satisfied by reusing existing seams. The only additions are: (1) optional declarative fields on `AgentDefinition`, (2) `AgentDefinitionResolutionContext`, and (3) a single `resolveAgentDefinition()` helper that composes the existing primitives. The `AGENTS.md` delivery vehicle adds a small Node-side bridge that reuses `parseAgentsFile`, `discoverContributions`, and `registerDiscoveredContributions`.
  - **Outcome / deviation:** Primitive Review completed. Verified by reading the listed source files that the required primitives exist and behave as documented. One plan correction applied: changed `src/context.ts` to `src/input.ts` in the documentation-reviewed list because `resolveContextProviders` lives in `src/input.ts`, not a separate `src/context.ts`.

- [x] Task 2 — Extend `AgentDefinition` contract and add `AgentDefinitionResolutionContext`
  - Acceptance Criteria:
    - Functional: `AgentDefinition` exposes optional declarative fields `model?: ModelConfig | string`, `tools?: readonly string[]`, `skills?: readonly string[]`, `context?: readonly string[]`, `systemPrompt?: SystemPromptConfig`, `instructions?: string`, `loop?: AgentLoopStrategy | AgentLoopOptions`, and `create(config?)` is optional. `AgentDefinitionResolutionContext` is exported with the documented shape.
    - Performance: Pure type changes; no runtime overhead.
    - Code Quality: Types are additive; existing agents with a required `create` still compile. JSDoc links to `resolveAgentDefinition`.
    - Security: No behavioral change; declarations are inert until resolved by a host.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` existing `AgentDefinition`, `AgentConfig`, `ModelConfig`, `SystemPromptConfig`, `AgentLoopStrategy`, `AgentLoopOptions`.
      - `src/contributions.ts` `ContributionRegistries`.
      - `src/providers.ts` `ProviderResolver`.
    - Options Considered:
      - Create a separate `DeclarativeAgentDefinition` type: rejected — a single `AgentDefinition` with optional fields is simpler and matches how `AgentConfig` already mixes optional strategies.
      - Put resolution context inside `AgentConfig`: rejected — resolution context is a resolver input, not a per-agent config value.
    - Chosen Approach:
      - Extend `AgentDefinition` in `src/contracts.ts`.
      - Add `AgentDefinitionResolutionContext` in `src/contracts.ts`.
      - Re-export new types from `src/index.ts`.
    - API Notes and Examples:
      ```ts
      export interface AgentDefinition {
        readonly name: string;
        readonly description?: string;
        /** Direct model config, or a model id resolved from `registries.models`. */
        readonly model?: ModelConfig | string;
        /** Tool names to activate from the active tool registry / `registries.tools`. */
        readonly tools?: readonly string[];
        /** Skill names resolved through `resolveActiveSkills()`; `toolNames` enforcement applies. */
        readonly skills?: readonly string[];
        /** Context provider names from `registries.contextProviders`. */
        readonly context?: readonly string[];
        readonly systemPrompt?: SystemPromptConfig;
        readonly instructions?: string;
        readonly loop?: AgentLoopStrategy | AgentLoopOptions;
        readonly metadata?: Readonly<Record<string, unknown>>;
        /** Optional escape hatch. When present, overrides declarative resolution. */
        create?(config?: AgentConfig): Promise<Agent> | Agent;
      }

      /** Input to {@link resolveAgentDefinition}. All fields are optional; the host
       *  controls scope by which registries it passes. */
      export interface AgentDefinitionResolutionContext {
        readonly registries?: ContributionRegistries;
        readonly providerSource?: ProviderResolver;
        readonly tools?: ToolRegistry | readonly ToolDefinition[];
        readonly skillsRegistry?: SkillRegistry;
        readonly overrides?: Partial<AgentConfig>;
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: extend `AgentDefinition`; add `AgentDefinitionResolutionContext`.
      - `src/index.ts`: no edit needed — `export type * from "./contracts.js"` already re-exports both new types.
    - References:
      - `src/contracts.ts` lines 172–178.
      - Roadmap Phase 33 "Extend `AgentDefinition`".
  - Test Cases to Write:
    - `src/__tests__/public-contracts.test.ts`: assert `AgentDefinitionResolutionContext` is exported and `AgentDefinition.create` is optional.
    - `src/__tests__/agent-definitions.test.ts` (Task 5): type-level compile test that a declarative-only definition satisfies `AgentDefinition`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — adds public types and changes `AgentDefinition.create` from required to optional.
    - Docs pages to create/edit: `/docs/agent-definitions.md` (Task 6); `/docs/contribution-registries.md` agent section (Task 6).
    - `docs/index.md` update: yes — add "Agent definitions" entry under Agent/session runtime (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Outcome / deviation:** Task completed. Added declarative fields and `AgentDefinitionResolutionContext` to `src/contracts.ts`. Existing call sites that invoked `.create()` on an `AgentDefinition` variable were updated to `.create!()` in `src/__tests__/public-contracts.test.ts`, `src/__tests__/agents.test.ts`, and `src/__tests__/contributions-discovered.test.ts`. Added a public-contracts test verifying a declarative-only `AgentDefinition` compiles and `AgentDefinitionResolutionContext` is exported. Verified with `npm run typecheck` and full `npm test` (631 core tests pass, 0 fail; workspace tests pass). No edit to `src/index.ts` was required because `export type * from "./contracts.js"` already re-exports the new types.

- [x] Task 3 — Implement `resolveAgentDefinition()`
  - Acceptance Criteria:
    - Functional: `resolveAgentDefinition(def, context)` returns an `Agent`. If `def.create` exists, it is called and `context.overrides` merged. Otherwise it resolves `model` (direct or by id from `registries.models`), provider via `providerSource(model)` or `registries.providers`, tools by name against `tools`/`registries.tools`, skills via `resolveActiveSkills({registry, names, tools})`, context providers by name from `registries.contextProviders`, system prompt via existing compose/merge helpers, loop via `resolveLoop`, builds `AgentConfig`, merges `overrides`, and calls `createAgent(config)`. Missing name → throws before provider turn.
    - Performance: O(n) over declared names; one registry lookup each.
    - Code Quality: No duplicate resolution logic; delegates to existing `createAgent`, `resolveActiveSkills`, `resolveContextProviders`, `composeSystemPrompt`, `resolveLoop`. Single helper file with clear error messages.
    - Security: Cannot bypass host `tools` filter or permissions; host `overrides` are final; skill `toolNames` enforcement still runs at activation.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` `createAgent()`, `RuntimeAgentSession`, `resolveRunProvider()`.
      - `src/skills.ts` `resolveActiveSkills()` signature and error behavior.
      - `src/input.ts` `resolveContextProviders()`.
      - `src/system-prompts.ts` `composeSystemPrompt()`, `mergeSystemPromptConfig()`.
      - `src/agent-loops.ts` `resolveLoop()`.
    - Options Considered:
      - Inline resolver into `createAgent`: rejected — `createAgent` takes a concrete `AgentConfig`; resolution is a separate concern used by extensions and file discovery.
      - Support async `create()` only: rejected — match existing `AgentDefinition.create` return type (`Promise<Agent> | Agent`) and allow sync definitions.
    - Chosen Approach:
      - Create `src/agent-definitions.ts` exporting `resolveAgentDefinition()`.
      - Keep algorithm explicit and short; throw `Unknown tool: ${name}`, `Unknown skill: ${name}`, etc.
      - Merge order: declarative base → `overrides`.
    - API Notes and Examples:
      ```ts
      export function resolveAgentDefinition(
        def: AgentDefinition,
        context: AgentDefinitionResolutionContext,
      ): Promise<Agent> | Agent {
        if (def.create) {
          const agent = def.create(buildBaseConfig(def, context));
          return mergeOverrides(agent, context.overrides);
        }
        const config = buildConfigFromDeclaration(def, context);
        return createAgent(config);
      }
      ```
    - Files to Create/Edit:
      - `src/agent-definitions.ts`: new resolver implementation.
      - `src/index.ts`: export `resolveAgentDefinition`.
    - References:
      - Roadmap Phase 33 `resolveAgentDefinition` algorithm.
      - `src/agents.ts`, `src/skills.ts`, `src/input.ts`, `src/system-prompts.ts`, `src/agent-loops.ts`.
  - Test Cases to Write:
    - Declarative resolution with model string id, tool names, skill names, context names.
    - `create()` escape hatch returns custom agent; overrides merged.
    - Missing tool/skill/context/model throws before `createAgent`.
    - `overrides` swaps model and drops tool.
    - `toolNames` enforcement: skill demands missing tool → `resolveActiveSkills` throws during resolution.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — adds `resolveAgentDefinition` public export.
    - Docs pages to create/edit: `/docs/agent-definitions.md` (Task 6).
    - `docs/index.md` update: yes (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Outcome / deviation:** Task completed. Implemented `resolveAgentDefinition` in `src/agent-definitions.ts` and exported it from `src/index.ts`. Core resolver tests written in `src/__tests__/agent-definitions.test.ts` (14 tests) covering declarative resolution, escape hatch, async escape hatch, overrides, missing model/tool/skill/context, skill `toolNames` enforcement, and host tool-scope filtering. Also added `resolveAgentDefinition` export assertion to `src/__tests__/public-contracts.test.ts`. Verified with `npm run typecheck` and full `npm test` (645 core tests pass, 0 fail; workspace tests pass).
    - **Behavioral note:** A string `model` is treated as a `provider/model` id. If `context.registries.models` is supplied, the id is resolved through the registry and missing ids throw `Unknown model: provider/model`. If no model registry is supplied, the string is parsed directly into `{provider, model}`. This keeps the host in control of whether model ids are validated.

- [x] Task 4 — Integrate `AGENTS.md` file resolution
  - Acceptance Criteria:
    - Functional: `AGENTS.md` frontmatter maps to declarative `AgentDefinition` fields. Colocated `skills/<name>/SKILL.md` and `tools/<name>/TOOL.md` (or equivalent discovered structure) register into an agent-scoped registry; the default file resolver reads `AGENTS.md`, merges colocated deps with in-scope registries, and calls `resolveAgentDefinition`. The existing `stubAgent()` placeholder is replaced or wrapped.
    - Performance: One file read per agent at resolution time; no repeated reads per run.
    - Code Quality: Node/filesystem code stays in `src/node/`; core remains fs-free. Reuse `parseAgentsFile`, `parseSkillFile`, and `registerDiscoveredContributions` where possible.
    - Security: `AGENTS.md` is inert text until host/CLI loader resolves it; no automatic execution of colocated tool modules.
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts` `discoverContributions()`, `parseAgentsFile()`, `parseSkillFile()`.
      - `src/contributions.ts` `stubAgent()`, `registerDiscoveredContributions()`, `discoverMetadata()`.
      - `src/node/system-project-prompts.ts` Node-side file-loading precedent.
    - Options Considered:
      - Make `AGENTS.md` produce a full `AgentConfig` directly: rejected — reuse `resolveAgentDefinition` so code and file agents share one path.
      - Load colocated tool modules automatically: rejected — core is fs-free and tool execution is host-owned; register descriptor-only or host-loaded tools.
    - Chosen Approach:
      - Add `src/node/agent-definitions.ts` with `resolveDiscoveredAgentDefinition(contribution, context)` that reads `AGENTS.md`, registers colocated skills/tools/context into transient registries, and delegates to `resolveAgentDefinition`.
      - Update `src/contributions.ts` `stubAgent()` to a default `create` that throws a pointer to the Node helper, or replace it with a `create` that invokes the resolver when Node loader is available.
    - API Notes and Examples:
      ```ts
      // Node subpath
      export function resolveDiscoveredAgent(
        contribution: DiscoveredContribution,
        context: AgentDefinitionResolutionContext & { readFile: (path: string) => Promise<string> },
      ): Promise<Agent>;
      ```
    - Files to Create/Edit:
      - `src/node/agent-definitions.ts`: new Node-specific AGENTS.md resolver.
      - `src/contributions.ts`: update `stubAgent()` default `create` behavior.
      - `src/index.ts` (if needed): re-export type only if it has runtime value; keep Node helper on `@arnilo/prism/node` subpath.
    - References:
      - `src/node/contribution-discovery.ts`.
      - Roadmap Phase 33 "Filesystem bundle (`AGENTS.md`)".
  - Test Cases to Write:
    - `AGENTS.md` with model id, tools, skills resolves and runs a mock-provider turn.
    - Colocated skill `context` provider injects a context block when active.
    - Missing colocated tool name fails closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — changes discovered agent stub behavior and adds Node helper.
    - Docs pages to create/edit: `/docs/agent-definitions.md` (Task 6); `/docs/contribution-discovery.md` AGENTS.md section update.
    - `docs/index.md` update: yes (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Outcome / deviation:** Task completed. Added `src/node/agent-definitions.ts` exporting `resolveDiscoveredAgentDefinition()` and helper parsers `parseContextFile()` / `parseToolFile()`. The resolver reads `AGENTS.md` frontmatter, scans colocated `skills/<name>/SKILL.md`, `tools/<name>/TOOL.md`, and `context/<name>/CONTEXT.md`, merges colocated registries with host registries (colocated wins), resolves `Skill.metadata.context` names against merged context providers, and delegates to `resolveAgentDefinition`. Exported via new `./node/agent-definitions` package subpath. Updated `src/contributions.ts` `stubAgent()` error to point to `@arnilo/prism/node/agent-definitions#resolveDiscoveredAgentDefinition`. Tests in `src/__tests__/node-agent-definitions.test.ts` cover AGENTS.md resolution, colocated skill context injection, and missing-tool fail-closed. Updated `src/__tests__/contributions-discovered.test.ts` to match the new stub error. Verified with `npm run typecheck` and full `npm test` (652 core tests pass, 0 fail; workspace tests pass).
    - **Naming correction:** The plan and implementation originally used `AGENT.md`; the standard followed by Prism is `AGENTS.md`. Renamed the on-disk filename, the parser function to `parseAgentsFile()`, internal `readAgentsEntry()`, and all references in source, tests, docs, roadmap, and historical plans. Core parser/registration comments were generalized to avoid leaking the on-disk filename into core modules, and `src/__tests__/phase31-boundaries.test.ts` was updated to allow `AGENTS.md` literals in the Phase 33 Node loader files (`src/node/contribution-discovery.ts`, `src/node/agent-definitions.ts`) in addition to the Phase 31 loader files.
    - **Directory naming correction:** The workspace contribution directory was originally `.agent/`; renamed to `.agents/` to match the standard protocol. Updated `src/node/contribution-discovery.ts` workspace scan path, all source/tests/docs references, example workspaces (`examples/example-workspace/.agents`, `examples/instruction-injection-workspace/.agents`), and historical plans. Global discovery path `~/.prism/agent/` remains unchanged because it is not a project-root directory.

- [ ] Task 5 — Tests and boundary checks
  - Acceptance Criteria:
    - Functional: New `src/__tests__/agent-definitions.test.ts` covers declarative resolution, escape hatch, missing deps, overrides, `toolNames` enforcement, and `AGENTS.md` integration. Existing tests still pass. `src/__tests__/public-contracts.test.ts` verifies new exports.
    - Performance: Tests network-free and <1s combined.
    - Code Quality: No `synapta*` imports; no workflow/node/step vocabulary in new types; uses mock provider only.
    - Security: Tests verify that host `overrides` win and that missing dependencies fail closed before provider turn.
  - Approach:
    - Documentation Reviewed:
      - Existing `src/__tests__/public-contracts.test.ts`, `src/__tests__/skills.test.ts`, `src/__tests__/input-pipeline.test.ts`.
      - Phase 32 boundary test pattern.
    - Options Considered:
      - Spread tests across existing files: rejected — a dedicated phase file keeps failures greppable.
      - Use real filesystem for AGENTS.md tests: rejected — use `memfs`-style in-memory loader or temp directory helper; keep tests network-free and isolated.
    - Chosen Approach:
      - Add `src/__tests__/agent-definitions.test.ts`.
      - Add boundary assertions for new types (no domain vocabulary).
      - Update `src/__tests__/public-contracts.test.ts` export list.
    - API Notes and Examples:
      ```ts
      await assert.rejects(
        async () => resolveAgentDefinition({ name: "x", tools: ["missing"], model: "mock/demo" }, ctx),
        /Unknown tool: missing/,
      );
      ```
    - Files to Create/Edit:
      - `src/__tests__/agent-definitions.test.ts`: new test file.
      - `src/__tests__/public-contracts.test.ts`: add new exports to export-list assertions.
    - References:
      - `src/agent-definitions.ts`, `src/node/agent-definitions.ts`.
  - Test Cases to Write:
    - Declarative resolution produces runnable agent with mock provider.
    - `create()` escape hatch produces agent; `overrides` applied.
    - Missing tool name throws `Unknown tool`.
    - Missing skill name throws `Unknown skill`.
    - Missing context provider name throws `Unknown context provider`.
    - Missing model id throws `Unknown model`.
    - Skill `toolNames` demands inactive tool → throws during skill resolution.
    - `AGENTS.md` agent runs one turn with colocated skill context.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tests do not change public API.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6 — Documentation and examples
  - Acceptance Criteria:
    - Functional: `/docs/agent-definitions.md` exists and follows the Prism API-page structure for both `resolveAgentDefinition` and `AgentDefinition` declarative fields. `/docs/contribution-registries.md` agent section updated. `/docs/index.md` navigation entry added. `examples/agent-definition.ts` compiles network-free showing code-package and `AGENTS.md` usage.
    - Performance: Docs are static; example compiles under `examples/tsconfig.json`.
    - Code Quality: Docs cross-reference existing pages (tools, skills, context, loops, provider resolver, discovery) rather than duplicating mechanics.
    - Security: Examples use mock providers and fake credentials only; no real secrets.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure.
      - Existing `/docs/agent-loops.md`, `/docs/context-and-skills.md`, `/docs/provider-layer.md`, `/docs/contribution-discovery.md`, `/docs/contribution-registries.md`.
    - Options Considered:
      - Put agent-definition docs inside `/docs/extensions.md`: rejected — declarative agents are a distinct public surface; own page keeps navigation clear.
      - Skip compiled example: rejected — examples are required catch-up deliverables.
    - Chosen Approach:
      - Write `/docs/agent-definitions.md` with sections per API-page template.
      - Add short example to `examples/agent-definition.ts`.
      - Update `/docs/contribution-registries.md` and `/docs/index.md`.
    - API Notes and Examples:
      ```ts
      // Code-package agent
      api.registerAgent({
        name: "data-analyst",
        model: "openai/gpt-4o",
        tools: ["read-file", "my-grep"],
        skills: ["schema-skill"],
        instructions: "Analyze data files concisely.",
      });

      // Later, resolve and run
      const agent = resolveAgentDefinition(
        kernel.registries.agents.resolve("data-analyst"),
        { registries: kernel.registries, providerSource: resolver },
      );
      ```
    - Files to Create/Edit:
      - `/docs/agent-definitions.md`: new docs page.
      - `/docs/contribution-registries.md`: update agent section.
      - `/docs/index.md`: add navigation entry.
      - `examples/agent-definition.ts`: new compiled example.
      - `examples/README.md`: list new example.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - Roadmap Phase 33 docs acceptance.
  - Test Cases to Write:
    - `npm run build:examples` or equivalent compiles `examples/agent-definition.ts`.
    - Docs test enforces `/docs/agent-definitions.md` contains required API-page headings.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents new public API.
    - Docs pages to create/edit: `/docs/agent-definitions.md` (new), `/docs/contribution-registries.md` (edit), `/docs/index.md` (edit).
    - `docs/index.md` update: yes — add "Agent definitions" under Agent/session runtime linking to `/docs/agent-definitions.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
