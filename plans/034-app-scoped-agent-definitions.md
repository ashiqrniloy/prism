# Phase 34 — App-scoped agent definitions with repository-layer skills and tools

> This plan covers the remaining test, integration, and documentation work from Phase 33 under the updated app-scoped, non-overriding model.

## Objectives

- Keep repository-level `.agents/` discovery for repo-specific skills/tools/context/instructions.
- Keep repository-level `AGENTS.md` as the repo context prompt.
- Remove the hardcoded `~/.prism/agent/` global discovery path. Prism is a library/package; it does not own a global directory.
- Introduce an app-controlled config root (e.g. `.clay/extensions/prism/`) that provides:
  - Overall system prompt: `<configRoot>/agents/SYSTEM.md`
  - Per-agent custom system prompt / definition: `<configRoot>/agents/<agentName>/AGENT.md`
  - Global skills/tools: `<configRoot>/agents/skills/`, `<configRoot>/agents/tools/`
  - Per-agent skills/tools: `<configRoot>/agents/<agentName>/skills/`, `<configRoot>/agents/<agentName>/tools/`
- When an agent is resolved:
  - System prompts are **appended** in this order: `SYSTEM.md` → `AGENT.md` → `AGENTS.md`. None overrides another.
  - Skills and tools are made available as a **union**: global + repo + agent-specific. No scope overrides another.
- Make every layer fully configurable: the app can choose to omit `SYSTEM.md`, `AGENT.md`, `AGENTS.md`, global skills/tools, repo skills/tools, or agent-specific skills/tools per agent or globally.

## Expected Outcome

- `discoverContributions` no longer uses `~/.prism/agent/`. It accepts an explicit app config root plus the workspace root.
- `ContributionFileKind` no longer includes `"agent"` as a standalone discoverable kind; agents live under the app config root, not in `.agents/agents/`.
- The per-agent bundle filename is `AGENT.md` (singular). The parser is renamed back to `parseAgentFile()`.
- A new `discoverAgentBundles({ configRoot, ... })` returns app-config agent envelopes.
- `resolveAgentBundle()` (renamed from `resolveDiscoveredAgentDefinition()`) loads an agent's `AGENT.md`, builds **union** registries for skills and tools across global/repo/agent scopes, appends system prompts in the fixed order, and delegates to `resolveAgentDefinition()`.
- Tools and skills from all scopes are available to the agent unless the app explicitly excludes a scope or the agent's own declaration omits a name.
- Duplicate names across scopes are treated as an error rather than an override.
- CLI discovery flags are updated: remove `--discover-global` (no `~/.prism/agent/`), keep `--discover` for repo `.agents/`, and add `--agents-config <path>` for the app config root.
- Docs and tests reflect the append/union model and the configurability requirement.
- Full test suite passes.

## Tasks

