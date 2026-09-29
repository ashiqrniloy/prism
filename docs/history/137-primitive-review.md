# Prism Code agent loop, skills, compaction, and stop hooks primitive review (plan 137 Task 1)

Plan: [137-Prism-Code-Agent-Loop-And-Skills.md](../../plans/137-Prism-Code-Agent-Loop-And-Skills.md) Task 1  
Date: 2026-09-28  
Baseline: `@arnilo/prism` 0.12.0, `@arnilo/prism-core` 0.12.0, `@arnilo/prism-agent-sdk` 0.12.0, `@arnilo/prism-coding-tools` 0.12.0, `@arnilo/prism-code` 0.12.0, Bun 1.4.2  
Scope: Read-only primitive inventory across skills discovery/loading, run limits, between-turn compaction, stop hooks, interactive tools, and approvals. Findings drive Tasks 2–8.

---

## 1. Verdict & Generic Gaps

Four generic gaps must be implemented in foundational packages; the remaining features are host wiring inside `packages/prism-code`. Application-specific logic stays out of core runtime packages.

| Gap | Status | Owning Package | Decision |
| --- | --- | --- | --- |
| **(a) Multi-root discovery with origin and precedence** | Confirmed absent. `discoverContributions` only scans `workspaceRoot/.agents/<kind>s/`. No global root or flat folder scanning. | `@arnilo/prism` (`src/node/contribution-discovery.ts`) | Add `roots?: readonly { dir: string; origin: "global" \| "workspace"; layout?: "kind-dir" \| "flat" }[]` to `DiscoveryOptions`. Later roots override earlier ones by `kind/name`. `workspaceRoot` remains backward-compatible as the final root. |
| **(b) Optional `Skill.path` and directory disclosure in `load_skill`** | Confirmed absent. `Skill` contract lacks `path`; `parseSkillFile` and `loadSkillDirectory` drop file locations. | `@arnilo/prism` (`src/contracts-core/agent.ts`, `src/contribution-parsing.ts`, `src/skill-load.ts`) | Add optional `readonly path?: string` to `Skill`. `parseSkillFile(text, path)` populates it. `createLoadSkillTool` appends `Skill directory: <dirname(path)>` to success text (within `MAX_LOAD_SKILL_RESULT_BYTES`), enabling on-demand reads of bundled `references/`, `scripts/`, and `assets/`. |
| **(c) Between-turn auto-compaction inside a run** | Confirmed absent. `autoCompact` is only evaluated once at run start (`assemble.ts:386`). Long multi-turn runs overflow context. | `@arnilo/prism` (`src/agent-session/session/tool-round.ts`, `src/agent-session/session.ts`, `src/agent-session/session/types.ts`) | Hook `autoCompact` at turn boundaries (after tool results are appended, before assembling the next provider turn). Reuses `compactBranch` and `CompactionTrigger`. Resumed checkpoints remain consistent. |
| **(d) Todo tool and task-completion continuation stop hook** | Confirmed absent. No standard task checklist tool or continuation stop hook exists; agents stop prematurely upon text outputs. | `@arnilo/prism-coding-tools` (`packages/prism-coding-tools/src/agent/todo.ts`) | Add `createTodoWriteTool()` (stateless list replacement derived from transcript history) and `createTodoContinuationStopHook({ maxNoProgress: 2 })` (inspects latest todo list, returns `continue` with a steer if open items remain, guards against zero-progress loops). |

### SDK Plane Gaps
- **`SkillsPlaneConfig` in `@arnilo/prism-agent-sdk`**: Missing `roots` pass-through and `activateAll?: boolean` setting. When an agent defines a `SkillRegistry`, `resolveRunSkills` defaults to returning zero active skills unless `activeSkills` or `activateAllSkills` is enabled. `SkillsPlaneConfig` must support passing `roots` and defaulting `activateAll: true` when skills are registered.
- **`InstructionsPlaneConfig` in `@arnilo/prism-agent-sdk`**: Missing support for multi-layer `AGENTS.md` cascades (global + repo root) and has a typing/runtime bug where `systemMd: true` passes `globalRoot: undefined`.

