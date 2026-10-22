# Phase 11 Part P — coding tools: agent ergonomics and tool-set reduction

## Objectives

- Make every tool result reach the model as the text the tool produced: no JSON string escaping, errors flagged as errors, and images from `read` delivered on the routes that support them.
- Fix the coding-tool defects an agent hits on every turn: `read` without line numbers, literal-only search with duplicated context, `glob` rejecting brace patterns, silent fuzzy edits, schema fields that describe host settings, and the forced "exactly 3 pros and 3 cons".
- Cut the registered tool set from 19 to the tools an agent actually reaches for, and give each kept tool one clear job.
- Turn the two tested but unregistered libraries an agent needs — background processes and language diagnostics — into tools, and delete the one unregistered module nothing uses (`agent/review.ts`).

## Expected Outcome

- A `read` of a file with quotes and tabs reaches the model on the OpenAI Chat and Anthropic Messages routes as the file's text with line-number prefixes, not as a JSON-quoted string. A failed tool call carries `is_error: true` on the Anthropic route. An image from `read` reaches an image-capable model on the Anthropic route as an image block inside the `tool_result`.
- `tools-coding` registers by default: `read`, `write`, `edit`, `glob`, `grep`, `shell`, `shell_output`, `git_status`, `git_diff`, `git_commit`, `git_pr_handoff`, `todo_write`, `ask_user_decision`, plus `coding_check` when checks are configured and `diagnostics` when language servers are configured. `delete` and `move` register only when the shell is off. `repo_list`, `repo_search`, `git_branch`, `git_apply`, and `git_worktree` are gone.
- `grep` takes a regular expression by default (`literal: true` for a fixed string), runs it in a killable Worker so a catastrophic pattern ends at the time cap instead of hanging the process, and prints ripgrep-style output with merged context and line numbers on every line.
- `edit` matches exactly, reports the changed lines with line numbers, and tells the agent when `oldText` contains `read` line-number prefixes.
- `review.ts` is deleted from `tools-coding` with its test and baseline lines. `lifecycle.ts` and `coding-checkpoint.ts` stay: shipped tools type-import the former and `goal-verify.ts` uses the latter (Task 1 (c)).

**0.13.0 release path — plan 189, step 5 of 21.** Owner decision 2026-10-17: the coding-tool, skills, and delegation fixes from the 2026-10-17 agent-perspective evaluation ship in 0.13.0, as plans 189 (this plan), 190 (skills), and 191 (delegation). Start this plan when plan 188 is complete; when it is complete, continue with plan 190. Plans 189–191 run **before** plan 184 on purpose: Task 2 changes the bytes of every tool-result message on the wire, and plan 190 Task 3 changes where a loaded skill body sits in the prompt, so the cache-parity measurement (184) has to see the final request shape. They also run before the surface freeze (185) because they remove and rename `tools-coding` exports and change `@arnilo/prism` provider-kit exports. This plan changes a kernel contract (how `provider-kit` codecs encode `tool_result`) and the `tools-coding` public surface, so **Task 1 is the phase review**. It is not a roadmap Part 4 scope item: it implements roadmap Phase 7's `tools-coding` row ("fs, edit, grep, shell", §2.9) more faithfully, and it reverses the plan 001/plan 004 decision to keep repository search literal-only (Task 4 records why the original ReDoS concern is answered). Docs: `docs/next/` was promoted into `/docs` before this plan (`src/__tests__/docs.test.ts:315` asserts it is gone), so kernel changes are documented in the `/docs` API pages and package changes in the package README (`.agents/skills/create-plan/references/prism-wiki.md`). No version bump, publish, or npm deprecation. Reference host impact: the coding worker (`apps/prism-agent/src/host/coding.ts`) registers `tools-coding`, so its scenarios (approval, golden JSONL) must stay green after the tool renames and removals; each task that changes a tool name or output updates any scenario fixture that names it.

## Tasks