- [x] Task 1 — Primitive review: inventory current discovery, registry, extension, resolver, and prompt seams under the append/union model
  - Acceptance Criteria:
    - Functional: Document every current use of `.agents/`, `~/.prism/agent/`, `ContributionFileKind`, `discoverContributions`, `registerDiscoveredContributions`, `stubAgent`, `parseAgentsFile`, `resolveDiscoveredAgentDefinition`, `--discover*` CLI flags, and `loadSystemPromptFiles`. Confirm that `ExtensionAPI.registerAgent`, tool/skill registries, and `resolveAgentDefinition` already provide app-level access control via name lists and registry scoping. Identify all places that currently assume override semantics.
    - Performance: No runtime change; review only.
    - Code Quality: Review output cites exact file/line references and distinguishes repo-level, app-global, and agent-specific scopes.
    - Security: Identify that removing `~/.prism/agent/` reduces hidden filesystem attack surface while keeping repo-level trust gating.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` (`ContributionFileKind`, `DiscoveredContribution`, `AgentDefinition`, `AgentDefinitionResolutionContext`).
      - `src/node/contribution-discovery.ts` (`discoverContributions`, `scanKindRoot`, `readEntry`, `kindDirName`, workspace/global roots).
      - `src/contributions.ts` (`registerDiscoveredContributions`, `stubAgent`, `descriptorTool`, `descriptorContextProvider`, `descriptorInstructions`).
      - `src/cli-runner.ts` (`ALL_KINDS`, `--discover-kinds`, `--discover-global`, `--discover`, `--no-discovery`).
      - `src/node/agent-definitions.ts` (`resolveDiscoveredAgentDefinition`).
      - `src/node/system-project-prompts.ts` (`loadSystemPromptFiles`).
      - `src/system-prompts.ts` (`composeSystemPrompt`, `mergeSystemPromptConfig`).
      - `src/extensions.ts` (`ExtensionAPI.registerAgent`, tool registration).
      - `src/agent-definitions.ts` (`resolveAgentDefinition`).
      - `docs/contribution-discovery.md`, `docs/cli-rpc.md`, `docs/index.md`, `docs/system-prompts.md`.
    - Options Considered:
      - Move everything into the app config root and delete `.agents/`: rejected — user explicitly wants repo-level `.agents/skills/` and `.agents/tools/` for project-specific contributions.
      - Keep `~/.prism/agent/` as a fallback global root: rejected — Prism is a package and should not own a global directory.
      - Merge with override semantics: rejected — user requires append/union behavior.
    - Chosen Approach:
      - Three-scope model with append for prompts and union for skills/tools; all layers optional.
    - Files to Create/Edit: none for this task.
    - References:
      - `src/contracts.ts`
      - `src/node/contribution-discovery.ts`
      - `src/contributions.ts`
      - `src/cli-runner.ts`
      - `src/node/agent-definitions.ts`
      - `src/node/system-project-prompts.ts`
      - `src/system-prompts.ts`
      - `src/extensions.ts`
      - `src/agent-definitions.ts`
  - Test Cases to Write:
    - none (review task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — discovery and system-prompt behavior change.
    - Docs pages to create/edit: plan update only; implementation docs updated in later tasks.
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `plans/033-agent-definitions-declarative-requirements-and-resolver.md`.
  - Outcome / Deviation:
    - See the appended **Task 1 Primitive Review** below for the full inventory.
    - No code changes were made; only the plan was updated with the review findings.

- [x] Task 2 — Remove `~/.prism/agent/` global root; keep workspace `.agents/` root
  - Acceptance Criteria:
    - Functional: `src/node/contribution-discovery.ts` no longer hardcodes `.prism/agent/`. `DiscoveryOptions` drops `globalRoot`. `discoverContributions` continues to scan `<workspaceRoot>/.agents/<kind>s/<name>/` for repo-level skills/tools/context/instructions.
    - Performance: Same O(n) scan; one fewer origin.
    - Code Quality: No dead global-root code paths.
    - Security: No implicit home-directory scan.
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts`.
      - `src/cli-runner.ts`.
      - `docs/contribution-discovery.md`.
    - Options Considered:
      - Replace `globalRoot` with a generic `additionalRoots` array: not needed; app config root is introduced separately for agents.
      - Keep `globalRoot` but rename semantics: confusing.
    - Chosen Approach:
      - Remove `globalRoot`. For repo-level discovery keep `workspaceRoot`. For app-config agent bundles introduce `configRoot` in a new/dedicated API.
    - API Notes and Examples:
      ```ts
      // Repo-level skills/tools/context/instructions
      const repoContributions = await discoverContributions({
        kinds: ["skill", "tool", "context", "instructions"],
        workspaceRoot: ".",
        trust,
      });
      ```
    - Files to Create/Edit:
      - `src/node/contribution-discovery.ts`.
      - `src/cli-runner.ts`.
    - References:
      - `src/node/contribution-discovery.ts`
      - `src/cli-runner.ts`
  - Test Cases to Write:
    - `discoverContributions` no longer accepts or defaults to a global root.
    - Repo `.agents/skills/` is still discovered when `workspaceRoot` is provided.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `DiscoveryOptions` shape changes.
    - Docs pages to create/edit: `docs/contribution-discovery.md`, `docs/cli-rpc.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Removed `globalRoot` from `DiscoveryOptions` and the global scan branch in `discoverContributions()`.
    - Simplified `scanKindRoot()` to scan the workspace `.agents/` tree only.
    - Removed `--discover-global` / `discoverGlobal` from the CLI and usage text.
    - Kept `CliRuntime.globalRoot` for the transitional SYSTEM.md auto-load path (Task 7).
    - Removed global-override tests from `node-contribution-discovery.test.ts`, `cli-discovery.test.ts`, and `node-instruction-injectors.test.ts`.
    - Updated `docs/contribution-discovery.md` and `docs/cli-rpc.md` to remove global discovery references.
    - Updated `docs.test.ts` assertions for the new docs text.
    - `npm run typecheck` passes.
    - `npm test` passes: 648 core tests, 0 failures; workspace tests pass.

- [x] Task 3 — Implement app-config agent bundle layout
  - Acceptance Criteria:
    - Functional: A new helper `discoverAgentBundles({ configRoot, ... })` scans:
      - `<configRoot>/agents/SYSTEM.md` (overall system prompt)
      - `<configRoot>/agents/<agentName>/AGENT.md` (per-agent definition/custom system prompt)
      - `<configRoot>/agents/skills/<skillName>/SKILL.md` (global skills)
      - `<configRoot>/agents/<agentName>/skills/<skillName>/SKILL.md` (agent-specific skills)
      - `<configRoot>/agents/tools/<toolName>/manifest.json` (global tools)
      - `<configRoot>/agents/<agentName>/tools/<toolName>/manifest.json` (agent-specific tools)
      The helper returns one envelope per agent containing paths to the agent file, its skills/tools, the global system prompt path, and global skills/tools paths.
    - Performance: Bounded scans per agent directory.
    - Code Quality: Reuses existing file readers and frontmatter parser; separates bundle discovery from resolution.
    - Security: Trust/permission policies apply to `configRoot`; per-agent subdirectories are containment-checked under it.
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts`.
      - `src/contribution-parsing.ts` (`parseSkillFile`, frontmatter splitter).
      - `src/contracts.ts` (`Skill`, `AgentDefinition`, `ToolDefinition`).
    - Options Considered:
      - Eagerly load all global + per-agent skills into one big registry: simpler but loses scoping and configurability.
      - Return envelopes and let `resolveAgentBundle` build scoped registries: preferred — lets the app decide which scopes to include.
    - Chosen Approach:
      - `discoverAgentBundles` returns lightweight envelopes. `resolveAgentBundle` builds union registries from those envelopes based on app-supplied options.
    - API Notes and Examples:
      ```ts
      // .clay/extensions/prism/agents/coding/AGENT.md
      // ---
      // name: coding
      // model: openai/gpt-4o
      // tools: [read-file, run-tests]
      // skills: [plan-skills, coding-style]
      // ---
      // You are a coding assistant for this project.
      ```
    - Files to Create/Edit:
      - `src/node/contribution-discovery.ts` or new `src/node/agent-bundles.ts`.
      - `src/node/agent-definitions.ts`.
    - References:
      - `src/node/contribution-discovery.ts`
      - `src/node/agent-definitions.ts`
  - Test Cases to Write:
    - `discoverAgentBundles` finds two agents under `<configRoot>/agents/<name>/AGENT.md`.
    - Global skills and per-agent skills are both discovered.
    - Global tools and per-agent tools are both discovered.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new discovery helper and layout.
    - Docs pages to create/edit: `docs/agent-definitions.md` and `docs/contribution-discovery.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Added `AgentBundle`, `DiscoverAgentBundlesOptions`, and `discoverAgentBundles()` to `src/node/agent-definitions.ts`.
    - The helper scans `<configRoot>/agents/` and returns one envelope per subdirectory containing `AGENT.md`, plus paths to the shared `SYSTEM.md`, global skills/tools, and per-agent skills/tools.
    - Reuses `readOptionalFile`, `assertPermission`, `isPathInsideReal`, and `listSubdirs` for trust/permission/containment; no `import()` is performed.
    - Added four tests in `src/__tests__/node-agent-definitions.test.ts`: two agents, global + per-agent skills, global + per-agent tools, export assertion.
    - `npm run typecheck` passes.
    - `npm test` passes: 652 core tests, 0 failures; workspace tests pass.

- [x] Task 4 — Rename per-agent bundle filename from `AGENTS.md` to `AGENT.md` and adjust parser naming
  - Acceptance Criteria:
    - Functional: Per-agent bundle files are named `AGENT.md`. The parser in `src/contribution-parsing.ts` is renamed from `parseAgentsFile` to `parseAgentFile` and parses `AGENT.md`. Repository-level project prompt `AGENTS.md` at workspace root stays unchanged.
    - Performance: No change.
    - Code Quality: Naming distinguishes singular per-agent bundle from plural repo project prompt.
    - Security: No security impact.
  - Approach:
    - Documentation Reviewed:
      - `src/contribution-parsing.ts`.
      - `src/index.ts` (exports).
      - All files referencing `parseAgentsFile`.
    - Options Considered:
      - Keep `parseAgentsFile` and have it parse `AGENT.md`: confusing.
      - Rename to `parseAgentFile`: clear and matches the filename.
    - Chosen Approach:
      - Rename `parseAgentsFile` → `parseAgentFile`, update all imports/usages, and change discovered/expected paths from `AGENTS.md` to `AGENT.md` in per-agent bundle contexts.
    - Files to Create/Edit:
      - `src/contribution-parsing.ts`.
      - `src/index.ts`.
      - `src/node/contribution-discovery.ts`.
      - `src/node/agent-definitions.ts`.
      - Tests and docs that reference the old name or filename.
    - References:
      - `src/contribution-parsing.ts`
      - `src/index.ts`
  - Test Cases to Write:
    - `parseAgentFile` parses `AGENT.md` frontmatter.
    - Discovery finds `agents/<name>/AGENT.md`, not `AGENTS.md`.
    - Repo project prompt loader still reads `AGENTS.md` at workspace root.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — exported parser name changes.
    - Docs pages to create/edit: `docs/contribution-discovery.md`, `docs/agent-definitions.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Renamed `parseAgentsFile()` → `parseAgentFile()` in `src/contribution-parsing.ts` and updated its JSDoc.
    - Updated `src/index.ts` export and all imports/usages in `src/node/contribution-discovery.ts` and `src/node/agent-definitions.ts`.
    - Changed per-agent bundle path from `AGENTS.md` to `AGENT.md` in `readAgentsEntry()` and in `resolveDiscoveredAgentDefinition()` documentation.
    - Updated tests: `contribution-parsing.test.ts`, `node-contribution-discovery.test.ts`, `contributions-discovered.test.ts`, `node-agent-definitions.test.ts`.
    - Updated docs: `docs/contribution-discovery.md` (parser name, per-kind entry file, frontmatter note, data-file list) and `docs/cli-rpc.md` (`--discover` description).
    - Workspace root project-prompt `AGENTS.md` references in `src/node/system-project-prompts.ts`, `src/cli-runner.ts`, and related tests/docs were left unchanged.
    - `npm run typecheck` passes.
    - `npm test` passes: 652 core tests, 0 failures; workspace tests pass.

