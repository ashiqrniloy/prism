# Prism Code session store, resume, and MCP plane primitive review (plan 138 Task 1)

Plan: [138-Prism-Code-Sessions-And-MCP.md](../../plans/138-Prism-Code-Sessions-And-MCP.md) Task 1
Date: 2026-09-28
Baseline: `@arnilo/prism` 0.12.0, `@arnilo/prism-core` 0.12.0, `@arnilo/prism-mcp` 0.12.0, `@arnilo/prism-agent-sdk` 0.12.0, `@arnilo/prism-code` 0.12.0, Bun 1.4.2
Scope: Read-only primitive inventory across the session store listing/metadata/search APIs, the prism-code resume and history-rendering path, and the MCP plane, bridge, transport/auth, and prism-code config surfaces. Findings drive Tasks 2–6.

---

## 1. Verdict & Generic Gaps

Three generic gaps must be implemented in foundational packages. Trust prompts, `/mcp` presentation, reference resolution, and OAuth token persistence are app-level wiring in `packages/prism-code` and stay there.

| Gap | Current state | Owning package | Decision |
| --- | --- | --- | --- |
| **(a) Per-server MCP status, parallel connect with timeout, reconnect, host allow-list** | Confirmed absent. `assembleMcpPlane` connects sequentially and throws on the first failure, closing every earlier bridge (`packages/agent-sdk/src/planes/mcp.ts:264-290`). No `status`, `reconnect`, or `close` on the assembled plane. `assertServerAllowed` validates only the spec's own `allow` field; no host allow-list check. `McpToolBridge` exposes `refresh()`/`close()` only (`packages/mcp/src/types.ts:389-400`); the bridge client connect already honors an `AbortSignal` (`packages/mcp/src/bridge.ts:49-85`). | `@arnilo/prism-agent-sdk` (`packages/agent-sdk/src/planes/mcp.ts`, consumed by `define-agent.ts`) | Change `AssembledMcpPlane` to `{ bridges, tools, connectedServerIds, status, reconnect, close }` where `status` is a typed union `{ serverId, state: "connected" \| "failed" \| "disabled", toolCount, error? }`. Validate all specs first (`assertServerAllowed` still throws `AgentSdkConfigError`), then `Promise.allSettled` per server with `connectTimeoutMs` (default 15 000, `AbortSignal.timeout`) passed to `connectMcpTools`; connection failures become `failed` with a redacted error and never close siblings. Add `McpPlaneConfig.allow?: readonly string[]` (reuse `parseAllowDestination`); a configured server outside it is `disabled` with a reason. `reconnect(serverId)` closes the old bridge, re-runs the connector single-flight, and replaces the plane's tool slice; `defineAgent` applies the resulting registry delta between runs (see §3.1). Regenerate `scripts/compat-baseline/*` and record the failure-semantics change in `CHANGELOG.md` per plan Task 4. |
| **(b) SDK server-spec fields for HTTP headers and OAuth auth** | Confirmed absent from the spec, present one layer down. `McpHttpServerSpec` has no `headers`, `auth`, `connectTimeoutMs`, or `enabled` (`packages/agent-sdk/src/planes/mcp.ts:56-75`); `buildConnectOptions` never sets `requestInit` or `auth`. The transport primitive already supports both: `McpStreamableHttpTransport.requestInit` and `.auth` (`packages/mcp/src/types.ts:43-57`), wired through `createMcpTransport`/`createMcpOAuthTransport` (`packages/mcp/src/transport.ts:10-58`), with `createMcpClientAuth` (`packages/mcp/src/auth.ts:456`) requiring a host `McpClientAuthState` persistence seam (`packages/mcp/src/auth.ts:136-161`). | `@arnilo/prism-agent-sdk` | Add `headers?: Readonly<Record<string, string>>`, `auth?: McpClientAuthOptions`, `connectTimeoutMs?: number` to `McpHttpServerSpec`; map headers to `requestInit.headers` and pass `auth` through in `buildConnectOptions`. The SDK spec stays a pure transport description: it never resolves `${env:...}`/`${credential:...}` references and never carries secrets. prism-code resolves references at connect time and supplies the `McpClientAuthState` adapter over the plan 136 credential store. |
| **(c) Session title / last-activity / message-count convention** | Confirmed absent. `SessionEntry` has `label`/`summary` but no title convention (`src/contracts-core/session.ts:28-41`); `SESSION_SEARCH_WORKSPACE_METADATA_KEY` is the only host metadata key (`:65`). `SessionSearchHit` exposes `label`, `summary`, `snippet`, `updatedAt`, but no title and no entry/message count (`:111-127`). Search hits pass through `safeSearchMetadata`, which drops every metadata key except `workspaceRoot` (`packages/prism-core/src/sessions/codecs/search.ts:33-38`). `appendSession` replaces `metadata` wholesale on upsert (`packages/prism-core/src/sessions/sqlite/persistence.ts:154`, postgres `:203`), so a title written once is clobbered by the next metadata write. Last activity already exists: entry appends bump `prism_sessions.updated_at` (`ensureSession.run`, `persistence.ts:421`) and search orders by it (`:975`). | Convention + hit surface: `@arnilo/prism` (`src/contracts-core/session.ts`). Merge-safe write + count: `@arnilo/prism-core` (`sessions/sqlite/persistence.ts`, `sessions/postgres/persistence.ts`) | Add `SESSION_TITLE_METADATA_KEY` and (≤ 80 chars) constants; let `safeSearchMetadata` carry the title; add `title?: string` and `messageCount?: number` to `SessionSearchHit` (count of `kind = "message"` entries, computed per returned page row like the existing label/summary display subqueries). Make the metadata write merge-safe in both SQL adapters (`json_patch(COALESCE(metadata,'{}'), excluded.metadata)` / `metadata || excluded.metadata`) rather than adding a second API. Last activity is the existing `updated_at`; no new timestamp key. prism-code only derives the title from the first redacted user prompt and writes it through `ensureDurableSessionRecord`; no new store abstraction. |

