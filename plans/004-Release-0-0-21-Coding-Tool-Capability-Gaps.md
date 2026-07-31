# Release 0.0.21 — Coding-tool capability gaps for least-error agent operation

Roadmap phase: Phase 4 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.20** (Phase 3 exit gate passed 2026-07-31).
Target: `@arnilo/prism` **0.0.21** (and matching `@arnilo/prism-coding-agent` / `@arnilo/prism-coding-security` peers).

Scope freeze (user choice 2026-07-31): **roadmap Phase 4 capabilities + full coding-tool docs/examples/schema audit**. No PDF/Office readers, PTY/process sessions, LSP, trash daemon, forge/egress, or new packages. Those stay Phase 9 / demand-gated non-goals.

## Objectives

- Close confirmed coding-tool capability gaps that raise agent error rates: `repo_search` output modes, bounded `glob`, optional read-before-write, bounded `delete`/`move`.
- Keep each addition optional at the host boundary, `ExecutionPolicy`-gated, and within existing coding-agent scan/mutation ceilings — extend `RepositoryOperations` / factories, do not add packages or background indexers.
- Bring model-facing schemas, descriptions, `/docs`, package README, and packed examples for **all** coding tools (`shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move`, Git/check, ask-user, plan/checkpoint helpers) to an industry-standard agentic-coding bar (clear when-to-use, fail-closed errors, pagination/continuation hints, non-goals loud).
- Document fuzzy-edit silent-success tradeoff and Phase 4 non-goals explicitly; wire coding-security approval/sandbox aggregators for new mutating kinds.

## Expected Outcome

- Models can choose `repo_search` `outputMode: "content" | "files_with_matches" | "count"`; files-only and count modes omit match body text from model content while sharing path/policy/limit fail-closed behavior.
- Bounded `glob` finds workspace paths by pattern with depth/entry/result/time caps, exclude list, symlink fail-closed, and pagination — no shell `find` for common cases.
- Hosts can set `requireReadBeforeWrite: true`; unread paths are rejected on `write`/`edit` with a clear model-visible error unless a force override is used; read-path state is session-owned and not forgeable from model claims alone.
- Bounded `delete` and `move` tools enforce `ExecutionPolicy`, workspace containment, abort, exclusive mutation queue, and confirmation metadata; symlink escapes refused; no trash daemon (host undo responsibility documented).
- `createCodingTools` / `createReadOnlyTools` / sandbox aggregators expose the agreed membership; Git/ask remain opt-in.
- Docs, migration, README/CHANGELOG, packed example, and release metadata agree on **0.0.21**; `npm run sdk:ready` and coding-agent adversarial suites pass.
- Audit matrix records every tool’s docs/schema/example gaps closed in this release; deferred feature gaps point at Phase 9 / roadmap non-goals only.

## Tasks

