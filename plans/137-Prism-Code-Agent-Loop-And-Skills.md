# Prism Code: Autonomous Agent Loop, Skills, and Instructions

## Objectives

- Let the agent work on its own until the task is complete: no product run limits by default, context kept in bounds by automatic compaction (including between turns of a single long run), and a task-completion continuation so the run does not stop while planned work remains.
- Load skills by default from three layers using the user-specified layout, and keep progressive disclosure: only the skill catalog is in the prompt, and bodies are lazily loaded with `load_skill`.
  ```text
  <repo>/.agents/agent/skills/<skill>/SKILL.md   # project
  ~/.prism/agent/skills/<skill>/SKILL.md         # user (Prism)
  ~/.agents/agent/skills/<skill>/SKILL.md        # user (cross-tool)
  ```
  Each skill folder follows the `.agents/skills/skill-creator/` anatomy: required `SKILL.md` with `name`/`description` frontmatter, plus optional `scripts/`, `references/`, `assets/`, and `agents/openai.yaml`.
- Give the model a real coding-agent system prompt and layered `AGENTS.md` instructions (user-global + repo root).
- Replace the stubbed interactive tools (`ask_user_decision`, `coding_check`) and make approvals compatible with autonomous runs: approval modes, no auto-deny timeout, persisted "always allow", and MCP tools inside the same policy.

## Expected Outcome

- A scripted mock run with 300+ tool rounds and a transcript larger than the model's context window completes without a run-limit error or context overflow; compaction entries appear mid-run.
- A multi-step task that the model plans with `todo_write` keeps running after a premature text-only turn while todo items remain open, and stops cleanly when all items are done/cancelled or no progress is made.
- `/skills` lists skills from all layers with their origin; the model sees only name + description until it calls `load_skill`, after which the body is in the prompt tail and the tool result gives the skill directory so bundled `references/` and `scripts/` are reachable with `read`/`shell`.
- Launching from a repo subdirectory still loads the repo-root `AGENTS.md`, `.agents/agent/skills`, and user-global instructions.
- `ask_user_decision` opens the TUI picker; `coding_check` runs configured checks; approval prompts wait for the user; `/approval` switches between `ask`, `accept-edits`, and `auto`.
- Docs updated: `docs/prism-code.md`, `docs/context-and-skills.md`, `docs/agent-loops.md`, `docs/agent-sdk.md`, `docs/index.md`.
- Depends on: plan 136 (home dir, shared credentials, per-run model selection with catalog limits).

## Recommendation: skill disclosure

Keep progressive disclosure with the existing core `load_skill` tool (`src/skill-load.ts:174`). Do not use eager bodies, and do not rely on the model reading `SKILL.md` with `read` (the pi-style approach).

- **Catalog only.** The prompt catalog carries name and description per skill. It sits in the stable prompt prefix, so it is cache-friendly and costs about one line per skill. The core cap is `DEFAULT_MAX_SKILL_CATALOG_ENTRIES`.
- **Loading a body.** `load_skill` marks the skill loaded, and the body is rendered in the prompt tail from the next turn on. Unlike a `read` result, the body:
  - survives compaction and tool-result folding, because it is not a history message;
  - is persisted and restored on resume (`restoreLoadedSkills`, `restoreLoadedSkillBodies`);
  - is budget-demotable (`demotedBodies`).
- **Bundled resources.** Files in `references/`, `scripts/` and `assets/` stay on disk and are lazily read on demand. The fix needed is to give the model the skill directory: add `Skill.path` and include it in the `load_skill` result.
- **Explicit loading.** A user can force-load with `/skill <name>`. Config `skills.disclosure: "eager"` remains available for small, curated skill sets.

## Tasks