### App-level (stays in `packages/prism-code`)

- Repo trust prompt and `~/.prism/trust.json` fingerprint store (`src/mcp.ts`, new), `--trust-project-mcp`, header reference resolution, OAuth token persistence adapter, `/mcp` command family and footer status.

---

## 2. Session Primitives

### 2.1 Contracts (`src/contracts-core/session.ts`)

- `SessionEntry` (`:28-41`) carries `kind` ∈ `message | event | summary | metadata | model_change | label | custom | compaction`, `message`, `event`, `label`, `summary`, `data`, `metadata`.
- `SessionStore` (`:46-60`) is intentionally narrow: `append`, `list(sessionId)`, optional `get`, optional `readBranchPath`, optional `searchSessions`. Session-record metadata (`appendSession`/`querySessions`) lives on the persistence adapter, not on `SessionStore`; prism-code relies on a structural `SessionStoreWithAppend` extension (`packages/prism-code/src/sessions.ts:58-68`) and a runtime `typeof store.appendSession === "function"` check.
- `SessionSearchQuery` (`:88-108`) already supports workspace, text query, kind, provider/model, label/summary, updated-at range, cursor, and limit; `resolveSessionSearchQuery` (`:147`) fills limits and rejects oversized input.
- `SessionSearchHit` (`:111-127`) is the safe resume/checkout projection: `sessionId`, `leafId`, `entryId`, `runId`, `turn`, `score`, `updatedAt`, `label`, `summary`, `snippet`, allowlisted `metadata`.
- `SESSION_SEARCH_WORKSPACE_METADATA_KEY` (`:65`) is the only convention constant; there is no title key.

### 2.2 SQLite persistence (`packages/prism-core/src/sessions/sqlite/persistence.ts`)

