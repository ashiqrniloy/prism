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

**0.13.0 release path — plan 190, step 6 of 14.** Amended 2026-10-17 by the context-rot review (owner decision: all findings ship in 0.13.0): Task 3 gains run-scoped re-attach, Task 1 gains checks (h)–(i), and Task 7 (nested instruction files just in time) is new. Owner decision 2026-10-17 (see plan 189's header). Start this plan when plan 189 is complete; when it is complete, continue with plan 191. It must run before plan 184 because Task 3 changes where a loaded skill body sits in the request (184 Task 2's fixture loads a skill mid-session), and before plan 185 because it changes kernel exports (`parseAgentFile`'s result, `SkillDisclosureError` retired). It changes kernel contracts (frontmatter parsing, the `load_skill` result, catalog rendering and its error policy), so **Task 1 is the phase review**. It implements roadmap §2.1's skills row ("`SKILL.md` directory discovery, progressive/eager disclosure, `load_skill`") and Phase 7's `context-files` row; it adds no hook, slot, or `PackageAPI` member — discovery uses the existing `prism.skills.register`. Docs go to the promoted `/docs` pages (`docs/agent.md` "Tools and skills", `docs/resource-loading.md`) and the `context-files` and `tools-coding` READMEs. No version bump, publish, or npm deprecation. Reference host impact: the coding worker loads `context-files` and kernel skills, so Task 5's discovery and Task 3's `load_skill` result must keep the reference host's scenarios green (the golden JSONL fixture changes if a scenario loads a skill).

## Tasks

- [ ] Task 1: Phase review (read-only)
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

- [ ] Task 2: Frontmatter that other agents write
  - Acceptance Criteria:
    - Functional: `splitFrontmatter` (`src/contribution-parsing.ts:13-70`) parses the Task 1 (a) subset: block scalars (`|`, `>`, with `-`/`+` chomping), single- and double-quoted scalars (with `''` and backslash escapes), plain scalars continued on more-indented lines (folded with spaces), nested maps by indentation, and block and flow lists. Values stay strings (no number or boolean coercion), so `metadata` keeps its current JSON-safe shape, now with nested objects instead of flattened keys.
    - Functional: Input outside the subset (anchors, aliases, tags, multi-document) fails with `Malformed frontmatter in <path>: <reason> at line N`; it never silently mis-assigns keys as it does today (a folded line containing `:` became a metadata key on 2026-10-17).
    - Functional: `parseAgentFile` returns the body as `instructions` and `description` as a top-level field, alongside `name` and `metadata` (`AgentFileDeclaration`, `src/contribution-parsing.ts:112-140`), so plan 191 Task 6 can read subagent files.
    - Functional: Fixtures: copies of the six `.agents/skills/*/SKILL.md` frontmatters plus the Task 1 (a) samples live under `src/__tests__/fixtures/frontmatter/`; each parses to a recorded expected value.
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
    - `frontmatter_folded_block_scalar` (the `find-docs` case), `frontmatter_plain_multiline_scalar` (the `graft` case), `frontmatter_quoted_scalars_unquoted`, `frontmatter_nested_metadata_is_object`, `frontmatter_block_and_flow_lists`.
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

- [ ] Task 3: `load_skill` returns the body; restore it only after compaction
  - Acceptance Criteria:
    - Functional: A successful `load_skill` returns `Loaded skill <name>. Skill directory: <dir>. Paths in these instructions are relative to it.` followed by a blank line and the skill's instructions. The tool message carries `metadata.loadedSkill: <name>` (the marker Task 1 (d) chose). `MAX_LOAD_SKILL_RESULT_BYTES` becomes `HARD_MAX_SKILL_INSTRUCTION_BYTES` plus the header; failure texts keep their current bound.
    - Functional: Loading a skill that is already loaded returns `Skill <name> is already loaded; its instructions are earlier in this conversation.` as a normal result, not an error (today it is `skill_load_failed`, `src/skill-load.ts:139`).
    - Functional: In progressive disclosure, `appendSkillTailSegments` no longer appends loaded bodies on every request. It appends a loaded skill's body only when no provider-visible message carries `metadata.loadedSkill: <name>` (compaction or folding removed it), and then the marker on that tail message keeps it from being added twice. Eager disclosure is unchanged.
    - Functional: **Run-scoped re-attach.** After compaction removed a loaded skill's tool message:
      - only skills loaded during the **current run** (Task 1 (h)) get their body re-attached at the tail
      - skills loaded in earlier runs are removed from the loaded set, and one tail line names them: `Previously loaded skills (load again if needed): <names>`, sorted, capped at 16 names then `(+N)`
      - a later `load_skill` for such a name returns the full body (not "already loaded")
      
      A compacted session therefore carries the bodies of the task in progress, not every skill the session ever touched. This is progressive disclosure that also unloads: Anthropic's context-engineering guidance and Claude Code's compaction re-attach only invoked skills; Du et al. 2025 show added length alone lowers accuracy.
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
      - `src/skill-load.ts`, `src/input.ts`, `src/agent-run-restore.ts` (only if Task 1 (d) needs it), `src/testing/prefix-stability-conformance.ts`, `src/__tests__/skill-load.test.ts`, `src/__tests__/skill-disclosure.test.ts`, `src/__tests__/input-pipeline.test.ts`, the prefix-stability conformance test, `examples/skills-progressive-disclosure.ts` (expected output), `scripts/compat-baseline/arnilo__prism.txt` (constant value), `docs/agent.md`, `docs/tools.md`, `CHANGELOG.md`.
    - References:
      - Plan 184 Task 2.
  - Test Cases to Write:
    - `load_skill_returns_body_with_directory_header`: fails if the body is missing from the result.
    - `load_skill_already_loaded_is_not_an_error`.
    - `loaded_body_not_reappended_while_tool_result_visible`: tail is empty on later requests.
    - `loaded_body_reattached_once_after_compaction`: drop the tool message, next request has one tail copy, the one after has the same single copy (stable).
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

- [ ] Task 4: One catalog block, and no run fails because of a skill
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

- [ ] Task 5: `context-files` discovers skills and reads `CLAUDE.md`
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

- [ ] Task 6: Skill directories are readable, never writable
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

- [ ] Task 7: Nested instruction files, just in time
  - Acceptance Criteria:
    - Functional:
      - Config `nested?: boolean | { maxFileBytes?: number; maxFiles?: number }` on `context-files`, default `true` (`maxFileBytes` 16,384, hard cap 65,536; `maxFiles` 16 per session).
      - The `context.build` handler scans `draft.messages` for coding tool results whose call (paired by `toolCallId`, Task 1 (i)) names a file path under `root`.
      - For every directory strictly between `root` and that file's directory that holds `AGENTS.md`, or `CLAUDE.md` when `AGENTS.md` is absent (the Task 5 rule), and has not been inserted earlier in the provider view:
        - in the provider view only, that tool result message gets one extra text part: `[context-files] Instructions for <dir>/ (from <dir>/AGENTS.md):` followed by the file text
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
      - The tool-name and path-argument map comes from Task 1 (i) as data.
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
      - `packages/context/files/README.md` ("Nested instruction files": rule, cost, config)
      - `apps/prism-agent` scenario fixtures, if a scenario reads a file under a directory with an `AGENTS.md` (the note says which)
      - `CHANGELOG.md` (Added)
    - References:
      - Task 5 (`CLAUDE.md` rule); plan 189 (tool names); plan 194 Task 4 (folded tool results keep their `toolCallId`, so the anchor survives folding)
  - Test Cases to Write:
    - `nested_agents_md_appended_to_first_touching_tool_result`: the part is on that message, and no new message is added.
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