- [x] Task 1: Phase review (read-only)
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
  - Notes (executed 2026-10-21):
    - Plan 182 and 183 have landed, so every path in this plan is the post-move path: `src/provider-kit/codecs/openai-chat.ts`, `src/provider-kit/codecs/anthropic-messages.ts`, and `packages/providers/{hyper,opencode-go}/src/provider.ts`. `packages/tools/coding` is at `0.13.0` and is published as TypeScript source (`"exports": { ".": "./src/index.ts" }`, no `dist`).

    **Verdict: STOP for a re-cut.** Task 10 is invalidated by (c): `lifecycle.ts` and `coding-checkpoint.ts` are not dead code. Tasks 2 and 4 need approach amendments recorded below; they are not stopped. Resolved at execution: Task 10 was re-cut to delete only `review.ts` and to use `LanguageServerSpec.languages` for the config shape.

    **(a) Wire inventory — every encoder that serializes a `role: "tool"` message**

    | Route | Text result | Structured `ToolResult.value` | Error | Image block |
    | --- | --- | --- | --- | --- |
    | OpenAI Chat (`codecs/openai-chat.ts:270-276`, serializer `openai-primitives.ts:45-56`) | `JSON.stringify(text)` — quotes, tabs, newlines escaped (`src/__tests__/openai-primitives.test.ts:80`) | `JSON.stringify(value)` | `JSON.stringify(error)` (a quoted string) | dropped: the `role: "tool"` branch returns before the image branch (`codecs/openai-chat.ts:316-322`), so an image block on a tool message never reaches the wire |
    | Anthropic Messages (`codecs/anthropic-messages.ts:305-323`) | `tool_result.content` = the same `serializeToolResultJson` string, so text arrives JSON-quoted | same JSON string | same JSON string; `is_error` is never sent | dropped: `content` is set to the serialized string only; the image branch (`:337-341`) is in the non-tool path |
    | Hyper (`packages/providers/hyper/src/provider.ts:24-35`) | OpenAI Chat codec (no private serializer) | same | same | same as OpenAI Chat; the chat route declares no `imageInput`, so capability-gated (fail-closed) is the default |
    | Hyper Messages route (`provider.ts:37-42`) | Anthropic codec | same | same | same as Anthropic |
    | OpenCode Go (`packages/providers/opencode-go/src/provider.ts:31-45`, `:47-52`) | OpenAI Chat codec, `imageInput: "capability-gated"` | same | same | same as OpenAI Chat |
    | System One (`systemone-provider.ts:86-95`) | n/a — `requireStructuredOutput` throws when `request.tools` is non-empty, so a tool message is never encoded | n/a | n/a | n/a |

    Two encoders only (one per vendor format); no provider package kept a private serializer — the `@arnilo/prism-provider-hyper` copy under `packages/credentials/keyring/node_modules/` is a vendored published artifact, not source. `EMPTY_TOOL_RESULT_TEXT` (`src/input.ts:37`) is already a non-empty sentinel and `toolResultPayload` (`src/input.ts:339-347`) already joins the text blocks, so Task 2 only replaces the JSON step.

    **(b) Image-in-tool-result support per route (vendor docs, checked 2026-10-21)**

    - Anthropic Messages: `tool_result.content` is "a string, **or** an array of `text`/`image`/`document` blocks", and `tool_result` carries `is_error: boolean` (`platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls`; `platform.claude.com/docs/en/api/messages`; SDK type `anthropic/types/tool_result_block_param.py`). Task 2's Anthropic design is supported as written. Images inside `tool_result` are already resolved for us: `resolveProviderMediaMessages` (`codecs/anthropic-messages.ts:102`, `src/provider-kit/media.ts:102-111`) walks every message's media blocks, tool messages included, so `resolvedMedia.get(part)` works inside the tool branch.
    - OpenAI Chat Completions: "For tool messages, only type `text` is supported" (`developers.openai.com/api/reference/resources/chat`), and image parts are rejected outside `role: "user"`. The follow-up `user` message is the correct route, **and it must come after every `tool` message of that round**: OpenAI requires all tool responses to an assistant's `tool_calls` to be contiguous (`github.com/github/copilot-sdk/issues/1922`). Task 2 already says "right after the tool messages of that round"; the implementation must also ensure it does not land between sibling tool messages.
    - Hyper and OpenCode Go: both route through the provider-kit codecs above, so they inherit each route's answer; no recorded wire request was needed. If a live check is ever wanted, `scripts/wire-proxy.mjs` is already in the tree.
    - **Correction for Task 2:** `resolveProviderMediaMessages` calls `assertMessagesSupportModelCapabilities` (`src/provider-kit/media.ts:107`, `src/content.ts:169-171`) *before* serialization, and that assertion throws `UnsupportedModalityError` for any image block when the model's `capabilities.input` excludes `image`. So a `read` image result on a text-only model already fails the request today, before either codec is reached. "Without image input → omitted-image note" therefore cannot be implemented in the codec alone: the tool-message image must be excluded from the blocks the assertion sees (or the assertion must skip tool-message media) in the same task, with a test that a text-only model request with an image tool result encodes the note instead of throwing. Both codecs need the same capability decision, so it belongs in one helper used by both.

    **(c) Callers of the symbols this plan removes or renames**

    - `serializeToolResultJson` (`src/provider-kit/openai-primitives.ts:45-56`): `codecs/openai-chat.ts:275`, `codecs/anthropic-messages.ts:309`, re-exported from `openai-primitives.ts` and part of the provider-kit surface (`src/__tests__/provider-kit.test.ts:213`, `src/__tests__/public-export-contract.test.ts:732`, `scripts/compat-baseline/arnilo__prism.txt`), asserted at `src/__tests__/openai-primitives.test.ts:11,80`, used by `scripts/provider-tool-result-wire.test.mjs`. Confirms Task 2's file list; add `src/__tests__/provider-kit.test.ts:213`.
    - `createRepoListTool` (`agent/list.ts:56-175`): `agent/index.ts:644,663` (`createCodingTools`, `createReadOnlyTools` → also the sandbox compositions at `security/sandbox-coding-operations.ts:371-396` and `src/index.ts:149-160`), re-exported at `agent/index.ts:217`, imported by `agent/__tests__/{repository,eval-fixtures}.test.ts`, and used by `examples/coding-browser-evaluation.ts` and `scripts/phase20-security.test.mjs`. Task 8's list is incomplete: it must also touch `security/sandbox-coding-operations.ts`, `examples/coding-browser-evaluation.ts`, and `scripts/phase20-security.test.mjs`.
    - `createRepoSearchTool` (`agent/search.ts:159`): same call sites (`agent/index.ts:645,664`), plus `examples/coding-tools-capability-gaps.ts`. Same additions.
    - `createGitTools` (`agent/git-tools.ts:577`): `src/index.ts:154`, `security/__tests__/sandbox-fs-operations.test.ts:304,339,372`, `workspace/__tests__/routing.test.ts:21`; `security/sandbox-coding-operations.ts:8` documents it as opt-in. Its returned set is named only in `agent/__tests__/git.test.ts` and `effects.test.ts`.
    - `normalizeForFuzzyMatch`, `fuzzyFindText`, `usedFuzzyMatch`, `EditToolDetails.fuzzy`: only `agent/edit-diff.ts`, `agent/edit.ts`, their tests, and three compat baselines. Confirms Task 6.
    - `AskUserDecisionOption.pros/cons` (`agent/ask-user-decision.ts:47-48`) and `ASK_USER_DECISION_RATIONALE_COUNT = 3` (`:28`): package-internal plus the README. Confirms Task 7.
    - `CODING_TOOL_NAMES` (`targets.ts:38-39`, derived from `PATH_ARG_KEYS:23-36`): `hard-deny.ts:13,72`, re-exported at `src/index.ts:69`, present in `scripts/compat-baseline/arnilo__prism-{code,tools-coding}.txt`. No consumer outside the package reads it, so Tasks 4/8/9/10 update `targets.ts` and nothing else.
    - **`agent/review.ts`, `agent/lifecycle.ts`, `agent/coding-checkpoint.ts` — the 2026-10-17 survey is wrong for two of the three.** `review.ts` is dead package code (only `agent/index.ts:340-361` re-exports it, its own test, and history docs) and can be deleted as Task 10 says. `lifecycle.ts` is type-imported by `write.ts:30`, `edit.ts:45`, `delete.ts:11`, `move.ts:15`, `git-tools.ts:31`, and `coding-checkpoint.ts:5` (`CodingLifecycleEvent`), and `createCodingLifecycleEmitter`/`resolveCodingLifecycleLimits` are re-exported at `agent/index.ts:200-217`. `coding-checkpoint.ts` is imported by `agent/goal-verify.ts:18-33` (`buildCodingCheckpointMetadata`, `readCodingCheckpointFromState`, `CodingCheckpointMetadata`) — which this plan keeps — plus ~30 re-exports at `agent/index.ts:50-86`. Deleting either breaks five shipped tool modules and `goal-verify`; no other module owns `CodingLifecycleEvent`. Re-cut Task 10 as: delete `review.ts` + its test; keep `lifecycle.ts` and `coding-checkpoint.ts` (or move `CodingLifecycleEvent` into a small types module first and keep `coding-checkpoint.ts` for `goal-verify`); register `diagnostics` as planned. Nothing outside the package imports the three modules (only `docs/history/*`, `docs/_evidence/phase26-primitive-review.md`, `scripts/phase26-freeze-manifest.json`, and the compat baselines name them).

    **(d) Tool-name references outside the package** (exhaustive `rg -l`, excluding `node_modules`, `dist`, `plans`, `graft`): `repo_list` 26 files, `repo_search` 31, `git_branch|git_apply|git_worktree` 7 — close to the survey's 24/27.

    | Disposition | Files |
    | --- | --- |
    | Rename the tool (real references) | `packages/tools/coding/src/{agent/{index,list,glob,search,limits,read}.ts,config.ts,targets.ts,index.ts}`, `packages/tools/coding/src/agent/repository/indexed-search.ts`, the package README/CHANGELOG, `examples/coding-tools-capability-gaps.ts`, `docs/coding-security.md` |
    | Package tests that assert the tool set or the rename | `packages/tools/coding/src/__tests__/package.test.ts`, `src/agent/__tests__/{aggregators,delete-move,effects,glob,repository,eval-fixtures,coding-checkpoint}.test.ts`, `src/security/__tests__/{sandbox-coding-operations,workspace-consistency}.test.ts` |
    | Leave as an arbitrary tool name (not a reference to the tool) | `src/__tests__/input-pipeline.test.ts`, `src/__tests__/openai-primitives.test.ts`, `src/__tests__/tool-result-content.test.ts` |
    | History/evidence — never touched | `docs/history/*`, `docs/_evidence/*`, `roadmap.md` |
    | Manifest/CHANGELOG history | `scripts/phase26-freeze-manifest.json`, `CHANGELOG.md`, `packages/tools/coding/CHANGELOG.md` |

    **Sweep trap for Tasks 2/4/6/8/10:** `scripts/compat-baseline/` holds baselines for packages that no longer exist (`arnilo__prism-code.txt`, `arnilo__prism-coding-agent.txt`, `arnilo__prism-coding-tools.txt`) and those still contain `normalizeForFuzzyMatch`, `fuzzyFindText`, `CODING_TOOL_NAMES`. The plans' exclusion list (`dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) does not cover them, so every "repo-wide grep finds nothing" criterion would fail on stale files. Add `scripts/compat-baseline/` to the exclusion list, or delete the three orphaned baselines in this plan.

    **(e) Process sessions and sandboxes** — `createProcessSessions` (`agent/process/sessions.ts:10-27`) takes `{ cwd, policy, limits, onEvent, ownership, identity, sandbox?, ptyBackend?, checkpoints?, leases?, ownerId?, recoveryBackend?, recoveryLimits? }` (`agent/process/types.ts:321-350`) with `maxLifetimeMs` in `ProcessSessionLimits` (`types.ts:139-152`). Sandbox support is capability-based, not class-based: `ProcessSandboxBackend` is `{ startProcess?, attachProcess?, status? }` (`types.ts:55-59`) and `start()` fails closed with `ERR_PRISM_PROCESS_UNSUPPORTED` when an adapter lacks `startProcess` (`sessions-spawn.ts:358-359`, `:523-524`). Today `DockerSandbox.startProcess` (`security/docker-sandbox.ts:697`) and `E2BSandbox.startProcess` (`security/e2b-sandbox.ts:546`) exist; `NativeSandbox` implements only `execFile` (`security/native-sandbox.ts:293,389`). Task 9's "unsupported backend" branch is therefore the native-sandbox adapter, plus any host adapter without `startProcess` — detect it by capability, not by sandbox class. Recovery needs `checkpoints` + `leases` + `ownerId` together and a `recoveryBackend` for attach (`types.ts:335-349`); `shell` should not wire recovery at all. Nothing else is required from the host: the example constructs it with `{ cwd, limits: { maxLifetimeMs } }` (`examples/phase9-coding-intelligence.ts:94`). Note that `security/sandbox-coding-operations.ts` currently passes no `sandbox` to `createProcessSessions` anywhere, so Task 9's wiring is new and must pass the same adapter the shell uses, or background commands escape the sandbox.

    **(f) Language intelligence options** — `createLanguageIntelligence({ workspaceRoot, servers, limits?, policy? })` (`agent/language/intelligence.ts:48-52`); a server spec is `{ command, args?, languages: readonly string[], env? }` (`agent/language/types.ts:38-43`). **Correction for Task 10:** the field is `languages` (LSP language ids such as `typescript`, not file extensions — `EXT_LANGUAGE` at `intelligence.ts:33-50` maps extension → language id), so the proposed `{ command, args?, extensions }` config shape is wrong; use `languages` and let the package keep doing the extension→language mapping. Diagnostics for one file already exist: `LanguageIntelligence.diagnostics(file, { signal })` (`types.ts:151`, implemented at `intelligence.ts:237-247`) returns normalized diagnostics, and `syncDocument(file)` (`types.ts:155-160`) is the refresh call an edit-then-diagnose flow needs. `policy` is needed in practice for mutating calls (`examples/phase9-coding-intelligence.ts:86-91` passes an allow-all stub; `rename` goes through `assertExecutionAllowed`).

    **(g) Regex worker feasibility — works, and it is cheap.** `new Worker(new URL("./worker.ts", import.meta.url))` loads TypeScript source under Bun 1.4.2 with no build step, which is what this package needs: it ships `src` (no `dist`), and `packages/tools/work/src/runtime/worker-pool.ts:135,187` already uses exactly this pattern. Measured on this dev machine: ready-message latency median **1.00 ms** (min 0.72, max 1.59, 20 starts). `(a+)+$` over 64 KB of `a`s plus `b` inside a worker did **not** finish within 300 ms while the main thread stayed responsive, and `await worker.terminate()` returned at 302 ms — the time-cap kill works as designed. One implementation constraint: use Bun's global `Worker` (web-worker `postMessage`), not `node:worker_threads` — the `node:worker_threads` `Worker` with a `.ts` URL neither delivered messages nor raised an error in the same experiment.

    **(h) Approval coupling** — `@arnilo/prism-approval` never names a coding tool. It consumes the `coding.targets` service (`packages/policy/approval/src/index.ts:165`) and reads only `{ paths, roots }`; the tool-name → path-argument table lives in `packages/tools/coding/src/targets.ts:23-36`. So renaming `repo_search`→`grep` and adding `shell_output`/`diagnostics` needs no approval change — only `PATH_ARG_KEYS` in this package (and `MUTATING_TOOLS` at `hard-deny.ts:16` if a new tool mutates; `shell_output` does not). **Security criterion holds:** `hard-deny.ts:72` gates on `CODING_TOOL_NAMES`, so `grep`, `diagnostics`, `shell_output`, and `delete`/`move` are covered the moment they are in `PATH_ARG_KEYS`; the Task 4 and Task 10 test cases already assert path denial for `grep` and `diagnostics`.

    **Other findings that change later task text (not stopping):**

    - Task 4: the repository seam does not exist yet. `RepositoryOperations` is only `{ list, search, glob }` (`agent/repository/types.ts:172-176`); no operation returns file text, and each backend compiles the pattern itself (`compileSearchPattern`, `agent/repository/search.ts:11-20`, called from `security/sandbox-fs-operations.ts:490`). "The main thread reads files through the existing bounded operations and posts text batches" is not implementable as written. Cheapest correct shape: add an optional `matcher` hook to `RepositorySearchRequest` that each backend calls instead of `compileSearchPattern`, with the tool supplying a hook that round-trips through the worker — backend containment, deadlines and caps stay intact. Related: `maxPatternBytes`/`maxTimeMs` already exist as `DEFAULT_/HARD_MAX_SEARCH_PATTERN_BYTES` and `_TIME_MS` (`agent/limits.ts:43-50`) and are already on `RepositoryLimitOptions` (`repository/types.ts:105-108`), so no new caps are needed; the `mode: "regex"` rejection is at `agent/search.ts:226-228`.
    - Task 7's reference `agent/read-path-set.ts:31-43` is now `refuseReadBeforeWrite` (`:31-43`); `force` is at `agent/edit.ts:186-190` and `agent/write.ts:87-95`. `GitToolsOptions.onEvent` takes `CodingLifecycleEvent` (`git-tools.ts:47`), so Task 8 must keep that type reachable.
    - Task 3's `getNotFoundError` is at `agent/edit-diff.ts:229-260` and already builds a "Nearby" hint — the prefix hint belongs there.
    - `docs/coding-review-and-diagnostics.md` (named by `scripts/phase26-freeze-manifest.json`) no longer exists; no live docs page names the three modules, so Task 10 has no doc removal to make, only README/CHANGELOG.