- `appendSession` (`:584`) is an upsert with optimistic `version` CAS (`:144-159`); `metadata = excluded.metadata` replaces the whole JSON object, and `updated_at` only moves forward. `SessionMetadataConflictError` reports versions only.
- `ensureSession.run` on entry append (`:421`) bumps `prism_sessions.updated_at`, so the sessions row is a valid last-activity source; `searchSessions` (`:620`) delegates to `searchSqliteSessions` (`:892`).
- Search filters workspace via `json_extract(metadata, '$.workspaceRoot')` (`:911`), orders by `updated_at, id` with cursor paging (`:975`), uses an FTS5 `prism_session_search_fts` dual-write (`:172`) for the text query, and computes per-row display fields (latest label/summary, turn) with correlated subqueries after `LIMIT`. `safeSearchMetadata` strips the hit metadata down to `workspaceRoot` (`:1019`).
- `querySessions` (`:570`) filters by metadata key presence only; there is no title/updatedAt/list-by-repo convenience beyond `searchSessions`.
- No busy-timeout or file-permission setup lives here; the adapter opens `bun:sqlite` with the caller's path and applies migrations. Busy timeout is pending plan Task 2.

### 2.3 Prism Code helpers (`packages/prism-code/src/sessions.ts`)

- `getCanonicalWorkspaceRoot` (`:20-31`) is `realpath(resolve(cwd))` with fallback. It is **not** a git-root resolver, so launching from a repo subdirectory scopes sessions to the subdirectory, not the repository root (plan Task 2 requires the canonical git root).
- `resolveSessionStore` (`:35-56`) defaults durable SQLite to `<cwd>/.prism/sessions.db`, requires an explicit `store.path` for `store: { type: "sqlite" }`, supports `:memory:`, and creates the parent directory. `store: "memory"` uses the memory store.
- `ensureDurableSessionRecord` (`:75-100`) writes `{ workspaceRoot: canonicalRoot }` metadata on session creation, but is a no-op for stores without `appendSession`.
- `searchRepoSessions` (`:116-146`) resolves `searchSessions` + `appendSession` and surfaces a clear resumption-unsupported error for the memory store.
- `formatSessionOption` (`:152-185`) formats a hit as `{ name: sessionId, description: localized updatedAt | label/summary/snippet }`; it redacts against caller-supplied secrets, truncates summaries at 50 chars, and shows no title, relative time, or count.

### 2.4 Resume and history surfaces

- `PrismCodeTuiOptions` already accepts `sessionId` and `store` (`packages/prism-code/src/tui/index.ts:47-48`). `start()` rejects `sessionId` with a memory store (`:294`), passes `{ id: this.options.sessionId }` into `createSession` (`:316`), calls `ensureDurableSessionRecord` (`:323`), then renders `formatHistoricalEntries(await this.session.entries())` (`:327-328`). `switchSession` uses the same formatter (`:462-480`).
- The CLI never passes `flags.session` into `createPrismCodeTui` (`bin/prism-code.ts:183-220`); only headless receives `sessionId: flags.session` (`:245`). `flags.ts` parses `--session`/`--session=` only (`:7,83-87`): no `--continue`, `--resume`, or `--rename`.
- `formatHistoricalEntries` (`tui/index.ts:72-110`) is the drift point named by the plan:
  - `kind: "message"` for role `tool` is flattened to a `system` message and maps only `text` blocks, so `tool_result` blocks render as empty text.
  - `thinking` blocks are dropped entirely.
  - `kind: "event"` with `tool_execution_started` hardcodes `status: "success"`; there is no matching finished/error/blocked handler.
  - `compaction` renders as an assistant message; `model_change`, `label`, `summary`, `metadata`, `custom` are ignored.
- The live reducer already has the complete tool lifecycle status union and handlers (`tui/reducer.ts:20-27`, `:334-400`), but the `tool_execution_finished` handler reads `const toolCallId = event.runId` (`:353`) while the event carries the call id in `event.result.toolCallId` (`src/contracts-protocol.ts:526-533`); the lookup can then never match the `tool_${toolCallId}` entry. This is a live-rendering bug, not just a history gap.
- The core runtime persists **no** `kind: "event"` entries: `emit()` writes events to the run ledger only when `activeLedger` is set (`src/agent-session/session.ts:671-695`), and message entries are appended separately (`:778-780`). prism-code never wires a run ledger (`grep` finds no `ledger` use in headless/tui/acp), so a faithful history replay must reconstruct tool status from assistant `tool_call` blocks plus `role: "tool"` `tool_result` blocks (`result`/`error` fields), and thinking from `thinking` blocks — not from event entries.
- `wrapSessionDisabled` already uses `Object.create(session)` to keep the prototype chain (`packages/prism-code/src/observational-memory.ts:311`); the plan's "no longer spreads a class instance" item is stale. Keep a regression test in Task 3 and drop the rewrite.