- [x] Task 5 — Convert `resolveDiscoveredAgentDefinition()` into a configurable, three-scope bundle resolver
  - Acceptance Criteria:
    - Functional: `resolveDiscoveredAgentDefinition` is renamed to `resolveAgentBundle()` and accepts:
      - An app-config agent envelope (name, path to `AGENT.md`, paths to global/agent skills/tools).
      - Optional repo contributions from `discoverContributions({ workspaceRoot })`.
      - An `AgentDefinitionResolutionContext` supplied by the app.
      - Optional flags to include/exclude scopes (`systemPrompt`, `agentPrompt`, `repoPrompt`, `globalSkills`, `agentSkills`, `repoSkills`, `globalTools`, `agentTools`, `repoTools`).
      It builds **union** registries across included scopes. Duplicate names across included scopes produce an error rather than overriding. System prompts are **appended** in order `SYSTEM.md` → `AGENT.md` → `AGENTS.md` for included prompt sources, then delegates to `resolveAgentDefinition()`.
    - Performance: One registry union per agent resolution.
    - Code Quality: Clear scoping helpers; reuse existing `resolveAgentDefinition` and registry merge utilities.
    - Security: Caller supplies paths and registries; no hidden workspace/global scan.
  - Approach:
    - Documentation Reviewed:
      - `src/node/agent-definitions.ts`.
      - `src/agent-definitions.ts`.
      - `src/node/system-project-prompts.ts`.
      - `src/__tests__/node-agent-definitions.test.ts`.
    - Options Considered:
      - Keep the name and only add scopes: misleading because it is no longer about "discovered" repo agents.
      - Rename to `resolveAgentBundle`: explicit.
    - Chosen Approach:
      - Rename to `resolveAgentBundle` and define new input types `AgentBundle` (from discovery) and `AgentBundleResolutionOptions`.
    - API Notes and Examples:
      ```ts
      const bundle = (await discoverAgentBundles({ configRoot: ".clay/extensions/prism" }))[0]!;
      const agent = await resolveAgentBundle(bundle, {
        workspaceRoot: ".",
        registries: appRegistries,
        providerSource: appProviderSource,
        include: {
          systemPrompt: true,
          agentPrompt: true,
          repoPrompt: true,
          globalSkills: true,
          agentSkills: true,
          repoSkills: true,
          globalTools: true,
          agentTools: true,
          repoTools: true,
        },
      });
      ```
    - Files to Create/Edit:
      - `src/node/agent-definitions.ts`.
      - `src/index.ts` if re-exported.
      - `package.json` subpath export already exists.
    - References:
      - `src/node/agent-definitions.ts`
      - `src/agent-definitions.ts`
      - `src/node/system-project-prompts.ts`
  - Test Cases to Write:
    - `resolveAgentBundle` resolves an agent with global + repo + agent-specific skills as a union.
    - Excluding `repoSkills` removes repo skills from the agent.
    - Excluding `agentPrompt` removes the per-agent `AGENT.md` prompt layer.
    - Duplicate skill names across included scopes throw instead of overriding.
    - Missing tool fails closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — signature/name change.
    - Docs pages to create/edit: `docs/agent-definitions.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Replaced `resolveDiscoveredAgentDefinition()` with `resolveAgentBundle(bundle, options)` in `src/node/agent-definitions.ts`.
    - Added `ResolveAgentBundleOptions`, `AgentBundleScopeFlags`, and per-scope default-inclusion constants.
    - Builds union skill/tool arrays from global, agent-specific, and repo scopes; duplicate names throw with scope information.
    - Appends system prompts in `user` → `package` → `app` source order, mapping to `SYSTEM.md` → `AGENT.md` → `AGENTS.md`.
    - Updated `PHASE_33_AGENT_ERROR` in `src/contributions.ts` to reference `resolveAgentBundle`.
    - Replaced `node-agent-definitions.test.ts` resolver tests with six `resolveAgentBundle` tests covering union skills, scope exclusion, prompt-layer exclusion, duplicate-skill error, missing-tool failure, and export assertion.
    - Removed now-unused `scanColocated`, `mergeRegistries`, and related helpers; kept `parseContextFile`/`parseToolFile` exports for potential host use.
    - `npm run typecheck` passes.
    - `npm test` passes: 654 core tests, 0 failures; workspace tests pass.

- [x] Task 6 — Remove `.agents/agents/` as a discovery kind while keeping other repo-level kinds
  - Acceptance Criteria:
    - Functional: `ContributionFileKind` no longer includes `"agent"`. `discoverContributions` does not scan `.agents/agents/` or return agent envelopes. Repo-level skill/tool/context/instructions discovery remains.
    - Performance: Same O(n) scan for remaining kinds.
    - Code Quality: No dead agent branches in `readEntry`, `kindDirName`, or `registerDiscoveredContributions`.
    - Security: No agent stubs registered from repo discovery.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts`.
      - `src/node/contribution-discovery.ts`.
      - `src/contributions.ts`.
    - Options Considered:
      - Keep `"agent"` as an opt-in kind: rejected — agents now live in app config, not repo.
      - Remove `"agent"` entirely: preferred.
    - Chosen Approach:
      - Remove `"agent"` from `ContributionFileKind`, `readEntry`, `kindDirName`, and `registerDiscoveredContributions`. Delete `stubAgent()` and `PHASE_33_AGENT_ERROR`.
    - Files to Create/Edit:
      - `src/contracts.ts`.
      - `src/node/contribution-discovery.ts`.
      - `src/contributions.ts`.
    - References:
      - `src/contracts.ts`
      - `src/node/contribution-discovery.ts`
      - `src/contributions.ts`
  - Test Cases to Write:
    - `discoverContributions({ kinds: ["agent"], ... })` is a type error or runtime rejection.
    - `.agents/agents/` is ignored when scanning a workspace.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removes a discovery kind.
    - Docs pages to create/edit: `docs/contribution-discovery.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Removed `"agent"` from `ContributionFileKind` in `src/contracts.ts`.
    - Removed `readAgentsEntry()` and the `case "agent"` branch from `readEntry()`, `kindToManifestKind()`, and `kindDirName()` in `src/node/contribution-discovery.ts`; dropped the unused `parseAgentFile` import.
    - Removed the `case "agent"` branch from `registerDiscoveredContributions()`, deleted `stubAgent()` and `PHASE_33_AGENT_ERROR` from `src/contributions.ts`.
    - Removed `"agent"` from `ALL_KINDS` and the `--discover-kinds` usage text in `src/cli-runner.ts`.
    - Removed the agent discovery test from `node-contribution-discovery.test.ts` and the agent stub test from `contributions-discovered.test.ts`.
    - Updated `docs/contribution-discovery.md` (directory layout, kind table, kinds/CLI flag lists, outputs, extension notes, security bullets) and `docs/contribution-registries.md` / `docs/cli-rpc.md` cross-references to drop the agent discovery kind and the "workspace & global" wording.
    - Updated `docs.test.ts` phrase list to `.agents/{skills,tools,context,instructions}/<name>/` and dropped the `Phase 33` phrase.
    - `parseAgentFile` remains exported for app-level `AGENT.md` bundle loading via `resolveAgentBundle`; `ManifestContributionKind` still keeps `"agent"` for per-agent bundle declarations.
    - `npm run typecheck` passes.
    - `npm test` passes: 652 core tests, 0 failures; `npm run pack:dry-run` exits 0.

- [x] Task 7 — Update system-prompt loading for the append/union model
  - Acceptance Criteria:
    - Functional: For enabled prompt sources, system prompts are appended in this fixed order: `<configRoot>/agents/SYSTEM.md` → `<configRoot>/agents/<agentName>/AGENT.md` → `<workspaceRoot>/AGENTS.md`. The app can disable any or all of these sources via `AgentBundleResolutionOptions`. Runtime `RunOptions.systemPrompt` still wins and is appended last.
    - Performance: No redundant file reads; cached if resolved multiple times.
    - Code Quality: Reuse `composeSystemPrompt` / `mergeSystemPromptConfig` from `src/system-prompts.ts`.
    - Security: Trust-gate app config root and workspace root independently.
  - Approach:
    - Documentation Reviewed:
      - `src/node/system-project-prompts.ts`.
      - `src/system-prompts.ts`.
      - `src/node/agent-definitions.ts`.
    - Options Considered:
      - Load system prompts separately and pass them into `resolveAgentBundle`: clean separation.
      - Load system prompts inside `resolveAgentBundle`: convenient but couples bundle resolver to prompt files.
    - Chosen Approach:
      - `resolveAgentBundle` loads enabled prompt files and appends them into `AgentConfig.systemPrompt` / `instructions` before calling `resolveAgentDefinition`.
    - Files to Create/Edit:
      - `src/node/agent-definitions.ts`.
      - `src/node/system-project-prompts.ts` if helper refactor is needed.
    - References:
      - `src/node/system-project-prompts.ts`
      - `src/system-prompts.ts`
  - Test Cases to Write:
    - All three prompt sources appear in the assembled message when enabled.
    - Disabling `repoPrompt` omits `AGENTS.md`.
    - Disabling `agentPrompt` omits `AGENT.md`.
    - Disabling `systemPrompt` omits `SYSTEM.md`.
    - Prompts are appended, not replaced, when multiple are enabled.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — system prompt layering changes.
    - Docs pages to create/edit: `docs/system-prompts.md`, `docs/agent-definitions.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - `resolveAgentBundle()` already appended three prompt layers (Task 5); Task 7 hardened the loader to meet all acceptance criteria.
    - Fixed append order is `SYSTEM.md` (`source: "user"`) → `AGENT.md` body (`source: "package"`) → `AGENTS.md` (`source: "app"`), enforced by `composeSystemPrompt`'s `sourceRank`; `RunOptions.systemPrompt` (`source: "run"`) still wins and is appended last at run time via `mergeSystemPromptConfig`.
    - Added independent trust-gating of the app-config root (`SYSTEM.md`) and workspace root (`AGENTS.md`) via a new `trust` option on `ResolveAgentBundleOptions`, reusing `isTrusted`/`assertPermission`; added a `permission` option for per-file load assertions. Untrusted roots contribute nothing (fail-closed).
    - Each prompt file is read at most once per resolution; added a ponytail note that no cross-call cache is kept (resolution is one-shot).
    - Added tests: all three sources appended in order, `systemPrompt` disabled omits `SYSTEM.md`, `repoPrompt` disabled omits `AGENTS.md`, `agentPrompt` disabled omits `AGENT.md` (existing), and independent trust-gating of workspace vs config root.
    - Documented the three-source append model in `docs/system-prompts.md` (new "Agent bundle prompt layers (Phase 34)" section).
    - `npm run typecheck` passes.
    - `npm test` passes: 656 core tests, 0 failures; workspace tests pass.