### Prism Code App-Level Wiring (`packages/prism-code`)
- **Default-on skills plane**: Remove the gate `config.skills || wiki.skills.length > 0`; always initialize the skills plane with the 4-layer precedence: (1) `~/.agents/agent/skills`, (2) `~/.prism/agent/skills`, (3) `skills.dirs`, (4) `<repo>/.agents/agent/skills`, plus compatibility root `<repo>/.agents/skills`. Register `load_skill` tool and `/skills`, `/skill` commands.
- **Base coding-agent system prompt & environment block**: Built-in system prompt constant in `prompt.ts`; volatile environment block (cwd, repo root, git branch, model) provided via context provider to preserve prompt cache stability.
- **Unbounded run limits by default**: Default policy axes to `null`, byte ceilings to `HARD_RUN_LIMITS` (64 MiB), thread config `limits` and `loop` options, add CLI flags `--max-turns` and `--max-cost`.
- **Interactive tools & approval overhaul**: Replace stubs in `headless.ts` with real handlers; wire `ask_user_decision` to TUI picker and headless guidance fallback; wire `coding_check` to configured checks; implement tri-mode approvals (`ask`, `accept-edits`, `auto`); persist approvals in `~/.prism/permissions.json`; unify MCP tools under execution policy; remove 60-second auto-deny timeout.

---

## 2. Skill Discovery and Loading Primitives

### `discoverContributions` (`src/node/contribution-discovery.ts:13-80`)
- **Current Capabilities**:
  - Scans immediate child directories under `<workspaceRoot>/.agents/<kindDirName>/<name>/` for `skill`, `tool`, `context`, `instructions`.
  - Enforces `TrustPolicy` check on `<workspaceRoot>/.agents/<kindDirName>` (`options.trust.check({ kind: "project", target: kindDir })`). Untrusted roots return `[]` cleanly without throwing.
  - Guards against directory traversal using `isPathInsideReal(kindDir, dir)`.
  - Asserts permission for each directory (`assertPermission(options.permission, { kind: "resource", action: "load", target: dir })`).
  - Returns inert `DiscoveredContribution[]` with de-duplication keyed by `${kind}/${name}`.
- **Gaps & Limitations**:
  - **Workspace-only**: Strictly requires `options.workspaceRoot`. JSDoc explicitly acknowledges: *"Scans the workspace `.agents/` tree only; no global root"*.
  - **No multi-root support**: Cannot scan multiple folders or compose global roots (e.g. `~/.agents/agent/skills`, `~/.prism/agent/skills`).
  - **Rigid directory layout**: Assumes `<root>/.agents/<kind>s/<name>/`. Cannot scan flat directories of skills (e.g. `<dir>/<name>/SKILL.md`).
  - **Hardcoded origin**: Origin is hardcoded to `"workspace"` on discovered contributions; the `"global"` union member is never generated.

### `loadSkillDirectory` (`src/node/contribution-discovery.ts:149-180`)
- **Current Capabilities**:
  - Loads an arbitrary host-supplied folder containing `<name>/SKILL.md` subdirectories.
  - Deterministic alphabetical sort of directory entries.
  - Symlink containment check on subdirectories and `SKILL.md` files.
  - Enforces byte cap per file (`maxSkillBytes`, defaulting to `HARD_MAX_SKILL_INSTRUCTION_BYTES` = 256 KiB).
  - Skips subdirectories lacking `SKILL.md`.
- **Gaps & Limitations**:
  - Drops the file path: calls `parseSkillFile(text, path)`, but returns `Skill[]` where path information is discarded.
  - Cannot handle flat markdown files (`<name>.md`).

### `parseSkillFile` (`src/contribution-parsing.ts:87-111`) & `Skill` Contract (`src/contracts-core/agent.ts:378-385`)
- **Current Capabilities**:
  - Parses frontmatter delimited by `---` or `...` into `name`, `description`, `toolNames`, and arbitrary `metadata`.
  - Normalizes whitespace in name to hyphens; validates against `^[A-Za-z0-9 _-]+$`.
  - Trims leading newlines from instructions markdown body.
  - Fallback name extracted from parent directory if frontmatter `name` is omitted.