### 2.5 Findings that drive Tasks 2–3

1. Task 2: introduce one resolver (`config.store.path` override, default `~/.prism/sessions/sessions.db`), share it across TUI/headless/ACP (`acp.ts:198-218` duplicates the current default logic), canonicalize to the git root, add busy timeout + `0600`/`0700` modes, and keep legacy-notice handling in prism-code.
2. Task 3: pass `--session` to the TUI; add `--continue`/`--resume`/`/rename`; add title + count through gap (c); replace `formatHistoricalEntries` with an entries→events adapter that synthesizes tool lifecycle events from message blocks; fix the `tool_execution_finished` call-id lookup; render thinking collapsed; keep the reducer as the single renderer.

---

## 3. MCP Primitives

### 3.1 Agent SDK plane (`packages/agent-sdk/src/planes/mcp.ts`)

- `McpServerSpec` (`:56-76`) has three shapes: stdio (`command`/`args`/`env`/`cwd`), HTTP (`url`/`allowedOrigins`), and custom `McpTransportConfig`. None carries `headers`, `auth`, or `connectTimeoutMs`.
- `assertServerAllowed` (`:100-170`) enforces per-server self-consistency (stdio ⇒ `allow: "stdio"`; URL origin/path must match `allow`), not a host allow-list.
- `buildConnectOptions` (`:172-215`) maps specs to `ConnectMcpToolsOptions`; URL specs default `allowedOrigins` to the parsed origin, but never set `requestInit` or `auth`.
- `assembleMcpPlane` (`:264-290`) validates and connects in one sequential loop; `catch` closes every already-opened bridge and rethrows. The returned `AssembledMcpPlane` has no status or lifecycle.
- `defineAgent` awaits the plane (`packages/agent-sdk/src/define-agent.ts:198`), appends `mcpPlane.tools` to the static tool list (`:210`), and exposes only `connectedMcpServerIds` (`.length` drives the prism-code footer count at `tui/index.ts:302`). `dispose()` closes bridges (`:271-276`).
- Registry update is feasible without rebuilding the agent: `activeTools()` reads `tools.list()` on every run (`src/agent-tool-dispatch.ts:105-110`), `ToolRegistry` is mutable (`src/tools.ts:108-125`), and `assemble.ts` snapshots the list per run (`:330-340`). Task 4 only needs `defineAgent` to apply a reconnect delta (remove old prefixed tools, register the new set) and expose the plane handle for status/reconnect/close.

### 3.2 Prism MCP bridge, transport, and auth

- `connectMcpTools` (`packages/mcp/src/bridge.ts:49-85`) accepts an `AbortSignal`, connects with the bridge's call timeout, lists tools with bounded pagination, and closes the bridge on any failure. The facade (`:328-347`) exposes `tools`, `protocolEra`/`protocolVersion`, optional `apps`, `refresh()`, `close()`; `refresh()` re-lists with TTL/cache-hint handling. There is **no** `reconnect()`; Task 4 reconnects at the plane level by re-invoking the connector.
- `McpStreamableHttpTransport` (`packages/mcp/src/types.ts:43-57`) already supports `requestInit`, `sessionId`, `resolveHostname`, `allowedOrigins`, `maxResponseBytes`, and `auth`.
- `createMcpTransport` (`packages/mcp/src/transport.ts:10-31`) passes `requestInit` into the SDK transport; `createMcpOAuthTransport` (`:37-58`) builds the OAuth-aware fetch and transport. `createSecureMcpFetch` rejects a `host` header override, pins the endpoint origin, and routes every request through the SSRF/DNS-rebinding/redirect/byte-bound `pinnedFetch` path.
- `McpClientAuthState` (`packages/mcp/src/auth.ts:136-161`) is the required persistence seam (tokens, discovery, client info, verifier, optional authorization-state round trip). `McpClientAuthOptions` (`:163-190`) carries `strategy`, `scopes`, `redirectUri`, `onRedirectRequired`, and limits. `createMcpClientAuth` (`:456`) returns `ensureAuthorized`/`finishAuth`/`revoke`/`getTokens`. prism-code must supply a plan 136-backed adapter; none exists today (`grep McpClientAuthState` finds only the package itself).