- [x] Task 2: Tool results reach the model as text
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
      - `src/provider-kit/codecs/openai-chat.ts`, `src/provider-kit/codecs/anthropic-messages.ts` (paths after plan 182 Task 6–7), `src/content.ts` (the request gate must stop failing on tool-message media; Task 1 (b)), `src/provider-kit/openai-primitives.ts`, `src/provider-kit/index.ts`, `packages/providers/{hyper,opencode-go}/src/*` (only if Task 1 (a) finds a private serializer left), `src/__tests__/openai-primitives.test.ts` (the `JSON.stringify("file AGENTS.md")` expectation at line 80), `src/__tests__/anthropic-messages.test.ts`, `src/__tests__/tool-result-content.test.ts`, `scripts/provider-tool-result-wire.test.mjs` (if it survives plan 182), `src/__tests__/public-export-contract.test.ts` (line 756 freeze entry), `scripts/compat-baseline/arnilo__prism.txt`, `docs/provider-kit.md`, `CHANGELOG.md`.
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
  - Notes (executed 2026-10-21):
    - What changed:
      - `src/provider-kit/openai-primitives.ts`: `serializeToolResultJson` → `serializeToolResultText(message): string` (string `result` sent unchanged, structured value still `JSON.stringify`, an error as its `message`, the text-block join kept for a result-less message) and new `OMITTED_TOOL_RESULT_IMAGE_NOTE = "[image omitted: the model does not accept images]"`.
      - `src/provider-kit/codecs/openai-chat.ts`: the `role: "tool"` branch adds the omitted-image note when the message carries an image block and the model takes no image input; `openAIChatBody` now builds its `messages` array in a loop and appends one `role: "user"` message (`Images returned by <tool> (<toolCallId>):` + `image_url` parts) after the round's contiguous tool replies. Helpers `acceptsImageInput` and `toolResultImages` are module-private; the existing `imageInput` option keeps its meaning (`always` sends, `capability-gated` checks `capabilities.input`).
      - `src/provider-kit/codecs/anthropic-messages.ts`: `tool_result.content` is the text string when the message carries no image (wire-compatible with before), and an array of a `text` block (only when non-empty) plus one `image` block per image block — resolved through the existing `resolvedMedia` map — when it does; `is_error: true` is set from `result.error`; a model without image input gets the note appended to the text instead of the images. `cache_control` still follows the non-empty text.
      - `src/content.ts`: `assertMessagesSupportModelCapabilities` now collects blocks from every non-tool message, so an image inside a tool message no longer fails the request gate (Task 1 correction (b)); images in `system`/`user`/`assistant` messages still fail closed, pinned by a new test.
      - `src/provider-kit/index.ts` needs no edit (`export *` from `openai-primitives.js`); the codec re-export lists, `src/__tests__/{provider-kit,public-export-contract}.test.ts` freeze lists, `scripts/provider-tool-result-wire.test.mjs`, and `scripts/compat-baseline/arnilo__prism.txt` carry the new names.
      - Tests: `openai-primitives.test.ts` (text unescaped, structured value JSON, scripted 10-turn loop encodes smaller than the JSON-escaped encoding — 17411 vs 22422 bytes), `anthropic-messages.test.ts` (`is_error`, image block in `tool_result.content`, omitted-image note), `tool-result-content.test.ts` (follow-up user message after two contiguous tool replies, note on a text-only model, redaction placeholder survives, and the two gate cases).
      - Docs: `docs/provider-kit.md` gained "Tool results on the wire"; `docs/tools.md` "Outputs / response" now says what the model sees for text, structured, error, and image results; `CHANGELOG.md` `[Unreleased]` entry. `docs/index.md` untouched.
    - Findings that affect later tasks:
      - The compat gate was already red before this task: `bun scripts/release.mjs gate` fails 13 package baselines whose drift predates plan 189 (plans 182/183/188 landed without regenerating them — `@arnilo/prism` alone shows ~230 removed names plus the System One additions). `--update-baseline` rewrites all 35 baseline files at once, so this task did **not** run it; it edited exactly the two lines that belong to this change. Plan 185/194 must regenerate the whole set before release acceptance. The same gate run now reports no `serializeToolResult*` drift for `@arnilo/prism`.
      - Kernel budgets were rebaselined once, after all edits: `packedBytes` 1085617, `unpackedBytes` 3545332, `rootExports` 1451, `sourceLines` 37227, plus `exportCounts["@arnilo/prism"]` 1451, each with a dated reason in `scripts/budgets.json`. The +75 source lines are this task's own hunks.
      - Pre-existing test debt that this task does not touch and that plan 185/194 must absorb: `public-export-contract.test.ts` frozen provider-kit and testing surfaces still lack the 182/183 additions (`systemOneProviderPackage`, `systemOneConformance`, the live-scenario runners); `provider-kit.test.ts` `provider_kit_exports_match_inventory` lacks them too; `provider_packages_spawn_no_process_and_open_no_browser` asserts `scanned.length > 20` but plan 182 left 14 provider packages; `core-boundaries.test.ts` finds "anthropic" in `src/testing/provider-live-scenarios.ts` (plan 183 Task 5); `host-surface-gate.test.ts` reports `packages/hosts/headless/src/scheduler/firing.ts` importing `RunResultStatus`.
      - Task 8/9/10 must keep the note text and the follow-up-user-message rule in mind when they rename or add tools: the label uses `tool_result.name`, and `shell_output` takes no path argument, so it needs no `PATH_ARG_KEYS` entry.
    - Sweep: `rg serializeToolResultJson src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) hits only dated history records — `CHANGELOG.md:427` (a released 0.5.3 entry) and the `[2026-09-08]` measurement string in `scripts/budgets.json` — plus the generated `graft/` index, which `graft build` refreshes. No live code, test, doc page, or live baseline names it.
    - Baseline diff (`scripts/compat-baseline/arnilo__prism.txt`, 2 insertions / 1 deletion): `+OMITTED_TOOL_RESULT_IMAGE_NOTE` (sorted among the `O` names), `-serializeToolResultJson` `+serializeToolResultText` at the same name position.
    - Checks: `bun run typecheck` green (all workspaces + examples); `bun test src/__tests__` 4170 pass with the 10 pre-existing failures above and two load timeouts (`host_adapter_passes_adapter_conformance`, the field-policy microbenchmark); `bun test packages/providers packages/tools/coding` 665 pass (one process-stress timeout under load, passes/skips standalone); `bun test scripts/provider-tool-result-wire.test.mjs` 4 pass.

- [x] Task 3: `read` shows line numbers
  - Acceptance Criteria:
    - Functional: Each text line `read` returns is prefixed with its 1-based line number and a tab (`12\t  return 1;`). The truncation note's "continue with offset N" is unchanged, and `findText` pages start at the matching line with its real number.
    - Functional: The `read` description says the prefix is not part of the file. The `edit` description says to copy `oldText` without the prefix. `edit` fails with a hint (`"oldText includes read line-number prefixes (\"12\\t\"); remove them"`) when every line of an `oldText` that is not found starts with `\d+\t`; it never strips prefixes silently.
    - Functional: Image reads are unchanged.
    - Performance: The prefix costs a few characters per line; the 2000-line and 50 KB page caps now count the prefixed text, so a page never exceeds the caps.
    - Code Quality: Formatting happens once, in `createReadTool.execute` right after `ReadOperations.readText` returns — not in `readLocalTextPage`, because `sandbox-fs-operations.ts` and `acp-operations.ts` implement `readText` too; a `readLocalTextPage` prefix would make native reads numbered and sandbox/ACP reads not. The streamed byte counters stay on file bytes for offsets.
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

  - Notes (executed 2026-10-21):
    - What changed:
      - `agent/read.ts`: new private `numberLines(content, startLine, maxBytes)` prefixes each line `${n}\t`, drops a trailing newline so no dangling empty numbered line is printed, and stops at the last line whose prefixed form fits `maxBytes` (returns `clipped`). `execute` numbers the page after the existing backend-honesty check, so `truncatedBy`, `outputLines`, `nextOffset`, the footer, and `metadata.truncation` all describe the numbered page; a clip re-reports `truncatedBy: "bytes"` with `nextOffset = startLine + seenLines`, and a lone line that only overflows once prefixed takes the existing shell-fallback notice.
      - `read` description now says the prefix is not part of the file; `edit` description says to copy `oldText` from `read` without the prefix.
      - `agent/edit-diff.ts`: `looksReadPrefixed` (`every non-empty line matches /^\d+\t/`) makes `getNotFoundError` append `oldText includes read line-number prefixes ("12\t"); remove them.` Prefixes are never stripped, so a file line that really starts with `7\t` still edits.
      - Tests: `read.test.ts` assertions moved to the numbered form (14 of them), the "trailing newline preserved verbatim" test became "no dangling empty numbered line", and two new tests — `page caps count the numbered text` (10 lines, `maxBytes: 50` → exactly 3 numbered lines, `truncatedBy: "bytes"`, `offset=4`) and the digit-tab edit plus the prefixed-`oldText` hint in `edit.test.ts`. `acp-operations.test.ts` page assertions updated (3/4 line numbers), which also proves the prefix comes from the shared seam, not a backend.
      - Docs: `packages/tools/coding/README.md` tool table rows for `read` and `edit`; `CHANGELOG.md` `[Unreleased]`.
    - Findings:
      - The `truncation.content` metadata is now the numbered text, not the raw page — hosts that re-display it (none in-tree) see exactly what the model saw.
      - Image and document reads are untouched: the prefix applies only to the `readText` page path.
      - Kernel budgets rebaselined once: `packedBytes` 1085971, `unpackedBytes` 3546321, reason recorded — the delta is the CHANGELOG entry only, since `packages/tools/coding` is not in the kernel tarball. No export changed, so no compat baseline moved.
    - Follow-up found in Task 4: `examples/serve-tools.ts` serves `read`, so `src/__tests__/docs.test.ts` now expects `1\tserved`; updated there.
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 594 pass (the pre-existing process-stress test times out under full-suite load and passes/skips alone); `bun test packages/memory packages/tools/work` 1044 pass (one known flaky reviewer test, passes alone); `bun test packages/tools/coding/src/agent/__tests__/{read,edit,acp-operations}.test.ts` 72 pass; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures recorded in Task 2; `examples/coding-tools-capability-gaps.ts` runs unchanged.

- [x] Task 4: `grep` — regex search in a killable worker
  - Acceptance Criteria:
    - Functional: `repo_search` is renamed `grep`. Its schema: `pattern` (required), `literal?` (default `false`), `path?`, `glob?` (a file filter using `matchGlobPattern`), `caseSensitive?` (default `true`), `includeHidden?`, `context?` (default `0`, hard 20), `maxMatches?`, `outputMode?` (`content` | `files_with_matches` | `count`). `mode` appears only when the host enabled an indexed mode (`SearchToolOptions.modes`, `agent/search.ts:34-38`); without one it is not in the schema. The handler for the removed `mode: "regex"` rejection (`search.ts:226-228`) is deleted.
    - Functional: `content` output is ripgrep-style: `path:line:text` for a match, `path-line-text` for context, and `--` between non-adjacent groups. Overlapping context windows in one file are merged, so no line prints twice (reproduced 2026-10-17: two matches three lines apart printed every context line twice, with `-`/`+` prefixes and no numbers).
    - Functional: A regex runs in a Worker. The matching seam is `RepositorySearchRequest.matcher` (amended at execution: the existing `RepositoryOperations` never returns file text, so the backend that already reads each bounded file — local and sandbox — hands that text to the injected matcher, which the tool backs with a worker; `glob` filtering rides the same request). The worker compiles the pattern once (`maxPatternBytes`, invalid pattern → tool error carrying the engine's syntax message; amended: the JS engines report the offending pattern, not a byte offset) and returns matches. When `maxTimeMs` elapses, the main thread calls `worker.terminate()` and returns the matches so far with `truncatedBy: "time"`. Literal search stays on the main thread with no worker.
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

  - Notes (executed 2026-10-21):
    - What changed:
      - `agent/search.ts` → `agent/grep.ts`: tool `repo_search` → `grep`, `createRepoSearchTool` → `createGrepTool`, `SearchToolOptions` → `GrepToolOptions` (`ToolsOptions.search` kept as a deprecated alias for `grep`, so a host that passed `search` still works). Schema: `pattern` (required), `literal` (false), `path`, `glob`, `caseSensitive` (now **true**), `includeHidden`, `context` (now **0**), `maxMatches`, `outputMode`; `mode` is only in `properties` when `options.modes` enables an index, and the `mode: "regex"` rejection handler is deleted.
      - Output is ripgrep-style from one formatter: `path:line:text` for a hit, `path-line-text` for context, `--` between non-adjacent groups; a per-path line map dedupes overlapping context windows, so the 2026-10-17 double-print is gone (pinned by two tests). Indexed hits keep their `[score]` suffix.
      - `agent/grep-worker.ts` (new): compiles the pattern once, matches one file per message via `matchLines`, and posts matches back. `grep.ts` hosts it: `start()` surfaces a syntax error as a tool error, each file is raced against `deadlineAt`, and a timeout terminates the worker and throws the repository's time-limit error so the search reports `truncatedBy: "time"`. A `GrepTimeout` also marks the worker dead, so a later file cannot reuse it.
      - `agent/repository/search.ts`: `searchFileLines` (140 lines of per-line streaming) became `searchFile` + the pure `matchLines(text, testLine, context, maxLineBytes)`; `literalMatcher(...)` wraps it for literal mode. Both are exported, so the worker, literal mode and the sandbox backend share one matcher and one line semantics.
      - Seam: `RepositorySearchRequest` gained `matcher` (`RepositoryFileMatcher`) and `glob`; new types `RepositoryLineMatch` / `RepositoryFileMatcher`. `sandbox-fs-operations.search` now uses the request's matcher (its own inline line loop is gone) and honors `glob`, so regex works in the sandbox; the indexed composite already falls back to `fallback.search(request)` for literal mode, which passes the matcher through.
      - Renames everywhere: `targets.ts` (`PATH_ARG_KEYS`/`CODING_TOOL_NAMES` carry `grep`, so approval and hard-deny follow with no rule change), `agent/index.ts` aggregators, the `shell`/`read`/`list`/`glob` descriptions, `src/index.ts`, `config.ts`, `limits.ts` comments, `sandbox-coding-operations.ts`, README rows, `docs/coding-security.md` (a new paragraph: worker termination, not refusal — plan 001's concern retired), `roadmap.md` example, `examples/coding-tools-capability-gaps.ts`, `scripts/phase26-freeze-manifest.json` (its `src/search.ts` path is already stale from the package rename; now names `src/grep.ts`).
      - Tests: `repository.test.ts` grep block rewritten (regex by default, `literal: true` metacharacters, merged windows, `--` groups, glob filter, output modes, truncation in every mode, invalid pattern, catastrophic termination, `mode` absent without indexes, injected matcher through custom ops), `indexed-search.test.ts` (schema without `mode`, `pattern` arg), `hard-deny.test.ts` (`hard_deny_grep_path_outside_roots`), aggregator/package/effects/glob/delete-move/sandbox/workspace list expectations.
    - Findings:
      - Perf on this repository's `packages/` (1000-match cap, 512 MB scan budget, 3 runs each): literal 154/159/172 ms, regex 158/166/175 ms — overhead is the worker start (~1 ms) plus one round trip per file, so worst case +17 ms (≈10%) on a full-package scan. The plan's "at most the worker start time" is met for start-up; the per-file IPC is the price of keeping the sandbox seam.
      - A line longer than `maxLineBytes` (default 50 KB) is skipped by `matchLines`, so the catastrophic test uses 40 000 chars; `(a+)+$` over that line takes ~930 ms on the main thread and returns in <700 ms with `truncatedBy: "time"` through the worker.
      - Scan accounting is now per file rather than per line: a file whose size exceeds the remaining scan budget is charged the remainder and the search stops with `truncatedBy: "scan"` (previously the partial file was searched line by line). No test depended on the difference.
      - Sweep: `repo_search`/`createRepoSearchTool` survive only in the rename notes (`CHANGELOG.md` Unreleased, `packages/tools/coding/CHANGELOG.md` Unreleased and its released history) and in the baselines of the retired packages (`scripts/compat-baseline/arnilo__prism-coding-tools.txt`, `-coding-agent.txt`), which are part of the stale-baseline problem already recorded in Task 2. `RagSearchToolOptions` is a false positive.
      - `scripts/compat-baseline/arnilo__prism-tools-coding.txt` (untracked, regenerated by the release gate for the current package) was hand-updated: `SearchToolOptions` → `GrepToolOptions`, `createRepoSearchTool` → `createGrepTool`, plus `literalMatcher`, `matchLines`, `RepositoryFileMatcher`, `RepositoryLineMatch`.
      - Kernel budgets rebaselined once: `packedBytes` 1086890, `unpackedBytes` 3548518 — the delta is the root CHANGELOG entry and the roadmap/example rename; the tool itself is not in the kernel tarball.
      - A Task 3 regression surfaced here: `examples/serve-tools.ts` serves `read`, so `src/__tests__/docs.test.ts` now expects `1\tserved` (the line-number prefix) instead of `served`; updated in that test.
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 599 pass (the pre-existing process-stress test times out under load, passes alone); `bun test src/__tests__` 4171 pass with exactly the 10 pre-existing failures recorded in Task 2; `bun test packages/tools/coding packages/policy packages/hosts` clean apart from the two known load timeouts; `bun run examples/coding-tools-capability-gaps.ts` prints its tally; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures.

- [x] Task 5: `glob` accepts brace patterns by default
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
      - Default on, bounds unchanged. Amended at execution: the four places that filter paths by a glob (`glob`, the `grep` `glob` argument, the sandbox `glob`, the sandbox `grep`) now share one `compileGlob(pattern, braceExpansion?)` helper, because leaving them raw would silently accept a brace pattern and return no matches.
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

  - Notes (executed 2026-10-21):
    - `glob-match.ts`: brace expansion is now on unless explicitly disabled — `validateGlobPattern` expands (and so enforces the bounds) when `braceExpansion !== false` and throws `brace expansion is disabled for this tool (host set braceExpansion: false)` when a host turned it off. New export `compileGlob(pattern, braceExpansion = true): (path) => boolean` wraps `expandGlobBraces` + `matchGlobPattern`, so no caller keeps a raw-pattern matcher.
    - `agent/glob.ts`: `braceExpansion` left the schema (no per-call argument), the host option now means "disable", and the description says braces expand with their bounds instead of being rejected. `GlobToolOptions`/`RepositoryGlobRequest` doc comments updated.
    - Shared matcher adopted at every filter site: `repository/glob.ts` (replacing its inner `matchesAnyPattern` loop), `repository/search.ts` (`request.glob`), `security/sandbox-fs-operations.ts` (`glob` and the search `glob` filter — the sandbox glob previously validated braces but matched the raw pattern, so an accepted brace pattern matched nothing). `agent/index.ts` re-exports `compileGlob`.
    - Tests: `glob.test.ts` — `validateGlobPattern` cases flipped to default-accept + host-disable, `glob_braces_expand_by_default` (plain call, `src/**/*.{ts,tsx}`, schema has no `braceExpansion`), `glob_host_can_disable_braces`, and the existing over-bound bomb test still asserts the alternative-limit error (unchanged bounds).
    - Bounds unchanged, so performance is unchanged: expansion is textual and capped at 128 alternatives / 4096 bytes before any walk.
    - Sweep: `braceExpansion` survives only as the host-disable option and the plumbing field; no live docs page mentioned braces except the README row, which now describes expansion.
    - Compat baseline (`arnilo__prism-tools-coding.txt`, untracked) gained `compileGlob`; kernel budgets rebaselined once (packed 1087142, unpacked 3549230 — the root CHANGELOG entry only).
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 601 pass (the pre-existing process-stress test still times out under load); `bun test packages/tools/coding packages/policy packages/hosts scripts/phase20-security.test.mjs` 1318 pass / 2 known load timeouts; `bun test src/__tests__` 4171 pass with exactly the 10 pre-existing failures; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures.

- [x] Task 6: `edit` matches exactly and shows what changed
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
      - Exact only, with a changed-lines report the agent can check without a second `read`. Amended at execution: the report is a separate `generateChangedLinePreview(old, new, contextLines = 2, maxLines = 40)` that reuses the diff (not `read`'s page formatter, which is byte-capped and lives behind `ReadOperations`); it keeps `read`'s `N\ttext` format and drops the phantom line a trailing newline would add, so the two tools' numbering matches.
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

  - Notes (executed 2026-10-21):
    - `agent/edit-diff.ts` lost ~180 lines: `normalizeForFuzzyMatch`, `splitLinesWithEndings`, `getLineSpans`, `getReplacementLineRange`, `applyReplacementsPreservingUnchangedLines`, `FuzzyMatchResult`, `fuzzyFindText` and the fuzzy occurrence counter. `applyEditsToNormalizedContent` is now one `indexOf` per edit plus an exact occurrence scan, so a miss throws `Could not find the exact text …` with the Task 3 prefix hint and the `Nearby` block, and nothing is written.
    - `AppliedEditsResult` is `{ baseContent, newContent }` — `usedFuzzyMatch` is gone, as is `EditToolDetails.fuzzy` and the `(fuzzy match)` suffix.
    - New `generateChangedLinePreview(oldContent, newContent, contextLines = 2, maxLines = 40)`: walks the same `Diff.diffLines` result, turns added lines into new-file windows (merged when adjacent), prints them as `N\ttext` (read's format, trailing-newline phantom line dropped) and returns `{ text, more }`, so `more` is exactly the count of changed lines the 40-line cap left out.
    - Result text is `Edited <path>: N block(s).` then the preview lines, then `(… N more changed lines)` when capped. `metadata.diff`/`patch`/`firstChangedLine` are unchanged. CRLF/BOM are still handled exactly as before (strip → normalize to LF → restore), and the preview numbers the LF-normalized new content, which is what `read` would show.
    - Descriptions: the `edit` description no longer mentions fuzzy; the README row states exact-only, the hints, and the report. Package and root CHANGELOG record the breaking removal of the three exports plus the new one.
    - Tests: `edit-diff.test.ts` rewrote the fuzzy tests into `applyEditsToNormalizedContent: a unicode variant fails instead of editing`, an exact-match preservation test, and three `generateChangedLinePreview` tests (read-style numbering with context, distant changes → one window each, 40-line cap + `more` count). `edit.test.ts` gained `edit_exact_only_trailing_whitespace_variant_fails`, `edit_exact_match_reports_changed_lines_with_numbers`, `edit_unicode_quote_variant_fails_instead_of_fuzzy_editing`, `edit_report_is_capped`, `edit_crlf_and_bom_preserved`, and the old `Successfully replaced` assertions moved to the new wording.
    - Two downstream assertions expected `Successfully replaced`: `packages/hosts/mcp-server/src/__tests__/serve-tools.test.ts` and `examples/serve-tools.ts` (whose `replaced` flag drives `src/__tests__/docs.test.ts`), both updated to `Edited …: 1 block(s).`.
    - Compat baseline (`arnilo__prism-tools-coding.txt`, untracked) dropped `applyReplacementsPreservingUnchangedLines`, `fuzzyFindText`, `normalizeForFuzzyMatch` and gained `generateChangedLinePreview`. Kernel budgets rebaselined once (packed 1087584, unpacked 3550304 — the root CHANGELOG entry only).
    - Sweep: the retired names survive only in the two CHANGELOG entries that announce the removal.
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 602 pass (the pre-existing process-stress test times out under load); `bun test packages/hosts/mcp-server/src/__tests__/serve-tools.test.ts` 18 pass; `bun test src/__tests__ packages/tools/coding packages/policy packages/hosts` 4823 pass with only the known load timeouts and the 10 pre-existing failures; `bun test src/__tests__/docs.test.ts` 64 pass; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures.

- [x] Task 7: Schemas describe only what the model controls
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
      - Build the schema from the tool's options. Amended at execution: `ASK_USER_DECISION_RATIONALE_COUNT` (3) stays exported and now means the maximum, so the old name keeps working while its check became a 0–3 bound; `requireThreeBullets` became `parseBullets`.
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

  - Notes (executed 2026-10-21):
    - `write`/`edit`: a `const guard = options?.requireReadBeforeWrite === true` at creation decides both the description sentence and a spread `...(guard ? { force: {...} } : {})` entry in `properties`. Without the guard the schema has no `force` (so `additionalProperties: false` rejects the argument) and the description does not mention it. `edit`'s description is now a template literal for that reason.
    - `ask_user_decision`: `parseBullets` accepts `undefined`/`null` → `[]`, rejects more than 3 with `pros must be 0..3 strings`, and keeps the per-bullet byte limit. Schema: `pros`/`cons` are optional with `minItems: 0`, `maxItems: ASK_USER_DECISION_RATIONALE_COUNT`, `required` dropped them. `AskUserDecisionOption.pros`/`.cons` are `readonly string[]`. `ASK_USER_DECISION_RATIONALE_COUNT` stays exported as the maximum and its doc comment says so, so no export was removed.
    - Description text: `each option may list up to 3 pros and up to 3 cons` replaces the "MUST include exactly 3" sentence; the `ask_user_decision` paragraph in the README says the fields are optional and the UI shows whatever is given.
    - Tests: `read-before-write.test.ts` gained `write_schema_has_force_only_with_guard`, `edit_schema_has_force_only_with_guard`, `guard_behavior_unchanged_when_on` (refusal + `force` bypass both still work). `ask-user-decision.test.ts` replaced the exactly-3 test with `ask_user_decision_accepts_zero_to_three_pros_cons` (keys absent, 1/2 bullets, full 3) and `ask_user_decision_rejects_four_pros`, which also asserts the schema's `minItems`/`maxItems`/`required`.
    - No compat-baseline export changed: the constant survives and the type change is inside an existing exported type alias; the tools-coding baseline was checked and left as-is. Kernel budgets rebaselined once (packed 1087898, unpacked 3551077 — the root CHANGELOG entry only).
    - `bun scripts/release.mjs gate --update-baseline` was not run (recorded in Task 2): it rewrites 35 unrelated, already-stale baselines. The note above is the record of what this task changed in the public surface.
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding packages/hosts packages/policy` 1319 pass / 2 known load timeouts; `bun test src/__tests__ packages/tools/coding packages/hosts packages/policy` 4826 pass with only the known load-flaky timeouts and the 10 pre-existing failures; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures.

