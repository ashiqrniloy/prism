# Coding-Agent First-Party Tools Package

## Objectives
- Introduce a new first-party Prism package `@arnilo/prism-coding-agent` that provides generically useful coding-agent tools: `shell`, `read`, `write`, `edit`.
- Let any third-party app built on Prism optionally adopt these tools by importing factory functions and registering them into a `ToolRegistry` — fully opt-in, no auto-activation, no manifest required.
- Port the implementation behavior of the pi coding agent's bash/read/write/edit tools (and their shared helpers) so these tools are a behavioral drop-in for pi's, while conforming to Prism's own `ToolDefinition` / `ToolResult` / `ToolExecutionContext` contracts instead of pi's `AgentTool` / typebox `ToolDefinition`.
- Keep the package dependency-light: stdlib only for shell/fs/path/crypto/os, plus one small pure-JS diff library for unified-patch metadata.

## Expected Outcome
- `packages/coding-agent/` builds via `tsc`, typechecks under the workspace, passes `node --test`, and `npm pack --dry-run` cleanly.
- `import { createCodingTools, createShellTool, createReadTool, createWriteTool, createEditTool } from "@arnilo/prism-coding-agent"` yields Prism `ToolDefinition` objects that run against the local host filesystem/shell relative to a `cwd`.
- The four tools work through `createToolRegistry([...])` + `dispatchToolCall()` exactly like any host tool, returning `TextContent` (and `ImageContent` for image reads) with bounded/truncated output.
- `docs/coding-agent-tools.md` documents the package using the Prism API-page structure, and `docs/index.md` links it under the Tools group.
- Prism core (`@arnilo/prism`) is unchanged; the new package is a pure addition.

## Tasks