- **Gaps & Limitations**:
  - **`Skill` interface does not include `path`**:
    ```ts
    export interface Skill {
      readonly name: string;
      readonly description?: string;
      readonly instructions?: string;
      readonly context?: readonly ContextProvider[];
      readonly toolNames?: readonly string[];
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
    ```
  - `parseSkillFile(text, path)` accepts `path`, but uses it solely for parent directory fallback naming and diagnostic errors. The constructed `Skill` object never stores `path`.
  - Without `path`, the agent and host cannot locate supporting resources (`references/`, `scripts/`, `assets/`) bundled alongside `SKILL.md`.

### `createLoadSkillTool` & `LoadedSkillSet` Persistence (`src/skill-load.ts:174-224`)
- **Current Capabilities**:
  - Dynamically registers the `load_skill` tool with parameter `name`.
  - Validates skill presence in registry, checks required tools in `activeTools`, enforces 256 KiB instruction cap, and prevents duplicate loads.
  - Clamps output text to `MAX_LOAD_SKILL_RESULT_BYTES` (512 bytes) safely respecting UTF-8 boundaries.
  - Updates `session.loadedSkills` (`LoadedSkillSet`).
  - Checkpoint persistence: `snapshotLoadedSkillBodies` snapshots loaded skill bodies up to 1 MiB total (`HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES`); `applyRestoredSkillBodies` re-applies bodies on resume, ensuring byte-reproducibility even if disk files change.
  - Budget demotion: `demotedBodies` in `src/context-budget.ts` allows demoting loaded skill bodies back to catalog summaries under token budget pressure.
- **Gaps & Limitations**:
  - Tool result text reports only `"Loaded skill \"<name>\"."` — it does not inform the model of the skill directory path, leaving bundled scripts/docs inaccessible.
  - No `unload_skill` tool exists (unloading is host/session clear only).

### `resolveRunSkills` (`src/agent-session/session.ts:646-656`)
- **Current Capabilities**:
  - If `agent.config.skills` is an array: returns `options.skills ?? configured`.
  - If `agent.config.skills` is a `SkillRegistry`:
    - If `options.activeSkills` is provided: resolves skills and validates required tools via `resolveActiveSkills`.
    - If `options.skills` is provided: returns override.
    - If `options.activateAllSkills ?? config.activateAllSkills`: returns `configured.list()`.
    - Otherwise returns `[]`.
- **Critical Gap**:
  - When an agent is configured with a `SkillRegistry` (the default when using SDK planes or discovery), `resolveRunSkills` yields **empty active skills (`[]`)** unless `activeSkills` or `activateAllSkills` is explicitly passed.
  - Neither `agent-sdk` nor `prism-code` currently sets `activateAllSkills` or `activeSkills` during run assembly, meaning discovered skills are **100% inactive by default**.

### Agent SDK `assembleSkillsPlane` & `assembleInstructionsPlane`
- **`assembleSkillsPlane` (`packages/agent-sdk/src/planes/skills.ts`)**:
  - Scans only `workspaceRoot/.agents/skills`.
  - Returns `{ skills: SkillRegistry, discoveredSkills: Skill[] }`.
  - Does not pass `activateAllSkills: true`, resulting in inactive skills upon session run.
  - Does not accept custom discovery roots.
- **`assembleInstructionsPlane` (`packages/agent-sdk/src/planes/instructions.ts`)**:
  - Auto-enables `AGENTS.md` when `workspaceRoot` is set.
  - `systemMd` requires `globalRoot`. Passing `systemMd: true` results in `globalRoot: undefined`, skipping trust policy registration.
  - Only scans a single `AGENTS.md` at workspace root; does not layer global user instructions (`~/.agents/agent/AGENTS.md`, `~/.prism/agent/AGENTS.md`).

---

## 3. Run Limits and Loop Contracts

