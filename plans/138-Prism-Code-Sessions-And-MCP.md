# Prism Code: Session Storage, Resume, and MCP Tools

## Objectives

- Store sessions under the user home (`~/.prism/sessions/`) instead of polluting every repository. Keep them repo-scoped by canonical git root, and make resume work from the CLI and the TUI with faithful history.
- Make MCP servers reliable for daily use:
  - One failing server degrades gracefully instead of aborting startup.
  - Servers connect in parallel with timeouts.
  - HTTP servers can authenticate (headers from env/credential refs, or OAuth).
  - Allow policy is enforced on every surface.
  - `/mcp` shows status and can reconnect.
  - Repo-defined servers need explicit trust before they spawn processes.

## Expected Outcome

- `prism-code --session <id>` opens that session in the TUI with full history; `prism-code --continue` resumes the most recent session for the current repo; `/resume` shows sessions with human-readable titles.
- Session history renders tool calls with their real status (success/error/denied), tool output (collapsed), and thinking blocks, using the same reducer as live events.
- No `.prism/` directory is created inside the repository by default.
- A config with one broken MCP server still starts. The footer shows `MCP 2/3`, `/mcp` lists the failed server with a redacted error, and `/mcp reconnect <id>` recovers it after the fix.
- HTTP MCP servers with `headers: { "Authorization": "Bearer ${env:GITHUB_TOKEN}" }` or `auth: "oauth"` connect; OAuth tokens are stored in the plan 136 credential store.
- Opening a cloned repo whose `prism-code.json` declares stdio MCP servers prompts once ("This repo wants to run: `npx foo-mcp` …") before any process is spawned.
- Docs updated: `docs/prism-code.md`, `docs/agent-sdk.md`, `docs/mcp-tools.md` (if SDK/MCP surfaces change), `docs/index.md`.
- Depends on: plan 136 (home, credentials), plan 137 Task 8 (approval policy covers MCP tools).

## Tasks

