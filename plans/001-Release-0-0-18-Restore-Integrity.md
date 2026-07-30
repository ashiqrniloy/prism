# Release 0.0.18 — Restore release integrity and close confirmed defects

Roadmap phase: Phase 1 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.18** — **Plan 001 complete** (Tasks 0–9; exit gate passed 2026-07-30).

## Objectives

- Restore default release gates after intentional deletion of historical planning/review directories.
- Close confirmed security and correctness defects: MCP moderate advisory, model-facing ReDoS, non-atomic write/edit, newest-first history eviction, cache-hostile default `inputLayout`.
- Make README, docs index, package counts, browser status, readiness, changelogs, runtime version, manifests, and lockfile agree on 0.0.18.
- Ship no new packages and no Phase 2+ APIs.

## Expected Outcome

- `node --test dist/__tests__/docs.test.js` passes from a checkout that keeps only current numbered plans under `plans/` (this plan and successors), with no restored 82-plan archive.
- `@arnilo/prism-mcp` depends on `@modelcontextprotocol/sdk@1.30.0` (or newer 1.x patch that clears the moderate advisory) with existing MCP conformance green.
- `repo_search` no longer executes uninterruptible `RegExp` on the main thread; model-facing path is literal-only (Task 0 freeze: no host regex backend in 0.0.18).
- `write`/`edit` replace targets via same-directory temp + `rename`; crash mid-write leaves the original intact.
- Context-budget history eviction drops oldest history first; default `inputLayout` is `cache_aware`; `legacy` remains explicit opt-in.
- Workspace versions, `src/index.ts` `version`, changelogs, `docs/migration.md`, and readiness framing target 0.0.18.
- `npm run sdk:ready`, `npm audit --audit-level=moderate`, package budget, `git diff --check`, and 44-package dry-run pack pass.

## Tasks

