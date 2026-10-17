# Phase 11 Part E — host isolation and security hardening

## Objectives

- Partition `@arnilo/prism-remote` by principal: sessions, host-UI requests (approvals, secrets), pending-decision delivery, and agent events reach only the principal that owns the session.
- Allow-list the wire shape of remote decisions and steer options, so a client cannot submit `modifiedArguments` or arbitrary fields unless the host opts in.
- Move `@arnilo/prism-ag-ui` onto plan 177's narrow-only session ownership, with a two-user isolation test.
- Close the devtools DNS-rebinding gap, extend manifest integrity to a package's full dependency closure, pre-resolve Obscura targets against private addresses, make the coding package's unsandboxed shell visible, and add the missing pinned-fetch regression test.

## Expected Outcome

- `serveAgent` over WebSocket/HTTP with two authenticated principals: neither can open, run, read, steer, abort, resume, or receive host-UI requests or events for the other's sessions (`two_principals_are_isolated`).
- `createAgUiHandler` with per-request `authorize` ownership: user B with user A's `threadId` gets 404/`SessionNotFoundError`, not A's history.
- `serveDevtools` on loopback rejects a request whose `Host` or `Origin` is not loopback (`403 forbidden_host`).
- `loadManifest` refuses a package whose hoisted dependency bytes changed after install (`integrity_mismatch`).
- The Obscura fetch refuses a public hostname that resolves to a private address (`ERR_OBSCURA_SSRF`).
- `@arnilo/prism-tools-coding` with `sandbox: "none"` and shell enabled emits a `warn` status note, and its README has an enterprise hardening section.
- `src/__tests__/pinned-fetch.test.ts` proves the socket connects to the pinned address for a hostname the system resolver cannot resolve.

This plan is a pre-publish part of roadmap **Phase 11**. It **depends on plan 177** (Task 4's `SessionOptions.ownership` and Task 3's re-gated resume) and **blocks plan 175 Task 10**. It changes host-library and package contracts (remote serve options and wire allow-list, the manifest `integrity` meaning) but no kernel hook, slot, or `RunController` primitive; Task 1 is still a review because Task 6 changes the manifest format's semantics (`references/prism.md` §2). No version bump or publish. Lab impact: n/a (plan 173 deleted `packages/prism-code`); `apps/prism-agent` uses `serveAgent` and its suite stays green. Cost knobs: n/a, except Task 6's install-time hashing cost, which its docs state.

## Tasks

