# Release 0.0.20 — Skills and context progressive disclosure

Roadmap phase: Phase 3 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.19** (Phase 2 exit gate passed 2026-07-30).
Target: `@arnilo/prism` **0.0.20**.

## Objectives

- Make skill assembly progressive: expose `name` + `description` for selected skills every turn; inject full `instructions` only on demand or when host opts into eager mode.
- Align runtime `SkillRegistry` default with declarative fail-closed activation (no silent activate-all).
- Honor `ContextBlock.priority` in `applyContextBudget`; demote skill bodies to description-only before full drop.
- Optionally summarize stale large tool results between compaction cycles (host-gated; not a second memory system).

## Expected Outcome

- Provider input shows a bounded skill catalog (`Skill name: description`) for active skills; full instruction bodies absent unless eager mode or a successful skill-load for that run/session scope.
- Hosts can activate `createLoadSkillTool` (or frozen equivalent) to load an exact skill name into the contribution set; unknown names, inactive required tools, and oversized bodies fail closed.
- `AgentConfig.skills: SkillRegistry` with neither `RunOptions.activeSkills` nor `RunOptions.skills` activates **zero** skills by default; explicit `activateAllSkills` (or freeze-named opt-in) restores prior list-all behavior.
- Under budget pressure, low-priority context/skill blocks drop first; skills with bodies demote to description-only before removal.
- Optional mid-flight tool-result summarization stays off by default; when enabled, provider view replaces eligible aged tool messages with a one-line header + stable ref while the session store keeps raw entries.
- Docs, migration, packed example, and release metadata agree on **0.0.20**; Phase 5 Caveman/Ponytail can consume these contracts without dumping full `SKILL.md` every turn.

## Tasks

