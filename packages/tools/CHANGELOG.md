# Changelog

## [Unreleased]

Consolidated seven tool packages into `@arnilo/prism-tools` with explicit subpaths.

### ./coding

# Changelog

## [Unreleased]

### Added

- **Background waits are event-driven (plan 189 follow-up).** `ProcessSession` gains `onOutput(listener)`, which publishes a chunk or the terminal transition (unsubscribe with the returned function; a throwing listener never fails the process). `shell({ background: true })` therefore returns as soon as the first output arrives instead of always paying the one-second window, and `shell_output({ waitSeconds })` wakes on the publication instead of polling every 50 ms. One `shell_output` call now drains everything that accumulated, in whole chunks up to twice the tail cap, instead of returning only the first chunk. The internal session record carries the listener set; no cap changed.

- **The `workspace` service emits `worktree_changed` (plan 189 follow-up).** `createWorkspaceService({ onEvent })` emits `{ type: "worktree_changed", action: "add", path }` after `worktree.create` succeeds and `{ action: "remove", path }` after `dispose()` removed one, through `createCodingLifecycleEmitter` (so the frozen kind's path/byte caps apply). No new export: `WorkspaceServiceOptions` gains the field. Worktree movement keeps a producer at the layer that still owns worktrees, after the `git_worktree` tool was removed, and nothing is emitted when no sink is passed. `createCodingLifecycleEmitter` also swallows a listener that throws now, so a failing consumer cannot fail the operation that produced the event.

- **`diagnostics` tool (plan 189 Task 10).** `language.servers` (name → `{ command, args?, languages, env? }`) registers `diagnostics({ path })`, which refreshes the document and returns the language server's diagnostics as `path:line:col severity message` (1-based, capped at 500 per file / 4 KiB per message). No servers means no tool and no process; a configured server starts on the first call for its language and stops when the last open session closes. A server that cannot start is a tool error naming it plus one `status.note("warn", …)`. New exports: `createDiagnosticsTool`, `DiagnosticsToolHandle`, `DiagnosticsToolOptions`, `ToolsCodingLanguageConfig`, `ToolsCodingLanguageServerConfig`, `languageIdForPath`.

- **Background processes (plan 189 Task 9).** `shell` takes `background: true` and returns `Started process <id>` plus the output that arrived within one second; `shell_output({ id, waitSeconds?, kill? })` reads the increment since the last call, waits for new output or exit (max 60 s), or kills the process. Processes run on the process-session library, are owned by the calling session (another session's id is an error), are capped by `shell.background.maxProcesses` (default 4, hard 16), and are killed on `session.closed` and `agent.dispose()`. The hard-deny `commandRules` and built-in denies, the environment allow-list, `commandPrefix`, and `spawnHook` all apply to background commands. A backend without `startProcess` (the native `unshare` sandbox) offers no `background` argument and no `shell_output`. New exports: `createBackgroundProcesses`, `createShellOutputTool`, `BackgroundProcesses`, `BackgroundProcessOptions`, `BackgroundRead`, `BackgroundReadInput`, `BackgroundStarted`, `BackgroundStartInput`, `ShellOutputToolOptions`, `DEFAULT_MAX_BACKGROUND_PROCESSES`, `HARD_MAX_BACKGROUND_PROCESSES`, `HARD_MAX_BACKGROUND_WAIT_SECONDS`, `BACKGROUND_FIRST_OUTPUT_MS`.

- **`examples/serve-tools.ts`: serving a run's tools to an external agent (plan 165 Task 8).** The Phase 14 end-to-end example, offline. Inside one `session.run` an inline `defineDriver` driver binds a `workspace` worktree for the run's session, writes the vendor's MCP configuration into it with `excludeOverlay`, and serves `read`, `edit`, and the permission tool with `serveTools` over `loopback-http` and then `stdio-relay`, driving the scripted `jsonl-stream` CLI as the vendor binary through `--mcp-endpoint`. It shows an allowed `edit` that changes the file in the worktree, a declined `edit` under `@arnilo/prism-extensions/approval` in `ask` mode, the permission tool's deny and allow, an unserved name as a JSON-RPC error, a call after `close()` refused, the served calls' `origin` on the run's events, the worktree diff with the overlay excluded, and a conflicting `merge` reported unresolved.
- **Per-session worktree routing (plan 165 Task 7).** A worktree bound with `worktree.create({ sessionId })` now routes that session's tool calls into the worktree: one wrapper at registration (`createWorktreeRouting({ base, create, workspace })`) wraps each registered tool's `execute` with a lookup of the calling session's worktree and dispatches to the tool instance built for it, so relative paths resolve inside the worktree and the tools' own containment follows it. Tool names, descriptions, and schemas are unchanged. The binding lives only in the service's memory, keyed by session id, and is never read from tool arguments or model output. Instances are built once per bound worktree, dropped on `dispose`, and dropped on the `session.closed` hook. A session rebound to another worktree rebuilds. New exports: `createWorktreeRouting`, `WorktreeRouting`, `WorktreeRoutingOptions`, `CodingTargetsContext`.

### Removed

- The unregistered patch-review module and its four limits constants: `createCodingPatchReviewManifest`, `assertCodingPatchAccepted`, `CodingPatchReviewError`, `resolveCodingReviewLimits`, `CodingPatchReview*`/`CodingReview*`/`ReviewDiagnosticSeverity` types, `DEFAULT_/HARD_MAX_REVIEW_REVISIONS`, `DEFAULT_/HARD_MAX_REVIEW_MANIFEST_BYTES`. `lifecycle.ts` and `coding-checkpoint.ts` stay (shipped tools type-import the former; `goal-verify.ts` uses the latter).

- **Fewer tools, one job each (plan 189 Task 8, breaking).** `repo_list`, `git_branch`, `git_worktree`, and `git_apply` are gone, with `createRepoListTool`, `ListToolOptions`, `createGitBranchTool`, `createGitWorktreeTool`, `createGitApplyTool`, and `classifyGitBranchEffect`/`classifyGitWorktreeEffect`/`classifyGitApplyEffect`. `createGitTools` returns `git_status`, `git_diff`, `git_commit`, `git_pr_handoff`. Directory listing is the `glob` walk (the repository `list` operation stays), worktrees are the `workspace` service's job, and `git branch`/`git apply`/`git worktree` are `shell` calls. `delete`/`move` are registered only when `shell` is absent — `createCodingTools(cwd, { shellAvailable: false })` — so the default set is 12 tools instead of 18 and the read subset is `read`/`grep`/`glob`. `GitToolsOptions.onEvent` is removed; the `workspace` service emits `worktree_changed` instead (see Added).

### Changed

- **Skill directories are read-only extra roots for read-effect coding tools (plan 190 Task 6).** `coding.targets` now reports `dirname(skill.path)` for every effective skill with an absolute path, but only for `read`, `glob`, `grep`, and `diagnostics`. A skill's `references/` file outside the workspace is therefore readable without adding a root that would also grant writes, and approval sees the same read-only roots. `write`, `edit`, `delete`, `move`, and `shell` keep the coding roots, so a write under a skill directory is still hard-denied. The skill list is read lazily after setup and the derived directories are cached until its paths change. `createCodingTargets` gains an optional fourth argument, `() => readonly Skill[]`; without it behavior is unchanged. No kernel change; `CodingTargets.roots` and the function's signature are the additive package surface.

- **Schemas describe only what the model controls (plan 189 Task 7).** `write` and `edit` include `force` — and the read-before-write sentence in their description — only when the tool was created with `requireReadBeforeWrite`; without the guard `force` is an unknown key and the description is silent about it. `ask_user_decision`'s `pros`/`cons` are optional 0–3 string arrays (were exactly 3), `AskUserDecisionOption.pros`/`.cons` are `readonly string[]`, and a 4-bullet list still fails. Guard behavior when enabled is unchanged.


- **`edit` is exact-match only and reports what it changed (plan 189 Task 6).** Breaking: `normalizeForFuzzyMatch`, `fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`, `AppliedEditsResult.usedFuzzyMatch` and `EditToolDetails.fuzzy` are gone, and a near-miss oldText (trailing whitespace, smart quotes, en-dash, NBSP) now fails loudly with the `Nearby` hint instead of editing a nearby region. A success returns `Edited <path>: N block(s).` followed by the changed lines with their new numbers, two lines of context and a 40-line cap with a `(… N more changed lines)` note. New export `generateChangedLinePreview` shares `read`'s `N\ttext` format; CRLF/BOM preservation is unchanged.


- **`glob` accepts brace patterns by default (plan 189 Task 5).** `braceExpansion` defaults to `true`: `src/**/*.{ts,tsx}` expands on the first call, with the same bounds (128 alternatives / 4096 expanded bytes; unbalanced, nested, or empty braces are errors). The argument is removed from the schema; `createGlobTool(cwd, { braceExpansion: false })` rejects braces and the error says so. `compileGlob(pattern, braceExpansion?)` is exported and used by the `grep` `glob` filter and both sandbox paths, so brace filters expand everywhere.


- **`repo_search` is now `grep`: regex by default, in a terminate-able worker (plan 189 Task 4).** Breaking: the renamed tool takes `pattern` (not `query`), `caseSensitive` defaults to `true`, `context` defaults to `0`, and content output is ripgrep-style (`path:line:text`, `path-line-text` for context, `--` between groups, each line once). A pattern is a JavaScript regex unless `literal: true`; regex matching runs in `agent/grep-worker.ts` and the main thread terminates it at the search time limit, so a catastrophic pattern returns the matches so far with `truncatedBy: "time"` instead of blocking the loop. New `glob` argument filters files by path, `mode` is only in the schema when `modes` enables an index, and `createRepoSearchTool`/`SearchToolOptions` become `createGrepTool`/`GrepToolOptions` (`ToolsOptions.search` stays as a deprecated alias). `RepositorySearchRequest` gains `matcher` and `glob`; `matchLines`/`literalMatcher` are exported and shared by the worker, literal mode, and the sandbox backend.


- `coding.targets`' `CodingTargetsFn` takes an optional third argument, `{ sessionId? }`, and `createCodingTargets(root, roots, workspace?)` takes the `workspace` service. For a bound session it reports the worktree as the session's root and resolves relative paths against it, so approval and the hard-deny hook follow the session; unbound sessions are unchanged. The hard-deny hook now passes the `tool.call` payload's `sessionId`.
- `worktree.create({ sessionId })` fails with the new `workspace_sandbox_unsupported` when `sandbox` is other than `none`, because a routed worktree path is outside the sandbox root. `create` without `sessionId` still works.

- `@arnilo/prism-tools/coding` (plan 154 Task 3): the coding tools moved out of
  `@arnilo/prism-coding-tools/{agent,security}` into a source-exported package on the lockstep line.
  The default export is a `definePackage` definition whose `setup` registers `read`, `write`, `edit`,
  `delete`, `move`, `repo_list`, `repo_search`, `glob`, and `shell` (or the read subset with
  `readOnly: true`, and without `shell` when `shell.enabled` is `false`). Every registered tool now
  declares `effects` — `["read"]` for the read/search tools, `["write"]` for the mutating tools, and
  `["execute"]` for `shell` — so `tool.call` hooks and approval can decide from the capability
  annotation. Config is `{ root, roots?, readOnly?, shell?, repository? }`; a missing `root` fails the
  load with a field-naming error rather than a schema `required` (plan 152 Task 6's config rule).
- The moved module surface keeps its names as named exports behind the single entry point: the tool
  factories and aggregators, the opt-in Git/check/todo/`ask_user` tools, the workspace/process/
  language/review helpers, and the sandbox, command-rule, path-containment, and egress modules.
- `tool.call` hard denies (plan 154 Task 4): one decide handler, id
  `@arnilo/prism-tools/coding:tool.call#hard-deny`, denies a path outside `root` ∪ `roots` after
  realpath/symlink resolution, a `shell` command matching a deny `commandRules` entry or a built-in
  deny pattern, and any mutating tool under `readOnly`. The kernel's any-deny-wins rule makes it hold
  under every approval mode and from a custom loop.
- The `coding.targets` service, `targets(name, args) → { paths, roots } | undefined`, reporting the
  absolute paths and roots of each own-tool call.
- Config gains `sandbox` (`"none"` default, `"native"`, `"docker"`, `"e2b"`), `commandRules`, and
  `egress`. `e2b` is reached only through a dynamic import of the optional peer; a backend that
  cannot be built notes a warning and withholds `shell` instead of throwing or running unsandboxed.
- Git, checks, todo, and `ask_user` (plan 154 Task 5). `git` (default on) registers the seven git
  tools with declared effects. `checks` registers `coding_check` only when at least one check is
  configured. `todo` registers `todo_write` and a `run.end` handler, id
  `@arnilo/prism-tools/coding:run.end#todo`, unless `continueOnOpen` is `false`. `ask_user_decision`
  asks through `host.ui`; `unavailable` suspends and `session.resume(decisions)` delivers the answer.
  Durable-effect tools fail closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` or
  `ERR_PRISM_CODING_PRINCIPAL_MISMATCH`. `forge.token` is an `env:`/`keyring:` ref resolved through
  `prism.credentials.resolve`.

### Added

- The `workspace` service (plan 165 Task 6): disposable git worktrees for delegated coding work,
  provided whenever `root` is inside a git repository (otherwise a `status.note` and no service).
  `worktree.create({ branch?, base?, sessionId? })` adds and locks a linked worktree under
  `worktreeRoot` and returns `{ path, branch, base, sessionId?, dispose }`; `worktree.bound(sessionId)`
  is the plan 165 Task 7 routing lookup. `diff(path, bounds?)` returns `{ changes, truncated }` — the
  driver kit's `FileActivity` shape — for tracked changes against the worktree's base plus untracked
  files, with overlay files excluded and per-file byte bounds. `merge(path, { into, commit? })`
  probes with `git merge-tree --write-tree` so a conflict reports `{ status: "conflict", files }` with
  both trees, the index, and every ref unchanged; a clean merge returns `{ status: "merged", commit }`.
  `excludeOverlay(path, files)` writes overlay files and excludes them through one marked block in the
  git common directory's `info/exclude` (the driver kit's `writeExcludeBlock`). `dispose({ force? })`
  removes the overlays, unlocks and removes the worktree, drops the session binding, and deletes the
  branch only when git considers it fully merged. New config: `workspace`
  (`enabled`, `worktreeRoot`, `maxWorktrees`, `diff.maxFiles`, `diff.maxBytes`) with defaults and
  schema bounds. `GitOperations` gains `mergeTree`, `commitTree`, `updateRef`, `fastForward`,
  `stageAll`, `writeTree`, `readTree`, and `untrackedFiles`, plus a `base` option on `diff`/`worktree`
  and a `delete` action on `branch` — all through the existing bounded runner.

### Removed

- The durable multi-repository workspace lifecycle (plan 165 Task 6): `createCodingWorkspaceLifecycle`,
  `resolveWorkspaceLimits`, `WorkspaceError`, the `WORKSPACE_NAMESPACE`/`WORKSPACE_SCHEMA_VERSION`/
  `WORKSPACE_LOCK_REASON_PREFIX`/`WORKSPACE_STATES` constants, the `CodingWorkspaceRecord`/`Workspace*`
  record and limit types, and the ten `*_MAX_WORKSPACE_*` caps, with no alias. Durable records, leases,
  checkpoints, and multi-repository identity move to `@arnilo/prism-extensions/workflows` in Phase 16; the
  in-process `workspace` service replaces the rest. The phase26 coding-journey fixture's workspace leg
  now uses the service and drops its Postgres verify/cleanup calls.
- `createCodingApprovalPolicy` and its `CodingApprovalFn`, `CodingApprovalRequest`,
  `CodingApprovalPolicyOptions`, and `ApprovalCacheScope` types (plan 154 Task 4). Prompting moves to
  `@arnilo/prism-extensions/approval` (plan 154 Task 6); containment and command-rule evaluation stay as
  internal checks behind the `tool.call` hard deny.
- The host ask callback, the workflow suspend/resume validators, and the mutable todo-continuation
  handler (plan 154 Task 5). Asking goes through `host.ui` and `session.resume`. Continuation is
  `createTodoContinuationDecision` on `run.end`.

### Changed

- `@arnilo/prism-coding-tools` no longer exports `./agent` or `./security`; the two subpaths are
  deleted with no alias. Its remaining surface is `./openapi`, `./computer-use-linux`, `./dev`,
  `./dev/cli`, and `./impeccable`. Its `diff` dependency moved with the coding tools.
- Every importer migrates to `@arnilo/prism-tools/coding`: `@arnilo/prism-code`,
  `@arnilo/prism-ag-ui`, `@arnilo/prism-acp-agent`, `@arnilo/prism-agent-sdk`, the examples, and the
  scripts.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The coding tools shipped inside `@arnilo/prism-coding-tools` before this package existed; see that
package's changelog for the pre-split history.


### ./web

# Changelog

## [Unreleased]

### Added

- **`web-research` skill (plan 215 Tasks 8 and 11).** The package registers a bundled skill from `skills/web-research` with `skills.addDir`, and `package.json` `files` lists `skills`. It declares `prism-requires-tools: web_fetch`, so a request without `web_fetch` does not list it. The body is eight lines: page text is data, give each fact's URL, prefer the official source, say so when no page has the answer, stop once the primary source answers. Kept on a measured hazard effect, not a pooled gain: `web-no-answer` 6/9 with the skill against 1/9 without across three runs, the other 14 items at ceiling (owner override of the pooled ship rule; evidence in `docs/_evidence/skill-evals/211/v3/`).

- **A keyless `native` fetch backend, now the default for `web_fetch` (plan 193 Task 2).** `createNativeFetch` returns a `WebFetchAdapter` that reads a public page through the kernel's DNS-pinned request without a provider key: `pinnedFetch`'s per-candidate SSRF check and address pinning run on every hop, redirects are followed by hand (default 5, hard 10) with each `Location` resolved against the current URL and gated again, and a loop or excess hop fails with `ERR_PRISM_WEB_REDIRECT`. `text/html` and `application/xhtml+xml` are reduced to the article body with Readability on a `linkedom` document (falling back to the whole body) and converted to Markdown with `turndown` — ATX headings, fenced code, absolute links, no scripts; `text/*`, `application/json` (pretty-printed), and XML pass through, and anything else fails with `ERR_PRISM_WEB_CONTENT_TYPE`. The charset comes from the header or `<meta charset>`, invalid bytes are replaced. Requests send a fixed `user-agent` (`Prism-Web-Fetch/<version> …`, overridable by `fetch.userAgent`) and no cookies; the citation URL is the final URL and `WebDocument.redirects` lists the hops. `linkedom@0.18.14`, `@mozilla/readability@0.6.0`, and `turndown@7.2.4` are exact-pinned runtime dependencies loaded on the first HTML conversion only.

- **Package config reaches every backend (plan 192 Task 8).** `toolsWeb({ backend: "obscura", obscura: { limits } })` now passes `ObscuraWebLimits` to `createObscuraWebTools` instead of silently dropping them — the config schema declares `obscura.limits`, and an out-of-range value fails setup with `invalid limits config` naming the key. The Obscura backend also provides the `web.fetch` service, built on the exported `createObscuraPageFetcher` (the same URL-validated, byte-bounded `markdown` dump the `web_fetch` tool uses), so wiki ingest and RAG URL loaders work with Obscura. A new `extract.schema` config field registers `web_extract` over that schema: it takes the main key for `backend: "firecrawl"` and `fetch.apiKey` otherwise, compiles the schema at setup with the kernel's `validateJsonSchema` (so an unsupported subset or a remote `$ref` fails setup naming `extract.schema`), and a missing Firecrawl key writes a `warn` note and skips only `web_extract`. `ToolsWebObscuraConfig.limits` and `ToolsWebExtractConfig` are new public config types.

- **`web_search` takes structured search controls, per backend (plan 192 Task 6).** `freshness` (`day`/`week`/`month`/`year`), `include_domains` and `exclude_domains` (each up to 10 bare hostnames), `country` (ISO 3166-1 alpha-2), `language` (ISO 639-1) and `offset` are typed on `WebSearchAdapter.search` (`WebSearchCall`) instead of leaving models to write query operators. Brave maps them to `freshness`/`country`/`search_lang`/`offset` (0-based, capped at 9 — a larger value fails with `ERR_PRISM_WEB_INPUT` naming `offset`) and appends `site:`/`-site:` operators for domains; Exa maps them to `startPublishedDate`/`includeDomains`/`excludeDomains`/`userLocation` and refuses `offset` and `language` by name; Obscura's DuckDuckGo profile maps them to `df` and a `kl` region-language pair plus `site:` operators, and refuses `offset` because continuing the list needs a `vqd` token from a second request. Each adapter declares `supports: ReadonlySet<SearchControl>` — one table read by the tool builder and by the adapter's own validation — so the schema and description list only what the configured backend honors, and an unsupported or malformed control fails with `ERR_PRISM_WEB_INPUT` naming the argument. Domain values are validated as bare hostnames (no scheme, path, wildcard, or `site:` syntax) and the operators they generate count toward the provider's query length and word limits. `ObscuraSearchProfile.searchUrl` gained an optional `controls` argument.

- **SearXNG, Tavily, and Kagi search backends (plan 193 Task 8).** `backend` now also accepts `"searxng"`, `"tavily"`, and `"kagi"`, and `WebProvider`/`WebSearchAdapter.provider` widened to match.
  - **SearXNG** (`searxng: { origin, allowLoopback? }`) is a self-hosted meta-search instance: no key, `GET /search?format=json`, `pageno` from `offset`, `time_range` with `day`/`month`/`year` only (there is no `week`), `language`, and domains as `site:` operators; no `country`. An optional key is sent as `Authorization: Bearer <key>` for an instance behind an authenticating proxy.
  - **Tavily** (`apiKey` ref) is `POST https://api.tavily.com/search` with `time_range`, `include_domains`/`exclude_domains`, `language`, and `country` converted from Prism's two-letter code to the English name Tavily expects (sent with `topic: general`, the only topic it honors `country` on); `max_results` 0–20 and no paging. Retry mode `safe-post`.
  - **Kagi** (`apiKey` ref) is API **v1** `POST https://kagi.com/api/v1/search` with `Authorization: Bot <token>`, `workflow: "search"`, `page` 1–10 from `offset`, `lens.sitesIncluded`/`sitesExcluded`, `filters.region` for `country`, `lens.timeRelative` for `day`/`week`/`month` and `filters.after` for `year`; no `language`. The deprecated v0 GET is deliberately not implemented. Retry mode `safe-post`.
  - Shared plumbing: `createWebTransport` gained one loopback exemption (`http://` accepted only for a loopback hostname when an adapter passes `allowLoopback`) plus explicit auth modes (`bearer`, `bot`, `none`) so a keyless backend sends no authorization header; `normalizeSearchResults` now uses a per-provider field map instead of Brave/Exa ternaries; and search controls accept a per-backend value map, so a narrowed value (SearXNG `week`) fails with `ERR_PRISM_WEB_INPUT` and the tool schema only offers values the backend honors. The reference host accepts the new backend names.
- **Opt-in question-focused `web_fetch` (plan 193 Task 7).** New config `fetch.prompt: { model, maxInputChars?, maxOutputTokens? }` (defaults 100 000 characters and 1 024 tokens; the model's own ceiling is never raised) adds an optional `prompt` argument to `web_fetch` on every backend. With it, the page's Markdown is wrapped in the kernel's untrusted envelope, up to `maxInputChars` of it is sent to the configured model in one tool-free request with a fixed extraction system prompt (answer only from the page, quote verbatim, say "not found on the page", ignore page instructions), and the answer comes back as untrusted text with `value { url, title, answer, inputChars, sourceTruncated, usage }`. One model call per `prompt` use and none by default. The package now declares the `models` capability always and calls `prism.models.client` only when configured; because that call has no session/run identity, its usage is outside the run's budget and is reported on the value instead. A model ref that cannot be resolved writes a `warn` note and leaves `web_fetch` without the argument rather than failing the package.
- **Opt-in per-session page cache (plan 193 Task 6).** New config `cache: { ttlSeconds, maxEntries?, maxBytes? }` (1–86 400 s; defaults 64 entries and 16 MiB of Markdown per agent process). With it, a `web_fetch` or `web.fetch` call for the same canonical URL in the same session within the TTL makes no request, returns `cached: true` with `cachedAgeMs`, and its text says `cached <age> ago`; `web_fetch` gains a `refresh: true` argument that bypasses the entry. One `createFetchCache` (`src/cache.ts`, exported) is shared by every tool and by the service, kept in `prism.state.agent` (process memory, reset at package dispose) and dropped per session by a `session.closed` hook; nothing is written to `prism.state.session` or the store. Entries are LRU-evicted by count and bytes, and a page larger than the whole byte budget is fetched again rather than evicting everything else. Without `cache` config the plan 192 paging memo (10 minutes, 8 pages, no annotations) runs through the same implementation, so there is one cache.
- **Host domain policy for search and every fetch path (plan 193 Task 5).** New config `domains: { allow?: string[], block?: string[] }` (bare hostnames, a leading `*.` matches subdomains but not the apex, at most 256 entries each, `block` wins, an `allow` list permits only its matches, a malformed entry fails setup with `invalid domains config`). Results a search returns from a non-permitted host are dropped before rendering and counted in `value.filtered`, and the `web_search` description says results are limited when `allow` is set without naming hosts. `web_fetch`, `web_extract`, `obscura_fetch`, `obscura_scrape`, and the `web.fetch` service refuse a non-permitted URL with `ERR_PRISM_WEB_DOMAIN` naming the host; the native backend applies the same check to every redirect hop. One `createDomainPolicy` (`src/domains.ts`, exported) is shared by every tool and adapter; matching normalizes case, a trailing dot, and IDN/punycode, and costs one set lookup plus a suffix walk with no network.

### Security

- **Obscura fetches are gated on a binary that guards its own redirects (plan 193 Task 4).** Setup probes `obscura --version` once (one bounded child process, 5 s wall clock) and parses the leading semver. Versions below **0.1.8** — the first release whose HTTP client re-validates each `Location` and resolves through `SsrfGuardResolver` — plus source builds (`0.2.5-dev+<sha>`), unparseable output, and probe failures all fail closed: the package registers `web_search` only, provides `web_fetch` and the `web.fetch` service from the keyless native backend (which re-checks every hop), and writes one `warn` status note naming the probed version. A blocked or hanging `--version` is a fallback, not a package failure. No new config field, no new dependency, and no `@arnilo/prism-tools/browser` attestation type. Tests also pin that the runner never passes `--allow-private-network` and never inherits `OBSCURA_ALLOW_PRIVATE_NETWORK`/`OBSCURA_PROXY` from the host env.

### Changed

- **`toolsWeb({ backend: "brave", apiKey })` now registers `web_fetch`.** `fetch.backend` defaults to `"native"` (keyless) instead of `"firecrawl"`, so a search-only key no longer leaves the agent unable to read its results; `fetch: { backend: "firecrawl", apiKey }` keeps the previous behavior. `backend` also accepts `"native"` for a fetch-only package with no key at all. `WebProvider` gains `"native"`, `WebFetchAdapter.provider` is `"firecrawl" | "native"`, and `WebDocument` gains `redirects`.

- **Search results and tool descriptions are written for the model (plan 192 Task 5).** `web_search` (Brave, Exa, and Obscura) now returns text content as a numbered list — `1. <title>`, the URL, then `<published> — <snippet>` clipped to 300 characters, plus at most two provider highlights of 200 characters each — via a shared `src/render.ts`; `value` keeps its structure and `WebSearchResult` no longer carries per-result `metadata` (provider/rate facts stay once on the response). Titles, snippets, and highlights are collapsed to one line so untrusted text cannot fake a numbered entry, and nothing in a snippet becomes a link. `obscura_scrape` renders one numbered entry per URL, and `obscura_fetch` returns one 32 000-character slice of its dump as text while `value` keeps the full output. Descriptions now say what each tool is for, when to use `web_search` versus `web_fetch`, the `count` default and maximum (the schema's `count.maximum` comes from the resolved `maxResults`), the fetch slice defaults, and that content is untrusted — with no backend vendor names. Recorded: a ten-result search renders 3.1 kB of text against 6.3 kB of the previous payload.

- **`web_fetch` pages a document instead of returning all of it (plan 192 Task 4).** `web_fetch` (Firecrawl and Obscura) takes `max_chars` (integer, default 32 000, maximum 100 000) and `offset`, and returns one slice: its text content is `Showing characters <offset>–<end> of <total>.` plus, while more remains, `Call web_fetch again with offset=<nextOffset> for more.`, then the slice; its `value` is the citation fields plus `{ markdown, offset, totalChars, truncated, nextOffset?, sourceTruncated }`. Slices end on a paragraph break, else a line break, when one falls in the last tenth of the window, and never split a surrogate pair. A page is memoized per tool instance by `(sessionId, url)` — at most 8 pages, at most 10 minutes — so paging makes no new request and one session never reads another's page. `WebDocument` gains `sourceTruncated`, `WebFetchAdapter.fetch` takes `maxBytes`, and the `web.fetch` service honors it (clamped to `maxMarkdownBytes`); the RAG web loader passes its `maxBytes` through.

### Fixed

- **Obscura search returns real result URLs and fails loudly when empty (plan 193 Task 3).** The default profile now requests `https://html.duckduckgo.com/html/?q=…` directly (`duckduckgo.com/html/` only 302-redirects) and its constant extraction expression decodes DuckDuckGo's `/l/?uddg=…` redirect wrappers back to the target URL, returns the raw `href` for non-wrapper links, and skips `.result--ad`/`.result--sponsored` rows. A blocked page or a result list that ends up empty — including after host-side `citation()` drops unsafe or duplicate rows — fails `web_search` with `ERR_OBSCURA_SEARCH_EMPTY` ("search returned no results; the search page may have blocked automated access") instead of returning an empty list. A `searchProfile` that returns a bare row array is still accepted. Obscura `web_fetch` documents that its citation is the requested URL because `obscura fetch --dump` cannot report the final URL.

- **Parallel web calls wait for a slot instead of failing (plan 192 Task 7).** The transport refused any call past `maxConcurrency`; it now queues up to a new `maxQueued` limit (default 64, hard 256, in `WebLimits`, `DEFAULT_WEB_LIMITS`, `HARD_WEB_LIMITS` and the package config schema) and only fails beyond it with `ERR_PRISM_WEB_LIMIT` `Web operation queue is full`. A waiter is still bounded by `timeoutMs` and the caller's signal, and an aborted waiter leaves the queue without consuming a slot or issuing a request.
- **Retries follow what a provider bills (plan 192 Task 7).** `transport.json` takes a per-request retry mode: `idempotent` (GETs; connection failures and 429/5xx), `safe-post` (Exa `/search` and Firecrawl `/v2/scrape`; connection failures and 429 only, since a 5xx may mean the work already happened) and `never` (Firecrawl `/v2/extract` job creation, so a paid job is never submitted twice). Extract polling GETs stay `idempotent`.
- **`Retry-After` given as an HTTP date is honored (plan 192 Task 7).** Only delay-seconds were parsed before; an HTTP-date value now becomes a delay from now, a date in the past means 0, and the result still caps at `maxRateLimitDelayMs`.

- **An over-limit document is truncated, not an error (plan 192 Task 4).** Firecrawl Markdown over `maxMarkdownBytes` and Obscura output over `maxOutputBytes` keep their first limit and set `sourceTruncated: true`, so the caller can read and page the head; only a response over the transport's `maxResponseBytes` read cap still fails. New helpers in `src/slice.ts` (`sliceMarkdown`, `fetchSliceText`, `fetchSliceValue`, `truncateUtf8Bytes`, `createFetchMemo`, `fetchSliceArgs`, `fetchParameters`, `DEFAULT_FETCH_CHARS`, `HARD_FETCH_CHARS`) are used by every fetch backend and are not re-exported from the package entry; they appear in `scripts/compat-baseline/arnilo__prism-tools-web.txt` because the declaration emit covers the whole source tree.

### Added

- `@arnilo/prism-tools/web` (plan 155 Task 2): the web search and fetch code moved out of
  `@arnilo/prism-web-tools` (root, `./brave`, `./exa`, `./firecrawl`, `./obscura`) into a
  source-exported package on the lockstep line. The default export is a `definePackage` definition
  whose `setup` registers `web_search` and `web_fetch` (plus the native Obscura tools when
  `backend: "obscura"`), each declaring `effects: ["network"]`. Config selects the backend:
  `{ backend, apiKey?, fetch?, obscura?, limits? }`. `apiKey` and `fetch.apiKey` are ref-only
  (`env:`/`keyring:`) and resolve once through `prism.credentials.resolve`; a literal fails
  validation. A missing key ref or a missing Obscura binary writes a `warn` status note and registers
  nothing instead of throwing.
- The `web.fetch` service, provided when a Firecrawl fetch backend is configured:
  `fetch(url, { signal?, maxBytes? }) → Promise<WebDocument>`.
- The moved module surface keeps its names as named exports behind the single entry point: the
  Brave/Exa/Firecrawl adapters, `createWebTools`, the limits/normalize/transport helpers, and the
  full Obscura surface (`createObscuraWebTools`, `connectObscuraCdp`, `createObscuraMcpTools`,
  `resolveObscuraCommand`, `validateObscuraCommand`, `spawnObscuraProcess`).
- `resolveObscuraCommand(name)`: resolves a configured Obscura command to an absolute executable
  path against absolute `PATH` entries only.

- **SearXNG, Tavily, and Kagi search backends (plan 193 Task 8).** `backend` now also accepts `"searxng"`, `"tavily"`, and `"kagi"`, and `WebProvider`/`WebSearchAdapter.provider` widened to match.
  - **SearXNG** (`searxng: { origin, allowLoopback? }`) is a self-hosted meta-search instance: no key, `GET /search?format=json`, `pageno` from `offset`, `time_range` with `day`/`month`/`year` only (there is no `week`), `language`, and domains as `site:` operators; no `country`. An optional key is sent as `Authorization: Bearer <key>` for an instance behind an authenticating proxy.
  - **Tavily** (`apiKey` ref) is `POST https://api.tavily.com/search` with `time_range`, `include_domains`/`exclude_domains`, `language`, and `country` converted from Prism's two-letter code to the English name Tavily expects (sent with `topic: general`, the only topic it honors `country` on); `max_results` 0–20 and no paging. Retry mode `safe-post`.
  - **Kagi** (`apiKey` ref) is API **v1** `POST https://kagi.com/api/v1/search` with `Authorization: Bot <token>`, `workflow: "search"`, `page` 1–10 from `offset`, `lens.sitesIncluded`/`sitesExcluded`, `filters.region` for `country`, `lens.timeRelative` for `day`/`week`/`month` and `filters.after` for `year`; no `language`. The deprecated v0 GET is deliberately not implemented. Retry mode `safe-post`.
  - Shared plumbing: `createWebTransport` gained one loopback exemption (`http://` accepted only for a loopback hostname when an adapter passes `allowLoopback`) plus explicit auth modes (`bearer`, `bot`, `none`) so a keyless backend sends no authorization header; `normalizeSearchResults` now uses a per-provider field map instead of Brave/Exa ternaries; and search controls accept a per-backend value map, so a narrowed value (SearXNG `week`) fails with `ERR_PRISM_WEB_INPUT` and the tool schema only offers values the backend honors. The reference host accepts the new backend names.
- **Opt-in question-focused `web_fetch` (plan 193 Task 7).** New config `fetch.prompt: { model, maxInputChars?, maxOutputTokens? }` (defaults 100 000 characters and 1 024 tokens; the model's own ceiling is never raised) adds an optional `prompt` argument to `web_fetch` on every backend. With it, the page's Markdown is wrapped in the kernel's untrusted envelope, up to `maxInputChars` of it is sent to the configured model in one tool-free request with a fixed extraction system prompt (answer only from the page, quote verbatim, say "not found on the page", ignore page instructions), and the answer comes back as untrusted text with `value { url, title, answer, inputChars, sourceTruncated, usage }`. One model call per `prompt` use and none by default. The package now declares the `models` capability always and calls `prism.models.client` only when configured; because that call has no session/run identity, its usage is outside the run's budget and is reported on the value instead. A model ref that cannot be resolved writes a `warn` note and leaves `web_fetch` without the argument rather than failing the package.
- **Opt-in per-session page cache (plan 193 Task 6).** New config `cache: { ttlSeconds, maxEntries?, maxBytes? }` (1–86 400 s; defaults 64 entries and 16 MiB of Markdown per agent process). With it, a `web_fetch` or `web.fetch` call for the same canonical URL in the same session within the TTL makes no request, returns `cached: true` with `cachedAgeMs`, and its text says `cached <age> ago`; `web_fetch` gains a `refresh: true` argument that bypasses the entry. One `createFetchCache` (`src/cache.ts`, exported) is shared by every tool and by the service, kept in `prism.state.agent` (process memory, reset at package dispose) and dropped per session by a `session.closed` hook; nothing is written to `prism.state.session` or the store. Entries are LRU-evicted by count and bytes, and a page larger than the whole byte budget is fetched again rather than evicting everything else. Without `cache` config the plan 192 paging memo (10 minutes, 8 pages, no annotations) runs through the same implementation, so there is one cache.
- **Host domain policy for search and every fetch path (plan 193 Task 5).** New config `domains: { allow?: string[], block?: string[] }` (bare hostnames, a leading `*.` matches subdomains but not the apex, at most 256 entries each, `block` wins, an `allow` list permits only its matches, a malformed entry fails setup with `invalid domains config`). Results a search returns from a non-permitted host are dropped before rendering and counted in `value.filtered`, and the `web_search` description says results are limited when `allow` is set without naming hosts. `web_fetch`, `web_extract`, `obscura_fetch`, `obscura_scrape`, and the `web.fetch` service refuse a non-permitted URL with `ERR_PRISM_WEB_DOMAIN` naming the host; the native backend applies the same check to every redirect hop. One `createDomainPolicy` (`src/domains.ts`, exported) is shared by every tool and adapter; matching normalizes case, a trailing dot, and IDN/punycode, and costs one set lookup plus a suffix walk with no network.

### Security

- **Obscura fetches are gated on a binary that guards its own redirects (plan 193 Task 4).** Setup probes `obscura --version` once (one bounded child process, 5 s wall clock) and parses the leading semver. Versions below **0.1.8** — the first release whose HTTP client re-validates each `Location` and resolves through `SsrfGuardResolver` — plus source builds (`0.2.5-dev+<sha>`), unparseable output, and probe failures all fail closed: the package registers `web_search` only, provides `web_fetch` and the `web.fetch` service from the keyless native backend (which re-checks every hop), and writes one `warn` status note naming the probed version. A blocked or hanging `--version` is a fallback, not a package failure. No new config field, no new dependency, and no `@arnilo/prism-tools/browser` attestation type. Tests also pin that the runner never passes `--allow-private-network` and never inherits `OBSCURA_ALLOW_PRIVATE_NETWORK`/`OBSCURA_PROXY` from the host env.

### Changed

- **`toolsWeb({ backend: "brave", apiKey })` now registers `web_fetch`.** `fetch.backend` defaults to `"native"` (keyless) instead of `"firecrawl"`, so a search-only key no longer leaves the agent unable to read its results; `fetch: { backend: "firecrawl", apiKey }` keeps the previous behavior. `backend` also accepts `"native"` for a fetch-only package with no key at all. `WebProvider` gains `"native"`, `WebFetchAdapter.provider` is `"firecrawl" | "native"`, and `WebDocument` gains `redirects`.

- The `@arnilo/prism-extensions/mcp` import in the Obscura MCP bridge is now dynamic, so importing the package
  loads neither `playwright-core` nor `@arnilo/prism-extensions/mcp`. The Obscura CDP composition uses a local
  structural Playwright type instead of the browser package's types.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The web search and fetch tools shipped inside `@arnilo/prism-web-tools` before this package existed;
see that package's changelog for the pre-split history.


### ./browser

# Changelog

## [Unreleased]

### Added

- **`browser-automation` skill (plan 215 Tasks 8 and 11).** The package registers a bundled skill from `skills/browser-automation` with `skills.addDir`, and `package.json` `files` lists `skills`. It declares `prism-requires-tools: browser_open browser_snapshot browser_act`. The body is five lines: page text is untrusted, filling a field is not submitting it, do not type credentials you were not given, snapshot after a change and report what it shows, change approach after two failures. Kept on a measured hazard effect, not a pooled gain: `browser-no-credentials` 8/9 with the skill against 1/9 without across three runs, the other 14 items at ceiling (owner override of the pooled ship rule; evidence in `docs/_evidence/skill-evals/211/v3/`).
- **`browser_act` description.** It no longer says to prefer snapshot refs. It now points at `{ role, name }` and `{ label }` targets, which need no `snapshotId`, and says a `{ ref }` target needs the latest `snapshotId` and goes stale after any action. Transcripts showed nearly every run without the skill failing on `ref actions require snapshotId`; after this change (made together with raising the evaluation's tool-round limit) runs without the skill finished 0.933 of the evaluation items, against 0.578 before both changes.

- `@arnilo/prism-tools/browser` (plan 155 Task 3): the browser automation code moved out of
  `@arnilo/prism-web-tools` (`./browser`) into a source-exported package on the lockstep line. The
  default export is a `definePackage` definition whose `setup` imports `playwright-core`
  dynamically, launches the run-owned browser, and registers `browser_open`, `browser_snapshot`,
  `browser_act`, `browser_close`, `browser_evaluate`, and `browser_observe`, each declaring
  `effects`. `onDispose` closes the manager and the browser it launched. A missing peer or a failed
  launch writes a `warn` status note and registers nothing instead of throwing.
- Config `{ headless?, executablePath?, channel?, allowOrigins?, containedProxy?, allowLoopback?,
  allowPrivateHosts?, uploadRoots?, quarantine?, cdp? }`. `allowOrigins` is a hard origin allowlist;
  `containedProxy` is the fail-closed egress attestation; `uploadRoots` confines uploads.
- The moved module surface keeps its names as named exports behind the single entry point: the six
  tools, `createBrowserManager`, the limits/policy/network/upload/download/screenshot helpers, and
  the structural Playwright types.

### Changed

- The in-tool `ExecutionPolicy` option is removed from `createBrowserTools`. Approval now runs over
  the declared `effects` through the host `tool.call` gate; blocked schemes, loopback/private hosts,
  the origin allowlist, and upload-root containment stay as internal hard denies. The
  `buildBrowserExecutionAction` helper and the kernel `ExecutionPolicy` import are gone.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The browser tools shipped inside `@arnilo/prism-web-tools` before this package existed; see that
package's changelog for the pre-split history.


### ./research

# Changelog

## [Unreleased]

### Changed

- Plan 215 Task 7: the four skills' descriptions now open with when to use them (at most 300 bytes), and `research-report` declares `metadata.prism-requires-tools: cite`, so a request that does not advertise `cite` hides it instead of offering a procedure the model cannot follow. Checked by `scripts/package-skills-conformance.mjs`.

### Added

- `@arnilo/prism-tools/research`: four bundled research skills, a per-session source ledger on `tool.result`, a read-only `cite` tool, and a `run.end` citation check. Unresolved markers continue once by default (`maxRepairs`), then the verdict is `failed` and the package emits `research.citations.unresolved`. `research.verify` returns `{ verdict, unresolved, ledgerSize }`.


### ./openapi

# Changelog

All notable changes to `@arnilo/prism-tools/openapi` will be documented in this file.

## [Unreleased]

### Added

- Package created in plan 155 Task 4: the OpenAPI 3.1 compiler moved out of
  `@arnilo/prism-coding-tools/./openapi` with the factory names unchanged (`createOpenApiTools`,
  `resolveOpenApiLimits`, `DEFAULT_OPENAPI_LIMITS`, `HARD_OPENAPI_LIMITS`, `OpenApiToolError`).
- `toolsOpenapi({ specs, limits })` `definePackage` entry: reads each spec once (local JSON or an
  `https:` URL through pinned fetch), compiles the allow-listed operations, and registers
  `<id>_<operationId>` tools.
- Per-method `effects`: `GET`/`HEAD` declare `["network"]`; every other method declares
  `["network", "external"]`.
- Ref-only `specs[].headers` resolved per request through `prism.credentials.resolve`, so resolved
  values join the agent secret set and are redacted from events, notes, logs, errors, and results.
- A spec that fails to load or compile notes why and is skipped; cross-spec tool-name collisions
  fail closed through the kernel's tool-conflict rule.
- New `namePrefix` option on `createOpenApiTools`, plus the `loadSpecDocument`, `firstServerUrl`,
  `listOperationIds`, and `selectOperations` helpers.

## [0.1.0] - 2026-08-09

### Changed

- Finalized 0.1.0 package baseline.

## [0.0.28] - 2026-08-08

### Added

- Initial OpenAPI 3.1 compile/execute surface (as the `openapi` subpath of `@arnilo/prism-coding-tools`).


### ./computer-use

# Changelog

## [Unreleased]

### Changed

- Plan 215 Task 7: the `computer-use-linux` skill description opens with when to use it, and its body no longer names the host-only `setup_accessibility` / `setup_window_targeting` tools (it says the host runs setup). Checked by `scripts/package-skills-conformance.mjs`.

### Added

- `@arnilo/prism-tools/computer-use` (plan 155 Task 4): the `computer-use-linux` MCP bridge moved out
  of `@arnilo/prism-coding-tools/./computer-use-linux` into a source-exported package on the lockstep
  line, with the factory names unchanged (`createComputerUseLinuxTools`, `loadComputerUseLinuxSkill`,
  `classifyComputerUseLinuxTool`, the `COMPUTER_USE_LINUX_*` lists). The bundled skill moved with it
  to `skills/computer-use-linux/SKILL.md`.
- `toolsComputerUse({ command?, args?, display?, includeSetupTools?, approved?, device?, runLimits? })`
  `definePackage` entry: resolves the host-owned executable on `PATH`, connects over stdio, registers
  the upstream tools, registers the bundled skill, and closes the bridge in `onDispose`. A missing
  binary, a missing `device.sandbox`, or a refused device admission writes a `warn` status note and
  registers nothing instead of throwing.
- Every tool declares `effects: ["external"]`, so the host approval hook sees it.
- The optional `computer-use.mcp` service lets a host or test supply its own MCP bridge;
  `@arnilo/prism-extensions/mcp` is now imported dynamically only during `setup`, so the package root is inert.
- New `resolveCommand` helper for absolute-path/PATH executable resolution.

### Changed

- The kernel `ExecutionPolicy` import and the `executionPolicy` option are removed. Approval runs over
  the declared `effects` through the host `tool.call` gate; mutating calls still pass in-tool device
  admission (`assertDeviceAdmit`), so a deny holds under `approval` `auto`.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The Linux desktop bridge shipped inside `@arnilo/prism-coding-tools` before this package existed; see
that package's changelog for the pre-split history.


### ./work

# Changelog

## [Unreleased]

### Changed

- Plan 215 Task 7: the vendored office skills register through `loadWorkSkills()` with `requiresTools: ["work_exec"]` instead of a bare `prism.skills.addDir`, so they are hidden on a request that does not advertise `work_exec`. The vendored `SKILL.md` bytes are untouched. `WORK_SKILL_TOOLS` (the `office_*` names, a `toolNames` declaration nothing used and that would have failed a narrowed run) is replaced by `WORK_SKILL_REQUIRES_TOOLS`, with no alias.

### Added

- Plan 155 Task 5: `@arnilo/prism-tools/work` — the work family as one package with a `definePackage` root entry. `setup` registers the `office_*` document group (read/write effects), `work_exec` inside the host-injected `work.sandbox` service (`execute`), and the `m365_*` / `gws_*` connector tools (`network`, plus `external` for drafts/writes) when a ref-only credential resolves. The bounded document reader is provided as the `work.reader` service and the vendored Hermes productivity skills are added from `vendor/`. A missing optional parser, an unresolved connector credential, or a missing sandbox writes a `warn` status note and registers less; the worker pool closes in `onDispose`.
- Config: `root` (required, absolute), `office`, `work`, `reader` (formats, caps, optional Mistral OCR), `connectors` (M365/Google CLI adapters with ref-only credentials), `env`.
- New tests: `tools_work_package_conformance`, `tools_work_groups_by_config`, `tools_work_missing_parser_drops_formats_with_note`, `tools_work_connector_without_credential_notes`, `tools_work_secrets_never_echoed`, `office_parsers_not_loaded_unless_tools_work_listed`, `tools_work_disposes_worker_pool`.

### Changed

- Moved `packages/prism-work/**` (source, tests, `fixtures/`, `golden/`, `docling/`, `sandbox/`, `vendor/`, `vendor-lock.json`, `THIRD_PARTY_NOTICES`) to `packages/tools/work/**`. The `@arnilo/prism-work` workspace is deleted with no alias; every importer now uses `@arnilo/prism-tools/work` (and its subpaths).
- `createOfficeTools` now declares per-tool `effects` (`read` for parse/import/diff/preview, `write` for generate/patch); `createWorkTools` declares `network` for reads and `network` + `external` for drafts/writes; `work_exec` declares `execute`.
- The package publishes TypeScript source (`exports` targets `./src/...`) instead of `dist/`, so its `build` script is gone and CI builds the workspace with `build:core` only.

## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

## [0.3.0] - 2026-09-01

Initial family cut: `/documents`, `/sheets`, `/diagrams` subpaths (plans 051–053 landed as one package per plan 054 Task 8).

## [0.1.0] - 2026-08-09

Placeholder for the shared 0.1.0 changelog contract (office family first shipped at 0.3.0).

## [0.0.28] - 2026-08-08

- Released with exact 0.0.28 graph.