- [x] Task 1: Review (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record, with `file:line`:
      - (a) every piece of shared state in `packages/hosts/remote/src/serve.ts` (`ServerState` at `:60-70`, `sessions`, `resuming`, `active`), the network transport's per-connection principal (`transports/network.ts:36-41,103-107`), `remoteHostUi` routing (`host-ui.ts:19-49`), `deliverPending` (`serve.ts:265-290`), and the agent-event fan-out (`serve.ts:365-380`);
      - (b) every remote wire handler and the fields it forwards unvalidated (`parseDecisions` `serve.ts:134`, `steer` options, `sessions.list` query, `sessions.open` parent);
      - (c) the `prism.remote/1` protocol document and `connectAgent` client, and whether any change here is a protocol change that needs a version bump of the protocol id;
      - (d) the AG-UI open/run/resume paths (`packages/hosts/ag-ui/src/handler.ts:120-140,225-275`) and its in-memory `pending` map;
      - (e) the devtools router (`packages/hosts/devtools/src/serve.ts:56-135`) and the remote/MCP `hostOriginRejection` helpers it can reuse;
      - (f) the manifest install and load paths (`src/manifest/install.ts:190-260`, `src/manifest/integrity.ts`, `src/manifest/load.ts`) and how Bun lays out a managed project's `node_modules` (hoisted linker, `bunfig.toml`);
      - (g) `packages/tools/web/src/obscura/cli.ts:120-135` and `process.ts` flags.
    - Functional: A verdict per later task; a finding that invalidates one stops the plan for re-cut.
    - Performance: n/a — read-only.
    - Code Quality: n/a — read-only.
    - Security: The review states whether single-principal deployments (stdio, loopback without `authenticate`) keep today's behavior byte-for-byte.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/remote/README.md`, `packages/hosts/ag-ui/README.md`, `packages/hosts/devtools/README.md`, `docs/manifest.md`, `docs/host-security.md`; the 2026-10-15 review findings.
    - Options Considered:
      - Fixing without a review. Rejected: Task 6 changes what `integrity` means in a manifest file.
    - Chosen Approach:
      - Read-only inventory with `graft callers serveConnection --depth all` and `graft callers hashPackageTree --depth all`.
    - API Notes and Examples:
      ```bash
      graft callers serveConnection --depth all
      graft callers hashPackageTree --depth all
      ```
    - Files to Create/Edit:
      - this plan (Notes only)
    - References:
      - plans 170–171 (remote, headless), plan 150 (manifest)
  - Test Cases to Write:
    - n/a — read-only task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - **(a) `prism-remote` shared state, network principal, `remoteHostUi`, `deliverPending`, and event fan-out:**
      - `ServerState` (`packages/hosts/remote/src/serve.ts:62-71`, constructed by `createServerState` at `:73-87`) holds `agent` (`:63`), `endpointId` (`:64`), `sessions: Map<string, Session>` (`:65`), `resumeAuthority` (`:66`), `resuming: Set<string>` (`:67`), `active: Set<string>` (`:68`), `limits` (`:69`), and `hostUi` (`:70`). `state.sessions` is a flat `sessionId -> Session` map with no principal key; `session(id)` (`:201-205`) reads `state.sessions.get(id)` and `sessions.open` (`:303-323`) reuses/inserts `state.sessions.get(opened.id)` (`:318-320`) across all connections. `state.resuming` and `state.active` are session-id concurrency sets checked in `resume` (`:258`), `deliverPending` (`:277`), and `run` (`:338`), and cleared in `forward` (`:246-247`), `resume` (`:269-270`), and `run` (`:344`).
      - Network transport per-connection principal (`packages/hosts/remote/src/transports/network.ts:35-41,90-94,101-245`): `Connection` (`:35-40`) carries `principal?: Principal` (`:38`) and is stored in `connections: Map<string, Connection>` (`:41`). In `fetch` (`:101-221`), after `hostOriginRejection` (`:102-110`), `authenticate(request)` (`:114-123`) produces `identity = { principal }` with non-empty `principal.id` and `principal.kind` (or, when `authenticate` is omitted on loopback, bearer `token` is checked at `:124` and `identity` stays `undefined`). WebSocket upgrade attaches `identity?.principal` to `ws.data` (`:134,228-238`); HTTP `GET /events` passes `identity?.principal` to `make` (`:161`); HTTP `POST /rpc` checks `connection.principal?.id !== identity?.principal.id || connection.principal?.kind !== identity?.principal.kind` (`:194-195`). `attach` (`:90-94`) forwards `connection.principal` into `serveConnection(state, connection.transport, ...)` (`:92`).
      - `remoteHostUi` routing (`packages/hosts/remote/src/host-ui.ts:12,19-51`): module-level `bindings = new WeakMap<HostUi, RemoteUiConnection[]>()` (`:12`) backs `remoteHostUi()` (`:19-40`) and `bindRemoteHostUi()` (`:43-51`, called at `serve.ts:382-385`). `ui.request` (`:22-36`) always selects `connections[connections.length - 1]` (`:23`, last-connected wins), ignoring `request.sessionId` and principal ownership, and routing agent-scoped requests (`request.sessionId === undefined`) to whichever client connected last.
      - `deliverPending` (`packages/hosts/remote/src/serve.ts:275-300`): called on `sessions.open` (`:321`) and in `onInitialize` (`:386`: `for (const open of state.sessions.values()) void deliverPending(open)`). Because `state.sessions` is unpartitioned, any client initializing with `hostUi: true` receives `hostUi.request` for pending decisions on every open session across all principals and resumes them under its own `principal` (`:294`).
      - Agent-event fan-out (`packages/hosts/remote/src/serve.ts:388-400`): when `negotiated.agentEvents` is true, `onInitialize` opens `agent.subscribe({ maxQueuedEvents: limits.maxQueuedEvents, overflow: "drop_oldest" })` (`:389`) and forwards every event via `dispatcher.notify("agent.event", { event: next.value })` (`:394`) to every subscribed connection, regardless of `event.sessionId` ownership or operator status.
    - **(b) Unvalidated wire fields in `packages/hosts/remote/src/serve.ts`:**
      - `parseDecisions` (`serve.ts:134-139`): checks only `isObject(item) && typeof item.approvalId === "string" && typeof item.outcome === "string"`, then returns `value as unknown as readonly Decision[]` (`:138`), forwarding `modifiedArguments`, unvalidated `outcome` strings, unbounded `approvalId`/`reason`, `elicitation` on non-elicitation decisions, and arbitrary extra keys.
      - `steer` (`serve.ts:348-350`): passes `isObject(params.options) ? (params.options as never) : undefined` directly to `session.steer(...)` without allow-listing `{ softInterrupt?: boolean }`.
      - `sessions.list` (`serve.ts:324-327`): checks only `params.query !== undefined && !isObject(params.query)` and forwards `params.query as never` to `agent.sessions.list(...)`, allowing arbitrary keys and client-supplied ownership keys (`tenantId`, `accountId`, `userId`, `principal`).
      - `sessions.open` (`serve.ts:303-323`): checks `params.parent !== undefined && !isObject(params.parent)` (`:306`) and forwards `params.parent as never` (`:312`) without allow-listing `SessionParentLink` keys (`sessionId`, `agentId`, `workflowRunId`, `delegationId`) or bounding them to `MAX_SESSION_LINK_ID_LENGTH` (`256`, `src/contracts-core/session.ts:99,304-309`) at the wire boundary.
    - **(c) `prism.remote/1` protocol and `connectAgent`:**
      - `packages/hosts/remote/src/protocol.ts:3-104` and `packages/hosts/remote/src/connect.ts:48-209`: all frame methods, notifications, request/response envelopes, and capability names in `REMOTE_PROTOCOL = "prism.remote/1"` (`protocol.ts:3`) remain identical. Tightening server-side parameter validation (`invalid_params`) and principal-scoped routing (`session_not_found` / `unavailable`) does not change any wire frame shape or `connectAgent` behavior, so no protocol id version bump is needed.
    - **(d) AG-UI open/run/resume paths and `pending` map:**
      - `packages/hosts/ag-ui/src/handler.ts:119-167,223-303,387-440,544-554`: `pending` (`:119`) is `new Map<string, { readonly threadId: string; readonly approvalId: string }>()` with no ownership scope stored on records (`:413`) or checked in `readResumeDecisions` (`:278-303`). `startSource` (`:223-249`) opens `await agent.session({ id: input.threadId, create: true })` (`:232`) without `ownership: authorization.ownership` (only passing `ownership` to `session.stream` at `:235`), and `resumeSource` (`:251-275`) opens `await agent.session({ id: input.threadId })` (`:261`) without `ownership: authorization.ownership`. Furthermore, `startSource` and `resumeSource` are async generators consumed inside `sse(...)` (`:448-498`), so `agent.session(...)` currently runs inside `pull()` *after* the 200 SSE response has been returned (turning any `SessionNotFoundError` / `OwnershipScopeError` into an SSE `RUN_ERROR` at `:484-492` instead of a pre-stream HTTP 404). Opening the session before `sse(...)` (or mapping `SessionNotFoundError` / `OwnershipScopeError` in `errorResponse` at `:544-554` to `404 ERR_PRISM_AG_UI_NOT_FOUND` before returning `sse(...)`) is required to meet Task 4's pre-stream 404 requirement.
    - **(e) Devtools router and `hostOriginRejection` reuse decision:**
      - `packages/hosts/devtools/src/serve.ts:57-135`: `serveDevtools` (`:57-88`) passes `fetch: (request) => handle(request, context, token)` to `Bun.serve` (`:69-73`); `handle` (`:90-101`) checks only `bearerMatches(request, token)` when `token !== undefined` and performs no `Host` or `Origin` check on any route (`route` at `:103-135`).
      - Both `packages/hosts/remote/src/http-gate.ts:6-20` and `packages/hosts/mcp-server/src/server.ts:191-202` implement the 15-line `hostOriginRejection` check in-package because each package returns its own error envelope (`{ error: code }` in remote vs `{ error: { message } }` in mcp-server vs `{ error: { code, message } }` with `JSON_HEADERS` in devtools) and `@arnilo/prism-devtools` (`packages/hosts/devtools/package.json:26-28`) has zero runtime dependencies beyond peer `@arnilo/prism`. **Decision:** keep `@arnilo/prism-devtools` dependency-free by placing the `hostOriginRejection` helper in `packages/hosts/devtools/src/security.ts` (returning `ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST` / `ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN` via `errorResponse`) with a parity test against `packages/hosts/remote/src/http-gate.ts:6-20`, and add `allowedHosts` / `allowedOrigins` to `DevtoolsOptions` (`packages/hosts/devtools/src/serve.ts:20`, with `export type ServeDevtoolsOptions = DevtoolsOptions` alias).
    - **(f) Manifest install, integrity, load, and Bun `node_modules` layout:**
      - `src/manifest/install.ts:193-237` runs `bun add --ignore-scripts <spec>` inside `dirs.packagesDir` (`:201`), hashes only the top-level package directory `installedPackageDir(dirs.packagesDir, name)` via `hashPackageTree` (`:212-213`), imports the definition (`:216`), and writes the manifest (`:231`).
      - `src/manifest/integrity.ts:17-114` walks and hashes a single directory (`walk` `:17-47`, `hashPackageTree` `:54-78`) and `verifyInstalled` (`:89-114`) checks only `installedPackageDir(packagesDir, entry.name)` (`:94-113`). `verifyInstalled` is called by `loadManifest` (`src/manifest/load.ts:132`) and by `definitionOf` / `verify` (`src/manifest/maintain.ts:118,249`).
      - Repo-wide `bunfig.toml:4-6` sets `[install] linker = "hoisted"`, and `bun add` in a standalone managed project (`dirs.packagesDir/package.json`, `src/manifest/install.ts:126-140`) also uses Bun's default hoisted linker, placing runtime `dependencies` and non-optional `peerDependencies` under `join(packagesDir, "node_modules", ...)` (with nested `<pkgDir>/node_modules/...` only when version conflicts occur). Walking the `node_modules` ancestor chain from each package directory up to `packagesDir` (reading `<candidate>/package.json` rather than `require.resolve`, which fails on packages whose `"exports"` omit `./package.json`) resolves the full runtime closure within `packagesDir` without lockfile parsing. Note: `src/__tests__/manifest-install.test.ts:53-56` is the only test comparing `entry.integrity` directly to `hashPackageTree` and will be updated in Task 6 to assert the closure hash.
    - **(g) Obscura CLI URL check and process flags:**
      - `packages/tools/web/src/obscura/cli.ts:125-133`: `validateObscuraWebUrl(input, allowedHostnames)` calls only synchronous URL-syntax `assertSsrfAllowedUrl(input, ...)` (`:128`) without resolving DNS before spawning the child in `runObscuraCli` (`:65-123`); its callers in `packages/tools/web/src/obscura/web.ts:72,118,153,202` are all inside `async execute(...)` handlers.
      - `packages/tools/web/src/obscura/process.ts:9-11,45-95`: `validateObscuraCommand` blocks `INSECURE_FLAGS = new Set(["--allow-private-network", "--allow-file-access"])` (`:9,66-68`) and non-loopback `--host` (`:10,70-76`) unless `allowInsecureFlags` is set, and runs with a minimal `PATH`/`HOME` env (`:98-105`).
    - **Single-principal security statement:** Single-principal deployments — `stdio`, memory transports, and loopback `websocket`/`http` binds without `authenticate` (where `connection.principal` is `undefined`, `apps/prism-agent/bin/remote-worker.ts:40`, `packages/hosts/remote/src/serve.ts:95`, `transports/network.ts:124`) — map all connections with `principal === undefined` to the single default principal key and treat that unauthenticated single-principal mode as operator-capable when `authenticate` is not configured. Every session, `remoteHostUi` request (including agent-scoped requests without `sessionId`), `deliverPending`, and `agent.event` notification behaves byte-for-byte identically to today.
    - **Per-task verdicts:**
      - **Task 2 (`prism-remote` principal partitioning):** Ready to execute as designed; `apps/prism-agent` uses stdio (`apps/prism-agent/bin/remote-worker.ts:40`) and needs no changes.
      - **Task 3 (wire allow-lists):** Ready to execute as designed; no existing test sends `modifiedArguments` over `prism-remote`.
      - **Task 4 (AG-UI narrow-only session ownership):** Ready to execute; `startSource`/`resumeSource` in `packages/hosts/ag-ui/src/handler.ts:223-275` must open `agent.session({ id: input.threadId, ..., ownership: authorization.ownership })` before `sse(...)` starts streaming so `SessionNotFoundError` and `OwnershipScopeError` return HTTP `404 ERR_PRISM_AG_UI_NOT_FOUND` prior to opening the SSE stream.
      - **Task 5 (Devtools Host/Origin gate):** Ready to execute; duplicate `hostOriginRejection` in `packages/hosts/devtools/src/security.ts` with a parity test against `packages/hosts/remote/src/http-gate.ts:6-20`, and add `allowedHosts` / `allowedOrigins` to `DevtoolsOptions` (plus `ServeDevtoolsOptions` type alias).
      - **Task 6 (Manifest closure integrity):** Ready to execute; updating `verifyInstalled` covers `loadManifest` (`src/manifest/load.ts:132`) and `configure`/`verify` (`src/manifest/maintain.ts:118,249`).
      - **Task 7 (Obscura DNS pre-check, coding shell warning, pinned-fetch proof):** Ready to execute; kernel exports `defaultResolver` and `assertSsrfAllowedUrl` from `@arnilo/prism`, `packages/tools/coding/src/index.ts:131,230-233` tracks `shellAvailable` and `sandbox`, and `requestPinned` (`src/pinned-fetch.ts:134-219`) is directly testable against an `.invalid` hostname.


- [x] Task 2: Partition `prism-remote` by principal
  - Acceptance Criteria:
    - Functional: `ServeAgentOptions.ownershipFor?: (principal: Principal) => OwnershipScope` is added. When set, every `sessions.open`, `sessions.list`, `run`, and `sessions.resume` passes that scope (plan 177 `SessionOptions.ownership` / `RunOptions.ownership`), so kernel narrowing enforces isolation.
    - Functional: Independently of `ownershipFor`, the server records the owning principal (`kind` + `id`) for each session it opens. A request from a different principal for that session id answers `session_not_found` (never revealing existence). `ServerState.sessions` is keyed by principal and session id.
    - Functional: `remoteHostUi` routes a request to a connection of the principal that owns `request.sessionId`; with no such connection it answers `unavailable` (the run suspends durably). A request with no `sessionId` (agent-scoped) goes only to connections of a principal the host marks as operator through `ServeAgentOptions.operator?: (principal) => boolean`; otherwise `unavailable`.
    - Functional: `deliverPending` on connect delivers only the connecting principal's sessions. Agent events with a `sessionId` reach only that session's owner; agent-scoped events (empty `sessionId`) reach operator principals only.
    - Functional: Single-principal transports (stdio, an unauthenticated loopback bind with the generated bearer token) keep today's behavior: every session belongs to the one principal.
    - Performance: Routing is a map lookup per request/event; no per-event scan over connections (asserted with 50 connections in a test).
    - Code Quality: The ownership map lives in `ServerState`; `host-ui.ts` gains a resolver injected by `serve.ts`, not a global. No change to the `prism.remote/1` frame shapes, so the protocol id is unchanged (confirmed in Task 1 (c)).
    - Security: Cross-principal access is impossible through any wire method; tested per method.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/remote/src/serve.ts:57-418`, `host-ui.ts:1-90`, `transports/network.ts:1-230`, `packages/hosts/remote/README.md`.
    - Options Considered:
      - Allowing one principal per served agent and rejecting a second. Rejected: a multi-user service is the enterprise case; it would force one process per user.
      - Relying only on `ownershipFor`. Rejected: hosts that do not configure it would still leak through the shared map and host-UI routing; the principal map is the floor.
    - Chosen Approach:
      - Principal-keyed state as the floor, kernel ownership as the optional second layer.
    - API Notes and Examples:
      ```ts
      serveAgent(agent, {
        transport: { kind: "websocket", hostname: "0.0.0.0", port: 8443 },
        authenticate: verifyJwt,
        ownershipFor: (p) => ({ tenantId: p.tenant, userId: p.id }),
        operator: (p) => p.kind === "service",
        hostUi,
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/src/serve.ts`, `host-ui.ts`, `transports/network.ts`, `types`/`index.ts` exports.
      - `packages/hosts/remote/src/__tests__/isolation.test.ts`: new.
      - `scripts/compat-baseline/arnilo__prism-remote.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`); additions only, diff in the note.
      - `packages/hosts/remote/README.md`, `docs/host-security.md`, `CHANGELOG.md`.
      - `apps/prism-agent/src/*` remote worker wiring if Task 1 finds it relies on cross-connection sharing (tentative).
    - References:
      - review finding "The remote host has no isolation between authenticated users" (2026-10-15).
  - Test Cases to Write:
    - `two_principals_are_isolated`: for each of `sessions.open(id)`, `sessions.messages`, `run`, `steer`, `abort`, `sessions.resume`, `commands.run` with `sessionId` → `session_not_found` for the other principal.
    - `approval_routes_to_owner`: user A's tool approval is asked of A's connection even when B connected later; fails with today's last-connected routing.
    - `secret_request_never_reaches_other_principal`.
    - `pending_delivery_is_owner_only`.
    - `events_are_owner_only`: B receives none of A's `session.opened`/`background.*` events.
    - `single_principal_unchanged`: the existing stdio and loopback suites pass unmodified.
    - `routing_is_constant_time`: 50 connections, request routing does not iterate connections (spy).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new serve options and isolation semantics.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: Configuration (`ownershipFor`, `operator`), "Multi-user deployments".
      - `docs/host-security.md`: remote isolation model.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - Partitioned `ServerState` in `packages/hosts/remote/src/serve.ts` by `principalKeyOf(principal)` (`""` for unauthenticated single-principal connections, `${kind}:${id}` for authenticated principals): `sessions: Map<string, Map<string, Session>>` (`principalKey -> (sessionId -> Session)`) plus `sessionOwners: Map<string, string>` (`sessionId -> principalKey`) for $O(1)$ ownership lookup.
    - Added `ServeAgentOptions.ownershipFor?: (principal: Principal) => OwnershipScope` and `ServeAgentOptions.operator?: (principal: Principal) => boolean`. Wired `scopeFor(state, principal)` into `sessions.open`, `sessions.list` (stripping client-supplied ownership keys `tenantId`/`userId`/`agentId`/`projectId`/`workId` before merging the server's scope), `run`, `sessions.resume`, and `deliverPending` resume. Mapped `OwnershipScopeError` to `RemoteError("session_not_found", "session not found")` so cross-principal store hits are indistinguishable from absent sessions.
    - Replaced the flat connection list in `packages/hosts/remote/src/host-ui.ts` with `HostUiBinding` (`byPrincipal: Map<string, RemoteUiConnection[]>`, `operators: RemoteUiConnection[]`, `ownerOf?: (sessionId: string) => string | undefined`) and injected `ownerOf` from `serveAgent` via internal `bindRemoteHostUiOwner(ui, fn)`. Session-scoped requests (`request.sessionId` non-empty) route in $O(1)$ to the owning principal's LIFO connection stack (or `unavailable` if none); agent-scoped requests (`sessionId` absent/empty) route only to `operators` (principals where `operator?.(principal) === true`, or unauthenticated single-principal connections).
    - Replaced per-connection `agent.subscribe` listeners with a shared `EventRouter` in `packages/hosts/remote/src/serve.ts`: `pendingOpens: Map<string, Set<string>>` registers the opening principal before `await state.agent.session(...)` so synchronous `session.opened` hooks route to the owner before `recordSession` runs; session-scoped events route in $O(1)$ to `byPrincipal.get(owner)` (falling back to `operators` for sessions opened directly in-process on the host agent), and agent-scoped events route only to `operators`.
    - Scoped `deliverPending` on `onInitialize` to `state.sessions.get(principalKey)` and tracked the negotiated `hostUi` capability via a connection-local `canHostUi` flag (since `dispatcher.capabilities.hostUi` is assigned after `onInitialize` returns in `dispatcher.ts`).
    - Added `packages/hosts/remote/src/__tests__/isolation.test.ts` with all 7 required tests (`two_principals_are_isolated`, `approval_routes_to_owner`, `secret_request_never_reaches_other_principal`, `pending_delivery_is_owner_only`, `events_are_owner_only`, `single_principal_unchanged`, `routing_is_constant_time`).
    - Updated `packages/hosts/remote/README.md`, `docs/host-security.md`, `CHANGELOG.md`, and `scripts/budgets.json` (root tarball packed/unpacked ceilings for the docs/CHANGELOG additions).
    - Compat-baseline diff (`scripts/compat-baseline/arnilo__prism-remote.txt`): `+0/-0` (`ownershipFor` and `operator` are interface properties on `ServeAgentOptions`, and `bindRemoteHostUiOwner`/`principalKeyOf` are package-internal exports not re-exported from `packages/hosts/remote/src/index.ts`).
    - Verification: `bun run typecheck`, `bun run --filter @arnilo/prism-remote test` (71 pass, 0 fail across 10 files), `bun run --filter @arnilo/prism-headless test` (26 pass), `bun run --filter @arnilo/prism-agent test` (38 pass), and `bun scripts/release.mjs gate --package @arnilo/prism-remote` all passed.

- [x] Task 3: Allow-list remote decisions and steer options
  - Acceptance Criteria:
    - Functional: `parseDecisions` accepts only `approvalId` (string ≤ 256), `outcome` (one of the four `ApprovalOutcome` values), `reason` (string ≤ 2 KiB), and `elicitation` (JSON object, only for pending elicitation decisions). Any other key, including `modifiedArguments`, is `invalid_params` unless `ServeAgentOptions.allowModifiedArguments: true`.
    - Functional: `steer` options accept only `softInterrupt: boolean`; other keys are `invalid_params`.
    - Functional: `sessions.list` query accepts only the documented `SessionListQuery` filter keys and a bounded `limit`/`cursor`; ownership keys from the client are dropped (the server's scope applies).
    - Functional: `sessions.open.parent` accepts only `SessionParentLink` string fields ≤ `MAX_SESSION_LINK_ID_LENGTH`.
    - Performance: n/a — constant-size validation.
    - Code Quality: One `wire.ts` module with the validators, reused by `serve.ts`; no `as never` casts left on wire input (asserted by a source scan in the test).
    - Security: With plan 177 Task 3, even an allowed `modifiedArguments` is re-gated; this task removes it from the default wire surface.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/remote/src/serve.ts:113-140,330-345`, `protocol.ts`.
    - Options Considered:
      - Relying on plan 177's re-gate alone. Rejected: defense in depth; a client-editable argument field is a surprise for most hosts.
    - Chosen Approach:
      - Strict allow-lists with an explicit opt-in.
    - API Notes and Examples:
      ```json
      { "method": "sessions.resume", "params": { "sessionId": "s1", "decisions": [{ "approvalId": "a1", "outcome": "allow_once" }] } }
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/src/wire.ts` (new), `serve.ts`, `protocol.ts` (docs comments).
      - `packages/hosts/remote/src/__tests__/wire.test.ts` (new).
      - `scripts/compat-baseline/arnilo__prism-remote.txt` (regenerated).
      - `packages/hosts/remote/README.md`, `CHANGELOG.md`.
    - References:
      - review finding (remote forwards `modifiedArguments`).
  - Test Cases to Write:
    - `decision_extra_keys_rejected`, `modified_arguments_require_opt_in`, `steer_options_allow_list`, `list_query_drops_ownership_keys`, `parent_link_bounded`, `no_unvalidated_casts_on_wire_input`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — wire validation and a new option.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: wire validation table.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - Created `packages/hosts/remote/src/wire.ts` with strict wire parameter validators (`parseDecisions`, `parseSteerOptions`, `parseSessionListQuery`, `parseSessionParentLink`, `parseRunOptions`, `parseInput`, `str`, `invalid`, `isObject`) and bounds (`MAX_APPROVAL_ID_LENGTH`, `MAX_SESSION_LIST_CURSOR_LENGTH`).
    - Updated `packages/hosts/remote/src/serve.ts` to add `ServeAgentOptions.allowModifiedArguments?: boolean`, read pending decisions on `sessions.resume` so `elicitation` is accepted only for pending `elicitation` decisions, wire `wire.ts` validators into `sessions.open`, `sessions.list`, `sessions.resume`, `run`, and `steer`, and remove all `as never` casts.
    - Updated `packages/hosts/remote/src/protocol.ts` with wire allow-list documentation comments on `RemoteMethods`, and aligned `packages/hosts/remote/src/__tests__/isolation.test.ts` (`parent: { sessionId: "root-bob" }`) with `SessionParentLink`.
    - Added `packages/hosts/remote/src/__tests__/wire.test.ts` with all 6 required tests (`decision_extra_keys_rejected`, `modified_arguments_require_opt_in`, `steer_options_allow_list`, `list_query_drops_ownership_keys`, `parent_link_bounded`, `no_unvalidated_casts_on_wire_input`).
    - Updated `packages/hosts/remote/README.md`, `CHANGELOG.md`, `scripts/budgets.json` (root tarball packed/unpacked ceilings), and regenerated `scripts/compat-baseline/arnilo__prism-remote.txt` (`+11/-0` declarations from `wire.ts`, 0 removals or signature breaks).
    - Verification: `bun run typecheck`, `bun run --filter @arnilo/prism-remote test` (77 pass, 0 fail across 11 files), `bun run --filter @arnilo/prism-headless test` (26 pass), `bun run --filter @arnilo/prism-agent test` (38 pass), `bun test --timeout=0 src/__tests__/docs.test.ts` (64 pass), `bun scripts/release.mjs gate --package @arnilo/prism-remote`, and `bun scripts/release.mjs gate --package @arnilo/prism` all passed.

- [x] Task 4: AG-UI on narrow-only session ownership
  - Acceptance Criteria:
    - Functional: `runSource` and `resumeSource` open the session with `agent.session({ id: threadId, create, ownership: authorization.ownership })` and pass the same scope on the run (`packages/hosts/ag-ui/src/handler.ts:232,261`).
    - Functional: A `SessionNotFoundError` or `OwnershipScopeError` maps to a `404 ERR_PRISM_AG_UI_NOT_FOUND` before the SSE stream opens; the response never distinguishes "absent" from "another user's".
    - Functional: The in-memory `pending` map records the owning scope with each interrupt; a resume from a different scope is rejected as a foreign interrupt (400, as today for a wrong thread).
    - Functional: The README states that hosts should generate thread ids (or namespace client ids) to avoid id squatting, since `create: true` on an id another scope owns now fails closed.
    - Performance: n/a — same number of store reads.
    - Code Quality: No new options; the change is internal to the handler.
    - Security: Two users on one agent cannot read or resume each other's threads (test).
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/ag-ui/src/handler.ts:108-275`, `types.ts:1-10`, plan 177 Task 4.
    - Options Considered:
      - Requiring one agent per user. Rejected: not how `authorize` is documented, and expensive.
    - Chosen Approach:
      - Use the kernel's narrow-only scope everywhere the handler touches a session.
    - API Notes and Examples:
      ```ts
      createAgUiHandler(agent, { authorize: async ({ request }) => ({ ownership: { tenantId, userId } }) });
      ```
    - Files to Create/Edit:
      - `packages/hosts/ag-ui/src/handler.ts`, `packages/hosts/ag-ui/src/errors.ts`, `packages/hosts/ag-ui/src/__tests__/isolation.test.ts` (new), `packages/hosts/ag-ui/README.md`, `CHANGELOG.md`.
    - References:
      - plan 177 Task 4.
  - Test Cases to Write:
    - `foreign_thread_is_404`, `foreign_interrupt_resume_rejected`, `same_user_resumes`, `absent_and_foreign_are_indistinguishable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — isolation behavior.
    - Docs pages to create/edit:
      - `packages/hosts/ag-ui/README.md`: "Cost, security, and failure behavior" section.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - Updated `runSource` (formerly `startSource`) and `resumeSource` in `packages/hosts/ag-ui/src/handler.ts` to await `agent.session({ id: input.threadId, create, ownership: authorization.ownership })` before `sse(...)` begins streaming and pass `ownership: authorization.ownership` on `session.stream` and `session.resume`.
    - Added `"ERR_PRISM_AG_UI_NOT_FOUND"` to `AgUiErrorCode` in `packages/hosts/ag-ui/src/errors.ts` and mapped `isSessionNotFound(error)` and `ERR_PRISM_OWNERSHIP_WIDEN` (`OwnershipScopeError`) in `errorResponse` to `404 ERR_PRISM_AG_UI_NOT_FOUND` (`{"error":{"code":"ERR_PRISM_AG_UI_NOT_FOUND","message":"Session not found"}}`) prior to opening the SSE stream.
    - Extended the in-memory `pending` interrupt map (`PendingInterrupt`) to store a cloned `ownership` scope when `interruptEvent` records a suspension, and verified `sameOwnership(record.ownership, ownership)` in `readResumeDecisions` so cross-scope resumes fail closed with `400 ERR_PRISM_AG_UI_INPUT` (`"Resume does not match the pending interrupt"`).
    - Added `packages/hosts/ag-ui/src/__tests__/isolation.test.ts` with all 4 required tests (`foreign_thread_is_404`, `foreign_interrupt_resume_rejected`, `same_user_resumes`, `absent_and_foreign_are_indistinguishable`).
    - Updated `packages/hosts/ag-ui/README.md` (including the "Cost, security, and failure behavior" section and thread-id squatting guidance), `CHANGELOG.md`, and `scripts/budgets.json` (`kernel.packedBytes` / `kernel.unpackedBytes` ceilings for the CHANGELOG entry).
    - Compat-baseline diff (`scripts/compat-baseline/arnilo__prism-ag-ui.txt`): `+0/-0`.
    - Verification: `bun run typecheck`, `bun run --filter @arnilo/prism-ag-ui test` (86 pass, 0 fail across 14 files), `bun test --timeout=0 src/__tests__/docs.test.ts` (64 pass), `bun scripts/release.mjs gate --package @arnilo/prism-ag-ui --allow-break`, and `bun scripts/release.mjs gate --package @arnilo/prism --allow-break` all passed.

- [x] Task 5: Devtools Host/Origin gate
  - Acceptance Criteria:
    - Functional: Every devtools route rejects a request whose `Host` header is not in the allowed set (`403 ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST`) and a request with an `Origin` header outside the allowed origins (`403 ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN`). Defaults are the bound loopback host/port pairs, exactly as `packages/hosts/remote/src/http-gate.ts:6-20` computes them.
    - Functional: `ServeDevtoolsOptions.allowedHosts` / `allowedOrigins` override the defaults; a non-loopback bind still requires the token.
    - Performance: n/a.
    - Code Quality: The host/origin check is shared: either moved to a small helper exported by `@arnilo/prism-remote` and reused, or duplicated with a parity test against remote's helper. The Task 1 review picks one; the note records why.
    - Security: A DNS-rebinding page can no longer read transcripts from a loopback devtools server.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/devtools/src/serve.ts:56-135`, `packages/hosts/remote/src/http-gate.ts`, `packages/hosts/mcp-server/src/server.ts` (origin checks).
    - Options Considered:
      - Requiring a token on loopback too. Rejected: hurts the local dev loop; the Host check closes the rebinding vector without it.
    - Chosen Approach:
      - Host/Origin allow-list parity with remote and MCP.
    - API Notes and Examples:
      ```ts
      serveDevtools(agent, { port: 7777 }); // Host: evil.example → 403
      ```
    - Files to Create/Edit:
      - `packages/hosts/devtools/src/serve.ts`, `packages/hosts/devtools/src/__tests__/serve.test.ts`, `packages/hosts/devtools/README.md`, `scripts/compat-baseline/arnilo__prism-devtools.txt` (regenerated if options are exported types), `CHANGELOG.md`.
    - References:
      - review finding (devtools rebinding).
  - Test Cases to Write:
    - `foreign_host_rejected`, `foreign_origin_rejected`, `loopback_host_allowed`, `custom_allowed_hosts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options and rejections.
    - Docs pages to create/edit:
      - `packages/hosts/devtools/README.md`: Configuration and security notes.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - Placed `hostOriginRejection` and `DevtoolsHostOriginOptions` in `packages/hosts/devtools/src/security.ts` to keep `@arnilo/prism-devtools` dependency-free (with zero runtime dependencies beyond peer `@arnilo/prism`), rejecting mismatched `Host` headers with `403 ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST` and disallowed `Origin` headers with `403 ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN`.
    - Added `ServeDevtoolsOptions` (`export type ServeDevtoolsOptions = DevtoolsOptions`) with `allowedHosts?: readonly string[]` and `allowedOrigins?: readonly string[]` in `packages/hosts/devtools/src/serve.ts` and re-exported from `packages/hosts/devtools/src/index.ts`.
    - Bound defaults in `serveDevtools` to loopback host/port pairs (`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`) and loopback origins (`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`, `http://[::1]:${boundPort}`), matching `packages/hosts/remote/src/http-gate.ts:6-20`.
    - Added test suite in `packages/hosts/devtools/src/__tests__/serve.test.ts` with all 4 required test cases (`foreign_host_rejected`, `foreign_origin_rejected`, `loopback_host_allowed`, `custom_allowed_hosts`) plus an exhaustive parity test against `packages/hosts/remote/src/http-gate.ts` `hostOriginRejection` covering valid/invalid/missing hosts, case normalization, and valid/invalid/missing origins.
    - Updated `packages/hosts/devtools/README.md` (usage options and security notes), `CHANGELOG.md`, `scripts/budgets.json` (`kernel.packedBytes` 1046457 / `kernel.unpackedBytes` 3403776 ceilings for the CHANGELOG entry), and generated `scripts/compat-baseline/arnilo__prism-devtools.txt`.
    - Verification: `bun run typecheck`, `bun run --filter @arnilo/prism-devtools test` (38 pass, 0 fail across 4 files), `bun test --timeout=0 src/__tests__/docs.test.ts` (64 pass), `bun scripts/release.mjs gate --package @arnilo/prism-devtools`, and `bun scripts/release.mjs gate --package @arnilo/prism --allow-break` all passed.

- [x] Task 6: Manifest integrity over the dependency closure
  - Acceptance Criteria:
    - Functional: `install` records `integrity` as the canonical hash over the installed package **and every package in its runtime dependency closure** (dependencies and non-optional peers, resolved with Node resolution from the managed project, each hashed with the existing tree hash, combined in sorted name order). `verifyInstalled` recomputes the same closure before any `import()`.
    - Functional: A changed byte in any closure package, a missing closure package, or a symlink anywhere in the closure is `integrity_mismatch` / `package_missing`, naming the package and the dependency.
    - Functional: The manifest JSON Schema (`src/manifest/schema.ts`, `manifest/schema.json`) documents the new meaning; no new field. Entries written before this change fail with `integrity_mismatch` and the error tells the user to run `prism add` again (0.13.0 is the first release with the manifest, so no published manifest exists).
    - Performance: State the cost in `docs/manifest.md`: load-time hashing now covers the closure. Measure and record (in the note) load time for `@arnilo/prism-tools-coding` before and after; the closure walk is bounded by the existing `MAX_TREE_FILES` / `MAX_TREE_BYTES` per package and a new `MAX_CLOSURE_PACKAGES` (default 512).
    - Code Quality: Closure resolution lives in `src/manifest/integrity.ts`; no npm or Bun lockfile parsing.
    - Security: A tampered transitive dependency can no longer run code from a manifest-loaded package.
  - Approach:
    - Documentation Reviewed:
      - `src/manifest/integrity.ts:1-114`, `install.ts:190-260`, `load.ts`, `definition.ts:55-75`, `docs/manifest.md`; Bun hoisted linker layout (`bunfig.toml` `[install] linker = "hoisted"`).
    - Options Considered:
      - Verifying `bun.lock` integrity fields. Rejected: those hash registry tarballs, not the extracted files that are imported.
      - A per-dependency hash map in the manifest. Rejected: grows the manifest format for no extra safety; one closure hash detects the same tampering.
    - Chosen Approach:
      - Closure hash under the existing `integrity` field.
    - API Notes and Examples:
      ```bash
      prism add @arnilo/prism-tools-coding   # records the closure hash
      # editing node_modules/<dep>/index.js → loadManifest throws integrity_mismatch naming <dep>
      ```
    - Files to Create/Edit:
      - `src/manifest/integrity.ts`, `src/manifest/install.ts`, `src/manifest/load.ts`, `src/manifest/schema.ts`, `scripts/emit-manifest-schema.mjs` output.
      - `src/__tests__/manifest-integrity.test.ts` (new or extended), `src/__tests__/manifest-load.test.ts`.
      - `docs/manifest.md`, `CHANGELOG.md`.
    - References:
      - review finding (integrity covers only the package directory).
  - Test Cases to Write:
    - `tampered_dependency_detected`, `missing_dependency_detected`, `symlinked_dependency_refused`, `closure_bound_enforced`, `unchanged_closure_loads`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — what `integrity` covers.
    - Docs pages to create/edit:
      - `docs/manifest.md`: integrity section with the cost note.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - Implemented dependency closure resolution and hashing in `src/manifest/integrity.ts`: added `MAX_CLOSURE_PACKAGES` (512 limit), `resolveDependencyDir` (Node resolution within `packagesDir`), `hashPackageClosure`, and `HashPackageClosureOptions`/`HashPackageTreeContext` naming the root package and failing dependency on missing packages, symlinked candidates/files, or file/byte/closure bound breaches.
    - Extended `ManifestErrorOptions` and `ManifestError` (`src/manifest/errors.ts`) with optional `dependency?: string` property so failures name both `package` and `dependency`.
    - Updated `verifyInstalled` in `src/manifest/integrity.ts` and `install` in `src/manifest/install.ts` to compute and verify the canonical sha512 integrity over the sorted dependency closure (`hasher.update(`${pkg.name}\0${pkg.hash}\0`)`).
    - Entries written before this change fail `verifyInstalled` with `integrity_mismatch` and advise reinstalling via `prism add <package>`.
    - Updated `src/manifest/schema.ts` description of `integrity` to define closure hashing semantics, and regenerated `manifest/schema.json` via `scripts/emit-manifest-schema.mjs`.
    - Exported `MAX_CLOSURE_PACKAGES`, `hashPackageClosure`, `HashPackageClosureOptions`, and `HashPackageTreeContext` from `src/manifest/index.ts` and updated `src/__tests__/public-export-contract.test.ts` frozen manifest exports table.
    - Measured and documented load-time hashing cost in `docs/manifest.md`: for `@arnilo/prism-tools-coding`, single-package tree hash was ~2.5 ms; closure hash across coding and its runtime dependency (`diff`, ~70 files total) measured ~4.3 ms on Bun 1.4.2 linux x64.
    - Added comprehensive test suite `src/__tests__/manifest-integrity.test.ts` with 8 tests: `tampered_dependency_detected`, `missing_dependency_detected`, `symlinked_dependency_refused` (symlinked dir and symlinked file), `closure_bound_enforced`, `unchanged_closure_loads`, `transitive_dependency_tampered_fails`, `optional_peer_dependency_not_required`, and `old_integrity_format_fails_with_reinstall_guidance`.
    - Updated `src/__tests__/manifest-install.test.ts` to verify closure hashing over single-tree hash.
    - Added CHANGELOG entry under `### Changed` documenting closure integrity verification and `error.dependency`.
    - Rebaselined kernel size ceilings in `scripts/budgets.json` (`packedBytes` 1048699, `unpackedBytes` 3413842, `rootExports` 1436, `sourceLines` 35406, and `@arnilo/prism` baseline 1436).
    - Verification: `bun run build:core`, `bun run typecheck`, `bun test src/__tests__/manifest-*.test.ts` (53 pass), `bun test src/__tests__/public-export-contract.test.ts` (33 pass), `bun test --timeout=0 src/__tests__/docs.test.ts` (64 pass), and `bun scripts/release.mjs gate --package @arnilo/prism --allow-break` all passed.


- [x] Task 7: Obscura DNS pre-check, coding shell visibility, pinned-fetch proof
  - Acceptance Criteria:
    - Functional: Obscura: before spawning, the fetch resolves the target hostname with the kernel's `defaultResolver` and rejects any private, loopback, link-local, or metadata answer through `assertSsrfAllowedUrl` on each address (`ERR_OBSCURA_SSRF`). The README states the remaining time-of-check gap (the binary resolves again) and recommends the contained-proxy pattern the browser package already requires.
    - Functional: Coding: when `sandbox` is `"none"` and the `shell` tool is registered, setup emits `status.note("warn", "shell runs on the host without a sandbox; pair it with @arnilo/prism-approval or set sandbox")`. The README gains an "Enterprise deployment" section: sandbox backend, approval package, `commandRules`, egress rules.
    - Functional: Pinned fetch: a test requests `http://<unresolvable>.invalid:<port>/` through `requestPinned` with the pinned address `127.0.0.1` and receives the local server's body, proving the `lookup` hook is honored under Bun.
    - Performance: Obscura adds one DNS resolution per fetch (stated in its README); nothing else changes.
    - Code Quality: Obscura reuses the kernel's `assertSsrfAllowedUrl`/resolver exports (or their plan 179 subpath, whichever lands first); no copied SSRF code.
    - Security: As stated per item.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/web/src/obscura/cli.ts:120-135`, `packages/tools/coding/src/index.ts:96-140`, `src/pinned-fetch.ts:126-200`, `src/__tests__/pinned-fetch.test.ts:18-68`.
    - Options Considered:
      - Defaulting the coding shell off without a sandbox. Rejected for 0.13.0: it changes the documented default of an existing package; a visible warn note plus docs is the proportionate fix, and Further Actions can revisit.
    - Chosen Approach:
      - Pre-resolution check, visibility, and a real proof test.
    - API Notes and Examples:
      ```ts
      agent.inspect().packages.find((p) => p.name === "@arnilo/prism-tools-coding")?.notes; // includes the warn note
      ```
    - Files to Create/Edit:
      - `packages/tools/web/src/obscura/cli.ts`, `packages/tools/web/src/obscura/__tests__/ssrf.test.ts`, `packages/tools/web/README.md`.
      - `packages/tools/coding/src/index.ts`, `packages/tools/coding/src/__tests__/package.test.ts` (tentative name), `packages/tools/coding/README.md`.
      - `src/__tests__/pinned-fetch.test.ts`.
      - `CHANGELOG.md`.
    - References:
      - review findings (Obscura SSRF, coding default, pinned-fetch test gap).
  - Test Cases to Write:
    - `obscura_rejects_private_resolution`, `obscura_allows_public_resolution` (injected resolver).
    - `coding_unsandboxed_shell_warns`, `coding_sandboxed_shell_no_warn`, `coding_shell_disabled_no_warn`.
    - `pinned_lookup_is_honored_for_unresolvable_host`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new rejections and a status note.
    - Docs pages to create/edit:
      - `packages/tools/web/README.md`, `packages/tools/coding/README.md`.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - Obscura DNS pre-check: Updated `validateObscuraWebUrl` in `packages/tools/web/src/obscura/cli.ts` to be async, pre-resolve hostnames via `resolver ?? defaultResolver`, and validate each resolved address candidate against `assertSsrfAllowedUrl(`${parsed.protocol}//${literal}`)`, rejecting private, loopback, link-local, and metadata addresses with `ERR_OBSCURA_SSRF`. Added `resolver?: MediaHostnameResolver` to `ObscuraWebToolsOptions` in `web.ts` and passed `resolver` and `context.signal` into `await validateObscuraWebUrl(...)` on `web_search`, `web_fetch`, `obscura_fetch`, and `obscura_scrape`. Exported `ValidateObscuraUrlOptions` from `cli.ts` and `obscura/index.ts`. Documented the DNS pre-check, single-resolution cost, time-of-check gap, and contained-proxy pattern in `packages/tools/web/README.md`. Added test suite in `packages/tools/web/src/obscura/__tests__/ssrf.test.ts` covering `obscura_rejects_private_resolution` and `obscura_allows_public_resolution` with injected resolvers, and updated `cli.test.ts` and `web.test.ts`.
    - Coding unsandboxed shell visibility: In `packages/tools/coding/src/index.ts`, tracked whether `shell` is registered and emitted `status.note("warn", "shell runs on the host without a sandbox; pair it with @arnilo/prism-approval or set sandbox")` when `sandbox === "none"`. Added "Enterprise deployment" section to `packages/tools/coding/README.md` covering sandbox backends, `@arnilo/prism-approval`, `commandRules`, and `egress` policies. Added test cases in `packages/tools/coding/src/__tests__/package.test.ts` (`coding_unsandboxed_shell_warns`, `coding_sandboxed_shell_no_warn`, `coding_shell_disabled_no_warn`).
    - Pinned fetch proof: Added `pinned_lookup_is_honored_for_unresolvable_host` in `src/__tests__/pinned-fetch.test.ts` proving that `requestPinned` against an unresolvable `.invalid` hostname routes to a local loopback listener via the pinned address under Bun.
    - Updated `CHANGELOG.md` under `### Fixed` with entries for all three items.
    - Pruned 22 stray-emitted `.js` files from `src/driver-kit/`, generated `scripts/compat-baseline/arnilo__prism-tools-web.txt` and `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, and updated `scripts/budgets.json` ceilings (`packedBytes` 1049175, `unpackedBytes` 3415133, `fileCount` 356).
    - Verification: `bun run build:core`, `bun run typecheck`, `bun test packages/tools/web/src/obscura/__tests__/` (55 pass), `bun test packages/tools/coding/src/__tests__/package.test.ts` (10 pass), `bun test --timeout=0 src/__tests__/pinned-fetch.test.ts` (10 pass), `bun test --timeout=0 src/__tests__/docs.test.ts` (64 pass), `bun scripts/release.mjs gate --package @arnilo/prism-tools-web`, `bun scripts/release.mjs gate --package @arnilo/prism-tools-coding`, and `bun scripts/release.mjs gate --package @arnilo/prism --allow-break` all passed.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-remote test && bun run --filter @arnilo/prism-ag-ui test && bun run --filter @arnilo/prism-devtools test && bun run --filter @arnilo/prism-tools-web test && bun run --filter @arnilo/prism-tools-coding test && bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/pinned-fetch.test.ts src/__tests__/manifest-load.test.ts src/__tests__/manifest-integrity.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run security:threat-suites`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- **Obscura time-of-check gap:** `validateObscuraWebUrl` performs pre-resolution validation against private/SSRF targets before spawning, but the child process and browser binary resolve hostnames independently at fetch time. Closing the rebinding window entirely requires network-level egress containment (e.g. an egress proxy or network namespace isolation), as documented in `packages/tools/web/README.md` and required by `@arnilo/prism-tools-browser`.
- **Coding shell warning rather than default flip:** For 0.13.0 backward compatibility with existing configurations, `sandbox: "none"` remains the default rather than disabling `shell` outright; visibility is provided via `status.note("warn", ...)` and the Enterprise Deployment documentation section.

## Further Actions

- Phase 12 / 1.0: Provide an optional integrated proxy mode for Obscura CLI runs in environments lacking external container or network namespace isolation.
- Phase 12: Consider defaulting `shell: { enabled: false }` when `sandbox: "none"` in a future major version release.