- [x] Task 0 — Primitive review and freeze public API deltas for Phase 1
  - Acceptance Criteria:
    - Functional: inventory confirms existing `WriteOperations`/`EditOperations`, `compileSearchPattern`/`repo_search` schema, `applyContextBudget`/`InputAssemblyLayout`, and MCP package seams cover Phase 1 without new core contribution types.
    - Functional: written freeze lists exact public deltas: regex mode removal or host-backend shape; atomic write behavior (ToolResult unchanged); default `inputLayout` change; history eviction policy change; MCP dependency bump only.
    - Performance: no new background workers, indexes, or timers proposed.
    - Code Quality: review cites concrete file:line evidence; rejects speculative abstractions (custom write queue, generic regex engine package, second layout enum).
    - Security: confirms temp paths stay workspace-contained; regex never runs uninterruptible on the main tool thread.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 1 Chosen Approach.
      - `packages/coding-agent/src/write.ts:30-48`, `edit.ts:68-97`, `repository.ts:127-131` + `:276-323` + `:669-674`, `search.ts:60-113`, `index.ts` exports for `compileSearchPattern` / ops types.
      - `src/contracts.ts:378` (`InputAssemblyLayout`), `src/context-budget.ts:93-180`, `src/input.ts:106-198` + `:284-295`, `src/agents.ts:518` (passes through unset layout).
      - `packages/mcp/src/{server,capabilities,bridge,transport,types}.ts` SDK import surface; pin `1.29.0`.
      - `docs/coding-agent-tools.md`, `docs/agent-session-runtime.md`, `docs/mcp-tools.md`.
      - MCP TypeScript SDK v1.x VERSIONING.md (patch/minor non-breaking); Node `rename` same-filesystem atomic replace.
    - Options Considered:
      - Add new core primitives for atomic IO or regex backends: unnecessary; coding-agent ops interfaces already pluggable; reject.
      - Keep all current public shapes and only document risks: fails Phase 1 acceptance; reject.
      - Host-supplied terminable regex backend in Phase 1: larger surface than removal; no caller evidence requiring model-facing regex beyond tests; reject for 0.0.18.
      - Freeze minimal deltas on existing seams: chosen.
    - Chosen Approach (executed freeze):
      - **No new packages, contribution types, layout enum values, or MCP APIs.**
      - **Regex:** delete model-facing `"regex"` from `search.ts` schema enum + descriptions; `RepositorySearchRequest.mode` and `compileSearchPattern` become literal-only (drop `new RegExp` branch at `repository.ts:308-322`); tool/`RepositoryError` if caller still passes `mode: "regex"`. Public export `compileSearchPattern` signature narrows. No worker/host regex backend in 0.0.18.
      - **Atomic write/edit:** keep `WriteOperations`/`EditOperations` shapes; change only `defaultWriteOperations.writeFile` and `defaultEditOperations.writeFile` to same-directory temp + `fs.rename` (shared internal helper OK; not a new public export unless tests need it). `ToolResult` content/metadata unchanged. Custom ops: document durability requirement; no interface field added.
      - **History eviction:** `groups.history.pop()` → `groups.history.shift()` in `dropNext` (`context-budget.ts:177-179`); no type change.
      - **inputLayout default:** flip `?? "legacy"` → `?? "cache_aware"` in `input.ts:106`, `input.ts:179`, `context-budget.ts:108`. `InputAssemblyLayout` stays `"legacy" | "cache_aware"`. `agents.ts:518` already pass-through; unset config/options gets new default via input/budget.
      - **MCP:** dependency pin only `1.29.0` → `1.30.0` (or newest 1.x patch clearing advisory); no Prism MCP API redesign.
    - API Notes and Examples:
      ```ts
      // After Phase 1 — model-facing search is literal-only
      await repoSearch.execute({ query: "createAgent", mode: "literal" }, ctx);
      // mode: "regex" → ToolResult/RepositoryError (schema enum literal-only)

      const session = agent.createSession({ inputLayout: "legacy" }); // explicit prior order
      // unset inputLayout → cache_aware
      ```
    - Files to Create/Edit:
      - `plans/001-Release-0-0-18-Restore-Integrity.md`: this freeze (done).
      - No production code in Task 0.
    - References:
      - Non-atomic defaults: `write.ts:46-48`, `edit.ts:92-94`.
      - ReDoS path: `repository.ts:308-320` via `search.ts:113` + `repository.ts:674`.
      - Newest-first drop: `context-budget.ts:177-179`.
      - Legacy defaults: `input.ts:106,179`, `context-budget.ts:108`.
      - MCP imports: `McpServer`, `WebStandardStreamableHTTPServerTransport`, client transports — unchanged shapes expected under 1.30.0.
      - Tests that will need retarget: `repository.test.ts` regex cases; `agents.test.ts` layout defaults; `docs.test.ts` strings that call `cache_aware` opt-in / legacy default.
  - Freeze table (public deltas only):

    | Surface | Before | After 0.0.18 | Breaking? |
    | --- | --- | --- | --- |
    | `repo_search` `mode` | `"literal" \| "regex"` | `"literal"` only; regex rejected | yes (minor, pre-1.0) |
    | `compileSearchPattern` / `RepositorySearchRequest.mode` | literal \| regex | literal-only | yes (exported helper) |
    | `WriteOperations` / `EditOperations` | non-atomic default `writeFile` | default atomic same-dir temp+rename; interface unchanged | no (behavior fix); custom ops docs only |
    | `write`/`edit` ToolResult | path/bytes/lines | unchanged | no |
    | `applyContextBudget` history | drop newest (`pop`) | drop oldest (`shift`) | yes (behavior under pressure) |
    | default `inputLayout` | `legacy` | `cache_aware`; `legacy` opt-in | yes (default change) |
    | `InputAssemblyLayout` type | unchanged | unchanged | no |
    | `@modelcontextprotocol/sdk` | `1.29.0` | `≥1.30.0 <2` | dependency only |
    | Core contribution registries / new packages | — | none | n/a |

  - Rejected abstractions: regex worker package, second layout enum, public `AtomicWriteOptions`, write-queue redesign (`withFileMutationQueue` already exists), MCP OAuth work (Phase 11).
  - Test Cases to Write (for Tasks 3–6; none run in Task 0):
    - Task 3: evil `(a+)+$` + long line → bounded reject/error; event loop stays responsive; literal Unicode/binary/symlink/abort/caps still pass; `mode: "regex"` rejected.
    - Task 4: kill between temp write and rename → original intact; success replaces + temp gone; abort before rename → target unchanged; edit confirmation text/metadata unchanged.
    - Task 5: ordered history ids under tiny budget → oldest omitted first; instructions/summaries follow existing group order.
    - Task 6: unset layout → `cache_aware` order; explicit `legacy` restores prior order; update `agents.test.ts` / docs tripwires that assume legacy default.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (freeze only; docs land with implementation tasks).
    - Docs pages to create/edit:
      - none in Task 0; freeze feeds Tasks 3–8 docs edits.
    - `docs/index.md` update: no in Task 0.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 1 — Repair docs tests and broken historical links without restoring the 82-plan archive
  - Acceptance Criteria:
    - Functional: docs suite no longer requires deleted `plans/` archive count 82 or `plans/README.md` covering historical immutable records.
    - Functional: phase-evidence tests that slice `roadmap.md` for old `Phase N — Release 0.0.x` strings are rewritten or retired to match the current 13-phase roadmap (or assert against maintained `docs/review-coverage-*.md` only).
    - Functional: every local Markdown link under `docs/` resolves, including replacement/removal of `docs/review-coverage-2026-07-20-phase-4.md` → `../plans/072-release-0-0-9-...` link.
    - Performance: docs tests remain network-free and finish within existing suite budget.
    - Code Quality: tests validate maintained artifacts; do not recreate deleted history content.
    - Security: no secrets introduced; link rewriter does not fetch remote content.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/docs.test.ts` (`plans index…`, `phase 4`–`phase 10 evidence…`, `0.0.4 release scope…`, local link walker).
      - Six `docs/review-coverage-*-phase-*.md` Prism rows linking deleted `../plans/07x-…` files.
      - Current `plans/README.md` + `001-Release-0-0-18-Restore-Integrity.md`.
    - Options Considered:
      - Restore deleted plans/reviews to satisfy old tests: reject (roadmap Chosen Approach).
      - Delete all review-coverage pages: too much history loss; reject unless maintainers request.
      - Rewrite tests around current roadmap + fix/remove dead links; keep review-coverage pages as historical evidence: chosen.
    - Chosen Approach (executed):
      - Plans index test asserts active `NNN-*.md` + `plans/README.md` (no count 82).
      - Phase 4–10 evidence tests assert review-coverage pages + package/seam guards only; drop old roadmap phase slices.
      - Drop plans 053–057 predecessor loop from 0.0.4 scope test; keep evidence matrix + 44-package count.
      - Replace six dead `../plans/07x-…` markdown links with plain commit-hash code spans.
    - API Notes and Examples:
      ```ts
      const plans = readdirSync("plans").filter((n) => /^\d{3}-.+\.md$/.test(n));
      assert.ok(plans.length >= 1);
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: rewritten plans index, phase 4–10 evidence, 0.0.4 predecessor loop.
      - `docs/review-coverage-2026-07-20-phase-4.md`, `…-phase-5.md`, `…-phase-6.md`, `…-phase-7.md`, `…-phase-8.md`, `…-phase-9.md`: dead plan links → `` `hash` ``.
      - `plans/README.md`: already indexes active plans (unchanged this task).
    - References:
      - `node --test dist/__tests__/docs.test.js` → 105/105 pass after rebuild.
  - Test Cases to Write:
    - docs tests pass with only current `plans/` contents present: done (105 pass).
    - local link integrity over `docs/**/*.md`: done (zero broken after link fix).
    - phase-evidence tests do not fail solely because roadmap was rewritten: done.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime API; documentation integrity only.
    - Docs pages to create/edit:
      - six review-coverage pages: dead plan hrefs removed (hashes retained as text).
      - `plans/README.md`: already present.
    - `docs/index.md` update: no (no page removed/renamed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Upgrade `@modelcontextprotocol/sdk` to a non-vulnerable 1.x release
  - Acceptance Criteria:
    - Functional: `packages/mcp/package.json` pins `@modelcontextprotocol/sdk` ≥ `1.30.0` < `2`; lockfile updated; public MCP exports and Streamable HTTP/session/auth behavior preserved.
    - Functional: existing MCP package tests (stateless/stateful session, auth isolation, origin, body, cursor, reconnect, unsupported capability) pass without skipping.
    - Performance: no unbounded HTTP/session state introduced; package size within budget gate.
    - Code Quality: smallest compatible version step; no opportunistic MCP feature work.
    - Security: `npm audit --audit-level=moderate` no longer reports the known fixable MCP/`@hono/node-server` path-traversal advisory for this dependency tree path.
  - Approach:
    - Documentation Reviewed:
      - `docs/mcp-tools.md` pinned-version notes.
      - MCP TypeScript SDK v1.30.0 VERSIONING.md (patch/minor non-breaking rules).
      - npm advisory fix: `@modelcontextprotocol/sdk@1.30.0` + transitive `@hono/node-server@≥2.0.5`.
    - Options Considered:
      - Jump to SDK v2 alpha: reject (unstable, out of scope).
      - Stay on 1.29.0 and document advisory: reject (Phase 1 exit gate).
      - Bump to 1.30.0 (or newest 1.x patch) and run conformance: chosen.
    - Chosen Approach (executed):
      - Exact pin `1.30.0` in `packages/mcp/package.json`; lockfile refreshed; `npm audit fix` raised transitive `@hono/node-server` to `2.0.12`; no Prism source changes required.
    - API Notes and Examples:
      ```bash
      npm install @modelcontextprotocol/sdk@1.30.0 -w @arnilo/prism-mcp
      npm audit fix   # hono transitive 1.19.x → 2.0.12
      npm audit --audit-level=moderate  # 0 vulnerabilities
      npm test -w @arnilo/prism-mcp     # 38 pass
      ```
    - Files to Create/Edit:
      - `packages/mcp/package.json`, root `package-lock.json`: done.
      - `docs/mcp-tools.md`, `packages/mcp/CHANGELOG.md`, `packages/mcp/README.md`: pin/docs updated.
      - No `packages/mcp/src/**` changes (SDK types/imports unchanged).
    - References:
      - Before: `1.29.0` + `@hono/node-server@1.19.14` (moderate advisory).
      - After: SDK `1.30.0` + `@hono/node-server@2.0.12` via lockfile.
  - Test Cases to Write:
    - MCP package regression suite green after bump: done (38/38).
    - audit moderate clean for the MCP advisory path: done (0 vulnerabilities).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (dependency-only bump; Streamable HTTP/session/auth unchanged).
    - Docs pages to create/edit:
      - `docs/mcp-tools.md`: updated pinned SDK version to 1.30.0.
      - `packages/mcp/README.md`, `packages/mcp/CHANGELOG.md`: updated.
    - `docs/index.md` update: no (nav description unchanged).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Eliminate uninterruptible model-facing regex search (ReDoS)
  - Acceptance Criteria:
    - Functional: model-facing `repo_search` cannot compile/execute catastrophic JavaScript regex on the main thread; literal search remains default and compatible.
    - Functional: if `mode: "regex"` remains in the schema, it either fails closed with a bounded error or delegates only to a host-supplied terminable backend recorded in Compromises; default path never calls `new RegExp(query)` synchronously in `repository.ts`.
    - Performance: literal search stays within existing byte/file/match/time ceilings; no main-thread hang on evil patterns.
    - Code Quality: schema, `compileSearchPattern`, tests, and docs stay consistent; no unused regex dead code left on the default path.
    - Security: adversarial `(a+)+$` (or similar) against long lines cannot block the event loop indefinitely via the default tool.
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-agent-tools.md` repo_search section (mode regex).
      - `packages/coding-agent/src/repository.ts:308-319`, `search.ts` schema enum.
      - Roadmap: prefer delete regex mode.
    - Options Considered:
      - Heuristic pattern validation only: cannot prove bound; reject.
      - Worker-thread regex with wall clock: larger change; only if removal blocked.
      - Remove model-facing regex; literal only: chosen default.
    - Chosen Approach (executed):
      - Removed `regex` from tool schema enum (`literal` only); `mode: "regex"` → bounded ToolResult error.
      - Deleted `new RegExp` branch from `compileSearchPattern`; signature is `(query, caseSensitive, maxPatternBytes)`.
      - `RepositorySearchRequest.mode` narrowed to `"literal"`; `searchLocal` rejects other modes.
      - `packages/coding-security` sandbox search rejects non-literal mode; updated compat baseline.
    - API Notes and Examples:
      ```ts
      createRepoSearchTool(cwd); // literal only
      await tool.execute({ query: "x", mode: "regex" }); // ToolResult error
      compileSearchPattern("needle", false, 512); // no mode arg
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/repository.ts`, `search.ts`, `__tests__/repository.test.ts`: done.
      - `packages/coding-security/src/sandbox-fs-operations.ts`: done.
      - `docs/coding-agent-tools.md`, `docs/migration.md`, `packages/coding-agent/CHANGELOG.md`, `README.md`: done.
      - `scripts/compat-baseline/arnilo__prism-coding-agent.txt`: done.
    - References:
      - `npm test -w @arnilo/prism-coding-agent` → 201 pass (includes ReDoS fixture).
      - `npm test -w @arnilo/prism-coding-security` → 51 pass.
  - Test Cases to Write:
    - evil-regex fixture: tool returns bounded error (or host backend times out) and event loop remains responsive: done (`repo_search rejects regex mode…`).
    - literal Unicode, binary skip, symlink deny, abort, scan/match/deadline regressions: existing suite green.
    - schema/docs no longer advertise unbounded model-facing regex: done.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; `repo_search` literal-only; `compileSearchPattern` signature change.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: regex mode removed.
      - `docs/migration.md`: 0.0.17 → 0.0.18 section added.
      - `packages/coding-agent/README.md`, `CHANGELOG.md`: updated.
    - `docs/index.md` update: no (blurb did not mention regex).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Make `write` and `edit` crash-safe via temp + rename
  - Acceptance Criteria:
    - Functional: default local ops write to a same-directory temp file then `rename` onto the target; successful ToolResult shape unchanged (bytes/lines/path).
    - Functional: simulating failure after temp write and before rename leaves the original target bytes intact; abort before rename leaves target unchanged.
    - Functional: parent directory creation and `withFileMutationQueue` serialization still apply; ExecutionPolicy path checks still gate the final target path.
    - Performance: no unbounded temp retention; temp cleaned on success and on failure paths.
    - Code Quality: shared helper preferred over duplicated write/edit logic; pluggable ops remain overrideable.
    - Security: temp names stay under the approved directory (no `/tmp` escape for content); no symlink-following replace outside workspace roots already enforced by policy.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/write.ts`, `edit.ts`, `path-utils.ts`, file-mutation-queue.
      - Node `rename` atomicity on same filesystem.
    - Options Considered:
      - Document non-atomic risk only: reject.
      - Write to `os.tmpdir()` then move: cross-device non-atomic / escape risk; reject.
      - Same-dir `.prism-write-*` temp + `rename`: chosen.
    - Chosen Approach (executed):
      - Added `atomicWriteUtf8File` in `atomic-write.ts` (same-dir `.prism-write-{hex}` temp → `rename`; unlink temp on failure; abort check before rename).
      - Default `WriteOperations` / `EditOperations` `writeFile` call it; custom ops documented via comment.
    - API Notes and Examples:
      ```ts
      await atomicWriteUtf8File(targetPath, content, { signal });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/atomic-write.ts`: new shared helper.
      - `packages/coding-agent/src/write.ts`, `edit.ts`: default ops wired.
      - `packages/coding-agent/src/__tests__/atomic-write.test.ts`, `write.test.ts`: durability tests.
      - `docs/coding-agent-tools.md`, `docs/migration.md`, `CHANGELOG.md`: done.
    - References:
      - `npm test -w @arnilo/prism-coding-agent` → 204 pass.
  - Test Cases to Write:
    - crash between temp write and rename: original content preserved: overwrite + atomic tests; rename-to-directory rejects with temp cleanup.
    - successful replace: new content present; temp gone: done.
    - abort before rename: target unchanged: done (`atomic-write.test.ts`).
    - edit fuzzy/exact success still returns same model-visible confirmation text: existing edit suite green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (durability semantics); ToolDefinition args unchanged.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: atomic replace + fuzzy-match tradeoff callout.
      - `docs/migration.md`: durability note added to 0.0.17 → 0.0.18.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Context-budget history eviction: drop oldest first
  - Acceptance Criteria:
    - Functional: under pressure, `applyContextBudget` removes oldest history messages before newer ones; instruction/summary prefix retention policy otherwise unchanged.
    - Functional: tool_results / other group ordering from existing layout rules remains; only history within-group direction changes from end-pop to front-drop.
    - Performance: eviction remains O(n) over drops (no O(n²) regression beyond 0.0.17 fix).
    - Code Quality: update the ponytail comment at `dropNext` to match new policy; add focused unit test.
    - Security: no change to redaction or cross-session leakage.
  - Approach:
    - Documentation Reviewed:
      - `src/context-budget.ts` `dropNext` history `pop()`.
      - `src/__tests__/context-budget.test.ts`.
      - `docs/input-and-prompt-assembly.md`.
    - Options Considered:
      - Keep newest-first for cache: reject (front-drop preserves prefix equally).
      - Drop oldest history first: chosen.
    - Chosen Approach (executed):
      - `groups.history.pop()` → `groups.history.shift()` in `dropNext`; ponytail comment updated.
      - Regression test asserts `hist-old` / `hist-mid` omitted before `hist-new` retained.
    - API Notes and Examples:
      ```ts
      const { report } = applyContextBudget({ groups, budget: { maxInputTokens: small } });
      // report.omitted history ids: oldest first
      ```
    - Files to Create/Edit:
      - `src/context-budget.ts`, `src/__tests__/context-budget.test.ts`: done.
      - `docs/input-and-prompt-assembly.md`, `docs/migration.md`: done.
    - References:
      - `node --test dist/__tests__/context-budget.test.js` → 7 pass.
  - Test Cases to Write:
    - over-budget fixture with ordered history ids: oldest omitted first; newest retained longest: done.
    - instructions/summaries not sacrificed before history per existing order rules: existing suite green.
    - cache_aware vs legacy group-order regressions still pass: `keeps cache_aware attachment prefix` green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; eviction policy change affects provider context under pressure.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: oldest-first history drop noted; duplicate bullet removed.
      - `docs/migration.md`: behavior change noted in 0.0.17 → 0.0.18.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Default `inputLayout` to `cache_aware`
  - Acceptance Criteria:
    - Functional: when `AgentConfig.inputLayout` and `RunOptions.inputLayout` are unset, assembly uses `cache_aware` ordering (`attachments`/`toolResults` before transient `input` per existing layout tables).
    - Functional: explicit `inputLayout: "legacy"` restores prior order.
    - Performance: no extra provider calls; ordering-only change.
    - Code Quality: all `?? "legacy"` fallbacks in assembly/budget paths flip consistently (`input.ts`, `context-budget.ts`, any other call sites).
    - Security: no trust-boundary change.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`.
      - `src/input.ts:106`, `:179`; `src/context-budget.ts:108`.
    - Options Considered:
      - Document cache_aware without changing default: reject (roadmap).
      - Flip default to cache_aware; keep legacy opt-in: chosen.
    - Chosen Approach (executed):
      - `?? "legacy"` → `?? "cache_aware"` in `input.ts` (2) and `context-budget.ts` (1).
      - Tests/docs updated for default cache_aware + explicit legacy opt-in.
    - API Notes and Examples:
      ```ts
      await agent.createSession({}).run("hi"); // cache_aware default
      await agent.createSession({ inputLayout: "legacy" }).run("hi");
      ```
    - Files to Create/Edit:
      - `src/input.ts`, `src/context-budget.ts`, `src/__tests__/input-pipeline.test.ts`, `src/__tests__/docs.test.ts`: done.
      - `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`, `docs/public-contracts.md`, `docs/index.md`, `docs/provider-caching.md`, `docs/migration.md`: done.
    - References:
      - `node --test dist/__tests__/input-pipeline.test.js` + docs suite green.
  - Test Cases to Write:
    - default layout is cache_aware in assemble/flatten: done (`uses cache_aware layout by default`).
    - explicit legacy restores prior message order: done (`legacy layout restores…`).
    - attachments/toolResults before input in default path: done (updated builder tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; default assembly order changes.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`, `docs/public-contracts.md`, `docs/provider-caching.md`, `docs/migration.md`, `docs/index.md`: updated.
    - `docs/index.md` update: done (cache-aware default blurb).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Correct README and readiness documentation to current inventory
  - Acceptance Criteria:
    - Functional: README package/provider counts match generated/current manifests (14 provider adapters, not “11”; browser package status truthful vs non-goal wording).
    - Functional: `docs/0.1.0-readiness.md` no longer frames gates as solely 0.0.16 when current line is 0.0.17→0.0.18; either retitle evidence columns or add 0.0.18 row honesty.
    - Functional: `docs/index.md` links and short descriptions match maintained pages after Tasks 1–6.
    - Performance: n/a.
    - Code Quality: prefer deriving counts from manifests/scripts over hand-maintained duplicate numbers where a script already exists.
    - Security: no capability overclaim (browser remains optional package; not core).
  - Approach:
    - Documentation Reviewed:
      - `README.md` providers family line; browser non-goal vs `@arnilo/prism-browser`.
      - `docs/0.1.0-readiness.md`, `docs/index.md`, `docs/release-and-install.md`.
    - Options Considered:
      - Leave README stale: reject (Phase 1 objective).
      - Sync docs to inventory and optional package reality: chosen.
    - Chosen Approach:
      - Fix counts/status; keep product boundaries (browser opt-in package, not core auto-start).
    - API Notes and Examples:
      ```md
      | `@arnilo/prism-providers` | family: all first-party provider adapters (see package list) |
      ```
    - Files to Create/Edit:
      - `README.md`, `docs/0.1.0-readiness.md`, `docs/index.md`, `docs/release-and-install.md` as needed.
    - References:
      - Prior review: README provider count 11 vs 14; browser non-goal contradiction; readiness stuck on 0.0.16.
  - Test Cases to Write:
    - docs tests asserting README/package-count/browser/readiness tokens derived from current manifests where such tests exist or are added narrowly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no code API; public docs accuracy yes.
    - Docs pages to create/edit:
      - `README.md`, `docs/0.1.0-readiness.md`, `docs/index.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes; repair descriptions for Tools, MCP, Context/skills, Runtime, Release/install, browser.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — Version 0.0.18 metadata, changelogs, and migration section
  - Acceptance Criteria:
    - Functional: all publishable manifests and `src/index.ts` `version` report `0.0.18`; lockfile/internal ranges consistent with release scripts.
    - Functional: root + affected package CHANGELOGs document Tasks 2–6 user-facing changes; `docs/migration.md` has a complete 0.0.17 → 0.0.18 section covering regex, layout default, eviction, atomic write, MCP SDK, docs-test expectations.
    - Performance: release gate scripts accept the new version.
    - Code Quality: no premature Phase 2+ mentions as shipped.
    - Security: migration calls out security-relevant regex and audit fixes.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs`, `docs/migration.md` prior section style, `CHANGELOG.md` 0.0.17 entry.
    - Options Considered:
      - Ship code without version bump: reject (phase is a release).
      - Single coordinated 0.0.18 bump after code tasks: chosen.
    - Chosen Approach (executed):
      - All 44 manifests + lockfile → `0.0.18`; `src/index.ts` + compat baseline version string updated.
      - Root `CHANGELOG.md` + `packages/coding-agent` + `packages/mcp` detailed notes; other packages `Released with exact 0.0.18 graph`.
      - `docs/migration.md` item 5 (MCP SDK 1.30.0) + docs-only note; `docs/release-and-install.md` 0.0.18 handoff + current-line refs; `docs/index.md` + `docs/0.1.0-readiness.md` current line.
      - `node scripts/release.mjs check --version 0.0.18` passes.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs check --version 0.0.18
      ```
    - Files to Create/Edit:
      - root + workspace `package.json` versions, `src/index.ts`, `CHANGELOG.md`, package changelogs, `docs/migration.md`, lockfile: done.
    - References:
      - `export const version = "0.0.18"` in `src/index.ts`.
  - Test Cases to Write:
    - docs migration section tripwire for 0.0.18: covered by existing migration headings/phrases.
    - `node scripts/release.mjs check --version 0.0.18`: pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release documentation.
    - Docs pages to create/edit:
      - `docs/migration.md`, `docs/release-and-install.md`, changelogs, `docs/index.md`, `docs/0.1.0-readiness.md`: done.
    - `docs/index.md` update: done (0.0.18 current line).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — Phase 1 exit gate verification
  - Acceptance Criteria:
    - Functional: compiled docs tests, coding-agent tests, MCP tests, core context-budget/input tests, and `npm run sdk:ready` pass from a clean build.
    - Functional: `npm audit --audit-level=moderate` clean for known MCP advisory; `git diff --check` clean; 44-package dry-run pack succeeds.
    - Performance: package budget / size gates pass; no unexplained skips.
    - Code Quality: roadmap Phase 1 checkbox remains unchecked until this task passes; then update roadmap with concise completion evidence (separate edit when releasing).
    - Security: secret/SBOM/license checks used by sdk:ready/release gate pass.
  - Approach:
    - Documentation Reviewed:
      - Roadmap Phase 1 Exit Gate list.
      - `package.json` scripts for `sdk:ready`, audit, pack.
    - Options Considered:
      - Partial gate with skips: reject.
      - Full listed gate: chosen.
    - Chosen Approach (executed):
      - `git diff --check`: clean.
      - `npm audit --audit-level=moderate`: 0 vulnerabilities.
      - `npm test -w @arnilo/prism-coding-agent`: 204/204; `npm test -w @arnilo/prism-mcp`: 38/38.
      - `node --test dist/__tests__/context-budget.test.js dist/__tests__/input-pipeline.test.js dist/__tests__/docs.test.js`: 139/139.
      - `npm run sdk:ready`: pass (Biome format fixed 4 drift files first).
      - `node scripts/release.mjs check --version 0.0.18`: pass; `release:gate` `updated: false`.
    - API Notes and Examples:
      ```bash
      npm test
      npm test -w @arnilo/prism-coding-agent
      npm test -w @arnilo/prism-mcp
      npm run sdk:ready
      npm audit --audit-level=moderate
      git diff --check
      ```
    - Files to Create/Edit:
      - none expected unless gate failures require fixes; update this plan checkboxes and Compromises/Further Actions when done.
      - `roadmap.md`: completion evidence only after gate passes (when releasing).
    - References:
      - Roadmap Phase 1 Exit Gate.
  - Test Cases to Write:
    - none new; execute suites listed above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new impact beyond prior tasks.
    - Docs pages to create/edit:
      - none unless gate finds doc drift.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **Regex mode removed, not worker-isolated.** `repo_search` literal-only; hosts needing regex supply own backend.
- **Atomic write is same-filesystem temp+rename only.** Custom ops hosts must match durability.
- **Default layout flip breaking** for implicit legacy order — use `inputLayout: "legacy"`.
- **Readiness table evidence still 0.0.16 baseline** — operator refreshes at 1.0 RC.

## Further Actions

- **Create Phase 2 plan** (`0.0.19` observational memory) after operator tags/releases 0.0.18.
- **Operator publish** — signed `v0.0.18` tag + `release:publish` per `docs/release-and-install.md`.
- **Phase 4 coding gaps** (glob, files_with_matches, etc.) remain roadmap Phase 4; not Phase 1 scope.