- [x] 0. Primitive review: inventory Prism + pi primitives before building package tools
  - Acceptance Criteria:
    - Functional: A written inventory (in this task's Approach) confirms (a) Prism core ships no coding/shell/fs tools, (b) the exact Prism `ToolDefinition`/`ToolResult`/`ToolExecutionContext`/`ContentBlock` shapes the package must target, (c) which pi helper modules are reusable generic primitives vs. pi/TUI-specific code to drop, and (d) the real runtime dependencies the pi tools pull in.
    - Performance: N/A (research task).
    - Code Quality: The inventory must cite concrete file paths and line numbers so subsequent tasks build only on verified primitives.
    - Security: Identify which pi modules touch trust boundaries (shell spawn, path resolution, fs writes) so the port preserves their guards.
  - Approach:
    - Documentation Reviewed:
      - Prism: `src/contracts.ts` (`ToolDefinition` L359-365, `ToolExecutionContext` L373-381, `ToolResult` L382-389, `ContentBlock`/`TextContent`/`ImageContent` L22-40), `src/tools.ts` (`createToolRegistry`, `dispatchToolCall`, `filterTools`), `docs/tools.md` ("Prism does not sandbox host tools and does not include built-in app tools"), `docs/tool-conformance.md`.
      - pi (installed dist): `dist/core/tools/{bash,read,write,edit,edit-diff,truncate,output-accumulator,file-mutation-queue,path-utils,render-utils,index}.d.ts` and `.js` import graphs.
    - Options Considered:
      - Build the four tools directly on Prism `ToolDefinition` (chosen) vs. mirror pi's `AgentTool` + typebox `ToolDefinition` and adapt at the boundary. The latter drags typebox + `@earendil-works/pi-agent-core` types into a Prism package and breaks drop-in for Prism apps; rejected.
      - Reuse Prism-internal helpers vs. vendor pi's helpers inside the package. Prism core has no truncate/diff/accumulator utilities, so the package must carry its own copies (self-contained, no core churn).
    - Chosen Approach:
      - Target Prism's plain contracts. Map pi content to Prism `ContentBlock` (`TextContent` type `"text"`, `ImageContent` type `"image"` with `mimeType`/`data`).
      - **Verified inventory (citations):**
        - **(a) Prism core ships no coding/shell/fs tools.** `rg child_process|spawnSync|execSync|\.spawn|createBash|createShell|shellTool|bashTool|readTool|writeTool|editTool` over `src/*.ts` returns no tool implementations. The only `node:fs` import outside tests is `src/cli-runner.ts:5` (`readFile`), used for CLI config loading (`cli-runner.ts:334`), not a tool. `docs/tools.md` states explicitly: "Prism does not sandbox host tools and does not include built-in app tools." Core exposes only the harness.
        - **(b) Target Prism contracts (`src/contracts.ts`):** `ContentBlock` (L22, union incl. `TextContent` L30 `{ type:"text"; text:string }`, `ImageContent` L35 `{ type:"image"; mimeType?; data?; url? }`); `ToolDefinition` (L359) `{ name; description?; parameters?: JsonObject; execute(args, ctx) }`; `ToolExecutionContext` (L373) `{ sessionId; runId; toolCallId; signal?; metadata?; progress?(...) }`; `ToolResult` (L382) `{ toolCallId; name; content?: readonly ContentBlock[]; value?; error?: ErrorInfo; metadata? }`. The package's tools must return `ToolResult` with `toolCallId: context.toolCallId` and `name` matching the tool.
        - **(c) Reusable generic pi primitives to PORT into the package** (all from `dist/core/tools/`): `truncate` (head/tail/line + `TruncationResult`; dep-free), `edit-diff` (fuzzy-match normalization + `applyReplacementsPreservingUnchangedLines`; **uses `diff` lib** — `edit-diff.js:4` `import * as Diff from "diff"`, L278 `Diff.diffLines`), `output-accumulator` (streaming UTF-8 + temp-file spillover; `node:crypto/fs/os`), `file-mutation-queue` (per-path mutex Map), `path-utils` (`resolveToCwd`/`expandPath`; pi pulls homedir from internal `utils/paths.js` → replace with `node:os.homedir()`).
        - **(c-cont.) pi-specific code to DROP** (TUI/extension-internal, not part of tool behavior): `render-utils`, `tool-definition-wrapper` (pi `AgentTool`↔`ToolDefinition` bridge), `typebox` schemas (Prism uses plain JSON Schema `parameters`), `@earendil-works/pi-tui` + theme/keybinding-hints/visual-truncate/diff `Box` components, and `grep`/`find`/`ls` tools (out of scope — only shell/read/write/edit requested).
        - **(d) Real runtime dependency surface of the pi tools:**
          - `edit-diff` → `diff` (jsdiff) for patch/diff-string → **add as runtime dep** (task 3).
          - `read` → `utils/image-process` (auto-resize via `image-resize.js` `node:worker_threads` Worker + `image-resize-core.js`, and `image-convert.js` → `utils/photon.js` `loadPhoton` Rust/WASM + `exif-orientation.js`) and `utils/mime` (`detectSupportedImageMimeType(buffer)` L4, magic-byte pure JS). → **Defer auto-resize** (heavy native/WASM + worker); **port magic-byte MIME in-package** (task 6).
          - `bash` → pi-internal `utils/child-process.js` (`spawnProcess` L4, `waitForChildProcess` L23) and `utils/shell.js` (`getShellConfig`, `getShellEnv`, `killProcessTree`, `trackDetachedChildPid`). → **Re-port spawn over stdlib `child_process`** and reimplement process-tree kill + shell/env resolution in-package; do not copy pi-internal utils (task 5).
        - **Prism barrel seam confirmed:** `src/index.ts:61` re-exports `createToolRegistry, dispatchToolCall, filterTools` — the package consumes these via the `@arnilo/prism` peer dep.
      - Decisions captured above flow into tasks 2/3/4 (helpers), 5 (shell), 6 (read), 7 (write), 8 (edit+barrel).
    - Files to Create/Edit:
      - None (research only); outputs feed tasks 1-9.
    - References:
      - `src/contracts.ts:22-40,359-389`; `src/tools.ts`; `docs/tools.md`; `docs/tool-conformance.md`.
      - pi `dist/core/tools/*.d.ts` import lists.

- [x] 1. Scaffold `packages/coding-agent` package and workspace wiring
  - Acceptance Criteria:
    - Functional: `npm run build --workspace @arnilo/prism-coding-agent` emits `dist/index.js` + `.d.ts`; the package is importable as `@arnilo/prism-coding-agent` from the workspace via `file:../..` devDep and `0.0.2` peerDep on `@arnilo/prism`.
    - Performance: Build time within range of sibling packages (compaction-llm/provider-*); no new native modules.
    - Code Quality: `tsconfig.json` extends `../../tsconfig.packages.json`; ESM (`"type": "module"`); `sideEffects: false`; `exports["."]` with types+default; `engines.node >=20`; follows sibling `package.json` field order/license/repo fields.
    - Security: No postinstall scripts; `files` allowlist excludes `__tests__` and source maps from the published tarball.
  - Approach:
    - Documentation Reviewed:
      - Sibling package templates: `packages/compaction-llm/package.json`, `packages/provider-openai/package.json`, `packages/provider-openai/tsconfig.json`.
      - Root `package.json` `workspaces` (covers `packages/provider-*`, `packages/compaction-*`, plus explicit `packages/prism-providers`, `packages/prism-compaction`, `packages/prism-all`).
      - `tsconfig.packages.json` (target ES2022, NodeNext, `paths` mapping `@arnilo/prism` → `./dist`).
    - Options Considered:
      - Add a workspace glob `packages/coding-*` vs. explicit `packages/coding-agent` entry. Explicit is consistent with the existing `prism-providers`/`prism-compaction`/`prism-all` exceptions and avoids surprising future matches; chosen.
      - Bundle into `prism-all` umbrella now vs. defer. Coding tools perform host shell/fs access and are an opt-in trust-bearing capability distinct from the connection/memory layers `prism-all` aggregates; defer (see Further Actions).
    - Chosen Approach:
      - Create `packages/coding-agent/{src,package.json,tsconfig.json,LICENSE,README.md}`. `src/index.ts` re-exports public factories (filled by later tasks; starts with a placeholder re-export comment). `package.json` name `@arnilo/prism-coding-agent`, version `0.0.2`, scripts `build`/`typecheck`/`test`/`pack:dry-run` matching siblings, `peerDependencies: { "@arnilo/prism": "0.0.2" }`, `devDependencies: { "@arnilo/prism": "file:../.." }` (no runtime deps yet; `"diff"` lands in task 3). Add `packages/coding-agent` to root `workspaces`, then run `npm install` to materialize the `node_modules/@arnilo/prism-coding-agent` symlink and update `package-lock.json` (workspace self-links are not created until an install pass runs).
    - API Notes and Examples:
      ```jsonc
      // packages/coding-agent/package.json (core fields)
      {
        "name": "@arnilo/prism-coding-agent",
        "version": "0.0.2",
        "type": "module",
        "main": "./dist/index.js",
        "types": "./dist/index.d.ts",
        "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
        "peerDependencies": { "@arnilo/prism": "0.0.2" },
        "devDependencies": { "@arnilo/prism": "file:../.." },
        "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "node --test dist/__tests__/*.test.js", "pack:dry-run": "npm pack --dry-run" }
      }
      ```
      ```jsonc
      // packages/coding-agent/tsconfig.json
      { "extends": "../../tsconfig.packages.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/package.json`: new package manifest (fields above).
      - `packages/coding-agent/tsconfig.json`: extends packages base.
      - `packages/coding-agent/src/index.ts`: public barrel (populated by later tasks).
      - `packages/coding-agent/LICENSE`: copy MIT license used by siblings.
      - `packages/coding-agent/README.md`: short package readme (expanded in task 9).
      - `package.json` (root): add `"packages/coding-agent"` to `workspaces`.
    - References:
      - `packages/compaction-llm/package.json`; `packages/provider-openai/{package.json,tsconfig.json}`; root `package.json` `workspaces`.
  - Test Cases to Write:
    - Workspace resolution: `npm ls @arnilo/prism-coding-agent --workspace @arnilo/prism-coding-agent` resolves to the local package.
    - `npm run build --workspace @arnilo/prism-coding-agent` exits 0 and emits `dist/index.js`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public package subpath `@arnilo/prism-coding-agent`.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (created in task 9).
    - `docs/index.md` update: yes — add Tools-group nav entry (task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Port generic primitives: `truncate`
  - Acceptance Criteria:
    - Functional: `truncateHead(content, opts?)` and `truncateTail(content, opts?)` keep first/last N lines or bytes (whichever hits first), never split a line (except the documented tail single-line-over-byte-limit case), and return a `TruncationResult` with `truncated`/`truncatedBy`/`totalLines`/`totalBytes`/`outputLines`/`outputBytes`/`maxLines`/`maxBytes`. `truncateLine(line, max?)` appends `[truncated]`. Defaults: 2000 lines, 50KB.
    - Performance: O(content length), single pass; no regex over full content.
    - Code Quality: Pure functions, zero imports, fully typed; direct TS port of pi's `dist/core/tools/truncate.js` semantics.
    - Security: No fs/network; deterministic.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/truncate.d.ts` (DEFAULT_MAX_LINES=2000, DEFAULT_MAX_BYTES=50KB, GREP_MAX_LINE_LENGTH=500, TruncationResult/TruncationOptions, `truncateHead`/`truncateTail`/`truncateLine`/`formatSize`).
    - Options Considered:
      - Port pi's algorithm verbatim (chosen) vs. write a simpler line-only truncator. Verbatim preserves pi's byte+line dual-limit edge-case behavior, which `read`/`shell` outputs depend on.
    - Chosen Approach:
      - Hand-port pi's `truncate.js` to TS as `src/truncate.ts`. Verified `GREP_MAX_LINE_LENGTH` is referenced only by pi's `grep` tool (out of scope) and not by `output-accumulator` (which imports only the `TruncationResult` type), so the constant is omitted; `truncateLine` keeps a 500-char default via an internal `DEFAULT_LINE_CHAR_LIMIT`. Only deviation from pi's source. Cross-checked all ported functions against pi's `dist/core/tools/truncate.js` over 17 inputs (head/tail/line/byte/UTF-8/trailing-newline) — byte-for-byte identical output.
    - API Notes and Examples:
      ```ts
      export const DEFAULT_MAX_LINES = 2000;
      export const DEFAULT_MAX_BYTES = 50 * 1024;
      export interface TruncationResult { /* fields per pi */ }
      export function truncateHead(content: string, options?: TruncationOptions): TruncationResult;
      export function truncateTail(content: string, options?: TruncationOptions): TruncationResult;
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/truncate.ts`: ported truncation utilities.
    - References:
      - pi `dist/core/tools/truncate.{d.ts,js}`.
  - Test Cases to Write:
    - Under both limits → `truncated:false`, `truncatedBy:null`, exact line/byte counts.
    - Over line limit (head) → keeps first N complete lines; over byte limit (head) → `firstLineExceedsLimit` when line 1 > max.
    - Over line limit (tail) → keeps last N lines; single line > byte limit → `lastLinePartial:true`.
    - `truncateLine` adds `[truncated]` only when exceeded; `formatSize` formats KB.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal helper (not re-exported from package root unless task 9 decides otherwise).
    - Docs pages to create/edit: `none` (internal).
    - `docs/index.md` update: no.
    - Documentation structure reference: N/A.

- [x] 3. Port generic primitives: `edit-diff` (fuzzy match + diff/patch)
  - Acceptance Criteria:
    - Functional: Exports `fuzzyFindText`, `applyEditsToNormalizedContent`, `applyReplacementsPreservingUnchangedLines`, `normalizeForFuzzyMatch`, `detectLineEnding`/`normalizeToLF`/`restoreLineEndings`, `stripBom`, `generateUnifiedPatch`, `generateDiffString` (+ `computeEditsDiff` convenience). Exact match is tried before fuzzy; fuzzy normalizes trailing whitespace, smart quotes, unicode dashes/spaces. Multiple edits apply against the same original with stable offsets. `generateDiffString` returns `{ diff, firstChangedLine }`.
    - Performance: Linear-ish in content size for matching; patch generation bounded by content size.
    - Code Quality: Direct TS port of pi `dist/core/tools/edit-diff.js`; no TUI imports.
    - Security: Reads files only via injected `fs` calls inside `computeEditsDiff` (cwd-relative path resolution through `path-utils`); never executes.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/edit-diff.d.ts` (full export list + doc comments) and `edit-diff.js` import graph (imports `diff` + `fs` + `./path-utils`).
    - Options Considered:
      - Add `diff` (jsdiff) as a runtime dependency to match pi's `generateUnifiedPatch`/`generateDiffString` exactly (chosen). `diff` is ~pure-JS, tiny, battle-tested, and the unified-patch/diff-string output is part of the drop-in behavior.
      - Roll a minimal unified-diff generator to avoid the dep. Rejected: correct hunk emission + context lines is more than "a few lines"; risk of diverging from pi output not worth the saved dependency.
    - Chosen Approach:
      - Port `edit-diff.ts` faithfully. Add `"diff": "^8.0.4"` to `packages/coding-agent/package.json` `dependencies` — **no `@types/diff` needed** (diff v7+ ships its own types, including `FILE_HEADERS_ONLY` / `headerOptions` / `createTwoFilesPatch`). The diff/patch string is returned as tool `metadata` (display-only), never used to gate edits.
      - **Prerequisite pulled forward:** `edit-diff` hard-depends on `resolveToCwd` from `path-utils` (task 4), so `path-utils.ts` was ported here (faithful port incl. inlined `normalizePath`/`resolvePath` homedir logic and macOS screenshot/NFD/curly-quote read-path fallbacks). Task 4 is reduced to `output-accumulator` + `file-mutation-queue`.
      - **Faithfulness cross-check:** ran `applyEditsToNormalizedContent`, `fuzzyFindText`, `generateUnifiedPatch`, and `generateDiffString` against pi's `dist/core/tools/edit-diff.js` over 14 inputs (exact/fuzzy/overlap/duplicate/no-change/not-found/patch/diff-string) — identical output and identical thrown error messages.
    - API Notes and Examples:
      ```ts
      import * as Diff from "diff";
      export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, contextLines = 4): string {
        return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
          context: contextLines,
          headerOptions: Diff.FILE_HEADERS_ONLY, // omit Index:/=== underline, keep ---/+++ file headers
        });
      }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/edit-diff.ts`: ported diff/match utilities.
      - `packages/coding-agent/package.json`: add `"diff"` to `dependencies`, `"@types/diff"` to `devDependencies`.
    - References:
      - pi `dist/core/tools/edit-diff.{d.ts,js}`; npm `diff` package `createPatch`/`diffLines`.
  - Test Cases to Write:
    - Exact-match single edit applies; offsets stable for multiple edits.
    - Whitespace-only-differing `oldText` matches via fuzzy normalization; unchanged line blocks keep original bytes.
    - No match → `applyEditsToNormalizedContent` throws a clear error naming `path`.
    - BOM stripped then restored; CRLF detected/preserved.
    - `generateUnifiedPatch` output starts with `---`/`+++` headers; `generateDiffString` returns a finite `firstChangedLine`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal helper.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: N/A.

- [x] 4. Port generic primitives: `output-accumulator`, `file-mutation-queue`
  - Acceptance Criteria:
    - Functional: `OutputAccumulator` (streaming UTF-8 decode, bounded tail, temp-file spillover when full output exceeds limits, `append`/`finish`/`snapshot({persistIfTruncated})`/`closeTempFile`/`getLastLineBytes`). `withFileMutationQueue(filePath, fn)` serializes per-file, parallel across files. (`path-utils` was pulled forward into task 3.)
    - Performance: Accumulator keeps a bounded rolling tail in memory regardless of total output size; total output goes to a temp file only when needed.
    - Code Quality: stdlib-only (`node:crypto`, `node:fs`, `node:os`, `node:path`); faithful TS port of pi modules minus pi-internal imports.
    - Security: Temp files created under `os.tmpdir()` with randomized names; per-file queue prevents read-modify-write races on the same path.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/output-accumulator.d.ts`, `file-mutation-queue.d.ts`, and their `.js` import graphs. (pi `path-utils` already ported in task 3.)
    - Options Considered:
      - Port accumulator verbatim (chosen) vs. a simpler "collect all then truncate". Verbatim is required for `shell` to bound memory on long-running commands while still surfacing the tail + a full-output file, matching pi behavior.
      - Use a global Map mutex in `file-mutation-queue` (chosen, matches pi) vs. per-cwd maps. Global-by-path is the lazy correct choice; note ceiling in a `ponytail:` comment.
    - Chosen Approach:
      - Port the two modules to `src/output-accumulator.ts`, `src/file-mutation-queue.ts`. Keep `OutputAccumulatorOptions`/`OutputSnapshot` types. Single deviation: `OutputAccumulator` default `tempFilePrefix` is `"prism-output"` (pi uses `"pi-output"`) — cosmetic, overridable via options. Added a `ponytail:` comment on the global-mutex Map ceiling in `file-mutation-queue`.
      - **Faithfulness cross-check:** fed identical byte sequences (small/line-truncated/byte-truncated/rolling-trim/UTF-8-split, with and without `persistIfTruncated`) to both pi's `OutputAccumulator` and ours — identical `content` + `truncation` (excluding the nondeterministic `fullOutputPath`). `file-mutation-queue` validated behaviorally (serialize-same-path, parallel-different-path, realpath-fallback for missing paths, throw-releases-slot, 3-op chain order) since its correctness is concurrency/timing rather than byte output.
    - API Notes and Examples:
      ```ts
      // ponytail: global per-path mutex Map; per-cwd maps only if cross-cwd contention shows up
      export function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T>;
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/output-accumulator.ts`.
      - `packages/coding-agent/src/file-mutation-queue.ts`.
    - References:
      - pi `dist/core/tools/{output-accumulator,file-mutation-queue}.{d.ts,js}`.
  - Test Cases to Write:
    - Accumulator: many small chunks decode correctly across UTF-8 boundaries; over-limit output → `snapshot({persistIfTruncated:true}).fullOutputPath` is a readable file with full content and tail `content` is bounded.
    - Mutation queue: two concurrent writes to same file serialize (no interleaved corruption); writes to different files run in parallel (timing).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal helpers.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: N/A.

- [x] 5. Implement the `shell` tool (pi `bash` port)
  - Acceptance Criteria:
    - Functional: `createShellTool(cwd, options?)` returns a Prism `ToolDefinition` named `"shell"` with JSON-Schema `parameters` `{ command: string, timeout?: number }`. Execution spawns the command via stdlib `child_process` in `cwd`, streams stdout+stderr, applies `timeout` (seconds), honors `context.signal`, returns a `ToolResult` whose `content` is a single `TextContent` with the accumulated tail output (and exit-code line), and whose `metadata` carries truncation info + `fullOutputPath` when output exceeded limits. Non-zero exit does not throw; the result text includes the exit code. Missing/empty `command` returns a redaction-safe error result.
    - Performance: Memory bounded by `OutputAccumulator` regardless of command output volume; process killed promptly on timeout/abort.
    - Code Quality: No `@earendil-works/pi-*`, no typebox, no TUI imports; pure stdlib + package primitives. Pluggable `BashOperations` + `spawnHook` seams preserved (so hosts can delegate to remote shells), mirroring pi.
    - Security: Command runs in the host shell — the tool is explicitly a host shell executor (host owns trust/permission via Prism `PermissionPolicy`/`ToolValidator`); no command allowlist is invented (matches pi). Timeout/abort always terminate the child process tree.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/bash.{d.ts,js}` (schema, `BashOperations`, `createLocalBashOperations`, `BashSpawnHook`, `BashToolOptions`, timeout/abort handling, output accumulation + temp-file path).
      - Prism `ToolDefinition`/`ToolExecutionContext`/`ToolResult` (`src/contracts.ts:359-389`); `context.signal` and `context.toolCallId` usage.
      - Node `child_process` `spawn` + shell selection (`process.env.SHELL` / platform default).
    - Options Considered:
      - Copy pi-internal `utils/child-process.js`/`utils/shell.js` into the package vs. re-port spawn logic directly over stdlib. Re-port chosen: pi's utils pull TUI/setting dependencies and are not part of the published tool surface; a focused stdlib spawn keeps the package self-contained.
      - Name the tool `"bash"` (pi) vs. `"shell"` (requested). Use `"shell"` per the task brief; note the rename in docs so pi users know the mapping.
    - Chosen Approach:
      - Implemented `src/shell.ts` exporting `createShellTool(cwd, options?)` + `createLocalBashOperations(options?)`, plus the re-ported stdlib spawn internals `getShellConfig`/`killProcessTree`/`waitForChildProcess` (all exported for hosts building custom `BashOperations`). Shell resolution: `shellPath → process.env.SHELL → /bin/bash → sh`. Combined stdout+stderr stream into `OutputAccumulator`; on finish `snapshot({ persistIfTruncated: true })` + `closeTempFile()`. Maps to `ToolResult { toolCallId, name: "shell", content: [TextContent], metadata: { exitCode, truncation, fullOutputPath } }`.
      - **`timeout` is in SECONDS** (corrected from the plan's earlier "ms" wording — matches pi and avoids a 30ms-instant-timeout footgun).
      - **Error semantics (deviation from pi):** non-zero exit is **not** a tool error (success result with `exitCode` in `metadata` + a `[Command exited with code N]` footer in content; pi throws). timeout/abort **are** error results (command did not complete) — `error.message` is a concise status (`Command aborted` / `Command timed out after N seconds`), partial output lives in `content`. Spawn failures (missing cwd, shell ENOENT) are error results with the host-friendly message.
      - Re-ported spawn/kill/wait directly over stdlib; **dropped** pi-internal `utils/shell.js`+`utils/child-process.js` dependencies, detached-child PID tracking (`killTrackedDetachedChildren` — host owns process lifecycle), the stdin command transport (argv `-c` only), and the pi CLI binDir PATH injection (default env = `process.env`).
      - **Integration verified end-to-end:** registered the tool in prism's `createToolRegistry` and dispatched via `dispatchToolCall` — `echo`, `exit 3`, `echo+exit 9` (output preserved, no error), empty-command (error), and schema check all PASS, confirming true drop-in conformance with the `ToolDefinition` contract.
    - API Notes and Examples:
      ```ts
      export interface ShellToolOptions { operations?: BashOperations; commandPrefix?: string; shellPath?: string; spawnHook?: BashSpawnHook; maxLines?: number; maxBytes?: number; tempFilePrefix?: string; }
      export function createShellTool(cwd: string, options?: ShellToolOptions): ToolDefinition;
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/shell.ts`: shell tool + `BashOperations`/`createLocalBashOperations`/`BashSpawnHook` types.
      - `packages/coding-agent/src/index.ts`: re-export `createShellTool`, `ShellToolOptions`, ops types.
    - References:
      - pi `dist/core/tools/bash.{d.ts,js}`; `src/contracts.ts:359-389`; Node `child_process.spawn`.
  - Test Cases to Write:
    - `echo hello` → text contains `hello`, `metadata.exitCode === 0`.
    - Failing command (`exit 7`) → exit code 7 surfaced, no throw.
    - Long output beyond limits → tail returned, `metadata.fullOutputPath` file contains full output.
    - `timeout` smaller than `sleep` → child killed, result reflects timeout/abort.
    - `context.signal` aborted mid-run → child terminated.
    - Empty `command` → error result (no spawn).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public tool factory + tool behavior.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (task 9) — `shell` section.
    - `docs/index.md` update: yes (task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Implement the `read` tool
  - Acceptance Criteria:
    - Functional: `createReadTool(cwd, options?)` returns `ToolDefinition` named `"read"`, `parameters` `{ path: string, offset?: number, limit?: number }`. Reads the cwd-resolved file, applies `offset`/`limit` (1-indexed line offset, max line count), truncates via `truncateHead` with default 2000 lines / 50KB, returns `TextContent`. Binary/image files return `ImageContent` (`type:"image"`, `mimeType`, base64 `data`) when a MIME is detected from magic bytes; otherwise binary content is summarized, not dumped. Missing/unreadable path → error result. Pluggable `ReadOperations` seam preserved.
    - Performance: Single read; truncation is O(content); image detection reads only leading magic bytes.
    - Code Quality: stdlib `fs`/`fs/promises`/`path`; no pi-internal imports; faithful port of pi `read.js` logic.
    - Security: Path resolution goes through `resolveToCwd` (no `~` outside homedir expansion); reads are local-fs only; no execution. Host enforces permission/trust via Prism seams.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/read.{d.ts,js}` (`readSchema`, `ReadOperations`, `ReadToolOptions.autoResizeImages`, offset/limit, truncation, image MIME detection + image content).
      - pi `utils/mime.js` — `detectSupportedImageMimeType(buffer)` (L4) magic-byte detection (pure JS). Re-implement a small magic-byte table in-package (PNG/JPEG/GIF/WebP/BMP) instead of importing pi internals.
    - Options Considered:
      - Port pi's `autoResizeImages` (photon/WASM + worker-backed `utils/image-process.js`, per task-0 inventory) vs. defer. Defer auto-resize: it pulls a Rust/WASM photon module + a `node:worker_threads` worker for a display-quality concern hosts can own. Note as compromise; expose `ReadOperations.detectImageMimeType` so hosts can override/extend, and leave an `autoResizeImages` option as a no-op placeholder documented as not-yet-implemented (YAGNI until a host asks).
    - Chosen Approach:
      - Implemented `src/read.ts` exporting `createReadTool(cwd, options?)` plus the in-package magic-byte MIME detector `detectSupportedImageMimeType`/`detectSupportedImageMimeTypeFromFile` (faithful port of pi `utils/mime.js` — pure JS, no deps; PNG/JPEG/GIF/WebP/BMP signatures incl. PNG IHDR/APNG-exclusion and BMP DIB-header validation). `ReadOperations` seam preserved (`readFile`/`access`/`detectImageMimeType`) so hosts can delegate to remote FS. Text path ports pi's offset/limit → `truncateHead` → continuation-notice logic verbatim; images return `[{type:"text", note}, {type:"image", data: base64, mimeType}]` mapped to Prism `ContentBlock`.
      - **`autoResizeImages` is a documented no-op** (deferred): the tool returns raw image bytes as base64 `ImageContent` instead of pi's photon/WASM + `worker_threads` resize. Option accepted but ignored, with a `ponytail:` ceiling comment (port image processing when a host needs context-size capping). `metadata.image.resized` is always `false` so hosts can detect the gap.
      - Abort + all read failures (ENOENT, offset-OOB) return a Prism `error` result (pi throws/rejects); `metadata.truncation` carried on successful text reads.
      - Truncation fallback message says "Use the shell tool" (pi: "Use bash") since the package's shell tool is named `shell`.
      - **Faithfulness cross-check:** ran our text path against pi's actual `createReadToolDefinition(...).execute` over 7 cases (small / multiline / 300-line head-truncation / trailing-newline-preserved / offset / offset+limit / limit-with-continuation) — **byte-identical output 7/7**, confirming the offset/limit/truncateHead/continuation logic is a true behavioral port.
      - **Integration verified end-to-end:** registered `read` in prism's `createToolRegistry` + dispatched via `dispatchToolCall` — text read, image read (2 blocks), missing-file (ENOENT error), and JSON-Schema check all PASS.
      - Dropped pi TUI (`renderCall`/`renderResult`, theme/syntax-highlight, compact SKILL/docs/CLAUDE classifications, key hints) and the model-aware non-vision note (Prism's `ToolExecutionContext` has no `model` field).
    - API Notes and Examples:
      ```ts
      export interface ReadToolOptions { autoResizeImages?: boolean; operations?: ReadOperations; maxLines?: number; maxBytes?: number; }
      export function createReadTool(cwd: string, options?: ReadToolOptions): ToolDefinition;
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/read.ts`: read tool + `ReadOperations` + in-package magic-byte detector.
      - `packages/coding-agent/src/index.ts`: re-export `createReadTool`, `ReadToolOptions`, ops types.
    - References:
      - pi `dist/core/tools/read.{d.ts,js}`; Prism `ContentBlock`/`ImageContent` (`src/contracts.ts:22-40`).
  - Test Cases to Write:
    - Text file read returns full small content as `TextContent`.
    - `offset`/`limit` slice correctly (1-indexed).
    - Large file → head truncation; `metadata.truncation.truncated === true`.
    - PNG and JPEG → `ImageContent` with correct `mimeType` and base64 `data`.
    - Non-image binary → summarized text, not raw bytes.
    - Missing path → error result, no throw.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public tool factory + behavior.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (task 9) — `read` section.
    - `docs/index.md` update: yes (task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. Implement the `write` tool
  - Acceptance Criteria:
    - Functional: `createWriteTool(cwd, options?)` returns `ToolDefinition` named `"write"`, `parameters` `{ path: string, content: string }`. Creates parent directories recursively, writes content (creating or overwriting), serialized through `withFileMutationQueue`. Returns a `ToolResult` with a short `TextContent` confirmation including the absolute path and byte/line counts. Pluggable `WriteOperations` seam preserved. Path resolution via `resolveToCwd`.
    - Performance: O(content) write; per-file queue prevents same-file races without blocking other files.
    - Code Quality: stdlib `fs/promises`/`path`; no pi-internal imports; faithful port of pi `write.js`.
    - Security: Writes are local-fs only; parent dir creation bounded to the resolved path; no shell. Host enforces trust via Prism seams.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/write.{d.ts,js}` (`writeSchema`, `WriteOperations` `{ writeFile, mkdir }`, `WriteToolOptions`, mutation queue usage).
    - Options Considered:
      - Faithful port (chosen) vs. adding overwrite-protection. pi overwrites by design (it is a create-or-replace tool); do not invent a guard the host should own. Document that overwrite is intentional.
    - Chosen Approach:
      - Implemented `src/write.ts` exporting `createWriteTool(cwd, options?)` + `WriteToolOptions`/`WriteOperations`. Flow: `resolveToCwd(path, cwd)` (sync — write has no need for the read path's macOS-screenshot fallback) → `dirname` → `withFileMutationQueue(absolutePath, …)` → `ops.mkdir(dir)` (`{recursive:true}`) → `ops.writeFile(absolutePath, content, "utf-8")`. `WriteOperations` seam (`writeFile`/`mkdir`) preserved so hosts can delegate to remote FS.
      - **Confirmation carries the absolute path + UTF-8 byte count + line count** (deviation from pi, which returns the caller's path and `content.length` — a UTF-16 code-unit count mislabeled "bytes"). Per the plan's acceptance criteria; strictly more informative and now UTF-8-correct. Result: `Successfully wrote {bytes} bytes ({lines} lines) to {absolutePath}` + `metadata: { bytes, lines, path }`.
      - Abort + all fs failures (ENOENT, EACCES, …) return a Prism `error` result (pi throws/rejects). Abort is checked before each fs op (mkdir, writeFile); if the write completes it is reported success — pi throws "Operation aborted" even after a successful write, which is misleading, so that post-write check was dropped.
      - Empty `content` is valid (creates an empty file, reports `0 bytes / 0 lines`); non-string `content` and empty `path` are error results.
      - **Faithfulness cross-check:** ran our tool vs pi's `createWriteToolDefinition(...).execute` over 5 cases (nested dirs / top-level / unicode ☃ / empty file / deep path) — **on-disk files byte-identical 5/5**, parent dirs created identically.
      - **Integration verified end-to-end:** registered `write` in prism's `createToolRegistry` + dispatched via `dispatchToolCall` — nested-dir write (file exists, content correct), bad-content (error), and JSON-Schema (`required: [path, content]`) all PASS.
      - Dropped pi TUI (`renderCall`/`renderResult`, incremental syntax-highlight cache, key hints).
    - API Notes and Examples:
      ```ts
      export interface WriteToolOptions { operations?: WriteOperations; }
      export function createWriteTool(cwd: string, options?: WriteToolOptions): ToolDefinition;
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/write.ts`: write tool + `WriteOperations`.
      - `packages/coding-agent/src/index.ts`: re-export `createWriteTool`, `WriteToolOptions`, ops types.
    - References:
      - pi `dist/core/tools/write.{d.ts,js}`.
  - Test Cases to Write:
    - Write new file with nested missing dirs → file created, confirmation text names absolute path.
    - Overwrite existing file → content replaced, byte count correct.
    - Concurrent writes to the same file via two queued calls → serialized (final content is one of the two, not corruption).
    - `WriteOperations` override → host operations invoked instead of fs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public tool factory + behavior.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (task 9) — `write` section.
    - `docs/index.md` update: yes (task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 8. Implement the `edit` tool + package barrel (`createCodingTools`, `createReadOnlyTools`)
  - Acceptance Criteria:
    - Functional: `createEditTool(cwd, options?)` returns `ToolDefinition` named `"edit"`, `parameters` `{ path: string, edits: Array<{ oldText: string, newText: string }> }`. Reads the file, applies all edits via `edit-diff` (exact then fuzzy), writes back through `withFileMutationQueue`, returns `ToolResult` with `TextContent` confirmation plus `metadata.diff`/`metadata.patch`/`metadata.firstChangedLine`. No-match → error result naming the path and the failing edit index; file unchanged. Pluggable `EditOperations` seam preserved. Barrel also exports `createCodingTools(cwd, options?)` → `readonly ToolDefinition[]` (`shell`,`read`,`write`,`edit`), `createReadOnlyTools(cwd, options?)` (`read` only), `createAllTools`, and the individual factories.
    - Performance: O(content × edits) for matching; single read + single write per call.
    - Code Quality: Faithful port of pi `edit.js` minus TUI; no pi-internal imports; barrel re-exports are stable and tree-shakeable.
    - Security: Local-fs only; no execution; mutations serialized per path.
  - Approach:
    - Documentation Reviewed:
      - pi `dist/core/tools/edit.{d.ts,js}` (`editSchema`, `EditOperations`, `EditToolDetails`, mutation queue, `edit-diff` usage) and `dist/core/tools/index.{d.ts,js}` (`createCodingTools`/`createReadOnlyTools`/`createAllTools` aggregators).
    - Options Considered:
      - Keep `diff`/`patch` in `metadata` only (chosen) vs. also in `content`. pi returns them as tool `details` for the TUI; Prism has no `details` field, so surface as `ToolResult.metadata` (host-readable, not shown to the model unless the host chooses) — keeps model context small.
    - Chosen Approach:
      - Implemented `src/edit.ts` exporting `createEditTool(cwd, options?)` + `EditToolOptions`/`EditOperations`/`EditToolDetails`/`Edit`. Flow: `resolveToCwd` → `withFileMutationQueue` → `ops.access(R_OK|W_OK)` → `ops.readFile` → `stripBom` → `detectLineEnding` → `normalizeToLF` → `applyEditsToNormalizedContent` (exact-then-fuzzy, with duplicate/overlap/empty-oldText/no-change guards) → `restoreLineEndings` + re-prepend BOM → `ops.writeFile` → `generateDiffString` + `generateUnifiedPatch`. `EditOperations` seam (`readFile`/`writeFile`/`access`) preserved.
      - Ported pi's `prepareEditArguments` (model-quirk tolerance: `edits` sent as a JSON string is parsed; legacy top-level `oldText`/`newText` is folded into `edits[]`). Adapted to not mutate the readonly `JsonObject` input (TS forbids it) — builds a new edits value instead.
      - pi's TUI-facing `details: { diff, patch, firstChangedLine }` is surfaced as `ToolResult.metadata` (host-readable; keeps model context small — model sees only `Successfully replaced N block(s) in {path}.`).
      - Abort + every failure (missing/unreadable file, no-match, duplicate, overlap, empty oldText, no-change) return a Prism `error` result (pi throws/rejects). No-match leaves the file untouched because `applyEditsToNormalizedContent` throws before `writeFile`. Post-`writeFile` abort check dropped (consistent with write tool — a completed write is real success, not a misleading "aborted").
      - Patch/diff use the original caller `path` (faithful to pi → byte-identical patch headers).
      - **Faithfulness cross-check:** ran our tool vs pi's `createEditToolDefinition(...).execute` over 4 cases (single / multi-edit / CRLF / code-block) — **on-disk file + unified patch + diff all byte-identical 4/4**.
      - **Barrel finalized:** `createCodingTools(cwd, options?)` → `[shell, read, write, edit]`; `createReadOnlyTools` → `[read]` (package ships no grep/find/ls); `createAllTools` → alias of `createCodingTools`; `ToolsOptions` combines per-tool option types. Re-exports all individual factories + ops interfaces + `withFileMutationQueue` for hosts.
      - **Integration verified end-to-end:** `createToolRegistry(createCodingTools(tmp))` then `dispatchToolCall` of `shell`/`read`/`write`/`edit` all PASS; edit no-match → error result. **116/116** package tests pass (15 truncate + 18 edit-diff + 5 path-utils + 9 output-accumulator + 5 file-mutation-queue + 12 shell + 20 read + 12 write + 15 edit + 5 aggregators).
      - Dropped pi TUI (`renderCall`/`renderResult`, live preview cache, theme/syntax-highlight, `renderShell`/`promptSnippet`/`promptGuidelines`).
    - API Notes and Examples:
      ```ts
      export interface EditToolOptions { operations?: EditOperations; }
      export function createEditTool(cwd: string, options?: EditToolOptions): ToolDefinition;
      export interface ToolsOptions { shell?: ShellToolOptions; read?: ReadToolOptions; write?: WriteToolOptions; edit?: EditToolOptions; }
      export function createCodingTools(cwd: string, options?: ToolsOptions): readonly ToolDefinition[];
      ```
      ```ts
      // Drop-in for any Prism app:
      import { createToolRegistry } from "@arnilo/prism";
      import { createCodingTools } from "@arnilo/prism-coding-agent";
      const tools = createToolRegistry(createCodingTools(process.cwd()));
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/edit.ts`: edit tool + `EditOperations`.
      - `packages/coding-agent/src/index.ts`: finalize barrel (factories + aggregators + option types + ops interfaces).
    - References:
      - pi `dist/core/tools/edit.{d.ts,js}`; pi `dist/core/tools/index.{d.ts,js}`.
  - Test Cases to Write:
    - Single exact edit → content updated, `metadata.patch` is a unified diff, `metadata.firstChangedLine` correct.
    - Multiple edits in one call apply against original with stable offsets.
    - Fuzzy match (trailing whitespace / smart quotes) succeeds.
    - No-match edit → error result, file byte-identical to before.
    - `createCodingTools` returns exactly `[shell, read, write, edit]` with unique names; `createReadOnlyTools` returns `[read]`.
    - End-to-end: register via `createToolRegistry(createCodingTools(tmp))` and dispatch `shell`/`read`/`write`/`edit` through `dispatchToolCall` → success results.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public factories + aggregators.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (task 9) — `edit` section + aggregators.
    - `docs/index.md` update: yes (task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 9. Documentation: `docs/coding-agent-tools.md` API page + `docs/index.md` nav + package README
  - Acceptance Criteria:
    - Functional: `docs/coding-agent-tools.md` follows the Prism API-page structure (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs) covering the package plus per-tool sections for `shell`,`read`,`write`,`edit` and the aggregators. `docs/index.md` adds a Tools-group entry linking to it. `packages/coding-agent/README.md` gives install + minimal usage.
    - Performance: N/A.
    - Code Quality: Examples compile against the shipped types (verified by `tsc -p examples --noEmit` if an example is added, or by inline type accuracy).
    - Security: Docs explicitly state these tools perform host shell/filesystem access and that hosts must gate them via Prism `PermissionPolicy`/`ToolValidator`/trust; no sandbox is provided.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (API-page structure + index grouping).
      - `docs/tools.md` (host-owned tool harness, "Prism does not sandbox host tools"), `docs/tool-conformance.md`, `docs/index.md` (current Tools group).
    - Options Considered:
      - One page for the package with per-tool sections (chosen) vs. a page per tool. Package is small and cohesive; one page matches `docs/tool-conformance.md` style and keeps the index lean.
    - Chosen Approach:
      - Created `docs/coding-agent-tools.md` as a single API page following the Prism wiki structure (What it does / When to use it / per-tool inputs+outputs tables / Request/response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs). Documents the package-level exports plus `shell`, `read`, `write`, `edit`, the `createCodingTools`/`createReadOnlyTools`/`createAllTools` aggregators, and the pi-name mapping (`shell` ↔ pi `bash`).
      - Added a Tools-group entry in `docs/index.md` linking to the new page with a short functional description and explicit trust/permission warning.
      - Added a one-line "Related APIs" link in `docs/tools.md` pointing back to the new page.
      - Expanded `packages/coding-agent/README.md` from the task-1 stub with install, `createCodingTools`/`createReadOnlyTools` usage, individual-tool options example, per-tool input/result table, pi mapping, full export list, and a security warning. Docs links in the README use absolute GitHub URLs so they resolve on npm/Github (`https://github.com/ashiqrniloy/prism/blob/main/docs/...`).
      - Verified all internal `docs/*.md` links from the new page resolve (`tools.md`, `public-contracts.md`, `host-security.md`, `settings-auth-trust-security.md`, `tool-conformance.md`).
      - Verified pack dry-run still includes `README.md`, no `__tests__`/`.map` files, and build/typecheck/tests remain green (116/116 pass).
    - API Notes and Examples:
      ```md
      # Coding agent tools (first-party package)
      ## What it does
      `@arnilo/prism-coding-agent` provides optional shell/read/write/edit tools …
      ## Implementation example
      ```ts
      import { createAgent, createToolRegistry } from "@arnilo/prism";
      import { createCodingTools } from "@arnilo/prism-coding-agent";
      const agent = createAgent({ model, provider, tools: createToolRegistry(createCodingTools(cwd)) });
      ```
      ```
    - Files to Create/Edit:
      - `docs/coding-agent-tools.md`: new API page.
      - `docs/index.md`: add Tools-group nav entry.
      - `packages/coding-agent/README.md`: expand from task-1 stub (install, usage, trust note, pi-name mapping).
      - `docs/tools.md`: add a "Related APIs" link to the new page (one line).
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`; `docs/tools.md`; `docs/index.md`.
  - Test Cases to Write:
    - Docs review: page contains all required sections; `docs/index.md` entry link target resolves; README snippet imports match the task-8 barrel.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — public docs for the new package.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` (create), `docs/index.md` (edit), `packages/coding-agent/README.md` (create/expand), `docs/tools.md` (one related-link line).
    - `docs/index.md` update: yes — Tools group entry "Coding agent tools — optional shell/read/write/edit tools (`@arnilo/prism-coding-agent`)".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 10. Workspace validation: build, typecheck, test, pack
  - Acceptance Criteria:
    - Functional: From the repo root, `npm run build`, `npm run typecheck`, and `npm test` all pass, including the new workspace's `node --test` suite. `npm run pack:dry-run` includes `@arnilo/prism-coding-agent` and its tarball contains `dist` (no `__tests__`, no `.map`), `README.md`, `LICENSE`.
    - Performance: Full workspace build/test time within reason of the pre-change baseline (no new native build).
    - Code Quality: `npm run sdk:ready` (typecheck + test + pack:dry-run) is green.
    - Security: Published tarball contains no test files, source maps, or stray dev files.
  - Approach:
    - Documentation Reviewed:
      - Root `package.json` scripts (`build`, `typecheck`, `test`, `pack:dry-run`, `sdk:ready`) and the `--workspaces --if-present` chaining.
    - Options Considered:
      - Rely on root `npm test` workspaces chaining (chosen) vs. add CI-specific scripts. Root chaining already covers workspaces; no new scripts needed.
    - Chosen Approach:
      - Ran the full root release-readiness chain:
        - `npm run build` — core + all workspaces green; `@arnilo/prism-coding-agent` builds `dist/*.js`/`dist/*.d.ts` for barrel + all 9 source modules.
        - `npm run typecheck` — core + all workspaces + `examples/` green.
        - `npm run test` — core tests + workspace tests green; new package's `dist/__tests__/*.test.js` suite runs and reports `116/116` pass.
        - `npm run pack:dry-run` — root + all workspaces green; `@arnilo/prism-coding-agent` tarball contains 23 files (`LICENSE`, `README.md`, `dist/` JS + d.ts for every module). No `__tests__` directories, no `.map` files, no stray dev files.
        - `npm run sdk:ready` — exit code `0`.
      - No new CI scripts or build steps were added; the existing root `package.json` `--workspaces --if-present` chaining already covers the new package.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm pack --dry-run --workspace @arnilo/prism-coding-agent
      ```
    - Files to Create/Edit:
      - None (validation only). Fix any failures discovered, updating the responsible task.
    - References:
      - Root `package.json` scripts; sibling package `pack:dry-run` behavior.
  - Test Cases to Write:
    - `npm run sdk:ready` exits 0.
    - New package's tests appear in the root `npm test` output.
    - Pack file list for the new package excludes `__tests__`/`.map`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — validation only.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: N/A.

## Compromises Made
- To be filled after tasks are completed and tests pass. Known going in:
  - `autoResizeImages` for the `read` tool is deferred (pi uses a photon/WASM + worker-backed helper); the package detects image MIME via in-package magic bytes and returns raw base64. `autoResizeImages` option kept as a documented no-op placeholder.
  - The bash-equivalent tool is named `"shell"` (per request), not `"bash"` (pi). Documented mapping in the API page.
  - Pi TUI render metadata (`details`, render states, `Box` components) is dropped; diff/patch/truncation are surfaced via Prism `ToolResult.metadata` instead.
  - `diff` (jsdiff) added as the one runtime dependency for unified-patch/diff-string fidelity with pi.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority. Candidate items:
  - Decide whether `prism-all` umbrella should depend on `@arnilo/prism-coding-agent` (deferred; coding tools are trust-bearing and opt-in).
  - Add `grep`/`find`/`ls` tools (present in pi) if a host requests them — currently out of scope (only shell/read/write/edit requested).
  - Implement `autoResizeImages` (sharp) when a host needs display-size image downsizing.
  - Provide a manifest-based contribution (`manifest.json`) so `discoverContributions()` can register the package's tools without code — only if hosts want discovery over explicit import.