### `resolveRunLimits`, `DEFAULT_RUN_LIMITS`, and `HARD_RUN_LIMITS` (`src/run-limits.ts:13-130`)
- **Current Capabilities**:
  - 10 distinct limit axes: `maxTurns` (16), `maxProviderAttempts` (24), `maxToolRounds` (8), `maxToolCalls` (32), `maxWallTimeMs` (120,000 ms), `maxRequestBytes` (8 MiB), `maxResponseBytes` (8 MiB), `maxInputTokens` (40,000), `maxOutputTokens` (10,000), `maxTotalTokens` (50,000).
  - Layered narrowing via `minCap(agent, run)`: finite limits narrow; `null` represents "uncapped/disabled" (+$\infty$).
  - `HARD_RUN_LIMITS`: non-negotiable process safety limits (`maxRequestBytes: 64 MiB`, `maxResponseBytes: 64 MiB`) to prevent host OOM on giant JSON frames.
  - Auto-balances `maxProviderAttempts` so attempts are never undercut by a higher `maxTurns`.
  - Resumable limit tracking (`RunLimitTracker`) restores elapsed counters and deadlines.
- **Gaps & Application Requirements**:
  - Narrowing-only: an agent-level limit cannot be relaxed by a run override. Therefore, the application base configuration must set policy limits to `null` to allow autonomous execution.
  - In `packages/prism-code/src/config.ts:664-675`, `limits` and `loop` are parsed from configuration but never passed to `assembleAppAgent` in `headless.ts`.
  - Prism Code must define `PRISM_CODE_DEFAULT_LIMITS` setting all policy axes to `null`, byte limits to `HARD_RUN_LIMITS`, and thread these defaults through headless, TUI, and ACP.

### `StopHook` and `maxStopContinuations` (`src/contracts-core/loop.ts:54-75`)
- **Current Capabilities**:
  - Evaluated serially at natural loop settlement when turns complete normally.
  - `StopHookDecision`: `{ action: "stop" }` or `{ action: "continue", reason: string, steer?: string | Message }`.
  - Returning `continue` re-enters the loop, queuing `reason` and `steer` into the steer queue.
  - `LoopContext.continuation: true` prevents re-evaluating run-start input.
  - `StopHookContext.stopHookActive` distinguishes initial evaluation from continuation cycles.
  - Bounded by `RunLimits.maxStopContinuations` (default 3; `null` disables cap). Cap breach terminates cleanly with `finishReason: "hook_limit"` (resumable, not an error).
- **Gaps & Application Requirements**:
  - Stop hooks do not run on hard limit breaches (`turn_limit`, timeouts).
  - First `continue` decision takes effect; subsequent hooks are skipped.
  - No built-in stop hooks exist for checking task completeness or uncompleted todo items.

---

## 4. Compaction and Context Management

### `autoCompact` and `CompactionTrigger` (`src/agent-session/session.ts:769-800`, `src/agent-session/session/assemble.ts:386`)
- **Current Capabilities**:
  - Supported triggers: `threshold_entries` (entry count), `input_ratio` (ratio of model context cap, $\in (0, 1)$), and `custom`.
  - Lazy estimation: token estimation and context cap resolution only execute if an `input_ratio` or token-reading custom trigger is configured.
  - De-duplicates: skips if the last history entry is already a `"compaction"` record.
  - Preserves trailing input: uncompacts the current turn's active user prompt.
  - Redacts configured secrets in generated summaries.
- **Critical Gap**:
  - **`autoCompact` is invoked strictly once at run start** (`src/agent-session/session/assemble.ts:386`).
  - In an autonomous run executing dozens or hundreds of tool rounds across multiple turns, context accumulates without compaction, eventually causing context window overflow.
  - Core needs a between-turn auto-compaction seam in `tool-round.ts` before assembling subsequent provider turns.