- [x] Task 8 — Update CLI discovery flags
  - Acceptance Criteria:
    - Functional: Remove `--discover-global` and any hardcoded `~/.prism/agent/` default. Keep `--discover` for repo `.agents/` scanning. Add `--agents-config <path>` to point at the app config root. Update help text accordingly.
    - Performance: No change.
    - Code Quality: CLI flags match the three-scope model.
    - Security: CLI no longer auto-touches the user's home directory.
  - Approach:
    - Documentation Reviewed:
      - `src/cli-runner.ts`.
      - `src/__tests__/cli-discovery.test.ts`.
      - `docs/cli-rpc.md`.
    - Options Considered:
      - Keep `--discover-kinds` with `agent` removed: acceptable; the kinds list only affects repo `.agents/` scanning.
      - Drop `--discover-kinds` and always discover all repo kinds when `--discover` is set: simpler but less explicit.
    - Chosen Approach:
      - Keep `--discover-kinds` for repo kinds only. Remove `--discover-global`. Add `--agents-config <path>`.
    - Files to Create/Edit:
      - `src/cli-runner.ts`.
      - `src/__tests__/cli-discovery.test.ts`.
    - References:
      - `src/cli-runner.ts`
      - `docs/cli-rpc.md`
  - Test Cases to Write:
    - `--agents-config <path>` loads agents from the given app config root.
    - `--discover-global` is rejected/unknown.
    - `--discover` still scans repo `.agents/skills/`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI flags change.
    - Docs pages to create/edit: `docs/cli-rpc.md` (Task 9).
    - `docs/index.md` update: no (handled in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Removed the hardcoded `~/.prism/agent/` (homedir()) global-root default from the CLI; `globalRoot` is now host-controlled (passed explicitly) or replaced by `--agents-config` / `--system-md-file`. Dropped the `homedir` import from `src/cli-runner.ts`.
    - Confirmed `--discover-global` is gone (removed in Task 2); added a test asserting `--discover-global` is now rejected as an unknown flag.
    - Added `--agents-config <path>` flag: parsed into `CliOptions.agentsConfig`; when set, the CLI runs `discoverAgentBundles({ configRoot, trust })` and populates `CliOptions.discoveredAgents` (envelopes only — host owns resolution via `resolveAgentBundle`).
    - Built a shared `createPathTrustPolicy` whose `trustedRoots` include the workspace root, the `--agents-config` root, and (if set) the `--agents-md-file` parent.
    - Kept `--discover` / `--discover-kinds` for repo `.agents/{skills,tools,context,instructions}/` scanning (unchanged).
    - Updated CLI `usage` help text: added the `--agents-config` line and changed `--no-system-md` from "~/.prism/agent/SYSTEM.md" to "the global SYSTEM.md layer".
    - Updated the stale `node:os`/`--discover-global` comment in `phase29-boundaries.test.ts`.
    - Added tests: `--agents-config` parses and loads two bundles from a config root; `--discover-global` rejected as unknown.
    - `npm run typecheck` passes.
    - `npm test` passes: 659 core tests, 0 failures; `npm run pack:dry-run` exits 0.

- [x] Task 9 — Update docs and navigation
  - Acceptance Criteria:
    - Functional: `docs/contribution-discovery.md` documents repo-level `.agents/{skills,tools,context,instructions}/` and the new app-config agent layout. `docs/agent-definitions.md` documents global/repo/agent skill/tool unions and configurable prompt layers. `docs/system-prompts.md` documents the three prompt sources and how to enable/disable them. `docs/cli-rpc.md` matches new flags. `docs/index.md` navigation is updated.
    - Performance: No change.
    - Code Quality: Docs are consistent and avoid implying Prism owns a global directory.
    - Security: Docs state that the app controls `configRoot`, that all layers are optional, and that duplicate names across scopes error instead of overriding.
  - Approach:
    - Documentation Reviewed:
      - `docs/contribution-discovery.md`.
      - `docs/cli-rpc.md`.
      - `docs/index.md`.
      - `docs/agent-definitions.md` (create if not present).
      - `docs/system-prompts.md`.
    - Options Considered:
      - Merge all agent docs into contribution-discovery.md: too large; dedicated page is clearer.
      - Split into contribution-discovery.md (repo scanning) and agent-definitions.md (app bundles): preferred.
    - Chosen Approach:
      - Rewrite `docs/contribution-discovery.md` for repo-only kinds.
      - Create/update `docs/agent-definitions.md` for app-config agent bundles, unions, and configurable prompt layers.
      - Update `docs/system-prompts.md` for the three prompt sources.
      - Update `docs/cli-rpc.md` and `docs/index.md`.
    - Files to Create/Edit:
      - `docs/contribution-discovery.md`.
      - `docs/agent-definitions.md`.
      - `docs/system-prompts.md`.
      - `docs/cli-rpc.md`.
      - `docs/index.md`.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`
  - Test Cases to Write:
    - `docs.test.ts` path/flag assertions pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — docs reflect new model.
    - Docs pages to create/edit: see Files to Create/Edit.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Created `docs/agent-definitions.md` as a new prism-wiki API page (required headings enforced via `apiPages` membership in `docs.test.ts`): documents `resolveAgentDefinition`, `AgentDefinition` / `AgentDefinitionResolutionContext`, `discoverAgentBundles` + `resolveAgentBundle`, `AgentBundle` / `ResolveAgentBundleOptions` / `AgentBundleScopeFlags`, the three-scope layout (`<configRoot>/agents/...`, repo `.agents/{skills,tools}/`, per-agent), union skill/tool semantics with duplicate-name errors, configurable prompt layers via `include` flags, and security notes (app owns `configRoot`, all layers optional, no execution on discovery, independent trust gating).
    - `docs/contribution-discovery.md`: repo-only scanner stays (already updated in Tasks 2/6); added a pointer to `agent-definitions.md` for per-agent `AGENT.md` bundles, kept all `docs.test.ts`-required phrases (`.agents/{skills,tools,context,instructions}/<name>/`, `SKILL.md`, `AGENTS.md`, `manifest.json`, `createPathTrustPolicy`, `isPathInsideReal`, `opt-in`, `does not \`import()\``, `No auto-activate`, `No provider scanning`, `examples/discover-skills.ts`, `loadSystemPromptFiles`, `sibling`).
    - `docs/system-prompts.md`: removed "defaults to `os.homedir()` on the CLI" and the `~/.prism/agent/SYSTEM.md` CLI-flag wording; `--no-system-md` now says the CLI does not default to the user's home directory; cross-references `agent-definitions.md` for the three-layer bundle prompt model; link text fixed to "Contribution discovery (workspace)".
    - `docs/cli-rpc.md`: added `--agents-config <path>` flag row; removed `AGENT.md` from the `--discover` file list (per-agent `AGENT.md` is not a workspace discovery kind); `--no-system-md` reworded off `~/.prism/agent/`; trailing auto-loads paragraph reworded off `~/.prism/agent/SYSTEM.md` and points at `--agents-config` / [Agent definitions].
    - `docs/index.md`: added [Agent definitions](agent-definitions.md) entry under "Agent/session runtime"; reworded System prompts entry off `~/.prism/agent/` to describe the three-source append; fixed Contribution discovery link text to "(workspace)" and the file list to `SKILL.md`/`manifest.json`.
    - Cross-references in `docs/configuration-and-manifests.md`, `docs/context-and-skills.md`, `docs/settings-auth-trust-security.md`, `docs/extensions.md` link text updated from "(workspace & global)" to "(workspace)".
    - Added `docs/agent-definitions.md` to the `apiPages` list in `src/__tests__/docs.test.ts` so required headings are enforced.
    - `npm run typecheck` passes.
    - `npm test` passes: 659 core tests, 0 failures; `npm run pack:dry-run` exits 0 and ships `docs/agent-definitions.md` (15.3kB).
    - `grep` confirms no remaining `workspace & global` or `~/.prism/agent` references in `docs/` or `README.md`.