- [x] Task 0 — Primitive review and freeze public API deltas for Phase 4 (completed 2026-07-31)
  - Acceptance Criteria:
    - Functional: inventory states whether existing `RepositoryOperations`, list/search walkers, `path-utils`, `withFileMutationQueue`, `atomicWriteUtf8File`, `ExecutionPolicy`/`ExecutionAction`, read/write/edit factories, and coding-security approval cover Phase 4 without a new package or contribution kind.
    - Functional: written freeze lists exact public deltas: `outputMode` name/defaults; `createGlobTool` schema/limits/matcher policy; `ReadPathSet` (or freeze-named equivalent) + `requireReadBeforeWrite` / force flag; `createDeleteTool` / `createMoveTool` schemas, risks, aggregator membership; ExecutionAction `kind` strings; coding-security `isMutatingKind` updates.
    - Performance: freeze requires glob/search within existing repository scan ceilings; delete/move O(1) fs ops + path checks only; no indexers/watchers.
    - Code Quality: review cites file:line evidence; rejects shell-as-API for glob/delete/move, trash subsystem, hard-always read-before-write, new npm glob dependency when a safe subset + existing walker suffices, and regex search revival.
    - Security: patterns cannot escape workspace; delete/move never follow symlinks out of root; read-before-write state session-owned; high-risk mutations stay policy-gated.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 4 + “Coding tool capability gaps” + Cross-Phase “Coding tools” / Non-goals (PDF).
      - `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`.
      - Code: `packages/coding-agent/src/{repository,search,list,read,write,edit,edit-diff,path-utils,file-mutation-queue,atomic-write,index,execution-policy}.ts`; `packages/coding-security/src/{approval,sandbox-coding-operations,sandbox-fs-operations}.ts`; `src/execution-policy.ts`, `src/skill-disclosure.ts` (LoadedSkillSet precedent).
      - Behavioral reference only: Cursor Grep/Glob/Delete, Claude Code / pi read-write-edit (not a port).
    - Options Considered:
      - Shell `find`/`rm`/`mv` for agents: reject (error + policy surface).
      - Full trash/versioning: reject (YAGNI).
      - Hard-require read-before-write always: reject (breaking); optional host flag.
      - Add `picomatch`/`minimatch`: **reject** — walker + minimal `*`/`?`/`**` matcher covers Phase 4; zero new deps (`packages/coding-agent/package.json:27-29` has only `diff`).
      - Node `fs.glob` as primary glob backend: **reject** — symlink/exclude/hidden/pagination must match `repo_list`/`repo_search`; reuse `walkRepository` (`repository.ts:315-411`) + post-filter.
      - Regex `repo_search` revival: **reject** — literal-only (`search.ts:113-114`, `repository.ts:631-634`).
      - Native glob + search modes + soft guard + delete/move + docs audit: **chosen**.
    - Chosen Approach:
      - Task 0 is freeze-only; no production code until Tasks 1–4.
      - Package-only (`@arnilo/prism-coding-agent` + security wiring); **no new package**; core `ExecutionAction.kind` already accepts `string` (`src/execution-policy.ts:3-4`).
      - Aggregator freeze (**confirmed**):
        - `createCodingTools`: nine tools — `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move` (`index.ts:347-358` returns six today; Tasks 2+4 extend).
        - `createReadOnlyTools`: four tools — `read`, `repo_list`, `repo_search`, `glob` (`index.ts:365-372` returns three today).
        - `createAllTools`: identical to `createCodingTools` (`index.ts:376-378`).
        - Git / ask-user / check: remain opt-in (`index.ts:342-345`).
      - Read-before-write: host closes shared `createReadPathSet()` into `read` + `write` + `edit`; default off; not checkpoint-persisted (LoadedSkillSet precedent).
    - API Notes and Examples:
      ```ts
      import {
        createCodingTools,
        createGlobTool,
        createDeleteTool,
        createMoveTool,
        createReadPathSet,
        createReadTool,
        createWriteTool,
        createEditTool,
        createRepoSearchTool,
      } from "@arnilo/prism-coding-agent";

      const readPaths = createReadPathSet();
      const tools = createCodingTools(cwd, {
        read: { readPathSet: readPaths },
        write: { requireReadBeforeWrite: true, readPathSet: readPaths },
        edit: { requireReadBeforeWrite: true, readPathSet: readPaths },
      });

      // Or a la carte:
      createRepoSearchTool(cwd); // schema includes outputMode
      createGlobTool(cwd);
      createDeleteTool(cwd);
      createMoveTool(cwd);
      ```
    - Files to Create/Edit:
      - `plans/004-Release-0-0-21-Coding-Tool-Capability-Gaps.md`: freeze table (this task).
      - No production code in Task 0.
    - References:
      - Roadmap Phase 4 files list + API sketch.
      - Phase 3 `LoadedSkillSet` as session-owned set precedent (`src` / plan 003).
  - Primitive inventory (file:line evidence):

    | Primitive | Covers Phase 4 need? | Evidence |
    | --- | --- | --- |
    | `walkRepository` / `resolveRepoPath` | **Yes** — glob walker reuse; symlink fail-closed | `repository.ts:204-241` (`resolveRepoPath`), `:315-411` (`walkRepository`), `:248-256` (`shouldSkipName`) |
    | `RepositoryOperations.list` | **Partial** — pagination/exclude/hidden; no pattern filter | `repository.ts:141-143`, `:413-521` (`listLocal`); `list.ts:49-166` |
    | `RepositoryOperations.search` | **Partial** — literal scan + limits; no `outputMode` on request/serialization | `repository.ts:127-139`, `:630-758` (`searchLocal`); `search.ts:51-58` (`formatSearchText` content-only) |
    | `createRepoListTool` | **Yes** for list; not pattern match | `list.ts:49-166`; policy `kind: "repo_list"` `:113` |
    | `createRepoSearchTool` | **No** — schema lacks `outputMode` (`search.ts:72-101`); metadata always full matches (`search.ts:185`) | `search.ts:60-194` |
    | `withFileMutationQueue` | **Yes** — per-realpath serialize for write/edit/delete/move | `file-mutation-queue.ts:46-72`; used `write.ts:119`, `edit.ts` (mutation path) |
    | `atomicWriteUtf8File` | **Write/edit only** — move may use `rename`; delete uses `unlink`/`rm` | `atomic-write.ts:9-23` |
    | `resolveToCwd` / `resolveReadPath*` | **Yes** — cwd resolve + read fallbacks | `path-utils.ts:69-71`, `:94-119` |
    | `resolveRepoPath` containment | **Yes** — workspace root + realpath escape deny | `repository.ts:192-198`, `:204-241` |
    | `enforceExecutionPolicy` | **Yes** — all tools gate through coding-agent helper | `execution-policy.ts:4-30`; per-tool kinds e.g. `read.ts:447`, `write.ts:106`, `shell.ts:364` |
    | `ExecutionAction.kind` (core) | **Yes** — extensible `string`; no core change required | `src/execution-policy.ts:3-4` |
    | coding-security `isMutatingKind` | **Partial** — shell/write/edit only; missing delete/move | `approval.ts:28-29` |
    | coding-security sandbox FS | **Partial** — read/write/edit/list/search; no delete/move scripts | `sandbox-fs-operations.ts:30-40` (`SANDBOX_FS_SCRIPTS`) |
    | Session read tracking | **Missing** — no `ReadPathSet` today | — |
    | `LoadedSkillSet` precedent | **Pattern** — in-memory host-closed set, not checkpointed | `src/skill-disclosure.ts:28-50`; plan 003 |
    | New npm glob dep | **Not needed** — only `diff` in coding-agent deps | `packages/coding-agent/package.json:27-29` |

    **Verdict:** `@arnilo/prism-coding-agent` + `@arnilo/prism-coding-security` extensions sufficient. **No new package. No new core contribution kind.**

  - Freeze table (public deltas — finalized 2026-07-31):

    | Surface | Before 0.0.20 | After 0.0.21 | Breaking? |
    | --- | --- | --- | --- |
    | `repo_search` `outputMode` | absent; always content lines | optional `outputMode?: "content" \| "files_with_matches" \| "count"`; default `"content"`; invalid value fail-closed | additive |
    | `repo_search` content (`content`) | `path:line:col:text` + context | unchanged | no |
    | `repo_search` files mode | — | unique relative paths, one per line; no match bodies in text or slimmed metadata | additive |
    | `repo_search` count mode | — | text `N matches in M files` (+ truncated suffix when applicable); metadata retains counts, not line bodies | additive |
    | `RepositorySearchRequest` | no `outputMode` | `outputMode?: "content" \| "files_with_matches" \| "count"` | additive |
    | `glob` tool | none | `createGlobTool(cwd, options?)`; tool name `glob`; in `createCodingTools` + `createReadOnlyTools` | additive |
    | `glob` schema | — | `{ pattern, path?, includeHidden?, maxDepth?, maxResults?, offset? }`; `pattern` required; `additionalProperties: false` | additive |
    | `glob` matcher | — | walker + minimal matcher: `*`, `?`, `**` only; `{brace}` rejected with clear error; **no** picomatch/minimatch/**no** primary `fs.glob` | additive |
    | `glob` limits | — | reuse `resolveRepositoryLimits` defaults (`limits.ts:26-49`); same exclude/hidden/symlink/depth/entry/time semantics as `repo_list` | additive |
    | `glob` policy | — | `kind: "glob"`, `operation: "glob"`, `risk: "low"` (not mutating) | additive |
    | `RepositoryOperations.glob` | none | `glob(request): Promise<RepositoryGlobResult>` on interface + `createLocalRepositoryOperations` | additive |
    | `delete` tool | none | `createDeleteTool(cwd, options?)`; tool name `delete`; in `createCodingTools` / `createAllTools` only | additive |
    | `delete` schema | — | `{ path }` only in 0.0.21 — **file** or **empty directory**; non-empty dir fail-closed; **no** `recursive` flag in 0.0.21 | additive |
    | `delete` policy | — | `kind: "delete"`, `operation: "delete"`, `risk: "high"` | additive |
    | `move` tool | none | `createMoveTool(cwd, options?)`; tool name `move`; in `createCodingTools` / `createAllTools` only | additive |
    | `move` schema | — | `{ from, to, overwrite? }`; `overwrite` default `false` → fail if destination exists; `true` replaces destination file | additive |
    | `move` policy | — | `kind: "move"`, `operation: "move"`, `risk: "high"` | additive |
    | `move` queue order | — | lexicographic absolute paths: `withFileMutationQueue(min)` then `withFileMutationQueue(max)` | additive |
    | `ReadPathSet` | none | `createReadPathSet()` → `ReadPathSet` (`has`/`add`/`list`/`clear`); keys = resolved absolute paths after successful read | additive |
    | read-before-write | none | `requireReadBeforeWrite?: boolean` on `WriteToolOptions` + `EditToolOptions` (default `false`); `readPathSet?: ReadPathSet` on `read`/`write`/`edit` | additive |
    | RBW force bypass | none | `force?: boolean` on **write** + **edit** tool parameters (not read); bypasses guard when `true` | additive |
    | RBW error text | — | `Refusing write to <path>: not read in this session. Read first or pass force=true.` (edit: `write` → `edit`) | additive |
    | RBW persistence | — | in-memory only; **not** checkpoint-persisted in 0.0.21 | additive |
    | `ToolsOptions` | six tool option slots | add `glob?`, `delete?`, `move?`; thread `readPathSet` via read/write/edit | additive |
    | Aggregator membership | 6 / 3 tools | **9** / **4** tools (see Chosen Approach) | additive (hosts asserting exact `.length` must update) |
    | `isMutatingKind` | shell, write, edit | add `delete`, `move`; **not** `glob` | behavior (approval) |
    | Sandbox tool lists | six / three names | match new aggregator membership; sandbox FS adds delete/move backends (Task 6) | additive |
    | Fuzzy-edit docs | brief tradeoff note | loud docs + model description + migration (Task 5) | docs |
    | PDF / PTY / LSP / trash | absent | still absent | n/a |

  - Frozen type sketch (implementation names; export from `packages/coding-agent/src/index.ts` in Tasks 1–4):

    ```ts
    export type RepoSearchOutputMode = "content" | "files_with_matches" | "count";

    // repository.ts — extend existing request/result
    export interface RepositorySearchRequest {
      readonly outputMode?: RepoSearchOutputMode;
      // ...existing fields unchanged
    }

    export interface RepositoryGlobRequest {
      readonly root: string;
      readonly pattern: string;
      readonly path?: string;
      readonly includeHidden?: boolean;
      readonly exclude?: readonly string[];
      readonly maxDepth?: number;
      readonly maxResults?: number;
      readonly offset?: number;
      readonly signal?: AbortSignal;
      readonly deadlineMs?: number;
    }

    export interface RepositoryGlobResult {
      readonly paths: readonly string[];
      readonly truncated: boolean;
      readonly truncatedBy: RepositoryListResult["truncatedBy"];
      readonly scannedEntries: number;
      readonly scannedFiles: number;
      readonly offset: number;
      readonly nextOffset?: number;
    }

    export interface RepositoryOperations {
      list(request: RepositoryListRequest): Promise<RepositoryListResult>;
      search(request: RepositorySearchRequest): Promise<RepositorySearchResult>;
      glob(request: RepositoryGlobRequest): Promise<RepositoryGlobResult>;
    }

    export interface ReadPathSet {
      has(path: string): boolean;
      add(path: string): void;
      list(): readonly string[];
      clear(): void;
    }

    export function createReadPathSet(): ReadPathSet;

    export interface GlobToolOptions {
      executionPolicy?: ExecutionPolicy;
      operations?: RepositoryOperations;
      repository?: RepositoryLimitOptions;
      maxDepth?: number;
      maxResults?: number;
      exclude?: readonly string[];
    }

    export interface DeleteToolOptions {
      executionPolicy?: ExecutionPolicy;
      operations?: DeleteOperations;
    }

    export interface MoveToolOptions {
      executionPolicy?: ExecutionPolicy;
      operations?: MoveOperations;
    }

    export interface WriteToolOptions {
      requireReadBeforeWrite?: boolean;
      readPathSet?: ReadPathSet;
      // ...existing fields
    }

    export interface EditToolOptions {
      requireReadBeforeWrite?: boolean;
      readPathSet?: ReadPathSet;
      // ...existing fields
    }

    export interface ReadToolOptions {
      readPathSet?: ReadPathSet;
      // ...existing fields
    }

    // write/edit parameters gain optional force?: boolean
  ```

  - Validation matrix — Phase 4 roadmap AC → task ownership:

    | Roadmap AC | Task |
    | --- | --- |
    | `repo_search` `outputMode` content/files/count + identical limits/policy | Task 1 |
    | Bounded `glob` with depth/entry/result/time/exclude/pagination/symlink fail-closed | Task 2 |
    | Optional read-before-write soft guard + session-owned state | Task 3 |
    | Bounded `delete`/`move` + policy + containment + no trash | Task 4 |
    | Industry-standard docs/schemas/examples for all coding tools | Task 5 |
    | coding-security approval + sandbox membership | Task 6 |
    | Migration, versions, index, `sdk:ready` gate | Task 7 |
    | No PDF/PTY/LSP/trash in 0.0.21 | Scope freeze (all tasks) |

  - Rejected in freeze (do not implement in 0.0.21):

    | Rejected | Rationale |
    | --- | --- |
    | Shell `find`/`rm`/`mv` as agent API | Policy surface + error rate |
    | Trash/recycle daemon | YAGNI; host undo documented in Task 4/5 |
    | Always-on read-before-write | Breaking; optional host flag |
    | `picomatch` / `minimatch` / new glob npm dep | Walker + minimal matcher sufficient |
    | Node `fs.glob` as primary backend | Semantic mismatch vs repo walker |
    | Regex `repo_search` | ReDoS / 0.0.18 stance |
    | Recursive directory delete (`rm -rf` tool) | High-risk; defer to Phase 9 / demand |
    | Brace-expanding glob `{}` | Explosion risk; clear error instead |
    | New package or core contribution kind | Package-only extension sufficient |
    | Checkpoint-persisted read paths | LoadedSkillSet precedent; defer |

  - Test Cases to Write:
    - Freeze doc review checklist: every Phase 4 AC mapped to a later task id (**done** — validation matrix above).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (freeze defines deltas; docs land in Task 5–7).
    - Docs pages to create/edit: none in Task 0 (plan-only).
    - `docs/index.md` update: no in Task 0.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 1 — Add `repo_search` `outputMode` (`content` | `files_with_matches` | `count`)
  - Acceptance Criteria:
    - Functional: schema + execute honor `outputMode`; `"content"` preserves today’s match body formatting; `"files_with_matches"` returns unique paths only (no line bodies); `"count"` returns match/file counts without bodies; identical path/policy/limit/binary-skip/symlink/abort fail-closed behavior across modes.
    - Performance: no extra full-file materialization for files/count modes beyond existing scan; stay within repository scan ceilings.
    - Code Quality: extend `RepositorySearchRequest` / result + `search.ts` serialization; no duplicate walker; types exported from package barrel.
    - Security: modes cannot widen path access; policy still checked before search.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md` `repo_search` section; Cursor Grep `output_mode` behavior (reference only).
      - `packages/coding-agent/src/search.ts`, `repository.ts` search path.
    - Options Considered:
      - Separate tools per mode: reject (schema enum is enough).
      - Host-only factory default mode without per-call override: reject (agents need per-call control).
      - Per-call `outputMode` with default `content`: chosen.
    - Chosen Approach:
      - Add optional `outputMode` to tool parameters and `RepositorySearchRequest`.
      - Serialization-only in `search.ts` (no walker changes); `files_with_matches`/`count` omit `matches` from metadata, add `fileCount`.
    - API Notes and Examples:
      ```ts
      await search.execute(
        { query: "TODO", outputMode: "files_with_matches", maxMatches: 200 },
        ctx,
      );
      // content: path:line:col:text …
      // files_with_matches: one path per line
      // count: "N matches in M files" (+ metadata counts)
      ```
    - Files Created/Edited:
      - `packages/coding-agent/src/repository.ts`: `RepoSearchOutputMode` + `RepositorySearchRequest.outputMode`.
      - `packages/coding-agent/src/search.ts`: schema, formatters, metadata shaping, policy metadata.
      - `packages/coding-agent/src/__tests__/repository.test.ts`: outputMode tests (files/count/invalid/truncation).
      - `packages/coding-agent/src/index.ts`: export `RepoSearchOutputMode`.
    - References:
      - Roadmap Phase 4 AC bullet 1; existing literal-only search (0.0.18 ReDoS stance unchanged).
  - Test Cases Written:
    - `files_with_matches`: unique sorted paths, no `:line:col:` bodies, `fileCount` metadata, no `matches` array.
    - `count`: `N matches in M files`, empty → `0 matches in 0 files`, invalid mode fail-closed.
    - `content`: regression preserves match bodies + `matches` metadata.
    - Truncation suffix identical across all three modes on `maxMatches` cap.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; search schema/result text.
    - Docs pages to create/edit: deferred to Task 5/7 (`docs/coding-agent-tools.md`, migration).
    - `docs/index.md` update: deferred to Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `packages/coding-agent` build + 208/208 tests pass.

- [x] Task 2 — Add bounded `createGlobTool` (pattern file finder)
  - Acceptance Criteria:
    - Functional: `glob` finds paths by pattern with depth/entry/result/time caps, exclude list, `includeHidden`, pagination (`offset`/`nextOffset`), workspace containment; does not follow symlinks; common `*` / `?` / `**` cases work without shell `find`.
    - Performance: reuses list/walk ceilings; no background index; pattern matching O(entries × pattern) with hard result/time caps.
    - Code Quality: `createGlobTool` + `RepositoryOperations.glob` (or list+filter helper) in coding-agent; zero new dependencies unless Task 0 freeze recorded an exception; brace-explosion rejected or unsupported and documented.
    - Security: patterns cannot escape workspace; symlink-out refused; ReDoS-safe if any regex compilation occurs (prefer non-regex matcher).
  - Approach:
    - Documentation Reviewed:
      - Roadmap Phase 4 glob AC; `repository.ts` list walker; Node `fs.glob` availability vs `engines: >=20`.
    - Options Considered:
      - Depend on `picomatch`: reject by default (ladder: stdlib/walk first).
      - Shell out to `find`: reject.
      - Extend `repo_list` with optional pattern field: weaker discoverability; prefer dedicated `glob` tool name (industry).
      - Dedicated `glob` tool + walk+match: chosen.
    - Chosen Approach:
      - Implement per freeze matcher policy from Task 0.
      - Add to `createCodingTools` and `createReadOnlyTools`.
      - `ExecutionAction.kind: "glob"` (or `"read"` with operation `glob` — freeze decides; prefer distinct kind for policy clarity).
    - API Notes and Examples:
      ```ts
      createGlobTool(cwd);
      // { pattern: "src/**/*.ts", path?, includeHidden?, maxDepth?, maxResults?, offset? }
      // result lines: relative paths; metadata: truncated, nextOffset, …
      ```
    - Files Created/Edited:
      - `packages/coding-agent/src/glob-match.ts` (new): `validateGlobPattern`, `matchGlobPattern` (`*`/`?`/`**` only; brace rejected).
      - `packages/coding-agent/src/glob.ts` (new): `createGlobTool` + `GlobToolOptions`.
      - `packages/coding-agent/src/repository.ts`: `RepositoryGlobRequest`/`RepositoryGlobResult`, `globLocal`, `RepositoryOperations.glob`.
      - `packages/coding-agent/src/index.ts`: exports + aggregator membership (7 tools full / 4 read-only).
      - `packages/coding-agent/src/__tests__/glob.test.ts` (new); aggregator tests updated.
      - `packages/coding-security/src/sandbox-fs-operations.ts`: sandbox `glob` backend (list+filter).
    - References:
      - Existing `repo_list` pagination/exclude/symlink semantics.
  - Test Cases Written:
    - Matcher unit tests: `*`, `?`, `**`; brace expansion fail-closed.
    - Default excludes (`.git`, `node_modules`, `dist`); `src/**/*.ts` fixture.
    - Pagination (`offset`/`nextOffset`), `includeHidden`, scoped `path`.
    - Symlink escape deny; abort + execution policy deny; custom `RepositoryOperations`.
    - Entry/file scan budget truncation via `maxResults` / `maxEntries`.
    - Aggregator membership: `createCodingTools` + `createReadOnlyTools` include `glob`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new tool + `RepositoryOperations` method.
    - Docs pages to create/edit: deferred to Task 5/7.
    - `docs/index.md` update: deferred to Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `packages/coding-agent` 216/216 tests pass; `packages/coding-security` 51/51 pass.

- [x] Task 3 — Optional session-scoped `requireReadBeforeWrite` soft guard
  - Acceptance Criteria:
    - Functional: when enabled, `write`/`edit` reject paths not recorded by a successful `read` earlier in the same session scope; clear model-visible error; after read, write/edit allowed; force override (freeze-named flag, e.g. `force: true` on write/edit args or host option) bypasses guard; cross-session / new `ReadPathSet` does not leak.
    - Performance: path set membership O(1) average; no disk I/O for the check beyond existing resolve.
    - Code Quality: small `createReadPathSet()` helper; factories accept shared set + flag; default off; no core session type required if host closes over set (document composition).
    - Security: model cannot claim “already read” without going through `read` tool that mutates the set; set not serializable from tool args.
  - Approach:
    - Documentation Reviewed:
      - Roadmap read-before-write AC; `read.ts` / `write.ts` / `edit.ts` execute paths; Phase 3 `LoadedSkillSet` precedent.
    - Options Considered:
      - Always-on guard: reject (breaking).
      - Infer reads from session transcript parsing: reject (fragile/forgeable).
      - Host-owned `ReadPathSet` closed into factories: chosen.
    - Chosen Approach:
      - Successful text/image `read` adds resolved absolute (or workspace-relative canonical) path to set.
      - Write/edit check set when `requireReadBeforeWrite: true`.
      - Aggregator `ToolsOptions` threads options for read/write/edit.
    - API Notes and Examples:
      ```ts
      const readPaths = createReadPathSet();
      createWriteTool(cwd, { requireReadBeforeWrite: true, readPathSet: readPaths });
      // error: "Refusing write to <path>: not read in this session. Read first or pass force=true."
      ```
    - Files Created/Edited:
      - `packages/coding-agent/src/read-path-set.ts` (new): `ReadPathSet`, `createReadPathSet`, `refuseReadBeforeWrite`.
      - `packages/coding-agent/src/read.ts`: `readPathSet` option; successful text/image reads call `add(allowedPath)`.
      - `packages/coding-agent/src/write.ts`: `requireReadBeforeWrite` + `readPathSet`; `force` schema param; guard before mutation.
      - `packages/coding-agent/src/edit.ts`: same as write.
      - `packages/coding-agent/src/index.ts`: export `ReadPathSet` / `createReadPathSet`.
      - `packages/coding-agent/src/__tests__/read-before-write.test.ts` (new).
    - References:
      - Soft safety only — not a hard universal lock (roadmap Cross-Phase).
  - Test Cases Written:
    - Unread path denied (write + edit); after read allowed; `force: true` bypass.
    - Separate `ReadPathSet` instances do not share; disabled flag = no check.
    - Failed read, policy-denied read do not mark path; image read marks path.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; factory options + helper export.
    - Docs pages to create/edit: deferred to Task 5/7.
    - `docs/index.md` update: deferred to Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `packages/coding-agent` 226/226 tests pass.

- [x] Task 4 — Bounded `createDeleteTool` and `createMoveTool`
  - Acceptance Criteria:
    - Functional: delete removes a contained file (and freeze-defined directory policy — prefer file-only or empty-dir-only unless freeze allows recursive with explicit flag); move/rename within workspace; both enforce `ExecutionPolicy`, abort, confirmation text + metadata (paths, bytes if known); refuse symlink escapes; exclusive via `withFileMutationQueue`.
    - Performance: O(1) fs ops + path checks; no recursive tree walk unless explicit recursive delete is frozen (default: no recursive delete).
    - Code Quality: thin tools reusing path-utils + mutation queue; risk `high`; exported factories; in `createCodingTools` / `createAllTools` only (not read-only).
    - Security: never follow symlinks out of root; policy deny returns error result; no trash daemon; document host undo responsibility.
  - Approach:
    - Documentation Reviewed:
      - Roadmap delete/move AC; `path-utils.ts`; `file-mutation-queue.ts`; coding-security approval mutating kinds.
    - Options Considered:
      - Trash/recycle subsystem: reject.
      - Recursive `rm -rf` tool: reject as default; optional `recursive` only if freeze + hard caps demand it (default prefer file/empty-dir only).
      - Shell `rm`/`mv`: reject.
      - Native delete + move tools: chosen.
    - Chosen Approach:
      - `ExecutionAction.kind: "delete" | "move"` with `risk: "high"`.
      - Move: resolve both paths; queue both (ordered lock to avoid deadlock — freeze documents order, e.g. lexicographic absolute paths).
      - Sandbox FS operations gain delete/move methods if custom ops interface requires it.
    - API Notes and Examples:
      ```ts
      createDeleteTool(cwd); // { path }
      createMoveTool(cwd);   // { from, to }
      // "Successfully deleted …" / "Successfully moved …" + metadata
      ```
    - Files Created/Edited:
      - `packages/coding-agent/src/mutation-path.ts` (new): `resolveContainedMutationPath` (symlink path kept, non-link realpath'd).
      - `packages/coding-agent/src/delete.ts` (new): `createDeleteTool`, `DeleteOperations`, file or empty-dir only.
      - `packages/coding-agent/src/move.ts` (new): `createMoveTool`, `MoveOperations`, dual-path mutation queue, `overwrite` flag.
      - `packages/coding-agent/src/index.ts`: exports + aggregator membership (9 tools full / 4 read-only unchanged).
      - `packages/coding-security/src/sandbox-fs-operations.ts`: sandbox delete/move backends.
      - `packages/coding-security/src/sandbox-coding-operations.ts`: auto-wire delete/move ops.
      - `packages/coding-agent/src/__tests__/delete-move.test.ts` (new); aggregator tests updated.
    - References:
      - Atomic write pattern for move replace semantics where applicable.
  - Test Cases Written:
    - Delete file/empty dir; non-empty dir rejected; missing path; path escape; policy deny.
    - Move rename; overwrite fail/replace; missing source; path escape.
    - Aggregator: 9 tools include delete/move; read-only excludes them.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new tools + possible sandbox ops.
    - Docs pages to create/edit: deferred to Task 5/7.
    - `docs/index.md` update: deferred to Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `packages/coding-agent` 239/239 tests pass; `packages/coding-security` 51/51 pass.

- [x] Task 5 — Industry-standard audit: schemas, descriptions, docs, examples for all coding tools
  - Acceptance Criteria:
    - Functional: written audit matrix covers `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move`, each `git_*` / `coding_check`, `ask_user_decision`, and plan/checkpoint helpers — for each: model `description` + parameter descriptions, `/docs` section completeness (prism-wiki API page shape), package README table, and at least one packed/example path that exercises or documents the tool.
    - Functional: fuzzy-edit ambiguous/silent-fuzzy success tradeoff documented loudly in tool description and `docs/coding-agent-tools.md` (duplicate-match already fails; docs state silent fuzzy success risk); Phase 4 non-goals (no PDF, no trash daemon, no PTY/LSP) stated in docs.
    - Performance: doc/example-only changes introduce no runtime cost; any description string growth stays modest (no essay-length tool descriptions).
    - Code Quality: fix only docs/schema/description/example gaps in this task — no Phase 9 features; record deferred feature wishes under plan Further Actions after execution.
    - Security: descriptions must not instruct models to bypass policy/sandbox; delete/move docs stress confirmation + host undo.
  - Approach:
    - Documentation Reviewed:
      - Full `docs/coding-agent-tools.md`, `docs/coding-security.md`, package README/CHANGELOG, `examples/*coding*`, `.agents/skills/create-plan/references/prism-wiki.md`.
      - Industry reference surfaces (Cursor tools, Claude Code, pi): compare capability names and model-facing guidance only.
    - Options Considered:
      - New features for every audit gap: reject (scope = docs/examples/schema clarity).
      - Docs-only without schema description fixes: reject (agents read schemas).
      - Matrix + targeted description/docs/example patches: chosen.
    - Chosen Approach:
      - Produce matrix in this plan (execution updates checkboxes/notes).
      - Patch weak descriptions (e.g. edit should mention fuzzy fallback risk; write should mention overwrite; read continuation; search modes; when to prefer `glob` vs `repo_list` vs `repo_search` vs `shell`).
      - Add/extend packed example `examples/coding-tools-capability-gaps.ts` (or freeze name) covering search modes, glob, RBW, delete/move — network-free.
      - Ensure Git/ask/check sections remain accurate (membership “not in createCodingTools”).
    - API Notes and Examples:
      ```ts
      // examples/coding-tools-capability-gaps.ts — packed public import smoke:
      import { createCodingTools, createReadPathSet } from "@arnilo/prism-coding-agent";
      ```
    - Files to Create/Edit:
      - `docs/coding-agent-tools.md`, `docs/coding-security.md` (if approval kinds change).
      - `packages/coding-agent/README.md`, tool `description` strings in `src/*.ts`.
      - `examples/coding-tools-capability-gaps.ts` (new) + `examples/README.md`.
      - Possibly `src/__tests__/docs.test.ts` assertions for fuzzy tradeoff / new tool names.
    - References:
      - Existing fuzzy note already in docs (~edit section) — strengthen to “loud” + model description + tests.
  - Audit matrix (executed 2026-07-31):

    | Tool / surface | Docs | Schema/description | Example | Phase 4 action |
    | --- | --- | --- | --- | --- |
    | `shell` | done | prefer dedicated tools | selection guide | done |
    | `read` | done | continuation + prefer search | capability example | done |
    | `write` | overwrite + RBW | RBW + force | capability example | done |
    | `edit` | Fuzzy silent-success loud | fuzzy risk in description | capability example | done |
    | `repo_list` | vs glob | vs glob guidance | selection guide | done |
    | `repo_search` | outputMode | outputMode enums | capability example | done |
    | `glob` | new section | full schema | capability example | done |
    | `delete` / `move` | new sections + no trash | high-risk copy | capability example | done |
    | Git / check | verified | membership accurate | durable-coding-workflow | done |
    | ask-user | verified | membership accurate | docs snippet | done |
    | plan/checkpoint | verified | membership accurate | durable-coding-workflow | done |

  - Test Cases to Write:
    - Docs tests assert presence of: `outputMode`, `glob`, `delete`, `move`, read-before-write, fuzzy tradeoff wording, non-goals (PDF/trash).
    - Example typechecks / install-smoke or docs example runner if project pattern requires packed examples.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (descriptions/docs are part of agent behavior).
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: full tool sections + non-goals.
      - `docs/coding-security.md`: mutating kinds include delete/move if needed.
    - `docs/index.md` update: yes (Task 7 may land the index sentence; this task may draft it).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. Descriptions patched; `docs/coding-agent-tools.md` + README + `docs/index.md` updated; `examples/coding-tools-capability-gaps.ts` runs; docs.test phase-4 assertions pass (108/108). Approval `isMutatingKind` wiring remains Task 6.
- [x] Task 6 — Wire `@arnilo/prism-coding-security` approval + sandbox aggregators
  - Acceptance Criteria:
    - Functional: `isMutatingKind` (or equivalent) treats `delete`/`move` as mutating; sandbox composition/tools include new aggregator membership consistent with coding-agent; sandbox FS backend supports delete/move when workspaceMode requires it.
    - Performance: no extra approval round-trips beyond one check per tool call.
    - Code Quality: reuse existing approval/sandbox helpers; update tests that assert exact tool name lists.
    - Security: high-risk delete/move still go through approval policy; mixed workspace wiring rules unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-security/src/approval.ts`, `sandbox-coding-operations.ts`, workspace consistency tests.
    - Options Considered:
      - Leave security package unaware until hosts pass custom policy: reject (default approval would miss delete/move).
      - Update mutating kinds + sandbox tool lists: chosen.
    - Chosen Approach:
      - Patch `isMutatingKind` to include `delete`/`move` (not `glob`).
      - Require delete+move ops in `hasCustomOperations` full custom path so sandbox mode cannot claim containment with host Node delete/move fallback.
      - Sandbox FS/aggregator membership already from Task 4; refresh tests + docs.
    - API Notes and Examples:
      ```ts
      createSandboxCodingTools(cwd, { workspaceMode: "sandbox", sandbox });
      // includes glob/delete/move per freeze membership
      ```
    - Files Created/Edited:
      - `packages/coding-security/src/approval.ts`: `isMutatingKind` += delete/move.
      - `packages/coding-security/src/sandbox-coding-operations.ts`: full custom ops require delete+move.
      - `packages/coding-security/src/__tests__/approval.test.ts`, `sandbox-coding-operations.test.ts`.
      - `docs/coding-security.md`: mutating kinds + readOnly wording.
    - References:
      - Task 0 freeze for kind strings and aggregator lists.
  - Test Cases Written:
    - Approval required for delete/move; approve path; glob not mutating; readOnly blocks delete/move.
    - Sandbox tool name list 9/4; custom ops missing delete/move fail closed; readonly has glob.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; approval behavior for new kinds.
    - Docs pages to create/edit: `docs/coding-security.md` updated.
    - `docs/index.md` update: deferred to Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. `packages/coding-security` 54/54 pass (1 skip).

- [x] Task 7 — Migration, version metadata, index, release gate
  - Acceptance Criteria:
    - Functional: `docs/migration.md` has `0.0.20 → 0.0.21` section (aggregator length changes, new tools, optional RBW, search `outputMode`); `docs/index.md` Coding tools entry lists glob, search modes, delete/move, read-before-write; package versions/peers target **0.0.21** per release process; CHANGELOGs updated; `roadmap.md` Phase 4 checkbox/exit evidence updated when gate passes.
    - Performance: release docs-only + version bumps; `npm run sdk:ready` within existing budgets.
    - Code Quality: no unexplained test skips; install-smoke covers new public imports if required by existing patterns.
    - Security: migration warns hosts asserting exact `createCodingTools().length` / readonly membership; documents high-risk delete/move.
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` 0.0.19→0.0.20 style; `docs/release-and-install.md`; plan 003 exit-gate pattern.
    - Options Considered:
      - Ship tools without migration note: reject (aggregator membership change).
      - Full migration + sdk:ready gate: chosen.
    - Chosen Approach:
      - Land docs/index/migration/README/CHANGELOG/version in one gate task after Tasks 1–6.
      - Prerequisite note: do not publish versioned artifacts until Phase 3 **0.0.20** is tagged if that is still outstanding — scaffolding may proceed after this plan exists.
    - API Notes and Examples:
      ```sh
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `docs/migration.md`, `docs/index.md`, `docs/coding-agent-tools.md` (final pass).
      - `packages/coding-agent/{package.json,CHANGELOG.md,README.md}`, `packages/coding-security/{package.json,CHANGELOG.md}` as needed.
      - Root `package.json` / workspace version set per release practice.
      - `roadmap.md` Phase 4 status + Further Actions.
      - `plans/README.md` status → complete when gate passes.
    - References:
      - Roadmap Phase 4 Exit Gate; Cross-Phase Coding tools.
  - Test Cases to Write:
    - Docs/index/migration assertions in `docs.test.ts` as project requires.
    - Full `npm run sdk:ready`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release surface.
    - Docs pages to create/edit: `docs/migration.md`, `docs/index.md`, coding tools/security as above.
    - `docs/index.md` update: yes — Coding tools entry lists glob, search modes, delete/move, read-before-write option.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed: 2026-07-31. Workspace **0.0.21** (44 manifests + lockfile + `version` export); migration/release/readiness/roadmap/CHANGELOGs updated; compat baseline refreshed (`arnilo__prism`, `arnilo__prism-coding-agent`); `npm run sdk:ready` green.

## Compromises Made

- No PDF/Office reader, trash daemon, PTY/process sessions, LSP, recursive delete, or brace-expanding glob in 0.0.21 (Phase 9 / demand-gated non-goals).
- Read-before-write is opt-in and session-scoped in-memory only — not checkpoint-persisted.
- Fuzzy edit may still succeed silently on normalized whitespace/unicode match; multi-match ambiguity already fails closed; tradeoff documented rather than new confidence API.
- Hand-rolled `*`/`?`/`**` glob matcher (no `fs.glob`, no picomatch) to avoid dependency and brace-expansion surface.

## Further Actions

- Tag/publish `@arnilo/prism@0.0.21` via `docs/release-and-install.md` 0.0.21 publish handoff when operator ready.
- Phase 5 next: Caveman/Ponytail third-party integrations consuming Phase 3 progressive-disclosure contracts.
- Future 0.0.x candidates: checkpoint persistence for `ReadPathSet` / loaded-skill names; recursive delete if hosts demand it; brace glob only if pattern demand justifies a dependency.
