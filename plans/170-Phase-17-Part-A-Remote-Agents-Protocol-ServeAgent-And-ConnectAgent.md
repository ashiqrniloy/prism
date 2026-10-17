# Phase 17 Part A — Remote agents: `prism.remote/1`, `serveAgent`, `connectAgent`, and the `rpc` retirement

## Objectives

- Run the phase review for **both parts** of Phase 17. Settle the open contract questions before code starts: where `remoteConformance` lives, the JSON-RPC framing, how a served agent's `HostUi` is bound, the proxy `Agent` shape, the attribution merge rule, mirroring, authentication, the `rpc` retirement inventory, and Part B's route, channel, and scheduler inputs.
- Create `@arnilo/prism-remote` (`packages/hosts/remote/`), a host library on the public `@arnilo/prism` API. It ships a versioned JSON-RPC 2.0 protocol (`prism.remote/1`) with capability negotiation.
- Ship `serveAgent(agent, { transport, authenticate?, limits?, hostUi? })`. A `HostUi` request goes to the connected client. With no client, or after a disconnect, the run suspends durably and resumes when a client answers.
- Ship `connectAgent(endpoint, { mirror?, host? })`, which returns an `Agent` proxy:
  - forwarded events keep their catalog type and gain `origin.remote`
  - tool events carry `executedBy: "external"`
  - the remote's `HostUi` requests go to the local `host.ui`
  - `mirror: store` archives the remote session into a local store with `parent` links
- Ship the stdio, WebSocket, and HTTP-with-SSE transports. Authentication is a loopback bearer token by default, or a host `authenticate` hook that maps a caller to a `principal`. Host/Origin gates and bounded bodies apply.
- Ship `remoteConformance(agentFactory)` and run it on every transport.
- Delete `src/rpc.ts` and `prism --mode rpc` from the kernel, with no alias.
- Prove the part with `examples/remote-agent.ts`, offline.

## Expected Outcome

