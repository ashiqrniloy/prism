# Phase 11 Part P — coding tools: agent ergonomics and tool-set reduction

## Objectives

- Make every tool result reach the model as the text the tool produced: no JSON string escaping, errors flagged as errors, and images from `read` delivered on the routes that support them.
- Fix the coding-tool defects an agent hits on every turn: `read` without line numbers, literal-only search with duplicated context, `glob` rejecting brace patterns, silent fuzzy edits, schema fields that describe host settings, and the forced "exactly 3 pros and 3 cons".
- Cut the registered tool set from 19 to the tools an agent actually reaches for, and give each kept tool one clear job.
- Turn the two tested but unregistered libraries an agent needs — background processes and language diagnostics — into tools, and delete the unregistered modules nothing uses.

## Expected Outcome

- A `read` of a file with quotes and tabs reaches the model on the OpenAI Chat and Anthropic Messages routes as the file's text with line-number prefixes, not as a JSON-quoted string. A failed tool call carries `is_error: true` on the Anthropic route. An image from `read` reaches an image-capable model on the Anthropic route as an image block inside the `tool_result`.
- `tools-coding` registers by default: `read`, `write`, `edit`, `glob`, `grep`, `shell`, `shell_output`, `git_status`, `git_diff`, `git_commit`, `git_pr_handoff`, `todo_write`, `ask_user_decision`, plus `coding_check` when checks are configured and `diagnostics` when language servers are configured. `delete` and `move` register only when the shell is off. `repo_list`, `repo_search`, `git_branch`, `git_apply`, and `git_worktree` are gone.
- `grep` takes a regular expression by default (`literal: true` for a fixed string), runs it in a killable Worker so a catastrophic pattern ends at the time cap instead of hanging the process, and prints ripgrep-style output with merged context and line numbers on every line.
- `edit` matches exactly, reports the changed lines with line numbers, and tells the agent when `oldText` contains `read` line-number prefixes.
- `review.ts`, `lifecycle.ts`, and `coding-checkpoint.ts` are deleted from `tools-coding`, with their tests, fixtures, and baseline lines.

