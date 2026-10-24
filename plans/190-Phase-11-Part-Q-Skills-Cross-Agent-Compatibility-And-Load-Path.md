# Phase 11 Part Q — skills: cross-agent compatibility and the load path

## Objectives

- Read the `SKILL.md` files other coding agents write (Claude Code, Codex, the `skills` CLI ecosystem) correctly: real YAML frontmatter, the standard skill directories, and `CLAUDE.md` where a repository has no `AGENTS.md`.
- Make `load_skill` behave the way models expect and the prompt cache rewards: the body comes back once as the tool result, and is restored only when compaction removed it.
- Never fail a run because of one bad skill, and render the catalog as one block that says how to use it.
- Let an agent read a loaded skill's `references/` and `scripts/` even when the skill lives outside the workspace.
- Progressive disclosure that also unloads (context-rot review, 2026-10-17):
  - after compaction, re-attach only skills loaded in the current run; the rest are named, not re-sent
  - subdirectory `AGENTS.md`/`CLAUDE.md` files enter the conversation only when the agent touches a file under that directory

## Expected Outcome

- All six skills in this repository's `.agents/skills/` parse with their full descriptions (on 2026-10-17, `find-docs` parsed as `">-"` and `graft` kept only its first line). Quoted scalars lose their quotes; nested `metadata:` maps arrive as objects.
- `contextFiles({ root })` registers the skills found under `<root>/.agents/skills` and `<root>/.claude/skills`, and, with `globalRoot`, under `<globalRoot>/.agents/skills`, `<globalRoot>/.claude/skills`, and `<globalRoot>/.codex/skills`. The project wins over global; a duplicate name keeps the first and notes the rest. A directory with no `AGENTS.md` contributes its `CLAUDE.md`.
- `load_skill("x")` returns `Loaded skill x. Skill directory: <dir>` followed by the skill's instructions. The body is not re-sent at the tail of later requests. After compaction drops that tool result, the next request carries the body once more at the tail.
- A skill whose description or body is over the hard cap, or a catalog over 256 entries, produces a status note and a skipped or unlisted skill — never `SkillDisclosureError` in a run. The catalog is one system message: a short preamble plus one `- name: description` line per skill.
- `read`, `glob`, and `grep` from `tools-coding` can read under any registered skill's directory; `write`, `edit`, `delete`, `move`, and `shell` cannot.
- After a compaction, only skills loaded in the current run are re-attached. Earlier loads become one line, `Previously loaded skills (load again if needed): a, b`, and leave the loaded set, so `load_skill` returns their body again.
- `contextFiles({ root })` inserts `packages/api/AGENTS.md` once, right after the first tool result that read, edited, or wrote a file under `packages/api/`. The insertion's bytes are frozen for the session, so the prefix stays cacheable, and it disappears with that tool result at compaction.