### `toolResultFold`, `contextBudget`, and `createCodingCompactionStrategy`
- **`toolResultFold` (`src/tool-result-fold.ts`)**:
  - Non-destructive projection over transcript history and in-flight tool results.
  - Configurable `minAgeTurns` (default 2), `minBytes` (default 4 KiB), and `maxSummaryBytes` (default 512 B).
  - Preserves original raw outputs in session store while sending folded summaries to provider.
  - Requires host-supplied `summarize` function.
- **`contextBudget` (`src/context-budget.ts`)**:
  - Measures total prompt cost; evicts items until token/byte limits are satisfied.
  - Standard eviction priority: `tool_results` $\to$ `history` $\to$ `summaries` $\to$ `attachments` $\to$ `context` $\to$ `skills` (demote body $\to$ drop).
  - Mutually exclusive with `attentionCompiler` (throws if both configured).
  - Throws `ContextBudgetError` if the mandatory prefix (system instructions + user prompt) exceeds budget.
- **`createCodingCompactionStrategy` (`packages/memory/src/compaction/llm/coding.ts:18`)**:
  - Compaction strategy specialized for code sessions.
  - Preserves file operations, modified paths, test results, and unresolved errors in markdown summaries.
- **Interaction Model**:
  - Layered defense: `toolResultFold` compacts stale tool outputs $\to$ between-turn `autoCompact` summarizes full history when reaching 80% context cap $\to$ `contextBudget` demotes non-essential blocks as a final safety net.

---

## 5. Interactive Tools, Approvals, and Execution Policy

### `ask_user_decision` (`packages/prism-coding-tools/src/agent/ask-user-decision.ts`)
- **Current Capabilities**:
  - Structured elicitation requiring 2+ options with pros and cons.
  - Supports single/multiple selection modes and custom text responses.
  - Supports workflow suspension via `suspendAskUserDecision` and `createAskUserDecisionResumeValidator`.
- **Gaps in Prism Code**:
  - `packages/prism-code/src/headless.ts:88` stubs the tool:
    ```ts
    optInTools.push(createAskUserDecisionTool({ ask: async (req) => ({ selectedId: req.options[0]?.id ?? "opt_1" }) }));
    ```
    Unconditionally picks option 0 in headless mode without prompting or failing closed.
  - Needs connection to TUI interactive picker and a headless guidance fallback ("no interactive user available; proceed with best judgment and state assumptions").

### `coding_check` (`packages/prism-coding-tools/src/agent/checks.ts`)
- **Current Capabilities**:
  - Executes host-declared named check commands with strict sandboxing (minimal PATH, execution timeout, output capping).
- **Gaps in Prism Code**:
  - `packages/prism-code/src/headless.ts:91` stubs the tool:
    ```ts
    optInTools.push(createCodingCheckTool(config.cwd, { checks: { check: { file: "true", args: [] } } }));
    ```
    Always runs `true`, providing zero utility.
  - Tool should only be registered when configuration defines real named checks (`config.checks`).

### Approval Modes and Timeout
- **Current Capabilities**:
  - TUI prompts for approvals via `ApprovalPromptComponent` (`packages/prism-code/src/tui/components/approval.ts`).
  - Supports `allow_once`, `allow_for_run`, `deny`.
- **Gaps in Prism Code**:
  - Hardcoded 60-second auto-deny timeout (`packages/prism-code/src/tui/index.ts:223`, `approval.ts:20`) breaks autonomous overnight or long runs.
  - Headless executes with `executionPolicy: undefined`.
  - No approval modes (`ask`, `accept-edits`, `auto`).
  - No persistent permissions store (`~/.prism/permissions.json`).
  - MCP tools bypass the execution policy unless mapped via `effectForRemoteTool` (`packages/mcp/src/bridge.ts:239-256`).

---

## 6. Trust and Security Model

1. **User-Global Roots (`~/.prism`, `~/.agents`)**:
   - Trust model: **User-owned, trusted**.
   - These paths are local to the current user's profile and owned by UID.
   - Core discovery must never scan `$HOME` implicitly; scanning occurs only when roots are explicitly passed by the application layer.
   - Symlink containment (`isPathInsideReal`) must still be enforced on all global roots to prevent symlink traversal outside user configuration directories.