- [x] Task 10 — Update tests for the append/union model
  - Acceptance Criteria:
    - Functional: All tests pass. Tests that relied on `~/.prism/agent/`, `.agents/agents/`, or the old `resolveDiscoveredAgentDefinition` signature are removed or rewritten. Tests cover app-config global + per-agent skills/tools, repo `.agents/skills/` union, prompt append order, configurability of each layer, and error on duplicate names across scopes.
    - Performance: No new slow tests.
    - Code Quality: No skipped or stale tests.
    - Security: Trust-boundary tests still verify containment within app config root and repo root.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/node-contribution-discovery.test.ts`.
      - `src/__tests__/cli-discovery.test.ts`.
      - `src/__tests__/cli-instruction-injectors.test.ts`.
      - `src/__tests__/node-instruction-injectors.test.ts`.
      - `src/__tests__/contributions-discovered.test.ts`.
      - `src/__tests__/contribution-parsing.test.ts`.
      - `src/__tests__/node-agent-definitions.test.ts`.
      - `src/__tests__/docs.test.ts`.
      - `src/__tests__/phase29-boundaries.test.ts`.
      - `src/__tests__/system-project-prompts.test.ts`.
    - Options Considered:
      - Leave historical tests skipped: rejected.
      - Rewrite tests to use app-config temp roots plus repo `.agents/` temp roots: preferred.
    - Chosen Approach:
      - Rewrite discovery tests to use explicit `workspaceRoot` and `configRoot` temp dirs.
      - Remove tests for removed `agent` discovery kind and `~/.prism/agent/`.
      - Convert agent bundle tests to `resolveAgentBundle` with append/union fixtures.
    - Files to Create/Edit:
      - `src/__tests__/node-contribution-discovery.test.ts`.
      - `src/__tests__/cli-discovery.test.ts`.
      - `src/__tests__/cli-instruction-injectors.test.ts`.
      - `src/__tests__/node-instruction-injectors.test.ts`.
      - `src/__tests__/contributions-discovered.test.ts`.
      - `src/__tests__/contribution-parsing.test.ts`.
      - `src/__tests__/node-agent-definitions.test.ts`.
      - `src/__tests__/docs.test.ts`.
      - `src/__tests__/system-project-prompts.test.ts` if affected.
    - References:
      - Test files listed above.
  - Test Cases to Write:
    - Repo `.agents/skills/` skills are still discovered.
    - App-config global skills are available to all agents.
    - App-config per-agent skills are available only to that agent (not by name collision exclusion, but by discovery scope — the agent's own bundle includes them).
    - Union of skills from all scopes is available to the agent.
    - Excluding a scope removes those skills from the agent.
    - Duplicate skill names across included scopes throw instead of overriding.
    - Tool access is controlled by the agent's `tools` list and the app-provided registry union.
    - System prompts append in order `SYSTEM.md` → `AGENT.md` → `AGENTS.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tests only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: none.
  - Outcome / Deviation:
    - `src/__tests__/node-agent-definitions.test.ts` already covered the core append/union model ( Tasks 3–7): skills union across global/repo/agent scopes, `repoSkills`/`agentPrompt`/`systemPrompt`/`repoPrompt` exclusion, three-layer prompt append order (`SYSTEM.md` → `AGENT.md` → `AGENTS.md`), independent trust-gating of config root vs workspace root, duplicate-name throwing, missing-tool fail-closed. Added 4 new cases to close acceptance gaps: (1) app-config global skills are available to **every** agent bundle (two agents, both resolve the shared global skill); (2) per-agent skills are scoped to that agent's bundle (absent from a sibling — verified at the envelope path level); (3) tool access is controlled by the agent's `tools:` list resolved against the app-global + per-agent union, and an undeclared per-agent tool is **not** active; (4) excluding `agentTools` removes the per-agent tools while leaving the global tool intact.
    - `src/__tests__/contribution-discovery.types.test.ts`: rewrote the tool-kind example away from the removed `origin: "global"` / `/.prism/agent/...` path (no scanner emits a global origin since Task 2) to `origin: "workspace"` with a repo `.agents/tools/...` path, keeping the type-acceptance check valid.
    - `src/__tests__/cli-discovery.test.ts` Task 8 cases already cover `--agents-config <path>` loading and `--discover-global` rejection; `--discover` repo `.agents/skills/` coverage is asserted by the existing workspace-skill test. `src/__tests__/node-contribution-discovery.test.ts` already covers repo scanning, trust/permission gating, symlink exclusion, and the "no global root is scanned" guarantee.
    - `src/__tests__/cli-system-project-prompts.test.ts` and `src/__tests__/system-project-prompts.test.ts` exercise the three prompt layers + `--no-agents-md`/`--no-system-md`/`--agents-md-file`/`--system-md-file` + trust gating + redaction via an explicitly host-supplied `globalRoot` (no `homedir()` default dependence).
    - No stale `~/.prism/agent/`, `.agents/agents/`, or `resolveDiscoveredAgentDefinition` references remain in any test (the only `~/.prism/agent` mention is an explanatory comment in `phase29-boundaries.test.ts` documenting what Phase 34 removed). `kind: "agent"` in `contribution-parsing.test.ts` is the manifest-side `ManifestContributionKind` preserved intentionally by Task 6 and consumed by `parseAgentFile` inside `resolveAgentBundle` — not stale.
    - `npm run typecheck` passes.
    - `npm test` passes: 663 core tests, 0 failures (was 659 before Task 10; +4 new cases). `npm run pack:dry-run` exits 0.