### 3.3 Prism Code config and surfaces

- Parser (`packages/prism-code/src/config.ts:706-760`): `mcp.allow` and each server are opt-in known keys, but server objects are **not** passed through `rejectUnknown` — unknown fields are silently dropped. URL servers default `allow` to `"stdio"` (`:720`), which then fails `assertServerAllowed`'s origin check unless the user wrote an explicit URL allow; `transport` is cast with `as any` (`:729`); `env` is copied without value validation; `allowedOrigins` is not parsed. `store` requires `type` + `path` for sqlite (`:934-950`), so the plan's `store.path` override key exists but there is no default-path resolution in the resolver yet.
- Headless passes `config.mcp.servers` straight into `defineAgent` with the execution policy (`packages/prism-code/src/headless.ts:229-234`).
- ACP uses `config.mcp.allow` only to filter **client-requested** session servers via `selectMcpServers` (`packages/prism-code/src/acp.ts:80-110, 430-434`); configured servers are neither trust-gated nor allow-gated there. TUI/headless do not consult `mcp.allow` at all.
- The footer renders `MCP: <connected> connected` only (`packages/prism-code/src/tui/components/status.ts:47-53`); there is no total, no failed count, and no `/mcp` command (`grep mcp packages/prism-code/src/tui/commands.ts` is empty).
- Docs: `docs/prism-code.md:89` still documents the old default store; `docs/mcp-tools.md` documents `requestInit.headers` as the only header seam; `docs/agent-sdk.md` documents neither headers/auth nor plane status.

### 3.4 Findings that drive Tasks 4–6

1. Task 4: implement gap (a)+(b) in the SDK plane; expose status/reconnect/close through `defineAgent`; keep config errors fail-closed and connection errors non-fatal; redact header/token values in every status error; regenerate the compat baseline.
2. Task 5: stop dropping server fields (validate unknown keys, validate `env`/`args`/`allowedOrigins`), default URL `allow` to the URL origin, parse `headers`/`auth`/`connectTimeoutMs`/`enabled`, remove the `as any` cast, merge global+project servers by `serverId`, and pass `mcp.allow` into the plane for every surface (not just ACP client requests).
3. Task 6: `/mcp` reads the plane status; reconnect calls the Task 4 API; the live MCP integration test exercises the real stdio fixture path.

---

## 4. Trust and Secret Model

**Repo-declared MCP servers are untrusted by default.** Any `prism-code.json` server is admitted per repository and per server fingerprint (stdio: command + args + env key names; HTTP: transport + URL) recorded in `~/.prism/trust.json` (`0600`). A changed fingerprint re-prompts. Global-config (`~/.prism/config.json`) servers are trusted. Headless/ACP skip untrusted project servers with a `disabled` status reason unless `--trust-project-mcp` is passed. The trust decision is host policy in `packages/prism-code/src/mcp.ts`; the SDK plane receives only already-admitted specs plus the host allow-list, so embedded SDK hosts keep their own admission policy.

**Header and token secret sources.** Project config may only reference `${env:NAME}` or `${credential:NAME}`; literal header values are rejected outside the global config, so a committed repo config cannot carry tokens. References resolve at connect time through the plan 136 credential manager (`packages/prism-code/src/credentials.ts`), never persist into the trust file, the plane status, or logs, and never appear in `/mcp` output. OAuth runs through `createMcpClientAuth` with a prism-code `McpClientAuthState` adapter keyed under `mcp:<serverId>` over the plan 136 store; refresh tokens never land in a plaintext path. Transport-level guarantees already in place: exact-origin pinning for the endpoint and every session/reconnect request, no redirects, `Host` override rejected, and OAuth discovery URLs verified against the MCP origin (RFC 9728/RFC 8707 checks in `packages/mcp/src/auth.ts`).

Performance: review only; no measurements claimed. Plan Task 4's parallel-connect bound and Task 3's 5k-entry render bound remain implementation-time acceptance criteria.