**0.13.0 release path — plan 189, step 5 of 14.** Owner decision 2026-10-17: the coding-tool, skills, and delegation fixes from the 2026-10-17 agent-perspective evaluation ship in 0.13.0, as plans 189 (this plan), 190 (skills), and 191 (delegation). Start this plan when plan 188 is complete; when it is complete, continue with plan 190. Plans 189–191 run **before** plan 184 on purpose: Task 2 changes the bytes of every tool-result message on the wire, and plan 190 Task 3 changes where a loaded skill body sits in the prompt, so the cache-parity measurement (184) has to see the final request shape. They also run before the surface freeze (185) because they remove and rename `tools-coding` exports and change `@arnilo/prism` provider-kit exports. This plan changes a kernel contract (how `provider-kit` codecs encode `tool_result`) and the `tools-coding` public surface, so **Task 1 is the phase review**. It is not a roadmap Part 4 scope item: it implements roadmap Phase 7's `tools-coding` row ("fs, edit, grep, shell", §2.9) more faithfully, and it reverses the plan 001/plan 004 decision to keep repository search literal-only (Task 4 records why the original ReDoS concern is answered). Docs: `docs/next/` was promoted into `/docs` before this plan (`src/__tests__/docs.test.ts:315` asserts it is gone), so kernel changes are documented in the `/docs` API pages and package changes in the package README (`.agents/skills/create-plan/references/prism-wiki.md`). No version bump, publish, or npm deprecation. Reference host impact: the coding worker (`apps/prism-agent/src/host/coding.ts`) registers `tools-coding`, so its scenarios (approval, golden JSONL) must stay green after the tool renames and removals; each task that changes a tool name or output updates any scenario fixture that names it.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Wire inventory.** Every encoder that turns a `role: "tool"` message into wire bytes after plan 182 lands: the OpenAI Chat codec (`src/provider-kit/codecs/openai-chat.ts`, formerly `openai-primitives.ts:60-81`), the Anthropic Messages codec (`src/provider-kit/codecs/anthropic-messages.ts`, formerly `anthropic-messages.ts:129-150`), Hyper's and OpenCode Go's own serializers if plan 183 kept any (`packages/providers/hyper/src/openai-chat.ts:39`, `packages/providers/opencode-go/src/openai-chat.ts:50` before 183), and the System One codec (expected: no tool messages — `systemone-provider.ts:73` rejects tools). For each: what it sends for a text result, a structured `value`, an error, and an image block today.
      - (b) **Image-in-tool-result support** per route, from vendor docs (find-docs, record the dates): Anthropic Messages accepts `image` blocks inside `tool_result.content`; OpenAI Chat Completions accepts only text in `role: "tool"` messages. Record what Hyper and OpenCode Go accept on each route, from a recorded request if the docs are silent (plan 182 Task 5's wire proxy).
      - (c) **Every caller** of the symbols this plan removes or renames, from `graft callers <symbol> --depth all`: `serializeToolResultJson`, `createRepoListTool`, `createRepoSearchTool`, `createGitTools` (its returned set), `normalizeForFuzzyMatch`, `fuzzyFindText`, `EditToolDetails.fuzzy`, `AskUserDecisionOption.pros/cons`, `CODING_TOOL_NAMES`, and every export of `agent/review.ts`, `agent/lifecycle.ts`, `agent/coding-checkpoint.ts`. The 2026-10-17 survey found the last three used only by their own tests, `scripts/fixtures/phase26-coding-journey.mjs`, `scripts/phase{10,26}-freeze-manifest.json`, and the compat baselines; confirm or correct.
      - (d) **Tool-name references** outside the package for `repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree` (the survey counted 24 and 27 files for the first two, mostly provider tests that use `repo_list` as an arbitrary tool name). Each gets a disposition: rename the fixture name or leave it (an arbitrary name in a provider test is not a reference to the tool).
      - (e) **Process sessions and sandboxes.** Whether `createProcessSessions` (`agent/process/sessions.ts:10`) runs under each `sandbox` backend (`ProcessSandboxBackend`; `security/__tests__/docker-sandbox.test.ts:1016` uses it under Docker), and what it needs from the host (`maxLifetimeMs`, recovery record dir).
      - (f) **Language intelligence options.** The `createLanguageIntelligence` options shape (`agent/language/intelligence.ts:48`) and what a host must supply to get diagnostics for one file (server command, root, file extensions), from `examples/phase9-coding-intelligence.ts:81`.
      - (g) **Regex worker feasibility.** That `new Worker(new URL(..., import.meta.url))` loads from package TypeScript source under Bun with no build step, and the cost of starting one worker (median of 20 starts on the dev machine).
      - (h) **Approval coupling.** Where `@arnilo/prism-approval` reads `coding.targets` or tool names, so the removed and renamed tools do not leave a stale rule.
    - Functional: The note ends with a verdict. A finding that invalidates a later task stops the plan for a re-cut.
    - Performance: n/a — read-only.
    - Code Quality: No code changes and no new files outside this plan.
    - Security: The review confirms the hard-deny hook (`hard-deny.ts:81-84`) still covers every path-taking tool after the rename (`grep`) and the new `diagnostics` tool.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9 (`tools-coding` row), Phase 7 Scope; `PRODUCT.md`; plan 001 Task notes (`repo_search` literal-only, ReDoS), plan 004 line 47; plan 182 Tasks 5–7; plan 183 Tasks 2–3.
    - Options Considered:
      - Skip the review because the tools are package code. Rejected: Task 2 changes provider-kit codecs, a kernel subpath.
    - Chosen Approach:
      - A read-only inventory whose findings the later tasks cite.
    - API Notes and Examples:
      ```bash
      graft callers serializeToolResultJson --depth all
      graft grep "repo_search"
      ```
    - Files to Create/Edit:
      - `plans/189-Phase-11-Part-P-Coding-Tools-Agent-Ergonomics-And-Tool-Set-Reduction.md` (task note only).
    - References:
      - The 2026-10-17 evaluation (this plan's Objectives); `packages/tools/coding/README.md`.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit:
      - none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Tool results reach the model as text
  - Acceptance Criteria:
    - Functional: `serializeToolResultJson` is replaced by `serializeToolResultText(message): string` in the OpenAI Chat codec. When the tool result payload is a string (the joined text blocks, `src/input.ts:339-347`), it is sent unchanged. A structured `ToolResult.value` is still sent as `JSON.stringify(value)`. An error is sent as its `message` text. The empty sentinel (`EMPTY_TOOL_RESULT_TEXT`) is unchanged.
    - Functional: The Anthropic Messages codec sends `tool_result.content` as an array: the text block from `serializeToolResultText`, then one `image` block per image content block in the tool message (resolved through the existing `resolvedMedia` path) when the model declares image input. It sets `is_error: true` when the result has an error. A model without image input gets a text block `"[image omitted: the model does not accept images]"` instead of the image, never a request the vendor rejects.
    - Functional: The OpenAI Chat codec cannot put an image in a `role: "tool"` message, so for an image-capable model it appends one `role: "user"` message right after the tool messages of that round, with the images and the text `"Images returned by <tool name> (<toolCallId>):"`. Without image input it adds the same omitted-image note to the tool message text.
    - Functional: The retired name is swept: a repo-wide grep for `serializeToolResultJson` over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds nothing.
    - Performance: No extra allocation for text results beyond today's join. Encoded request bytes for a ten-turn scripted coding loop on the replay harness drop compared with the JSON-escaped encoding; the test records both numbers and asserts the new one is smaller.
    - Code Quality: One serializer used by both codecs; no vendor names in the codecs. The `ToolResult` and `Message` contracts are unchanged.
    - Security: Tool text is already redacted before it becomes a message (unchanged); the test asserts a redacted secret placeholder survives encoding unchanged and no raw secret appears (`assertNoSecretLeak`).
  - Approach:
    - Documentation Reviewed:
      - `src/input.ts:322-351` (`toToolResultMessage`, `toolResultPayload`); `src/provider-kit/openai-primitives.ts:60-81`; `src/provider-kit/anthropic-messages.ts:129-150`; Task 1 (a)–(b); Anthropic Messages `tool_result` content and `is_error` docs and OpenAI Chat `tool` message docs (find-docs; record versions and dates).
    - Options Considered:
      - Keep JSON for every payload. Rejected: the model sees `"line \"one\"\n\tline two"` (reproduced 2026-10-17), which costs tokens on every read and makes exact `edit.oldText` harder to copy.
      - Drop images on routes that cannot carry them in a tool message. Rejected: a follow-up user message is the documented way to give an image to an OpenAI Chat model, and `read` advertises image support.
    - Chosen Approach:
      - Send text as text, keep JSON only for structured values, carry images where the route allows, and say so in text where it does not.
    - API Notes and Examples:
      ```ts
      serializeToolResultText(toolMessage) // "line \"one\"\n\tline two" → line "one"<LF><TAB>line two
      // Anthropic: { type: "tool_result", tool_use_id, is_error?: true, content: [{ type: "text", text }, { type: "image", source }] }
      ```
    - Files to Create/Edit:
      - `src/provider-kit/codecs/openai-chat.ts`, `src/provider-kit/codecs/anthropic-messages.ts` (paths after plan 182 Task 6–7), `src/provider-kit/index.ts`, `packages/providers/{hyper,opencode-go}/src/*` (only if Task 1 (a) finds a private serializer left), `src/__tests__/openai-primitives.test.ts` (the `JSON.stringify("file AGENTS.md")` expectation at line 80), `src/__tests__/anthropic-messages.test.ts`, `src/__tests__/tool-result-content.test.ts`, `scripts/provider-tool-result-wire.test.mjs` (if it survives plan 182), `src/__tests__/public-export-contract.test.ts` (line 756 freeze entry), `scripts/compat-baseline/arnilo__prism.txt`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - Plan 182 Tasks 6–7 (codec moves); plan 184 Task 2 (prefix stability reads the new bytes).
  - Test Cases to Write:
    - `tool_result_text_is_sent_unescaped`: a result with quotes, tabs, and newlines encodes byte-for-byte; fails if `JSON.stringify` returns.
    - `tool_result_structured_value_is_json`: a `value` object still encodes as JSON.
    - `anthropic_tool_result_sets_is_error`: an error result has `is_error: true`.
    - `anthropic_tool_result_carries_image_block`: a `read` image result on an image-capable model has an `image` block in `tool_result.content`; fails if the block is dropped.
    - `anthropic_tool_result_image_without_capability_is_noted`.
    - `openai_chat_tool_image_follows_as_user_message` and `openai_chat_tool_image_without_capability_is_noted`.
    - `tool_result_encoding_is_smaller_than_json`: the replay-harness byte comparison.
    - `tool_result_redaction_survives_encoding`.
    - Run after the change: `bun scripts/release.mjs gate --update-baseline`; the task note records the `scripts/compat-baseline/arnilo__prism.txt` diff (`serializeToolResultJson` removed, `serializeToolResultText` added, attributed to this plan).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a provider-kit export is renamed and every tool result's wire encoding changes.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: "Tool results on the wire" — text sent as text, structured values as JSON, `is_error`, images per route.
      - `docs/tools.md`: "Outputs / response" — what the model sees for text, structured, error, and image results.
      - `CHANGELOG.md` `[Unreleased]` (Fixed, Changed).
    - `docs/index.md` update: no — pages are indexed and their scope sentences do not change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: `read` shows line numbers
  - Acceptance Criteria:
    - Functional: Each text line `read` returns is prefixed with its 1-based line number and a tab (`12\t  return 1;`). The truncation note's "continue with offset N" is unchanged, and `findText` pages start at the matching line with its real number.
    - Functional: The `read` description says the prefix is not part of the file. The `edit` description says to copy `oldText` without the prefix. `edit` fails with a hint (`"oldText includes read line-number prefixes (\"12\\t\"); remove them"`) when every line of an `oldText` that is not found starts with `\d+\t`; it never strips prefixes silently.
    - Functional: Image reads are unchanged.
    - Performance: The prefix costs a few characters per line; the 2000-line and 50 KB page caps now count the prefixed text, so a page never exceeds the caps.
    - Code Quality: Formatting happens once where the page text is built (`agent/read.ts:272-355`); the streamed byte counters stay on file bytes for offsets.
    - Security: n/a — formatting only; containment is unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/read.ts:272-355,510-587`; `agent/edit.ts:183,285-314`; Claude Code's `Read` output format (line number then tab) as the convention models already know.
    - Options Considered:
      - An opt-in `lineNumbers` argument. Rejected: a knob every model has to discover; line numbers are what agents need to cite `file:line` and pick offsets.
      - Auto-strip prefixes in `edit`. Rejected: a file line that really starts with digits and a tab would be corrupted.
    - Chosen Approach:
      - Always prefix, document it in both descriptions, and fail an `edit` with a precise hint.
    - API Notes and Examples:
      ```text
      1	export function foo() {
      2	  return 1;
      3	}
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/read.ts`, `agent/edit.ts`, `agent/edit-diff.ts` (the hint in `getNotFoundError`), `agent/__tests__/read.test.ts`, `agent/__tests__/edit.test.ts`, `packages/tools/coding/README.md` (tool reference), `CHANGELOG.md`.
    - References:
      - Task 6 (edit reports changed lines in the same format).
  - Test Cases to Write:
    - `read_prefixes_line_numbers`: lines 1–3 come back as `1\t…`; fails without the prefix.
    - `read_offset_page_keeps_real_line_numbers`: `offset: 40` starts at `40\t`.
    - `read_find_text_page_numbers_match_file`.
    - `read_page_caps_count_prefixed_text`.
    - `edit_rejects_read_prefixed_old_text_with_hint`.
    - `edit_does_not_strip_digit_tab_lines`: a file whose line really starts with `7\t` edits correctly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `read` output format.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: tool reference rows for `read` and `edit`; `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: `grep` — regex search in a killable worker
  - Acceptance Criteria:
    - Functional: `repo_search` is renamed `grep`. Its schema: `pattern` (required), `literal?` (default `false`), `path?`, `glob?` (a file filter using `matchGlobPattern`), `caseSensitive?` (default `true`), `includeHidden?`, `context?` (default `0`, hard 20), `maxMatches?`, `outputMode?` (`content` | `files_with_matches` | `count`). `mode` appears only when the host enabled an indexed mode (`SearchToolOptions.modes`, `agent/search.ts:34-38`); without one it is not in the schema. The handler for the removed `mode: "regex"` rejection (`search.ts:226-228`) is deleted.
    - Functional: `content` output is ripgrep-style: `path:line:text` for a match, `path-line-text` for context, and `--` between non-adjacent groups. Overlapping context windows in one file are merged, so no line prints twice (reproduced 2026-10-17: two matches three lines apart printed every context line twice, with `-`/`+` prefixes and no numbers).
    - Functional: A regex runs in a Worker. The main thread reads files through the existing bounded repository operations (so every sandbox backend works unchanged) and posts text batches. The worker compiles the pattern once (`maxPatternBytes`, invalid pattern → tool error naming the position) and returns matches. When `maxTimeMs` elapses, the main thread calls `worker.terminate()` and returns the matches so far with `truncatedBy: "time"`. Literal search stays on the main thread with no worker.
    - Functional: Every reference to the old name is updated in this task: `PATH_ARG_KEYS` and `CODING_TOOL_NAMES` (`targets.ts:23-36`), the hard-deny hook, descriptions of other tools that say "prefer repo_search", `@arnilo/prism-approval` rules if Task 1 (h) found any, `examples/coding-tools-capability-gaps.ts`, `scripts/phase26-freeze-manifest.json`, `docs/coding-security.md`, the README. `createRepoSearchTool` becomes `createGrepTool`. A repo-wide grep for `repo_search` and `createRepoSearchTool` (exclusions as in Task 2) finds only `CHANGELOG.md` history lines.
    - Performance: A regex search over this repository's `packages/` (the Task 1 (g) machine) costs at most the worker start time over the literal search of the same files, recorded in the task note. A pattern with catastrophic backtracking (`(a+)+$` over a 64 KB line of `a`s plus `b`) returns within `maxTimeMs` plus 100 ms.
    - Code Quality: The matcher is one pure function (`matchLines(text, compiled, context)`) used by the worker and by literal mode, so output formatting has one implementation. No new runtime dependency.
    - Security: The worker gets file text only, never paths outside the roots (the main thread resolves and contains paths as today). The pattern never reaches a shell. The ReDoS mitigation is now termination, not refusal: the note records that plan 001's concern ("uninterruptible RegExp on the main thread") no longer holds because the regex never runs on the main thread.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/search.ts:1-240`; `agent/repository/search.ts:11-40,166-168`; `agent/glob-match.ts`; `targets.ts:23-36`; `hard-deny.ts:44-90`; plan 001 (literal-only decision) and plan 004 line 47; Bun `Worker` docs (find-docs; record the Bun version); Task 1 (g).
    - Options Considered:
      - Keep literal-only. Rejected: regex is the main way an agent finds code (`function \w+` returned `(no matches)` on 2026-10-17), and `shell rg` bypasses the tool's containment and bounds anyway.
      - Spawn `rg` when installed. Rejected: a binary dependency and a second code path for sandbox backends.
      - A linear-time regex library (an RE2 port). Rejected: a new dependency and a syntax models do not expect (no backreferences or lookaround); termination answers the same risk with native syntax.
    - Chosen Approach:
      - Native `RegExp` in a Worker the main thread can terminate, files read by the existing bounded operations, one formatter.
    - API Notes and Examples:
      ```ts
      grep({ pattern: "function \\w+", glob: "**/*.ts", context: 1 })
      // src/a.ts:1:export function foo() {
      // src/a.ts-2-  return 1;
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/search.ts` → `agent/grep.ts` (renamed), `agent/grep-worker.ts` (new), `agent/repository/search.ts`, `agent/index.ts`, `src/targets.ts`, `src/hard-deny.ts` (if it names tools), `agent/{read,glob,list}.ts` descriptions, `agent/__tests__/search.test.ts` → `grep.test.ts`, `examples/coding-tools-capability-gaps.ts`, `scripts/phase26-freeze-manifest.json`, `docs/coding-security.md`, `packages/tools/coding/README.md`, `packages/policy/approval/src/*` (tentative — only if Task 1 (h) finds a tool-name rule), `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `CHANGELOG.md`.
    - References:
      - Roadmap Phase 7 Scope ("fs, edit, grep, shell").
  - Test Cases to Write:
    - `grep_regex_matches_by_default`: `function \w+` finds both functions; fails if literal-only remains.
    - `grep_literal_flag_matches_metacharacters`: `literal: true` finds `a.b(` literally.
    - `grep_context_windows_merge_without_duplicates`: the 2026-10-17 reproduction prints each line once.
    - `grep_context_lines_carry_numbers` and `grep_groups_separated_by_double_dash`.
    - `grep_glob_filters_files`.
    - `grep_catastrophic_pattern_terminates_at_time_cap`: returns `truncatedBy: "time"` within the bound; fails if the regex runs on the main thread (the test's own timer would not fire).
    - `grep_invalid_pattern_is_tool_error`.
    - `grep_mode_absent_without_indexed_modes`.
    - `grep_path_outside_roots_is_hard_denied`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the `arnilo__prism-tools-coding.txt` diff (`createRepoSearchTool` → `createGrepTool`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a tool is renamed and its schema and output change.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: tool tables and the `grep` reference row; `docs/coding-security.md`: the ReDoS paragraph (termination, not refusal); `CHANGELOG.md` (Changed, with the rename called out as breaking).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: `glob` accepts brace patterns by default
  - Acceptance Criteria:
    - Functional: `braceExpansion` defaults to `true`, keeping the existing bounds (128 alternatives, 4096 expanded bytes, nested or unbalanced braces are errors). The `braceExpansion` argument is removed from the schema; a host that wants braces off sets `GlobToolOptions.braceExpansion: false`. `**/*.{ts,tsx}` works on the first call (rejected on 2026-10-17).
    - Functional: The description's sentence about rejected braces is replaced by the bounds.
    - Performance: Unchanged — expansion was already bounded.
    - Code Quality: One default changed; no new option.
    - Security: The expansion bounds stay; the test asserts an over-bound pattern still errors.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/glob.ts`, `agent/glob-match.ts` (`validateGlobPattern`).
    - Options Considered:
      - Keep the opt-in and improve the error. Rejected: models write braces by habit, so the opt-in costs a turn almost every time.
    - Chosen Approach:
      - Default on, bounds unchanged.
    - API Notes and Examples:
      ```ts
      glob({ pattern: "src/**/*.{ts,tsx}" })
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/glob.ts`, `agent/__tests__/glob.test.ts`, `packages/tools/coding/README.md`, `CHANGELOG.md`.
    - References:
      - Task 4 (`grep.glob` uses the same matcher).
  - Test Cases to Write:
    - `glob_braces_expand_by_default`; `glob_brace_bounds_still_error`; `glob_host_can_disable_braces`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a schema field is removed and a default changes.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md` (`glob` row); `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: `edit` matches exactly and shows what changed
  - Acceptance Criteria:
    - Functional: Fuzzy matching is removed: `normalizeForFuzzyMatch`, `fuzzyFindText`, the fuzzy count, the fuzzy overlay in `applyEditsToNormalizedContent` (`agent/edit-diff.ts:33-60,163-226,296-340`), and `EditToolDetails.fuzzy`. An `oldText` that is not found exactly fails with the existing "Nearby" hint, plus Task 3's prefix hint.
    - Functional: A successful edit returns `Edited <path>: <n> block(s).` followed by each changed region with two lines of context, prefixed with the new file's line numbers in `read`'s format, capped at 40 lines in total with a `(… N more changed lines)` note.
    - Functional: CRLF and BOM handling is unchanged (the file is normalized to LF for matching and restored on write, as today).
    - Functional: The retired names are swept (exclusions as in Task 2): `normalizeForFuzzyMatch`, `fuzzyFindText`, `usedFuzzyMatch`, `"(fuzzy match)"`.
    - Performance: One `indexOf` pass per edit instead of up to three normalizations of the whole file.
    - Code Quality: About 100 lines removed from `edit-diff.ts`; the snippet builder reuses `read`'s line formatter.
    - Security: A wrong-region fuzzy match can no longer write; the test proves an `oldText` that differs only in Unicode quotes fails instead of editing.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/edit.ts:183,214-320`; `agent/edit-diff.ts`; the README's "fuzzy may succeed silently" warning.
    - Options Considered:
      - Keep fuzzy and return a diff. Rejected: on 2026-10-17 fuzzy still did not rescue an indentation mismatch, and with Task 2 the model copies exact text again, so fuzzy adds risk without a common win.
    - Chosen Approach:
      - Exact only, with a changed-lines report the agent can check without a second `read`.
    - API Notes and Examples:
      ```text
      Edited src/a.ts: 1 block(s).
      1	export function foo() {
      2	  return 2;
      3	}
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/edit.ts`, `agent/edit-diff.ts`, `agent/index.ts` (exports), `agent/__tests__/edit.test.ts`, `agent/__tests__/edit-diff.test.ts`, `agent/__tests__/read.test.ts` (fuzzy references), `packages/tools/coding/README.md`, `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `CHANGELOG.md`.
    - References:
      - Task 3.
  - Test Cases to Write:
    - `edit_exact_match_reports_changed_lines_with_numbers`.
    - `edit_unicode_quote_variant_fails_instead_of_fuzzy_editing`: fails if fuzzy is still there.
    - `edit_report_is_capped`.
    - `edit_crlf_and_bom_preserved`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the removed exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — matching rule and result text.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md` (`edit` row, drop the fuzzy warning); `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Schemas describe only what the model controls
  - Acceptance Criteria:
    - Functional: `write` and `edit` include `force` in their schema and the read-before-write sentence in their description only when `requireReadBeforeWrite` is on for that tool (`agent/read-path-set.ts:31-43`). Without it, a `force` argument is rejected by schema validation like any unknown key.
    - Functional: `ask_user_decision` options take `pros` and `cons` as 0–3 strings each (`minItems: 0`, `maxItems: 3`), both optional. The description drops "MUST include exactly 3". The host UI shows whatever is given. `AskUserDecisionOption.pros/cons` become `readonly string[]` (were `readonly [string, string, string]`, `agent/ask-user-decision.ts:47`), and `requireThreeBullets` becomes a 0–3 bounded check.
    - Performance: Fewer schema tokens per turn when the guard is off.
    - Code Quality: The schema is built where the tool is created, from the same options object; no runtime branching per call.
    - Security: Unchanged — the guard's behavior when on is identical (test).
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/write.ts:87-95`, `agent/edit.ts:183-190`, `agent/read-path-set.ts`, `agent/ask-user-decision.ts:40-60,290-310,415-470`.
    - Options Considered:
      - Keep the fields with "ignored unless enabled" wording. Rejected: it is still host configuration in the model's prompt.
    - Chosen Approach:
      - Build the schema from the tool's options.
    - API Notes and Examples:
      ```ts
      createWriteTool(cwd, { requireReadBeforeWrite: true }) // schema has `force`
      createWriteTool(cwd)                                     // schema has no `force`
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/{write,edit,ask-user-decision}.ts`, their tests, `packages/tools/coding/README.md`, `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `CHANGELOG.md`.
    - References:
      - The 2026-10-17 evaluation C8–C9.
  - Test Cases to Write:
    - `write_schema_has_force_only_with_guard`, `edit_schema_has_force_only_with_guard`, `guard_behavior_unchanged_when_on`.
    - `ask_user_decision_accepts_zero_to_three_pros_cons`, `ask_user_decision_rejects_four_pros`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the `AskUserDecisionOption` type change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — schemas and an exported type.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md` (`ask_user_decision` paragraph); `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Fewer tools, one job each
  - Acceptance Criteria:
    - Functional: `repo_list` is removed (tool, `createRepoListTool`, `ListToolOptions`, `agent/list.ts`). Directory listing stays in the repository operations `glob` uses. `glob`'s and `grep`'s descriptions lose their "prefer X" cross-references.
    - Functional: `createGitTools` returns `git_status`, `git_diff`, `git_commit`, `git_pr_handoff`. `git_branch`, `git_apply`, and `git_worktree` are removed with their handlers in `agent/git-tools.ts`. Worktrees stay the `workspace` service's job (README "Workspace service").
    - Functional: `delete` and `move` are registered only when `shell` is not (`shell.enabled: false`, or a sandbox backend that withheld the shell). `readOnly` still registers neither.
    - Functional: Every reference is updated in this task (Task 1 (c)–(d)): `PATH_ARG_KEYS`, `CODING_TOOL_NAMES`, README tables (the "nine tools" and `effects` tables), `examples/coding-tools-capability-gaps.ts`, `scripts/phase26-freeze-manifest.json`, `docs/coding-security.md`, and provider tests that use `repo_list` only as an arbitrary tool name keep it (recorded in the note). A repo-wide grep for `git_branch`, `git_apply`, `git_worktree`, `createRepoListTool` (exclusions as in Task 2) finds only `CHANGELOG.md`.
    - Performance: The default tool set's schema size drops; the test records the before and after character counts of all registered tool descriptions plus schemas (3,748 estimated tokens on 2026-10-17 for 19 tools).
    - Code Quality: No alias for any removed tool. The README states the rule: "one tool per job; `shell` covers what no dedicated tool does."
    - Security: The hard-deny hook still covers `delete` and `move` when registered; `git_commit`'s explicit-paths rule is unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/index.ts:142-176,210-219`; `agent/index.ts:216-217`; `agent/git-tools.ts`; `targets.ts:23-36`; Task 1 (c)–(d).
    - Options Considered:
      - Keep every tool and improve descriptions. Rejected: about 1.2k characters of the current descriptions are "prefer X over Y", which is the overlap showing; with a shell present, an agent uses `git` and `rm`/`mv` directly.
      - Remove `delete` and `move` entirely. Rejected: a host without a shell still needs effect-classified deletes and moves.
    - Chosen Approach:
      - Remove the overlapping tools; keep `delete`/`move` as the no-shell substitutes.
    - API Notes and Examples:
      ```ts
      toolsCoding({ root, shell: { enabled: false } }) // registers delete and move
      toolsCoding({ root })                             // does not
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/index.ts`, `agent/index.ts`, `agent/list.ts` (delete), `agent/git-tools.ts`, `agent/__tests__/{list,git-tools}.test.ts`, `src/targets.ts`, `src/__tests__/package.test.ts`, `examples/coding-tools-capability-gaps.ts`, `examples/serve-tools.ts` (if it names a removed tool), `scripts/phase26-freeze-manifest.json`, `scripts/fixtures/{e2e,phase26}-coding-journey.mjs` (if they call removed tools), `docs/coding-security.md`, `packages/tools/coding/README.md`, `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `CHANGELOG.md`.
    - References:
      - The 2026-10-17 evaluation §1 "Cut or merge".
  - Test Cases to Write:
    - `default_tool_set_is_the_documented_list`: exact names; fails on a stray or missing tool.
    - `delete_move_register_only_without_shell`.
    - `git_tools_are_status_diff_commit_handoff`.
    - `tool_schema_size_recorded` (prints and asserts the new total is below the old).
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records every removed export, attributed to this plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tools and exports removed.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: "What it changes" tables, config notes for `shell.enabled`; `docs/coding-security.md`; `CHANGELOG.md` (Removed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Background processes through `shell`
  - Acceptance Criteria:
    - Functional: `shell` gains `background?: boolean`. With `true`, the command starts through `createProcessSessions` (`agent/process/sessions.ts:10`) and the tool returns at once with `Started process <id>` and the first output that arrived within one second.
    - Functional: A new `shell_output` tool (`{ id, waitSeconds?, kill? }`, `effects: ["execute"]`) returns the output produced since the last call (bounded by the shell's line and byte caps), whether the process is running, and its exit code when it ended. `waitSeconds` (default 0, max 60) waits for new output or exit. `kill: true` ends the process. An unknown id, or an id from another session, is a tool error.
    - Functional: Every background process started by a session is killed on `session.closed` and on agent dispose (the `routing.forget` pattern, `src/index.ts:203-205`). `shell.background.maxProcesses` (default 4, hard 16) caps live processes per session.
    - Functional: The hard-deny `commandRules` and built-in denies apply to background commands exactly as to foreground ones (same tool, same `command` argument). Under a sandbox backend that Task 1 (e) found unsupported, `background` is not in the schema and `shell_output` is not registered.
    - Performance: No process-session machinery is created until the first background call.
    - Code Quality: `shell_output` is registered only with `shell`; the process-session library stays the single implementation (no second spawner).
    - Security: Background processes inherit the shell's environment rules and sandbox; output passes through the same redaction as `shell`. A process never outlives its session.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/process/*` (`sessions.ts`, `sessions-spawn.ts`, `sessions-teardown.ts`, `types.ts`); `agent/shell.ts`; `examples/phase9-coding-intelligence.ts:94`; Task 1 (e).
    - Options Considered:
      - Leave long-running processes out (README non-goal). Rejected: dev servers and watchers are common agent work, and `sleep 1 &` today leaves an untracked orphan.
      - Delete the process-session library. Rejected: it is tested (PTY, recovery, Docker) and is exactly what the tool needs.
      - Separate `process_start`/`process_read`/`process_kill` tools. Rejected: three tools where a flag and one tool do the job.
    - Chosen Approach:
      - One flag on `shell` plus `shell_output`.
    - API Notes and Examples:
      ```ts
      shell({ command: "bun run dev", background: true }) // → Started process p1 …
      shell_output({ id: "p1", waitSeconds: 5 })
      shell_output({ id: "p1", kill: true })
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/shell.ts`, `agent/shell-output.ts` (new), `src/index.ts`, `src/config.ts` (`shell.background.maxProcesses`), `src/targets.ts` (`shell_output: []`), `agent/__tests__/shell-background.test.ts` (new), `src/__tests__/package.test.ts`, `packages/tools/coding/README.md`, `CHANGELOG.md`.
    - References:
      - Task 8 (tool list), plan 178 (unsandboxed-shell warning applies to background too).
  - Test Cases to Write:
    - `shell_background_returns_id_and_first_output`.
    - `shell_output_returns_incremental_output_and_exit_code`.
    - `shell_output_kill_ends_process`.
    - `shell_output_foreign_session_id_is_error`.
    - `background_processes_killed_on_session_close`: fails if a process survives.
    - `background_command_hits_command_rules_deny`.
    - `background_process_cap_enforced`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new argument, new tool, new config field.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: config row, tool rows, the non-goals paragraph (PTY stays a non-goal; background processes are supported); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 10: Opt-in `diagnostics`, and delete the unregistered modules
  - Acceptance Criteria:
    - Functional: A new config field `language.servers` (a map of server name to `{ command, args?, extensions }`, shaped by Task 1 (f)) registers a `diagnostics` tool (`{ path }`, `effects: ["read"]`) that returns the language server's normalized diagnostics for one file (`normalizeDiagnostics`, `agent/diagnostics.ts`), as `path:line:col severity message`, capped by `resolveDiagnosticsLimits`. Without `language.servers`, nothing is registered and no server starts.
    - Functional: A server that fails to start gives a tool error naming the server and a one-time `status.note("warn", …)`; it never fails the run. Servers stop on agent dispose.
    - Functional: `agent/review.ts`, `agent/lifecycle.ts`, and `agent/coding-checkpoint.ts` are deleted with their tests and exports. Their users from Task 1 (c) are updated in this task: `scripts/fixtures/phase26-coding-journey.mjs` drops the review step, and `scripts/phase{10,26}-freeze-manifest.json` drop the names. `agent/goal-verify.ts` stays (`examples/coding-goal-verify.ts`, `examples/autonomous-coding-loop.ts` use it). A repo-wide grep for each deleted export (exclusions as in Task 2) finds nothing.
    - Performance: Importing the package still starts no language server and spawns nothing; the load-cost test asserts it.
    - Code Quality: The tool wraps the existing `createLanguageIntelligence`; no second LSP client.
    - Security: Server commands come from host config only, never from the model. `diagnostics` paths go through the hard-deny containment (`PATH_ARG_KEYS.diagnostics = ["path"]`).
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/language/{intelligence,client,framing,types}.ts`; `agent/diagnostics.ts`; `examples/phase9-coding-intelligence.ts:56-211`; Task 1 (c), (f).
    - Options Considered:
      - Delete the language library too. Rejected: diagnostics after an edit is the check an agent most wants, and the library is tested.
      - Register `diagnostics` by default with auto-detected servers. Rejected: spawns processes the host did not ask for.
    - Chosen Approach:
      - Opt-in tool over the existing library; delete only the modules nothing uses.
    - API Notes and Examples:
      ```jsonc
      { "language": { "servers": { "ts": { "command": "typescript-language-server", "args": ["--stdio"], "extensions": [".ts", ".tsx"] } } } }
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/diagnostics-tool.ts` (new), `src/index.ts`, `src/config.ts`, `src/targets.ts`, `agent/index.ts`, `agent/{review,lifecycle,coding-checkpoint}.ts` and `agent/__tests__/{review,lifecycle,coding-checkpoint}.test.ts` (delete), `agent/__tests__/diagnostics-tool.test.ts` (new, with a stub server), `scripts/fixtures/phase26-coding-journey.mjs`, `scripts/phase10-freeze-manifest.json`, `scripts/phase26-freeze-manifest.json`, `packages/tools/coding/README.md`, `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `CHANGELOG.md`.
    - References:
      - The 2026-10-17 evaluation C10 and "unregistered code".
  - Test Cases to Write:
    - `diagnostics_absent_without_language_config`.
    - `diagnostics_returns_normalized_lines` (stub server).
    - `diagnostics_server_start_failure_is_tool_error_and_note`.
    - `diagnostics_path_outside_roots_is_hard_denied`.
    - `package_import_starts_no_language_server`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the removed exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new config field and tool; exports removed.
    - Docs pages to create/edit:
      - `packages/tools/coding/README.md`: config row, tool row, cost note (one language-server process per configured server, started on first use, none by default); `CHANGELOG.md` (Added, Removed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun --cwd packages/tools/coding run build && bun --cwd packages/tools/coding test --timeout=0`
- `bun --cwd packages/policy/approval test --timeout=0`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/openai-primitives.test.ts src/__tests__/anthropic-messages.test.ts src/__tests__/tool-result-content.test.ts src/__tests__/public-export-contract.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