- `serveAgent(agent, { transport: { kind: "stdio" } })` serves any `Agent`. A client opens, lists, and resumes sessions, runs with events streamed as `run.event` notifications (`AgentEvent`s unchanged), steers, aborts, lists and runs commands, reads `inspect`, and answers `hostUi.request`s.
- `await connectAgent({ kind: "stdio", command })` returns an `Agent` that a workflow `agentNode` runs exactly as it runs an in-process agent. Its events carry `origin.remote` (the endpoint id), and its tool events carry `executedBy: "external"`. A local `tool.call` hook never fires for a remote tool call.
- A disconnect during a pending approval leaves the remote run suspended (`suspended_run` on the remote's store). A later client answer resumes it to completion.
- With `mirror: store`, the remote session's messages land in the local store with `parent` links, and `createSessionIndex(store).search({ query, workflowRunId })` finds them next to the host's own messages.
- A wrong token, a wrong Origin, a wrong Host, and an oversized body are each rejected, and the token never appears in events, `inspect()`, errors, or logs.
- `remoteConformance` passes on stdio, WebSocket, and HTTP with SSE.
- `src/rpc.ts`, `src/__tests__/rpc.test.ts`, `--mode rpc`, `runRpcServer`, and `parseRpcRequest` are gone. The compat baseline records the removals.
- `examples/remote-agent.ts` runs offline under the execution gate.

This plan implements roadmap **Phase 17 — Headless host libraries: remote agents, `HostUi` routing, and scheduling**, Part A. Plan 171 (Part B) ships `@arnilo/prism-headless` (`routeHostUi`, `createScheduler`), the channel route, `examples/headless-host.ts`, and the Phase 17 Done record. It depends on this plan. **Task 1 is the phase review for both parts**, because the phase creates two host libraries and may need a kernel addition (Task 1 (d), (e)). Plan 171 opens with an entry check. The K3 Scope bullet is already met: `EventOrigin.remote` landed with Phase 13 (`src/contracts-protocol.ts:199`, `docs/next/events.md:29`), so Task 8 only writes its attribution rules. Unusual points:
- `remoteConformance` cannot live in the kernel's `/testing` because the kernel never imports a package. Task 1 (a) places it in `@arnilo/prism-remote/testing`, following plan 166 (j), and records the conflict for the user to confirm.
- Retiring `src/rpc.ts` also removes the kernel CLI's `--mode rpc` (`src/cli-runner.ts:16,245`). The `print` and `json` modes stay until the Phase 11 sweep.

This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`. Lab impact (probe 12): `packages/prism-code` imports neither `rpc` nor anything this plan creates (Task 1 (k) confirms it with `rg`), so no lab module becomes deletable.

## Tasks

- [x] Task 1: Phase 17 review — remote protocol, `HostUi` binding, proxy shape, retirement inventory, and Part B inputs (read-only)
  - Acceptance Criteria:
    - Functional: **Entry check.** Confirm from source and the plan 161, 162, 163, 168, and 169 notes that each dependency shipped as recorded, citing `file:line`:
      - `EventOrigin.remote` (`src/contracts-protocol.ts:193-207`) and its docs line (`docs/next/events.md:29`)
      - the kernel ask path: inline `host.ui` confirm, then suspension on `unavailable` or no UI (`src/agent-session/session/assemble.ts:84-143`), and `stageAskDecisions` with `decision.pending` (`src/agent-session/session/tool-round.ts:211-232`)
      - the elicitation suspension for `ask_user` (`packages/tools/coding/src/ask-user-host.ts:6-8,41`)
      - `session.resume(decisions)` and its fail-closed rules (`src/contracts-run-state.ts:340-350`), plus the public `SuspendedRunEntryData` with `interruption.pendingDecisions` (`src/suspended-run.ts:21-30`)
      - the host-library precedents `acpHost()` (`packages/hosts/acp/src/host.ts:9-36`) and `serveAcp` (`packages/hosts/acp/src/serve.ts:22-61`)
      - the Host/Origin gate (`packages/hosts/mcp-server/src/server.ts:191-202`) and the devtools bearer guard (`packages/hosts/devtools/src/security.ts:2-31`)
      - `createSessionIndex` (`src/agent/sessions.ts:29-62`), `SESSION_LINKS_DATA_KEY` (`src/contracts-core/session.ts:115`, exported at `src/index.ts:240`), and the link legs of `storeConformance` (`src/testing/store-conformance.ts:481-504`)
      - `agentNode`'s use of `Agent` (`packages/integrations/workflows/src/nodes/agent-node.ts:76-80`, `types.ts:143-155`) and `startWorkflow` (`parent-session.ts:66`)
      - the `CheckpointStore`/`LeaseStore` contracts (`packages/integrations/workflows/src/contracts.ts:70-112`) and their store implementations
      - `createJsonRpcPeer`/`readJsonl` (`src/driver-kit/process/json-rpc.ts:6-43`, public via `@arnilo/prism/driver-kit`) and `readSseEvents` (`src/provider-kit/transport.ts:186`, public via `@arnilo/prism/provider-kit`)
    - Functional: Decide, with evidence. Recommended answers are below. Record each decision and any amendment to Tasks 2–8 here and to plan 171.
      - (a) **`remoteConformance` placement.** The roadmap puts it in `/testing`, but it must call `serveAgent` and `connectAgent`, and `src/` never imports a package (roadmap §1.4). Recommended: `@arnilo/prism-remote/testing`, a package subpath, as plan 166 (j) did for `adapterConformance`. Record it as a roadmap conflict for the user to confirm.
      - (b) **JSON-RPC framing.** `createJsonRpcPeer` is stream-based JSONL and handles one concurrent inbound request by default (`json-rpc.ts:6-20`). WebSocket and SSE are message-framed, and both ends issue requests (`hostUi.request` goes server to client). Recommended: one frame-level dispatcher in `prism-remote` (`send(frame)`, an inbound frame iterator, bounded concurrent requests, a per-frame byte cap) shared by all three transports. Stdio reads frames with the public `readJsonl`. Reject reusing `createJsonRpcPeer` for stdio only, because then the transports diverge on errors and limits.
      - (c) **Protocol table.** Confirm the method list below covers every Scope item and Done criterion. Confirm `initialize` negotiates `protocol: "prism.remote/1"` and both sides' capabilities, and that an unknown major version is rejected with `protocol_unsupported` before any session opens.
      - (d) **`HostUi` binding on the server.** `serveAgent` receives an `Agent` whose `config.host` is already fixed. Recommended: `remoteHostUi()` returns a `HostUi` that the host passes to `createAgent({ host: { ui } })`, directly or as a Part B route, and also to `serveAgent(agent, { hostUi })`. `serveAgent` binds the connected client to it. Unbound, it answers `unavailable`. Then:
        - kernel asks suspend durably through the existing path (`assemble.ts:131-140`)
        - `ask_user` suspends through its elicitation contract
        - other package requests fail closed under their own package contract. This is documented, not changed.

        Reject `acpHost`-style branding (`isAcpHost`): it hides the binding, and Part B needs the same object as a route. Proof for "no kernel addition": both suspension paths already exist, and the binding uses only `HostUi`.
      - (e) **Resume after a disconnect.** Recommended: no server memory is required. When a client initializes, or opens a session that has a pending suspension, the server sends one `hostUi.request` per pending decision. It reads them from the live `run.suspended` event, or after a restart from the latest `suspended_run` entry in `session.entries()` (`SuspendedRunEntryData.interruption.pendingDecisions`). The answer becomes `session.resume(decisions)`. When two answers race, the first resume wins and the second fails closed in `session.resume`. Verify the second failure from source. If reading `suspended_run` through `entries()` is not enough, record the gap and stop: a kernel accessor needs its own proof.
      - (f) **The proxy `Agent`.** `agentNode` uses only `agent.id` and `agent.session(...)` (`agent-node.ts:76-80`), and `workflowCommand` uses `session()` and `commands.run` (`command.ts:47-49`). Recommended:
        - `id` is the remote agent's id
        - `config` is a frozen minimal `ResolvedAgentConfig` with `id`, `name`, and no model
        - `tools` and `skills` are frozen from the `initialize` result
        - `sessions` and `commands` go over RPC
        - `models.list()` goes over RPC, and `models.resolve()` throws `remote_unsupported`
        - `inspect()` stays synchronous. It returns the inspection cached at connect plus a `remote` block (endpoint id, protocol version, capabilities, no token)
        - `subscribe()` forwards agent-scoped events
        - `dispose()` closes the connection

        Reject building the proxy as a driver-kit loop over `RunController.observe`. `observe` remaps catalog events into `agent.*` package events (§2.12.9 K2), which breaks "keep their catalog type", and §2.13.4 rules out adapter normalization for Prism-built agents.
      - (g) **Attribution merge rule.** Recommended:
        - An event with no `origin` gains `{ kind: "prism", agent: <remote name>, agentId: <remote id>, remote: <endpoint id>, depth: 0 }`.
        - An event with an `origin` keeps it and gains `remote` only when it has none. The innermost endpoint wins, so a two-hop chain names the hop nearest the event.
        - Every `tool.*` event gets `executedBy: "external"`.
        - The proxy never runs a local hook bus, so no local `tool.call` fires. Verify that no kernel code path re-emits proxied events through a local `RunController`.
      - (h) **Mirroring.** Recommended: the proxy writes the mirror from the event stream into the given `SessionStore`:
        - first, a `metadata` entry with `data[SESSION_LINKS_DATA_KEY] = { ...SessionOptions.parent, actor: { kind: "prism", agent } }` and `metadata.remote`
        - then a `message` entry for each `message.completed`, chained by `parentId` and stamped with the proxy's `ownership`

        Confirm that `storeConformance`'s link legs and `searchSessions` find such entries. Also decide the actor kind: `"prism"`, because the remote is a Prism agent and `remote` already marks the hop. Reject fetching remote entries after each run: it adds a method the Scope does not list.
      - (i) **Authentication and HTTP gates.** Recommended:
        - Loopback by default, with a random 32-byte bearer token generated at start. It is readable only from the server handle and compared in constant time (as `security.ts:28-31` does). A host may pass `token: "env:NAME" | "keyring:name"` instead. A literal is refused.
        - `authenticate(request) → { principal } | undefined` replaces the token check, and its principal goes into every run and resume of that connection.
        - Binding a non-loopback hostname without `authenticate` fails closed.
        - Copy the `hostOriginRejection` semantics (exact, case-insensitive) into `prism-remote` with parity tests. Reject depending on `@arnilo/prism-mcp-server`, which brings `@modelcontextprotocol/server` and `zod` (`packages/hosts/mcp-server/package.json:21-25`).
      - (j) **Transports on Bun.** Recommended:
        - Stdio: the served process's own stdin and stdout. The client spawns `command`.
        - WebSocket: `Bun.serve({ websocket })` on the server and the global `WebSocket` on the client.
        - HTTP with SSE: `POST /rpc` carries client-to-server frames and client answers. `GET /events` (SSE) carries server-to-client notifications and requests, and the client reads it with `readSseEvents`.

        No runtime dependency. Confirm with a Bun 1.4.2 spike that `Bun.serve` exposes request headers to `websocket.upgrade` for the Host, Origin, and token checks.
      - (k) **`rpc` retirement inventory.** List every hit of `rg -n 'runRpcServer|parseRpcRequest|RpcServerOptions|RpcSessionFactory|RpcCommandName|rpc\.js|--mode rpc|"rpc"' src packages apps scripts examples docs README.md -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**'` and assign each to Task 7. Known so far:
        - `src/rpc.ts`, `src/__tests__/rpc.test.ts`
        - `src/cli-runner.ts:16,20,57,154,245-246`
        - `README.md:151` with its pin at `src/__tests__/docs.test.ts:3180`
        - `examples/rpc.ts` with `examples/README.md:35,237` and `docs.test.ts:3495`
        - `scripts/e2e-cli-live.test.mjs:131`, `scripts/tooling-gate.test.mjs:141`, `scripts/e2e-coverage.json:81`
        - the compat baseline (`parseRpcRequest`, `runRpcServer`, and the `Rpc*` types)
        - released `docs/cli-rpc.md`, `docs/extension-authoring.md:181`, `docs/workflows.md:208,329,718`, and `docs/instruction-injection.md:157`, which stay untouched (listed, not assigned)
        - frozen phase records (`scripts/phase17-freeze-manifest.json`, `scripts/lint-report.sarif`), which stay untouched as history

        Confirm `packages/prism-code` has no hit.
      - (l) **Part B route inputs.** Recommended: a route is `{ name, ui: HostUi, kinds?, timeoutMs? }`, so `@arnilo/prism-headless` does not depend on `prism-remote`. The attached client is `remoteHostUi()` used as a route. `prism-channels` exports no "ask a paired chat and await the reply" primitive (`packages/hosts/channels/src/index.ts:1-74`). Its approvals run inside its own runtime (`runtime-turn.ts:267-389`). Recommended: Part B adds `channelHostUi(...)` to `prism-channels`, because the chat wire knowledge lives there. Confirm which delivery and approval-store pieces it can reuse (`approvals.ts:54-118`, `delivery.ts`).
      - (m) **Part B scheduler inputs.** Recommended:
        - "Persisted in the store" means the `checkpoints` service contract (`CheckpointStore`, compare-and-swap on version), as `prism-channels` keeps its state (`createChannelStateStore(checkpoints)`). A `SessionStore` has no key-value surface.
        - The `leases` service (`LeaseStore`) guards each firing.
        - Cron uses Bun's built-in `Bun.cron.parse(expression, relativeDate, { tz })` (bun-types `bun.d.ts:8506`, Bun 1.4.2). It is zero-dependency and takes the relative date, so a fake clock drives it.
        - Workflow targets use `startWorkflow`.
        - `@arnilo/prism-workflows` has no runtime dependencies, so `prism-headless` takes it as a regular dependency.

        Confirm `Bun.cron.parse` under `bun test`, and that the 0.12 interval schedules (deleted by plan 168, `git show HEAD:packages/prism-core/src/runtime/workflows/schedules.ts`) need no port.
      - (n) **Recording routed answers (Part B).** The catalog is frozen and `decision.resolved` carries only `via` (`src/contracts-protocol.ts:337-346`). Recommended: no kernel change. `routeHostUi` records each answer as `{ sessionId?, approvalId?, kind, route, status, at }` (never a value for `secret`, `input`, or elicitation) in an answer log. The log is bounded in memory by default and stored through a host-supplied `CheckpointStore` when one is given. Record the alternative (a kernel `Decision.source` field) and why it is rejected: no second consumer.
      - (o) **The "later answer resumes" API (Part B).** `routeHostUi` returns a `HostUi`, but resuming needs a `Session`. Recommended: the returned object also has `resumeWhenAnswered(session, pending?)`. It offers each pending decision to the routes in order with no per-route timeout, applies the first answer through `session.resume`, and reads `pending` from `session.entries()` when the argument is absent, so it works after a restart.
      - (p) **Overlap with the 0.12 HTTP agent server.** `packages/prism-core/src/runtime/server` still serves run, stream, status, resume, and events routes (plan 168 Task 7 Notes). Phase 17 does not name it. Recommended: no change in this phase. Record it for the Phase 11 sweep as a module that `prism-remote`'s HTTP transport may replace.
    - Functional: Record the failing-test baseline: `bun run typecheck`, `bun test --timeout=0 src/__tests__/cli.test.ts src/__tests__/rpc.test.ts src/__tests__/docs.test.ts src/__tests__/host-surface-gate.test.ts`, `packages/hosts/{acp,channels,mcp-server}`, `packages/integrations/workflows`, and `bun scripts/release.mjs gate`. Compare it with plan 169's close. Green for Tasks 2–8 then means no new failure beyond this list.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut the plan. Never improvise a seam inside a later task.
    - Performance: n/a — read-only.
    - Code Quality: Every decision cites its source span, test output, or spike result.
    - Security: Confirm that no path lets a remote client run a tool without the served agent's own `tool.call` gate, choose a principal other than the one `authenticate` returned, or read a token through `inspect`, events, or errors.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4, §2.3 (host port, `Session.resume`), §2.8, §2.9 (host-library rows, `rpc` destination), §2.12.9 K3/K4, §2.13.2–§2.13.4, Phase 17 Scope and Done, Order
      - plans 161 and 162 (host-library pattern, approvals as suspension), 163 (K3, K4), 166 (j) (conformance placement), 168 and 169 (leases, checkpoints, `agentNode`, `startWorkflow`); `plans/backlog.md` entries sourced from them
      - `docs/next/host.md`, `docs/next/events.md`, `docs/next/agent.md`
      - Bun 1.4.2 `Bun.serve` WebSocket upgrade and `Bun.cron.parse` (bun-types)
    - Options Considered:
      - Skip the review, because the roadmap names the API. Rejected: (a), (d), (e), and (l) are visible gaps, and the roadmap requires a review when a phase creates host libraries.
      - Review Part A only and give Part B its own review. Rejected: (d) and (l) bind the two parts. The route type and `remoteHostUi()` must be decided together.
    - Chosen Approach:
      - Read the cited spans, run the two Bun spikes ((j), (m)), decide (a)–(p), and amend Tasks 2–8 and plan 171 in place.
    - API Notes and Examples:
      ```ts
      // prism.remote/1 — the method table Task 2 implements (confirmed or amended by Task 1 (c)).
      // client → server requests
      //   initialize { protocol: "prism.remote/1", capabilities }             → { agent: { id, name, tools, skills, inspection }, capabilities, endpointId }
      //   sessions.open { id?, create?, parent? }  sessions.list { query? }   sessions.resume { sessionId, decisions }
      //   run { sessionId, input, options? } → { runId }    steer { sessionId, input, options? }    abort { sessionId, reason? }
      //   commands.list   commands.run { name, args?, sessionId? }   inspect   models.list
      // server → client notifications
      //   run.event { sessionId, runId, event: AgentEvent }    run.settled { sessionId, runId, result: RunResult }
      //   agent.event { event: AgentEvent }                       // agent-scoped (subscribe)
      // server → client requests
      //   hostUi.request { sessionId?, approvalId?, request: HostUiRequest } → HostUiResponse
      ```
      ```bash
      graft callers runRpcServer --depth all
      graft callers parseCliArgs --depth all
      rg -n 'runRpcServer|parseRpcRequest|--mode rpc' src packages apps scripts examples docs README.md -g '!**/dist/**'
      bun -e 'console.log(Bun.cron.parse("0 9 * * *", new Date("2026-10-13T00:00:00Z"), { tz: "UTC" }))'
      ```
    - Files to Create/Edit:
      - `plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md`: Notes and amendments only.
      - `plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md`: amendments only, where a decision changes a Part B task.
    - References:
      - plan 166 Task 1 (review pattern and decision (j)); plan 161 Task 1 (approvals as suspension); plan 168 Task 1 (schedules deleted for Phase 17)
  - Test Cases to Write:
    - n/a — read-only. The two spikes are throwaway scripts in the scratchpad, recorded in the Notes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-13):
    - **Verdict: the plan holds. No kernel addition and no re-cut.** Six amendments (A1–A6) are applied in place to Tasks 2–7, and plan 171 gets a pointer. One of them (A1) is a gate conflict that the plan had wrong.
    - **Entry check — all confirmed from source:**
      - `EventOrigin.remote` at `src/contracts-protocol.ts:199` (`executedBy` at `:206`); docs at `docs/next/events.md:29`.
      - Kernel ask: inline `ui.request({ kind: "confirm" })` is tried first, and `unavailable`, no UI, or `interactive: false` falls to `stageAskDecisions` (`src/agent-session/session/assemble.ts:104-141`, `tool-round.ts:211-232`, which emits `decision.pending`).
      - `ask_user_decision` returns `{ ask }` on `unavailable` or no UI (`packages/tools/coding/src/ask-user-host.ts:38-45`).
      - `Session.resume` (`src/contracts-run-state.ts:353`). It fails closed on: no pending suspension (`ERR_PRISM_DECISION_STALE`), an active run, missing or unknown decisions (`ERR_PRISM_DECISION_INVALID`), and a fingerprint mismatch (`src/agent-session/session.ts:594-625`).
      - `SuspendedRunEntryData.interruption` (`src/suspended-run.ts:21-30`).
      - Precedents `acpHost` (`packages/hosts/acp/src/host.ts:9-36`) and `serveAcp` (`serve.ts:49-61`).
      - `hostOriginRejection` (`packages/hosts/mcp-server/src/server.ts:191-202`, exact lower-cased match, no port normalisation) and `bearerMatches` (`packages/hosts/devtools/src/security.ts:28-33`, which also holds the `env:` ref rule).
      - `createSessionIndex` (`src/agent/sessions.ts:29-62`), `SESSION_LINKS_DATA_KEY` (`src/contracts-core/session.ts:115`, exported at `src/index.ts:240`), and the link legs (`src/testing/store-conformance.ts:481-507`).
      - `agentNode` (`agent-node.ts:73-128`), `startWorkflow` (`parent-session.ts:66`), and `CheckpointStore`/`LeaseStore` (`contracts.ts:70-112`, implemented in `packages/stores/{sqlite,postgres}/src/checkpoints.ts`).
      - `readSseEvents` (`src/provider-kit/transport.ts:186`), `createJsonRpcPeer`/`readJsonl` (public through `@arnilo/prism/driver-kit`).
    - **Findings the plan did not anticipate (amendments):**
      - **A1 (blocking premise): `src/__tests__/host-surface-gate.test.ts` is not satisfied by "imports only `@arnilo/prism`, `/driver-kit`, `/provider-kit`".**
        - `PUBLIC_SUBPATHS = {"manifest"}` (`:19-20`). `driver-kit`, `provider-kit`, and `testing` are not host surface, so each import is a violation (`:127`).
        - Root imports must be on `scripts/host-surface-allowlist.json` (`frozen` + `phaseNN` groups). A `phaseNN` name that no host imports is flagged as stale.
        - The gate also rejects `implements Agent`, `defineAgent(`, `...agent` spreads, and `createAgent(` outside a `bin/` (`:130-145`).
        - **Decision:** `prism-remote` imports only `@arnilo/prism`. It owns its JSONL framer and its SSE reader (about 40 lines each, no dependency), which also settles (b). It adds a `phase17` allow-list group with the root names it really imports. Candidates: `SessionStore`, `SessionIndex`, `SessionParentLink`, `SessionActor`, `SESSION_LINKS_DATA_KEY`, `SuspendedRunEntryData`, `parseSuspendedRunEntry`, `AgentCommands`, `ModelIndex`, `ToolInfo`, `SkillInfo`, `ResolvedAgentConfig`, `SubscribeOptions`, `SteerOptions`. `isLoopbackHostname` is already allowed (phase11). Task 2 prunes the list to what compiles.
        - The proxy is an object literal typed `Agent`, never `class … implements Agent`, and does no spread. This is not a loophole: the gate guards against forking agent logic, and the proxy holds none (all calls go over RPC).
        - `src/testing.ts` and `src/testing-fixtures/*` are scanned too, so they import neither `@arnilo/prism/testing` nor call `createAgent`. See A5.
        - **Pre-existing failure, not ours:** the gate already fails on `packages/hosts/mcp-server/src/{types,serve-tools}.ts` (plan 165 imports `driver-kit` and four non-allow-listed names). It is recorded in the baseline below and in plan 171's baseline. Whoever fixes it chooses between allow-listing the subpath and removing the imports. Plan 170 does not touch it.
      - **A2: `agentNode` needs more of `Session` than the plan listed.** It calls `subscribe(options)` (`packages/integrations/workflows/src/events.ts:59`), `leafId` (`agent-node.ts:111,136,162`), and `messages()` on the resume path (`agent-node.ts:191`, and `loop.ts:79`). The normal path uses only the `RunResult`. It also passes `signal`, `limits`, `ownership`, `principal`, `redactor`, `runLedger`, and `metadata` in the run options (`agent-node.ts:115-124`).
      - **A3: `pendingSuspensionOf` is not public** (`src/suspended-run.ts:111`; the root exports only `loadSuspendedRunEntry` and `parseSuspendedRunEntry`, `src/index.ts:610-611`). `loadSuspendedRunEntry` needs a `SessionStore`, which an `Agent` does not expose, and it returns the newest entry whether or not it is the branch tip. Delivery therefore reads `session.entries()` and re-applies the tip rule in `pending.ts` (skip `package_state`, then require `suspended_run`) over the public `parseSuspendedRunEntry`. No kernel accessor is needed.
      - **A4: two resumes can race.** `Session.resume` checks `pendingSuspensionOf(entries())` and `activeRun` after an `await` (`session.ts:594-596`), and the claim cell is in-memory (`:621-630`). The second answer fails closed only once the first resume has appended past the `suspended_run` entry. Two connections on one served agent can pass the check together. `serveAgent` keeps one `Session` per id and a per-session "resuming" guard (a second concurrent resume gets `busy`). Cross-process races are out of scope and documented.
      - **A5: `remoteConformance` cannot use `@arnilo/prism/testing`** (see A1). The suite takes a factory contract: `{ module }` exports `create({ hostUi }) → Agent` plus the prompts to use (`{ run, approve }`). The fixture module lives under `__tests__/` (not scanned) and builds the agent with `mockProvider` and `approval`.
      - **A6: `createJsonRpcPeer` is better than the plan said** (bidirectional `request`/`onRequest`, and `maxConcurrentRequests` is configurable, `json-rpc.ts:6-20,48`). (b) still stands, but only because WebSocket and SSE are message-framed and it is stream-only. A1 forbids importing it anyway.
    - **Decisions (a)–(p):**
      - **(a)** `@arnilo/prism-remote/testing`, a package subpath. Roadmap conflict (the roadmap says `/testing`): **the user must confirm.** The reason is that `src/` never imports a package.
      - **(b)** One frame dispatcher in `prism-remote`. Stdio uses its own JSONL framer (A1). Framing for WebSocket is one JSON text message per frame. SSE is `data:` JSON events.
      - **(c)** The method table is confirmed, with two additions:
        - `sessions.messages { sessionId } → { messages }` (A2). It is read-only, scope-checked by the served `Session`, and bounded by `maxFrameBytes`. It is not mirroring, so (h) is unaffected.
        - `hostUi.request` params carry `approvalId?` and `capabilities` carry `hostUi.secret`.
        - `initialize` negotiates `prism.remote/1` and rejects any other major with `protocol_unsupported`.
      - **(d)** `remoteHostUi()` is a plain `HostUi`, bound through `serveAgent(agent, { hostUi })` and a `WeakMap`. It has no brand. The binding adds no kernel code: both suspension paths exist (`assemble.ts:104-141`, `ask-user-host.ts:38-45`). Other package requests fail closed under their own contract.
      - **(e)** Delivery on reconnect reads the live `decision.pending` event, or after a restart the branch tip from `session.entries()` (A3). The answer is applied with `session.resume`. The first-wins rule needs the A4 guard.
      - **(f)** The proxy `Agent` is as recommended and is an object literal (A1). The proxy `Session` also provides `subscribe`, `close`, `leafId`, and `messages()` (RPC `sessions.messages`, A2). It rejects `fork`, `checkout`, `compact`, and `contextMeter` with `remote_unsupported`.
      - **(g)** The merge rule is as recommended. No kernel path re-emits a proxy's events through a local `RunController`: the workflow bus only tees them (`events.ts:53-66`), and no hook bus sees them.
      - **(h)** The mirror is as recommended (actor kind `"prism"`). `storeConformance` link legs (`:481-507`) and `searchSessions` already cover `links` entries. Mirror writes one `metadata` entry and one `message` entry per `message.completed`.
      - **(i)** Auth is as recommended. Two details are added. Host matching is exact and includes the port (the spike saw `host: "127.0.0.1:46325"`), so for a loopback bind the default `allowedHosts` is `127.0.0.1:<port>`, `localhost:<port>`, and `[::1]:<port>`, computed after bind. The gate is on by default for loopback (DNS-rebinding defence). A `?token=` query is not accepted (it leaks into URLs and logs). The token travels in `Authorization: Bearer`.
      - **(j)** Spike (`Bun.serve`, Bun 1.4.2): the `fetch(req, server)` handler sees `Host`, `Origin`, and `Authorization` before `server.upgrade(req)`. A 401 return refuses the upgrade (the client saw an error). Bun's global `WebSocket` accepts `{ headers }`, so the bearer works. Browsers and Node's `WebSocket` cannot set headers, so WebSocket clients other than Bun use `authenticate`, or the HTTP transport. The README says so.
      - **(k)** Retirement inventory is in the Task 7 note below.
      - **(l)** Route shape and `channelHostUi` in `prism-channels` are confirmed. Reusable: `createChannelApprovalStore(checkpoints)` (`approvals.ts:54-118`: token, `ChannelApprovalRecord` bound to connection, conversation, actor, principal, session, run, and approval id, with `create`/`load`/`consume` by version), `createChannelDeliveryJournal`, `createChannelStateStore`, and `createMemoryCheckpointStore`/`createMemoryLeaseStore` (`memory-stores.ts`). The mechanics are plan 171 Task 1 (d).
      - **(m)** `Bun.cron.parse("0 9 * * *", new Date("2026-10-13T00:00:00Z"), { tz: "UTC" })` returns `2026-10-13T09:00:00.000Z` under `bun test`. Without `tz` it uses the **local zone**, so plan 171 always passes `tz` (default `"UTC"`). Persistence is `CheckpointStore` + `LeaseStore`, and workflow targets use `startWorkflow`. The 0.12 interval schedules need no port (deleted by plan 168).
      - **(n)** and **(o)** are as recommended. No kernel change.
      - **(p)** Recorded for the Phase 11 sweep: `packages/prism-core/src/runtime/server` (0.12 HTTP agent server) overlaps `prism-remote`'s HTTP transport. No change in this phase.
    - **Security confirmation:** no path lets a client run a tool without the served agent's own `tool.call` gate, because the server only calls `session.stream`/`resume` and tools run through `RunController.executeTools`. The wire `RunOptions` is an allow-list (Task 3 amendment), so a client cannot choose `principal` or `ownership`: the connection's principal comes only from `authenticate`. The token lives only in the transport closure and the server handle (tested in Tasks 4 and 5).
    - **Failing-test baseline (2026-10-13, before any Task 2 edit; the working tree already has many uncommitted doc edits):**
      - `bun run typecheck`: green (all workspaces exit 0). The editor flagged `examples/build-workflow.ts` lines 189–197 and 262 (`'task' is of type 'unknown'`, `Property 'slots' does not exist on type 'Agent'`). The root typecheck does not cover it and passes, so it is not a Task 2–8 gate, but the example is plan 169's and looks broken. Recorded for plan 169's owner.
      - `bun test src/__tests__/{cli,rpc,docs,host-surface-gate}.test.ts`: 185 pass / 22 fail. Failures: 21 `docs.test.ts` cases (link check, provider/README/phase docs, `readme_describes_current_runtime_provider_packages_cli_and_examples`, `workflow_examples_cover_required_workflow_surfaces`, and others), plus `host_libraries_import_only_allowlisted_kernel_names` (A1, mcp-server). One run also logs `ENOENT packages/memory/package.json`.
      - `packages/hosts/{acp,channels,mcp-server}` and `packages/integrations/workflows`: 41, 100, 41, and 183 pass, 0 fail.
      - `bun scripts/release.mjs gate`: blocked at release evidence (`PRISM_TEST_POSTGRES_URL` not set). No baseline diff output was produced, so Tasks 2–7 run `gate --update-baseline` and attribute every diff line.
      - Green for Tasks 2–8 means no failure beyond this list. The Task 8 docs-test rows must not add a failure to the 21.
    - **Plan 168 status finding:** `plans/168-…md` has 7 of 7 tasks checked, but its `plans/README.md` row (line 177) still says `planned`. Task 8 corrects it.
    - **Spike scripts** are throwaway files in the scratchpad (`spike-ws.ts`, `spike-cron.test.ts`).

  - Amendment (2026-10-13, plan 171 Task 2 execution): The user's explicit request to complete Task 2 clears only the standalone routing scaffold. Its ordered plain `HostUi` routes, timeout/discard policy, fail-closed defaults, and value-free ownership-scoped `CheckpointStore` log already have public contracts (decisions (l), (m), (n), and plan 171 Task 1 (a)/(b)). No resume authority, channel connection binding, or workflow parent context is required for this slice. `RoutedHostUi` exports `request` and `answers` only; do not predeclare `resumeWhenAnswered`. Plan 171 Tasks 3–6 remain held until their own prerequisite contracts are re-cut. This amendment does not settle those contracts or authorize a new kernel seam.

  - Amendment (2026-10-13, plan 171 Task 3 execution): The user's explicit Task 3 request clears this resume slice with one host-owned authority, without a kernel addition. `createResumeAuthority(agent)` in headless owns the configured agent's scoped `sessions.get`/`session({ id })` lookup and a per-id guard claimed before any await and held through stream completion/close. Router options require this authority for resume and check configured ownership against the authority's agent scope; caller session objects supply only their id. `serveAgent` gains an optional structural `RemoteResumeAuthority` (`resume(id, decisions, options) → AsyncIterable<AgentEvent>`), so reconnect delivery and explicit remote resumes can use the same instance, preserving principal and queue limits without importing headless. `first_answer_wins_with_serve_agent` holds the winning stream open while both paths attempt resume, tests both winner orders, and asserts two attempts, one busy loser, and exactly one tool execution. Independent authorities, direct kernel calls, and cross-process arbitration remain outside this guard. Channel binding and workflow-parent contracts are not prerequisites for plain HostUi resume and remain held for plan 171 Tasks 4–6.


  - Amendment (2026-10-13, plan 171 Task 4 execution): The user authorized the focused contract review and implementation. Clear the channel slice only. Bind connections privately to their existing runtime through a WeakMap; no public outbound/runtime methods or kernel additions. `chat` is `pair:<consumed pairing token>` resolved in the connection's checkpoint store and exact ownership scope. The pairing store has no alias registry, so replace the illustrative `pair:ops` alias rather than invent one. Require an explicit authorizer for outbound questions and inbound answers, checking active identity, exact ownership, actor/chat/thread, principal, and the consumed pairing's grant revision. Generalize token persistence through a shared CAS control-store primitive with a distinct HostUi record/key prefix, preserving legacy approval records. Persist request id, value kind, expiry and identity binding, never answer values. Confirm/single-select use `q:<token>:<index>` callbacks on Telegram and `/answer <token> <index>` controls on Signal; input and multi-select use `/answer <token> <text or comma-separated indexes>` on both transports. Support up to eight select options, matching existing Telegram controls; reject larger/invalid prompts as unavailable. Intercept the reserved `/answer` namespace after event validation and authorization, before operation journaling/agent dispatch, including malformed/stale tokens. Pending waiters live in memory, are bounded by existing per-binding/process limits and approval TTL, resolve unavailable on expiry/close, and require fresh offers after restart. Prompt delivery uses the existing journal, one bounded outbound message per request; expired matched replies get a plain expired notice. Neither transport currently exposes message editing, so do not promise it. Workflow/scheduler contracts remain held.
  - Amendment (2026-10-13, plan 171 Task 5 execution): The user authorized resolving the remaining contracts and implementation. Clear the scheduler slice. Workflow targets are `{ kind: "workflow", agent, command, input }`, where `command` names an already registered `workflowCommand` for the host's workflow definition. Invoke `agent.commands.run(command, input, { session: scheduleSession })`; that command binds the real `PackageAPI`/`SessionContext` and calls `startWorkflow`. Schedule and trigger parents open with the truthful `actor: { kind: "prism", agent: agent.id }`, which persists the kernel's first metadata entry even before a run; a bare empty session is not durable. No fabricated contexts, new kernel API, automatic command registration, or host agent construction. Validate command existence, JSON-object input, exact agent ownership, and the returned workflow run id/status. Agent targets retain `{ kind: "agent", agent, input, runOptions? }`. Schedule rows snapshot input; trigger input is an explicit override. Durability is at-most-once claiming by schedule-version CAS before execution, not transactional exactly-once side effects: a crash after advance may lose a firing; a durable `running` lastFiring marks an uncertain attempt and is never automatically replayed. Task 6 adds scoped per-firing leases/renewal/fencing, missed `skip`/`run-once` on startup, and a killed-process proof of the loss window. Two healthy contending workers can prove once-only execution; arbitrary crashes cannot. Task 5 ships CAS plus one cancellable earliest-deadline timer, bounded concurrency, stop/drain, and surfaced storage failures. `leases`, `ownerId`, `missed`, and firing-lease limits enter with Task 6, rather than accepting inert options. Each firing costs a claim CAS and a completion CAS in addition to the target; completion merges against the latest version without undoing pause/delete or overwriting a newer firing. Deleted schedules retain tombstones to prevent stale claims/ABA; local schedule creation is serialized, while a strict global capacity limit requires external single-writer admission.