**0.13.0 release path — plan 190, step 6 of 21.** Amended 2026-10-17 by the context-rot review (owner decision: all findings ship in 0.13.0): Task 3 gains run-scoped re-attach, Task 1 gains checks (h)–(i), and Task 7 (nested instruction files just in time) is new. Owner decision 2026-10-17 (see plan 189's header). Start this plan when plan 189 is complete; when it is complete, continue with plan 191. It must run before plan 184 because Task 3 changes where a loaded skill body sits in the request (184 Task 2's fixture loads a skill mid-session), and before plan 185 because it changes kernel exports (`parseAgentFile`'s result, `SkillDisclosureError` retired). It changes kernel contracts (frontmatter parsing, the `load_skill` result, catalog rendering and its error policy), so **Task 1 is the phase review**. It implements roadmap §2.1's skills row ("`SKILL.md` directory discovery, progressive/eager disclosure, `load_skill`") and Phase 7's `context-files` row; it adds no hook, slot, or `PackageAPI` member — discovery uses the existing `prism.skills.register`. Docs go to the promoted `/docs` pages (`docs/agent.md` "Tools and skills", `docs/resource-loading.md`) and the `context-files` and `tools-coding` READMEs. No version bump, publish, or npm deprecation. Reference host impact: the coding worker loads `context-files` and kernel skills, so Task 5's discovery and Task 3's `load_skill` result must keep the reference host's scenarios green (the golden JSONL fixture changes if a scenario loads a skill).

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Frontmatter shapes in the wild.** The frontmatter of the six skills in `.agents/skills/` and one current sample each from Claude Code skills, Claude Code subagents (`.claude/agents/*.md`), Codex skills, and the `skills` CLI (find-docs; record sources and dates). The list of YAML features they use (block scalars `|`/`>` with chomping indicators, quoted scalars, plain multi-line scalars, nested maps, flow and block lists), which is the parser's required subset.
      - (b) **Every caller** of `splitFrontmatter`, `parseSkillFile`, `parseAgentFile` (`src/contribution-parsing.ts:13,86,122`), `createLoadSkillTool` and `MAX_LOAD_SKILL_RESULT_BYTES` (`src/skill-load.ts:7,183`, currently 512 bytes), `appendSkillTailSegments` (`src/input.ts:388`), `skillMessages`/`capSkillCatalog`/`skillPromptText` (`src/skill-disclosure.ts`), and `SkillDisclosureError`/`isSkillDisclosureError`/`SKILL_DISCLOSURE_ERROR_CODE` (the 2026-10-17 grep found only `src/index.ts`, `src/skill-disclosure.ts`, its test, the export freeze, and the baseline).
      - (c) **Where loaded bodies render today.** Sessions always pass `tailSegments` (`src/agent-session/session.ts:152`, `session/assemble.ts:462`), so a loaded body is re-appended after the newest message on every request (`src/input.ts:216-225,388-411`) and is never inside a cached prefix. Confirm, and record the bytes a 32 KB skill adds per request in the prefix-stability fixture (`src/testing/prefix-stability-conformance.ts:325-337`).
      - (d) **Compaction and restore.** How the compaction slot and `context.build` drop tool messages (`src/compaction.ts`, `packages/memory/compaction`, `packages/context/engineering/src/fold.ts:82-112` — folding replaces a tool result with a summary), and what run restore keeps (`src/agent-run-restore.ts:21-32`, `snapshotLoadedSkillBodies`). Which marker on a `load_skill` tool message survives folding and compaction so Task 3 can tell whether a body is still visible.
      - (e) **Skill registration rules.** What `prism.skills.register` does on a duplicate name (`skill_conflict`, `src/packages/api.ts:99-107`), and whether the kernel's `skills.dirs`/`addDir` reader (`src/packages/loader.ts:733,828-832`, `loadSkillDirectory` in `src/node/contribution-discovery.ts:160-200`) throws on a missing directory (its doc says it does).
      - (f) **The read gate.** That `read` resolves absolute paths without its own root check (`packages/tools/coding/src/agent/read.ts:538`, `agent/path-utils.ts:108-120`) and the hard-deny hook is the only barrier (`hard-deny.ts:81-84`), so Task 6 changes the hook and `coding.targets` only.
      - (g) **Skill tool names in third-party bodies.** Which tool names the sample bodies mention (`Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`), for the docs note on name mapping (plan 189 Task 4's `grep` rename already aligns one).
      - (h) **Run identity of a skill load.** Whether a `load_skill` tool message carries its `runId` (session entries do, `SessionEntry.runId`), so Task 3 can tell which loads belong to the current run after compaction removed the tool messages. Also where the loaded set is recorded across runs (`LoadedSkillSet`, `src/skill-disclosure.ts:28`; `snapshotLoadedSkillBodies`).
      - (i) **File paths in coding tool calls** for Task 7. After plan 189: the tool names and the argument that holds the path for `read`, `edit`, `write`, `grep`, and `glob` (`path`, or `pattern` plus `path`). Whether a tool-result message in `draft.messages` can be paired with its call's arguments (the assistant `tool_call` content with the same `toolCallId`). Whether an extra text part on a tool-result message reaches each supported provider route intact.
    - Functional: The note ends with a verdict; a finding that invalidates a task stops the plan for a re-cut.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: The review confirms that discovered project skills stay trust-gated by `context-files`' existing path trust policy (`packages/context/files/src/index.ts:53-72`).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1, §2.3 (`skills` config), §2.6 (`PackageAPI.skills`), Phase 7; `docs/agent.md` "Tools and skills"; plan 003 (progressive disclosure), plan 018 Task 6 (restored bodies).
    - Options Considered:
      - Skip the review. Rejected: three kernel contracts change.
    - Chosen Approach:
      - Read-only inventory cited by Tasks 2–6.
    - API Notes and Examples:
      ```bash
      graft callers parseSkillFile --depth all
      graft callers appendSkillTailSegments --depth all
      ```
    - Files to Create/Edit:
      - `plans/190-Phase-11-Part-Q-Skills-Cross-Agent-Compatibility-And-Load-Path.md` (task note only).
    - References:
      - The 2026-10-17 evaluation §2.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit:
      - none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-23)

  Review method: read and parsed the six repo `SKILL.md` files with the current parser; fetched current third-party samples on 2026-10-23; traced every listed symbol with a repo-wide `rg` plus graft; measured the prefix-stability fixture with 32 KiB bodies in a temporary script (no tree change).

  - **(a) Frontmatter shapes in the wild.**
    - The six repo skills (2026-10-23): four plain single-line descriptions (`create-plan`, `prism-execution`, `skill-creator`, `typescript-advanced-types`); `find-docs` uses a folded block scalar `>-` with a paragraph break; `graft` uses a plain scalar continued on more-indented lines; `skill-creator` uses a nested block map under `metadata:`. Current parser output, measured: `find-docs` `description: ">-"` plus two flattened metadata keys (`Always use for`, `API syntax…`), `graft` only `"This repo is indexed by graft/. For ANY task here, whether"`, `skill-creator` `metadata: []` plus a flattened `short-description`, and the nested map's parent key lost.
    - Claude Code skills: `code.claude.com/docs/en/skills` (fetched 2026-10-23) documents `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`; its samples use plain scalars (`allowed-tools: Read Grep`, space-separated) and a YAML list is also accepted for `allowed-tools`/`disallowed-tools`. `anthropics/skills` samples (fetched 2026-10-23) use plain scalars (`pdf`, `brand-guidelines`, `license: Complete terms in LICENSE.txt`) and double-quoted scalars containing apostrophes and `: ` (`docx`, `pptx`, `xlsx`).
    - Claude Code subagents (`.claude/agents/*.md`, `code.claude.com/docs/en/sub-agents`, fetched 2026-10-23): `tools: Read, Grep, Glob` is one plain comma-separated scalar, not a YAML sequence; the optional `hooks:` field is a nested block map holding a block sequence of maps (`- matcher: "Bash"` / `hooks:` / `- type: command` / `command: "./scripts/validate-readonly-query.sh"`).
    - Codex skills: `openai/codex` bundled `codex-rs/skills/src/assets/samples/skill-creator/SKILL.md` (fetched 2026-10-23) uses plain scalars and a nested block map under `metadata:` (`short-description`). Codex's separate `agents/openai.yaml` is not frontmatter.
    - skills CLI (`vercel-labs/skills`; `vercel-labs/agent-skills` sample `skills/web-design-guidelines/SKILL.md`, fetched 2026-10-23): nested `metadata:` map with plain keys, a double-quoted `"1.0.0"`, and a plain scalar containing `<file-or-pattern>` (`argument-hint`).
    - Agent Skills spec (`agentskills.io/specification`, fetched 2026-10-23): `metadata` is a string-to-string map, `allowed-tools` a space-separated string, `license`/`compatibility` plain scalars.
    - Required parser subset: plain single-line scalars; plain scalars continued on more-indented lines (folded with spaces, blank line = newline); single-quoted (`''` escape) and double-quoted (backslash escapes) scalars; block scalars `|` and `>` with `-`/`+` chomping (`>-` is the only form observed in the repo; `|`/`|+` are in scope per the plan); nested block maps by indentation; block sequences, flow sequences, and block sequences of maps (the subagent `hooks` shape). Values stay strings (`disable-model-invocation: true`, `version: "1.0.0"`). No anchors, aliases, tags, multi-document, or YAML comments were observed; tolerate full-line `#` comments cheaply, keep forbidden syntax failing.
  - **(b) Every caller.**
    - `splitFrontmatter`: `src/contribution-parsing.ts:13`; internal callers `:87` (`parseSkillFile`), `:123` (`parseAgentFile`); not re-exported by `src/index.ts` (only `parseAgentFile`/`parseSkillFile` at `:203`); still in the compat baseline at `scripts/compat-baseline/arnilo__prism.txt:918`.
    - `parseSkillFile`: `src/contribution-parsing.ts:86`; `src/node/contribution-discovery.ts:5,126,198`; `packages/tools/work/src/skills/load.ts:4,34`; `packages/tools/computer-use/src/skill.ts:3,16`; `src/index.ts:203`; `src/__tests__/contribution-parsing.test.ts`.
    - `parseAgentFile`: `src/contribution-parsing.ts:122`; `src/index.ts:203`; tests only today (`src/__tests__/contribution-parsing.test.ts:3,49`); plan 191 Task 6 is the new consumer.
    - `createLoadSkillTool`: `src/skill-load.ts:183`; `src/agent-session/session/assemble.ts:34,332`; `examples/skills-progressive-disclosure.ts:4,25`; `examples/caveman-ponytail.ts:3,108`; `src/__tests__/skill-load.test.ts:6,62,92,111`; `src/__tests__/tool-effects-annotation.test.ts:4,48`; `src/__tests__/public-export-contract.test.ts:190`; baseline `:563`.
    - `MAX_LOAD_SKILL_RESULT_BYTES`: `src/skill-load.ts:7,166,168`; `src/index.ts:422`; `src/__tests__/public-export-contract.test.ts:113`; baseline `:232`; prose-only mentions in `scripts/plan-review-gate.test.mjs:302,321`.
    - `appendSkillTailSegments`: module-private in `src/input.ts:388`, called only at `:224`.
    - `skillMessages`: `src/skill-disclosure.ts:108`; `src/input.ts:26` (aliased `buildSkillMessages`), used at `:164`; `src/skills-catalog.ts:3,39`; tests; baseline `:913`.
    - `capSkillCatalog`: `src/skill-disclosure.ts:64`; `src/input.ts:23,396`; baseline `:531`.
    - `skillPromptText`: `src/skill-disclosure.ts:85`, used internally by `skillMessages` at `:111`; `src/__tests__/skill-load.test.ts:18,150`; `src/__tests__/skill-disclosure.test.ts:31,49,54`; baseline `:914`.
    - `SkillDisclosureError` / `isSkillDisclosureError` / `SKILL_DISCLOSURE_ERROR_CODE`: `src/skill-disclosure.ts:14,16,24`; `src/index.ts:407,409`; `src/__tests__/skill-disclosure.test.ts:11,49,73`; `src/__tests__/public-export-contract.test.ts:144`; baseline `:348,366,684`.
  - **(c) Where loaded bodies render today — confirmed.** `RuntimeAgentSession` owns `tailSegments` (`src/agent-session/session.ts:150`) and passes it on every request (`src/agent-session/session/assemble.ts:462`); `assembleProviderInput` calls `appendSkillTailSegments` (`src/input.ts:224`), which appends a `Skill <name>:\n<body>` message for every loaded skill whose body is renderable (`:388-411`), then appends all active tail messages after the transcript. So a loaded body is re-sent after the newest message on every request and is never inside a cached prefix.
    Measurement, prefix-stability fixture with a 32 KiB body (`src/testing/prefix-stability-conformance.ts:322-337`, temporary script, current tree): the tail message serializes to **32,837 bytes** (32,768-byte body + `Skill alpha:\n` + JSON overhead) and is present on provider requests 2, 3, and 4 of the 4-request fixture — **98,511 uncached bytes** for one skill. Provider-visible continuity collapsed to 2.6% at request 2 → 3 (resets `[3, 4]`); the cacheable-prefix metric stayed 1. This reproduces the cost the plan removes.
  - **(d) Compaction and restore.** The default compactor summarizes everything before `firstKeptIndex` and keeps only the recent entries (`src/compaction.ts:21-33`); `snapshotFromBranch` keeps only messages after `throughEntryId` or in `keepEntryIds` (`src/session-stores.ts:173-184`). Folding replaces a tool result with a summary header, keeps the message's `toolCallId`, `name`, and metadata, and adds `metadata.prismFolded: true` (`packages/context/engineering/src/fold.ts:82-112`). Run restore keeps loaded names and exact bodies (`src/agent-run-restore.ts:21-32` → `src/agent-session/session.ts:158-171`), and the run state persists both (`src/agent-session/session/persist.ts:46-54`).
    The proposed `metadata.loadedSkill` marker survives **both** compaction (message removed) and folding (metadata spread), so the marker alone cannot answer "is the body still visible": after folding the marker is still there while the body text is gone. Task 3 must treat a folded tool message (`metadata.prismFolded === true`) as **not** carrying the body, or have the fold strip the marker. Compaction removes the message entirely, which the loaded set already handles by re-attaching.
  - **(e) Skill registration rules.** A duplicate name in `prism.skills.register` throws `PackageLoadError("skill_conflict", …)` and fails that package's setup (`src/packages/loader.ts:516-528`; `src/packages/api.ts:99-107`). A duplicate among host `skills.add` entries fails earlier, at agent load, with plain `Error("Duplicate skill: <name>")` (`src/packages/loader.ts:916`, `src/skills.ts:12-21`, `src/registry-options.ts:9-16`). `skills.addDir` only records the path; after `setup` the loader reads it (`src/packages/loader.ts:734-737,854-861`) through `loadSkillDirectory` (`src/node/contribution-discovery.ts:160-200`), which **throws** on an unreadable directory or an oversized/malformed `SKILL.md` and therefore fails that package's setup; duplicates across directories also throw `skill_conflict`. `context-files`' scan must therefore use `register` directly and catch conflicts, not `addDir`.
    Ordering limit: during `setup` there is no readable skill list (`skills.list()` throws `state_not_ready`), so `context-files` can only skip a name it already registered or one the host already owns; a later package that registers the same name still fails when *its* setup runs. The plan's "conflict with another package is skipped" holds only when the other package loaded first.
  - **(f) The read gate — confirmed.** `read` resolves an absolute path through `resolveReadPathAsync` with no root check of its own (`packages/tools/coding/src/agent/read.ts:538-556`; `agent/path-utils.ts:108-120`). The only barrier is the `tool.call` hard-deny hook: `createContainmentChecker` realpaths the roots and the target (`packages/tools/coding/src/hard-deny.ts:47-75`) and the hook denies any path outside `targets.roots` (`:80-86`). `targets` returns `root` plus configured extra roots for every known tool (`packages/tools/coding/src/targets.ts:22-34,51-68`). Task 6 changes only `targets.ts` and `hard-deny.ts` (plus wiring/tests), as planned.
  - **(g) Tool names in third-party bodies.** Repo skills: `create-plan` mentions `Read`, `Write`, `Edit`, `Task`; `prism-execution` `Read`, `Write`, `Task`; `skill-creator` `Read`, `Write`, `Edit`, `Bash`; `typescript-advanced-types` `Read`; `find-docs` and `graft` none. No body mentions `Grep` or `Glob`. The docs name-mapping note should cover `Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Bash`→`shell`, `Grep`→`grep`, `Glob`→`glob`, and `Task`→no direct Prism tool (delegation is host-specific).
  - **(h) Run identity of a skill load.** A provider `Message` has no `runId` (`src/contracts-core/content.ts:114-119`); `SessionEntry` does (`src/contracts-core/session.ts:42-49`), and `appendMessage` stores it only on the entry (`src/agent-session/session.ts:985-986`). `rebuildSessionContext` returns `entry.message` unchanged (`src/session-stores.ts:160-188`), so the tool message in `draft.messages` cannot carry it. The loaded set is a plain name set with no run information (`src/skill-disclosure.ts:28-46`); persistence stores names and bodies only (`src/agent-session/session/persist.ts:46-54`).
    Feasible source: `ToolExecutionContext.runId` is available to `load_skill` (`src/contracts-protocol.ts:529-536`), so the load can stamp `ToolResult.metadata` (and thus the tool message) with its run. After compaction removed the message, Task 3 must keep the name→run association in session state (extend `LoadedSkillSet` or a session map) and persist it if resume must keep run scope. Resume reuses the suspended run's `runId` (`src/agent-session/session.ts:538`), so restored names/bodies from `restoreRunSessionState` belong to the current run and must re-attach as current, not as "previously loaded".
  - **(i) File paths in coding tool calls.** `PATH_ARG_KEYS` (`packages/tools/coding/src/targets.ts:22-34`): `read`, `write`, `edit`, `delete`, `glob`, `grep`, `diagnostics` use `path`; `move` uses `from`/`to`; `shell`/`shell_output` none. `grep` and `glob` require `pattern` (a search/glob pattern, not a file path) and take an optional `path` root (`packages/tools/coding/src/agent/grep.ts:279-332`; `agent/glob.ts:65-98`), so Task 7 should anchor on `read`/`edit`/`write`/`diagnostics` file paths, and treat a `grep`/`glob` `path` as a directory touch at most.
    Pairing works: the assistant message holds `tool_call.id` + `arguments`, the tool result holds `tool_result.toolCallId`, folding preserves `toolCallId` and `name` (`fold.ts:96-110`), and compaction never splits a result from its call (`src/compaction.ts:25`).
    **Extra text parts do not survive the provider routes.** `toToolResultMessage` always fills `tool_result.result` for a text result (`src/input.ts:322-345`), and `serializeToolResultText` returns `result.result` when present, ignoring trailing `text` blocks (`src/provider-kit/openai-primitives.ts:52-65`). Both codecs use it (`anthropic-messages.ts:305-309`, `openai-chat.ts:313-315`), so Task 7's "one extra text part on the tool message" is dropped on the wire unless it appends into `result` or extends `serializeToolResultText` (and both codecs' conformance). Plan 192's envelope is unaffected only if the text is still inside the same message.
  - **Security.** `context-files` builds `trust = createPathTrustPolicy({ trustedRoots })` with `trustedRoots` defaulting to `[root]` (`packages/context/files/src/index.ts:53-72`) and applies it per candidate file via `resolveContextFileLayers(..., trust, onSkip)` (`packages/context/files/src/layers.ts:60-90,106-122`). Skill discovery is not automatically covered: Task 5 must call `plan.trust.check` on each `SKILL.md` realpath (project roots only; global roots are user-owned, per the existing `globalRoot` rule). This repository's `.claude/skills` is a symlink to `.agents/skills` (verified 2026-10-23), so realpath de-duplication is required.
  - **Verdict.** No finding invalidates a task; proceed to Task 2. Three amendments are required now (applied below): Task 2 must cover the subagent block-list-of-maps shape (and may tolerate full-line comments); Task 3 must exclude folded tool messages from the visibility test and record/persist run identity itself; Task 7 must include the shared tool-result serializer change (or append into `result`) and its codec tests. Task 5's "other package conflict is skipped" must be read as load-order dependent (Task 1 (e)).