- [x] Task 1 (P0 prerequisite): Primitive review for skills, loop limits, compaction, and stop hooks
  - Acceptance Criteria:
    - Functional: the record at `docs/history/137-primitive-review.md` inventories and states capability and gaps for:
      - `discoverContributions` (`src/node/contribution-discovery.ts`: workspace-only `.agents/<kind>s/`, no global root);
      - `loadSkillDirectory` (`src/node/contribution-discovery.ts:149`), `parseSkillFile`, `Skill` (no path field);
      - `createLoadSkillTool`, `LoadedSkillSet` persistence;
      - `resolveRunSkills` (`src/agent-session/session.ts:646`: a registry yields **no active skills** unless `activeSkills` or `activateAllSkills` is set, and neither agent-sdk nor prism-code sets them);
      - agent-sdk `assembleSkillsPlane` and `assembleInstructionsPlane` (AGENTS.md defaults on when `workspaceRoot` is set; `SYSTEM.md` needs an explicit `globalRoot`);
      - `resolveRunLimits` (`null` disables a policy axis; `HARD_RUN_LIMITS` byte ceilings);
      - `StopHook`/`maxStopContinuations`;
      - `autoCompact`, which runs only at run start (`src/agent-session/session/assemble.ts:386`); `CompactionTrigger` `input_ratio`;
      - `toolResultFold`, `contextBudget`, `createCodingCompactionStrategy`;
      - `createAskUserDecisionTool`/`createAskUserDecisionResumeValidator`, `createCodingCheckTool`, and the prism-code approval policy.
    - Functional: the record decides each generic gap. Expected gaps: (a) multi-root discovery with origin + precedence; (b) optional `Skill.path`; (c) between-turn auto-compaction inside a run; (d) a todo tool + completion stop hook as reusable coding-tools primitives. Each gap names its owning package.
    - Performance: none (review only).
    - Code Quality: app-specific wiring stays in prism-code; only reusable primitives go to core/agent-sdk/coding-tools.
    - Security: the record states the trust model for user-global roots (`~/.prism`, `~/.agents`: user-owned, trusted) vs repo roots (existing workspace trust).
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md`, `docs/agent-loops.md`, `docs/agent-sdk.md`, `docs/hooks.md`
      - Files named above, `src/run-limits.ts:13-130`, `src/contracts-core/{loop,compaction,run-limits}.ts`
      - `.agents/skills/skill-creator/SKILL.md` (skill anatomy)
    - Options Considered:
      - Implement everything inside prism-code. Rejected: discovery roots, skill path, and in-run compaction are generic runtime primitives other hosts need.
    - Chosen Approach: primitive-first review; each later task builds on the recorded decision.
    - API Notes and Examples:
      ```ts
      resolveRunLimits({ maxTurns: null, maxToolCalls: null, maxWallTimeMs: null }); // null = axis disabled
      ```
    - Files to Create/Edit:
      - `docs/history/137-primitive-review.md`
    - References:
      - Analysis section 4 and 5; create-plan rule 6
  - Test Cases to Write:
    - none — review only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/137-primitive-review.md` (history archive).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Core and SDK primitives: multi-root skill discovery and `Skill.path`
  - Acceptance Criteria:
    - Functional: `DiscoveryOptions` gains `roots?: readonly { dir: string; origin: "global" | "workspace"; layout?: "kind-dir" | "flat" }[]`. `kind-dir` scans `<dir>/<kind>s/<name>/`; `flat` scans `<dir>/<name>/`, so a caller can pass `~/.prism/agent/skills` directly. Precedence: later roots override earlier ones by `kind/name` (the existing `Map` merge). `workspaceRoot` keeps its current meaning and is appended last.
    - Functional: `Skill` gains optional `readonly path?: string` (absolute `SKILL.md` path), set by `parseSkillFile(text, path)` and therefore by discovery and `loadSkillDirectory`. `createLoadSkillTool` appends `Skill directory: <dirname(path)>` to its success text when `path` is present (still within `MAX_LOAD_SKILL_RESULT_BYTES`).
    - Functional: agent-sdk `SkillsPlaneConfig` gains `roots` (passed through, each root trusted explicitly) and `activateAll?: boolean` (default `true` when any skill is registered), which sets `AgentConfig.activateAllSkills`, so discovered skills actually render.
    - Performance: one `readdir` per root; no recursion; unchanged caps (`HARD_MAX_SKILL_INSTRUCTION_BYTES`, catalog cap).
    - Code Quality: additive, backward-compatible types; no behavior change for callers passing only `workspaceRoot`.
    - Security: every root keeps realpath containment (`isPathInsideReal`); a global root is scanned only when passed explicitly (the core still never scans `$HOME` on its own); an untrusted root is skipped, not thrown. Plan the compat-baseline regeneration: run `node scripts/release.mjs gate --update-baseline`, update `scripts/compat-baseline/*` for the additive `Skill.path`/`DiscoveryOptions.roots`/`SkillsPlaneConfig` fields, and record the `release:gate` diff (no removals).
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts:13-110`, `src/contribution-parsing.ts:87-111`, `src/skill-load.ts:174-215`, `packages/agent-sdk/src/planes/skills.ts`
    - Options Considered:
      - Put the path in `Skill.metadata`. Rejected: stringly-typed and collides with frontmatter keys.
      - A separate "global discovery" function. Rejected: two scanners drift; one `roots` list with precedence is simpler.
    - Chosen Approach: additive `roots` + `path`, with activation fixed in the SDK plane.
    - API Notes and Examples:
      ```ts
      await discoverContributions({
        kinds: ["skill"],
        roots: [
          { dir: join(home, ".agents", "agent", "skills"), origin: "global", layout: "flat" },
          { dir: join(home, ".prism", "agent", "skills"), origin: "global", layout: "flat" },
          { dir: join(repo, ".agents", "agent", "skills"), origin: "workspace", layout: "flat" },
        ],
        trust,
      });
      ```
    - Files to Create/Edit:
      - `src/node/contribution-discovery.ts`: `roots`, `flat` layout
      - `src/contribution-parsing.ts`: set `path`
      - `src/contracts-core/agent.ts`: `Skill.path`
      - `src/skill-load.ts`: directory in result text
      - `packages/agent-sdk/src/planes/skills.ts`, `packages/agent-sdk/src/define-agent.ts`, `packages/agent-sdk/src/config.ts`: `roots`, `activateAll`
      - tests under `src/__tests__/` and `packages/agent-sdk/src/__tests__/`
      - `scripts/compat-baseline/*` via `node scripts/release.mjs gate --update-baseline`
    - References:
      - Task 1 record
  - Test Cases to Write:
    - Three roots with a colliding skill name: the later root wins; origins are reported.
    - `flat` vs `kind-dir` layouts; a symlink escaping a root is skipped.
    - `parseSkillFile` sets `path`; the `load_skill` success text includes the directory and stays ≤ 512 bytes.
    - The SDK plane with discovered skills renders a catalog on the first run without `activeSkills` (regression for the `resolveRunSkills` empty result).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new discovery option, `Skill.path`, SDK skills-plane fields.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: multi-root discovery, `Skill.path`, `load_skill` result
      - `docs/agent-sdk.md`: skills plane `roots`/`activateAll`
    - `docs/index.md` update: yes — Context and skills entry mentions multi-root discovery.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Prism Code skills: default-on layers, progressive loading, and commands
  - Acceptance Criteria:
    - Functional: the skills plane is always on (no longer gated on `config.skills`, `headless.ts:107`). Roots in increasing precedence:
      1. `~/.agents/agent/skills`
      2. `~/.prism/agent/skills` (`PRISM_HOME` honored)
      3. each `skills.dirs` entry (now implemented; previously parsed but unused)
      4. `<repo>/.agents/agent/skills`

      `<repo>` is the git root of `cwd` (fallback `cwd`).
    - Functional: **open decision (confirm before implementation):** also scan the existing `<repo>/.agents/skills` layout, which core discovery uses today, this repository's own skills use, and other agents use, as a compatibility root directly below `<repo>/.agents/agent/skills`. The default proposed here is on, with `skills.compat: false` to disable.
    - Functional: `load_skill` is registered by default with disclosure `progressive`; `skills.disclosure: "eager"` switches to eager; `skills.exclude` still filters by name.
    - Functional: `/skills` lists name, origin (project/prism/agents/config), loaded state, and path; name collisions show which layer won. `/skill <name>` force-loads a skill for the session (via the session loaded set) and confirms.
    - Functional: wiki skills keep working as additions.
    - Performance: discovery ≤ 4 `readdir` calls + one read per `SKILL.md` at startup; catalog size bounded by the core cap, with a notice when truncated.
    - Code Quality: root computation in one helper, `resolveSkillRoots(config, home, repoRoot)`; no duplicate discovery code in the app.
    - Security: user-global roots are trusted by ownership (must be owned by the current user); repo roots use the existing workspace trust; skill `scripts/` are never executed automatically, and running them goes through `shell` and the approval policy (Task 8).
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/skill-creator/SKILL.md` (anatomy and progressive-disclosure principle), `packages/prism-code/src/{headless,config}.ts`, Task 2 APIs
    - Options Considered:
      - Eager bodies. Rejected as the default: prompt bloat grows with the skill count.
      - Model reads `SKILL.md` via `read`. Rejected: bodies are lost to compaction/folding and have no loaded-state persistence.
    - Chosen Approach: progressive disclosure with `load_skill` + skill directory in the result (see "Recommendation: skill disclosure").
    - API Notes and Examples:
      ```json
      { "skills": { "dirs": ["./team-skills"], "exclude": ["legacy-skill"], "disclosure": "progressive" } }
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/skills.ts`: new `resolveSkillRoots`, `/skills` and `/skill` commands
      - `packages/prism-code/src/headless.ts`: always-on skills plane, `load_skill` tool
      - `packages/prism-code/src/config.ts`: `skills.disclosure`, `skills.compat`
      - `packages/prism-code/src/tui/commands.ts`: register commands
      - `packages/prism-code/src/__tests__/skills.test.ts`
    - References:
      - Analysis section 5; user layout decision (this plan's Objectives)
  - Test Cases to Write:
    - Skills in each of the four roots appear with the correct origin; precedence on collision.
    - Launch from a subdirectory resolves `<repo>` to the git root.
    - Progressive: the first provider request contains the catalog line but not the body; after `load_skill`, the next request contains the body; the result contains the skill directory.
    - `/skill <name>` preloads; `/skills` output lists loaded state.
    - Resume restores loaded skills.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default skill loading, new config keys and commands.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Skills" section (layout, precedence, disclosure, commands)
    - `docs/index.md` update: yes — Prism Code entry mentions layered skills.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Coding-agent system prompt and layered instructions
  - Acceptance Criteria:
    - Functional: Prism Code ships a base system prompt (a TypeScript string constant, so no asset copy is needed in the build) covering:
      - role;
      - tool-use conventions (read before edit, prefer `edit` over `write`, run checks);
      - autonomy ("keep working until the task is complete; use `todo_write` for multi-step work; ask with `ask_user_decision` only when blocked");
      - safety rules;
      - output style.
    - Functional: an environment block is appended: cwd, repo root, OS/platform, shell, date, git branch/dirty state, and the active model id. It is rebuilt per run, so model/branch changes show up.
    - Functional: instruction layers, all trust-gated through the SDK instructions plane: base prompt → `~/.agents/agent/AGENTS.md` → `~/.prism/agent/AGENTS.md` → `<repo>/AGENTS.md` (git root, not `cwd`). `instructions.systemMd` or `~/.prism/agent/SYSTEM.md` replaces the base prompt when present. `--no-agents-md` and `--no-system-md` keep working.
    - Performance: the base prompt + environment block ≤ 2 KB; prompt-prefix stability is preserved (the environment block lives in the tail/volatile layer so the cache prefix stays stable across runs).
    - Code Quality: the prompt lives in `src/prompt.ts` with a test snapshot; there is no prompt text inside TUI code.
    - Security: `AGENTS.md`/`SYSTEM.md` from untrusted repos follow the existing workspace trust rules; no secrets or env values other than the listed fields enter the prompt.
  - Approach:
    - Documentation Reviewed:
      - `packages/agent-sdk/src/planes/instructions.ts:5-60`, `docs/agent-sdk.md` instructions plane, `docs/context-and-skills.md` (prefix stability), `src/testing/prefix-stability-conformance.ts`
    - Options Considered:
      - Rely on `AGENTS.md` only (current state). Rejected: a bare model has no tool-use conventions.
      - Put the environment block in the system prefix. Rejected: it breaks prompt caching whenever the branch/date changes.
    - Chosen Approach: stable base prompt in the prefix; volatile environment block via a context provider.
    - API Notes and Examples:
      ```ts
      instructions: { text: CODING_SYSTEM_PROMPT, agentsMd: true, systemMd: { globalRoot: join(home, "agent") } },
      context: [createEnvironmentContextProvider({ repoRoot })]
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/prompt.ts`: new base prompt + environment context provider
      - `packages/prism-code/src/headless.ts`: wire instructions/context, repo-root detection
      - `packages/prism-code/src/__tests__/prompt.test.ts`
    - References:
      - Analysis finding "no base coding-agent system prompt"
  - Test Cases to Write:
    - The first provider request includes the base prompt, global AGENTS.md, repo AGENTS.md (launched from a subdir), and the environment block.
    - `SYSTEM.md` replaces the base prompt; `--no-agents-md` drops the AGENTS layers.
    - Prefix hash is unchanged across two runs on different branches (only the tail differs).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default prompt and instruction layering.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Instructions" section
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Unbounded run limits by default, with config and flag overrides
  - Acceptance Criteria:
    - Functional: the Prism Code default `limits` are every policy axis `null`: `maxTurns`, `maxProviderAttempts`, `maxToolRounds`, `maxToolCalls`, `maxWallTimeMs`, `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, and `maxStopContinuations`. The byte axes are set to the `HARD_RUN_LIMITS` ceilings (64 MiB request/response). This applies to TUI, headless, and ACP.
    - Functional: the config `limits` object (previously parsed but dropped) is validated (non-negative integers or `null`; `maxCost` `{ amount, currency }`) and threaded into `AgentConfig.limits`. The config `loop` key is threaded as well, including `toolConcurrency` for parallel independent tool calls. The flags `--max-turns <n>` and `--max-cost <amount>` narrow per invocation.
    - Functional: the user stays in control: Esc aborts the current run (existing), Ctrl+C twice exits, and headless handles SIGINT/SIGTERM by aborting the run and exiting 130/143 after persisting the session.
    - Functional: provider transient failures (429/5xx/network) are retried with backoff (existing provider retry policy verified under `maxProviderAttempts: null`), so long runs survive rate limits.
    - Performance: no per-turn overhead added; the run-limit tracker with `null` axes does no accounting work beyond existing counters.
    - Code Quality: defaults live in one exported constant, `PRISM_CODE_DEFAULT_LIMITS`, documented and tested.
    - Security: the unbounded default is documented with its cost trade-off (one line in `docs/prism-code.md`: unbounded runs can spend without a cap; set `limits.maxCost` or `--max-cost` to bound it). A configured `maxCost` stops the run cleanly with a finish reason, not a crash.
  - Approach:
    - Documentation Reviewed:
      - `src/run-limits.ts:13-130` (`DEFAULT_RUN_LIMITS`, `HARD_RUN_LIMITS`, `resolveRunLimits`, `null` semantics), `src/contracts-core/run-limits.ts`, `docs/agent-loops.md`
      - `packages/prism-code/src/config.ts:664-675` (parsed `loop`/`limits`), `packages/agent-sdk/src/define-agent.ts:79,237`
    - Options Considered:
      - Very large finite numbers. Rejected: `null` is the documented "axis disabled" value and avoids arbitrary magic numbers.
      - Keep core defaults and ask users to configure. Rejected per user direction (run until complete).
    - Chosen Approach: explicit `null` defaults at the app layer; core defaults unchanged for other hosts.
    - API Notes and Examples:
      ```ts
      export const PRISM_CODE_DEFAULT_LIMITS: RunLimits = {
        maxTurns: null, maxProviderAttempts: null, maxToolRounds: null, maxToolCalls: null,
        maxWallTimeMs: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null,
        maxStopContinuations: null, maxRequestBytes: HARD_RUN_LIMITS.maxRequestBytes, maxResponseBytes: HARD_RUN_LIMITS.maxResponseBytes,
      };
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/limits.ts`: new defaults + config validation
      - `packages/prism-code/src/{config,headless,acp,flags}.ts`: thread `limits`/`loop`, new flags, signal handling
      - `packages/prism-code/src/__tests__/limits.test.ts`
    - References:
      - User decision: "run limits should be as large as possible"
  - Test Cases to Write:
    - A mock run of 100 tool rounds and 40 minutes of simulated wall time (fake clock) completes without `RunLimitError`.
    - Config `limits.maxTurns: 5` narrows; `--max-turns 3` narrows further; `null` in config disables an axis.
    - `--max-cost` stops cleanly with a finish reason.
    - Headless SIGTERM aborts, persists the session, and exits 143.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default limits, new flags, `limits`/`loop` now honored.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Run limits" section with the cost trade-off line
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Context management for long runs: between-turn auto-compaction, tool-result folding, and a budget
  - Acceptance Criteria:
    - Functional: core gains between-turn auto-compaction. Before assembling each provider turn after the first within a run, the session evaluates the same `CompactionTrigger` used at run start (`autoCompact`). When it fires, the session compacts the branch at the turn boundary (after tool results are appended, never between a tool call and its result) and continues the run with the compacted history. Durable run state/checkpoints remain consistent (a resumed run after a mid-run compaction continues from the compacted branch).
    - Functional: Prism Code enables compaction by default:
      - `createCodingCompactionStrategy` using the current selection (plan 136 Task 7);
      - trigger `{ type: "input_ratio", ratio: 0.8 }` against the model's context window;
      - `toolResultFold` enabled for old large tool outputs;
      - a `contextBudget` so assembly demotes rather than overflows.

      Config `compaction: false | { ratio, keepRecentEntries }` overrides.
    - Functional: compaction events are emitted and shown in the TUI as a system note ("Compacted N entries").
    - Performance: the trigger check is estimate-only (no provider call) and adds ≤ 1 ms per turn at 1k entries; compaction runs at most once per turn.
    - Code Quality: mid-run compaction reuses `compactBranch`; no second compaction code path. Behavior is opt-in for other hosts: it activates only when `compaction.trigger` is configured, matching the existing run-start gate.
    - Security: the compaction summary goes through the existing redaction (`CompactionContext.secrets`); compaction failure falls back to continuing uncompacted with a warning (the context budget still demotes) and never drops the in-flight tool-call pair.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts:769-800` (`autoCompact`, `compactBranch`), `src/agent-session/session/assemble.ts:386`, `src/agent-session/session/tool-round.ts`
      - `src/contracts-core/compaction.ts` (`CompactionTrigger`), `src/tool-result-fold.ts`, `src/context-budget.ts`, `packages/memory/src/compaction/llm/coding.ts:18`
      - `docs/compaction-and-retry.md`, `docs/compaction-llm.md`
    - Options Considered:
      - Run-start compaction only (current). Rejected: a single unbounded run outgrows the context window.
      - Only context-budget demotion. Rejected: silently drops history the model may need; summaries preserve it.
    - Chosen Approach: reuse the trigger + `compactBranch` at turn boundaries, with fold + budget as safety nets.
    - API Notes and Examples:
      ```ts
      compaction: { strategy: createCodingCompactionStrategy({ provider, model }), trigger: { type: "input_ratio", ratio: 0.8 }, keepRecentEntries: 8 },
      toolResultFold: { /* defaults */ },
      ```
    - Files to Create/Edit:
      - `src/agent-session/session/tool-round.ts` / `src/agent-session/session.ts`: between-turn compaction hook
      - `src/agent-session/session/types.ts`: host interface addition
      - `packages/prism-code/src/headless.ts`, `packages/prism-code/src/config.ts`: defaults and `compaction` config key
      - `src/__tests__/mid-run-compaction.test.ts`, `packages/prism-code/src/__tests__/long-run.test.ts`
    - References:
      - Task 1 record gap (c)
  - Test Cases to Write:
    - A scripted run exceeds 0.8 × the context window at turn N → a compaction entry is written between turns, and turn N+1's request is smaller than the cap.
    - A tool call/result pair is never split by compaction.
    - Durable resume after a mid-run compaction continues correctly.
    - Compaction provider failure → warning + continued run.
    - Hosts without `compaction.trigger` see no behavior change (existing tests stay green).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — core compaction now also runs between turns when a trigger is configured.
    - Docs pages to create/edit:
      - `docs/compaction-and-retry.md`: between-turn trigger semantics
      - `docs/prism-code.md`: "Long runs and compaction" section
    - `docs/index.md` update: yes — compaction entry mentions between-turn auto-compaction.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7: Task-completion continuation: `todo_write` tool and completion stop hook
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-coding-tools/agent` adds `createTodoWriteTool()`, a `todo_write` tool that replaces the full list `{ todos: [{ id, content, status: "pending" | "in_progress" | "completed" | "cancelled" }] }` and returns the rendered list. It is stateless: the current list is the latest successful `todo_write` result in the history, so it survives resume and compaction (the compaction summary includes the latest list).
    - Functional: `createTodoContinuationStopHook({ maxNoProgress = 2 })` is also added. When the loop would end and the latest list has `pending`/`in_progress` items, it returns `continue` with a steer listing the open items ("Continue with the remaining items, or mark them completed/cancelled with a reason"). It stops when all items are closed, when no todo list exists, or after `maxNoProgress` consecutive continuations with no new tool calls and no todo change. In the last case the TUI shows a system note "Stopped: no progress on open todos".
    - Functional: Prism Code registers both by default (config `loop.continueOnOpenTodos: false` disables); the TUI renders the todo list as a live panel/card.
    - Performance: the stop hook scans history backwards only to the latest `todo_write` result (O(1) amortized); no provider calls.
    - Code Quality: tool and hook are reusable coding-tools primitives with tests; the app only wires them.
    - Security: the steer text contains only todo content authored by the model; the hook never escalates approval mode; user Esc abort always wins over continuation.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/loop.ts:54-75` (`StopHook`, `StopHookDecision`), `docs/hooks.md`, `docs/agent-loops.md`, `src/run-limits.ts` (`maxStopContinuations`)
      - `packages/prism-coding-tools/src/agent/index.ts` (tool factory conventions)
    - Options Considered:
      - An LLM judge "is the task complete?" stop hook. Rejected: extra cost per stop and unreliable; todo state is explicit and cheap.
      - A stateful todo store. Rejected: stateless history-derived state is resume/compaction-safe for free.
    - Chosen Approach: explicit model-maintained todo list + deterministic stop hook with a no-progress guard.
    - API Notes and Examples:
      ```ts
      tools: { add: [createTodoWriteTool()] },
      stopHooks: [createTodoContinuationStopHook({ maxNoProgress: 2 })],
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/agent/todo.ts`: new tool + stop hook
      - `packages/prism-coding-tools/src/agent/index.ts`: exports
      - `packages/prism-code/src/{headless,tools,limits}.ts`: wiring, `loop.continueOnOpenTodos`
      - `packages/prism-code/src/acp.ts`: stop hook on the ACP agent
      - `packages/prism-code/src/tui/{components/todo.ts,reducer.ts,index.ts}`: new panel and wiring
      - `packages/prism-coding-tools/src/agent/__tests__/todo.test.ts`, `packages/prism-code/src/__tests__/todo-continuation.test.ts`
      - `packages/prism-code/src/__tests__/tools.test.ts`: default-on set is now 10 tools
      - `docs/coding-tools.md`, `docs/coding-agent-tools.md`, `docs/prism-code.md`, `docs/index.md`
      - `scripts/compat-baseline/*` via `node scripts/release.mjs gate --update-baseline` (additive coding-tools exports); record the gate diff
    - Execution notes:
      - `resolveContinueOnOpenTodos(config.loop)` lives in `limits.ts` (the validator there already owns `loop` keys); `config.ts` needed no change.
      - The stop hook reaches TUI + headless through `RunOptions.stopHooks` merged in the existing `assembleAppAgent` `createSession().run()` wrapper; agent-sdk has no programmatic root `stopHooks` config, and `session.run` was already wrapped for `maxCost`. ACP passes `AgentConfig.stopHooks` directly because it builds its agent with `createAgent`.
      - `todo_write` is default-on in `resolveCodingToolSet` (new `plan` tool category), which covers ACP; headless adds it through the coding-preset `tools.add` list, so both surfaces match.
      - The no-progress note is surfaced through `TodoContinuationStopHook.onNoProgressStop`, which the TUI sets to `notify("Stopped: no progress on open todos")` in `start()`.
      - Gate diff: `arnilo__prism-coding-tools.txt` gains the todo exports/limits; `arnilo__prism-core.txt`, `arnilo__prism-work.txt`, and `arnilo__prism.txt` carry pre-existing in-flight package work (no removals).
    - References:
      - User direction: run until the task is complete
  - Test Cases to Write:
    - Open items + text-only turn → continuation with a steer; all items completed → stop.
    - Two no-progress continuations → stop with a note.
    - Resume mid-task restores the list from history.
    - Esc during a continuation aborts.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new coding-tools exports and default Prism Code loop behavior.
    - Docs pages to create/edit:
      - `docs/coding-tools.md`: `todo_write` + stop hook
      - `docs/prism-code.md`: "Autonomy" section
    - `docs/index.md` update: yes — Tools entry lists `todo_write`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8: Interactive tools and approval modes for autonomous runs
  - Acceptance Criteria:
    - Functional: `ask_user_decision` is wired to the TUI picker (the run pauses until answered; Esc returns a "user declined" result). It is registered by default in the TUI. In headless it returns "no interactive user available; proceed with your best judgment and state the assumption" instead of the first option (`headless.ts:88` stub removed).
    - Functional: `coding_check` is registered only when config `checks` defines named commands (`{ "checks": { "test": { "command": "bun", "args": ["test"] } } }`); the `true` stub (`headless.ts:91`) is removed.
    - Functional: approval modes:
      - `ask` (default: prompt for shell, mutations outside the repo, and destructive git);
      - `accept-edits` (auto-allow file edits inside the repo, prompt for shell);
      - `auto` (allow everything except hard-denied security rules).

      Mode is set via config `approval.mode`, `/approval <mode>`, and the footer indicator. There is no approval timeout by default (config `approval.timeoutMs` optional), replacing the 60 s auto-deny (`tui/index.ts:187`).
    - Functional: "Always allow" persists per repo to `~/.prism/permissions.json`, keyed by canonical repo root and scoped by tool name plus, for `shell`, a command prefix. `/permissions` lists and revokes entries.
    - Functional: MCP tools go through the same policy. Their effect comes from the bridge's `ToolEffectDeclaration` (`McpToolEffectPolicy` / `effectForRemoteTool`, `packages/mcp/src/bridge.ts:239-256`). Read-only only when the server binding's configured effect policy says so; otherwise the tool is treated as mutating.
    - Functional: headless flag `--approve <deny|edits|all>` (default `deny`: approval-required calls are refused with a message the model sees and the session exit code reflects refusals).
    - Performance: policy evaluation is synchronous and O(rules); persisted rules are loaded once per launch.
    - Code Quality: one policy module shared by TUI/headless/ACP; ACP keeps delegating to the client's permission request.
    - Security: `auto` mode is visible in the footer at all times; hard-deny rules (existing execution security) cannot be overridden by any mode or persisted rule; the permissions file is `0600`; a repo config cannot set `approval.mode: "auto"` (only the global config, flags, or `/approval` can), so a cloned repo cannot grant itself autonomy.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-coding-tools/src/agent/{ask-user-decision,checks,execution-policy}.ts`, `packages/prism-code/src/tui/components/approval.ts`, `packages/prism-code/src/headless.ts:80-95`
      - `packages/mcp/src/bridge.ts` (`McpToolEffectPolicy`, `effectForRemoteTool`)
    - Options Considered:
      - Keep per-call approvals only. Rejected: incompatible with long autonomous runs.
      - Global "yolo" flag only. Rejected: too coarse; `accept-edits` is the common middle ground.
    - Chosen Approach: three modes + persisted scoped rules + MCP inclusion, with repo config unable to escalate.
    - API Notes and Examples:
      ```json
      { "approval": { "mode": "accept-edits" }, "checks": { "test": { "command": "bun", "args": ["test"] } } }
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/approval.ts`: new policy module + permissions store
      - `packages/prism-code/src/{headless,tools,config,flags,acp}.ts`: wiring
      - `packages/prism-code/src/tui/{index,commands}.ts`, `src/tui/components/{approval,status}.ts`, `src/tui/reducer.ts`: modes, `/approval`, `/permissions`, picker for `ask_user_decision`
      - `packages/prism-code/src/__tests__/approval.test.ts`
      - `packages/agent-sdk/src/planes/mcp.ts`: `readOnly` server binding → `effect.kind: "none"`; `executionPolicy` wraps non-read-only bridged tools
      - `packages/prism-code/bin/prism-code.ts`: `--approve`, approval controller wiring, ask-user picker binding
      - `docs/prism-code.md`, `docs/coding-agent-tools.md`
    - Execution notes:
      - The policy module owns the mode, the per-run approval memo (previously `createCodingApprovalPolicy`'s run cache), and the `~/.prism/permissions.json` store; hard denies come from `evaluateCommandRules` before any mode/rule is consulted. `ask` prompts for shell, in-repo edits, outside-workspace mutations, and destructive git; `accept-edits` auto-allows in-repo edits and prompts for shell/git; `auto` skips prompts but keeps hard denies and denies outside-root mutations.
      - MCP approval is wired in the SDK plane: a server spec's `readOnly: true` maps to the bridge effect policy `() => ({ kind: "none", idempotency: "none" })`; `applyMcpApprovalPolicy` wraps every other bridged tool with the shared policy. ACP keeps the client permission request (`interruptBeforeTool`) as the human-approval path and uses the shared policy in `auto` mode for hard denies + path containment.
      - `ask_user_decision` is now default-on (TUI picker via `assembleAppAgent` host bindings; headless/ACP guidance result); `coding_check` registers only when `checks` declares commands. The old first-option/`true` stubs are gone.
      - A project `prism-code.json` rejects `approval.mode: "auto"` at layer validation; the global config, `--approve`, and `/approval` can set it. `formatFooterRight` now renders the mode at every width (`auto` as `approvals:AUTO`).
      - Gate diff: new `arnilo__prism-agent-sdk.txt`/`arnilo__prism-code.txt` baselines now cover the added exports (no removals).
    - References:
      - Analysis findings: `ask_user` stub, `coding_check` stub, MCP bypasses approval, headless has no policy
  - Test Cases to Write:
    - `ask_user_decision` resolves with the TUI selection; headless returns the guidance result.
    - `accept-edits` allows `edit` inside the repo and prompts for `shell`.
    - "Always allow `bun test`" persists and applies after restart; `/permissions` revokes it.
    - An MCP tool without a read-only effect policy prompts in `ask` mode.
    - A repo `prism-code.json` with `approval.mode: "auto"` is rejected.
    - Headless `--approve deny` refuses shell and reports it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — approval modes, new config keys, flags, and commands.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Approvals and permissions" section
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9: Long-run verification and docs pass
  - Acceptance Criteria:
    - Functional: an offline e2e scenario (scripted mock provider) runs 300 tool rounds with a growing transcript beyond the context window. It asserts: no run-limit error, ≥ 1 mid-run compaction, a todo continuation after a premature stop, skills loaded from all layers via `load_skill`, and a clean final stop.
    - Functional: the live matrix gains one gated real-provider task ("create a file, write a test, make it pass") that must finish with a green check run.
    - Functional: package tests, `bun run build`, and `release:gate` are green; compat baseline diffs from Tasks 2 and 7 are recorded.
    - Performance: record per-turn assembly time at 300 turns in the task note (target: no super-linear growth after compaction).
    - Code Quality: the e2e scenario lives beside the existing coding-journey e2e.
    - Security: the scenario includes a denied shell command in `ask` mode and asserts the refusal reaches the model.
  - Approach:
    - Documentation Reviewed:
      - `scripts/e2e-coding-journey.test.mjs`, `.github/workflows/coding-journey.yml`, `src/mock-provider.ts`
    - Options Considered:
      - Only unit tests. Rejected: the loop behaviors interact (compaction × continuation × skills).
    - Chosen Approach: one deterministic long-run e2e + one gated live task.
    - API Notes and Examples:
      ```bash
      bun test scripts/e2e-prism-code-long-run.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/e2e-prism-code-long-run.test.mjs`: new (registered in `scripts/run-all-tests.mjs` GATE_FILES)
      - `scripts/e2e-prism-code-live.test.mjs`: add the live task (file from plan 136 Task 8)
      - `scripts/live-matrix.json`, `.github/workflows/live-matrix.yml`: document and wire `PRISM_LIVE_PRISM_CODE_TASK`
      - `docs/prism-code.md`, `docs/agent-loops.md`: consistency pass
      - `src/agent-session/session.ts`, `packages/prism-code/src/{compaction,providers,headless}.ts`, PR-code test fetch stubs: fixes the e2e surfaced
      - `scripts/budgets.json`: diet/export-count rebaseline with reasons
    - Execution notes:
      - **Offline e2e** (`scripts/e2e-prism-code-long-run.test.mjs`): a scripted provider drives the real `assembleAppAgent` loop through 300 batched `read` rounds (raw transcript ~500KB against a 48k window) with one skill per layer, one `todo_write` plan, a premature text-only stop, a `shell` probe refused by the `ask` policy, and a completed list plus a final text turn. Measured: 37 model turns, 8 mid-run compactions, 9 summarizer calls, 0 failures, transcript messages bounded at 65–87, `status: "succeeded"` / `text: "All done."` with no run limit. Per-turn assembly time (provider start-to-start, loaded host): first-10 mean 32.6ms, last-10 mean 113.3ms, max 238.7ms — bounded growth after compaction (first 10 turns run below the compact trigger). The scenario asserts the transcript actually shrinks (message-count peak/min), so a compaction that only emits an event fails the test.
      - **Live task leg** (opt-in `PRISM_LIVE_PRISM_CODE_TASK=1`, wired in `.github/workflows/live-matrix.yml`): the agent creates a source file, writes its test, and must finish with a green named `coding_check` (exit 0); the test also asserts both files exist on disk and secret-scans the transcript. Provider 401/403 skips the leg.
      - **Core fixes the e2e surfaced:**
        - `RuntimeAgentSession.rebuildHistory()` / `autoCompact()` replaced `session.history` with a fresh array mid-run, so the loop kept appending to its own copy (`ctx.history`). Post-compaction turns never reached `session.history`: `AgentRunResult.text/content/message` came back empty and `lastAssistantText` consumers saw stale data. Both now use a private `replaceHistory()` that mutates the live array in place.
        - Compaction resilience was moved out of the `assemble.ts` call sites into `compactBranchResilient()`: strategy/summarizer failures emit `compaction_failed` and the run continues uncompacted, while an unresolvable `input_ratio` cap still fails loudly (the plan 074 config-error contract). The e2e had exposed the opposite ordering.
        - Default coding compaction now derives its keep budget from the window (`min(20k, window/2)`); the strategy's fixed 20k default could exceed a small trigger and turn every compaction into a no-op that still paid for a summarizer call. A default `input_ratio` trigger on a model without a usable input cap falls back to a 20k-token trigger instead of failing the run; an explicitly configured `input_ratio` still fails closed.
        - `enrichModelConfig()` early-returned for any model carrying `capabilities`, so live-discovered models (capabilities, no limits) reached core without limits and crashed the cap-resolving trigger. It now fills missing limits from the catalog (or assumed limits), and `assembleAppAgent` enriches per-run models so every run carries limits.
      - **Budget rebaseline** (`scripts/budgets.json`, both with dated reasons): root `unpackedBytes` 4,891,358 → 5,211,948 (+6.6%, regenerated compat baselines plus plan 136/137 docs/dist; packed +2.6% and fileCount +3.6% stayed inside their bands), `@arnilo/prism` export count 1,474 → 1,475 (`capToolResultSummary`, plan 137 Task 6).
      - **Verification:** `bun run test` all 9 stages green (build; performance budget; root suites 2147 pass; sqlite; gate suites 313 tests incl. the new e2e; build race; workspace suites; examples; branch coverage 86.4%). `node scripts/release.mjs gate` reports no compat diff, so the Task 2/7 baselines stand as recorded. `docs/_evidence/phase54-package-map.md` and `docs/live-testing.md` regenerated.
      - **Follow-up from the long run, implemented:** the todo list is read back from the latest `todo_write` tool result, so a compaction cut that dropped that entry made a premature stop end the run without continuing. `todoPinnedEntryIds(entries)` now reports the latest plan turn — the assistant call plus every tool entry of that turn, so a pinned result never travels without its call — and `resolvePrismCodeCompaction` wraps the chosen strategy (coding and OM) to merge those ids into every compaction's kept entries. A long run that writes its plan once keeps reading it after any number of cuts. The e2e became the regression test: the plan is written once and never re-emitted, the premature stop only fires once a compaction is visible in the request, and the test asserts the open plan still sits in the transcript next to the summary (`planSurvivedCut`) and that the continuation steer arrives. Disabling the pin makes the e2e fail at the first post-stop assertion (verified by temporarily returning the strategy unchanged).
      - **Keep budget is now host-tunable:** `compaction.keepRecentTokens` sets the coding strategy's recent-token budget (validated as a non-negative safe integer), still capped at half the model window so a cut point always exists. The long-run test covers all four shapes: the derived default on a 4k window, a tighter budget cutting one more entry, a larger value clamped by the window, and the same value honored as-is on a wide window. `keepRecentEntries` remains the OM/entry-count knob.
    - References:
      - Tasks 2–8
  - Test Cases to Write:
    - The e2e scenario above and the gated live task (both implemented; the e2e runs in the default `bun run test` gate list).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: consistency pass on `docs/prism-code.md` and `docs/agent-loops.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- The core history fix mutates the live array in place instead of reworking the loop/`activeLoopHistory` ownership model — the smallest change that keeps every holder of the history in sync after a mid-run compaction.
- The root tarball's unpacked-size ceiling was rebaselined (5,211,948, dated reason) rather than trimming the regenerated compat baselines or docs/history, which are deliberate shipped traceability.
- The offline e2e batches 10 tool rounds per model turn (300 rounds in 37 turns) to keep the default test chain fast; the assertions cover rounds, not turn counts.
- The live create-file/write-test task is opt-in (`PRISM_LIVE_PRISM_CODE_TASK=1`) because it costs a full agent run; the workflow sets the flag so the scheduled matrix regenerates the evidence.
- Prism Code's default compaction falls back to a fixed 20k-token trigger for models without a resolvable input cap, while an explicitly configured `input_ratio` still fails closed: the host keeps its loud config-error contract, the product does not crash on unknown local models.

## Further Actions

- **Low — `usedDefaults` precision:** a catalog entry that declares capabilities but no limits now gets assumed limits while `usedDefaults` stays false (the flag reports a catalog miss, per its docstring); record assumed-limits separately if the footer should signal it.
- **Low — live task coverage:** the task leg runs on whatever provider key is configured; consider splitting a tool-use-heavy leg onto a stronger model env var if haiku-class models flake on multi-step file/test work.