- [x] Task 1 (P0 prerequisite): Primitive review for session store listing/metadata and the MCP plane
  - Completed 2026-09-28: record written to `docs/history/138-primitive-review.md`. Verdict: gaps (a) resilient MCP plane (parallel connect, per-server status, reconnect, host allow-list) and (b) SDK `headers`/`auth`/`connectTimeoutMs` fields both owned by `@arnilo/prism-agent-sdk`; gap (c) session title/count convention owned by `@arnilo/prism` with the merge-safe metadata write in `@arnilo/prism-core`; last activity stays `prism_sessions.updated_at`. Two extra findings for Task 3: `formatHistoricalEntries` is the only history path (no `kind: "event"` entries are persisted; tool status must be reconstructed from `tool_call`/`tool_result` message blocks), and `tuiReducer`'s `tool_execution_finished` handler reads `event.runId` instead of `event.result.toolCallId`.
  - Acceptance Criteria:
    - Functional: the record `docs/history/138-primitive-review.md` covers:
      - session side: `createSqlitePersistence`, `SessionStore` list/search/metadata APIs, `ensureDurableSessionRecord`, `searchRepoSessions`, `getCanonicalWorkspaceRoot` (`packages/prism-code/src/sessions.ts`), and how `SessionEntry` stores tool results, errors, and thinking;
      - MCP side: `assembleMcpPlane` and allow validation (`packages/agent-sdk/src/planes/mcp.ts`), `connectMcpTools`/`McpToolBridge` (reconnect/close support), `McpStreamableHttpTransport.requestInit`/`auth` (`packages/mcp/src/types.ts:43-57`), `createMcpClientAuth` (`packages/mcp/src/auth.ts:456`), and the prism-code MCP config parser (`packages/prism-code/src/config.ts:479-527`: URL servers default to `allow: "stdio"`, unknown server fields silently dropped).
    - Functional: decides the generic gaps. Expected: (a) per-server status results + parallel connect + timeout in the agent-sdk plane; (b) SDK spec fields for `headers`/`auth`; (c) a session title/last-activity metadata convention. Each gap names its owning package.
    - Performance: none (review only).
    - Code Quality: app-only concerns (trust prompt, `/mcp` UI) stay in prism-code.
    - Security: the record states the trust model for repo-declared MCP servers and header secret sources.
  - Approach:
    - Documentation Reviewed:
      - `docs/mcp-tools.md`, `docs/agent-sdk.md` (MCP plane), `docs/prism-code.md` (Sessions), files listed above
    - Options Considered:
      - Implement resilience only in prism-code by wrapping the plane. Rejected: every SDK host needs graceful MCP degradation.
    - Chosen Approach: primitive-first review.
    - API Notes and Examples:
      ```ts
      const plane = await assembleMcpPlane({ servers }); // today: throws on the first failing server
      ```
    - Files to Create/Edit:
      - `docs/history/138-primitive-review.md`
    - References:
      - Analysis sections 6 and 7
  - Test Cases to Write:
    - none — review only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/138-primitive-review.md` (history archive).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Session storage under `~/.prism/sessions`, keyed by canonical repo root
  - Completed 2026-09-28:
    - `packages/prism-code/src/sessions.ts`: `resolveSessionDbPath(config, home)` (default `~/.prism/sessions/sessions.db`, `store.path` override, `:memory:`), `prepareSessionDbPath` (`0700` dir, `ensureHomeDir` when inside home), git-root canonicalization in `getCanonicalWorkspaceRoot` (`git rev-parse --show-toplevel`, fallback real `cwd`), and `legacySessionDbNotice` (one-line notice, no migration).
    - `packages/prism-code/src/config.ts`: `{ "type": "sqlite" }` now valid without `path`.
    - `packages/prism-code/src/acp.ts`, `headless.ts`, `bin/prism-code.ts`, `index.ts`: one resolver used by TUI/headless/ACP; ACP gained `home`; bin prints the legacy notice (stderr, or a TUI system note) and passes `home` to ACP. WAL/`busy_timeout`/`0600` come from the existing `createSqlitePersistence` defaults.
    - Tests: `sessions.test.ts` (path default/override, shared store + modes, git-subdirectory scoping, legacy untouched + notice, concurrent-writer wait), `config.test.ts` (sqlite without path), `acp.test.ts` (ACP default store under home), `headless.test.ts` (bin warns once and leaves the legacy file). `packages/prism-code/bunfig.toml` preload isolates `PRISM_HOME` per test process so default-store tests never touch the real home.
    - Docs: `docs/prism-code.md` (home tree, config table, Sessions), `packages/prism-code/README.md`.
    - Checks: `bun run --cwd packages/prism-code typecheck`, build, and the full package suite (260 pass) green; `bunx biome check packages/prism-code/src packages/prism-code/bin` clean.
  - Acceptance Criteria:
    - Functional: the default durable store is `~/.prism/sessions/sessions.db` (SQLite, WAL), shared by all repos and scoped by the canonical git root (realpath of `git rev-parse --show-toplevel`, fallback realpath of `cwd`) recorded in session metadata. The `store` config gains `path` for an explicit override; `store: "memory"` is unchanged.
    - Functional: a legacy `<cwd>/.prism/sessions.db` is not migrated. If one exists, a one-line notice tells the user where sessions now live and that the old file can be deleted. The ACP surface uses the same default (`acp.ts:190`).
    - Functional: concurrent Prism Code processes on different repos (or the same repo) can use the database simultaneously without `SQLITE_BUSY` failures (busy timeout configured).
    - Performance: session listing for a repo uses the indexed metadata query (no full scan beyond the store's existing search); startup opens the database once.
    - Code Quality: one `resolveSessionDbPath(config, home)` used by TUI/headless/ACP.
    - Security: the database file is `0600` and its directory `0700`; session content never leaves `~/.prism` unless `store.path` says so.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/sessions/sqlite/{persistence,migrations,types}.ts` (`bun:sqlite`), `packages/prism-code/src/sessions.ts:20-70`, `packages/prism-code/src/acp.ts:185-195`
      - Bun `bun:sqlite` docs (`Database`, `PRAGMA busy_timeout`, WAL)
    - Options Considered:
      - One database per repo under `~/.prism/sessions/<hash>.db`. Rejected: more files, and it makes cross-repo "recent sessions" impossible; repo scoping by metadata already exists.
      - Keep `<repo>/.prism/` and auto-add it to `.gitignore`. Rejected: writes to user repos.
    - Chosen Approach: one global database with repo-scoped metadata.
    - API Notes and Examples:
      ```ts
      const db = resolveSessionDbPath(config, home); // ~/.prism/sessions/sessions.db
      const persistence = createSqlitePersistence({ path: db });
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/sessions.ts`: `resolveSessionDbPath`, git-root canonicalization, busy timeout
      - `packages/prism-code/src/{acp,headless,config}.ts`: use the resolver, `store.path`
      - `packages/prism-code/src/__tests__/sessions.test.ts`
    - References:
      - Analysis finding: default store at `<cwd>/.prism/sessions.db`
  - Test Cases to Write:
    - Two repos share one database; `/resume` in each lists only its own sessions.
    - Launching from a repo subdirectory scopes to the git root.
    - Legacy database present → notice shown once, database untouched.
    - Two processes writing concurrently both succeed.
    - File modes are `0600`/`0700`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — session storage location and the `store.path` key.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: update the "Sessions" section
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Resume from the CLI and TUI with titles and faithful history
  - Completed 2026-09-28:
    - CLI/TUI: `--session <id>` now reaches `createPrismCodeTui`; `--continue` resolves the newest session for the canonical repo root; `--resume` opens the picker at startup (`openResumePicker`). All three are mutually exclusive and TUI/headless-appropriate; an unknown id exits 1 before any session record exists (headless had no unknown-id check before). The startup store is resolved once in `bin/prism-code.ts` and handed to the TUI.
    - Titles: `SESSION_TITLE_METADATA_KEY`/`SESSION_TITLE_MAX_LENGTH` in `@arnilo/prism`; `mergeSessionMetadata` (atomic `json_set`, version bump, no `updated_at` bump, `onlyIfMissing`) on SQLite persistence; `deriveSessionTitle`/`setSessionTitle` in prism-code. Headless and TUI set the first-prompt title (`onlyIfUnset`), `/rename <title>` replaces it. `safeSearchMetadata` now passes `title` through and `SessionSearchHit.messageCount` comes from the existing search query; `/resume` shows title, relative time, and message count.
    - History: new `packages/prism-code/src/tui/history.ts` (`sessionEntryToUiActions` + `entriesToUiEntries`) replays stored entries through `tuiReducer`; `formatHistoricalEntries` (and its root export) removed. Tool results map to success/failure/denied (denial via `tool_denied`/`permission_denied` code or a bounded message match), thinking blocks render collapsed (new `UiThinkingEntry`, also fed by live `message_delta` thinking), compaction notes carry the summary, and `tool_execution_finished` now keys on `event.result.toolCallId` (live-render bug fixed). Resume adopts the last `model_change` model when its provider is still shipped.
    - `wrapSessionDisabled` already used `Object.create(session)` (prototype preserved); no change was needed — the plan's spread concern was stale.
    - Tests: new `resume.test.ts` (title derivation/persistence/rename, continue resolution + missing ids, relative time, real/denied tool status replay, 5k-entry replay under 300 ms, TUI resume + model restore + same-session append + `/rename`, `--resume` picker) plus headless title assertion, unknown-id/`--continue`-empty bin checks, and seeded records for the existing resume/SIGTERM tests. Core: `mergeSessionMetadata`, title-in-hit metadata, and `messageCount` tests in `sqlite-persistence.test.ts`.
    - Checks: root + prism-core + prism-code builds/typechecks green; sqlite suite 29 pass; prism-core suite 734 pass; prism-code suite 268 pass; `biome check` clean; `live-doc-check` green.
    - Deviations: history rendering stays within the existing `maxScrollback` cap (bounded last-N replay) instead of virtualizing older entries — 5k entries replay in ~44 ms; compat baselines (`formatHistoricalEntries` removal + additive option/type changes) and the CHANGELOG migration note are regenerated at the plan's release step with Task 4's baseline update.
    - Docs: `docs/prism-code.md` (flags table, Sessions, slash commands, public surface), `packages/prism-code/README.md`.
  - Acceptance Criteria:
    - Functional: `--session <id>` is passed to `createPrismCodeTui` (`bin/prism-code.ts:98`; today it only reaches headless). `--continue` resumes the most recent session for the repo; `--resume` opens the `/resume` picker at startup. An unknown id errors clearly and does not create an empty session.
    - Functional: sessions get a title from the first user prompt (first line, ≤ 80 chars, stored in session metadata at the first run) plus a last-activity timestamp. `/resume` shows title, relative time, and message count, sorted by recency, and is searchable. `/rename <title>` updates the title.
    - Functional: history rendering replays stored entries through the live reducer (not `formatHistoricalEntries`' success-only path). Tool calls show their real status (success/error/denied), results are collapsed, thinking blocks are rendered collapsed, and compaction entries show as system notes. The resumed session keeps the model selection from its last run when the model is still available.
    - Functional: `wrapSessionDisabled` no longer spreads a class instance (prototype methods are preserved).
    - Performance: resuming a 5k-entry session renders the last screen within 300 ms; older entries are virtualized or lazily rendered (ScrollBox content added in chunks).
    - Code Quality: one "entries → UI events" adapter shared by resume and live rendering.
    - Security: resumed history goes through the same redaction as live events; the title is derived after redaction.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/tui/index.ts:47,210-280` (`formatHistoricalEntries`, initial entries), `src/tui/reducer.ts`, `packages/prism-code/bin/prism-code.ts:90-125`, `src/contracts-core/session.ts` (`SessionEntry` kinds)
    - Options Considered:
      - Keep a separate history formatter. Rejected: it drifts from live rendering (the root cause of the success-only history).
    - Chosen Approach: synthesize UI events from entries and feed the live reducer.
    - API Notes and Examples:
      ```ts
      for (const event of entriesToUiEvents(snapshot.entries)) state = reduce(state, event);
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/history.ts`: new `entriesToUiEvents`
      - `packages/prism-code/src/tui/index.ts`: use it; remove `formatHistoricalEntries`
      - `packages/prism-code/src/{flags,sessions}.ts`, `bin/prism-code.ts`: `--continue`, `--resume`, titles, `/rename`
      - `packages/prism-code/src/tui/commands.ts`: `/resume` presentation, `/rename`
      - `packages/prism-code/src/__tests__/resume.test.ts`
    - References:
      - Analysis findings: `--session` not passed to the TUI, history always success, `wrapSessionDisabled` spread
  - Test Cases to Write:
    - `--session <id>` in the TUI shows prior messages; an unknown id exits 1.
    - `--continue` picks the most recent repo session.
    - A failed tool call in history renders as an error after resume.
    - Title derived from the first prompt; `/rename` persists.
    - Resumed run continues the same session id and appends entries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new flags `--continue`/`--resume`, `/rename`, titles.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: CLI table and "Sessions" section
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Resilient MCP plane in the Agent SDK
  - Completed 2026-09-28:
  - Acceptance Criteria:
    - Functional: `assembleMcpPlane` connects servers in parallel, each with a timeout (`connectTimeoutMs`, default 15 s). It returns per-server status `{ serverId, state: "connected" | "failed" | "disabled", toolCount, error? }` instead of throwing on the first failure. Config validation errors (bad allow spec) still fail closed at assembly, but connection failures do not.
    - Functional: the assembled plane exposes `reconnect(serverId)` and `close()`; tools of a reconnected server are re-bridged, and the agent's tool registry sees the updated set on the next run (via a tool source/`activeTools` update rather than rebuilding the agent).
    - Functional: `mcp.allow` (host allow-list) is enforced for every surface, not only ACP server selection: a configured server outside the host allow-list is `disabled` with a reason.
    - Functional: SDK server specs gain `headers?: Record<string, string>` (HTTP), `auth?: McpClientAuthOptions` (OAuth via `@arnilo/prism-mcp`), and `connectTimeoutMs?`.
    - Performance: startup wall time for N servers ≈ the slowest server (parallel), bounded by the timeout; no startup blocking beyond `connectTimeoutMs`.
    - Code Quality: status is a typed discriminated union; errors are `AgentSdkConfigError` for config and a redacted `McpConnectError` for runtime.
    - Security: header values and OAuth tokens are redacted from status errors and logs; `allowedOrigins` still pins HTTP destinations; stdio env is not inherited beyond what the spec lists plus the existing safe defaults. Plan the compat-baseline regeneration (`node scripts/release.mjs gate --update-baseline`, `scripts/compat-baseline/*`) since the `assembleMcpPlane` return shape changes (additive fields; the throw-on-failure behavior change is recorded in `CHANGELOG.md`). Grep `scripts/`, `examples/`, and every workspace for callers relying on the old throw-on-connect-failure contract.
  - Approach:
    - Documentation Reviewed:
      - `packages/agent-sdk/src/planes/mcp.ts`, `packages/mcp/src/{bridge,transport,auth,types}.ts`, `docs/mcp-tools.md`, `docs/agent-sdk.md`
    - Options Considered:
      - Skip failed servers silently. Rejected: users need to see why tools are missing.
      - Keep the sequential connect. Rejected: slow startup with several servers.
    - Chosen Approach: `Promise.allSettled` with per-server timeouts and typed status; reconnect via the bridge.
    - API Notes and Examples:
      ```ts
      const plane = await assembleMcpPlane({ servers, connectTimeoutMs: 15_000 });
      plane.status; // [{ serverId: "github", state: "failed", error: "401 Unauthorized" }, ...]
      await plane.reconnect("github");
      ```
    - Files to Create/Edit:
      - `packages/agent-sdk/src/planes/mcp.ts`: parallel connect, status, reconnect, headers/auth, allow enforcement
      - `packages/agent-sdk/src/{define-agent,config}.ts`: surface status; JSON config fields
      - `packages/agent-sdk/src/__tests__/mcp-plane.test.ts`
      - `scripts/compat-baseline/*` via `node scripts/release.mjs gate --update-baseline`; record the gate diff
      - `CHANGELOG.md`: behavior change note
    - References:
      - Analysis section 6
  - Test Cases to Write:
    - One of three servers fails → plane assembled, status lists the failure, other tools usable.
    - A hanging server times out at `connectTimeoutMs` and the other servers still connect.
    - `reconnect` after the fix exposes the tools on the next run.
    - A host allow-list excludes a server → `disabled`.
    - Header values never appear in status errors.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — MCP plane return shape, new spec fields, failure semantics.
    - Docs pages to create/edit:
      - `docs/agent-sdk.md`: MCP plane status/reconnect/headers/auth
      - `docs/mcp-tools.md`: link to SDK usage if needed
    - `docs/index.md` update: yes — Agent SDK entry mentions resilient MCP.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completed 2026-09-28:
    - Plane (`packages/agent-sdk/src/planes/mcp.ts`): config validation (allow spec per server, `connectTimeoutMs`, duplicate server ids) still fails closed with `AgentSdkConfigError` before any connect; allowed servers then connect in parallel. Each connect races the connector against an `AbortController` + timer (`DEFAULT_MCP_CONNECT_TIMEOUT_MS` 15 s, cap 10 min) and passes `signal` through to `@arnilo/prism-mcp`; a bridge that resolves after expiry is closed. Failures become per-server `McpServerStatus { serverId, state: "connected" | "failed" | "disabled", toolCount, error?, reason? }` instead of aborting startup; host `mcp.allow` entries are parsed with `parseAllowDestination` and excluded servers are `disabled` with a reason. The assembled plane exposes live `bridges`/`tools`/`connectedServerIds`/`status` getters plus `getServerTools(serverId)`, `reconnect(serverId)`, and an idempotent `close()` (reconnect after close throws).
    - Specs: `connectTimeoutMs?` on every `McpServerSpec`; `headers?: Record<string, string>` and `auth?: McpClientAuthOptions` on `McpHttpServerSpec`, mapped by `buildConnectOptions` onto the streamable-http transport (`requestInit.headers` only when non-empty, `auth` passed through; `allowedOrigins` still defaults to the parsed origin).
    - Errors/redaction: new `McpConnectError` (`code ERR_PRISM_MCP_CONNECT`, `serverId`) thrown by `reconnect`; `redactMcpError` strips every spec/`requestInit` header value (`Headers`, tuple array, or record), masks `Bearer …`/`token=`/`secret=`/`password=`/`api_key=` shapes, and caps at 512 chars. `status.error` stores the redacted string.
    - Definition/config: `AgentSdkDefinition` gained a live `mcp` handle and `connectedMcpServerIds` became a getter over the plane. `defineAgent` tracks each server's bridged tool names and, on reconnect, calls the new optional `ToolRegistry.unregister(name)` for the previous names before registering the new set, so the next run sees the update without rebuilding the agent. JSON config: `mcp.allow`, top-level `mcp.connectTimeoutMs`, and server `headers`/`connectTimeoutMs` are known keys; `auth` stays host-wired and is rejected as unknown (not JSON-serializable).
    - Tests: new `packages/agent-sdk/src/__tests__/mcp-plane.test.ts` (10 cases: partial failure, timeout under 2 s wall clock, disabled-by-allow-list, fail-closed malformed allow/timeout, header redaction in status and reconnect errors, reconnect re-registering tools with exactly one close, recovery, unknown/disabled id rejection + idempotent close, `buildConnectOptions` header/auth/origin mapping, JSON config acceptance/rejection). agent-sdk suite 70 pass / 0 fail.
    - Checks (all nine `run-all-tests` stages green, run individually): build; budget gate 19 pass; root suites 2147 pass; sqlite 31 pass; gate suites 313 (311 pass, 2 skip); build race 12 pass; workspace suites all green (prism-core 818, prism-code 268, agent-sdk 70, providers 751, memory 515, coding-tools 666, work 277, …); examples 2 pass; branch coverage 86.38 (floor met). `biome lint .` clean (fixed an optional-chain warning and a useless-ternary info from Task 3).
    - Budget/evidence/compat: root export-surface budget 1475 → 1477 for the two Task 3 session-title constants (reason recorded in `scripts/budgets.json`); the root suite's export-surface snapshot updated; `bun scripts/package-truth.mjs --emit-docs` regenerated `docs/_evidence/phase54-package-map.md` (now includes the agent-sdk/prism-code rows) and `docs/index.md` counts; `bun scripts/release.mjs gate --update-baseline` regenerated `scripts/compat-baseline/*` — tracked diff: `@arnilo/prism` +3, prism-core +14, coding-tools +29, prism-work +24 (the larger ones capture pre-existing plan 136/137 surfaces, not Task 4), with agent-sdk/prism-code baselines new; plain `gate` re-run clean. Because the gate suites fail on a stale baseline, the regeneration happened at Task 4 close rather than the plan's release step; re-run it if Task 5/6 change surfaces.
    - Docs: `docs/agent-sdk.md` (MCP lifecycle/status/reconnect/headers/auth, corrected stale JSON allow example and default-deny bullet), `docs/mcp-tools.md` (client-side SDK usage/auth pointer), `docs/index.md` (Agent SDK entry + current-line bullet), `CHANGELOG.md` (new `Unreleased` section covering Task 3/4 behavior changes).
    - Grep check: only agent-sdk internals + tests pass an MCP `connector`; prism-code still forwards `config.mcp` wholesale, and no caller relied on the old throw-on-connect-failure contract.

- [x] Task 5: Prism Code MCP config: auth, global servers, and repo trust
  - Completed 2026-09-28:
    - Config parser (`packages/prism-code/src/config.ts`): new `PrismCodeMcpServer` declaration type. Unknown server keys, `command`+`url` conflicts, missing command/url, mis-placed fields (`headers`/`auth` on stdio, command/url fields on HTTP), invalid `transport`, non-positive `connectTimeoutMs`, non-`"oauth"` `auth`, and malformed `${...}` references all fail closed instead of being silently dropped. `allow` defaults to `stdio` for commands and to the URL origin for endpoints. New fields: `headers`, `auth`, `connectTimeoutMs`, `enabled`. Literal header values for sensitive names (`Authorization`, `Cookie`, `X-API-Key`, …) are rejected in project configs but allowed in the global one; `mcpServerOrigins(layers)` records the winning layer per `serverId` (last writer wins).
    - New `packages/prism-code/src/mcp.ts`: `parseMcpHeaderReference`/`resolveMcpHeaderValue` resolve embedded `${env:NAME}`/`${credential:NAME}` tokens (the latter via the credential manager's API-key lookup); `mcpServerFingerprint` hashes URL or command + args + env keys; `readMcpTrust`/`writeMcpTrustDecision`/`isMcpServerTrusted` own `~/.prism/trust.json` (0600, temp-file + rename, corrupt file = untrusted + notice); `resolveMcpServers` applies the trust gate (global trusted; project = existing fingerprint, TUI prompt on demand, `allow` for `--trust-project-mcp`, otherwise `skip`), keeps skipped/disabled/failed declarations in the plane list as `disabledReason`/`preflightError` stubs, and reports notes. `createMcpAuthState` implements `McpClientAuthState` over the credential slot `mcp:<serverId>` (all chunks in `OAuthCredentials.metadata`, access/refresh mirrored); `createMcpAuthOptions` builds the DCR strategy + redirect URI (`MCP_OAUTH_REDIRECT_URI`, env-overridable).
    - `@arnilo/prism-agent-sdk` `planes/mcp.ts`: specs gained `disabledReason` (reported `disabled`, never allow-validated or connected) and `preflightError` (reported `failed`), so host skips surface as status rather than silently missing tools.
    - Wiring: `AppHostBindings.mcpTrust` + `HeadlessOptions.mcpTrust`; `assembleAppAgent` resolves declarations once (canonical workspace root) and forwards notes; `runHeadless` writes notes to stderr; `--trust-project-mcp` parsed in `flags.ts` and shown in help; `bin/prism-code.ts` builds the layer-origin map and passes prompt/skip/allow contexts to the TUI, headless, and (unchanged) ACP surfaces; new `PrismCodeTui.promptMcpTrust` uses the picker and returns false on Esc. ACP still never sees project-config servers (it only filters client-supplied servers through `mcp.allow`).
    - Tests: new `packages/prism-code/src/__tests__/mcp-config.test.ts` (14 cases: URL-allow default, strict server schema, global-vs-project literal headers, layer origins, embedded reference resolution, headless skip, prompt + fingerprint persistence/re-prompt, run-level allow, `enabled:false`, missing env preflight, credential refs, auth-state round trip + `clear`, full mocked OAuth login storing under `mcp:linear` then authorizing from the store, fingerprint stability); agent-sdk `mcp-plane.test.ts` gained the disabled/preflight test. Suites: prism-code 282 pass, agent-sdk 71 pass, mcp 106 pass.
    - Docs: `docs/prism-code.md` (CLI flag, home tree `trust.json`, `mcp` config row, new "MCP servers" section with fields/references/trust + JSON example, extension/security notes, public-surface list), `docs/agent-sdk.md` (host policy stubs bullet), `packages/prism-code/README.md`; `CHANGELOG.md` Unreleased Added/Changed entries. `docs/index.md` needed no entry (basic regenerated counts only).
    - Checks: `bun run build` all workspaces; prism-code typecheck; `biome lint .` zero diagnostics; `live-doc-check` 6/6; gate suites 313 (311 pass / 2 skip); root suites 2147 pass; `release.mjs gate --update-baseline` regenerated compat baselines (plain `gate` clean); `package-truth --emit-docs` regenerated the phase-54 evidence (prism-code now 276 exported names).
    - Notes/deviations: `@arnilo/prism-mcp` was added to prism-code dependencies (auth state types + `createMcpClientAuth` for the mocked login test); the plane connects with stored tokens and fails closed with "OAuth authorization required" when none exist — Task 6's `/mcp login <id>` will drive `onRedirectRequired`/`finishAuth`. After `bun install` added the dependency, the generated `packages/*/node_modules` hardlink trees were removed (they shadow root `dist` during package typechecks); the lockfile keeps the dependency.

  - Acceptance Criteria:
    - Functional: the config parser stops silently dropping fields and rejects unknown server keys. URL servers default `allow` to the URL's origin (not `"stdio"`). New server fields:
      - `headers` (values may be literal non-secret text or `${env:NAME}` / `${credential:NAME}` references resolved at connect time);
      - `auth: "oauth"` (tokens persisted in the plan 136 credential store under `mcp:<serverId>`);
      - `connectTimeoutMs`, `enabled`.
    - Functional: servers from `~/.prism/config.json` and the project config are merged by `serverId` (plan 136 Task 2 layering).
    - Functional: repo trust gate: before spawning any stdio server or connecting any HTTP server declared in a project config, the TUI asks once per repo and per server fingerprint (command + args + env keys, or URL). The answer is stored in `~/.prism/trust.json`; a changed fingerprint re-prompts. Headless/ACP skip untrusted project servers with a status reason unless `--trust-project-mcp` is passed. Global-config servers are trusted.
    - Performance: trust lookup is a single file read at startup.
    - Code Quality: the reference resolver is a small pure function with tests; there are no `as any` casts in the MCP config parsing (`config.ts:499`).
    - Security: literal secrets are allowed in headers only in the global config (the project config must use references), so a committed repo config cannot carry tokens; resolved values are redacted everywhere; the trust file is `0600`.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/config.ts:479-527`, `packages/mcp/src/auth.ts` (`McpClientAuthOptions`, `createMcpClientAuth`), plan 136 Tasks 2–3
    - Options Considered:
      - Trust all project servers (current). Rejected: cloning a repo and launching the TUI would run arbitrary commands.
      - Disallow project MCP servers entirely. Rejected: team-shared server config is valuable; a one-time trust prompt is the common pattern.
    - Chosen Approach: fingerprinted per-repo trust + reference-only secrets in project config.
    - API Notes and Examples:
      ```json
      { "mcp": { "servers": [
        { "serverId": "github", "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer ${env:GITHUB_TOKEN}" } },
        { "serverId": "linear", "url": "https://mcp.linear.app/mcp", "auth": "oauth" },
        { "serverId": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
      ] } }
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/config.ts`: server schema
      - `packages/prism-code/src/mcp.ts`: new — reference resolution, trust store, OAuth token persistence, plane options
      - `packages/prism-code/src/{headless,acp,flags}.ts`, `src/tui/index.ts`: trust prompt, `--trust-project-mcp`
      - `packages/prism-code/src/__tests__/mcp-config.test.ts`
    - References:
      - Analysis section 6
  - Test Cases to Write:
    - A URL server defaults `allow` to its origin; an unknown server key fails.
    - `${env:X}` resolves at connect; a missing env produces a `failed` status with a clear reason.
    - A project config with a literal `Authorization` header is rejected.
    - First launch prompts for trust; the second launch doesn't; a changed args list re-prompts.
    - Headless skips untrusted project servers unless the flag is set.
    - OAuth server: login flow stores tokens under `mcp:<id>` (mocked auth server).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — MCP config schema, trust prompt, new flag.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "MCP servers" section (fields, references, trust)
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: `/mcp` command, footer status, and live MCP verification
  - Completed 2026-09-28:
    - `/mcp` command family (`packages/prism-code/src/tui/commands.ts`): bare `/mcp` renders the cached plane status (`state`, tool count, transport, redacted error/reason) with no network calls; `/mcp tools <id>` lists bridged tool names + descriptions; `/mcp reconnect <id>` schedules the reconnect in the background (returns immediately, reports the result and refreshes the footer when done); `/mcp login <id>` runs the OAuth round trip for an `auth: "oauth"` URL server — builds `createMcpAuthOptions` with `onRedirectRequired`, opens the authorization URL, prompts for the pasted callback URL or bare code, calls `finishAuth`, then reconnects; `/mcp disable|enable <id>` unregister/restore that server's tools for the session only via a host `McpSessionControl` adapter. Help text updated.
    - Footer (`tui/components/status.ts`, `tui/reducer.ts`, `tui/index.ts`): new `formatMcpStatus` renders `MCP: connected/total (n failed)`; `UiFooterStatus` gained optional `mcpTotalCount`/`mcpFailedCount`; `PrismCodeTui.refreshMcpFooter()` recomputes counts from `definition.mcp.status` (no network) and runs after start, reconnect, login, and `/mcp`.
    - agent-sdk: `AgentSdkMcpPlane.getServerTools(serverId)` added to the interface (already implemented on the plane) so hosts can list/unregister a server's tools; `mergeAgentConfig` now spreads the full MCP plane config instead of rebuilding `{servers, connector}`, which had been silently dropping `allow`, `connectTimeoutMs`, and `executionPolicy` — the dropped policy meant bridged MCP tools bypassed the plan 137 approval gate in Prism Code.
    - Tests: new `packages/prism-code/src/__tests__/mcp-integration.test.ts` (6 cases) — real stdio fixture (inline `@arnilo/prism-mcp` server script) tool call end-to-end in headless with the mock provider, denial through the approval policy, prefixed tool call rendered in the TUI with `connected/total` footer, `/mcp` listing for connected/failed/disabled servers plus session disable/enable and login error paths, background reconnect with a marker-gated server (non-blocking timing assertion, footer refresh, tool swap, no env-value leak), and a `/mcp login` OAuth round trip against a local fake authorization server storing tokens under `mcp:<id>`. agent-sdk `mcp-plane.test.ts` asserts `getServerTools`; `presets.test.ts` covers the MCP merge fix. Suites: prism-code 288 pass, agent-sdk 72 pass.
    - Docs: `docs/prism-code.md` (footer line, `/mcp` command-table row, MCP-servers section paragraph), `docs/agent-sdk.md` (`getServerTools` in the interface block + reconnect bullet), `CHANGELOG.md` (Added `/mcp` + footer; Changed merge semantics).
    - Checks: `bun run build` all workspaces; prism-code typecheck; `biome lint .` zero diagnostics; `live-doc-check` 6/6; `package-truth --emit-docs` regenerated (prism-code declared exports 276 → 278 for `formatMcpStatus` + `McpSessionControl`); `release.mjs gate --update-baseline` + plain `gate` clean (records the `formatFooterDetails` signature widening); gate suites 313 (311 pass / 2 skip); root suites 2147 pass.
    - Notes/deviations: the acceptance sketch showed a two-column table; the implementation uses a one-line-per-server `• <id> — <state>, <n> tools, <transport>` list (same fields, no fixed-width dependency). Session `disable` state lives in the TUI (`mcpSessionDisabled`) because the plane has no disable API; it is not duplicated plane state, only which registry entries this session removed. `/mcp login` awaits its network/prompt round trip (interactive by nature); only `reconnect` is backgrounded, per the performance criterion.

  - Acceptance Criteria:
    - Functional: `/mcp` lists servers with state, tool count, transport, and redacted error. Subcommands: `/mcp reconnect <id>`, `/mcp login <id>` (OAuth), `/mcp disable|enable <id>` (session-scoped), and `/mcp tools <id>` (tool names + descriptions). The footer shows `MCP connected/total` and highlights failures.
    - Functional: MCP tools appear in the TUI with the server prefix and go through the plan 137 approval policy.
    - Functional: an integration test uses a real stdio MCP server fixture (from the `@arnilo/prism-mcp` test fixtures or `@modelcontextprotocol/server-everything` pinned) and calls one of its tools from a mock-provider-driven run in the TUI and headless.
    - Performance: `/mcp` renders from cached status (no network); reconnect is async and does not block input.
    - Code Quality: the command uses the plane status API from Task 4; no duplicate state.
    - Security: `/mcp` output never includes header values, env values, or tokens.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-code/src/tui/{commands,index}.ts`, `src/tui/components/status.ts`, `packages/mcp/src/__tests__/` fixtures
    - Options Considered:
      - Status only in the footer. Rejected: no way to see errors or recover.
    - Chosen Approach: a command family over the plane status + reconnect.
    - API Notes and Examples:
      ```text
      /mcp
        github   connected  12 tools  streamable-http
        linear   failed     0 tools   401 Unauthorized — run /mcp login linear
      ```
    - Files to Create/Edit:
      - `packages/prism-code/src/tui/commands.ts`: `/mcp` family
      - `packages/prism-code/src/tui/components/status.ts`: footer
      - `packages/prism-code/src/__tests__/mcp-integration.test.ts`
    - References:
      - Tasks 4–5
  - Test Cases to Write:
    - `/mcp` output for connected/failed/disabled servers.
    - Reconnect flow updates the footer and the tool list.
    - Real stdio fixture tool call succeeds end-to-end in headless and TUI (mock provider issues the call).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new slash commands.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: commands table
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- The `/mcp` status sketch showed aligned columns; the shipped output is a one-line-per-server list with the same fields (id, state, tool count, transport, redacted error/reason) because fixed-width alignment adds no value in the TUI stream and complicates tests.
- Session-scoped `disable`/`enable` only unregisters/restores registry tools; the bridge stays connected. Fully closing and re-opening a bridge per session toggle would need a new plane primitive and was out of scope.
- `/mcp login` requires the operator to paste the callback URL/code (no loopback listener in Prism Code); the redirect URI default is `http://127.0.0.1:1456/oauth/callback` and is overridable with `PRISM_MCP_OAUTH_REDIRECT_URI`.

## Further Actions

- Add a loopback OAuth callback listener so `/mcp login` can complete without pasting (low priority; pasting works and avoids opening a port).
- Consider surfacing per-server reconnect attempts/backoff in the footer once the plane grows a retry policy (the current plane only reconnects on demand).
- `formatMcpStatus` and the new footer counts are exported from their module but not re-exported from the package barrel; re-export if hosts need to render the same footer.