- [x] Task 2: Frontmatter that other agents write
  - Acceptance Criteria:
    - Functional: `splitFrontmatter` (`src/contribution-parsing.ts:13-70`) parses the Task 1 (a) subset: block scalars (`|`, `>`, with `-`/`+` chomping), single- and double-quoted scalars (with `''` and backslash escapes), plain scalars continued on more-indented lines (folded with spaces), nested maps by indentation, block and flow lists, and block lists whose items are maps (the Claude Code subagent `hooks:` shape). Values stay strings (no number or boolean coercion), so `metadata` keeps its current JSON-safe shape, now with nested objects instead of flattened keys. Full-line `#` comments are tolerated; other unsupported syntax fails closed.
    - Functional: Input outside the subset (anchors, aliases, tags, multi-document) fails with `Malformed frontmatter in <path>: <reason> at line N`; it never silently mis-assigns keys as it does today (a folded line containing `:` became a metadata key on 2026-10-17).
    - Functional: `parseAgentFile` returns the body as `instructions` and `description` as a top-level field, alongside `name` and `metadata` (`AgentFileDeclaration`, `src/contribution-parsing.ts:112-140`), so plan 191 Task 6 can read subagent files.
    - Functional: Fixtures: copies of the six `.agents/skills/*/SKILL.md` frontmatters plus the Task 1 (a) samples live under `src/__tests__/fixtures/frontmatter/`; each parses to a recorded expected value. Include the Claude Code subagent sample (plain comma `tools` scalar plus a `hooks:` block list of maps) and the skills-CLI sample (nested metadata, quoted version, `argument-hint`).
    - Performance: One pass over the frontmatter lines; no regex per character. Parsing all fixtures stays under 5 ms in the test.
    - Code Quality: Still no YAML dependency and no `node:*` import (the module stays fs-free, `contribution-parsing.ts:1-6`). The parser is one function with one indentation stack, not a general YAML engine.
    - Security: Frontmatter size is bounded by the existing per-file cap (`HARD_MAX_SKILL_INSTRUCTION_BYTES`); nesting depth is capped at 8 and fails closed beyond it.
  - Approach:
    - Documentation Reviewed:
      - `src/contribution-parsing.ts`; Task 1 (a)–(b); YAML 1.2 spec sections on block and flow scalars (record the version).
    - Options Considered:
      - `Bun.YAML.parse`. Rejected: the kernel module is fs- and runtime-neutral by design, and a full YAML engine accepts anchors and tags skills never need.
      - A YAML package dependency. Rejected: the kernel has zero runtime dependencies (roadmap Phase 11 constraint).
    - Chosen Approach:
      - A small, strict subset parser proven against real files.
    - API Notes and Examples:
      ```yaml
      ---
      name: find-docs
      description: >-
        Retrieves up-to-date documentation, API references, and code examples for any
        developer technology.
      metadata:
        short-description: Find docs
      ---
      ```
      ```ts
      parseSkillFile(text, path).description // "Retrieves up-to-date documentation, … developer technology."
      ```
    - Files to Create/Edit:
      - `src/contribution-parsing.ts`, `src/__tests__/contribution-parsing.test.ts` (new or extended), `src/__tests__/fixtures/frontmatter/*` (new), `src/__tests__/skills.test.ts`, `scripts/compat-baseline/arnilo__prism.txt`, `docs/resource-loading.md`, `CHANGELOG.md`.
    - References:
      - Plan 191 Task 6 (consumer of `parseAgentFile`).
  - Test Cases to Write:
    - `frontmatter_folded_block_scalar` (the `find-docs` case), `frontmatter_plain_multiline_scalar` (the `graft` case), `frontmatter_quoted_scalars_unquoted`, `frontmatter_nested_metadata_is_object`, `frontmatter_block_and_flow_lists`, `frontmatter_block_list_of_maps` (subagent `hooks`).
    - `frontmatter_repo_skills_parse_fully`: all six fixtures match their expected descriptions; fails on any regression.
    - `frontmatter_unsupported_feature_fails_with_line`, `frontmatter_depth_cap`.
    - `parse_agent_file_returns_body_and_description`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the `AgentFileDeclaration` shape change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — what `SKILL.md` and agent files parse to.
    - Docs pages to create/edit:
      - `docs/resource-loading.md`: "SKILL.md frontmatter" — supported subset, fields Prism reads (`name`, `description`, `tools`/`toolNames` as required tools), and that other keys (`allowed-tools`, `metadata`) are kept as metadata and never grant permissions; `CHANGELOG.md` (Fixed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Implementation.** `src/contribution-parsing.ts` now has a recursive `FrontmatterParser`: plain single-line and continued scalars, single-/double-quoted scalars (`''` and backslash/`\u` escapes), literal and folded block scalars (`|`, `>`, `-`/`+` chomping), nested maps by indentation, flow lists, block lists, and block lists of maps. One indentation walk, no per-character regex, no YAML dependency, no `node:*` import. Values stay strings; a nested `metadata:` map stays an object under `skill.metadata.metadata` instead of being flattened. Full-line `#` comments are skipped; anchors, aliases, tags, `%`, `@`, backticks, flow maps, tabs as indentation, and depth > 8 fail as `Malformed frontmatter in <path>: <reason> at line N`. `splitFrontmatter` now closes only on a column-0 `---`/`...`, so a block scalar may contain an indented `---`. `parseAgentFile` returns `description` and the body as `instructions`, and no longer puts `description` in `metadata` (additive shape change: `AgentFileDeclaration.description?` and `.instructions`).
  - **Coverage.** New fixtures under `src/__tests__/fixtures/frontmatter/`: the six repo `SKILL.md` frontmatters with a recorded `expected.json`, a Claude Code subagent (`tools` string plus `hooks:` block list of maps), a skills-CLI/Anthropic docx sample (nested metadata, quoted `"1.0.0"`, `<file-or-pattern>`, escaped quotes), and a scalars sample (literal, strip, keep, folded, `---` inside a block scalar). Tests: 20 pass in `contribution-parsing.test.ts`, including exact repo descriptions, unsupported-syntax line numbers, the depth cap, `parseAgentFile` body/description, and all fixtures parsed in 0.46 ms (< 5 ms).
  - **Docs.** `docs/resource-loading.md` gains "SKILL.md frontmatter": the supported subset, fields Prism reads, and the rule that `allowed-tools`/`hooks`/other keys are metadata and never grant permissions. `CHANGELOG.md` has the Fixed entry.
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes. `scripts/budgets.json` kernel ceilings were rebaselined for the parser and its docs: 1123904 packed / 3667077 unpacked / 38256 source lines, with the reason recorded in each `$comment`; no compat baseline changed and file count/root exports stayed at 357/1480.
  - **Limits.** Flow lists must close on one line; folded block scalars fold all line breaks (more-indented content is not preserved); inline `#` in a plain scalar is text, not a comment; duplicate keys keep the last value. All are outside the observed fixture set and fail closed or stay literal rather than mis-assigning keys.

- [x] Task 3: `load_skill` returns the body; restore it only after compaction
  - Acceptance Criteria:
    - Functional: A successful `load_skill` returns `Loaded skill <name>. Skill directory: <dir>. Paths in these instructions are relative to it.` followed by a blank line and the skill's instructions. The tool message carries `metadata.loadedSkill: <name>` and `metadata.loadedSkillRunId: <runId>` (Task 1 (d)/(h)). `MAX_LOAD_SKILL_RESULT_BYTES` becomes `HARD_MAX_SKILL_INSTRUCTION_BYTES` plus the header; failure texts keep their current bound.
    - Functional: Loading a skill that is already loaded returns `Skill <name> is already loaded; its instructions are earlier in this conversation.` as a normal result, not an error (today it is `skill_load_failed`, `src/skill-load.ts:139`).
    - Functional: In progressive disclosure, `appendSkillTailSegments` no longer appends loaded bodies on every request. It appends a loaded skill's body only when no provider-visible message carries `metadata.loadedSkill: <name>` **and is not folded** (`metadata.prismFolded === true` means the body was replaced by a summary), and then the marker on that tail message keeps it from being added twice. Eager disclosure is unchanged. (Task 1 (d): folding keeps the marker but drops the body, so a marker-only check would leak a folded summary as "visible".)
    - Functional: **Run-scoped re-attach.** After compaction removed a loaded skill's tool message:
      - only skills loaded during the **current run** (Task 1 (h)) get their body re-attached at the tail
      - skills loaded in earlier runs are removed from the loaded set, and one tail line names them: `Previously loaded skills (load again if needed): <names>`, sorted, capped at 16 names then `(+N)`
      - a later `load_skill` for such a name returns the full body (not "already loaded")
      
      A compacted session therefore carries the bodies of the task in progress, not every skill the session ever touched. This is progressive disclosure that also unloads: Anthropic's context-engineering guidance and Claude Code's compaction re-attach only invoked skills; Du et al. 2025 show added length alone lowers accuracy. Run identity must be recorded in session state, not read back from messages: a provider `Message` has no `runId` (`src/contracts-core/content.ts:114-119`), while `load_skill` sees `ToolExecutionContext.runId` (`src/contracts-protocol.ts:529-536`). Restored names/bodies from a resumed run belong to that run (resume reuses its `runId`, `src/agent-session/session.ts:538`), so they re-attach as current.
    - Functional: Run restore (`src/agent-run-restore.ts`) keeps working: a resumed session whose transcript still holds the tool result renders nothing extra; one whose transcript was compacted gets the restored body at the tail once.
    - Functional: `src/testing/prefix-stability-conformance.ts` is updated so its mid-session skill load expects the body in the tool result and a stable prefix afterwards; plan 184 Task 2 consumes it as is.
    - Performance: Across a ten-turn loop with one skill loaded at turn 2, the body's bytes are sent in uncached positions once (as the turn-2 tool result) instead of on every turn from turn 3 (Task 1 (c) measures the old cost). The test asserts the per-request tail is empty from turn 3.
    - Code Quality: No new hook or slot. The tail-segment machinery is reused for the compaction case; the per-turn re-append path is removed.
    - Security: The body still passes the hard size cap before it is returned; `load_skill` keeps `effects: ["read"]`.
  - Approach:
    - Documentation Reviewed:
      - `src/skill-load.ts:114-235`; `src/input.ts:150-260,388-418`; `src/agent-run-restore.ts`; `src/testing/prefix-stability-conformance.ts`; Task 1 (c)–(d); Claude Code and Codex skill loading (the body is returned as the tool result; Claude Code re-attaches invoked skills after compaction).
    - Options Considered:
      - Keep tail re-append. Rejected: an uncached copy of every loaded body on every request.
      - Put loaded bodies in the system prefix. Rejected: a load would invalidate the whole cached conversation.
      - Pin `load_skill` results against compaction. Rejected: needs a new compaction contract; re-attaching from the loaded set uses what exists.
      - Re-attach every loaded skill after compaction. Rejected: a long session accumulates bodies for finished tasks in every later request; naming them keeps them one `load_skill` away.
    - Chosen Approach:
      - Body once in the transcript; tail copy only when the transcript lost it.
    - API Notes and Examples:
      ```text
      Loaded skill create-plan. Skill directory: /repo/.agents/skills/create-plan. Paths in these instructions are relative to it.

      # Create Plan
      …
      ```
    - Files to Create/Edit:
      - `src/skill-load.ts`, `src/input.ts`, `src/skill-disclosure.ts` (run-scoped loaded set), `src/agent-session/session.ts` and `src/agent-session/session/persist.ts` (record/persist name→runId if the loaded set does not carry it), `src/agent-run-restore.ts` (only if Task 1 (d) needs it), `src/testing/prefix-stability-conformance.ts`, `src/__tests__/skill-load.test.ts`, `src/__tests__/skill-disclosure.test.ts`, `src/__tests__/input-pipeline.test.ts`, the prefix-stability conformance test, `examples/skills-progressive-disclosure.ts` (expected output), `scripts/compat-baseline/arnilo__prism.txt` (constant value), `docs/agent.md`, `docs/tools.md`, `CHANGELOG.md`.
    - References:
      - Plan 184 Task 2.
  - Test Cases to Write:
    - `load_skill_returns_body_with_directory_header`: fails if the body is missing from the result.
    - `load_skill_already_loaded_is_not_an_error`.
    - `loaded_body_not_reappended_while_tool_result_visible`: tail is empty on later requests.
    - `loaded_body_reattached_once_after_compaction`: drop the tool message, next request has one tail copy, the one after has the same single copy (stable).
    - `folded_load_skill_result_reattaches_body`: fold the tool result (`prismFolded: true`) without compaction; the next request carries the body again (breaks if the marker alone is trusted).
    - `resumed_session_with_compacted_transcript_restores_body`.
    - `compaction_reattaches_only_current_run_skills`: skills loaded in run 1 and run 2, compaction in run 2 → only run 2's body at the tail, run 1's name in the "previously loaded" line (breaks if every loaded body is re-attached).
    - `previously_loaded_skill_loads_again_with_body`.
    - `previously_loaded_line_capped_and_sorted`.
    - `prefix_stability_holds_across_skill_load` (conformance).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `load_skill` result and where bodies appear.
    - Docs pages to create/edit:
      - `docs/agent.md` "Tools and skills": load path, run-scoped compaction re-attach and the "previously loaded" line, cost (one copy per load, one more after a compaction for current-run skills only); `docs/tools.md`: the `load_skill` row; `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Implementation.** `load_skill` now returns `<header>\n\n<instructions>`, where the header is `Loaded skill <name>. Skill directory: <dir>. Paths in these instructions are relative to it.` when `Skill.path` exists. The tool result carries `metadata.loadedSkill` and `metadata.loadedSkillRunId`; a second load returns `Skill <name> is already loaded; its instructions are earlier in this conversation.` with no new marker, and still stamps the current run on the loaded set. `MAX_LOAD_SKILL_RESULT_BYTES` is now 263168 (`HARD_MAX_SKILL_INSTRUCTION_BYTES` + a 1024-byte header allowance); failures keep a private 512-byte cap. `LoadedSkillSet.add(name, runId?)` records run identity; optional `entries()`/`remove()` keep existing host implementations compiling and fall back to name-only behavior.
  - **Tail and compaction.** For progressive disclosure, `appendSkillTailSegments` scans the provider-bound messages before tails are appended. A non-folded message with `metadata.loadedSkill` suppresses the body; a folded message (`prismFolded: true`) does not. A missing body is re-attached only when its recorded run equals the current run (or no run id is known), stamped with its own marker so a second pass cannot duplicate it. A body from an earlier run is removed from the loaded set, its stale tail segment is dropped, and all such names become one sorted `Previously loaded skills (load again if needed): …` line capped at 16 names plus `(+N)`. Eager disclosure keeps its per-turn body segments unchanged. Checkpoint restore passes `state.runId`, so restored names/bodies re-attach as current; `persist.ts` needed no new field.
  - **Conformance.** `src/testing/prefix-stability-conformance.ts` now expects a progressive body inside a tool result (when the host retains the tool call), no `skill:` tail segment, and a byte-stable prefix; the eager tail/clone and body-dropping fixtures still exercise their cases.
  - **Coverage.** `skill-load.test.ts` covers the body/header result and metadata, already-loaded success, the per-load bound, and a ten-turn session whose tail stays empty. `input-pipeline.test.ts` covers visible-result suppression, one-copy re-attach, folded results, current-run-only re-attach with the previous line, reloading a pruned name, the sorted/capped line, and restore with a visible vs compacted transcript. `prefix-stability-conformance.test.ts` is updated for the new stable-prefix behavior. 88 tests pass across the six touched test files.
  - **Docs.** `docs/agent.md` and `docs/tools.md` describe the load path, already-loaded result, run-scoped compaction re-attach, the previous line and its cost; `CHANGELOG.md` has the Changed entry. The progressive-disclosure example now feeds the tool result back as history, so it demonstrates the real path.
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes. Only the root compat baseline line for `MAX_LOAD_SKILL_RESULT_BYTES` changed (512 → 263168); kernel ceilings are 1126359 packed / 3675243 unpacked / 38379 source lines, with the reason recorded in each `$comment`.
  - **Limits.** The fixed 1024-byte header allowance means a skill path longer than that truncates the tail of the body with `…`; normal skill paths are far below it.

- [x] Task 4: One catalog block, and no run fails because of a skill
  - Acceptance Criteria:
    - Functional: `skillMessages` renders one system message: `Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.` followed by one `- <name>: <description>` line per listed skill. Loaded or eager bodies render as today's separate `Skill <name>:` messages.
    - Functional: Descriptions over `DEFAULT_MAX_SKILL_DESCRIPTION_BYTES` are truncated at any length (no hard-cap throw). A skill whose body exceeds `HARD_MAX_SKILL_INSTRUCTION_BYTES` is rejected when it is registered or discovered (`skill_too_large` registration error for `register`/`add`; a status note and skip for directory discovery), so rendering never throws. More than 64 skills lists the first 64 and ends the block with `(N more skills are installed but not listed.)`; there is no 256-entry throw.
    - Functional: `SkillDisclosureError`, `isSkillDisclosureError`, `SKILL_DISCLOSURE_ERROR_CODE`, and `HARD_MAX_SKILL_DESCRIPTION_BYTES`/`HARD_MAX_SKILL_CATALOG_ENTRIES` are deleted. A repo-wide grep for them and for `skill_disclosure_exceeded` over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds nothing.
    - Performance: The catalog costs one message header instead of one per skill; the test records the byte difference for 20 skills.
    - Code Quality: The render path has no throw; size policy lives at registration.
    - Security: An oversized body can no longer reach a provider (rejected at registration); the registration error names the skill and the cap, never the body.
  - Approach:
    - Documentation Reviewed:
      - `src/skill-disclosure.ts`; `src/skills.ts:12-62`; `src/skills-catalog.ts`; `src/packages/loader.ts` (skill registration); Task 1 (b).
    - Options Considered:
      - Keep the throws and document them. Rejected: one third-party skill with a long description fails every run of the agent.
    - Chosen Approach:
      - Validate at registration, render without throwing, one catalog block.
    - API Notes and Examples:
      ```text
      Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.
      - create-plan: Create and maintain numbered phase and implementation plans …
      - find-docs: Retrieves up-to-date documentation …
      ```
    - Files to Create/Edit:
      - `src/skill-disclosure.ts`, `src/skills.ts`, `src/skills-catalog.ts`, `src/packages/loader.ts`, `src/node/contribution-discovery.ts` (skip oversize with a returned warning), `src/index.ts`, `src/__tests__/skill-disclosure.test.ts`, `src/__tests__/skills.test.ts`, `src/__tests__/public-export-contract.test.ts`, `scripts/compat-baseline/arnilo__prism.txt`, `docs/agent.md`, `CHANGELOG.md`.
    - References:
      - Task 3.
  - Test Cases to Write:
    - `catalog_is_one_message_with_preamble`.
    - `long_description_truncates_without_throw`.
    - `oversize_body_rejected_at_register_with_skill_too_large`.
    - `catalog_over_64_lists_count_of_unlisted`, `catalog_over_256_does_not_throw`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the removed exports (attributed to this plan) and the new registration error code.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — error contract and catalog text.
    - Docs pages to create/edit:
      - `docs/agent.md` "Tools and skills": catalog format, limits, and that limits skip or truncate instead of failing; `CHANGELOG.md` (Changed, Removed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Catalog render.** Progressive `skillMessages` now emits one system message: the fixed preamble followed by `- <name>: <description>` lines for the skills whose bodies are not being rendered, with loaded/eager bodies as the existing separate `Skill <name>:` messages. The 20-skill fixture measures 617 bytes for the one block against 1,580 bytes as per-skill messages (963 bytes saved). Descriptions over `DEFAULT_MAX_SKILL_DESCRIPTION_BYTES` truncate with `…` at any length. `capSkillCatalog` keeps the first 64 entries; the block ends `(N more skills are installed but not listed.)`, including over 256 entries, and never throws.
  - **Registration policy.** `PackageLoadErrorCode` gains `skill_too_large`. `prism.skills.register` and the `skills.addDir` reader reject a body over `HARD_MAX_SKILL_INSTRUCTION_BYTES` with that code; `createSkillRegistry` rejects it with a `RangeError`; neither message contains the body. `loadSkillDirectory` now reports `PackageLoadError("skill_too_large")` instead of a plain `Error`. `discoverContributions` skips an oversized `SKILL.md` instead of returning it, so a scan cannot fail a later registration. The package-facing `status.note` for a skipped discovery belongs to Task 5's `context-files` scanner.
  - **Removed surface.** `SkillDisclosureError`, `isSkillDisclosureError`, `SKILL_DISCLOSURE_ERROR_CODE`, `HARD_MAX_SKILL_CATALOG_ENTRIES`, and `HARD_MAX_SKILL_DESCRIPTION_BYTES` are deleted from `src/skill-disclosure.ts` and `src/index.ts`; the repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) is empty after the baseline refresh. No replacement export was added.
  - **Coverage.** 241 tests pass across the 14 touched suites, plus `agents.test.ts` (86 tests): one-message preamble and lines, separate loaded bodies, eager bodies only, long-description truncation, 64-entry truncation with the count, 300-entry no-throw, the 20-skill byte measurement, package `register`/`addDir` `skill_too_large` (with body non-disclosure), `createSkillRegistry` rejection, oversized discovery skip, `loadSkillDirectory` code, plus every existing catalog assertion in the agent, session, input, invalidation, example and docs suites.
  - **Docs.** `docs/agent.md` describes the block, the 512-byte description truncation, the 64-entry listing/count, and registration versus discovery behavior; `docs/packages.md` documents `skill_too_large` in the skills row and the frozen error-code lists; `CHANGELOG.md` has the Changed/Removed entry.
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes. The root compat baseline removes the five exports above (plus Task 3's pending `MAX_LOAD_SKILL_RESULT_BYTES` value change) and adds no declaration. Kernel ceilings are 1127434 packed / 3678097 unpacked / 38403 source lines, with the reason recorded in each `$comment`.
  - **Limits.** An eager catalog over 64 skills renders the first 64 bodies and has no catalog block to carry the unlisted count; the count applies where the catalog is rendered. Discovery-time skip is silent until Task 5 wires package status notes.

- [x] Task 5: `context-files` discovers skills and reads `CLAUDE.md`
  - Acceptance Criteria:
    - Functional: New config `skills?: { enabled?: boolean; roots?: string[] }` (default enabled). Default roots, in precedence order: `<root>/.agents/skills`, `<root>/.claude/skills`, then, only when `globalRoot` is set, `<globalRoot>/.agents/skills`, `<globalRoot>/.claude/skills`, `<globalRoot>/.codex/skills`. `roots` replaces the defaults when given.
    - Functional: Setup scans each existing root one level deep for `<name>/SKILL.md`, de-duplicates roots by realpath (this repository's `.claude/skills` is a symlink to `.agents/skills`), parses with `parseSkillFile`, and calls `prism.skills.register`. A missing root is silent. A malformed or oversized file, a name already taken by an earlier root, and a `skill_conflict` with the host or another package each give one `status.note("warn" | "info", …)` naming the path, and the skill is skipped; setup never throws for a skill.
    - Functional: Project roots are read only through the existing trust policy (a `SKILL.md` whose realpath escapes the trusted roots is skipped with a warning, as `AGENTS.md` is today). Global roots are user-owned and follow the existing `globalRoot` rule: no home-directory scan unless `globalRoot` is configured.
    - Functional: For each directory in the `AGENTS.md` candidate chain (`agentsMdCandidates`, `src/index.ts:73-83`), `AGENTS.md` is used when present, otherwise `CLAUDE.md`. Never both from one directory.
    - Performance: One `readdir` per root and one read per `SKILL.md`, at setup only; nothing per turn. The README states it.
    - Code Quality: Uses `prism.skills.register` (no new `PackageAPI` member); the kernel's `skills.dirs` reader is not changed. Discovery lives in `packages/context/files/src/skills.ts`.
    - Security: Discovered skills are instructions, never code: nothing under a skill directory is imported or executed. `allowed-tools` and similar keys are kept as metadata and grant nothing (test).
  - Approach:
    - Documentation Reviewed:
      - `packages/context/files/src/{index,config,layers}.ts`, `packages/context/files/README.md`; `src/packages/api.ts:99-107`; Task 1 (e); Claude Code, Codex, and `skills` CLI directory conventions (find-docs; record dates).
    - Options Considered:
      - A new `skills-files` package. Rejected: `context-files` already owns trust-gated instruction files from the same roots ("the whole instruction-file plane").
      - `prism.skills.addDir` per root. Rejected: it throws on a missing directory and on a duplicate name across roots (Task 1 (e)), and cannot express precedence.
      - Kernel default discovery. Rejected: the kernel reads no prompt files (roadmap §2.1; `context-files` README).
    - Chosen Approach:
      - Scan, parse, and register in `context-files`, first root wins.
    - API Notes and Examples:
      ```ts
      contextFiles({ root: process.cwd() })                          // project .agents/skills and .claude/skills
      contextFiles({ root: process.cwd(), globalRoot: homedir() })   // plus ~/.agents, ~/.claude, ~/.codex skills
      contextFiles({ root, skills: { roots: ["./vendor-skills"] } })
      ```
    - Files to Create/Edit:
      - `packages/context/files/src/skills.ts` (new), `src/index.ts`, `src/config.ts`, `src/layers.ts` (CLAUDE.md fallback), `src/__tests__/skills.test.ts` (new), `src/__tests__/package.test.ts`, `packages/context/files/README.md`, `examples/discover-skills.ts` (use the package), `examples/README.md` (line updated), `CHANGELOG.md`.
    - References:
      - Task 2 (parser), Task 4 (registration errors), plan 191 Task 4 (children inherit these skills).
  - Test Cases to Write:
    - `discovers_agents_and_claude_skill_dirs`.
    - `symlinked_root_scanned_once`.
    - `project_skill_wins_over_global_duplicate_with_note`.
    - `global_roots_require_global_root`.
    - `malformed_skill_skipped_with_note_not_thrown`, `skill_conflict_with_host_skipped_with_note`.
    - `skill_escaping_trusted_root_skipped`.
    - `claude_md_used_when_agents_md_absent`, `agents_md_wins_over_claude_md`.
    - `allowed_tools_metadata_grants_nothing`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/discover-skills.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new config field and default behavior.
    - Docs pages to create/edit:
      - `packages/context/files/README.md`: config rows, "Skills" section (roots, precedence, trust, cost), `CLAUDE.md` rule; `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Config and roots.** `ContextFilesConfig.skills` is `{ enabled?: boolean; roots?: readonly string[] }`, enabled by default. Default order is `<root>/.agents/skills`, `<root>/.claude/skills`, then `<globalRoot>/.agents/skills`, `<globalRoot>/.claude/skills`, `<globalRoot>/.codex/skills` when `globalRoot` is set. `roots` replaces the defaults when present (including an explicit empty list, which disables scanning); relative entries resolve against `root`, and custom roots are project roots, so an absolute root outside `root` needs `trustedRoots`. No `HOME` lookup exists anywhere.
  - **Discovery.** New `packages/context/files/src/skills.ts` scans each root one level with one `readdir`, sorts entries for deterministic first-wins, resolves each candidate and root with `realpath`, and skips duplicate roots (so this repo's `.claude/skills` symlink to `.agents/skills` is read once). Each `SKILL.md` is size-checked against `HARD_MAX_SKILL_INSTRUCTION_BYTES`, read once, parsed by `parseSkillFile`, and registered through `prism.skills.register`; nothing under a skill directory is imported or executed. `allowed-tools` stays metadata and grants no tool.
  - **Trust and precedence.** A project root and every project `SKILL.md` realpath are checked through the package's existing `createPathTrustPolicy`; a skill escaping the trusted roots is skipped with a warning naming the candidate path. Global roots are user-owned and skip that gate, matching `globalRoot`'s existing rule. Project roots precede global roots; a duplicate skill name is skipped with an `info` note naming both the later path and the first source.
  - **Failure policy.** Missing roots are silent. Malformed/oversized files, untrusted paths, duplicate names, and `skill_conflict`/`skill_too_large` from registration each produce one `status.note` naming the path; every per-skill error is caught, so setup never throws for a discovered skill. A root-level `readdir`/`realpath` failure is also noted and skipped.
  - **`CLAUDE.md` fallback.** `layers.ts` gains `agentsMdFallbackPaths`, index-aligned with `agentsMdPaths`. The package supplies `<dir>/CLAUDE.md` for each candidate `<dir>/AGENTS.md`; the layer reader chooses `AGENTS.md` when present and otherwise reads the fallback, never both. Both mtimes are recorded, so creating an `AGENTS.md` later takes over from an existing `CLAUDE.md` and editing/removing either invalidates the cache. Explicit `files` have no fallback.
  - **Docs and example.** The package README documents the config rows, default/root precedence, realpath de-duplication, trust, one-time cost, duplicate/failure notes, and the `CLAUDE.md` rule; the package CHANGELOG and root CHANGELOG have the Added entries. `examples/discover-skills.ts` now loads `@arnilo/prism-context-files` with the committed example workspace, proves the package registered `greeter` during setup, and runs it with eager disclosure so the discovered instruction reaches the mock provider; `examples/README.md` names that.
  - **Coverage.** 40 package tests pass (11 new in `skills.test.ts`), including directory discovery, symlinked-root de-duplication, project-over-global precedence with a note, no-home-without-`globalRoot`, malformed and oversized skips, host conflict, trust escape, enabled/root replacement, both `CLAUDE.md` cases, and inert `allowed-tools`. `bun run typecheck` and `tsc -p examples --noEmit` pass, and the docs example test (`examples_demos_run_to_completion_and_emit_no_secret`) passes with the rewritten demo.
  - **Release gate.** `bun scripts/release.mjs gate --update-baseline` passes. Kernel ceilings are 1127827 packed / 3679203 unpacked (the root CHANGELOG entry only; package/example files are outside the kernel tarball); source lines remain 38403. The context-files compat baseline records the additive config type plus the internal `planSkillRoots`/`registerDiscoveredSkills` declarations; the kernel baseline keeps the Task 3/4 removals and value changes.
  - **Limits.** Skill discovery is setup-only, so a skill added while an agent is running is seen by the next agent load, not the next turn. Global roots are not realpath-contained beyond their configured directory (user-owned, matching the existing global rule).

- [x] Task 6: Skill directories are readable, never writable
  - Acceptance Criteria:
    - Functional: For `read`, `glob`, `grep`, and `diagnostics` (plan 189), `coding.targets` reports `roots` as the coding roots plus the directory of every effective skill that has a `path` (`dirname(skill.path)` from `prism.skills.list()`, read lazily after setup and cached until the skill list changes). The hard-deny hook allows those calls under a skill directory. For every other tool the roots are unchanged, so `write`, `edit`, `delete`, `move`, and `shell` paths under a skill directory outside the workspace are still denied.
    - Functional: `@arnilo/prism-approval`, which reads `coding.targets`, sees the same roots; a read under a skill directory needs no extra approval in `auto`.
    - Performance: One `prism.skills.list()` per agent until the list changes; containment adds one realpath per skill directory, done once.
    - Code Quality: No kernel change and no tool reads skill state; the extension lives in `targets.ts` and `hard-deny.ts`.
    - Security: A symlink inside a skill directory that escapes it is denied (the existing realpath containment). The test proves `write` to a global skill directory is denied while `read` of its `references/x.md` succeeds.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/targets.ts`, `src/hard-deny.ts:44-90`, `src/index.ts:196-200`; Task 1 (f); `src/packages/api.ts:102`.
    - Options Considered:
      - Inline `references/` files into the `load_skill` result. Rejected: skills reference large files on purpose so they load only when needed.
      - Ask hosts to add skill directories to `roots`. Rejected: `roots` grants write access too.
    - Chosen Approach:
      - Read-only roots derived from the skill list, for read-effect tools only.
    - API Notes and Examples:
      ```ts
      targets("read", { path: "~/.agents/skills/pdf/references/forms.md" }) // roots include ~/.agents/skills/pdf
      targets("write", { path: "~/.agents/skills/pdf/x.md" })              // roots do not → hard deny
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/targets.ts`, `src/hard-deny.ts`, `src/index.ts`, `src/__tests__/hard-deny.test.ts`, `src/__tests__/targets.test.ts`, `packages/tools/coding/README.md`, `CHANGELOG.md`.
    - References:
      - Task 3 (the directory in the `load_skill` header).
  - Test Cases to Write:
    - `read_under_skill_dir_outside_root_allowed`.
    - `write_under_skill_dir_outside_root_denied`, `shell_unaffected_by_skill_dirs`.
    - `skill_dir_symlink_escape_denied`.
    - `targets_roots_follow_skill_list_changes`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — what the hard deny allows.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: "Hard denies and the `coding.targets` service" — read-only skill roots; `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Service shape.** `createCodingTargets` gains an optional fourth argument, `() => readonly Skill[]`; `index.ts` passes `() => prism.skills.list()`. For `read`, `glob`, `grep`, and `diagnostics` its `roots` are the coding roots (the session's worktree when bound, else `root`, plus `roots`) followed by the deduplicated `dirname(skill.path)` of every effective skill with an absolute path. Every other own tool keeps the old roots, so `write`, `edit`, `delete`, `move`, `shell`, and `shell_output` never see a skill directory. The helper lives in `targets.ts`; `hard-deny.ts` only needed a comment because it already enforces `targets.roots` for every path argument. Approval consumes the same service, so a read under a skill directory is inside its roots in `auto` and needs no extra prompt.
  - **Cache and cost.** The derived directories are cached under a JSON signature of the effective skills' paths, so the dirname/dedupe work is skipped until the list changes; a changed list adds or removes roots on the next read-effect call, and a failed `skills()` read keeps the last good roots. The public skills API has no change signal, so a read-effect call reads the list to notice a registration; non-read tools never call it. Containment itself is unchanged: one `realpath` per root per decision, cached inside the checker, and one per path argument. No directory walk and no read of a `SKILL.md`.
  - **Security.** Skill directories are read roots only. A symlink inside one that escapes it fails the existing realpath containment, and a write to a global skill directory is still outside `reason: "outside coding roots"`. `shell` remains unchanged because it has no path argument and can already touch whatever the host permits. Relative skill paths are ignored; discovery stores absolute paths.
  - **Tests.** Added to `src/__tests__/hard-deny.test.ts` (there was no `targets.test.ts`; the existing `coding.targets` service test already lives there): `read_under_skill_dir_outside_root_allowed_and_write_denied` (host skill outside `root`, real `read` succeeds, `write` is denied, `shell` roots unchanged), `skill_dir_symlink_escape_denied`, and `targets_roots_follow_skill_list_changes` (add/remove skills, all four read tools gain the root, every mutating tool does not).
  - **Docs and release.** `packages/tools/coding/README.md` documents the exception, the read-only rule, the lazy/cached source, the optional argument, and symlink containment. Added the package CHANGELOG entry under Changed and the root CHANGELOG entry. The compat baseline change is the additive optional `createCodingTargets` parameter only. Kernel budgets are 1128084 packed / 3679827 unpacked, solely the root CHANGELOG entry; source lines remain 38403 and no kernel file or dependency changed.
  - **Verification.** 14/14 `hard-deny.test.ts` tests pass, the full coding package passes 623 with 3 skipped, the approval package passes 10/10, package typecheck passes, `git diff --check` is clean, and the release gate passes (baseline regenerated with `--update-baseline`).
  - **Limit.** Because the public skills API exposes no revision, the path signature is recomputed from `prism.skills.list()` on each read-effect call; the cached part is the directory derivation, not the list read. A host that lists thousands of skills on every read pays an O(skills) array copy there.

- [x] Task 7: Nested instruction files, just in time
  - Acceptance Criteria:
    - Functional:
      - Config `nested?: boolean | { maxFileBytes?: number; maxFiles?: number }` on `context-files`, default `true` (`maxFileBytes` 16,384, hard cap 65,536; `maxFiles` 16 per session).
      - The `context.build` handler scans `draft.messages` for coding tool results whose call (paired by `toolCallId`, Task 1 (i)) names a file path under `root`.
      - For every directory strictly between `root` and that file's directory that holds `AGENTS.md`, or `CLAUDE.md` when `AGENTS.md` is absent (the Task 5 rule), and has not been inserted earlier in the provider view:
        - in the provider view only, that tool result message gets one extra text part: `[context-files] Instructions for <dir>/ (from <dir>/AGENTS.md):` followed by the file text. **The text part must actually reach the wire:** `serializeToolResultText` currently returns `tool_result.result` and drops trailing text parts (`src/provider-kit/openai-primitives.ts:52-65`), so extend that shared serializer to append trailing `text` blocks (and cover both codecs), or append the insertion into `result`.
        - the message's metadata gains `contextFiles: ["<rel path>"]`, `source: "context-files-nested"`
        - an extra part on the existing message, rather than a new message, keeps role alternation valid on every provider route (a user message between a tool result and the next assistant turn is rejected or merged on some routes; Task 1 (i) records which)
        - plan 192 (step 8) builds its untrusted envelope when the tool message is built, before `context.build`, so this part always sits outside it; plan 192 Task 2 has the test
      - The root's own and parent layers keep today's system-prompt behavior; only deeper files are disclosed this way.
      - **Frozen bytes.**
        - The first insertion's text is stored in session state keyed by `toolCallId` and path, so later requests reproduce byte-identical messages even if the file changes.
        - A changed file is picked up at the next tool result that touches that directory after a compaction removed the earlier insertion.
        - The insertion is a deterministic projection of the history, so the prefix stays cacheable from the turn it first appears.
      - **Compaction.** When compaction removes the anchoring tool result, the insertion goes with it, and the next touch of that directory inserts it again.
      - Over `maxFiles`, or a file over `maxFileBytes`, gives one `status.note("info", …)` naming the path; the file is skipped, not truncated.
    - Performance:
      - One `stat` per candidate directory per new tool result, and one read per file per session (cached by path and mtime like the root layers).
      - No work on requests without new tool results.
      - The README states the cost and that `nested: false` restores the current behavior.
    - Code Quality:
      - Lives in `packages/context/files/src/nested.ts`.
      - Reuses the trust gate, the candidate-chain helper (`agentsMdCandidates`, `src/index.ts:73-83`), and the Task 5 `CLAUDE.md` rule.
      - No kernel change: `context.build` returns `{ ...draft, messages }` (the seam plan 188 Task 1 (a) verifies).
      - The tool-name and path-argument map comes from Task 1 (i) as data: `read`/`edit`/`write`/`diagnostics` use `path`; `grep`/`glob` require `pattern` and take an optional directory `path`, so only their `path` can count as a directory touch; `move` uses `from`/`to`; `shell` has none.
    - Security:
      - A nested file whose realpath escapes the trusted roots is skipped with a warning, like root-chain files today.
      - Inserted text is project instructions (`source: "app"` rank); it never comes from tool output.
      - A path in a tool call outside `root` is ignored.
  - Approach:
    - Documentation Reviewed:
      - `packages/context/files/src/{index,layers,config}.ts`, `README.md`; Task 1 (i); Task 5
      - Claude Code memory docs (subdirectory `CLAUDE.md` files are loaded when Claude reads files in those subtrees; find-docs, record the date)
      - Codex `AGENTS.md` docs (nested files apply to their subtree)
      - Anthropic, "Effective context engineering for AI agents" (2025): just-in-time context
      - Chroma "Context Rot" (2025): unrelated instructions are distractors
    - Options Considered:
      - Load every nested `AGENTS.md` into the system prompt at session start. Rejected: in a monorepo most subtrees are unrelated to the task, and those files would be distractors in every request.
      - Re-read the file on every request. Rejected: an edit to the file mid-session would rewrite an earlier message and break the cache; frozen bytes avoid it.
      - Append nested files to the system prompt when first touched. Rejected: a system-prompt change invalidates the whole cached conversation.
      - Insert at the tail. Rejected: the tail moves every turn; anchoring on the tool result that caused it keeps the text in a fixed position.
      - A separate user message after the tool result. Rejected: role alternation (above).
    - Chosen Approach:
      - Anchor each nested instruction file after the first tool result that touched its subtree, with frozen bytes.
    - API Notes and Examples:
      ```text
      [tool result: read packages/api/src/routes.ts]
      1  import { route } from "./router";
      …
      [context-files] Instructions for packages/api/ (from packages/api/AGENTS.md):
      Run `bun test --cwd packages/api` after changing routes.
      ```
    - Files to Create/Edit:
      - `packages/context/files/src/nested.ts` (new), `src/index.ts`, `src/config.ts`, `src/__tests__/nested.test.ts` (new)
      - `src/provider-kit/openai-primitives.ts` and both codec conformance tests (make a trailing text part on a tool result reach the wire; Task 1 (i))
      - `packages/context/files/README.md` ("Nested instruction files": rule, cost, config)
      - `apps/prism-agent` scenario fixtures, if a scenario reads a file under a directory with an `AGENTS.md` (the note says which)
      - `CHANGELOG.md` (Added)
    - References:
      - Task 5 (`CLAUDE.md` rule); plan 189 (tool names); plan 194 Task 4 (folded tool results keep their `toolCallId`, so the anchor survives folding)
  - Test Cases to Write:
    - `nested_agents_md_appended_to_first_touching_tool_result`: the part is on that message, and no new message is added.
    - `nested_tail_text_part_reaches_both_codecs`: the serialized openai-chat and anthropic-messages payloads contain the inserted text (breaks if the serializer keeps dropping trailing text blocks).
    - `nested_insertion_once_per_directory`: two reads in the same subtree, one insertion.
    - `nested_insertion_bytes_frozen_after_file_change`: edit the file mid-session; earlier requests' bytes are unchanged (breaks if it re-reads per request).
    - `nested_insertion_reappears_after_compaction_on_next_touch`.
    - `nested_claude_md_used_when_agents_md_absent`.
    - `nested_file_escaping_trusted_root_skipped`.
    - `nested_over_limits_skipped_with_note`.
    - `nested_false_restores_root_only_behavior`.
    - `path_outside_root_ignored`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new config field and default behavior.
    - Docs pages to create/edit:
      - `packages/context/files/README.md`: config row, "Nested instruction files" section, cost
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-24)

  - **Config and handler.** `nested` is `true` by default, `false` disables it, and the object form validates `maxFileBytes` (default 16,384; hard cap 65,536) and `maxFiles` (default and hard cap 16) through `contextFilesConfigSchema`. `install` registers the root/system layer transform first, then `installNested` registers a second `context.build` transform. The nested transform scans `draft.messages`, pairs each `tool_result.toolCallId` with its assistant `tool_call`, and appends one text part to that same tool message; it does not add messages or change `systemPrompt`. Metadata gains `contextFiles` and `source: "context-files-nested"`. The root's own and parent layers remain system-prompt layers.
  - **Path rule.** `nested.ts` implements the Task 1 (i) map as data: `read`/`edit`/`write`/`diagnostics` use `path`; `grep`/`glob` use their directory `path`; `move` uses `from`/`to`; `shell`/`shell_output` have none. Candidates are root-exclusive, target-inclusive and outermost-first, so a file's own directory's `AGENTS.md` applies too (the root itself stays in the system prompt). `AGENTS.md` wins; `CLAUDE.md` is used only when it is absent. A path outside `root` yields no candidates before any `stat`.
  - **Frozen bytes and compaction.** The first insertion is a `package_state` log record under key `nested` with `{ toolCallId, dir, file, part }`; later builds re-attach that exact part to the same tool result without touching the filesystem. Only records whose anchoring tool result is present in the current draft count as visible, so compaction removes the insertion with its anchor; a new tool result touching the same directory reinserts the then-current file. `maxFiles` counts distinct paths across the log, so a reinsertion after compaction does not consume a new slot. The agent-scoped `nested-sessions` cache holds processed call ids, path+mtime+size file text, and one-shot note keys.
  - **Serializer.** `serializeToolResultText` now appends trailing text parts to the result (and still uses an error message or sibling text when there is no result), so the append reaches both the OpenAI Chat and Anthropic Messages codecs instead of being dropped. It remains outside `tool_result.result`, which is the seam plan 192 needs.
  - **Security and limits.** Every chosen file goes through the package's `TrustPolicy` with `kind: "project"`; a realpath escape is skipped with `status.note("warn", …)` and never read. A file over `maxFileBytes` or a new path over `maxFiles` is skipped, not truncated, with one `status.note("info", …)` naming the absolute path. `agentsMdCandidates` moved from `index.ts` to `nested.ts` and `agentFileCandidates` exposes the `AGENTS.md`/`CLAUDE.md` pair from `layers.ts`, so the root layers and nested loader share the same rule. No `readdir`, no glob, no import, no new dependency.
  - **Tests.** New `src/__tests__/nested.test.ts` (10 tests) covers first-touch append and no new message, once-per-directory across a later turn, frozen bytes after a mid-session edit, reinsertion after the anchor is removed with the changed file, `CLAUDE.md` fallback, trusted-root escape, `maxFileBytes`, `maxFiles`, `nested: false`, and an outside-root path. New codec tests in `src/__tests__/openai-primitives.test.ts` and `src/__tests__/anthropic-messages.test.ts` prove a trailing text part reaches both wire payloads.
  - **Docs and release.** `packages/context/files/README.md` gained the config row, the "Nested instruction files" rule, cost, frozen/compaction behavior, trust rule and `nested: false`; its transcript/storage and capabilities wording now distinguishes package session state. Package and root CHANGELOG entries added. `scripts/budgets.json` is rebaselined to 1128660 packed / 3681384 unpacked (root CHANGELOG plus the shared serializer; source lines stay 38403), and the context-files compat baseline records the additive config and internal nested declarations. No kernel export or file count changed; no app scenario fixture has a nested `AGENTS.md`, so none changed.
  - **Verification.** Package suite 50/50; targeted kernel codec/provider suites 44/44 and 64/64; `@arnilo/prism-agent` 38/38; full `bun run typecheck`; `docs.test.ts` plus provider-kit/public-export 114/114; `bun scripts/release.mjs gate` passes.
  - **Limit.** Nested files are `stat`ed only for a new tool result, but every request re-applies the frozen parts in memory. A session log record is appended per first insertion (and per reinsertion after compaction), bounded in distinct files but not in total compaction cycles; this is package session state, not the transcript.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/contribution-parsing.test.ts src/__tests__/skills.test.ts src/__tests__/skill-load.test.ts src/__tests__/skill-disclosure.test.ts src/__tests__/input-pipeline.test.ts src/__tests__/public-export-contract.test.ts`
- `bun --cwd packages/context/files run build && bun --cwd packages/context/files test --timeout=0`
- `bun --cwd packages/tools/coding test --timeout=0`
- `bun --cwd packages/policy/approval test --timeout=0`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