- [x] Task 0 — Primitive review and freeze public API deltas for Phase 3
  - Acceptance Criteria:
    - Functional: inventory states whether existing `Skill`, `SkillRegistry`, `resolveActiveSkills`, `InstructionInjector`, `ContextProvider`, `ContextBlock`, `applyContextBudget`, tools, and `RunOptions` cover catalog + on-demand load + safe registry default + priority eviction + optional tool-result fold without new contribution kinds.
    - Functional: written freeze lists exact public deltas: disclosure mode name/defaults, registry empty-default + activate-all opt-in name, skill-load tool/API export path, loaded-skill lifetime (run vs session), body size caps, budget demotion semantics, optional summarizer hook shape.
    - Performance: freeze requires O(active skills) catalog with byte/count caps; O(1) skill-load lookup; priority eviction O(n log n) or better; no provider call for summarization unless host summarizer + opt-in.
    - Code Quality: review cites file:line evidence; rejects parallel skill system, InstructionInjector-only as sole fix, and default LLM tool-result summarization.
    - Security: skill-load cannot grant tools/permissions; loaded text bounded/untrusted; summarizer output untrusted + size-capped; no cross-session skill leakage.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3 + Cross-Phase “Skills and context progressive disclosure” + gaps § Skill and context progressive-disclosure.
      - `docs/context-and-skills.md` (runtime table still documents activate-all on missing `activeSkills`), `docs/agent-session-runtime.md`, `docs/migration.md`, `docs/instruction-injection.md`, `docs/index.md`.
      - Code: `src/input.ts` (`assembleProviderInput`, `skillMessages`, `buildDefaultInputMessageGroups`), `src/agents.ts` (`resolveRunSkills`, `assemble` wiring), `src/context-budget.ts`, `src/contracts.ts`, `src/skills.ts`, `src/contribution-parsing.ts` (`parseSkillFile`), `src/agent-definitions.ts`, `src/cli-runner.ts`, `src/tools.ts`, `packages/compaction-observational-memory/src/tool.ts` (thin tool factory precedent).
      - Behavioral reference only: Claude Code / pi progressive skill disclosure (not a port).
    - Options Considered:
      - Keep full instructions every turn + document cost: reject (Caveman/Ponytail make acute).
      - Route heavy skills only through `InstructionInjector`: incomplete; leaves `Skill` progressive disclosure broken.
      - Description catalog + on-demand load + safe registry default + priority eviction: chosen (roadmap).
      - Automatic LLM summarization of every old tool result: reject as default; opt-in host summarizer only.
      - Skill-load tool in coding-agent only: reject — core hosts need load without coding-agent; public load surface ships from `@arnilo/prism`.
      - Persist loaded-skill names in session store custom entries: reject for 0.0.20 — in-memory session set suffices; durable resume loses loaded bodies unless host reloads.
      - Run-scoped loaded set (cleared each `run()`): reject — session-scoped matches multi-turn agent use and pi/Claude disclosure behavior.
      - Reuse declarative `activateAllCapabilities` for runtime registry: reject — that flag resolves `AgentDefinition` only (`src/agent-definitions.ts:81-124`); runtime needs a parallel `activateAllSkills` on `RunOptions` / `AgentConfig`.
    - Chosen Approach (executed freeze):
      - Task 0 is docs-only freeze; no production code until Tasks 1–6.
      - Core-only changes sufficient; **no new contribution kind** and **no new package**.
      - Loaded-skill set: session-owned in-memory `LoadedSkillSet` on `RuntimeAgentSession`; subsequent turns in the same session see bodies after `load_skill`; new session / process restart = catalog-only until reload; **not** written to checkpoint/durable run state in 0.0.20.
      - Progressive catalog: per-skill system messages `Skill <name>: <description>` (placeholder when empty); eager mode restores current `Skill <name>:\n<instructions>` shape.
      - Host must opt in to `createLoadSkillTool` on the active tool set; import/setup inert.
    - API Notes and Examples:
      ```ts
      import { createAgent, createLoadSkillTool, createLoadedSkillSet, createSkillRegistry } from "@arnilo/prism";

      const registry = createSkillRegistry([ponytail, brief]);
      const loaded = createLoadedSkillSet();
      const loadSkill = createLoadSkillTool({ registry, loaded });

      const agent = createAgent({
        model,
        provider,
        skills: registry,
        tools: [loadSkill, /* host tools */],
        skillsDisclosure: "progressive", // default
      });
      const session = agent.createSession();

      await session.run("…", { activeSkills: ["ponytail"] });
      // Turn 1 provider view: "Skill ponytail: Forces the laziest solution…"
      // After model calls load_skill { name: "ponytail" }, later turns in this session include instructions.

      // Migration for prior activate-all hosts:
      await session.run("…", { activateAllSkills: true });
      ```
    - Files to Create/Edit:
      - `plans/003-Release-0-0-20-Skills-Progressive-Disclosure.md`: freeze table (this task).
      - No production code in Task 0.
    - References:
      - Roadmap Phase 3 files list + API sketch.
      - `examples/skills.ts` (registry activate-by-name only; extend in Task 6).
  - Primitive inventory (file:line evidence):

    | Primitive | Progressive catalog + load + safe default + priority drop? | Evidence |
    | --- | --- | --- |
    | `skillMessages` | **No** — renders `instructions` only; `description` ignored | `src/input.ts:395-398` |
    | `createDefaultPromptBuilder` | **No** — delegates to `skillMessages` unchanged | `src/input.ts:130-138` |
    | `assembleProviderInput` | **Partial** — passes `skills` to budget + prompt; no disclosure/loaded split | `src/input.ts:152-257`, `src/agents.ts:557-582` |
    | `buildDefaultInputMessageGroups` | **Partial** — `toolResults` verbatim via `toolResultMessages`; no fold hook | `src/input.ts:260-272`, `:368-382` |
    | `resolveRunSkills` | **No** — registry without `activeSkills` → `configured.list()` | `src/agents.ts:980-987` |
    | `resolveActiveSkills` | **Yes** — exact-name resolve + `toolNames` fail-closed before provider turn | `src/skills.ts:37-45` |
    | `Skill` / `Skill.description` | **Partial** — typed + parsed from `SKILL.md`; never sent to provider | `src/contracts.ts:1005-1012`; `src/contribution-parsing.ts:87-109` |
    | `Skill.context` wiring | **Yes** — active skills' providers merged after host context | `src/agents.ts:508-512` |
    | `InstructionInjector` | **Yes** — additive instructions/context blocks; cannot load `Skill.instructions` | `src/contracts.ts:951-968`; `src/instruction-injection.ts` |
    | `ContextProvider` / `ContextBlock` | **Yes** — blocks resolve and render; `priority` unused in eviction | `src/contracts.ts:915-926`; `src/context-budget.ts:189-197` |
    | `applyContextBudget` | **Partial** — layout-kind LIFO; skills filtered to `instructions` only; no demotion | `src/context-budget.ts:93-210`, `:118`, `:199-207`, `:250-254` |
    | `ContextBudgetOmissionKind` | **Partial** — has `"skills"`; no body→catalog demotion kind yet | `src/context-budget.ts:10` |
    | `ToolDefinition` / `dispatchToolCall` | **Yes** — host-registered tools; load factory can close over registry + loaded set | `src/tools.ts:77-120`; OM `createRecallMemoryTool` precedent |
    | Declarative `activateAllCapabilities` | **Yes** — definition resolution only; not runtime registry | `src/contracts.ts:438-439`; `src/agent-definitions.ts:81-124` |
    | `cli-runner` discovery | **Yes** — already sets `activeSkills` when `--discover`; unaffected by empty default | `src/cli-runner.ts:420-432` |
    | Plain `Skill[]` on `AgentConfig` | **Unchanged** — explicit array is the activation list, not a vault | `src/agents.ts:986-987` |
    | `RuntimeAgentSession` | **No** — no loaded-skill mutable state today | `src/agents.ts:258-300` |
    | Compaction / OM | **Out of scope** — durable memory stays Phase 2 paths | `roadmap.md` cross-phase |

    **Verdict:** existing primitives cover catalog assembly, budget eviction, tool execution, and fail-closed skill selection once extended. **Core-only changes sufficient. No new contribution kind. No new package.** Session in-memory `LoadedSkillSet` avoids custom session entry types in 0.0.20.

  - Freeze table (public deltas only):

    | Surface | Before 0.0.19 | After 0.0.20 | Breaking? |
    | --- | --- | --- | --- |
    | Skill prompt assembly | full `instructions` every turn for active skills | default `skillsDisclosure: "progressive"` → `Skill <name>: <description>` per active skill; bodies only when eager or name ∈ session `LoadedSkillSet` | yes (pre-1.0 behavior) |
    | `skillsDisclosure` | none | `RunOptions.skillsDisclosure` and `AgentConfig.skillsDisclosure`: `"progressive" \| "eager"`; run overrides agent; default `"progressive"` | additive + default change |
    | Registry without `activeSkills` | `SkillRegistry.list()` all | **empty** (zero skills) | **yes** |
    | Runtime activate-all opt-in | none | `RunOptions.activateAllSkills?: true` and `AgentConfig.activateAllSkills?: true`; run overrides agent; restores `registry.list()` activation (still subject to disclosure rules) | additive |
    | Plain `Skill[]` / `RunOptions.skills` | all array skills active | unchanged — explicit arrays are activation lists, not vaults | no |
    | Declarative `activateAllCapabilities` | migration-only definition opt-in | unchanged — does **not** set runtime `activateAllSkills` | no |
    | Skill-load tool | none | `createLoadSkillTool({ registry, loaded, name? })` exported from `@arnilo/prism`; default tool name `load_skill`; schema `{ name: string }`; inert until host registers tool | additive |
    | Pure load helper | none | `resolveSkillLoad({ registry, name, tools, loaded? })` — validates name, `toolNames`, body cap; returns skill or throws; used by tool + tests | additive |
    | Loaded-skill state | none | `createLoadedSkillSet()` → `LoadedSkillSet` (`has`/`add`/`list`/`clear`); session-owned on `RuntimeAgentSession`; **not** checkpoint-persisted in 0.0.20 | additive |
    | Catalog caps | unbounded | `DEFAULT_MAX_SKILL_CATALOG_ENTRIES` **64**, `HARD_MAX_SKILL_CATALOG_ENTRIES` **256**; truncate/fail-closed per Task 1 | additive |
    | Description caps | unbounded | `DEFAULT_MAX_SKILL_DESCRIPTION_BYTES` **512**, `HARD_MAX_SKILL_DESCRIPTION_BYTES` **4096**; empty → `EMPTY_SKILL_DESCRIPTION` **`(no description)`** | additive |
    | Instruction body caps | unbounded | `DEFAULT_MAX_SKILL_INSTRUCTION_BYTES` **32768**, `HARD_MAX_SKILL_INSTRUCTION_BYTES` **262144**; load + eager render fail closed above hard cap | additive |
    | Budget eviction | layout-kind LIFO; `priority` ignored | within `context` and `skills` victims: ascending `priority` (missing = **0**), then existing LIFO; layout-kind outer order unchanged | behavior |
    | Skill budget demotion | all-or-nothing skill drop (`kind: "skills"`) | when skill has loaded body under pressure: demote to catalog-only first; new omission kind **`skill_body`**; full removal stays **`skills`** | behavior |
    | Tool-result mid-flight fold | none | optional `toolResultFold?: ToolResultFoldOptions` on `RunOptions` and `AgentConfig` (run overrides); default **off**; projection-only; store untouched; summarizer failure → keep raw | additive |
    | `toolResultFold` defaults | — | `minAgeTurns` default **2**, `minBytes` default **4096**, `maxSummaryBytes` default **512** / hard **4096** | additive |
    | Core contribution types | unchanged | unchanged | no |
    | New packages | — | none | n/a |

  - Frozen type sketch (implementation names; export from `src/index.ts` in Tasks 1–5):

    ```ts
    export type SkillsDisclosure = "progressive" | "eager";

    export const EMPTY_SKILL_DESCRIPTION = "(no description)" as const;
    export const DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64;
    export const HARD_MAX_SKILL_CATALOG_ENTRIES = 256;
    export const DEFAULT_MAX_SKILL_DESCRIPTION_BYTES = 512;
    export const HARD_MAX_SKILL_DESCRIPTION_BYTES = 4_096;
    export const DEFAULT_MAX_SKILL_INSTRUCTION_BYTES = 32_768;
    export const HARD_MAX_SKILL_INSTRUCTION_BYTES = 262_144;

    export interface LoadedSkillSet {
      has(name: string): boolean;
      add(name: string): void;
      list(): readonly string[];
      clear(): void;
    }

    export function createLoadedSkillSet(): LoadedSkillSet;

    export interface ResolveSkillLoadOptions {
      readonly registry: SkillRegistry;
      readonly name: string;
      readonly tools?: readonly ToolDefinition[];
      readonly loaded?: LoadedSkillSet;
    }

  /** Pure validation + lookup; throws on unknown name, inactive tool, oversize body, duplicate load. */
    export function resolveSkillLoad(options: ResolveSkillLoadOptions): Skill;

    export interface CreateLoadSkillToolOptions {
      readonly registry: SkillRegistry;
      readonly loaded: LoadedSkillSet;
      readonly name?: string; // default "load_skill"
    }

    export function createLoadSkillTool(options: CreateLoadSkillToolOptions): ToolDefinition;

    export interface ToolResultFoldInput {
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly text: string;
    }

    export interface ToolResultFoldOptions {
      readonly minAgeTurns?: number;
      readonly minBytes?: number;
      readonly maxSummaryBytes?: number;
      readonly summarize: (input: ToolResultFoldInput) => Promise<string> | string;
    }

    // RunOptions + AgentConfig additions:
    // skillsDisclosure?: SkillsDisclosure;
    // activateAllSkills?: true;
    // toolResultFold?: ToolResultFoldOptions;

    // ContextBudgetOmissionKind adds: "skill_body"
    ```

  - Rejected abstractions: parallel skill type/registry, InstructionInjector as sole progressive-disclosure path, default LLM tool-result summarization, skill-load factory in `coding-agent` only, auto-register `load_skill` on import, session-store custom entry for loaded names (0.0.20), run-scoped loaded set cleared every `run()`, reusing `activateAllCapabilities` for runtime registry, new `SkillLoader` contribution kind, checkpoint persistence of loaded bodies.
  - Test Cases to Write (for later tasks; none run in Task 0):
    - Listed under Tasks 1–6; freeze must not invent surfaces without matching tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (freeze only; docs land with implementation tasks).
    - Docs pages to create/edit: none in Task 0; freeze feeds Tasks 1–6 docs.
    - `docs/index.md` update: no in Task 0.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 1 — Progressive skill catalog assembly + eager opt-in
  - Acceptance Criteria:
    - Functional: for selected/active skills under progressive mode, provider system messages include bounded `Skill <name>: <description>` (placeholder if description empty); `instructions` absent unless skill is loaded for scope or disclosure is eager.
    - Functional: `skillsDisclosure: "eager"` (or freeze name) restores full-body-every-turn for active skills (regression path for current hosts).
    - Functional: catalog updates when active skill set changes; byte/count caps enforced fail-closed or truncate per freeze.
    - Performance: catalog render O(active skills); no extra provider calls.
    - Code Quality: reuse `Skill` + existing prompt builders; no parallel skill type.
    - Security: descriptions/instructions treated as untrusted text; caps prevent prompt blow-ups.
  - Approach:
    - Documentation Reviewed:
      - Task 0 freeze; `docs/context-and-skills.md` skillMessages note; `src/input.ts` assemble path.
    - Options Considered:
      - Catalog only on first turn: optional freeze detail; default every turn with caps is simpler and matches roadmap “every turn (or on first turn + when catalog changes)”.
      - Change `skillMessages` + budget skill measurement together: chosen minimal touch.
    - Chosen Approach:
      - Extend `skillMessages` / budget skill text helpers to render catalog vs body based on disclosure + loaded set.
      - Keep `Skill.context` resolution tied to **active** skills (selected names), not only loaded bodies — freeze confirms; default: context providers still resolve for active catalog skills (roadmap: selected skills).
    - API Notes and Examples:
      ```ts
      const request = await assembleProviderInput({
        skills: active,
        skillsDisclosure: "progressive", // default
        loadedSkills: sessionLoadedSet,
      });
      // progressive: "Skill brief: Answer briefly."
      // eager: "Skill brief:\nAnswer briefly." (instructions)
      ```
    - Files Created/Edited:
      - `src/skill-disclosure.ts` (new): `SkillsDisclosure`, caps, `createLoadedSkillSet`, `skillPromptText`, `skillMessages`, `resolveSkillsDisclosure`.
      - `src/input.ts`: wire disclosure + loaded set through `assembleProviderInput` / `createDefaultPromptBuilder`.
      - `src/context-budget.ts`: measure/drop skills via `skillPromptText`; progressive includes catalog-only skills.
      - `src/contracts.ts`: `skillsDisclosure` on `RunOptions` / `AgentConfig`; `skillsDisclosure` + `loadedSkills` on `PromptBuildRequest`.
      - `src/agents.ts`: session-owned `loadedSkills`; pass disclosure + loaded set into assembly.
      - `src/index.ts`: export disclosure surface.
      - `src/__tests__/skill-disclosure.test.ts` (new); updated `input-pipeline`, `skills`, `context-budget`, `cli-discovery`, `public-export-contract` tests.
    - References:
      - Roadmap Phase 3 Functional catalog criterion.
  - Test Cases Written:
    - `src/__tests__/skill-disclosure.test.ts`: catalog name+description; instructions absent until load or eager; empty description placeholder; description truncate + hard-cap fail-closed; catalog entry truncate + hard-cap fail-closed; assemble default progressive.
    - Regression: eager mode in `skills.test.ts`, `input-pipeline.test.ts`, `context-budget.test.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; prompt assembly behavior (default progressive).
    - Docs pages to create/edit: defer full rewrite to Task 6; inline comments accurate.
    - `docs/index.md` update: no until Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `npm test` green. Session `loadedSkills` wired; `createLoadSkillTool` deferred to Task 3.

- [x] Task 2 — Safe SkillRegistry default + activate-all migration opt-in
  - Acceptance Criteria:
    - Functional: when `AgentConfig.skills` is a `SkillRegistry` and neither `RunOptions.activeSkills` nor `RunOptions.skills` is set, active skill set is empty (no instructions, no skill context).
    - Functional: freeze-named opt-in (`activateAllSkills: true` or equivalent) restores `registry.list()` behavior for hosts that relied on activate-all.
    - Functional: plain `Skill[]` on `AgentConfig` unchanged (array as configured); `RunOptions.skills: []` still explicit none; declarative agents unchanged.
    - Functional: `resolveActiveSkills` still fail-closed on unknown names / inactive `toolNames`.
    - Performance: empty default is O(1); activate-all is O(registry size) same as today.
    - Code Quality: single resolution path in `resolveRunSkills`; docs tripwires update.
    - Security: no silent capability widening; migration opt-in must be explicit.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md` runtime table rows 109–121; `src/agents.ts:980-987`; declarative `activateAllCapabilities` precedent.
    - Options Considered:
      - Require `activeSkills` always and throw if missing: harsher; empty default matches declarative fail-closed.
      - Empty default + explicit activate-all: chosen.
    - Chosen Approach:
      - Change `resolveRunSkills` registry branch; add opt-in flag on `RunOptions` and/or `AgentConfig` per freeze.
      - Update docs tripwires that currently assert “All registry skills (`SkillRegistry.list()`)”.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({ model, provider, skills: registry });
      await agent.createSession().run("Hi"); // progressive empty: no skills
      await agent.createSession().run("Hi", { activeSkills: ["brief"] });
      await agent.createSession().run("Hi", { activateAllSkills: true }); // migration
      ```
    - Files to Create/Edit:
      - `src/agents.ts`, `src/contracts.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/docs.test.ts` (tripwire strings), CLI if it assumed list-all (`src/cli-runner.ts` already sets `activeSkills` for discovered skills).
    - References:
      - Roadmap “no silent activate-all”.
  - Test Cases to Write:
    - Registry without activeSkills injects zero skill messages by default.
    - Explicit activate-all restores prior all-registry behavior (with disclosure rules from Task 1).
    - Named `activeSkills` still resolves subset; missing tool still throws.
    - Plain-array AgentConfig skills unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; breaking runtime default.
    - Docs pages to create/edit: must land in Task 5 (`context-and-skills`, `migration`).
    - `docs/index.md` update: yes in Task 5 (activation defaults).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `resolveRunSkills` returns `[]` for registry without activation; `activateAllSkills` on `RunOptions` / `AgentConfig` restores `registry.list()`; `RunOptions.skills` overrides registry; docs table + tripwires updated.

- [x] Task 3 — On-demand skill load tool (`load_skill`)
  - Acceptance Criteria:
    - Functional: host-activated load path loads skill body by exact name into loaded set for subsequent turns; catalog entry remains; instructions appear after successful load.
    - Functional: unknown name, inactive required tool, and oversized body fail closed with bounded errors (no partial privilege grant).
    - Functional: load cannot activate tools or widen permissions; only injects text already present on registered `Skill`.
    - Performance: O(1) registry lookup; no provider call inside load tool.
    - Code Quality: export from `@arnilo/prism`; inert until host adds tool to active tools.
    - Security: argument name allow-listed against registry; output size-capped; no cross-session leakage of another session’s loaded set.
  - Approach:
    - Documentation Reviewed:
      - Task 0 freeze (export names, caps, lifetime); `src/tools.ts` patterns; existing skill toolNames enforcement.
    - Options Considered:
      - InstructionInjector-only load: weaker discoverability for models; tool preferred.
      - Core `createLoadSkillTool` + optional pure `loadSkillInstructions` helper: chosen.
    - Chosen Approach:
      - Factory closes over registry + loaded-set mutator supplied by session/host wiring (freeze exact wiring: session helper vs host-passed callback).
      - Prefer session wires tool when host opts in; no auto-register on import.
    - API Notes and Examples:
      ```ts
      import { createLoadSkillTool, createSkillRegistry } from "@arnilo/prism";

      const registry = createSkillRegistry([ponytail, /* … */]);
      const loadSkill = createLoadSkillTool({ registry, /* loaded set handle per freeze */ });
      const agent = createAgent({
        skills: registry,
        tools: [loadSkill, /* other host tools */],
      });
      await session.run("…", { activeSkills: ["ponytail"] });
      // after model calls load_skill({ name: "ponytail" }), later turns include instructions
      ```
    - Files to Create/Edit:
      - New `src/skill-load.ts` (or extend `src/skills.ts`), `src/index.ts` exports, `src/agents.ts` session wiring if freeze requires runtime-owned loaded set, tests, optional example update.
    - References:
      - Roadmap API sketch `load_skill { name }`.
  - Test Cases to Write:
    - Exact name success → subsequent assembly includes instructions.
    - Unknown name / inactive required tool / oversized body fail closed.
    - Load does not add tools to active tool set.
    - Loaded set does not leak across sessions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new export + tool schema.
    - Docs pages to create/edit: Task 5 must document tool + security notes.
    - `docs/index.md` update: yes in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `src/skill-load.ts` exports `resolveSkillLoad` + `createLoadSkillTool`; session dispatch injects `loadedSkills` / `activeTools` / `activeSkillNames` via tool context metadata; tests in `skill-load.test.ts`.

- [x] Task 4 — Priority-aware context budget eviction + skill description demotion
  - Acceptance Criteria:
    - Functional: `applyContextBudget` drops lowest-priority context/skill blocks first (missing priority = freeze default, document it); within same priority, keep current LIFO/layout order.
    - Functional: when a skill body is present under budget pressure, eviction may demote to description-only before removing the skill entirely; report omissions reflect demotion vs drop.
    - Functional: layout kind order (tool_results/history/…) still respected as outer policy unless freeze explicitly reorders; priority applies within context/skills sets.
    - Performance: O(n log n) or better over block/skill count; no O(n²) remeasure regression (keep subtract-on-drop).
    - Code Quality: `ContextBlock.priority` becomes meaningful; skill demotion reuses catalog renderer from Task 1.
    - Security: eviction never elevates privileges; omissions metadata stays bounded (`HARD_MAX_CONTEXT_BUDGET_OMISSIONS`).
  - Approach:
    - Documentation Reviewed:
      - `src/context-budget.ts` `dropNext` / `measureAll`; existing `context-budget.test.ts`.
    - Options Considered:
      - Priority across all message kinds: wider behavior change; roadmap focuses context/skill blocks.
      - Sort context/skills by ascending priority then LIFO; demote skill body→description: chosen.
    - Chosen Approach:
      - When selecting next context/skill victim, pick min priority (then LIFO). Demote skilled body to description-only as intermediate omission kind if freeze adds one.
    - API Notes and Examples:
      ```ts
      applyContextBudget({
        context: [
          { title: "low", content: "…", priority: 0 },
          { title: "high", content: "…", priority: 100 },
        ],
        skills: [{ name: "big", description: "d", instructions: "…".repeat(1e4) }],
        budget: { maxInputTokens: small },
        groups,
      });
      // drops/demotes low before high; skill may become description-only first
      ```
    - Files to Create/Edit:
      - `src/context-budget.ts`, `src/__tests__/context-budget.test.ts`, contracts if omission kind extended.
    - References:
      - Roadmap “prefer dropping low-priority / bodies before high-priority descriptions”.
  - Test Cases to Write:
    - Budget pressure drops low-priority blocks first.
    - Skill demotes to description before full drop.
    - Equal priority preserves prior LIFO behavior.
    - Existing budget tests still pass or update with documented default priority.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; budget semantics.
    - Docs pages to create/edit: Task 5 (`context-and-skills` and/or compaction/input docs if budget documented there).
    - `docs/index.md` update: yes if index mentions budgeting (Task 5).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `applyContextBudget` picks lowest `ContextBlock.priority` (default 0) then LIFO; skills demote via `skill_body` omission before `skills` drop; `demotedSkillBodies` threads to prompt builder; tests in `context-budget.test.ts`.

- [x] Task 5 — Optional mid-flight tool-result summarization (host-gated)
  - Acceptance Criteria:
    - Functional: disabled by default; when host supplies summarizer callback + opt-in thresholds (age and/or size), eligible aged tool messages in provider view become one-line header + stable ref.
    - Functional: raw tool-result entries remain intact in the session store; fold is projection-only.
    - Functional: summarizer output treated as untrusted and size-capped; failures fail closed (keep raw or skip fold per freeze — pick one and test it).
    - Performance: no provider call unless host summarizer invokes one; selection O(history tool results).
    - Code Quality: not a second memory system; does not replace OM/compaction.
    - Security: no cross-session refs; refs cannot read other branches’ payloads.
  - Approach:
    - Documentation Reviewed:
      - Roadmap optional criterion; `assembleProviderInput` / history grouping in `src/input.ts`; compaction docs boundary.
    - Options Considered:
      - Always summarize: reject.
      - Host callback + thresholds, default off: chosen.
    - Chosen Approach:
      - Small hook on input assembly or pre-budget history transform; session store untouched.
      - YAGNI: skip shipping if Task 0 freeze marks this deferrable **only if** roadmap exit gate still passable — roadmap lists it as Phase 3 Functional; implement minimal host callback path.
    - API Notes and Examples:
      ```ts
      await session.run("…", {
        toolResultFold: {
          minAgeTurns: 2,
          minBytes: 4_096,
          summarize: async ({ toolCallId, text }) => `ref:${toolCallId} ${text.slice(0, 80)}`,
        },
      }); // freeze-final shape
      ```
    - Files to Create/Edit:
      - `src/input.ts` and/or small `src/tool-result-fold.ts`, `src/contracts.ts`, tests, docs in Task 6 if split.
    - References:
      - Cross-phase: OM/compaction remain durable paths.
  - Test Cases to Write:
    - Default off: tool results unchanged.
    - Opt-in: aged large tool message replaced in provider view; store entry intact.
    - Oversized summarizer output capped/rejected per freeze.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; optional RunOptions/config.
    - Docs pages to create/edit: include in Task 6 with skills docs, or same task if combined.
    - `docs/index.md` update: brief note under Context and skills or Compaction — Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `src/tool-result-fold.ts` exports `resolveToolResultFold`, `foldToolResultHistory`, `foldToolResults`; `assembleProviderInput` folds history + in-flight tool results as projection-only; summarizer failure keeps raw; caps enforced; tests in `tool-result-fold.test.ts`.

- [x] Task 6 — Docs, migration, packed example, version bump to 0.0.20
  - Acceptance Criteria:
    - Functional: `docs/context-and-skills.md` documents progressive disclosure, load tool, registry empty default, priority eviction/demotion, optional tool-result fold; API page sections per prism-wiki.
    - Functional: `docs/agent-session-runtime.md` and `docs/migration.md` cover 0.0.19→0.0.20 breaking registry default + eager/activate-all migration.
    - Functional: `docs/index.md` Context and skills entry describes progressive disclosure and activation defaults.
    - Functional: packed public example demonstrates many skills catalog-under-budget + load one body.
    - Functional: workspace versions, changelogs, manifests, lockfile, `src/index.ts` version agree on **0.0.20**.
    - Performance: example needs no live provider.
    - Code Quality: docs tripwires updated; no stale “All registry skills” default claim.
    - Security: docs state skill-load bounds, untrusted text, no tool grant via skills.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; current context/skills + migration patterns from 0.0.19.
    - Options Considered:
      - Docs-only without version bump: reject (phase is a release).
      - Coordinated 0.0.20 bump after code tasks: chosen.
    - Chosen Approach:
      - Rewrite activation table; add progressive/load/budget sections; migration checklist; extend `examples/skills.ts` or add `examples/skills-progressive-disclosure.ts`.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs check --version 0.0.20
      ```
    - Files to Create/Edit:
      - `docs/context-and-skills.md`, `docs/agent-session-runtime.md`, `docs/migration.md`, `docs/index.md`, root/package CHANGELOGs as needed, manifests/lockfile/`src/index.ts`.
      - `examples/skills.ts` and/or new progressive-disclosure example + `examples/README.md`.
      - `src/__tests__/docs.test.ts` tripwires.
    - References:
      - Roadmap Phase 3 Documentation/Wiki Assessment.
  - Test Cases to Write:
    - Docs tripwires for progressive disclosure + empty registry default + load tool export names.
    - Example packs under existing example gate.
    - `node scripts/release.mjs check --version 0.0.20`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release documentation.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — Context and skills must mention progressive disclosure and activation defaults.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. Docs (`context-and-skills`, `agent-session-runtime`, `migration`, `index`, `release-and-install`, `0.1.0-readiness`), `examples/skills-progressive-disclosure.ts`, version **0.0.20** across workspace, tripwires, changelogs.