- [x] Task 11 — Final verification
  - Acceptance Criteria:
    - Functional: `npm run typecheck` passes. `npm test` passes with 0 failures. `npm run pack:dry-run` passes. No remaining references to `~/.prism/agent/` in source/tests/docs. `.agents/agents/` is no longer documented or scanned. `AGENT.md` is used for per-agent bundles; `AGENTS.md` remains for repo project prompt.
    - Performance: Full test suite runtime not regressing.
    - Code Quality: No dead code; no lint/type errors.
    - Security: No hardcoded global paths; trust policy applies to app config root and repo root.
  - Approach:
    - Run `npm run typecheck`.
    - Run `npm test`.
    - Run `npm run pack:dry-run`.
    - Grep for remaining stale references.
  - Files to Create/Edit: none.
  - Test Cases to Write:
    - none (verification task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification task.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: none.
  - Outcome / Deviation:
    - `npm run typecheck` passes (EXIT 0; core + workspaces + examples).
    - `npm test` passes with 0 failures: 663 core tests + workspace + example suites; EXIT 0. Per-suite `duration_ms` are sub-second (no runtime regression observed).
    - `npm run pack:dry-run` passes (EXIT 0; ships `docs/agent-definitions.md` and all workspace tarballs).
    - No remaining `~/.prism/agent/` references in `src/`, `docs/`, `README.md`, or `examples/` — the only mention is an explanatory comment in `src/__tests__/phase29-boundaries.test.ts:36` documenting what Phase 34 removed. `examples/system-project-prompts.ts` comment was reworded off `~/.prism/agent/` to "host-supplied globalRoot" during Task 11.
    - `.agents/agents/` is no longer documented or scanned anywhere in `src/`, `docs/`, `README.md`, or `examples/` (zero matches). `ContributionFileKind` is `"skill" | "tool" | "context" | "instructions"` (no `agent`).
    - `AGENT.md` (singular) is used for per-agent bundles in `src/node/agent-definitions.ts` (path constants, docstrings, scanner). `AGENTS.md` (plural) is retained as the repo-level project prompt in `src/node/system-project-prompts.ts`, `discoverAgentBundle`'s `repoPrompt` layer, and `docs/system-prompts.md`.
    - No dead code: `stubAgent`, `PHASE_33_AGENT_ERROR`, `parseAgentsFile`, `readAgentsEntry`, `resolveDiscoveredAgentDefinition`, and the CLI `--discover-global` flag are all gone (zero matches).
    - No hardcoded global paths in `src/cli-runner.ts`: the `homedir()` import is dropped; `globalRoot` is host-controlled. Trust policy applies to both the app config root (`discoverAgentBundles` checks `configRoot` via `trust.check`; verified by `trust-gates the workspace root and app-config root independently` test) and the repo root (`resolveAgentBundle` builds independent trust gates for SYSTEM.md and AGENTS.md). `isPathInsideReal` excludes symlink escapes from both roots.
    - Phase 34 Task 11 marked `[x]` complete.

## Task 1 Primitive Review

Review date: 2026-06-28
Files read: `src/contracts.ts`, `src/node/contribution-discovery.ts`, `src/contributions.ts`, `src/cli-runner.ts`, `src/node/agent-definitions.ts`, `src/node/system-project-prompts.ts`, `src/system-prompts.ts`, `src/extensions.ts`, `src/agent-definitions.ts`, `docs/contribution-discovery.md`, `docs/system-prompts.md`, `docs/cli-rpc.md`.

### 1. Discovery seams

`src/node/contribution-discovery.ts` defines the filesystem scanner.

- `DiscoveryOptions` (lines 14-25) has `workspaceRoot` and `globalRoot`.
  - `workspaceRoot` scans `<root>/.agents/<kind>s/<name>/`.
  - `globalRoot` scans `<root>/.prism/agent/<kind>s/<name>/`.
- `ContributionFileKind` (in `src/contracts.ts`, line 445) is `"skill" | "tool" | "context" | "instructions" | "agent"`.
- `kindDirName()` (lines 204-214) maps kinds to directory names: skills, tools, context, instructions, agents.
- `scanKindRoot()` (lines 61-98) reads the kind directory and calls `readEntry()`.
- `readEntry()` (lines 100-112) dispatches:
  - `skill` → `readSkillEntry()` → `<dir>/SKILL.md` → `parseSkillFile()` → realized `Skill`.
  - `agent` → `readAgentsEntry()` → `<dir>/AGENTS.md` → `parseAgentsFile()` → `ManifestContributionDeclaration`.
  - other kinds → `<dir>/manifest.json` → `ManifestContributionDeclaration`.
- `discoverContributions()` (lines 34-59) merges global first, then workspace, with workspace overriding same `(kind, name)`. This is the current override semantic.
- `readOptionalFile()` (lines 145-154) is shared with the system-prompt loader.

Current paths that must change for the three-scope model:
- Remove `globalRoot` and all `.prism/agent/` references.
- Remove `"agent"` from `ContributionFileKind` and stop scanning `.agents/agents/`.
- Keep workspace `.agents/{skills,tools,context,instructions}/` for repo-level contributions.
- Add a new app-config scanner for `<configRoot>/agents/SYSTEM.md`, `<configRoot>/agents/<agent>/AGENT.md`, `<configRoot>/agents/skills/`, `<configRoot>/agents/tools/`, `<configRoot>/agents/<agent>/skills/`, `<configRoot>/agents/<agent>/tools/`.

### 2. Registry seams

`src/contributions.ts` defines `ContributionRegistries` and `registerDiscoveredContributions`.

- `ContributionRegistry<T>` (lines 13-20) is key-based; `register(key, value)`, `get`, `resolve`, `list`.
- `ContributionRegistries` (lines 36-63) includes providers, models, tools, contextProviders, skills, commands, agents, etc.
- `registerDiscoveredContributions()` (lines 108-141) currently handles all five `ContributionFileKind` values:
  - `skill`: registers full `Skill`.
  - `tool`: registers descriptor `ToolDefinition` whose `execute` throws.
  - `context`: registers descriptor `ContextProvider` whose `resolve` throws.
  - `instructions`: registers empty-text `SystemPromptContribution`.
  - `agent`: registers a stub `AgentDefinition` whose `create()` throws `PHASE_33_AGENT_ERROR`.
- `descriptorTool()`, `descriptorContextProvider()`, `descriptorInstructions()` (lines 165-189) create descriptor stubs.
- `stubAgent()` (lines 191-202) creates the fail-closed agent stub.

Changes needed:
- Remove the `agent` case and `stubAgent()` / `PHASE_33_AGENT_ERROR`.
- Keep tool/context/instructions descriptor registration for repo-level discovery.
- The union of registries (global + repo + agent-specific) will be built in `resolveAgentBundle()`, not in `registerDiscoveredContributions()`.
- Duplicate names across scopes must error, not override. Current `register()` silently overwrites, so the union builder must check for collisions.

### 3. Extension seams

`src/extensions.ts` exposes `ExtensionAPI`.

- `registerAgent(agent: AgentDefinition)` (line 121) lets code packages register agents directly.
- `registerTool(tool: ToolDefinition)` (line 109), `registerSkill(skill: Skill)` (line 115), `registerContextProvider()` (line 113), `registerSystemPromptContribution()` (line 143) let packages register code-level contributions.
- These are app-level registration points. The app controls what is registered before calling `resolveAgentBundle()`.

No changes needed to the extension API itself; it already gives the app control.

### 4. Resolver seams

`src/agent-definitions.ts` defines `resolveAgentDefinition()`.

- Takes `AgentDefinition` + `AgentDefinitionResolutionContext`.
- `AgentDefinition` (`src/contracts.ts` lines 94-111) already has declarative fields: `model`, `tools`, `skills`, `context`, `systemPrompt`, `instructions`, `loop`, optional `create()`.
- `AgentDefinitionResolutionContext` (`src/contracts.ts` lines 115-122) lets the host pass `registries`, `providerSource`, `tools`, `skillsRegistry`, and `overrides`.
- `resolveAgentDefinition()` resolves model, tools, skills, context providers against the supplied registries; missing dependencies throw.
- Tool access is gated by `def.tools` name list; if omitted, all tools from the source are available.
- Skill activation is gated by `def.skills` name list; `toolNames` enforcement happens in `resolveActiveSkills()`.

This is the right primitive for the new model. `resolveAgentBundle()` will:
1. Load the per-agent `AGENT.md` into an `AgentDefinition`.
2. Build union registries from global/repo/agent scopes.
3. Append system prompt layers.
4. Delegate to `resolveAgentDefinition()`.

`src/node/agent-definitions.ts` currently has `resolveDiscoveredAgentDefinition()`.

- Accepts a `DiscoveredContribution` (from repo discovery) and a context.
- Reads `AGENTS.md`, scans colocated `skills/`, `tools/`, `context/` inside the agent directory, and merges them with host registries with colocated overriding host.
- This implementation assumes a single repo-level agent bundle. It must be replaced with `resolveAgentBundle()` that accepts an app-config envelope and handles three scopes with union semantics.

### 5. Prompt seams

`src/system-prompts.ts` defines `composeSystemPrompt()` and `mergeSystemPromptConfig()`.

- Sources ranked: `user` (0), `package` (1), `app` (2), `run` (3).
- Modes: `append`, `prepend`, `replace`, `disable`.
- Current design uses rank to order layers; within the append/union model, rank still orders contributions but all enabled app/repo/agent prompts will append.

`src/node/system-project-prompts.ts` defines `loadSystemPromptFiles()`.

- Loads `SYSTEM.md` from `<globalRoot>/.prism/agent/SYSTEM.md` (source: `user`).
- Loads `AGENTS.md` from `<workspaceRoot>/AGENTS.md` (source: `app`).
- Returns `[SYSTEM.md, AGENTS.md]`.

Changes needed:
- Remove `.prism/agent/` path; instead load `<configRoot>/agents/SYSTEM.md` from the app config root.
- Load per-agent `<configRoot>/agents/<agent>/AGENT.md` as the agent-specific prompt layer.
- Append order for enabled layers: `SYSTEM.md` → `AGENT.md` → `AGENTS.md`.
- Make each layer optional via configuration.

### 6. CLI seams

`src/cli-runner.ts` defines CLI flags.

- `--discover` / `--discover-kinds` / `--discover-global` / `--no-discovery` (lines 89, 99, 114, 138, 215).
- `--no-agents-md` / `--no-system-md` / `--agents-md-file` / `--system-md-file` (lines 91-93).
- `ALL_KINDS` (line 101) includes `"agent"`.
- Default `globalRoot` is `os.homedir()` when `--discover-global` is set.
- Default system prompt `globalRoot` is `os.homedir()` for `~/.prism/agent/SYSTEM.md`.

Changes needed:
- Remove `--discover-global` and default `globalRoot`.
- Remove `"agent"` from `ALL_KINDS`.
- Add `--agents-config <path>` for app config root.
- Keep `--discover` / `--discover-kinds` for repo `.agents/` scanning.
- Update system-prompt flags to load from app config root instead of `~/.prism/agent/`.

### 7. Test seams

Files with assumptions that will change:

- `src/__tests__/node-contribution-discovery.test.ts`: uses `globalRoot` and `.prism/agent/` paths.
- `src/__tests__/cli-discovery.test.ts`: tests `--discover-global`.
- `src/__tests__/system-project-prompts.test.ts`: uses `globalRoot` and `.prism/agent/SYSTEM.md`.
- `src/__tests__/node-agent-definitions.test.ts`: tests `resolveDiscoveredAgentDefinition()`.
- `src/__tests__/contribution-parsing.test.ts`: tests `parseAgentsFile()` and `AGENTS.md` paths.
- `src/__tests__/contributions-discovered.test.ts`: tests `stubAgent()` / `PHASE_33_AGENT_ERROR`.
- `src/__tests__/docs.test.ts`: asserts docs mention `~/.prism/agent/` and `AGENTS.md` in discovery context.

### 8. Docs seams

- `docs/contribution-discovery.md`: documents workspace/global discovery, `.agents/`, `~/.prism/agent/`, `AGENTS.md` as an agent kind, and override merge order.
- `docs/system-prompts.md`: documents `~/.prism/agent/SYSTEM.md` and `<workspaceRoot>/AGENTS.md`.
- `docs/cli-rpc.md`: documents `--discover-global` and system-prompt paths.

All three docs must be rewritten for the app-config + repo-only model.

### 9. Conclusion

The existing primitives are sufficient for the new model:
- `discoverContributions` can be narrowed to repo-only kinds.
- A new `discoverAgentBundles` can scan the app config root.
- `resolveAgentDefinition` can resolve the merged agent.
- `ExtensionAPI` already lets the app register tools/skills.
- `composeSystemPrompt` can append multiple prompt layers.

The main new work is:
1. Remove `~/.prism/agent/` and `.agents/agents/` from discovery.
2. Add app-config agent bundle discovery.
3. Build union registries and append prompt layers in `resolveAgentBundle()`.
4. Make every layer configurable.
5. Update CLI, tests, and docs.

## Compromises Made

- To be filled after task completion.

## Further Actions

- To be filled after task completion.