- [x] Task 8: Fewer tools, one job each
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
      - Remove the overlapping tools; keep `delete`/`move` as the no-shell substitutes. Amended at execution: the shell/no-shell choice is a new `ToolsOptions.shellAvailable` (default true) threaded from the plugin's resolved `shellAvailable`, so `createCodingTools`, `createReadOnlyTools`, the sandbox composition, and the routing rebuild all agree; `GitOperations.branch`/`worktree`/`apply` stay as service operations (tests and the eval fixtures drive them directly), only the tool wrappers went.
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

  - Notes (executed 2026-10-21):
    - Removed `agent/list.ts` and its exports (`createRepoListTool`, `ListToolOptions`, `ToolsOptions.list`, the sandbox composition's `list` option); removed `createGitBranchTool`, `createGitWorktreeTool`, `createGitApplyTool`, `classifyGitBranchEffect`, `classifyGitWorktreeEffect`, `classifyGitApplyEffect`, and `GitToolsOptions.onEvent` (the worktree tool was its only emitter). `GitOperations.branch`/`worktree`/`apply` remain as service operations: `git.test.ts` and `eval-fixtures.test.ts` drive them directly, so `git branch`, `git apply`, and worktree lifecycle stay reachable without a tool schema.
    - Tool sets: default `createCodingTools` = `shell`, `read`, `write`, `edit`, `grep`, `glob` (6); `{ shellAvailable: false }` = the same six minus `shell` plus `delete` and `move` (7); `createReadOnlyTools` = `read`, `grep`, `glob` (3). The plugin registers 12 tools by default (was 18) and 13 with `shell.enabled: false`. `PATH_ARG_KEYS` lost `repo_list`, so `CODING_TOOL_NAMES` and the hard-deny hook follow with no edit; `MUTATING_TOOLS` keeps `delete`/`move` for the shell-less mode.
    - Descriptions: `glob` no longer says "Prefer repo_list", `shell` now says "use shell for everything else (git, rm, mv, directory listings)", and the README states the rule ("one tool per job; `shell` covers what no dedicated tool does").
    - `worktree_changed` has no producer now. The kind stays in `lifecycle.ts`, the emitter's accepted list, the ACP mapper, and `scripts/phase10-freeze-manifest.json` because it is a frozen public contract and the `workspace` service is its natural future producer; changing it is a surface-freeze decision, not this task's.
    - Defect found and fixed in passing: `grep`'s `formatContent` let a later match's context window overwrite an earlier hit (`before` of line N+1 reset line N to `hit: false`), so two adjacent matching lines printed the first as context and `--` grouping shifted. Context now never downgrades a hit — adjacent hits stay hits, as in ripgrep.
    - Tests: `aggregators.test.ts` (new list, `delete_move_register_only_without_shell`, `tool_schema_size_recorded`), `package.test.ts` (`default_tool_set_is_the_documented_list`, effects table, shell-disabled set = 13 with delete/move), `git.test.ts` (`git_tools_are_status_diff_commit_handoff`, apply coverage moved onto `GitOperations.apply`), `effects.test.ts` (classifiers gone, shell-less set carries delete/move), `lifecycle.test.ts` (worktree producer test removed with its tool), `eval-fixtures.test.ts` (`safe-native-list` → `safe-native-search` on `grep`, rollback scenario on `GitOperations.apply`), `repository.test.ts` (repo_list tool tests replaced by an ops-level list contract test and a "repo_list is gone" guard; the grep tool tests were rewritten for `pattern`/`literal`/ripgrep output and now include the worker time-limit case), `routing.test.ts` (builds the shell-less set so `delete` exists for the containment checks), and the sandbox composition/workspace consistency tests use `glob` instead of `repo_list`.
    - `scripts/phase26-freeze-manifest.json` needed no change: it lists `git-tools.ts`/`grep.ts`/`repository.ts` allow-lists and no per-tool names, and it never listed `list.ts`.
    - Schema budget: default `createCodingTools` + `createGitTools` = 10 tools, 8,548 chars of descriptions + schemas (2,137 estimated tokens at 4 chars/token), down from the plan's 3,748-token estimate for the 19-tool set (≈15k chars). The before figure could not be re-measured exactly — the pre-task tree is uncommitted WIP with no baseline commit — so `tool_schema_size_recorded` pins 8,548/10 tools as a ceiling (10,000 chars) instead of asserting a one-time delta.
    - Compat baseline (`arnilo__prism-tools-coding.txt`, untracked) lost the eight removed exports; `GitToolsOptions`/`ToolsOptions` are recorded only as re-export lines, so the option changes need no baseline edit. Kernel budgets rebaselined once (packed 1088322, unpacked 3552255 — the root CHANGELOG entry only).
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 601 pass (only the known process-stress timeout); `bun test packages/tools/coding packages/hosts packages/policy` 1317 pass with the two known load timeouts; `bun test src/__tests__` 4172 pass with only the 10 pre-existing failures; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures.
    - Close-out risks: this is a breaking removal for hosts whose permission rules or prompts name `repo_list`/`git_branch`/`git_apply`/`git_worktree`, and a host that relied on `delete`/`move` next to `shell` must now choose (shell, or `shellAvailable: false`). Sandbox compositions get the shell-present set, so `delete`/`move` disappear there too — `rm`/`mv` inside the sandbox shell is the substitute.

- [x] Task 9: Background processes through `shell`
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
      - One flag on `shell` plus `shell_output`. Amended at execution: a new `agent/shell-background.ts` owns the lazy runtime (one `createProcessSessions` per cwd, built on the first background call; the process library is the only spawner), `agent/shell-output.ts` owns the tool, and both ship through `createCodingTools` — `shell_output` is appended to the set exactly when `options.shell.background` is present, so it can never appear without `shell`. Ownership is `owner: sessionId` on every start, which makes a foreign id `ERR_PRISM_PROCESS_OWNERSHIP`, `cancelOwned(sessionId)` a session-scoped kill, and the plugin's single `session.closed` listener the kill switch (agent dispose closes every open session, so it covers both). The sandbox path is decided by capability, not config: `selectCodingSandbox` now reports the adapter as `processes` only when it has `startProcess`, so the native `unshare` backend (one-shot exec only) keeps `background` out of the schema and registers no `shell_output`. The per-session cap is enforced in the runtime because the registry's `maxSessions` is global.
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

  - Notes (executed 2026-10-21):
    - New modules: `agent/shell-background.ts` (`createBackgroundProcesses`, `BackgroundProcesses`, the `DEFAULT/HARD_MAX_BACKGROUND_PROCESSES` = 4/16, `BACKGROUND_FIRST_OUTPUT_MS` = 1000, `HARD_MAX_BACKGROUND_WAIT_SECONDS` = 60) and `agent/shell-output.ts` (`createShellOutputTool`, `ShellOutputToolOptions`). `ShellToolOptions.background?` carries the runtime; `createCodingTools` adds `shell_output` only when it is set, and `createReadOnlyTools` never does.
    - Runtime shape: `start()` runs `<shell> -c <command>` (the same command string after `commandPrefix`, `spawnHook`, and the policy rewrite) with `owner: sessionId`, waits at most one second for first output, and returns `{ id, output, running, exitCode }`; `read()` refuses a foreign id, optionally waits (50 ms polls, capped at 60 s) for new output or exit, optionally kills, returns the increment since the last call `truncateTail`-capped at the shell's 2000 lines / 50 KB, and reports the state plus the exit code (from `wait()`, which resolves immediately for a finished record — never a fabricated code for a live one). Per-cwd registries keep a worktree-bound session's `start` inside its own root, and each registry's `maxSessions` is 32 so the per-session cap stays the real bound.
    - Plugin: `src/index.ts` builds the runtime only when the shell is registered, the set is not read-only, and either there is no sandbox or the adapter reported `processes`; it threads it into `options.shell` (so every worktree's `cwdTools()` shares it) and registers one `session.closed` listener with id `shell-background`. `src/sandbox.ts` gained `SelectedCodingSandbox.processes`; `src/config.ts` gained `shell.background.maxProcesses` (schema 1..16, default 4) plus the `ToolsCodingShellBackgroundConfig` type; `src/targets.ts` gained `shell_output: []` (no path arguments, no `command`, so hard-deny's containment and command-rule branches skip it while `CODING_TOOL_NAMES` still recognizes it).
    - Security: background commands hit the same `tool.call` hard-deny handler with the same `command` argument, and the shell tool's `enforceExecutionPolicy` runs before the background branch, so a denied command never spawns. The environment allow-list, `commandPrefix`, `spawnHook`, and the sandbox adapter are inherited; `src/tools.ts:329` redacts every tool result, so `shell_output` text is redacted exactly like `shell` text; `cancelOwned` kills the process group and cleans the output spill file, so nothing outlives the session.
    - Tests (25 green): `agent/__tests__/shell-background.test.ts` — `shell_background_returns_id_and_first_output`, `shell_output_returns_incremental_output_and_exit_code`, `shell_output_wait_returns_later_output`, `shell_output_kill_ends_process`, `shell_output_foreign_session_id_is_error` (owner mismatch and unknown id), `background_processes_killed_on_session_close`, `background_command_hits_command_rules_deny` (hard-deny rule plus an `ExecutionPolicy` deny that leaves no process), `background_process_cap_enforced`, `background_schema_and_first_output_bound`, `background_is_lazy_no_registry_until_first_call`; `src/__tests__/shell-background-plugin.test.ts` — the two end-to-end invariants (a real `sh -c 'echo $$ > pid.txt; sleep 30'` is dead after `session.close()` and after `agent.dispose()` without a close) plus `shell_output_is_registered_with_shell`; `package.test.ts` — the default list now includes `shell_output` and `background_is_absent_without_a_process_capable_sandbox` (native sandbox: `shell` stays, `shell_output` is not registered).
    - Docs: `packages/tools/coding/README.md` (config row for `shell.background.maxProcesses`, the effects row, the `shell` row with `background?`, the new `shell_output` row, and the non-goals paragraph now says long-running commands are supported while PTY control stays a non-goal); root and package CHANGELOG [Unreleased] entries. No `docs/` page names background processes.
    - Compat baseline (`arnilo__prism-tools-coding.txt`, untracked) gained the thirteen new exports in sorted position; kernel budgets rebaselined once (packed 1088895, unpacked 3553915 — the root CHANGELOG entry only).
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 618 pass with only the known process-stress timeout; `bun test packages/tools/coding packages/hosts packages/policy` 1331 pass with the two known load timeouts; `bun test src/__tests__` 4177 pass with only the known pre-existing failures; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures; biome clean on every touched file.
    - Close-out risks: `shell({ background: true })` still waits up to a second for first output, so a silent command costs 1 s before the call returns; an incremental read returns at most one output chunk per call (the wait loop stops at the first non-empty chunk), so a very chatty process may need a second `shell_output` to catch up; and the process lifetime defaults to the library's 4 h with no config field yet.

- [x] Task 10: Opt-in `diagnostics`, and delete `agent/review.ts`
  - Acceptance Criteria:
    - Functional: A new config field `language.servers` (a map of server name to `{ command, args?, languages, env? }`, shaped by Task 1 (f): `languages` are LSP language ids, not file extensions) registers a `diagnostics` tool (`{ path }`, `effects: ["read"]`) that returns the language server's normalized diagnostics for one file as `path:line:col severity message` (1-based line and column), capped by `resolveDiagnosticsLimits`. Without `language.servers`, nothing is registered and no server starts.
    - Functional: A server that fails to start gives a tool error naming the server and a one-time `status.note("warn", …)`; it never fails the run. Servers stop when the last open session closes, which includes `agent.dispose()` closing every open session.
    - Functional: `agent/review.ts` is deleted with its test, its `agent/index.ts` re-exports, and its compat-baseline lines; `scripts/fixtures/phase26-coding-journey.mjs` drops the `patch-review` leg and `scripts/phase26-coding-journey.test.mjs` stops expecting it. `lifecycle.ts` and `coding-checkpoint.ts` stay (Task 1 (c)); `agent/goal-verify.ts` stays. A repo-wide grep for each deleted export (exclusions as in Task 2) finds only CHANGELOG history, the orphaned `arnilo__prism-{code,coding-agent,coding-tools}.txt` baselines, and dated Phase 26 evidence.
    - Performance: Importing the package still starts no language server and spawns nothing; the load-cost test asserts it.
    - Code Quality: The tool wraps the existing `createLanguageIntelligence`; no second LSP client.
    - Security: Server commands come from host config only, never from the model. `diagnostics` paths go through the hard-deny containment (`PATH_ARG_KEYS.diagnostics = ["path"]`).
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/agent/language/{intelligence,client,framing,types}.ts`; `agent/diagnostics.ts`; `examples/phase9-coding-intelligence.ts:56-211`; Task 1 (c), (f).
    - Options Considered:
      - Delete the language library too. Rejected: diagnostics after an edit is the check an agent most wants, and the library is tested.
      - Register `diagnostics` by default with auto-detected servers. Rejected: spawns processes the host did not ask for.
      - Delete `lifecycle.ts` and `coding-checkpoint.ts` as the first draft said. Rejected by Task 1 (c): both are live.
      - Add a bounded settle wait for push-only servers. Chosen: one export (`languageIdForPath`) plus a poll is smaller than a new publication API on the library.
    - Chosen Approach:
      - Opt-in tool over the existing library; delete only the module nothing uses. `createDiagnosticsTool(cwd, options)` returns `{ tool, dispose }`, so the plugin can stop servers without a per-tool shutdown contract: the handle drops its client and re-creates it lazily, which is why a disposed tool still works on the next call.
    - API Notes and Examples:
      ```jsonc
      { "language": { "servers": { "ts": { "command": "typescript-language-server", "args": ["--stdio"], "languages": ["typescript", "typescriptreact"] } } } }
      ```
    - Files to Create/Edit:
      - `packages/tools/coding/src/agent/diagnostics-tool.ts` (new), `src/index.ts`, `src/config.ts`, `src/targets.ts`, `agent/index.ts`, `agent/language/{intelligence,index}.ts` (export `languageIdForPath`), `agent/limits.ts` (drop the four review-only constants), `agent/review.ts` and `agent/__tests__/review.test.ts` (delete), `agent/__tests__/diagnostics-tool.test.ts` (new, `fixtures/fake-lsp.mjs`), `src/__tests__/{package,hard-deny}.test.ts`, `scripts/fixtures/phase26-coding-journey.mjs`, `scripts/phase26-coding-journey.test.mjs`, `packages/tools/coding/README.md`, `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, `CHANGELOG.md` (root and package).
    - References:
      - The 2026-10-17 evaluation C10 and "unregistered code"; Task 1 note (c), (f), (h).
  - Test Cases to Write:
    - `diagnostics_absent_without_language_config`.
    - `diagnostics_returns_normalized_lines` (fake LSP server).
    - `diagnostics_server_start_failure_is_tool_error_and_note`.
    - `diagnostics_path_outside_roots_is_hard_denied`.
    - `package_import_starts_no_language_server`.
  - Notes (executed 2026-10-21):
    - `agent/diagnostics-tool.ts` returns `DiagnosticsToolHandle { tool, dispose }`. Execution order is `syncDocument(file)` → `diagnosticDelta({ files: [file] })` (a pull server answers, a push server's cache is read) → a bounded 500 ms / 25 ms poll of `diagnostics(file)` when both are empty, so a push-only first call still answers. Output is sorted by line/column, `path:line:col severity message` 1-based, capped at `resolveDiagnosticsLimits` (500 per file / 4 KiB per message) with `(… N more diagnostics)`; `value` carries `{ file, diagnostics, truncated }`. Errors are tool errors; a start failure names the server (`serverNameForFile` maps extension → LSP id via the newly exported `languageIdForPath`) and calls `onServerFailure` once per server.
    - Plugin: `language.servers` (non-empty) enables the tool in `cwdTools`, so each worktree root gets its own workspace and one handle per cwd; the handle map is kept across disposals so a disposed tool re-arms rather than leaking a fresh intelligence. `session.opened`/`session.closed` (ids `language-open`, `language-servers`) dispose every handle when the last open session closes — `agent.dispose()` closes all sessions, so it stops them too. With a sandbox configured the package notes that servers run on the host, outside it.
    - Deleted: `agent/review.ts` (400 lines) + `agent/__tests__/review.test.ts` (13 tests), its 15 type re-exports and 4 value re-exports in `agent/index.ts`, and the four constants only it used (`DEFAULT_/HARD_MAX_REVIEW_REVISIONS`, `DEFAULT_/HARD_MAX_REVIEW_MANIFEST_BYTES`); the two `*_DIAGNOSTICS` constants stay because `diagnostics.ts` uses them. Kept: `lifecycle.ts` (type-imported by five shipped tools) and `coding-checkpoint.ts` (`goal-verify.ts`), as Task 1 (c) requires. `scripts/fixtures/phase26-coding-journey.mjs` lost the `patch-review` leg, its `createArtifactService` stub, its two review imports and its now-dead `artifactService`/`artifactId` state; `scripts/phase26-coding-journey.test.mjs` no longer expects that leg. The Phase 26 manifest and baseline were left alone: they are dated historical evidence, already failing on pre-rename `packages/coding-agent/*` paths before this task.
    - Tests (24 new/existing across four files, all green): `agent/__tests__/diagnostics-tool.test.ts` — `diagnostics_returns_normalized_lines`, `diagnostics_unknown_language_names_the_language`, `diagnostics_server_start_failure_is_tool_error_and_one_note`, `diagnostics_path_outside_root_is_an_error`, `diagnostics_construction_starts_no_server`, `diagnostics_dispose_stops_the_server_and_the_next_call_restarts_it`; `src/__tests__/package.test.ts` — `diagnostics_absent_without_language_config`, `diagnostics_registers_with_language_servers_and_starts_nothing`, `language_servers_stop_when_the_last_session_closes` (a real server pid is dead after `session.close()`); `src/__tests__/hard-deny.test.ts` — `diagnostics_path_outside_roots_is_hard_denied`.
    - Docs: package README (config row, effects row, tool row, cost paragraph, factory list), root and package CHANGELOG (Added `diagnostics`, Removed the review module and its constants). No `docs/` page names review or diagnostics, so no `docs/` edit; the package README is the tool reference.
    - Checks: `bun run typecheck` green; `bun test packages/tools/coding` 614 pass with only the known process-stress timeout; `bun test packages/tools/coding packages/hosts packages/policy` 1327 pass with the two known load timeouts; `bun scripts/release.mjs gate` green outside the 13 pre-existing compat failures; biome clean; kernel budgets rebaselined once (packed 1089486, unpacked 3555466 — the root CHANGELOG entry only). The coding package has 22 fewer baseline exports and 6 new ones (`createDiagnosticsTool`, `DiagnosticsToolHandle`, `DiagnosticsToolOptions`, `ToolsCodingLanguageConfig`, `ToolsCodingLanguageServerConfig`, `languageIdForPath`).
    - Failures this task did not cause: `src/__tests__/docs.test.ts` (6) and `packaging.test.ts` (1) failed because `scripts/package-truth.json` was still the 0.12.1 artifact (39 publishable packages) while `docs/release.md` and the tree said 43 — since regenerated with every compat baseline (see Further Actions); `packages/memory/fabric` `no_workspace_imports_prism_memory_family` also failed standalone and passes after that regeneration. `hard_deny_decision_budget` measured 51–55 ms against its 50 ms budget in this environment, both with and without this task's `PATH_ARG_KEYS` change, so it is an environment-sensitive microbenchmark, not a regression; its own note says it retries three batches.
    - Close-out risk: a push-only language server can return an empty first result when it publishes later than the 500 ms settle window; the tool then reports `No diagnostics for <file>` rather than waiting longer (a second call answers). Diagnostics positions are 1-based while the library's are 0-based, so a host comparing them to raw LSP output must subtract one.

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

- **Compat baselines were hand-edited during the tasks and regenerated at the end.** `--update-baseline` rewrites every baseline, so each task edited only its own line and left the pre-existing drift alone; the whole set was then regenerated once as the plan's follow-up action, which cleared both the 13 compat failures and the stale `scripts/package-truth.json` (see Further Actions).
- **No live wire recording for Task 2.** Anthropic `tool_result` image support is doc-verified (2026-10-21) but never exercised against the live API; Hyper and OpenCode Go inherit the provider-kit codecs, so nothing was recorded there either.
- **Task 4 ships the engine's error text, not a parse position.** V8's `RegExp` message names the problem but not an offset, so "the error names the position" was met only as "names the problem".
- **Task 6's changed-line report is diff-based, not read's page formatter.** `generateChangedLinePreview` shares `read`'s `N\ttext` shape but not its byte-capped paging; the two serve different jobs and were kept separate.
- **Task 10 leaves the Phase 26 manifest and baseline untouched.** They are dated historical evidence with pre-rename `packages/coding-agent/*` paths and were already failing before this plan; rewriting history to match was judged worse than recording the drift.
- **Task 10's `diagnostics` waits at most 500 ms for a push-only server.** A server that publishes later returns `No diagnostics`, and a second call answers. A richer "wait for publication" API on the language library was judged out of scope.
- **`hard_deny_decision_budget` is environment-sensitive.** It measures 50–55 ms against a 50 ms budget on this machine with and without this plan's changes; the budget itself was left alone.

## Further Actions

- **[Done 2026-10-21 — baselines and docs truth]** Regenerated `scripts/package-truth.json` (`bun scripts/package-truth.mjs`: 39 → 43 publishable packages, provider adapters 21 → 4, `prism-*` family 3 → 1, pure manifests 2 → 0, versions 0.12.1 → 0.13.0; 84 insertions / 76 deletions) and every compat baseline (`bun scripts/release.mjs gate --update-baseline`: 15 files, +766/−967). Two follow-ups fell out: `agent/index.ts` now re-exports `DiagnosticsToolHandle`/`DiagnosticsToolOptions` (Task 10 shipped the types through `src/index.ts` only by direct import, so `export * from "./agent/index.js"` did not surface them), and the regenerated baselines use the generator's `export declare` form. Result: `bun scripts/release.mjs gate` reports `{"updated": false}` with no compat failures, `docs.test.ts` + `packaging.test.ts` 303 pass / 0 fail, `scripts/package-truth.test.mjs` green, `bun test src/__tests__` 4180 pass / 10 fail where the 10 are exactly the plan 182/183 frozen-surface and boundary-gate failures below (the 6 docs, 1 packaging and 1 memory-family failures were the stale artifact). `scripts/phase26-freeze.test.mjs` stays at its pre-existing 5 pass / 6 fail (it compares against a Task 0 byte baseline and pre-rename paths). Docs needed no edit: `docs/release.md` was already correct at 43 and the artifact was the stale side.
- **[Done 2026-10-21 — frozen surface absorbed]** The plan 182/183 frozen surface is still red. Ten failures remain in `src/__tests__` and none is a count: `provider_kit_exports_match_inventory`, `provider_kit_surface_is_frozen`, `testing_surface_is_frozen`, `provider_packages_spawn_no_process_and_open_no_browser` (asserts `scanned.length > 20` with 14 provider packages left), `host_libraries_import_only_allowlisted_kernel_names`, `core source boundaries > core runtime has no provider-specific literals`, `network-free default test guard`, plus three load-sensitive timing tests (`(unnamed)` 5 s, `host_adapter_passes_adapter_conformance` 5 s, the field-policy microbenchmark). Names to add or drop: `systemOneConformance`, `systemOneProviderPackage`, `warnIfPlaintextRemote`, `isLoopbackHost`, `isPlaintextRemote`, `plaintextRemoteOrigin`, `OMITTED_TOOL_RESULT_IMAGE_NOTE`, `DEFAULT_LIVE_CACHE_PREFIX`, `LIVE_WEATHER_TOOL`, `checkLayaServerReachable`, `executeProviderLiveScenarios`, `executeSystemOneLiveScenarios`, `runProviderLiveScenarios`, `runSystemOneLiveScenarios`. Surface-freeze plan (185). **Fixed same day:** `src/__tests__/provider-kit.test.ts` gained the six kit names the inventory was missing (`isLoopbackHost`, `isPlaintextRemote`, `plaintextRemoteOrigin`, `systemOneConformance`, `systemOneProviderPackage`, `warnIfPlaintextRemote`) and its spawn/browser scan guard became `scanned.length >= dirs.length` instead of `> 20`, since plan 182 left 14 provider packages; `src/__tests__/public-export-contract.test.ts`'s `FROZEN_PROVIDER_KIT_EXPORTS` gained the same six and `FROZEN_TESTING_EXPORTS` gained `DEFAULT_LIVE_CACHE_PREFIX`, `LIVE_WEATHER_TOOL`, `checkLayaServerReachable`, `executeProviderLiveScenarios`, `executeSystemOneLiveScenarios`, `runProviderLiveScenarios`, `runSystemOneLiveScenarios`; `scripts/host-surface-allowlist.json` `phase17` gained `RunResultStatus` (the headless scheduler imports it and it is the union of `RunResult.status`); `src/__tests__/core-boundaries.test.ts` added `src/testing/provider-live-scenarios.ts` to `PROVIDER_LITERAL_SEAMS` (the live-scenario table names `anthropic`/`opencode` by design and is test-support, not runtime); and `src/__tests__/network-free-guard.test.ts` no longer treats any path containing "live" as a live test, which had made 23 `delivery/__tests__/*.test.ts` files false positives — it now matches the `live.test.ts` / `*-live.test.ts` basenames. Result: `bun test --timeout=0 src/__tests__` 4204 pass / 0 fail, so the root suite is green for the first time; under the default 5 s timeout three load-only timeouts remain and each passes standalone (unnamed, the field-policy microbenchmark, `host_adapter_passes_adapter_conformance`). `packages/hosts` + `packages/policy` 714 pass, `packages/providers` 74 pass, gate green.
- **[Done 2026-10-21 — recorded in plan 185]** The surface-freeze plan must record this plan's removals. Gone from `tools-coding`: `repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree`, `createRepoListTool`, `ListToolOptions`, the three git-tool factories, three effects classifiers, `normalizeForFuzzyMatch`, `fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`, `AppliedEditsResult.usedFuzzyMatch`, `EditToolDetails.fuzzy`, the whole review module and its four constants, `ToolsOptions.list`, `GitToolsOptions.onEvent`, and `GlobToolOptions.braceExpansion`. Added: `shell_output`, `diagnostics`, `generateChangedLinePreview`, `compileGlob`, `createBackgroundProcesses`, `createDiagnosticsTool`, `languageIdForPath`, `MatchLines`/`literalMatcher`, and the background/diagnostics constants. Kernel: `serializeToolResultJson` → `serializeToolResultText`, plus `OMITTED_TOOL_RESULT_IMAGE_NOTE`. **Recorded 2026-10-21 in plan 185 as Task 1 (e)** (Gone / Added / Kernel / Baselines sub-bullets, checked name by name against the regenerated `arnilo__prism-tools-coding.txt` and `arnilo__prism.txt`), with Task 4 gaining `compat_coding_surface_has_no_plan189_removals` and a format-only-baseline acceptance line, and the plan's Expected Outcome and Verification now naming the post-189 surface. The recording also documents what today's baselines cannot catch: no interface body is recorded (Task 4's job) and `ToolsOptions`, declared in the package barrel, is absent from the baseline entirely.
- **[Done 2026-10-21 — producer restored]** `worktree_changed` has no producer. Task 8 removed the only tool that emitted it while the event kind stays frozen by `scripts/phase10-freeze-manifest.json` and consumed by `packages/hosts/acp` and `ag-ui`; either a service-level emitter returns or the kind is retired with its consumers. **Chosen: the emitter returns.** `WorkspaceServiceOptions.onEvent` (optional, `packages/tools/coding/src/workspace/service.ts`) feeds a `createCodingLifecycleEmitter`, and the service emits `{ type: "worktree_changed", action: "add", path }` after `worktree.create` succeeds and `{ action: "remove", path }` after `disposeWorktree` removed one — the layer that still owns worktrees after Task 8 deleted the `git_worktree` tool, so the frozen kind keeps a producer and ACP's projection (`agent_message_chunk` keyed `prism:worktree:<path>`) is reachable again. No kind, consumer, or freeze-manifest entry changed, and no export was added: an interface field only, so the compat baseline is untouched. Host-wired like every other coding lifecycle event (the plugin passes no sink); test `worktree_changed_events_come_from_the_service` in `workspace/__tests__/workspace.test.ts` asserts the add/remove pair; README and root + package CHANGELOG state the wiring. Checks: `packages/tools/coding` 617 pass, workspace suite 26 pass, ACP + AG-UI + lifecycle 138 pass, root suite 4203 pass with only the known flaky field-policy microbenchmark, gate green after one kernel rebaseline (packed 1089925 / unpacked 3556678, root CHANGELOG only). One required amendment fell out: `createCodingLifecycleEmitter.emit` called listeners unguarded, so a throwing host sink would have failed `worktree.create` after the worktree existed (the same exposure the file tools already had); `emit` now swallows a listener throw, which matches its own documented promise that producer success paths never break on telemetry, with test `a_throwing_listener_does_not_break_the_producer_and_the_others_still_run`.
- **[Done 2026-10-21 — split landed]** `lifecycle.ts` deserves a follow-up split. Task 1 (c) kept it because five tools type-import `CodingLifecycleEvent`; moving that type into a tiny module would let the emitter half go if no host uses it. **Split done without retiring anything:** the vocabulary (`FileChangeOp`, the nine event interfaces, `CodingLifecycleEvent`) moved verbatim to `packages/tools/coding/src/agent/lifecycle-events.ts` (122 lines, types only, no runtime code), and `lifecycle.ts` (165 lines) keeps the caps, `CodingLifecycleError`, `resolveCodingLifecycleLimits`, the frozen-kind set and `createCodingLifecycleEmitter`, re-exporting the vocabulary with an explicit `export type { … } from "./lifecycle-events.js"` so `agent/index.ts` and the package surface are untouched (gate: `{"updated": false, "packages": 43}`, no baseline churn — interfaces and type aliases were never recorded there anyway). The five tools (`write`/`edit`/`delete`/`move`) plus `coding-checkpoint.ts` and the workspace test now type-import `lifecycle-events.js`, so no producer drags the emitter. The emitter half did NOT go: after the `worktree_changed` follow-up above it has a real in-tree producer (`createWorkspaceService`), alongside its host-facing export, so `lifecycle.ts` stays and only its input moved. No CHANGELOG entry — file layout only, no name, declaration or behavior changed. Checks: typecheck 0 errors, `packages/tools/coding` 618 pass, agent tests + ACP + AG-UI 554 pass, root suite 4204 pass / 0 fail, `scripts/phase26-freeze.test.mjs` unchanged at its pre-existing 5 pass / 6 fail.
- **[Done 2026-10-21 — event-driven]** Was low: `shell({ background: true })` pays up to one second for first output, and one `shell_output` call returns at most one accumulated chunk. A publication event on `ProcessSession` would remove both. **Done — the publication exists:** `ProcessSession.onOutput(listener)` (a returned unsubscribe; a throwing listener never fails the process) fires from the spawn's `onData` after every appended chunk and from `settleWaiters` on the terminal transition, via a single `notifyOutput(record)` helper over a per-record listener set. `shell-background.ts` dropped `POLL_INTERVAL_MS` and its 50 ms loop: `waitFor` subscribes *before* the first read (so a chunk published in between is not missed), reads what is there, and otherwise awaits the publication or the deadline; `shell({ background: true })` now returns in tens of milliseconds for a command that prints at once and still caps the wait at one second for a silent one. The second half is fixed by `readAvailable`, which drains whole chunks up to twice the format cap (so a burst costs one call instead of one call per 50 KB chunk) bounded by the existing tail truncation. Tests: `onOutput publishes each chunk and the terminal transition` (chunk + exit fire, unsubscribe stops delivery), `shell_background_returns_as_soon_as_the_first_output_arrives` (elapsed < 700 ms; it waited the full 1000 ms before) and `shell_output_drains_every_accumulated_chunk` (one call returns > 60 KB of a 120 KB burst; it returned ~50 KB before). Caps, ownership, the tool schemas and the constants are unchanged; README rows plus root and package CHANGELOG entries updated; kernel rebaselined once (1090248 / 3557596, root CHANGELOG only). Checks: typecheck 0 errors, `packages/tools/coding` 621 pass, gate `{"updated": false}`, root suite 4204 pass / 0 fail.
- **Low — `diagnostics` reports 1-based positions** while LSP is 0-based; a host that compares tool output to raw LSP data has to subtract one.