- [x] Task 2: `@arnilo/prism-remote` scaffold — protocol types, frame dispatcher, negotiation, and enforcement rows
  - Acceptance Criteria:
    - Functional: `packages/hosts/remote/` exists with `package.json` (`"exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" }`, `peerDependencies` on `@arnilo/prism`, no runtime dependencies), `src/index.ts`, `src/__tests__/`, `README.md` (skeleton filled by Task 8), `CHANGELOG.md`, and `tsconfig.json`, matching `packages/hosts/acp`.
    - Functional: `src/protocol.ts` declares `REMOTE_PROTOCOL = "prism.remote/1"`, the method table from Task 1 (c), and typed params and results.
    - Functional: `src/dispatcher.ts` is one JSON-RPC 2.0 dispatcher over a `RemoteTransport` (`send(frame)`, an inbound frame iterator, `close()`). It routes requests, responses, and notifications in both directions and correlates ids. It rejects these fail-closed with JSON-RPC errors and a `RemoteError` code:
      - malformed frame → `invalid_frame`
      - a frame over `limits.maxFrameBytes` → `frame_too_large`
      - an unknown method → `method_not_found`
      - more than `limits.maxConcurrentRequests` concurrent requests → `busy`
      - a call before `initialize` → `not_initialized`
      - an unknown major protocol version → `protocol_unsupported`
    - Functional: `createMemoryTransportPair()` gives tests an in-process transport. `stdioTransport` frames with the package's own `src/jsonl.ts` reader (a bounded line splitter with a byte cap). It does not import `@arnilo/prism/driver-kit`, because the host-surface gate rejects that subpath (Task 1 A1).
    - Functional: **Enforcement rows** (probe 11):
      - root `workspaces` already globs `packages/hosts/*` (`package.json:107`); confirm it, with no edit
      - `scripts/package-truth.mjs` counts and role row
      - `src/__tests__/packaging.test.ts` package list, with `sourceExport: true`
      - the `scripts/independent-packages.json` `$comment` lockstep decision
      - `scripts/compat-baseline/arnilo__prism-remote.txt`, generated with `bun scripts/release.mjs gate --update-baseline`
      - `scripts/host-surface-allowlist.json` gains a `phase17` group with exactly the root names `prism-remote` imports beyond `frozen` (Task 1 A1; a name that no host imports is stale and fails). Task 2 imports only `frozen` names, so it adds no group; Tasks 3–4 add the group for the names they need. `host_libraries_import_only_allowlisted_kernel_names` already fails on mcp-server (baseline), so Task 2 proves that it adds no `packages/hosts/remote` violation by filtering the failure output to that path
    - Performance: The dispatcher holds no unbounded queue. Pending requests, concurrent requests, and frame size are each capped by `limits` with hard maxima, as in `packages/hosts/acp/src/limits.ts`.
    - Code Quality: The library imports only named, allow-listed exports of `@arnilo/prism` (no `driver-kit`, `provider-kit`, or `testing`). There is no kernel change and no speculative transport abstraction beyond the three Scope transports.
    - Security: No error message or JSON-RPC error `data` echoes frame content beyond a bounded, redacted preview. `limits` cannot exceed the hard maxima.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (b), (c); `packages/hosts/acp/{package.json,src/limits.ts,src/errors.ts}`; `src/driver-kit/process/{json-rpc.ts,jsonl.ts}`; JSON-RPC 2.0 specification (error codes −32700, −32600, −32601, −32602, −32603)
    - Options Considered:
      - Reuse `createJsonRpcPeer` directly. Rejected by Task 1 (b): stream-only, and one inbound request by default.
      - Put the protocol types in the kernel so other hosts could share them. Rejected: one consumer, and the kernel holds no transport protocol.
    - Chosen Approach:
      - A small typed dispatcher plus a transport interface, with the stdio transport built on the kernel's public `readJsonl`.
    - API Notes and Examples:
      ```ts
      export interface RemoteTransport {
        send(frame: JsonObject): Promise<void>;
        frames(): AsyncIterable<JsonObject>;
        close(reason?: string): Promise<void>;
        readonly closed: Promise<void>;
      }
      export class RemoteError extends Error { readonly code: RemoteErrorCode }
      export type RemoteErrorCode =
        | "invalid_frame" | "frame_too_large" | "method_not_found" | "busy" | "not_initialized"
        | "protocol_unsupported" | "unauthorized" | "forbidden_host" | "forbidden_origin" | "body_too_large"
        | "remote_unsupported" | "disconnected" | "session_not_found";
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/{package.json,tsconfig.json,README.md,CHANGELOG.md,LICENSE}`: new.
      - `packages/hosts/remote/src/{index.ts,protocol.ts,dispatcher.ts,transport.ts,jsonl.ts,limits.ts,errors.ts,testing.ts}`: new (`testing.ts` is a stub export that Task 6 fills).
      - `packages/hosts/remote/src/__tests__/dispatcher.test.ts`: new.
      - `scripts/package-truth.mjs`, `scripts/package-truth.json` (tentative, if counts are recorded there), `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`: rows.
      - `scripts/compat-baseline/arnilo__prism-remote.txt`: new.
      - `bun.lock`: workspace entry.
    - References:
      - plan 161 Task 2 (`@arnilo/prism-acp` scaffold rows); plan 162 Task 2 (moved host-library rows)
  - Test Cases to Write:
    - `dispatcher_correlates_requests_both_directions`: client and server each issue requests on one memory pair and get their own responses. Fails if ids collide across directions.
    - `dispatcher_rejects_before_initialize`: `run` before `initialize` → `not_initialized`, and no handler is called.
    - `dispatcher_rejects_unknown_major_version`: `prism.remote/2` → `protocol_unsupported`. `prism.remote/1` with unknown capabilities succeeds and echoes only the known ones.
    - `dispatcher_caps_frame_size_and_concurrency`: an oversized frame → `frame_too_large`, and the connection stays usable. The concurrent request beyond the cap → `busy`.
    - `dispatcher_malformed_frame_is_invalid_frame`: non-JSON and non-object frames get −32700/−32600, and the error data holds no raw frame bytes past the preview cap.
    - `stdio_transport_frames_jsonl`: frames round-trip over `PassThrough` streams, and a line over `maxFrameBytes` is rejected.
    - `protocol_table_includes_sessions_messages`: the method table has `sessions.messages` (Task 1 (c)).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new host library (types and transport only in this task).
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: package page skeleton (headings per `prism-wiki.md`; Task 8 fills it).
      - `CHANGELOG.md`: `## [Unreleased]` → Added: `@arnilo/prism-remote` (protocol `prism.remote/1`).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-13):
    - **What changed.** New `packages/hosts/remote/` (`@arnilo/prism-remote` 0.12.1, lockstep, no runtime dependencies, `.` and `./testing` exports, `bunfig.toml` copied from acp). Source files:
      - `errors.ts`: `RemoteError`, 18 codes (the plan's 13 plus `invalid_params`, `internal_error`, `limit`, `literal_secret`, `unauthenticated_bind` for Tasks 3 and 5), `jsonRpcCodeOf` (−32600/−32601/−32602/−32603, custom codes −32001…−32013).
      - `limits.ts`: `maxFrameBytes` (1 MiB, hard 16 MiB), `maxConcurrentRequests` (16/256), `maxPendingRequests` (64/1024), `maxQueuedEvents` (1000/100000, used by Task 3).
      - `protocol.ts`: `REMOTE_PROTOCOL`, `CLIENT_METHODS` (12, including `sessions.messages`), `SERVER_NOTIFICATIONS`, `SERVER_REQUESTS`, typed `RemoteMethods`/`RemoteNotifications`, `KNOWN_CAPABILITIES` (`hostUi`, `hostUi.secret`, `agentEvents`), and `RemoteRunOptions` (the wire allow-list: `metadata`, `limits`, `interactive`).
      - `jsonl.ts`: `readJsonlFrames`, a bounded line splitter (an oversize line is discarded while reading and surfaces as `OVERSIZE`).
      - `transport.ts`: `RemoteTransport`, `createMemoryTransportPair`, `stdioTransport`.
      - `dispatcher.ts`: `createDispatcher`, one JSON-RPC 2.0 dispatcher for both roles.
      - `testing.ts`: a stub for Task 6.
    - **Transport contract differs from the plan's API sketch (deliberately).** `frames()` yields raw text (or `OVERSIZE`), not parsed `JsonObject`s. The dispatcher alone parses, so malformed, oversize, and non-object frames fail the same way on every transport. Tasks 4 and 5 implement `frames()` as raw text: WebSocket one message per frame, SSE one `data:` event per frame.
    - **Dispatcher behaviour that later tasks rely on:**
      - `initialize` is built into the server role. It negotiates `capabilities` as the intersection of what the peer declared, what this side offered, and `KNOWN_CAPABILITIES`. The result is `{ ...onInitialize(), protocol, capabilities }`. Any other request before it gets `not_initialized`. A non-`prism.remote/1` protocol gets `protocol_unsupported`.
      - The client role calls `dispatcher.initialize()`. Requests run concurrently (the read loop never awaits a handler), capped by `maxConcurrentRequests` (`busy`). Outbound requests are capped by `maxPendingRequests`. A close or broken transport rejects every pending request with `disconnected`.
      - An oversized or unparseable frame has no answerable id, so the server replies with id `null` and the sender's request would hang. Senders must therefore stay under `maxFrameBytes` themselves. `stdioTransport.send` already enforces this locally (`frame_too_large`); Tasks 4 and 5 must do the same for the other transports.
      - Error `data` is `{ code, bytes? }` only. No frame content is echoed. A non-`RemoteError` thrown by a handler becomes `internal_error` with its message cut to 500 characters and its string `code` as `data.cause`. Task 3 must keep kernel errors safe to show (they are).
    - **Enforcement rows.**
      - Root `workspaces` already globs `packages/hosts/*`. `bun install` ran and linked the workspace (`bun.lock` carries the new entry).
      - `src/__tests__/packaging.test.ts`: package row, and the hard-coded count 62 → 63.
      - `scripts/version-literal-gate.test.mjs`: expected manifest count 62 → 63 (it was not in the plan; found by running the gate).
      - `scripts/independent-packages.json` `$comment`: `@arnilo/prism-remote` is lockstep until Phase 11.
      - `scripts/package-truth.mjs`: role note. `scripts/package-truth.json` and the generated blocks in `README.md`, `docs/index.md`, `docs/release-and-install.md`, `docs/provider-packages.md`, and `docs/_evidence/phase54-package-map.md` were regenerated with `--emit-docs`. The generator fails on the stray tracked `packages/memory/src` directory (no `package.json`; baseline ENOENT), so I moved it aside for the run and restored it. It is not ours.
      - `scripts/host-surface-allowlist.json`: unchanged. Task 2 imports only `frozen` names (`AgentEvent`, `AgentInspection`, `Decision`, `HostUiRequest`, `HostUiResponse`, `JsonObject`, `JsonValue`, `RunResult`), so no `phase17` group is needed yet. The `host_libraries_import_only_allowlisted_kernel_names` failure output names no `hosts/remote` path (0 hits).
    - **Baseline diff.** `scripts/compat-baseline/arnilo__prism-remote.txt` is new (all additions: 36 lines covering the exports above, plus `OVERSIZE`, `jsonRpcCodeOf`, which the extractor lists from non-index modules). No removals. `bun scripts/release.mjs gate --update-baseline` is blocked before it reaches the baselines (`PRISM_TEST_POSTGRES_URL` not set, same as the Task 1 baseline), so I called `runGates({ updateBaseline: true, packageName: "@arnilo/prism-remote" })` directly. Only this package's baseline was written, and the trailing range-validation error it threw is the dirty tree's pre-existing `bun.lock` drift for `packages/tools/*`, unrelated.
    - **Checks.**
      - `packages/hosts/remote`: 9 tests pass, `tsc` clean, `biome check` clean.
      - `host-surface-gate`: still 1 failure, the baseline mcp-server one.
      - `docs.test.ts`: 21 failures, equal to the baseline (one extra appeared until the new `CHANGELOG.md` carried the `0.1.0` and `0.0.28` sections that every publishable package must have, like acp).
      - `packaging.test.ts`: 327 pass, 2 fail (`retired provider family workspace is deleted` and `phase48 neuralwatt …`). Both are from the dirty tree (`packages/prism-providers` still exists), not from this task.
      - `version-literal-gate.test.mjs`: 3 pass.
    - **Sweep.** n/a (nothing retired). **Kernel change:** none.
    - **Findings for later tasks.** Tests inject raw frames with `frames()` on a memory transport, which returns the inbound channel with `push` (the dispatcher test does this through a small cast). If Task 3 needs a cleaner seam, add a test-only helper rather than widening `RemoteTransport`.

- [x] Task 3: `serveAgent` and `remoteHostUi` — sessions, runs, steering, commands, and durable suspension on disconnect
  - Acceptance Criteria:
    - Functional: `serveAgent(agent, { transport, hostUi?, authenticate?, limits? })` returns `{ endpointId, closed, close() }`. It answers every Task 2 method over the memory pair and stdio:
      - `sessions.open` calls `agent.session({ id, create, parent })`
      - `sessions.list` calls `agent.sessions.list(query)`
      - `run` starts `session.stream(input, options)` and forwards each event as a `run.event` notification, unchanged, then sends `run.settled` with the `RunResult`
      - `steer` and `abort` call `session.steer` and `session.abort`. A steer with no active run returns the kernel's error as a JSON-RPC error.
      - `commands.list` and `commands.run` go to `agent.commands`, and `inspect` to `agent.inspect()`
      - `sessions.resume` calls `session.resume(decisions)` and streams like `run`
      - `sessions.messages` returns `session.messages()` (Task 1 A2)
    - Functional: **Wire `RunOptions` is an allow-list** (Task 1 A2): `metadata` (JSON object, bounded), `limits` (the JSON-safe `RunLimits` subset), and `interactive`. Any other key (`principal`, `ownership`, `redactor`, `runLedger`, `signal`, …) is rejected with `invalid_params`. The connection supplies `principal` (Task 5). The proxy strips the local-only keys before sending (Task 4).
    - Functional: **One `Session` per id, one resume at a time** (Task 1 A4): the server caches the `Session` it opened for an id. A second concurrent `sessions.resume` for that id gets `busy`.
    - Functional: `remoteHostUi()` returns a `HostUi`. While a client is bound, each request goes to the client as `hostUi.request` and the client's `HostUiResponse` is returned. With no client bound, or after the client disconnects mid-request, it answers `unavailable`. A pending request is never left hanging.
    - Functional: **Durable suspension.**
      - A kernel ask during a run with no client bound, or after a disconnect, suspends the run through the kernel (`run.suspended`, a `suspended_run` entry).
      - When a client next initializes and opens that session, the server sends one `hostUi.request` per pending decision (`approvalId` set, `kind: "confirm"` for approvals, `input`/`select` for elicitations), read from the live `decision.pending` event or from `session.entries()` after a restart. `pending.ts` applies the branch-tip rule itself over the public `parseSuspendedRunEntry`, because `pendingSuspensionOf` is not exported (Task 1 A3).
      - The answers are applied with `session.resume(decisions)`, and the resumed run streams to the client.
      - A second answer for a resolved decision gets the kernel's fail-closed error.
    - Functional: Rejections (probe 3):
      - a `sessionId` the agent's ownership scope cannot open → `session_not_found`, with no session created
      - `run` on a session with an active run → the kernel's error
      - `run` with an invalid input shape → `invalid_params`
      - a `hostUi.request` answer of the wrong kind (for example a boolean for `input`) → treated as `unavailable` and recorded as a `notice` on the run
    - Performance: One `session.stream` subscription per active run, released at `run.settled`. Event forwarding applies `limits.maxQueuedEvents`. A slow client gets `slow_consumer` and is disconnected, and the run itself is never blocked (the run suspends at its next ask if it needs the client).
    - Code Quality: Uses only the public `Agent`/`Session` API. No `agent.config.host` mutation. The binding lives in a `WeakMap` from the `remoteHostUi` object to its connection.
    - Security: Runs and resumes carry only the connection's principal (Task 5 sets it; this task passes `undefined` on the memory and stdio transports). A client cannot pass `principal` or `ownership` in `run` options; those keys are rejected with `invalid_params`. `secret` requests reach the client only when it declared the `hostUi.secret` capability. Otherwise they answer `unavailable`.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (d), (e); `src/contracts-run-state.ts:305-371` (`Session`); `src/contracts-core/agent.ts:212-241` (`Agent`); `packages/hosts/acp/src/serve.ts:49-61` (session map, cancel waiters); `src/suspended-run.ts:21-30`
    - Options Considered:
      - Run sessions with `interactive: false` so every ask suspends, then always deliver through the resume path. Rejected: an attached client should answer inline without a suspend-and-resume round trip, and `remoteHostUi` gives inline answers when a client is present.
      - Hold pending requests in server memory until a client returns. Rejected: lost on restart, and the kernel's suspension is already durable.
    - Chosen Approach:
      - Inline through `remoteHostUi` while a client is bound, and the kernel's durable suspension otherwise, with delivery on reconnect read from the session itself.
    - API Notes and Examples:
      ```ts
      const ui = remoteHostUi();
      const agent = await createAgent({ model, packages: [approval({ mode: "ask" })], host: { ui } });
      const served = serveAgent(agent, { transport: { kind: "stdio" }, hostUi: ui });
      await served.closed;
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/src/serve.ts`: `serveAgent`.
      - `packages/hosts/remote/src/host-ui.ts`: `remoteHostUi`, binding, and pending-decision delivery.
      - `packages/hosts/remote/src/pending.ts`: read pending decisions from a live result or from `session.entries()`.
      - `packages/hosts/remote/src/index.ts`: exports.
      - `packages/hosts/remote/src/__tests__/serve.test.ts`, `host-ui.test.ts`: new.
      - `scripts/compat-baseline/arnilo__prism-remote.txt`: regenerated (diff attributed to this task in the note).
    - References:
      - plan 161 Task 3 (ACP approvals as suspension); plan 153 Task 6 (`examples/durable-approval.ts`, resume across a restart)
  - Test Cases to Write:
    - `serve_run_streams_catalog_events_unchanged`: the client receives every `run.event` deep-equal to the server's `session.stream` events, then `run.settled`. Fails if the server rewrites events.
    - `serve_sessions_open_list_resume`: opening by id, listing, and resuming a suspended session over the pair work. A foreign id gives `session_not_found` and creates nothing.
    - `serve_steer_and_abort_reach_the_session`: a steer lands before the next turn, an abort ends the run `aborted`, and a steer with no run returns the kernel error.
    - `serve_commands_and_inspect`: `commands.list`/`commands.run` and `inspect` match the agent's own.
    - `remote_host_ui_inline_when_client_bound`: an approval is answered inline by the scripted client, and the run completes without `run.suspended`.
    - `remote_host_ui_unavailable_suspends_durably`: with no client, the run suspends and a `suspended_run` entry exists.
    - `disconnect_during_pending_approval_suspends_then_resumes`: the client disconnects while a `hostUi.request` is pending, and the run suspends. A new client connects, receives the pending decision, answers, and the run completes. The second answer to the same id fails closed.
    - `pending_delivered_after_server_restart`: a new `serveAgent` over the same SQLite store delivers the pending decision read from `session.entries()`.
    - `client_cannot_set_principal_or_ownership`: `run` options with `principal`, `ownership`, `redactor`, or `signal` are rejected with `invalid_params`.
    - `concurrent_resumes_second_gets_busy`: two connections answer the same pending decision together. One resume runs, the other gets `busy` or the kernel's fail-closed error, and the run resumes exactly once (Task 1 A4).
    - `pending_tip_rule_ignores_stale_suspension`: a `suspended_run` entry followed by a later run's entries is not delivered.
    - `sessions_messages_returns_branch_messages`: the RPC result equals `session.messages()`, and a foreign id gives `session_not_found`.
    - `secret_requires_capability`: a `secret` request to a client without `hostUi.secret` answers `unavailable`, and the secret never appears in any frame.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `serveAgent`, `remoteHostUi`.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: "What it changes" (serving, binding, suspension on disconnect).
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **What changed.** `packages/hosts/remote/src/`: `serve.ts` (`serveAgent`, plus `serveConnection`/`createServerState` that Task 5 reuses for many connections on one agent), `host-ui.ts` (`remoteHostUi`, `bindRemoteHostUi`, pending-decision to request/decision mapping), `pending.ts` (`pendingDecisionsOf`, the A3 tip rule over the public `parseSuspendedRunEntry`). `index.ts` exports `serveAgent`, `remoteHostUi`, `pendingDecisionsOf`. README "What it does" and CHANGELOG are filled.
    - **Behaviour that later tasks rely on:**
      - `serveAgent` takes a `RemoteTransport` or `{ kind: "stdio" }`. Task 5 adds the WebSocket and HTTP kinds, builds `createServerState` once, and calls `serveConnection(state, transport, { principal })` per connection. The `principal` option already reaches every `run` and `sessions.resume`.
      - `run` and `sessions.resume` answer `{ runId }` once the run emits its first event. Notifications for the run can arrive **before** that response, so the Task 4 proxy routes by `sessionId` (one active run per session), never by `runId`.
      - `run.settled.result` is **projected from the run's events** (status, text, content, message, messages, usage, error, `pending`, `stopReason`, `leafId`), not the kernel's `RunResult`. `session.stream` and `session.resume` yield events only. It has no `runState` or `abortReason`, and an abort shows as `aborted` only when the `run.failed` error code or name mentions "abort".
      - A client that disconnects mid-run does not abort the run: the pump keeps draining the session stream and stops sending. (First cut aborted it: a failed `notify` ended `for await`, and `Session.stream`'s `finally` aborts the run. The disconnect test caught it.) The run then suspends at its next ask.
      - A subscriber the kernel closes on overflow means the client could not keep up: the server closes the connection with reason `slow_consumer`.
      - `sessions.open` caches one `Session` per id on the shared state. `state.resuming` and `state.active` are the A4 guard: a second concurrent `run` or `sessions.resume` for that session gets `busy`. Deliveries to a reconnecting client skip a session that already has a run.
      - Pending delivery: `confirm` for approvals (`Approve <tool>`, reason as detail), `input` for elicitations with the schema JSON in `detail`. The answer to an elicitation must be a JSON object string, else the decision stays pending. `dismissed` rejects an approval. `unavailable` leaves everything pending, so a later client is asked again. A lost resume race is swallowed.
      - `agent.event` is forwarded when `agentEvents` was negotiated (`drop_oldest` overflow). The connection's `remoteHostUi` binding is detached when the transport closes.
    - **Deviations from the task text:**
      - The "wrong-kind answer is recorded as a `notice` on the run" criterion is **not met**. `remoteHostUi` has no emit handle, and a synthetic event would break "events unchanged". The wrong-kind answer becomes `unavailable`, so the run visibly suspends (`run.suspended`). The kernel gives a host no notice hook, so a real `notice` needs a kernel addition and its own proof. Recorded in Further Actions.
      - `pending_delivered_after_server_restart` uses a second agent over the same `createMemorySessionStore()`, not SQLite. The restart path (a fresh `Session`, entries read from the store) is the same, and the SQLite store is Phase 6's own suite.
      - The slow-consumer disconnect has no dedicated test.
    - **Test-side finding.** A long-lived `Session` object caches `entries()` for 1s, so a test that polls one `agent.session({ id })` object sees a stale branch. Tests poll with a fresh `agent.session({ id })` per read. The server is unaffected: delivery runs on the session that executed the run (fresh cache) or on a freshly opened one.
    - **Host-surface gate.** `scripts/host-surface-allowlist.json` gains a `phase17` group with exactly `parseSuspendedRunEntry` and `HostUiRequestKind` (the rest are `frozen`; `isSessionNotFound` replaces `SessionNotFoundError`). A doc comment that named `createAgent(` tripped the construction rule, so it was reworded. `host_libraries_import_only_allowlisted_kernel_names` still fails on the mcp-server baseline only (0 `hosts/remote` hits).
    - **Baseline diff** (`arnilo__prism-remote.txt`, generated by calling `runGates({ updateBaseline: true, packageName, skipTarball })`; the gate itself is blocked by `PRISM_TEST_POSTGRES_URL`): additions only, all from this task: `serveAgent`, `serveConnection`, `createServerState`, `remoteHostUi`, `bindRemoteHostUi`, `requestForPending`, `decisionFromAnswer`, `pendingDecisionsOf`, and the `ServeAgentOptions`/`ServedAgent`/`ServeTransport` types. No removals.
    - **Checks.** `packages/hosts/remote`: 27 tests pass (10 serve, 7 host-ui/pending, 10 earlier), `tsc` and `biome check` clean. Root `bun run typecheck`: green. `docs.test.ts`: 21 failures, equal to the baseline. Sweep: n/a (nothing retired). Kernel change: none.
    - **Tests mapped to the plan's list:** all 13 are covered except as noted above: `serve_run_streams_catalog_events_unchanged`, `serve_sessions_open_list_resume`, `serve_steer_and_abort_reach_the_session` (the abort-ends-run-`aborted` half is not covered; only the steer error and the foreign-id abort), `serve_commands_and_inspect`, `remote_host_ui_*`, `disconnect_during_pending_approval_suspends_then_resumes`, `pending_delivered_after_server_restart`, `client_cannot_set_principal_or_ownership`, `concurrent_resumes_second_gets_busy`, `pending_tip_rule_ignores_stale_suspension`, `sessions_messages_returns_branch_messages`, `secret_requires_capability`.

- [x] Task 4: `connectAgent` — the `Agent` proxy, attribution, local `HostUi`, and mirroring
  - Acceptance Criteria:
    - Functional: `connectAgent(endpoint, { host?, mirror?, ownership?, endpointId?, limits? })` initializes and returns an `Agent` with the shape decided in Task 1 (f). `endpoint` is `{ kind: "stdio", command, env?, cwd? }`, `{ kind: "memory", transport }`, `{ kind: "websocket", url, token? }`, or `{ kind: "http", url, token? }`. The WebSocket and HTTP kinds land in Task 5. `endpointId` defaults to the server's `endpointId`.
    - Functional: `agent.session(options)` returns a `Session` proxy:
      - `run` and `stream` forward to the remote and return or yield the remote's `RunResult` and events
      - `steer` and `abort` forward
      - `resume(decisions)` forwards
      - `messages()` calls `sessions.messages` (`agentNode`'s resume path and `workflowLoop` need it, Task 1 A2). `entries()` is answered from the mirror when set, else throws `remote_unsupported`
      - `subscribe(options)` fans the session's forwarded events out to local subscribers with a bounded queue and `overflow` (`agentNode` observes through it); `close()` closes them
      - `leafId` is a property updated from each `RunResult`/`run.settled`
      - `run(input, options)` strips the local-only keys (`signal` becomes an `abort` request when it fires, and `principal`, `ownership`, `redactor`, `runLedger` are dropped) and sends only the Task 3 wire allow-list; `agentNode` passes all of them
      - `fork`, `checkout`, `compact`, and `contextMeter` throw `remote_unsupported`

      `steer` checks for an active run locally and throws synchronously when there is none, matching the kernel's contract.
    - Functional: **Attribution** per Task 1 (g). Every forwarded event gains `origin.remote`. Every `tool.*` event carries `origin.executedBy: "external"`. An event that already has a nested origin keeps it.
    - Functional: **`HostUi`.** The remote's `hostUi.request`s go to `options.host.ui`. With no local UI, the answer is `unavailable`, so the remote run suspends. The proxy's `run` then resolves with `status: "suspended"` and the pending decisions, and `session.resume(decisions)` continues it.
    - Functional: **Mirror** per Task 1 (h). With `mirror: store`, the proxy writes the links `metadata` entry when the session opens, and one `message` entry per `message.completed`, stamped with `ownership`. `createSessionIndex(store).search({ query, workflowRunId })` finds the remote's messages.
    - Functional: Rejections (probe 3):
      - the server's `protocol_unsupported` → `connectAgent` rejects with `RemoteError` and does not start a child process
      - a disconnect during a run → the proxy's run rejects with `disconnected`, and the remote run suspends at its next ask or is aborted by the server
      - `models.resolve` → `remote_unsupported`
    - Performance: One connection per proxy `Agent`, shared by its sessions. The mirror appends one entry per completed message, never per delta. The cost is stated in the README.
    - Code Quality: The proxy is an object literal typed `Agent` (and a `Session` object), never `implements Agent`, with no spread of an agent, no cast to kernel internals, no local hook bus, and no `createAgent` call, so the host-surface construction rules hold (Task 1 A1).
    - Security: The token is held only in the transport closure. It is absent from `inspect()`, from events, and from the `RemoteError` message. Mirrored entries pass through no redactor of their own (the remote already redacted them), and the README says that mirroring trusts the remote's redaction.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (f), (g), (h); `packages/integrations/workflows/src/nodes/agent-node.ts:60-120`; `src/agent/sessions.ts:29-62`; `src/contracts-core/session.ts:101-115`; `src/testing/store-conformance.ts:481-504`
    - Options Considered:
      - A driver-kit loop over `observe`. Rejected by Task 1 (f).
      - Mirror by fetching remote entries after each run. Rejected by Task 1 (h).
    - Chosen Approach:
      - A hand-written proxy over the dispatcher, with attribution applied in one `attribute(event)` function, and a mirror writer fed from the same event stream.
    - API Notes and Examples:
      ```ts
      const remote = await connectAgent({ kind: "stdio", command: [process.execPath, "worker.ts"] }, {
        host: { ui: localUi },
        mirror: store,
        ownership,
      });
      const session = await remote.session({ parent: { sessionId: parent.id, workflowRunId } });
      for await (const event of session.stream("plan the change")) render(event); // event.origin?.remote === remote endpoint id
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/src/connect.ts`: `connectAgent` and the proxy `Agent`.
      - `packages/hosts/remote/src/session-proxy.ts`: the proxy `Session`.
      - `packages/hosts/remote/src/attribution.ts`: the merge rule.
      - `packages/hosts/remote/src/mirror.ts`: the mirror writer.
      - `packages/hosts/remote/src/stdio-client.ts`: spawns `command` with `Bun.spawn` and wires the stdio transport.
      - `packages/hosts/remote/src/index.ts`: exports.
      - `packages/hosts/remote/src/__tests__/connect.test.ts`, `attribution.test.ts`, `mirror.test.ts`: new.
      - `scripts/compat-baseline/arnilo__prism-remote.txt`: regenerated.
    - References:
      - plan 169 Task 3 (`agentNode` parent links); plan 163 Task 6 (K4 links)
  - Test Cases to Write:
    - `connected_events_keep_catalog_type_and_gain_remote`: every proxied event's `type` equals the server's, and `origin.remote` equals the endpoint id. Fails if a type is remapped.
    - `connected_tool_events_are_external_and_skip_local_gate`: a local `createAgent` with a counting `tool.call` hook runs in the same workflow as the proxy. The counter sees only local calls, and the proxied `tool.*` events carry `executedBy: "external"`.
    - `attribution_merge_keeps_nested_origin`: an event with a nested remote origin keeps its `remote` and `depth`.
    - `remote_host_ui_reaches_local_ui`: the remote's approval reaches the local scripted UI, and its answer completes the remote run.
    - `no_local_ui_suspends_and_resume_continues`: with no local UI, the proxy `run` resolves `suspended` with pending decisions, and `resume` completes it.
    - `proxy_works_as_agent_node`: an `agentNode({ agent: remote })` runs inside `startWorkflow` next to an in-process agent node, and the merged stream carries both with the correct `origin`.
    - `mirror_is_found_by_session_index`: `createSessionIndex(store).search({ query, workflowRunId })` returns the remote's message and the host's message.
    - `token_never_leaks_from_proxy`: the token string is absent from `inspect()`, every event, and a forced `unauthorized` error.
    - `unsupported_members_fail_closed`: `fork`, `checkout`, `compact`, and `models.resolve` throw `remote_unsupported`.
    - `proxy_session_subscribe_and_messages_serve_agent_node`: `agentNode`'s observer (`session.subscribe`) receives the remote events, and the resume path's `session.messages()` returns the remote's messages without a mirror.
    - `proxy_strips_local_only_run_options`: a run with `principal`, `ownership`, `redactor`, `runLedger`, and a `signal` sends none of them. Aborting the signal sends `abort`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `connectAgent`.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: connecting, attribution, mirroring and its per-message write cost.
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-13):
    - **What changed.** `packages/hosts/remote/src/`: `connect.ts` (`connectAgent`, the proxy `Agent` as an object literal), `session-proxy.ts` (proxy `Session`), `attribution.ts` (`attribute`, the Task 1 (g) rule), `mirror.ts` (`createSessionMirror`), `channel.ts` (bounded async queue with `close`/`drop_oldest`/`drop_newest` overflow, used for run streams and subscribers), `stdio-client.ts` (spawns the child with `node:child_process`, because `Bun` has no types in this package; stderr inherited, `env` merged over `process.env`). `index.ts` exports `connectAgent`, `attribute`, `createSessionMirror`, and the endpoint/option types. README and CHANGELOG are updated.
    - **Behaviour later tasks rely on:**
      - `ConnectEndpoint` is `stdio | memory`. Any other `kind` rejects with `remote_unsupported`. Task 5 adds `websocket` and `http` in `connect.ts` (one more branch that yields a `RemoteTransport`).
      - Notifications are routed by `sessionId` to a per-session handle, registered after `sessions.open` returns. A run is registered *before* its `run` request goes out, so early notifications are not lost. Events for a session the proxy never opened are dropped. A server-initiated resume (pending delivery on open) can emit events in the short window before the handle is registered, and those are missed. This is rare, and it is not a mirror or `subscribe` guarantee.
      - `stream()`/`resume()` start the run eagerly (when called), not on first `next()`. Breaking out of the iterator sends `abort`. A run-scoped `subscribe()` closes at `run.settled`; `acrossRuns` stays until `close()` or a disconnect.
      - `run.settled` is awaited behind `mirror.flush()`. A failed mirror write rejects `run()` with `internal_error` (the run itself happened on the remote).
      - `hostUi` and `hostUi.secret` are declared only when `options.host.ui` exists, so a proxy with no UI leaves the remote's `remoteHostUi` unbound and the remote run suspends.
      - `commands.list()` is synchronous on `Agent`, so `connectAgent` fetches it once after `initialize` and the proxy serves the frozen copy.
      - `dispose()` closes the connection and kills a spawned child. A failed `initialize` also kills the child.
    - **Deviations from the task text:**
      - "`protocol_unsupported` … does not start a child process" cannot hold for stdio, because only the child can answer `initialize`. The proxy rejects with the server's `RemoteError` and kills the child. The test uses a memory peer.
      - `sessions.get/delete/search` on the proxy reject with `remote_unsupported` (the protocol has no method for them). Only `sessions.list` goes over RPC. `sessions.search` stays available locally through `createSessionIndex(mirrorStore)`.
      - `steer` with no active run throws `RemoteError("invalid_params")` (the kernel's `AgentRunStateError` is not on the host-surface allow-list).
      - `token_never_leaks_from_proxy` has no token to leak on the memory and stdio endpoints (Task 5 adds `token`). The stdio variant asserts that a failed spawn's error carries none of the `env` values. The token variant moves to Task 5's auth test.
      - Mirror: only `message.completed` is recorded, and the user input is not a `message.completed` event, so a mirrored run holds the links entry plus the assistant message(s). The mirror's `metadata.remote` is the endpoint id.
    - **Host-surface gate.** `scripts/host-surface-allowlist.json` `phase17` gains `SessionStore` and `SESSION_LINKS_DATA_KEY` (the only new root names; other types are derived from `Agent`/`Session`). `host_libraries_import_only_allowlisted_kernel_names` still fails on the mcp-server baseline only (0 `hosts/remote` hits).
    - **Baseline diff** (`arnilo__prism-remote.txt`, regenerated through `runGates({ release: loadRelease(), updateBaseline: true, packageName, skipTarball })`; `gate` itself stays blocked by `PRISM_TEST_POSTGRES_URL`): additions only, all from this task: `connectAgent`, `ConnectAgentOptions`, `ConnectEndpoint`, `attribute`, `AttributionSource`, `createSessionMirror`, `SessionMirror`, `createSessionProxy`, `createChannel`, `spawnStdioTransport`, `StdioEndpoint`. No removals and no other package baseline changed.
    - **Checks.** `packages/hosts/remote`: 44 tests pass (17 new: 14 in `connect.test.ts`, 3 in `mirror.test.ts`, including a real stdio child and an `agentNode` workflow with a local tool-call hook counter), `tsc` and `biome check` clean. Root `bun run typecheck`: green. `docs.test.ts`: 21 failures, equal to the baseline. `packaging.test.ts`: 2 failures, the same two as Task 2. Sweep: n/a. Kernel change: none.
    - **Test notes.** `proxy_works_as_agent_node` imports `@arnilo/prism-workflows` through the root `node_modules` link and adds no `devDependency`, so `bun.lock` is untouched. Task 8 decides whether to record the dependency. `mirror_is_found_by_session_index` searches with `query` (the `SessionSearchQuery` field), not `text`.

- [x] Task 5: WebSocket and HTTP-with-SSE transports, authentication, and the HTTP gates
  - Acceptance Criteria:
    - Functional: `serveAgent(agent, { transport: { kind: "websocket" | "http", hostname?, port?, allowedHosts?, allowedOrigins?, maxRequestBytes?, token? } })` serves over `Bun.serve`:
      - WebSocket: one connection is one dispatcher session
      - HTTP: `POST /rpc` takes client frames (a request's response comes back in the POST body), and `GET /events` (SSE) carries the server's notifications and requests. Each SSE stream has a connection id, and the client posts answers to `POST /rpc?connection=<id>`.
    - Functional: `connectAgent` supports `{ kind: "websocket", url, token? }` and `{ kind: "http", url, token? }`, reading SSE with the package's own bounded `src/sse.ts` reader (`@arnilo/prism/provider-kit`'s `readSseEvents` is not host surface, Task 1 A1).
    - Functional: **Authentication.**
      - By default the hostname is `127.0.0.1` and a random 32-byte token is generated. It is readable only as `served.token` and compared in constant time.
      - `token` may be `env:NAME` or `keyring:name`, resolved once at start. A literal is refused with `literal_secret`.
      - `authenticate(request) → { principal } | undefined` replaces the token check, and the returned principal goes into every `run`/`sessions.resume` of that connection.
      - A non-loopback `hostname` without `authenticate` fails `serveAgent` with `unauthenticated_bind`.
    - Functional: **Defaults** (Task 1 (i), (j)): for a loopback bind, `allowedHosts` defaults to `127.0.0.1:<port>`, `localhost:<port>`, and `[::1]:<port>`, computed after bind, so the Host gate is on by default (DNS rebinding). Matching is exact and includes the port. The token travels only in `Authorization: Bearer`; a `?token=` query is ignored and never accepted. `isLoopbackHostname` (already host-surface allow-listed) decides what counts as loopback. A WebSocket client that cannot set headers uses `authenticate` or the HTTP transport (README).
    - Functional: **Gates** (Done criterion), each rejected before any dispatcher work:
      - wrong or missing token → 401 `unauthorized`
      - Host not in `allowedHosts` → 403 `forbidden_host`
      - Origin present and not in `allowedOrigins` → 403 `forbidden_origin`
      - body over `maxRequestBytes` → 413 `body_too_large`, enforced while reading, not after
      - the WebSocket upgrade applies the same token, Host, and Origin checks
    - Performance: SSE streams send a keep-alive comment every `limits.keepAliveMs`. `limits.maxConnections` caps WebSocket and SSE connections. A cut connection releases its dispatcher session and bindings within one keep-alive interval.
    - Code Quality: The Host/Origin check copies `hostOriginRejection`'s semantics (Task 1 (i)) into `src/http-gate.ts`, with a comment naming the source and parity tests. No new runtime dependency.
    - Security: The token and any `authenticate` input never appear in events, `inspect()`, errors, or logs. A test asserts this over every rejection path. A rejected request creates no session and makes no `agent` call.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (i), (j) and the `Bun.serve` upgrade spike; `packages/hosts/mcp-server/src/server.ts:191-202`; `packages/hosts/devtools/src/security.ts:2-31`; `src/provider-kit/transport.ts:186-252`
    - Options Considered:
      - Depend on `@arnilo/prism-mcp-server` for the gate. Rejected by Task 1 (i).
      - Streamable HTTP (one endpoint with optional SSE upgrade) instead of a separate `/events`. Rejected: the server sends requests to the client between client calls, which needs a standing server-to-client stream, and a split POST/SSE pair is the simplest shape that gives one.
    - Chosen Approach:
      - `Bun.serve` with a gate function run first on every request and upgrade, and the dispatcher unchanged.
    - API Notes and Examples:
      ```ts
      const served = serveAgent(agent, { transport: { kind: "websocket", port: 0 }, hostUi: ui });
      const remote = await connectAgent({ kind: "websocket", url: served.url, token: served.token });
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/src/transports/{network.ts,client.ts}`: shared network listener and client adapters (both transport kinds).
      - `packages/hosts/remote/src/http-gate.ts`: Host/Origin, token, and body gates.
      - `packages/hosts/remote/src/sse.ts`: bounded SSE frame reader and writer.
      - `packages/hosts/remote/src/auth.ts`: token generation, ref resolution, and constant-time compare.
      - `packages/hosts/remote/src/serve.ts`, `connect.ts`: transport dispatch.
      - `packages/hosts/remote/src/__tests__/network.test.ts`, `http-gate.test.ts`, `auth.test.ts`: new; network cases run against both kinds.
      - `scripts/compat-baseline/arnilo__prism-remote.txt`: regenerated.
    - References:
      - plan 159 Task 3 and plan 165 Task 4 (Host/Origin gate and token hygiene for `serveTools`)
  - Test Cases to Write:
    - `wrong_token_is_401`, `missing_token_is_401`: no session is opened and no agent call is made.
    - `wrong_origin_is_403`, `wrong_host_is_403`: matched against the parity cases from `packages/hosts/mcp-server/src/__tests__/server.test.ts:257`.
    - `loopback_default_host_gate_includes_port`: with no `allowedHosts`, a request with `Host: evil.test` is 403 and one with `Host: 127.0.0.1:<port>` passes.
    - `query_token_is_not_accepted`: `?token=<valid>` without the header is 401.
    - `oversized_body_is_413_while_streaming`: a chunked body over the cap is cut at the cap, not buffered whole.
    - `websocket_upgrade_applies_the_same_gates`: a bad token, Host, or Origin on upgrade is refused.
    - `literal_token_is_refused`: `token: "abc"` → `literal_secret`.
    - `non_loopback_without_authenticate_fails`: `hostname: "0.0.0.0"` with no `authenticate` → `unauthenticated_bind`.
    - `authenticate_principal_reaches_runs`: a wrapper at the public Session boundary verifies that both `stream` and `resume` receive the authenticated principal, while a forged proxy principal is stripped. The current public `tool.call` payload and HookContext expose no principal, so this proof uses the owning boundary rather than adding kernel API.
    - `token_absent_from_every_surface`: the token string is absent from events, `inspect()`, every rejection body, and the logger.
    - `http_sse_round_trip_with_server_request`: a `hostUi.request` sent over SSE is answered by POST and completes the run.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — transports and authentication.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: transports, authentication, gates, the loopback default, and the secret-ref rule.
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **What changed.** Added the Bun network listener and clients, bounded incremental SSE parser, streaming body reader, constant-time bearer comparison, env/keyring token resolution, and Host/Origin gates. `serveAgent`/`connectAgent` dispatch both network kinds through the existing frame dispatcher. Shared server state keeps the existing session/run guards. README and CHANGELOG document the transport contract and defaults. No kernel change or dependency added.
    - **Authentication and isolation.** Custom authentication fails closed on undefined, malformed principals, and exceptions; its principal supplies runs and resumes. Every HTTP POST reauthenticates and matches the SSE connection's principal kind/id. A connection id alone grants no access. Default Origin allow-list is the three local HTTP origins; default Host matching includes the bound port. Explicit empty lists retain MCP parity (disable that gate). Client URLs cannot carry credentials/query/hash and HTTP redirects are refused.
    - **Keyring API amendment.** Bun OS secrets are asynchronous. Network handles expose `ready`; for `keyring:name`, await it before reading `url`/`token`. The listener is created only after resolution succeeds (service `prism`). Env refs and generated tokens retain synchronous startup and the task's example works unchanged. Lookup failures expose only a fixed error. Keyring lifecycle has a mocked backend test; no live OS vault was accessed.
    - **Proof adjustment.** `tool.call` payload/HookContext do not expose a principal. Tests wrap the public Session `stream`/`resume` boundary and assert the exact authenticated principal on both transports, including a forged local principal that is stripped. No kernel seam was added merely for the test. Transport files and tests are grouped by shared implementation rather than duplicated per kind.
    - **Bounds and cleanup.** `maxConnections` defaults to 64, hard cap 1024; `keepAliveMs` defaults to 15000, hard cap 60000. SSE comments, cancellation/abort cleanup, bounded queues, WebSocket payload/backpressure limits, and streaming request caps are in place. Upgrade reservations count against the connection limit. SSE cancellation releases capacity and its dispatcher. POST RPC replies return in the POST body; notifications/server requests use SSE, with client answers posted back (202).
    - **Tests and checks.** Tests were written first and failed on missing transport support. Final remote suite: **58 pass, 0 fail, 231 assertions** across 8 files. Includes both transport run/HostUi round trips, token/Host/Origin/query-token rejection, WebSocket upgrade gates, streaming body cancellation without reading the tail, MCP matching parity, fragmented UTF-8/CRLF and unterminated SSE limits, principal propagation on run/resume, cross-principal POST denial, connection-cap cleanup, env/random tokens, and mocked keyring startup/failure. Root `bun run typecheck` passes; package `tsc` and `biome check` pass. Host-surface gate: 3 pass, 1 baseline MCP-server allow-list failure; **no remote violations**.
    - **Compatibility baseline.** Package-scoped `runGates({ version: "0.12.1", updateBaseline: true, packageName: "@arnilo/prism-remote", skipTarball: true })` passes. Additions only: `Authenticate`, `NetworkEndpoint`, `NetworkTransport`, `bearerMatches`, `connectNetwork`, `hostOriginRejection`, `readBody`, `readSseFrames`, `rejection`, `resolveToken`, `serveNetwork`. No removals. Existing endpoint/options/limit/handle types gain the network fields. Full release CLI gate remains blocked before checks by missing `PRISM_TEST_POSTGRES_URL`, as recorded in earlier tasks; tarball validation was not run.
    - **Remaining scope.** Task 6 owns cross-transport `remoteConformance`; Task 8 owns the complete guide/example. No retirement sweep applies. Live OS keyring and load/slow-consumer benchmarking were not run.

- [x] Task 6: `remoteConformance` on every transport
  - Acceptance Criteria:
    - Functional: `remoteConformance(agentFactory, { transports? })` in `@arnilo/prism-remote/testing` runs each leg through `serveAgent` and `connectAgent` on stdio, WebSocket, and HTTP with SSE (all three by default). It returns a per-transport, per-leg result, as `loopConformance` does (`src/testing/loop-conformance.ts:66-77`). The legs:
      - run
      - stream (event types and order equal the in-process run, and every event has `origin.remote`)
      - steer
      - abort
      - resume
      - `HostUi` (inline answer)
      - commands
      - suspension on disconnect (disconnect mid-approval, reconnect, answer, completion)
    - Functional: The stdio leg spawns a fixture server process (`src/testing-fixtures/serve-stdio.ts`) that builds the agent from a factory module path, because a stdio child cannot receive an in-memory factory.
    - Functional: **No `@arnilo/prism/testing` import** (Task 1 A5): `src/testing.ts` and `src/testing-fixtures/*` are scanned by the host-surface gate. The suite takes a factory module (`create({ hostUi, stateDirectory }) → Agent`) and the prompts to send (`{ run, approve }`). The fixture module under `__tests__/` builds the agent with `mockProvider` and `approval`. The suite answers approvals through `remoteHostUi` with its own scripted client, and never calls `createAgent` itself.
    - Functional: The suite is run in the package's own tests on the mock provider, on all three transports (Done criterion).
    - Performance: The whole suite finishes in under 10 s on the mock provider. Each leg has its own timeout, and a hung leg fails with its name.
    - Code Quality: The suite uses only allow-listed `@arnilo/prism` names and this package's exports.
    - Security: The suite asserts that the token is absent from every event it collects.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (a); `src/testing/loop-conformance.ts:44-216`; `src/testing/host-ui.ts`; plan 167 Task 3 (`adapterConformance` in a package subpath)
    - Options Considered:
      - Put the suite in kernel `/testing`. Rejected by Task 1 (a).
      - Run stdio in-process over `PassThrough` only. Rejected: the stdio leg must cover the real child-process path that `examples/remote-agent.ts` uses.
    - Chosen Approach:
      - A package-subpath suite parameterized by transport, with a fixture server for stdio.
    - API Notes and Examples:
      ```ts
      import { remoteConformance } from "@arnilo/prism-remote/testing";
      const result = await remoteConformance({ module: new URL("./fixture-agent.ts", import.meta.url).href, prompts: { run: "hello", approve: "write the file" } });
      expect(result.failures).toEqual([]);
      ```
    - Files to Create/Edit:
      - `packages/hosts/remote/src/testing.ts`: `remoteConformance`.
      - `packages/hosts/remote/src/testing-fixtures/serve-stdio.ts`: fixture server.
      - `packages/hosts/remote/src/__tests__/conformance.test.ts`, `fixture-agent.ts`, `fixture-broken-origin.ts`, `fixture-lost-suspension.ts`: new.
      - `packages/hosts/remote/package.json`: existing `files` includes `src/testing-fixtures`; no edit needed.
      - `packages/hosts/remote/src/serve.ts`: prerequisite correction for numeric DOMException abort codes.
      - `scripts/compat-baseline/arnilo__prism-remote.txt`: regenerated (adds the `./testing` surface).
    - References:
      - plan 167 Task 3
  - Test Cases to Write:
    - `remote_conformance_passes_on_stdio`, `..._on_websocket`, `..._on_http_sse`: each returns no failures.
    - `remote_conformance_detects_a_broken_server`: a server wrapper that drops `origin.remote` fails the stream leg by name. Fails if the suite stops checking attribution.
    - `remote_conformance_detects_lost_suspension`: a server wrapper that answers `dismissed` on disconnect instead of `unavailable` fails the suspension leg.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `@arnilo/prism-remote/testing`.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`: "Conformance" subsection.
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **What changed.** Added the public `/testing` suite, returning `legs` and `failures` for all eight legs on stdio, WebSocket, and HTTP/SSE by default. Every leg has a named timeout (2000 ms default), fresh fixtures, and cleanup. Stream types/order match an in-process factory result; collected events require `origin.remote` and exclude bearer tokens. Commands are compared and executed, steering is verified in stored messages, and abort must report `aborted`.
    - **Factory contract amendment.** `create({ hostUi, stateDirectory })` owns agent construction, packages, and persistence. `run` completes without approval; `approve` requests approval. Include a deterministic command without required arguments. The mock fixture uses `mockProvider`, `approval`, and SQLite. SQLite loads dynamically in the test factory to avoid pulling its source declarations into remote's typecheck. Neither production testing module nor packaged stdio fixture imports kernel testing helpers or constructs an agent.
    - **Stdio reconnect.** The packaged fixture runs in a real child. Since `connectAgent.dispose()` terminates its owned child, the first disconnect fixture handles SIGTERM, drains the unavailable approval to the store, disposes the agent, and acknowledges draining with a temporary marker. The next child uses the same store. A held request after reconnect proves approval survived, then the scripted answer completes the run. No memory transport substitutes for stdio.
    - **Prerequisite abort fix.** Bun's `AbortError` carries numeric code `20`; the server preferred that code over the name and reported failure. Shared result projection now examines both. `graft callers projectResult --depth all` scoped the change; all three abort legs provide regression coverage. No signature changed or name was retired.
    - **Tests and checks.** Tests written first failed on the missing export. Final remote suite: **64 pass, 0 fail, 242 assertions** across 9 files. Broken-attribution and lost-suspension fixtures fail their named legs. The default 24-leg run finishes in about **1.3 seconds**, below 10 seconds. Root `bun run typecheck`, package typecheck, and focused Biome checks pass. Host-surface gate: 3 pass, 1 inherited MCP-server failure (the same six import violations recorded in Task 5); no remote violations, including the new testing and fixture modules.
    - **Compatibility baseline.** Package-scoped `runGates({ version: "0.12.1", updateBaseline: true, packageName: "@arnilo/prism-remote", skipTarball: true })` passes. Remote baseline adds only `remoteConformance`, with no removals. The package and baseline were already untracked when this task began. Normal release CLI remains blocked before checks by missing `PRISM_TEST_POSTGRES_URL`; tarball validation was not run.
    - **Docs and scope.** README conformance contract/example and Unreleased changelog updated. Existing package `files` includes the stdio fixture and excludes test factories. No dependency or kernel change. Tasks 7 and 8 remain unchecked; whole-plan verification and final backlog handoff await those tasks.

- [x] Task 7: Retire `src/rpc.ts` and `prism --mode rpc`
  - Acceptance Criteria:
    - Functional: `src/rpc.ts` and `src/__tests__/rpc.test.ts` are deleted.
    - Functional: `src/cli-runner.ts` loses the `rpc` import, `"rpc"` from `CliMode`, the `commands` option typed from `RpcSessionFactory`, the `rpc` branch in `parseCliArgs`, and the `runRpcServer` call. `--mode rpc` fails with `CliUsageError("Invalid mode: rpc")`.
    - Functional: Every caller from the Task 1 (k) inventory is updated in this task:
      - `README.md:151` loses the rpc line, and `src/__tests__/docs.test.ts:3180` pins only `--mode print` and `--mode json`
      - `examples/rpc.ts` is deleted, with its `examples/README.md` lines (35, 237) and the `docs.test.ts:3495` demo entry
      - `scripts/e2e-cli-live.test.mjs:131` drops the rpc leg
      - `scripts/tooling-gate.test.mjs:141` drops its rpc fixture string
      - `scripts/e2e-coverage.json:81` drops the `rpc.test.ts` path
    - Functional: **Retirement sweep.** `rg -n 'runRpcServer|parseRpcRequest|RpcServerOptions|RpcSessionFactory|RpcCommandName|--mode rpc' src packages apps scripts examples docs README.md -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**'` finds only:
      - released `/docs` (`docs/cli-rpc.md`, `docs/extension-authoring.md`, `docs/workflows.md`, `docs/instruction-injection.md`), untouched and listed in the note
      - frozen phase records (`scripts/phase17-freeze-manifest.json`, `scripts/lint-report.sarif`)
      - negative retirement assertions in `src/__tests__/core-boundaries.test.ts` (the regenerated baseline contains neither retired export)
    - Functional: **Baseline.** Run `bun scripts/release.mjs gate --update-baseline`. Task 1 found that `scripts/compat-baseline/arnilo__prism.txt` records only two rpc lines: `parseRpcRequest` (line 922) and `runRpcServer` (line 1057). The `Rpc*` types and `CliMode` have no baseline line. The expected diff is exactly those two removals. Anything else in the diff is attributed in the task note or marked inherited. `public-export-contract.test.ts`, `cli.test.ts`, and `core-boundaries.test.ts` contain no `rpc` text (Task 1), so the `cli_rejects_mode_rpc` and `kernel_has_no_rpc_module` tests are new.
    - Functional: **Not touched, confirmed by Task 1's sweep:** `packages/drivers/process` (`"rpc"` abort-step keys and the `json-rpc` transport), `src/driver-kit/process/json-rpc.ts`, and `src/testing/scripted-dialects/json-rpc.ts` are unrelated to `src/rpc.ts`. `scripts/phase17-freeze-manifest.json:296,331` mentions "CLI/RPC mapping" in old phase prose with no code reference, and there is no `scripts/lint-report.sarif` hit. The `docs.test.ts` cases that read the released `docs/cli-rpc.md` (lines 1860–2863) stay green because that page is untouched. `packages/prism-code` and `apps/` (absent) have no hit.
    - Performance: The kernel loses about 340 lines. `scripts/budgets.json` is updated if it records the kernel size or `cli-runner` budget.
    - Code Quality: No alias, no deprecation shim, and no `"rpc"` left in `CliMode`.
    - Security: n/a — removal only. The replacement's gates are Task 5's.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (k); `src/rpc.ts:1-336`; `src/cli-runner.ts:16-303`; roadmap §2.9 ("`rpc` already has a destination") and Phase 17 Done ("`src/rpc.ts` is gone from the kernel")
    - Options Considered:
      - Keep `--mode rpc` as a thin `serveAgent` stdio call. Rejected: the kernel never imports a package, and the roadmap retires the mode with no alias.
      - Delete the whole `print`/`json` CLI runner too. Rejected: outside Phase 17. The Phase 11 sweep owns it.
    - Chosen Approach:
      - Delete the module and the mode, and update every caller and pin in one task, after the replacement exists (Tasks 3–6).
    - API Notes and Examples:
      ```bash
      graft callers runRpcServer --depth all
      bun scripts/release.mjs gate --update-baseline
      git diff --stat scripts/compat-baseline/
      ```
    - Files to Create/Edit:
      - `src/rpc.ts`, `src/__tests__/rpc.test.ts`, `examples/rpc.ts`: deleted.
      - `src/cli-runner.ts`, `src/__tests__/cli.test.ts`, `src/__tests__/core-boundaries.test.ts`, `src/__tests__/docs.test.ts`, `README.md`, `examples/README.md`: edited.
      - `scripts/e2e-cli-live.test.mjs`, `scripts/tooling-gate.test.mjs`, `scripts/e2e-coverage.json`, `scripts/budgets.json`: unchanged; it has aggregate ceilings, no RPC or CLI-runner size budget.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerated.
      - `src/__tests__/public-export-contract.test.ts`: edited only if it names a removed export.
    - References:
      - plan 162 Task 4 (retiring `prism dev` from the kernel CLI; released `/docs` left untouched)
  - Test Cases to Write:
    - `cli_rejects_mode_rpc`: `parseCliArgs(["--mode", "rpc"])` throws `CliUsageError` naming `rpc`. Fails if the mode returns.
    - `kernel_has_no_rpc_module`: a `core-boundaries`-style assertion that `src/rpc.ts` does not exist and the root export has no `runRpcServer`/`parseRpcRequest`.
    - The existing `examples_demos_run_to_completion_and_emit_no_secret` stays green without `examples/rpc.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a kernel export and a CLI mode are removed.
    - Docs pages to create/edit:
      - `README.md`: drop the `--mode rpc` line (the root README is pinned by `docs.test.ts`).
      - `CHANGELOG.md`: `## [Unreleased]` → Removed: `runRpcServer`, `parseRpcRequest`, and `prism --mode rpc`, replaced by `@arnilo/prism-remote`.
      - Released `docs/cli-rpc.md` and the other listed pages: untouched until Phase 11.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **What changed.** Deleted the kernel RPC implementation, its test suite, and its demo. Removed the CLI mode, dispatch, RPC-specific runtime commands option, and help text. Updated README CLI claims, example listings, docs demo/mode pins, live CLI journey, tooling fixture, coverage row, and Unreleased changelog. Added `cli_rejects_mode_rpc` (parser and CLI exit 2 with empty stdout) and `kernel_has_no_rpc_module` (file and root-export absence). Both tests failed before retirement and pass afterward.
    - **Baseline.** `bun scripts/release.mjs gate --update-baseline` is blocked before gates by missing `PRISM_TEST_POSTGRES_URL`. Built core, removed stale generated `dist/rpc.*` and `dist/__tests__/rpc.test.*`, and regenerated only the root baseline through `runGates({ release: loadRelease(), version: "0.12.1", independent: true, updateBaseline: true, packageName: "@arnilo/prism", skipTarball: true })`. That focused gate passes. Compared with the pre-task snapshot, the exact diff is two removals: `parseRpcRequest` and `runRpcServer`; no additions or other changes.
    - **Retirement sweep.** No live implementation, caller, CLI help, demo, tooling fixture, or coverage reference remains. The only active-source name hits are negative root-export assertions. Released `docs/cli-rpc.md`, `docs/extension-authoring.md`, `docs/workflows.md`, and `docs/instruction-injection.md` retain references as planned. The changelog records the removal. No apps directory exists. Unrelated driver-kit/process JSON-RPC transports and scripted dialects remain intact.
    - **Checks.** `bun run build:core` and root `bun run typecheck` pass. CLI, retired-dev, and public-export suites: 118 pass. Remote package: 64 pass across all nine suites, including transport conformance. Focused retirement tests: 2 pass. Core boundaries plus CLI/public exports: 130 pass, 1 inherited failure (`provider resolver contract has no domain vocabulary`), also observed before implementation. Docs: 149 pass, 21 failures, matching Task 6's recorded baseline; offline demos/no-secret and example listing tests pass. Tooling gate: 8 pass, 4 inherited failures (clean Biome fixture, hashing scan, retired SQLite scan, and missing tracked example during node:test scan). E2E coverage remains blocked by pre-existing missing suites and unannotated remote surfaces (Task 8 owns remote example registration). Live provider journey skipped without credentials. Biome reports existing import ordering/formatting and an unused import in touched files; no broad formatting cleanup was made.
    - **Scope.** No dependency, alias, kernel/package addition, budget increase, or released-doc edit. Task 8 remains unchecked.

- [x] Task 8: `examples/remote-agent.ts`, the `prism-remote` README, and `origin.remote` attribution docs
  - Acceptance Criteria:
    - Functional: `examples/remote-agent.ts` runs offline and:
      1. serves a mock-provider agent with `approval` in `ask` mode over stdio (a child process running `examples/remote-agent-server.ts`)
      2. connects to it with `connectAgent({ kind: "stdio", command }, { host: { ui: scripted }, mirror: store })`
      3. uses the proxy in a workflow `agentNode` next to an in-process mock agent node
      4. answers the remote's approval through the local scripted `HostUi`
      5. prints the merged stream with `origin.remote` on the remote's events
      6. searches the mirrored session with `createSessionIndex(store).search({ query, workflowRunId })` and prints both hits
    - Functional: The example is registered under the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`, `src/__tests__/docs.test.ts:3437`), with an `examples/README.md` line and a `scripts/e2e-coverage.json` row.
    - Functional: `packages/hosts/remote/README.md` is complete in the package page structure:
      - install and a manifest-free host example
      - configuration tables for `serveAgent`, `connectAgent`, and `limits`
      - the protocol method table
      - transports and authentication
      - attribution
      - mirroring, with its per-message write cost and its trust in the remote's redaction
      - suspension on disconnect
      - conformance
      - the scope limit: only kernel asks and elicitations suspend, and other package requests fail closed
    - Functional: `docs/next/events.md` gains the `origin.remote` attribution rule (Task 1 (g)) and its relation to `executedBy`. `docs/next/host.md` notes that `remoteHostUi()` is a `HostUi` and that `unavailable` drives the existing suspension.
    - Functional: The `plans/README.md` row for plan 168 is corrected from `planned` to `complete`. All seven of its tasks are checked (finding recorded in Task 1).
    - Performance: The example finishes in under 5 s on the mock provider.
    - Code Quality: The example imports only `@arnilo/prism`, `@arnilo/prism/testing`, `@arnilo/prism-remote`, `@arnilo/prism-workflows`, `@arnilo/prism-approval`, and `@arnilo/prism-store-sqlite`.
    - Security: The example passes no literal secret. The execution gate's no-secret scan covers its output.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 17 Examples; `examples/build-workflow.ts` (plan 169 Task 10) for the workflow and SQLite setup; `docs/next/events.md:20-40`; `.agents/skills/create-plan/references/prism-wiki.md` (package page structure)
    - Options Considered:
      - Serve in-process over the memory transport. Rejected: the roadmap says "over stdio", and the stdio path is the one hosts will copy.
    - Chosen Approach:
      - A two-file example (server and host) on the mock provider, with one SQLite file for the host's store and mirror.
    - API Notes and Examples:
      ```ts
      const remote = await connectAgent({ kind: "stdio", command: [process.execPath, serverPath] }, { host: { ui }, mirror: store });
      const flow = defineWorkflow({ id: "remote-review", revision: "1", nodes: { plan: agentNode({ agent: remote }), review: agentNode({ agent: local }) }, edges: [["plan", "review"]] });
      ```
    - Files to Create/Edit:
      - `examples/remote-agent.ts`, `examples/remote-agent-server.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts` (demo list): rows.
      - `packages/hosts/remote/README.md`: complete.
      - `docs/next/events.md`, `docs/next/host.md`: attribution and binding notes.
      - `plans/README.md`: plan 168 status correction; plan 170 status set when the plan completes.
      - `CHANGELOG.md`: `## [Unreleased]` line for the example.
    - References:
      - plan 169 Task 10 (`examples/build-workflow.ts`)
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/remote-agent.ts` (an added row).
    - `remote_agent_example_output`: asserts in the example's own run that the output contains `origin.remote`, `approved`, and two search hits. Fails if the mirror or attribution breaks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — completes the package page and the staged event docs.
    - Docs pages to create/edit:
      - `packages/hosts/remote/README.md`, `docs/next/events.md`, `docs/next/host.md`, `examples/README.md`, `CHANGELOG.md`: as listed.
    - `docs/index.md` update: no (staged pages and package READMEs are not indexed during the train)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **What changed.** Added the two-file offline stdio example. The child owns a mock-provider agent with approval in ask mode; the host answers confirm/select through scripted HostUi, runs the proxy beside a local agent in a workflow, prints the merged catalog stream, and searches both replies in one SQLite file. The example's `remote_agent_example_output` assertions require success, one local confirm, remote attribution, external tool execution, exactly two hits, and each agent's reply. Every agent and the archive store is disposed before temporary state is removed.
    - **Tests first and execution gate.** Registered the example before implementation; its first invocation failed because the file did not exist. Added the docs demo row, examples README entry (including the server helper), and both remote E2E surface rows, using existing remote test files. The full offline demos/no-secret gate and README example listing pass. Standalone timed run: **0.170 s**, 12 remote events, approved, two search hits, no secret pattern matches (under 5 s). The gate also executes emitted JavaScript; the child extension follows the host's extension.
    - **API corrections and compiler boundary.** Search takes `query`, not `text`; corrected the plan references. Workflow nodes are a keyed object, not an array with node ids; corrected Task 8's snippet. The remote runtime loads through a string module name with narrow public-kernel types, following the conformance fixture's existing approach: a static remote import brings Bun's global fetch and SQLite declarations into the examples compiler and conflicts with existing examples. No production API, dependencies, exports, or compatibility baseline changed.
    - **Docs.** Completed the remote README's install/manifest-free host usage, option and limit tables, complete protocol method table, transports/authentication, attribution merge, mirror write cost and remote-redaction trust, suspension scope, failures, and conformance. Added staged events and HostUi rules and an Unreleased example entry. Confirmed all seven plan 168 tasks checked and corrected its index row. No released docs or docs index changed.
    - **Checks.** Root `bun run typecheck` (including build and examples) passes. Remote typecheck and **64 tests / 242 assertions** pass, including every transport's conformance. Workflows: **183 pass**. Whole-plan core/CLI/host/packaging/export selection: **451 pass, 13 fail** outside the changed example/docs: the recorded provider-domain and MCP host-surface failures, nine other packages' tarball diet failures, and two recorded packaging assertions. All five remote packaging checks pass. Full docs: **149 pass, 21 fail**, matching the earlier task baseline; both affected example checks pass. E2E coverage reports **104/109 surfaces**, with no remote errors; seven stale missing-suite annotations elsewhere still fail the gate. Release gate remains blocked by missing `PRISM_TEST_POSTGRES_URL` before checks. These failures were left outside Task 8 and handed off below.
    - **Retirement sweep.** The ten hits are the negative root-export assertion and released docs (`cli-rpc`, `extension-authoring`, `workflows`, `instruction-injection`). No active RPC implementation or example remains. There is no apps directory.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `cd packages/hosts/remote && bun run typecheck && bun run test`
- `bun test --timeout=0 src/__tests__/cli.test.ts src/__tests__/core-boundaries.test.ts src/__tests__/host-surface-gate.test.ts src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `cd packages/integrations/workflows && bun run test`
- `bun examples/remote-agent.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/e2e-coverage-gate.mjs`
- `rg -n 'runRpcServer|parseRpcRequest|RpcSessionFactory|--mode rpc' src packages apps scripts examples docs README.md -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**'` (only released `/docs`, frozen phase records, and the baseline)
- `bun scripts/release.mjs gate`

## Compromises Made

- P3: The proxy can miss server-initiated resume events emitted between `sessions.open` and local handle registration (Task 4). Mirroring is not a complete archive of that reconnect window. Recorded in plans/backlog.md.
- P2: Whole-plan validation ran, but repository-wide docs, packaging, host-surface and coverage failures plus missing Postgres release evidence prevent an all-green release claim. Task 8's example, typecheck, remote suite, and workflow suite pass. Recorded in plans/backlog.md.

## Further Actions

- P4: A wrong-kind `HostUiResponse` is not recorded as a `notice` on the run (Task 3; no host-side emit hook in the kernel). Prove a generic kernel need before adding such a hook. Recorded in plans/backlog.md.
- P2: Restore the failing whole-plan gates and provide `PRISM_TEST_POSTGRES_URL`, then repeat release verification before publishing. Recorded in plans/backlog.md.