- [x] Task 7 — Phase 3 exit gate verification
  - Acceptance Criteria:
    - Functional: Task 0 freeze accepted; Tasks 1–6 checks green; core skill/context/budget tests + migration note + packed example pass.
    - Functional: `npm run sdk:ready`, docs links, declarations, changelog/migration, release check for 0.0.20 pass with no unexplained skills/context skip.
    - Performance: catalog/budget tests honor frozen caps; no unexpected provider calls in unit suite.
    - Code Quality: roadmap Phase 3 checkbox updated with completion evidence only after this gate (when releasing).
    - Security: fail-closed load/activation tests pass; audit policy clean for this release line.
  - Approach:
    - Documentation Reviewed:
      - Roadmap Phase 3 Exit Gate; Release Validation Checklist.
    - Options Considered:
      - Ship with docs drift: reject.
      - Full listed gate: chosen.
    - Chosen Approach:
      - Run gate commands; record results in this plan; update `roadmap.md` completion evidence when releasing.
    - API Notes and Examples:
      ```bash
      npm test -- skills context-budget input agents
      npm run sdk:ready
      node scripts/release.mjs check --version 0.0.20
      ```
    - Files to Create/Edit:
      - This plan checkboxes + Compromises/Further Actions; `roadmap.md` when gate passes.
    - References:
      - Roadmap Phase 3 Exit Gate list.
  - Test Cases to Write:
    - No new feature tests beyond fixing gate failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new impact beyond prior tasks.
    - Docs pages to create/edit: none unless gate finds doc drift.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. Gate evidence: Phase 3 core tests 159/159 pass (`skill-disclosure`, `skill-load`, `tool-result-fold`, `context-budget`, `input-pipeline`, `agents`, `skills`); full suite 1328/1328 pass; `npm run sdk:ready` green (typecheck, lint, format, coverage, pack:dry-run, release:gate); `node scripts/release.mjs check --version 0.0.20 --allow-dirty` green; `examples/skills-progressive-disclosure.ts` demo green; compat baseline + artifact budget baselines updated for 0.0.20; docs tripwire `phase3_progressive_disclosure_docs_cover_catalog_load_migration_and_example` green.

## Compromises Made

- Loaded-skill bodies are session-scoped in-memory only; checkpoint resume does not restore loaded bodies unless the host reloads (0.0.20 scope).
- Tool-result fold stays off by default; hosts must supply a summarizer callback and opt-in thresholds.
- Root tarball budget baselines bumped ~6% for Phase 3 modules (`skill-disclosure`, `skill-load`, `tool-result-fold`); deterministic pack gate still enforced at +5% tolerance.
- Breaking registry empty-default and progressive catalog default require `activateAllSkills` / `skillsDisclosure: "eager"` migration for prior activate-all hosts.

## Further Actions

- **Phase 4 next:** execute coding-tool capability gaps plan (repo_search modes, glob, read-before-write, delete/move) — do not start until Phase 3 release is tagged.
- **Phase 5 follow-on:** Caveman/Ponytail packages should consume Phase 3 progressive-disclosure contracts (catalog + `load_skill` / injector slices); no full SKILL.md every turn.
- **Future 0.0.x:** consider checkpoint persistence for loaded-skill names if hosts need durable resume without model reload.
- **Release handoff:** tag and publish `@arnilo/prism@0.0.20` when ready; `docs/release-and-install.md` has the publish checklist.