2. **Repository Roots (`<repo>`)**:
   - Trust model: **Workspace trust**.
   - Subject to existing `TrustPolicy`. Untrusted repositories skip discovery without throwing.
   - Untrusted repos cannot elevate privileges: repo configuration (`<repo>/.prism/prism-code.json`) is forbidden from setting `approval.mode: "auto"`. Only user-global config, flags, or explicit `/approval` commands can enable autonomous approvals.

3. **Execution Safety Invariants**:
   - Hard-denied execution rules (e.g. system directory writes, forbidden binary executions) cannot be bypassed by any approval mode or persisted rule.
   - Permissions file `~/.prism/permissions.json` must be created with `0600` permissions.
   - `HARD_RUN_LIMITS` (64 MiB byte ceilings) remain non-negotiable process-safety boundaries.

---

## 7. Rulings Carried into Tasks 2–8

1. **Task 2 (Core & SDK Discovery Primitives)**:
   - Extend `DiscoveryOptions` with `roots: readonly { dir: string; origin: "global" | "workspace"; layout?: "kind-dir" | "flat" }[]`.
   - Add `path?: string` to `Skill`. Populate via `parseSkillFile`.
   - Update `createLoadSkillTool` to output `Skill directory: <dirname(path)>` on success.
   - Update `SkillsPlaneConfig` in `@arnilo/prism-agent-sdk` to pass `roots` and default `activateAll: true`.
   - Regenerate compat baseline for additive exports (`node scripts/release.mjs gate --update-baseline`).

2. **Task 3 (Prism Code Skills Layering & Commands)**:
   - Always enable skills plane in Prism Code.
   - Resolve 4 roots in ascending precedence: (1) `~/.agents/agent/skills`, (2) `~/.prism/agent/skills`, (3) `skills.dirs`, (4) `<repo>/.agents/agent/skills`, plus compatibility root `<repo>/.agents/skills`.
   - Implement `/skills` and `/skill <name>` commands in TUI. Progressive disclosure default.

3. **Task 4 (Coding-Agent Prompt & Layered Instructions)**:
   - Author standard coding-agent system prompt in `packages/prism-code/src/prompt.ts`.
   - Append dynamic environment block via a volatile context provider to preserve prompt cache stability.
   - Layer instructions: base prompt $\to$ `~/.agents/agent/AGENTS.md` $\to$ `~/.prism/agent/AGENTS.md` $\to$ `<repo>/AGENTS.md`.

4. **Task 5 (Unbounded Run Limits & Flag Overrides)**:
   - Export `PRISM_CODE_DEFAULT_LIMITS` with all policy axes `null` and byte limits set to `HARD_RUN_LIMITS`.
   - Thread `limits` and `loop` configurations through headless, TUI, and ACP.
   - Add `--max-turns` and `--max-cost` CLI flags; support clean SIGINT/SIGTERM shutdown.

5. **Task 6 (Between-Turn Compaction & Context Management)**:
   - Add between-turn auto-compaction hook to `tool-round.ts` evaluating `CompactionTrigger`.
   - Configure Prism Code defaults: `createCodingCompactionStrategy`, `input_ratio: 0.8`, `toolResultFold`, and `contextBudget`.
   - Emit compaction notifications in TUI.

6. **Task 7 (Task-Completion Continuation & Todo Primitives)**:
   - Implement `createTodoWriteTool()` and `createTodoContinuationStopHook()` in `@arnilo/prism-coding-tools`.
   - Register both by default in Prism Code; render live todo card in TUI.
   - Guard against infinite loops with `maxNoProgress` threshold.

7. **Task 8 (Interactive Tools & Tri-Mode Approvals)**:
   - Replace `ask_user_decision` stub with TUI picker and headless fallback.
   - Replace `coding_check` stub with real configured checks.
   - Implement `ask`, `accept-edits`, `auto` modes; persist approved commands to `~/.prism/permissions.json` (`0600`).
   - Unify MCP tools under execution policy; eliminate 60s auto-deny timeout.
