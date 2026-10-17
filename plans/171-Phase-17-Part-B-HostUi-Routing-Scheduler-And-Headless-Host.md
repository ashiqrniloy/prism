# Phase 17 Part B — `HostUi` routing, the channel route, the scheduler, and the headless host example

## Objectives

- Create `@arnilo/prism-headless` (`packages/hosts/headless/`), a host library on the public `@arnilo/prism` API.
- Ship `routeHostUi(routes, options?)`:
  - it returns a `HostUi` that tries an attached client, then a channel, then a policy default
  - routes can be limited by request kind
  - a request that no route answers suspends the run durably through the kernel
  - an answer from any route later resumes it
  - each answer is recorded with the route that gave it
- Ship `channelHostUi(...)` in `@arnilo/prism-channels`, so a paired Telegram or Signal chat can answer `HostUi` requests for an agent the channel does not run.
- Ship `createScheduler({ checkpoints, leases?, targets, ... })` over `Agent`s and workflow definitions:
  - cron schedules, one-off schedules, and host-invoked triggers
  - each firing opens a session or a workflow run with `parent` links
  - schedule state is persisted
  - leases make each firing run once across processes
  - a policy decides whether firings missed while the host was down are skipped or run once
- Prove the part with `examples/headless-host.ts`, offline, and record the Phase 17 Done criteria for both parts.

## Expected Outcome

- `routeHostUi([{ name: "client", ui: remoteHostUi() }, { name: "telegram", ui: channelHostUi(...), kinds: ["confirm", "select", "input"] }, policyDefault()])` is a `HostUi`:
  - an attached client answers first
  - with no client, the channel answers within its timeout
  - with neither, the policy default answers `unavailable` and the kernel suspends the run
  - `terminal` goes only to the client
- `router.resumeWhenAnswered(session)` offers a suspended run's pending decisions to the routes, applies the first answer with `session.resume`, and works on a fresh process over the same store.
- `router.answers()` lists `{ route, kind, status, sessionId, approvalId, at }` for every answer, and never holds a secret, input, or elicitation value.
- `createScheduler(...)` fires a cron schedule on a fake clock, opens the target session with `parent: { sessionId: <schedule session> }` (or starts the workflow run), and persists `nextRunAt`.
- Two scheduler processes sharing one SQLite store fire each due firing exactly once. After a restart, `missed: "skip"` fires nothing for the gap and `missed: "run-once"` fires once.
- `examples/headless-host.ts` runs offline:
  1. an approval goes unanswered by the client
  2. it falls through to a scripted channel
  3. the run suspends
  4. the approval is answered later, and the run resumes
  5. a scheduled workflow fires on a fake clock
- The Phase 17 Done record lists each Done criterion with the test or example that proves it.

This plan implements roadmap **Phase 17 — Headless host libraries: remote agents, `HostUi` routing, and scheduling**, Part B. It **depends on plan 170** (Part A), whose Task 1 is the review for both parts. Task 1 here is an **entry check**, not a second review. It confirms Part A landed as recorded and applies plan 170 Task 1's decisions (l)–(o) to Tasks 2–6. The approaches below follow those decisions' *recommended* answers. Where the review decided otherwise, Task 1 amends the affected task before it starts. If the entry check finds a contract missing, it stops, and the change goes back to plan 170 Task 1 as an amendment. This plan adds no kernel contract. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`. Lab impact (probe 12): `packages/prism-code` imports neither library, so no lab module becomes deletable.

## Tasks

> **Amendments from plan 170 Task 1 (executed 2026-10-13).** Read before Task 1:
> - **Host-surface gate** (plan 170 Task 1 A1): `packages/hosts/*/src` imports only `@arnilo/prism` (named, on `scripts/host-surface-allowlist.json`; the only subpath is `manifest`). `driver-kit`, `provider-kit`, and `testing` are rejected, and so are `implements Agent` and `createAgent(` outside a `bin/`. `prism-headless` and `channelHostUi` (in `prism-channels`) add a `phaseNN` group to the allow-list for only the names they import. The gate already fails on mcp-server (baseline), so prove "no new violation under `packages/hosts/headless`".
> - **`Bun.cron.parse` without `tz` uses the local zone**: always pass `tz` (default `"UTC"`). Verified under `bun test`: `0 9 * * *` after `2026-10-13T00:00:00Z` with `tz: "UTC"` is `2026-10-13T09:00:00.000Z`.
> - **`pendingSuspensionOf` is not public.** `resumeWhenAnswered` reads pending decisions from `session.entries()` with the public `parseSuspendedRunEntry` and the branch-tip rule (skip `package_state`, require `suspended_run`), as plan 170 Task 3's `pending.ts` does. Two concurrent resumes can race inside the kernel (plan 170 A4), so `resumeWhenAnswered` serialises per session id.
> - **Route shape and reusable channel pieces** are as in plan 170 Task 1 (l): `createChannelApprovalStore(checkpoints)`, `createChannelDeliveryJournal`, `createChannelStateStore`, `createMemoryCheckpointStore`/`createMemoryLeaseStore`.
> - Baseline: the 22 docs/gate failures recorded in plan 170 Task 1 predate this plan; the `docs.test.ts` rows for Part B must not add to them.

- [x] Task 1: Entry check — Part A as landed, and the review's Part B decisions applied (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 170's Notes, citing `file:line`:
      - `remoteHostUi()` exists and answers `unavailable` when unbound
      - `serveAgent` delivers pending decisions on reconnect, read from `session.entries()`
      - `RemoteError` codes, and the `@arnilo/prism-remote` enforcement rows
      - `src/rpc.ts` is deleted
    - Functional: Apply plan 170 Task 1's decisions:
      - (l) the route shape and `channelHostUi` placement
      - (m) `CheckpointStore`/`LeaseStore` persistence, `Bun.cron.parse`, `startWorkflow`, and the dependency on `@arnilo/prism-workflows`
      - (n) the answer log
      - (o) `resumeWhenAnswered`

      Record any amendment to Tasks 2–6 in place.
    - Functional: Decide the open Part B points (recommended answers below):
      - (a) **Per-route timeout and late answers.** `HostUi.request` takes no `AbortSignal` (`src/host/types.ts:105-107`). Recommended: on `timeoutMs`, the router moves to the next route and discards a later inline answer from the timed-out route, recording it `late`. When the run then suspends, `resumeWhenAnswered` sends a fresh offer, so a channel user may see the prompt twice. The README states this, and `channelHostUi` edits its earlier message to "expired" when it can.
      - (b) **Policy default.** Recommended: `policyDefault(answers?)`, where each kind maps to `"unavailable"` (the default, which suspends asks), `"dismiss"`, or, for `notify` only, `"ack"`. `confirm: "allow"` is refused (`policy_allow_refused`), because a default must never approve.
      - (c) **Schedule parent link.** `SessionParentLink` has `sessionId`, `agentId`, `workflowRunId`, and `delegationId` (`src/contracts-core/session.ts:101-106`). Recommended:
        - each schedule opens one "schedule session" on its target agent when it is created
        - each agent firing opens its session with `parent: { sessionId: <schedule session>, agentId }`
        - each workflow firing passes the schedule session as `startWorkflow`'s parent session
        - `createSessionIndex(store).list({ parentSessionId })` then lists every firing
        - reject reusing `delegationId` for the schedule id, which would mislabel the link
      - (d) **Channel route mechanics.** From `packages/hosts/channels/src/{approvals.ts,delivery.ts,runtime-turn.ts,telegram.ts,signal.ts}`, decide how `channelHostUi` sends a prompt to a configured chat and correlates the reply (the approval store's pending record, keyed by a request id) without starting an agent turn. Confirm that a reply admitted by the channel's pairing and `authorizeEvent` path is the only reply accepted.
    - Functional: Record the failing-test baseline: `bun run typecheck`, `packages/hosts/{remote,channels}`, `packages/integrations/workflows`, `packages/stores/sqlite`, `src/__tests__/docs.test.ts`, and `bun scripts/release.mjs gate`. Compare it with plan 170's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut the plan. Never improvise a seam inside a later task.
    - Performance: n/a — read-only.
    - Code Quality: Every confirmation cites its span.
    - Security: Confirm that no route can resume a session outside the router's configured agent ownership scope, and that a channel reply from an unpaired sender is never accepted as an answer.
  - Approach:
    - Documentation Reviewed:
      - plan 170 (Task 1 Notes, Compromises, Further Actions); roadmap §2.13.4, Phase 17 Scope and Done
      - `packages/hosts/channels/src/{index.ts,approvals.ts,delivery.ts,runtime-turn.ts,types.ts}`; `packages/integrations/workflows/src/{contracts.ts,parent-session.ts}`; `packages/stores/sqlite` services
    - Options Considered:
      - A second full review. Rejected: plan 170 Task 1 covers both parts. A repeat would re-open decided contracts.
    - Chosen Approach:
      - Confirm, apply, and decide (a)–(d), then amend in place.
    - API Notes and Examples:
      ```bash
      graft callers createChannelApprovalStore --depth 2
      graft skeleton packages/hosts/channels/src/runtime-turn.ts
      rg -n 'remoteHostUi|RemoteError' packages/hosts/remote/src
      ```
    - Files to Create/Edit:
      - `plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md`: Notes and amendments only.
    - References:
      - plan 167 Task 1 and plan 169 Task 1 (entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Verdict: entry check complete; Part A is present, but Part B is not cleared for implementation.** The source check found missing host contracts in the proposed resume, channel, and workflow approaches. Per this task's stop rule, Tasks 2–6 are held pending an amendment to plan 170 Task 1 and a re-cut of their affected contracts. No kernel seam, production code, dependency, export, or baseline was changed. Checking this task records completion of the review, not approval to start Task 2.
    - **Part A as landed:**
      - `remoteHostUi()` returns `unavailable` when unbound, on a failed ask, or on an invalid answer (`packages/hosts/remote/src/host-ui.ts:19-40`). `unbound_answers_unavailable`, disconnect suspension, and restart delivery tests pass in the remote rerun.
      - `serveAgent` opens through its configured agent, retains one session per id, and invokes reconnect delivery (`packages/hosts/remote/src/serve.ts:287-307`). Delivery reads `target.entries()` (`:260-279`); `pendingDecisionsOf` skips `package_state`, requires the branch tip to be `suspended_run`, and parses with the public parser (`packages/hosts/remote/src/pending.ts:9-24`). It does not select an arbitrary older suspension.
      - Stable `RemoteErrorCode` includes the planned codes plus `invalid_params`, `internal_error`, `limit`, `literal_secret`, and `unauthenticated_bind`; `RemoteError.code` and JSON-RPC mappings are implemented (`packages/hosts/remote/src/errors.ts:2-73`). Enforcement rows exist: `package.json:107` (host workspace glob), `packages/hosts/remote/package.json:8` (root/testing exports), `scripts/package-truth.mjs:213`, `src/__tests__/packaging.test.ts:51`, `scripts/independent-packages.json:2`, `scripts/host-surface-allowlist.json:63`, and `scripts/compat-baseline/arnilo__prism-remote.txt:1`. The host-surface gate reports only the inherited MCP violations, none under remote.
      - `test ! -e src/rpc.ts` succeeds. Plan 170 Task 7 Notes record the retirement sweep and root baseline removals; Task 8 Notes record 64 remote tests, 183 workflow tests, typecheck success, 149/21 docs, and the Postgres release-evidence block. This confirms the current working tree, not that the many existing staged/unstaged changes are committed.
    - **Review decisions (l)–(o) carried forward:**
      - (l) Keep ordered plain `HostUiRoute`s and `channelHostUi` in `prism-channels`. Existing approval tokens are scoped and CAS-consumed (`packages/hosts/channels/src/approvals.ts:123-212`), and delivery is journaled before sending (`packages/hosts/channels/src/delivery.ts:16-26,66-80`). These are reusable pieces, not an already-implemented general question/reply API.
      - (m) Keep ownership-scoped `CheckpointStore` and `LeaseStore`, the workflows dependency, and `Bun.cron.parse` with explicit `tz`, default `UTC` (`packages/integrations/workflows/src/contracts.ts:70-112`; installed Bun 1.4.2 declaration `node_modules/bun-types/bun.d.ts:8495-8506`; plan 170 Task 1's executed UTC spike). **Missing premise:** `startWorkflow` requires `prism: PackageAPI` and `session: SessionContext`, not a public `Session` (`packages/integrations/workflows/src/parent-session.ts:25-44,66-76`). The existing public path is a registered `workflowCommand`, entered through `agent.commands.run(name, args, { session })` (`packages/integrations/workflows/src/command.ts:25-55`). The current workflow target supplies neither a command nor bound context; resolve this in the prerequisite review, without fabricating a context or importing internals.
      - (n) Keep the value-free, bounded answer log and optional ownership-scoped checkpoint persistence in Task 2. Record route metadata only, including `late` and `error`; no input, secret, elicitation value, or tool arguments.
      - (o) Keep explicit `resumeWhenAnswered`, the branch-tip reader, fresh-process recovery, and per-session serialization. `pendingDecisionsOf` is actually exported (`packages/hosts/remote/src/index.ts:24`); keep headless independent of remote by implementing the small public-parser reader locally and testing branch-tip parity. **Missing premise:** remote's guard belongs to its private server state (`serve.ts:54-76,247-254`). A separate router guard cannot serialize against it. Kernel resume awaits decision resolution before claiming in-memory state (`src/agent-session/session.ts:594-630`); do not claim that a router/remote race has a guaranteed stale loser. The prerequisite amendment must establish one resume authority or shared coordination before Task 3.
    - **Open decisions (a)–(d):**
      - (a) Adopt timeout-and-discard for inline routing, recording a late answer as `late`. A resumed offer is fresh and can duplicate a prompt. The channel must own a finite request expiry because `HostUi.request` has no cancellation signal (`src/host/types.ts:105-107`); a router timeout alone cannot expire the channel's pending promise. Document duplicate offers and expire/edit messages when supported; do not promise an edit on transports that cannot edit.
      - (b) Adopt `policyDefault(answers?)`: default `unavailable`, optional `dismiss`, `ack` only for `notify`, and construction-time `policy_allow_refused` for `confirm: "allow"`. Defaults never approve.
      - (c) Adopt one durable schedule session per schedule; agent children carry `{ sessionId: scheduleSessionId, agentId }`, and workflow parents use the same schedule session through a real bound context. Never reuse `delegationId` (`src/contracts-core/session.ts:101-115`). Parent-index queries remain ownership-scoped (`src/agent/sessions.ts:29-48`). Workflow binding remains blocked as described in (m).
      - (d) Require a channel-owned request id/token with expiry, configured chat/thread/actor/principal/grant/ownership binding, and CAS consumption. Route admitted replies to the pending UI waiter before normal message/agent-turn dispatch, after the existing authorization checks. Do not route external UI replies through `startResume` or manufacture a channel-owned suspended run. Generalize the stored request discriminator/value-kind for confirm/select/input while preserving existing approval behavior; persist correlation metadata, never input answers. Expired/consumed replies must not fall through into model turns.
        - **Missing premise:** `ChannelConnectionHandle` exposes lifecycle and inbound handling only (`packages/hosts/channels/src/types.ts:434-440`); it has no outbound-question or admitted-reply binding. Existing approval records require a run/session and fixed allow/reject outcome (`approvals.ts:9-48,90-118`), and `handleApproval` insists on a channel-owned suspension before `startResume` (`runtime-admit.ts:40-110`). Telegram and Signal both feed `runtime.admit` (`telegram.ts:1258-1280`; `signal.ts:746-759`). The prerequisite amendment must specify the connection-to-runtime UI binding, token handling for select/input, expiry, and transport support before Task 4; these are channel-library changes, not kernel additions.
    - **Security finding:** ownership supplied only for the answer log does not authenticate an arbitrary `Session` passed to `resumeWhenAnswered`. Establish a configured agent/session-index authority and resolve/check the id through that scope before reading pending entries or asking routes; `createSessionIndex(..., { ownership }).get(id)` already rejects foreign entries (`src/agent/sessions.ts:29-48`). The resume API amendment must ensure it resumes the authoritative session rather than a caller-supplied foreign object with the same id. No safe implementation of that boundary is claimed here.
      - Channel `authorizeEvent` permits a default identity when no authorizer is configured (`packages/hosts/channels/src/runtime-core.ts:132-160`); pairing is not automatically enforced by `runtime.admit`. Require an explicit paired-chat authorizer for the UI route and recheck the stored grant/actor binding at consumption. Existing admission authorizes before dispatch (`runtime-admit.ts:316-355`), but it does not by itself prove “unpaired senders can never answer.” Task 4 must prove that refusal, including the no-authorizer case.
    - **Scheduler durability limit:** advance-before-run plus a lease prevents duplicate claims, but a crash between CAS advance and starting the target can lose a firing. A lease is not a transaction with model/tool side effects. Task 6 must define and test its process-crash guarantee in the prerequisite amendment; “exactly once” currently has evidence only for two live workers contending. Do not expand that claim to arbitrary crash recovery.
    - **Baseline executed (logs in `/tmp/prism-171-entry-*.log`):**
      - `bun run typecheck`: exit 0.
      - `bun test --timeout=0 packages/hosts/remote`: initially 63 pass / 1 fail (`remote_conformance_passes_on_stdio`, run leg “connection closed”) while typecheck/build and other suites ran. Repeated alone after typecheck: 64 pass / 0 fail. Record as intermittent, not a proven new regression or an all-runs-green claim.
      - `bun test --timeout=0 packages/hosts/channels`: 100 pass / 3 skip / 0 fail; workflows: 183 pass / 0 fail. Matches plan 170's close.
      - `bun test --timeout=0 packages/stores/sqlite`: 41 pass / 1 fail; package-local `bun run test` repeats 41/1. `names the Bun runtime when the sqlite modules are imported under node` gets missing `src/persistence.js` instead of the expected Bun-only error (`sqlite-persistence.test.ts:1150-1155`). SQLite was not quantified at plan 170's close, so this is a newly recorded baseline failure, not an attributed regression. Checkpoint and lease conformance pass.
      - `bun test --timeout=0 src/__tests__/docs.test.ts`: 149 pass / 21 fail, matching plan 170's close; no Part B code or demo rows added.
      - `bun test --timeout=0 src/__tests__/host-surface-gate.test.ts`: 3 pass / 1 inherited MCP failure, no remote violation.
      - `bun scripts/release.mjs gate`: exit 1 before gates, `PRISM_TEST_POSTGRES_URL` missing, unchanged from plan 170. No baseline regeneration attempted.
    - **Amendments in place:** Tasks 2–6 now carry an entry gate; Tasks 3–6 explicitly name the invalid assumptions and required prerequisite decisions. Tasks 7–8 remain unchecked. This task adds no test, released docs, or backlog handoff because only the entry check was requested.

- [x] Task 2: `@arnilo/prism-headless` scaffold and `routeHostUi` — route order, kind limits, timeouts, the policy default, and the answer log
  - Entry gate amendment (2026-10-13): **cleared for Task 2 only**, per the user's explicit execution request and the amendment in plan 170 Task 1. Routing and answer logging use existing public contracts and require none of the unresolved later-task seams. Tasks 3–6 remain held.
  - Acceptance Criteria:
    - Functional: `packages/hosts/headless/` exists with `package.json` (`"exports": { ".": "./src/index.ts" }`, `peerDependencies` on `@arnilo/prism`, a dependency on `@arnilo/prism-workflows` per plan 170 Task 1 (m)), `src/index.ts`, `src/__tests__/`, `README.md`, `CHANGELOG.md`, and `tsconfig.json`.
    - Functional: `routeHostUi(routes, { answerLog?, ownership? })` returns a `RoutedHostUi`, which is a `HostUi` plus `answers()`. For each request it:
      - tries the routes in order, skipping a route whose `kinds` excludes the request kind
      - treats `unavailable`, a throw, or a timeout (`timeoutMs`) as "not answered" and moves on
      - returns the first `answered` or `dismissed` response
      - returns `unavailable` when every route passes
    - Functional: `policyDefault(answers?)` per Task 1 (b). `confirm: "allow"` throws `policy_allow_refused` at construction.
    - Functional: Each answer is recorded as `{ route, kind, status: "answered" | "dismissed" | "unavailable" | "late" | "error", sessionId?, approvalId?, at }`. The record holds no value. The log keeps `limits.maxAnswers` (default 1,000, hard maximum 100,000) in memory. With `answerLog: checkpoints`, records are written through the `CheckpointStore` under namespace `headless.answers`, with the router's `ownership`.
    - Functional: Rejections (probe 3):
      - an empty route list → `no_routes`
      - two routes with one name → `duplicate_route`
      - an unknown kind in `kinds` → `unknown_kind`
      - `timeoutMs` outside 1–600,000 → `invalid_timeout`
    - Functional: **Enforcement rows** (probe 11):
      - root `workspaces` already globs `packages/hosts/*`; confirm it, with no edit
      - `scripts/package-truth.mjs` counts and role row
      - `src/__tests__/packaging.test.ts` row
      - the `scripts/independent-packages.json` `$comment` lockstep decision
      - `scripts/compat-baseline/arnilo__prism-headless.txt`, generated with the release gate's `runGates` compatibility leg when the CLI evidence preflight is blocked (see execution Notes)
      - `src/__tests__/host-surface-gate.test.ts` adds no headless violation; inherited MCP violations remain the entry baseline
    - Performance: One sequential pass over the routes per request, with no polling. A persisted answer log adds one checkpoint write per answer. That cost and the in-memory default that avoids it are stated in the README (probe 13).
    - Code Quality: Imports only `@arnilo/prism` and `@arnilo/prism-workflows` (for the `CheckpointStore` type). No dependency on `@arnilo/prism-remote` or `@arnilo/prism-channels`: routes are plain `HostUi`s.
    - Security: `secret` requests reach only routes that list `secret` in `kinds` explicitly. A route without `kinds` never receives `secret` or `terminal`. The answer log never stores a value. A test asserts that a secret answer's value is absent from `answers()` and from the checkpoint rows.
  - Approach:
    - Documentation Reviewed:
      - plan 170 Task 1 (l), (n); `src/host/types.ts:4-117`; `packages/hosts/acp/src/host.ts:9-36` (a `HostUi` that answers `unavailable` per kind)
    - Options Considered:
      - Race all routes in parallel and take the first answer. Rejected: the roadmap fixes an order (client, then channel, then default), and parallel prompts would ask a person who is not the first choice.
      - Store answers in the session through a kernel field. Rejected by plan 170 Task 1 (n).
    - Chosen Approach:
      - A sequential router over plain `HostUi` routes, with explicit kind limits and a value-free answer log.
    - API Notes and Examples:
      ```ts
      export interface HostUiRoute {
        readonly name: string;
        readonly ui: HostUi;
        /** Kinds this route may answer. Absent: every kind except `secret` and `terminal`. */
        readonly kinds?: readonly HostUiRequestKind[];
        readonly timeoutMs?: number;
      }
      export interface RoutedHostUi extends HostUi {
        answers(query?: { sessionId?: string; limit?: number }): Promise<readonly RoutedAnswer[]>;
        // Task 3 will add resumeWhenAnswered after its authority contract is settled.
      }
      const ui = routeHostUi([
        { name: "client", ui: remoteUi, kinds: ["confirm", "select", "input", "terminal", "notify"] },
        { name: "telegram", ui: telegramUi, kinds: ["confirm", "select", "input"], timeoutMs: 120_000 },
        policyDefault(),
      ]);
      ```
    - Files to Create/Edit:
      - `packages/hosts/headless/{package.json,tsconfig.json,README.md,CHANGELOG.md,LICENSE}`: new.
      - `packages/hosts/headless/src/{index.ts,route.ts,policy.ts,answers.ts,errors.ts,limits.ts}`: new.
      - `packages/hosts/headless/src/__tests__/route.test.ts`, `answers.test.ts`: new.
      - `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`: rows.
      - `scripts/compat-baseline/arnilo__prism-headless.txt`: new.
      - `bun.lock`: workspace entry.
    - References:
      - plan 170 Task 2 (scaffold rows)
  - Test Cases to Write:
    - `route_order_client_then_channel_then_default`: the client answers when present. With the client unavailable, the channel answers. With both unavailable, the default answers `unavailable`. Fails if the order changes.
    - `route_kind_limits_are_honored`: a `terminal` request skips the channel route (no `terminal` in its `kinds`) and reaches only the client.
    - `secret_and_terminal_need_explicit_kinds`: a route with no `kinds` never receives either.
    - `route_timeout_moves_on_and_records_late`: a channel that answers after `timeoutMs` is skipped, and its late answer is recorded `late` and discarded.
    - `route_throw_is_not_an_answer`: a throwing route records `error` and moves on.
    - `no_route_answers_kernel_suspends`: a mock-provider agent with `approval` in `ask` mode and this router suspends the run (`run.suspended`, a `suspended_run` entry).
    - `policy_default_refuses_allow`: `policyDefault({ confirm: "allow" })` → `policy_allow_refused`.
    - `answer_log_has_no_values`: after `input` and `secret` answers, `answers()` and the checkpoint rows contain neither value.
    - `router_rejects_bad_config`: `no_routes`, `duplicate_route`, `unknown_kind`, `invalid_timeout`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new host library.
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`: package page skeleton plus "Routing" (order, kinds, timeouts, policy default, answer log and its write cost).
      - `CHANGELOG.md`: `## [Unreleased]` → Added: `@arnilo/prism-headless` (`routeHostUi`).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - Shipped `packages/hosts/headless` with public `routeHostUi`, `policyDefault`, route/options/log types, limits, and coded configuration errors. Routes are sequential and kind-filtered; secret and terminal require explicit inclusion. Unavailable/invalid replies, throws, and timeouts fall through; dismissal stops routing. Late replies are discarded and recorded separately. No kernel, remote, or channel production source changed.
    - The bounded log stores metadata only. Optional checkpoint persistence writes one create-only UUID row per attempt/late settlement in `headless.answers`, with exact ownership. `answers` pages across persisted rows after restart, filters by session, bounds retained results, and returns copies. Inline HostUi requests contain no approval id, so `approvalId` is reserved for Task 3. Write errors propagate; late write errors surface on `answers`. Durable retention is host/store-owned, documented in the README.
    - Added README/package changelog/root changelog, license, package scripts/config, workflow dependency and approval test dependency. Root workspace glob already includes `packages/hosts/*`; no root manifest edit. Registered package-truth role, packaging row/count (64 publishable, 63 workspace), and explicit lockstep decision. Existing allow-list already covers every imported kernel name; no unused names added.
    - Tests written first: initial run failed on the missing index (`/tmp/prism-171-task2-red.log`). Final package run: **14 pass / 0 fail**, including all nine planned cases, actual approval-package/kernel durable suspension, invalid answers, late rejection, log isolation/restart/pagination/bounds, and write failure. `cd packages/hosts/headless && bun run typecheck && bun run test` passes.
    - `bun run typecheck`: **exit 0** (`/tmp/prism-171-task2-typecheck.log`). The install initially floated `@napi-rs/keyring` to 2.1.1 and exposed incompatible declarations; restored the existing locked 2.1.0 family before the successful rerun. Bun emitted identical duplicate package-path lines during installation; removed only identical duplicates, and `bun pm ls` successfully parses the final lockfile. No dependency range was changed outside the new package.
    - Enforcement verification: combined packaging/host gate initially **332 pass / 6 fail**. One new stale-count/truth failure was corrected. Focused rerun `bun test --timeout=0 src/__tests__/packaging.test.ts --test-name-pattern 'prism-headless|0.4 package set|historical migration'`: **7 pass / 0 fail** (`/tmp/prism-171-task2-packaging-focused.log`). Remaining full-run findings concern retired provider directories, npm dependency-tree cleanliness, and inherited MCP host-surface violations; no headless violation. Whole-plan unrelated checks were not expanded.
    - `bun scripts/package-truth.mjs` encountered existing `packages/memory/src` without a manifest. Regenerated `scripts/package-truth.json` through the same exported `computePackageTruth` using a temporary manifest-only workspace list from `loadRelease`; left the unrelated directory and generator behavior unchanged. No released docs generated.
    - `bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-headless` is blocked by missing `PRISM_TEST_POSTGRES_URL` evidence. Ran the existing gate engine directly with `runGates({ release: loadRelease(), version: "0.12.1", updateBaseline: true, packageName: "@arnilo/prism-headless" })`: **exit 0**, including declaration emit, compatibility, package tarball/ranges/lock checks (`/tmp/prism-171-task2-compat.log`). This does not bypass or satisfy the release evidence requirement for publishing.
    - Baseline diff: **new `scripts/compat-baseline/arnilo__prism-headless.txt` only, 15 added declarations, no removals**. Added names: `AnswerQuery`, `DEFAULT_MAX_ANSWERS`, `HARD_MAX_ANSWERS`, `HOST_UI_KINDS`, `HeadlessError`, `RoutedAnswer`, `answerLimit`, `createAnswerLog`, `policyDefault`, `routeHostUi`, and re-exported types `HeadlessErrorCode`, `HostUiRoute`, `PolicyAnswers`, `RouteHostUiOptions`, `RoutedHostUi`. The baseline scanner includes internal-module exports; the package root exports only its declared public API.
    - No retired API/config names or moved exports: retirement sweep not applicable. Resume, real channel bindings, scheduler, and the complete example remain Tasks 3–7; their entry gates are unchanged. Whole-plan Done/backlog handoff belongs to Task 8.

- [x] Task 3: `resumeWhenAnswered` — a later answer from any route resumes a suspended run
  - Entry gate amendment (2026-10-13): **cleared for Task 3 only**, under the user’s execution request and plan 170 Task 1’s shared-authority amendment. HostUi resume requires neither the concrete channel binding nor workflow parent context; Tasks 4–6 remain held. One `createResumeAuthority(agent)` must be shared by every participating router and `serveAgent`.
  - Acceptance Criteria:
    - Functional: `router.resumeWhenAnswered(session, pending?, { signal? })`:
      - reopens the session id through the configured authority’s scoped agent index and reads authoritative pending decisions from its branch tip, skipping package-state entries; a supplied `pending` must match those ids
      - offers each pending decision to the routes in order (approvals as `confirm`, elicitations as `select` or `input` from the decision's schema), with no per-route timeout
      - takes the first `answered` or `dismissed` response per decision
      - calls `session.resume(decisions)` once every decision has an answer
      - returns `{ status: "resumed", events }` (the lazy resume stream), `{ status: "aborted" }` on `signal`, `{ status: "already_resolved" }` when no pending suspension exists, or `{ status: "unavailable" }` if routes cannot answer every decision; unavailable never partially resumes
    - Functional: Each answer is recorded with its route (Task 2's log), and `approvalId` is set.
    - Functional: **Durable.** A fresh process with a new router over the same store resumes the run with no state from the first process.
    - Functional: **Composition with `serveAgent`.** Pass the same authority to the router and server. Both remote resume entry points call its guarded stream; the guard claims synchronously before kernel preparation and releases on completion, failure, or iterator close. The concurrent test holds the winner open until the loser has attempted, proving exactly one execution in both answer orders. Independent/direct/cross-process resumes are outside this guarantee.
    - Functional: Rejections (probe 3):
      - a `session` outside the router's `ownership` (when set) → `session_not_found`, and no route is asked
      - a `dismissed` answer → a `reject_once` host decision (kernel outcome `deny`) with reason `dismissed via <route>`
      - a route answering with the wrong value type → treated as unavailable for that route
    - Performance: One offer per pending decision per route, sequential. No polling. The wait is bounded only by `signal`, which the README states.
    - Code Quality: Uses the public Agent/session index, Session entries/resume, suspended-entry parser, and decision types only. No kernel accessor or headless runtime dependency in remote.
    - Security: A caller-supplied session object is never read or resumed; only its id is resolved under the authority. Elicitation answers are passed to `session.resume`, which validates them against the decision's `elicitationSchema`. The router never echoes tool arguments into a route prompt beyond the decision's redacted `reason`.
  - Approach:
    - Documentation Reviewed:
      - plan 170 Task 1 (e), (o); `src/suspended-run.ts:21-30`; `src/contracts-run-state.ts:60-85,340-350`; `packages/hosts/remote/src/pending.ts` (Part A's reader)
    - Options Considered:
      - Have `routeHostUi` watch every session's events and resume automatically. Rejected: a `HostUi` sees no sessions, and the host should decide which suspended sessions to offer, for example after a restart.
      - Import Part A's exported `pendingDecisionsOf`. Rejected: would couple headless to remote. Implement the small branch-tip reader over `parseSuspendedRunEntry` locally, with a parity test.
    - Chosen Approach:
      - An explicit host call using the configured agent authority, so it works live and after restart. A single required string-enum property maps to select; complex object schemas use JSON input. Values are validated by the kernel, with no tool-argument prompt content. Concurrent offers on one router fail busy; actual resume execution is arbitrated by the shared authority. Resume routes ignore inline timeouts and race only the supplied signal; late answers are discarded and logged.
    - API Notes and Examples:
      ```ts
      const authority = createResumeAuthority(agent);
      const ui = routeHostUi(routes, { resumeAuthority: authority });
      // Pass this same authority to serveAgent when both entry points are used.
      const result = await session.run("deploy", { interactive: true });
      if (result.status === "suspended") {
        const outcome = await ui.resumeWhenAnswered(session); // a later channel answer resumes it
        if (outcome.status === "resumed") for await (const event of outcome.events) log(event);
      }
      // after a restart:
      await ui.resumeWhenAnswered(await agent.session({ id: suspendedId }));
      ```
    - Files to Create/Edit:
      - `packages/hosts/headless/src/{resume.ts,authority.ts}`: offer/decision mapping and shared scoped resume authority.
      - `packages/hosts/headless/src/{index.ts,errors.ts}`: new public exports and refusal codes.
      - `packages/hosts/headless/src/route.ts`: `resumeWhenAnswered` on `RoutedHostUi`.
      - `packages/hosts/headless/src/pending.ts`: local branch-tip reader per Task 1, without a remote dependency.
      - `packages/hosts/headless/src/__tests__/resume.test.ts`, `fixtures/{agent.ts,restart.mjs}`: behavioral/race tests and two-process SQLite recovery.
      - `packages/hosts/remote/src/{serve.ts,index.ts}`: structural authority option used by reconnect and explicit resume.
      - `packages/hosts/headless/package.json`, `bun.lock`: existing remote/SQLite workspaces as test dependencies.
      - `packages/hosts/{headless,remote}/{README.md,CHANGELOG.md}`, root `CHANGELOG.md`: behavior and shared-authority contract.
      - `plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md`: prerequisite amendment.
      - `scripts/compat-baseline/arnilo__prism-{headless,remote}.txt`: regenerate in this task; attribute all declaration changes, including scanner-only internal exports.
    - References:
      - plan 153 Task 6 (durable approval across a restart); plan 162 Task 2 (channels resume pattern)
  - Test Cases to Write:
    - `later_channel_answer_resumes_run`: with the client absent and the channel timing out, the run suspends. A later channel answer through `resumeWhenAnswered` resumes it to completion, and the log records `route: "channel"`.
    - `resume_after_restart_reads_entries`: a new router and agent over the same SQLite file resume the suspended session.
    - `first_answer_wins_with_serve_agent`: through the shared authority, concurrently offer reconnect and router answers; assert exactly one resumed execution through the agreed authority. A stale-error assertion alone is insufficient.
    - `dismissed_becomes_deny_with_route`: the decision reason names the route.
    - `elicitation_answer_validated_by_kernel`: an elicitation answer outside the schema is rejected by `session.resume`, and the run stays suspended.
    - `foreign_session_not_offered`: a session outside `ownership` → `session_not_found`, and no route receives a request.
    - `abort_signal_stops_waiting`: aborting returns `aborted` and leaves the suspension intact.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `resumeWhenAnswered`.
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`: "Suspension and later answers" (live, after restart, composition with `serveAgent`, the scope limit that only asks and elicitations suspend).
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - Implemented `resumeWhenAnswered` over the public suspended-entry parser and Agent/Session APIs. It resolves only the caller's id through a configured `createResumeAuthority(agent)`, rejects foreign sessions and mismatched ownership before offers, ignores caller-provided descriptor content, and applies all decisions in one resume stream. Wrong types and malformed JSON fall through; dismissal maps to `reject_once` with the route reason. One required enum property uses select; complex schemas use JSON input, revalidated by the kernel. Offers have no route timeout, can abort without changing the suspension, and discard late settlements. Logs contain route/kind/status/session/approval id metadata only. All-unavailable returns `unavailable` without a partial resume; this fills an unspecified result case in the original task.
    - Resolved the prerequisite in plan 170 Task 1: one host-owned authority arbitrates resume streams, with a synchronous per-session claim held through iteration and released in `finally`. Both `serveAgent` reconnect delivery and explicit remote resumes use the optional structural authority while retaining connection principal and queue limits. No headless import in remote and no kernel changes. The two winner-order race test holds the winner open until the loser attempts; both paths reach the authority, exactly one receives `resume_busy`, and exactly one tool executes. Direct kernel calls, independent authorities, and separate processes bypass this in-process guard, as documented. Concrete channel and scheduler contracts remain Tasks 4–6.
    - Recovery proof uses two separate Bun processes and one SQLite file: the first writes a real suspension and exits; the second creates a fresh agent/router/authority, reads entries, and completes the same run with one tool execution. Fixtures live under headless tests; remote and SQLite are existing workspace devDependencies, with no new runtime dependency. `bun install --lockfile-only` emitted 13 identical duplicate package-path rows; removed only those identical duplicates. Existing keyring 2.1.0 remained locked.
    - Validation: `bun run --cwd packages/hosts/headless test`: **26 pass / 0 fail**, including 12 resume cases; `bun run --cwd packages/hosts/remote test`: **64 pass / 0 fail**, including all three transport conformance legs and authentication/principal checks. Root `bun run typecheck`: **exit 0**, covering core build, workspace checks, and examples. Focused `bun test --timeout=0 src/__tests__/packaging.test.ts --test-name-pattern 'prism-headless|prism-remote'`: **10 pass / 0 fail**. Biome checks on the changed implementation/tests and remote source: **exit 0**.
    - Broader checks: host-surface gate **3 pass / 1 fail**, reporting only the six inherited MCP-server import violations and none under headless/remote. Docs suite **145 pass / 25 fail** (`/tmp/prism-task3-docs.log`): unresolved historical links, stale counts/current-contract assertions, existing missing finalized 0.1.0 package-changelog sections (headless included), and other untouched documentation. This observed count differs from the earlier entry-check count; no broad docs repair is claimed. The task adds no API page or example enforcement row. Whole-plan scheduler/channel/example/Done verification remains with later tasks.
    - `bun scripts/release.mjs gate --update-baseline`: blocked before gates by missing `PRISM_TEST_POSTGRES_URL`. Ran the existing offline engine for each changed library using `runGates({ release: loadRelease(), version: "0.12.1", updateBaseline: true, packageName })`: **exit 0** for headless and remote (`/tmp/prism-task3-compat.log`), including declaration generation, compatibility, ranges/lock and tarball checks. This does not satisfy release evidence or authorize publication.
    - Baseline attribution: headless adds six scanner entries (`ResumeWhenAnsweredOptions`, `ResumeWhenAnsweredResult`, `createResumeAuthority`, local `pendingDecisionsOf`, internal-module `resumeWhenAnswered`, and `type ResumeAuthority`). Remote adds `type RemoteResumeAuthority` and extends scanner-only `createServerState`'s optional Pick with `resumeAuthority`. Re-export signature changes are import/export ordering or the additional remote type; no names were removed. Internal-module scanner entries are not additional package-root exports. Exact diff:

      ```diff
      --- arnilo__prism-headless.txt (Task 2)
      +++ arnilo__prism-headless.txt (Task 3)
      @@ -1,15 +1,21 @@
      -AnswerQuery	export type { RoutedAnswer, AnswerQuery } from "./answers.js"
      +AnswerQuery	export type { AnswerQuery, RoutedAnswer } from "./answers.js"
       DEFAULT_MAX_ANSWERS	export declare const DEFAULT_MAX_ANSWERS = 1000
       HARD_MAX_ANSWERS	export declare const HARD_MAX_ANSWERS = 100000
       HOST_UI_KINDS	export declare const HOST_UI_KINDS: readonly HostUiRequestKind[]
       HeadlessError	export declare class HeadlessError extends Error
      -RoutedAnswer	export type { RoutedAnswer, AnswerQuery } from "./answers.js"
      +ResumeWhenAnsweredOptions	export type { ResumeWhenAnsweredOptions, ResumeWhenAnsweredResult } from "./resume.js"
      +ResumeWhenAnsweredResult	export type { ResumeWhenAnsweredOptions, ResumeWhenAnsweredResult } from "./resume.js"
      +RoutedAnswer	export type { AnswerQuery, RoutedAnswer } from "./answers.js"
       answerLimit	export declare function answerLimit(value?: number): number
       createAnswerLog	export declare function createAnswerLog(maxAnswers: number, store?: CheckpointStore, ownership?: OwnershipScope):
      +createResumeAuthority	export declare function createResumeAuthority(agent: Agent): ResumeAuthority
      +pendingDecisionsOf	export declare function pendingDecisionsOf(branch: readonly SessionEntry[]): readonly PendingDecision[]
       policyDefault	export declare function policyDefault(answers?: PolicyAnswers): HostUiRoute
      +resumeWhenAnswered	export declare function resumeWhenAnswered(authority: ResumeAuthority, supplied: Pick<Session, "id">, pending: readonly PendingDecision[] | undefined, options: ResumeWhenAnsweredOptions, offer: (request: HostUiRequest, approvalId: string, signal?: AbortSignal, accept?: (answer: HostUiResponse, route: string) => boolean) => Promise<
       routeHostUi	export declare function routeHostUi(routes: readonly HostUiRoute[], options?: RouteHostUiOptions): RoutedHostUi
       type HeadlessErrorCode	export { HeadlessError, type HeadlessErrorCode } from "./errors.js"
      -type HostUiRoute	export { routeHostUi, type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions } from "./route.js"
      -type PolicyAnswers	export { policyDefault, type PolicyAnswers } from "./policy.js"
      -type RouteHostUiOptions	export { routeHostUi, type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions } from "./route.js"
      -type RoutedHostUi	export { routeHostUi, type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions } from "./route.js"
      +type HostUiRoute	export { type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions, routeHostUi } from "./route.js"
      +type PolicyAnswers	export { type PolicyAnswers, policyDefault } from "./policy.js"
      +type ResumeAuthority	export { createResumeAuthority, type ResumeAuthority } from "./authority.js"
      +type RouteHostUiOptions	export { type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions, routeHostUi } from "./route.js"
      +type RoutedHostUi	export { type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions, routeHostUi } from "./route.js"
      --- arnilo__prism-remote.txt (Task 2)
      +++ arnilo__prism-remote.txt (Task 3)
      @@ -18,7 +18,7 @@
       createChannel	export declare function createChannel<T>(maxQueued: number, overflow?: Overflow, onReturn?: () => void): Channel<T>
       createDispatcher	export declare function createDispatcher(options: DispatcherOptions): Dispatcher
       createMemoryTransportPair	export declare function createMemoryTransportPair(): [RemoteTransport, RemoteTransport]
      -createServerState	export declare function createServerState(agent: Agent, options: Pick<ServeAgentOptions, "hostUi" | "limits" | "endpointId">): ServerState
      +createServerState	export declare function createServerState(agent: Agent, options: Pick<ServeAgentOptions, "hostUi" | "limits" | "endpointId" | "resumeAuthority">): ServerState
       createSessionMirror	export declare function createSessionMirror(options: MirrorOptions): SessionMirror
       createSessionProxy	export declare function createSessionProxy(context: ProxyContext, sessionId: string, initialLeafId: string | undefined, mirror: SessionMirror | undefined): SessionProxy
       decisionFromAnswer	export declare function decisionFromAnswer(pending: PendingDecision, answer: HostUiResponse): Decision | undefined
      @@ -63,12 +63,13 @@
       type RemoteMethods	export { CLIENT_METHODS, type HostUiRequestParams, type HostUiRequestResult, type InitializeParams, type InitializeResult, isSupportedProtocol, KNOWN_CAPABILITIES, knownCapabilities, REMOTE_PROTOCOL, type RemoteCapabilities, type RemoteCapabilityName, type RemoteClientMethod, type RemoteMethods, type RemoteNotifications, type RemoteRunOptions, SERVER_NOTIFICATIONS, SERVER_REQUESTS, } from "./protocol.js"
       type RemoteNotificationHandler	export { createDispatcher, type Dispatcher, type DispatcherContext, type DispatcherOptions, type RemoteHandler, type RemoteNotificationHandler, } from "./dispatcher.js"
       type RemoteNotifications	export { CLIENT_METHODS, type HostUiRequestParams, type HostUiRequestResult, type InitializeParams, type InitializeResult, isSupportedProtocol, KNOWN_CAPABILITIES, knownCapabilities, REMOTE_PROTOCOL, type RemoteCapabilities, type RemoteCapabilityName, type RemoteClientMethod, type RemoteMethods, type RemoteNotifications, type RemoteRunOptions, SERVER_NOTIFICATIONS, SERVER_REQUESTS, } from "./protocol.js"
      +type RemoteResumeAuthority	export { type RemoteResumeAuthority, type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
       type RemoteRunOptions	export { CLIENT_METHODS, type HostUiRequestParams, type HostUiRequestResult, type InitializeParams, type InitializeResult, isSupportedProtocol, KNOWN_CAPABILITIES, knownCapabilities, REMOTE_PROTOCOL, type RemoteCapabilities, type RemoteCapabilityName, type RemoteClientMethod, type RemoteMethods, type RemoteNotifications, type RemoteRunOptions, SERVER_NOTIFICATIONS, SERVER_REQUESTS, } from "./protocol.js"
       type RemoteTransport	export { createMemoryTransportPair, type RemoteTransport, type StdioTransportOptions, stdioTransport, type WritableLike, } from "./transport.js"
       type ResolvedRemoteLimits	export { REMOTE_LIMITS, type RemoteLimitName, type RemoteLimitOptions, type ResolvedRemoteLimits, resolveRemoteLimits, } from "./limits.js"
      -type ServeAgentOptions	export { type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
      -type ServeTransport	export { type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
      -type ServedAgent	export { type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
      +type ServeAgentOptions	export { type RemoteResumeAuthority, type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
      +type ServeTransport	export { type RemoteResumeAuthority, type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
      +type ServedAgent	export { type RemoteResumeAuthority, type ServeAgentOptions, type ServedAgent, type ServeTransport, serveAgent } from "./serve.js"
       type SessionMirror	export { createSessionMirror, type SessionMirror } from "./mirror.js"
       type StdioTransportOptions	export { createMemoryTransportPair, type RemoteTransport, type StdioTransportOptions, stdioTransport, type WritableLike, } from "./transport.js"
       type WritableLike	export { createMemoryTransportPair, type RemoteTransport, type StdioTransportOptions, stdioTransport, type WritableLike, } from "./transport.js"
      ```

    - No retired names or moved kernel exports: retirement sweep not applicable. README and package/root changelogs document the authority, abort/wait behavior, duplicate prompts, log cost, and limited coordination scope. Only Task 3 is checked; whole-plan compromises/backlog handoff remains Task 8.

- [x] Task 4: `channelHostUi` — a paired chat answers `HostUi` requests
  - Entry gate (2026-10-13): **cleared** by plan 170 Task 1’s Task 4 amendment. Use private connection/runtime binding, consumed-pairing lookup, shared CAS control persistence and authorization-before-dispatch as specified there; no workflow prerequisite or kernel change.
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-channels` exports `channelHostUi({ connection, chat, kinds?, ownership })`, which returns a `HostUi` for a connected Telegram or Signal channel:
      - `confirm` and `select` are sent as a message with reply options. `input` is sent as a prompt that expects a text reply. `notify` is sent as a message and answered `answered`.
      - Every other kind answers `unavailable`.
      - The reply is correlated through a generalized channel request record with token/request id, value kind, expiry, and identity binding (Task 1 (d)); existing approval-only records cannot represent select/input. The prerequisite amendment specifies private connection binding, consumed-pairing lookup, and admitted-reply dispatch before implementation.
      - The answer comes only from a reply admitted by the channel's pairing and `authorizeEvent` path for the configured `chat`.
    - Functional: Rejections (probe 3):
      - a reply from an unpaired sender or another chat → ignored, and the request stays pending
      - a reply after the request was settled → answered with "expired" and not applied
      - a closed connection → `unavailable`
      - a literal bot token → the existing `ChannelTokenLiteralError`
    - Functional: The existing scripted test transport drives it. Task 7's example uses it as "a scripted channel".
    - Performance: One outbound message per request. Pending requests are bounded by the channel's existing approval limits (`limits.ts`).
    - Code Quality: Reuses the channel's delivery journal and approval store. No second pairing or authorization path. No agent turn is started for a `HostUi` reply.
    - Security: Untrusted request text (`title`, `detail`, option labels) is sent as plain text, never as markup, matching `HostUiRequestBase`'s rule (`src/host/types.ts:3`). A reply's text reaches the router only as the request's answer value, and the channel logs record no `input` value.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (d); `packages/hosts/channels/src/{approvals.ts:54-118,delivery.ts,runtime-turn.ts:267-389,telegram.ts:1164-1180,signal.ts,types.ts:434-440,limits.ts}`; `packages/hosts/channels/README.md`
    - Options Considered:
      - Put the channel route in `prism-headless`. Rejected by plan 170 Task 1 (l): the chat wire, pairing, and delivery live in `prism-channels`.
      - Drive answers by running a channel agent turn. Rejected: a `HostUi` reply is not a prompt, and a turn would call the model.
    - Chosen Approach:
      - A thin `HostUi` over shared CAS control persistence and the delivery journal, admitted through the existing authorization path. `chat` is `pair:<consumed pairing token>`; there is no alias registry. Up to eight select options; input/multi-select use explicit `/answer` token correlation. Waiters expire within the existing approval TTL, close resolves unavailable, restart requires a fresh offer; unsupported message editing is not promised.
    - API Notes and Examples:
      ```ts
      const telegram = await connectTelegram(agent, { token: "env:TELEGRAM_TOKEN", checkpoints, leases });
      const telegramUi = channelHostUi({ connection: telegram, chat: `pair:${consumedPairingToken}`, ownership });
      ```
    - Files to Create/Edit:
      - `packages/hosts/channels/src/host-ui.ts`: new.
      - `packages/hosts/channels/src/index.ts`: export.
      - `packages/hosts/channels/src/{approvals.ts,pairing.ts,runtime.ts,telegram.ts,signal.ts}`: request correlation, finite expiry, authorization-before-waiter dispatch, and connection binding; contract specified by the Task 4 prerequisite amendment. Preserve existing approval handling in `runtime-turn.ts`.
      - `packages/hosts/channels/src/__tests__/host-ui.test.ts`: new. `connect.test.ts` reuses its scripted Signal socket for end-to-end HostUi coverage; `package.json` includes both suites in the test command.
      - `packages/hosts/channels/README.md`: "Answering `HostUi` requests" section.
      - `scripts/compat-baseline/arnilo__prism-channels.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline` (adds `channelHostUi`; the diff goes in the task note).
    - References:
      - plan 162 Task 2 (channels on one `Agent`, chat approvals through suspension)
  - Test Cases to Write:
    - `channel_confirm_answered_by_paired_reply`: a scripted paired reply answers `confirm`, and the router receives `answered: true`.
    - `unpaired_reply_is_ignored`: a reply from another sender leaves the request pending.
    - `late_reply_after_settle_is_expired`: the reply is not applied, and the user gets the "expired" message.
    - `unsupported_kinds_are_unavailable`: `secret`, `terminal`, and `open-url` answer `unavailable`.
    - `request_text_is_plain`: markup characters in `title` are escaped or sent as plain text in the outbound message.
    - Additional coverage: select/multi-select index validation, no-authorizer and unconsumed-pairing refusal, ownership/grant/principal checks, shared capacity, concurrent CAS settlement, close/expiry, fresh offers after restart, delivery/storage failure, immutable request snapshots, credential redaction, and Signal confirm/select/input/notify.
    - `input_value_not_logged`: the reply text is absent from channel logs and the delivery journal's stored fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `channelHostUi` in `@arnilo/prism-channels`.
    - Docs pages to create/edit:
      - `packages/hosts/channels/README.md`: new section.
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Earlier execution attempt (2026-10-13, superseded by the Task 4 amendment): **held at that time; not implemented or marked complete.** Rechecked plan 170 Task 1's amendments: Task 3 clears the shared resume authority only and explicitly leaves channel binding held. Task 4's prerequisite amendment is still absent. `ChannelConnectionHandle` exposes lifecycle/inbound methods only; approval records require a channel-owned run/session and fixed approval outcome, and `handleApproval` resumes that run. These cannot safely stand in for external confirm/select/input requests. Before implementation, amend plan 170 Task 1 and this task to specify the connection-to-runtime binding, resolution of the illustrative `chat: "pair:ops"` alias to an authorized actor/thread/principal/grant, refusal without a paired-chat authorizer, generalized request records and select/input wire correlation, dispatch after authorization but before agent turns, and finite expiry/close cleanup. Preserve existing approval behavior and keep input answers out of journals. This follows Task 1's explicit stop rule; no production files, exports, or baselines changed, and no implementation checks were run for this attempt.

  - Notes (executed 2026-10-13):
    - Completed `channelHostUi` for connections constructed by `connectTelegram` and `connectSignal`. The prerequisite amendment in plan 170 Task 1 clears this slice only. A private WeakMap binds connections to their existing runtime; the host supplies `chat: "pair:<consumed pairing token>"` and exact ownership. `ChannelPairingStore.resolve` reads the consumed pairing; no alias registry, second pairing path, agent construction, or kernel change was added. An explicit authorizer is mandatory. HostUi uses the existing `approval` authorization action: outbound synthetic events carry the paired ids and empty text, and inbound events carry the actual reply context. Active identity, ownership, actor/conversation/thread, principal and grant revision are checked before answers apply; no-authorizer/default-identity admission is refused for this route.
    - Shared CAS control persistence now supports a separate `u1` HostUi request record (request id, kind, expiry, identity binding), preserving the existing `a1` approval records and their durable resume path. Telegram confirm/single-select buttons use `q:<token>:<index>`; Signal renders equivalent `/answer` commands. Input and multi-select use explicit `/answer <token> <value>` text replies on both transports. Up to eight unique select values are supported; malformed indexes and duplicate choices do not consume the request. Replies are intercepted after event validation/authorization and before ordinary operation journaling or model dispatch. Only outbound prompts/controls and correlation metadata persist; input answers remain in memory.
    - One prompt message per request, plain text and credential-redacted, bounded by the smaller common 2,000-code-unit transport budget (including Signal controls) and existing response-byte cap. Overlong prompts/labels return unavailable. The existing delivery journal stages prompts and records delivery outcomes; failed/unknown delivery and storage errors fail closed. Connect options now expose the existing runtime `limits`. Shared per-process/per-binding request limits, finite end-to-end approval TTL, synchronous close cancellation, request snapshots and CAS prevent capacity leaks, indefinite authorization waits, changed-option answers and double settlement. A regression test found and fixed a timeout cleanup race: expiry releases capacity before a fresh offer. Close also resolves requests still awaiting authorization. Stale/consumed/orphaned matched replies receive a plain expired notice and never become agent prompts.
    - Restart contract: waiters/answer values are not persisted. Old tokens expire from the rebuilt runtime's perspective, and the host/router must offer the suspended decision again. Router timeouts cannot cancel an outstanding channel question; duplicate prompts remain possible until the channel TTL expires. Neither adapter exposes message editing, so none is promised. No automatic replay or resend was added. Task 7 must create/consume a scripted pairing and configure an explicit authorizer for its channel; Tasks 5–6 remain held on workflow-parent and scheduler durability contracts, now reflected in their entry gates.
    - Validation: initial new test failed because `channelHostUi` was absent (`/tmp/prism-task4-red.log`). Final `bun run --cwd packages/hosts/channels test`: **119 pass / 1 PostgreSQL skip / 0 fail**, including **18** new HostUi tests and the new scripted-Signal flow in the existing connect fixture. Coverage includes paired confirm, foreign actor/chat/thread, unsupported kinds, plain text/notify, overlapping input with no stored values, select/multi-select validation, unconsumed pairing/no-authorizer/foreign scope, grant/principal changes, expiry/close/shared capacity, concurrent settlement, restart/fresh offers, failed delivery/storage, snapshots/redaction, bounded authorization and close during authorization. Signal confirm/select/input/notify and the exact 2,000-unit one-message boundary pass; literal credential rejection and legacy approval/restart tests pass in the same suite. Package-local typecheck and root `bun run typecheck` (core build, workspaces and examples): **exit 0**. Focused Biome check on the new implementation/tests and refactored approval/runtime files plus scoped `git diff --check`: **exit 0**.
    - Adjacent verification: headless **26 pass / 0 fail**; remote **64 pass / 0 fail**; focused channels packaging **6 pass / 0 fail**. Host-surface gate **3 pass / 1 inherited MCP-server failure**, with the same six MCP import violations and none under channels. All imported kernel names already belong to the frozen/phase17 allow-list, so no allow-list expansion was needed. Docs suite **145 pass / 25 fail**, matching Task 3's recorded count; failures concern existing links/counts/contract narratives/finalized changelog sections and other untouched docs. Logs: `/tmp/prism-task4-{channels-final,typecheck-final,headless,remote,packaging,host-surface,docs}.log`. No live Telegram/Signal account or PostgreSQL service was exercised; whole-plan scheduler/example/Done checks remain later tasks.
    - Release/baseline: `bun scripts/release.mjs gate --update-baseline` is blocked before gates by missing `PRISM_TEST_POSTGRES_URL`, as before. Ran the existing offline engine with `runGates({ release: loadRelease(), version: "0.12.1", updateBaseline: true, packageName: "@arnilo/prism-channels" })`, then reran without update: **exit 0** (`/tmp/prism-task4-compat{,-final}.log`), covering declaration generation, compatibility, ranges/lock and tarball checks. This does not satisfy release evidence or authorize publication. Five baseline additions: public `channelHostUi` and `type ChannelHostUiOptions`, plus scanner-only internal module exports `bindChannelHostUi`, `registerChannelHostUi`, and `createChannelUiRequestStore`. The latter three are not root exports. Interface additions `ChannelPairingStore.resolve` and connect `limits` are documented and typechecked; this scanner does not encode their members. No removed names or moved kernel exports, so no retirement sweep applies. Exact Task 4 baseline diff:

      ```diff
      --- arnilo__prism-channels.txt (before Task 4)
      +++ arnilo__prism-channels.txt (Task 4)
      @@ -78,6 +78,8 @@
       UNSUPPORTED_MEDIA_NOTICE	export declare const UNSUPPORTED_MEDIA_NOTICE = "That attachment cannot be processed by the selected agent."
       assertIdentityActive	export declare function assertIdentityActive(identity: AgentIdentity): void
       assertIdentityMatchesOwnership	export declare function assertIdentityMatchesOwnership(identity: AgentIdentity, ownership?: OwnershipScope): void
      +bindChannelHostUi	export declare function bindChannelHostUi(connection: ChannelConnectionHandle, runtime: ChannelRuntime, connectionId: string): void
      +channelHostUi	export declare function channelHostUi(options: ChannelHostUiOptions): HostUi
       connectSignal	export declare function connectSignal(agent: Agent, options: SignalConnectOptions): Promise<ChannelConnectionHandle>
       connectTelegram	export declare function connectTelegram(agent: Agent, options: TelegramConnectOptions): Promise<ChannelConnectionHandle>
       createChannelApprovalStore	export declare function createChannelApprovalStore(checkpoints: CheckpointStore): ChannelApprovalStore
      @@ -86,6 +88,7 @@
       createChannelRedactor	export declare function createChannelRedactor(secret: string, agentRedactor?: SecretRedactor): SecretRedactor
       createChannelRuntime	export declare function createChannelRuntime(agent: Agent, options: ChannelRuntimeOptions): ChannelRuntime
       createChannelStateStore	export declare function createChannelStateStore(options: ChannelStateStoreOptions): ChannelStateStore
      +createChannelUiRequestStore	export declare function createChannelUiRequestStore(checkpoints: CheckpointStore):
       createMemoryCheckpointStore	export declare function createMemoryCheckpointStore(): CheckpointStore
       createMemoryLeaseStore	export declare function createMemoryLeaseStore(): LeaseStore
       createRuntimeAdmit	export declare function createRuntimeAdmit(ctx: RuntimeContext, core: RuntimeCore, turnRuntime: RuntimeTurn):
      @@ -98,8 +101,10 @@
       emptyPruneResult	export declare function emptyPruneResult(): ChannelPruneResult
       isSettledReply	export declare function isSettledReply(record: ChannelReplyRecord): boolean
       ownershipFromIdentity	export declare function ownershipFromIdentity(identity: AgentIdentity): OwnershipScope
      +registerChannelHostUi	export declare function registerChannelHostUi(runtime: ChannelRuntime, ctx: RuntimeContext, core: RuntimeCore):
       resolveChannelLimits	export declare function resolveChannelLimits(input?: ChannelLimits): ResolvedChannelLimits
       resolveChannelSecretRef	export declare function resolveChannelSecretRef(agent: Agent, ref: string): Promise<string>
       retryableAdmission	export declare function retryableAdmission(value: unknown): boolean
      +type ChannelHostUiOptions	export { channelHostUi, type ChannelHostUiOptions } from "./host-ui.js"
       type SignalConnectOptions	export { connectSignal, type SignalConnectOptions } from "./signal.js"
       type TelegramConnectOptions	export { connectTelegram, type TelegramConnectOptions } from "./telegram.js"
      ```

- [x] Task 5: `createScheduler` — cron, one-off, and triggered firings over agents and workflows
  - Entry gate (2026-10-13): **cleared** by the user-authorized plan 170 Task 1 scheduler amendment. Use registered workflow commands and the documented at-most-once crash contract; Tasks 3–4 remain unchanged.
  - Acceptance Criteria:
    - Functional: `createScheduler({ checkpoints, targets, ownership, clock?, limits? })` (Task 6 adds `leases`, `ownerId`, and `missed`) returns a `Scheduler` with `schedule`, `list`, `pause`, `resume`, `delete`, `trigger`, `start`, and `stop`.
    - Functional: Targets are named in `targets`:
      - `{ kind: "agent", agent, input, runOptions? }`
      - `{ kind: "workflow", command, input, agent }` (command registered with `workflowCommand` for the definition)
    - Functional: `schedule({ id, target, cron, tz? })` validates the expression with `Bun.cron.parse` (an invalid one → `invalid_cron`). `schedule({ id, target, at })` creates a one-off. Either form opens the schedule session (Task 1 (c)) and persists `{ id, target, cron | at, tz, nextRunAt, status, scheduleSessionId, lastFiring? }` under namespace `headless.schedules` with CAS on version.
    - Functional: Schedule/trigger parents open with `actor: { kind: "prism", agent: agent.id }`, making the first session metadata entry durable before a firing.
    - Functional: **Firing.** When `clock.now() >= nextRunAt`, the scheduler first advances `nextRunAt` with a CAS write (one-offs become `completed`), then:
      - for an agent target, opens `agent.session({ parent: { sessionId: scheduleSessionId, agentId: agent.id } })` and runs `input`
      - for a workflow target, invokes the registered `workflowCommand` through `agent.commands.run(command, input, { session: scheduleSession })`, which supplies the real bound context to `startWorkflow`. Never synthesize `PackageAPI` or `SessionContext`.

      It records `lastFiring = { firingId, sessionId | workflowRunId, status }`.
    - Functional: `trigger(target, { input? })` fires immediately, outside any schedule, with the same parent-link rules (the trigger's schedule session is a per-target "triggers" session).
    - Functional: A suspended firing stays suspended, and the scheduler records `status: "suspended"`. Resuming it is the host's choice, for example through Task 3.
    - Functional: Rejections (probe 3):
      - an unknown target → `unknown_target`
      - a duplicate schedule id → `duplicate_schedule`
      - `at` in the past at creation → `past_one_off`
      - a `tz` that `Bun.cron.parse` rejects → `invalid_timezone`
      - more than `limits.maxSchedules` (default 1,000, hard maximum 10,000) → `schedule_limit`
    - Performance:
      - `start()` uses one timer armed for the earliest `nextRunAt` (re-armed on change), never a fixed-interval poll. A `clock.sleep` injection replaces the timer in tests.
      - Each firing costs a claim CAS and a completion CAS plus the target run; a crash between claim and execution can lose the firing. A durable `running` record is uncertain and never automatically replayed.
      - Firings run concurrently up to `limits.maxConcurrentFirings` (default 4, hard maximum 1,000), reserving capacity before checkpoint I/O. `stop()` cancels the timer, drains admitted work, and surfaces storage/clock failures. Manual triggers at capacity reject with `firing_limit`.
    - Code Quality: Cron next-time comes only from `Bun.cron.parse(expression, clock.now(), { tz: tz ?? "UTC" })`. No cron parser is written and no dependency is added. The state codec is versioned (`schemaVersion: 1`).
    - Security: Every checkpoint read and write carries the scheduler's `ownership`. A schedule row from another scope is never listed or fired. `input` is stored as given, and the README warns not to put secrets in schedule input.
  - Approach:
    - Documentation Reviewed:
      - plan 170 Task 1 (m) and the `Bun.cron.parse` spike; Bun 1.4.2 cron docs retrieved with find-docs (`/oven-sh/bun/bun-v1.4.2`, `docs/runtime/cron.mdx`); bun-types `bun.d.ts:8262-8506` (Bun 1.4.2); `packages/integrations/workflows/src/{contracts.ts:70-112,parent-session.ts:42-66}`; the deleted 0.12 `schedules.ts` (`git show HEAD:packages/prism-core/src/runtime/workflows/schedules.ts`) for interval and calculator semantics, not ported
    - Options Considered:
      - Use OS-level `Bun.cron(path, schedule, title)`. Rejected: it spawns a fresh process per invocation with no shared state, cannot target an in-process `Agent`, and is not testable on a fake clock.
      - Persist schedules in the `SessionStore`. Rejected by plan 170 Task 1 (m): no key-value surface and no CAS.
      - Port the 0.12 interval/calculator schedules. Rejected: the roadmap names cron, one-off, and triggers. An interval is expressible as cron, and a calculator has no consumer.
    - Chosen Approach:
      - CAS-advanced schedule rows in the `checkpoints` service, `Bun.cron.parse` for next times, one armed timer, and the existing session and workflow parent links.
    - API Notes and Examples:
      ```ts
      const scheduler = createScheduler({
        checkpoints, ownership, clock,
        targets: { nightly: { kind: "workflow", command: "nightly-build", input: { goal: "nightly" }, agent: host } },
      });
      await scheduler.schedule({ id: "nightly-build", target: "nightly", cron: "0 2 * * *", tz: "UTC" });
      scheduler.start();
      ```
    - Files to Create/Edit:
      - `packages/hosts/headless/src/scheduler/{index.ts,state.ts,firing.ts,clock.ts,cron.ts}`: new (`cron.ts` wraps `Bun.cron.parse` and maps its errors).
      - `packages/hosts/headless/src/index.ts`, `errors.ts`: exports and scheduler errors.
      - `packages/hosts/headless/package.json`: description (the workflows dependency already exists; no dependency change).
      - `packages/hosts/headless/README.md`, `CHANGELOG.md`: scheduling contract and Added line.
      - `plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md`, this plan, `plans/README.md`: prerequisite amendment, execution notes and progress.
      - `packages/hosts/headless/src/__tests__/scheduler.test.ts`, `fixtures/scheduler-restart.mjs`: new scheduler suite and fresh-process SQLite proof.
      - `scripts/compat-baseline/arnilo__prism-headless.txt`: regenerated.
    - References:
      - plan 168 Task 1 (schedules deleted for Phase 17); plan 169 Task 2 (`startWorkflow` parent session)
  - Test Cases to Write:
    - `cron_schedule_fires_on_fake_clock_and_agent_firing_has_parent_link`: advancing the fake clock past `0 2 * * *` fires once, and `nextRunAt` moves to the next day.
    - `one_off_fires_once_and_completes`: the status becomes `completed`, and no second firing happens.
    - Parent-link assertion in `cron_schedule_fires_on_fake_clock_and_agent_firing_has_parent_link`: `createSessionIndex(store).list({ parentSessionId: scheduleSessionId })` returns the firing session.
    - `workflow_firing_starts_run_under_schedule_session_and_trigger_fires_immediately`: the workflow run's parent session is the schedule session.
    - Immediate-trigger assertion in `workflow_firing_starts_run_under_schedule_session_and_trigger_fires_immediately`: `trigger("nightly")` starts a run outside the cron.
    - `suspended_firing_is_recorded`: a firing that suspends records `status: "suspended"` and is not retried.
    - `scheduler_rejects_bad_input`: `invalid_cron`, `invalid_timezone`, `unknown_target`, `duplicate_schedule`, `past_one_off`, `schedule_limit`.
    - `foreign_scope_schedules_are_invisible_including_wildcard_queries`: a row written under another ownership is neither listed nor fired.
    - `single_timer_no_polling_and_pause_resume_delete_rearm`: with no schedule due, the injected `clock.sleep` is called once with the full delay.
    - `fresh_scheduler_reads_persisted_state_and_CAS_claims_once`: two instances contend on one due occurrence; exactly one child session exists.
    - `bounded_concurrency_stop_drains_and_completion_preserves_pause_delete`: serialized capacity, active drain, and completion merges.
    - `inflight_claim_reserves_concurrency_before_checkpoint_ack`: delayed claim acknowledgement cannot allow a trigger to bypass the limit.
    - `storage_failures_stop_background_work_and_surface_on_stop`: no target starts after a failed claim write.
    - `uncertain_claim_is_not_replayed_after_a_failed_claim_acknowledgement`: a committed but unacknowledged claim remains uncertain and is not retried.
    - `local_admission_is_serialized_and_schedule_input_is_snapshotted`: capacity, durable initial parents, and defensive state copies.
    - `invalid_state_unknown_workflow_and_trigger_input_fail_closed`: invalid codec/command/input rejection.
    - `trigger_parent_is_reused_and_suspended_schedule_is_not_retried`: shared trigger parent and durable suspended result.
    - `SQLite_schedule_and_workflow_parent_survive_process_restart`: independent processes recover the persisted schedule and workflow parent.
    - `workflow_status_validation_and_unknown_options`: denied status, malformed command result, and unsupported config.
    - `explicit_timezone_and_deleted_id_recreation`: non-UTC next time, tombstone version continuity, and missing schedule refusal.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `createScheduler`.
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`: "Scheduling" (targets, cron and `tz`, one-offs, triggers, parent links, state, per-firing write cost, no secrets in input).
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - Completed the user-authorized contract amendment in plan 170 Task 1 and implemented Task 5 entirely in the headless host library. Workflow targets name a pre-registered `workflowCommand`; the public command boundary supplies `PackageAPI`/`SessionContext` to `startWorkflow`. No kernel contract, agent factory, cron parser, dependency, or released docs change. Schedule input is persisted as a snapshot. Every checkpoint operation carries exact ownership, wildcard list results are filtered, and target agents must have the same scope.
    - Source finding: `agent.session()` alone writes no durable entry. Parents now set the truthful public Prism actor, causing the existing first metadata entry to persist (`src/agent-session/session.ts:309-325`). This makes them reopenable before a workflow starts; the SQLite fixture proves that across two processes. Agent firings create indexed child sessions; workflows write under the schedule session. Trigger parents use a deterministic scoped/agent/target hash and are reused after restart.
    - Scheduler behavior: cron/one-off/trigger, explicit UTC or supplied zone, scoped versioned rows, CAS-before-start, pause/resume/delete with tombstones, defensive copies, one cancellable earliest-deadline timer, concurrency reserved before claim I/O, and stop/drain. Completion CAS merges preserve pause/delete and newer firing ids. Suspended and denied results retain their status; arbitrary execution errors record only `failed`. Storage/clock failures stop background admission and surface on `stop()`. One-offs at now are valid; past/non-finite/out-of-Date-range timestamps fail. Unknown future options are rejected rather than ignored.
    - Durability/cost: two writes per scheduled firing (claim and result), plus reads and the target's work. Crash/acknowledgement loss after a committed claim may lose the firing; durable `running` means uncertain, with no automatic replay. Tombstone retention is host-owned. Capacity admission is serialized per instance, not transactional across processes; external edits require host coordination/restart rather than push notifications. These limits are in the README. Task 6 remains unchecked but its gate is cleared: add scoped leases/renewal/fencing, startup missed policies, healthy two-worker once-only proof, and a process-kill proof of the accepted loss window. Do not claim transactional exactly-once tool effects. Task 7 must register its workflow command and use a workflow agent node when proving session-index child links.
    - Tests were written first and failed on the missing `createScheduler` export (`/tmp/prism-task5-red.log`). Final `bun run --cwd packages/hosts/headless test`: **44 pass / 0 fail**, including **18** scheduler tests; workflows: **183 pass / 0 fail**. The delayed-claim test found a capacity race, fixed by reserving before storage I/O. The restart test exercises actual SQLite in separate processes. Package typecheck and root `bun run typecheck` (core build, workspace and example checks): **exit 0**. Focused Biome: **exit 0**. Logs: `/tmp/prism-task5-{headless,workflows,package-typecheck,typecheck,biome}.log`.
    - Wider checks: headless packaging **5 pass / 0 fail**. Full packaging + host-surface run **331 pass / 7 fail** outside headless: existing MCP-server import violations, MCP/MCP-server/ACP source-file packaging rows, legacy Neuralwatt/provider-family rows, and workspace dependency-tree cleanliness. No headless host-surface violations or allow-list expansion. Docs **145 pass / 25 fail**, matching Task 4's count and failure subjects. Logs: `/tmp/prism-task5-{packaging-headless,gates,docs}.log`. These are not an all-repository-green or whole-plan completion claim.
    - Release/baseline: `bun scripts/release.mjs gate --update-baseline` remains blocked before gates by missing `PRISM_TEST_POSTGRES_URL` (`/tmp/prism-task5-release.log`). Used the existing offline `runGates({ release: loadRelease(), version: "0.12.1", updateBaseline: true, packageName: "@arnilo/prism-headless" })` to regenerate this package's baseline, then reran without update: **exit 0**, declaration/API compatibility plus range/lock and tarball allow/deny checks (`/tmp/prism-task5-compat.log`). This does not satisfy PostgreSQL release evidence or authorize publication. Nineteen baseline additions, no removals/changed existing entries: `createScheduler`, five named type reexports plus seven root `type` reexports, and six scanner-only module helpers (`isConflict`, `nextCron`, `runFiring`, `scheduleStore`, `systemClock`, `validInput`). Only the intended scheduler/type surface is root exported. The scanner does not encode interface members/error unions. No retirement sweep applies: the old scheduler was already deleted by plan 168. Exact baseline diff:

      ```diff
      --- arnilo__prism-headless.txt (before Task 5)
      +++ arnilo__prism-headless.txt (Task 5)
      @@ -6,16 +6,35 @@
       ResumeWhenAnsweredOptions	export type { ResumeWhenAnsweredOptions, ResumeWhenAnsweredResult } from "./resume.js"
       ResumeWhenAnsweredResult	export type { ResumeWhenAnsweredOptions, ResumeWhenAnsweredResult } from "./resume.js"
       RoutedAnswer	export type { AnswerQuery, RoutedAnswer } from "./answers.js"
      +ScheduleInput	export type { ScheduleInput, SchedulerFiring, SchedulerTarget, ScheduleState } from "./state.js"
      +ScheduleState	export type { ScheduleInput, SchedulerFiring, SchedulerTarget, ScheduleState } from "./state.js"
      +SchedulerClock	export type { SchedulerClock } from "./clock.js"
      +SchedulerFiring	export type { ScheduleInput, SchedulerFiring, SchedulerTarget, ScheduleState } from "./state.js"
      +SchedulerTarget	export type { ScheduleInput, SchedulerFiring, SchedulerTarget, ScheduleState } from "./state.js"
       answerLimit	export declare function answerLimit(value?: number): number
       createAnswerLog	export declare function createAnswerLog(maxAnswers: number, store?: CheckpointStore, ownership?: OwnershipScope):
       createResumeAuthority	export declare function createResumeAuthority(agent: Agent): ResumeAuthority
      +createScheduler	export declare function createScheduler(options: SchedulerOptions): Scheduler
      +isConflict	export declare const isConflict: (error: unknown) => boolean
      +nextCron	export declare function nextCron(expression: string, now: number, tz?: string): string
       pendingDecisionsOf	export declare function pendingDecisionsOf(branch: readonly SessionEntry[]): readonly PendingDecision[]
       policyDefault	export declare function policyDefault(answers?: PolicyAnswers): HostUiRoute
       resumeWhenAnswered	export declare function resumeWhenAnswered(authority: ResumeAuthority, supplied: Pick<Session, "id">, pending: readonly PendingDecision[] | undefined, options: ResumeWhenAnsweredOptions, offer: (request: HostUiRequest, approvalId: string, signal?: AbortSignal, accept?: (answer: HostUiResponse, route: string) => boolean) => Promise<
       routeHostUi	export declare function routeHostUi(routes: readonly HostUiRoute[], options?: RouteHostUiOptions): RoutedHostUi
      +runFiring	export declare function runFiring(target: SchedulerTarget, input: string | JsonObject, parentId: string, firingId: string): Promise<SchedulerFiring>
      +scheduleStore	export declare function scheduleStore(checkpoints: CheckpointStore, ownership: OwnershipScope):
      +systemClock	export declare const systemClock: SchedulerClock
       type HeadlessErrorCode	export { HeadlessError, type HeadlessErrorCode } from "./errors.js"
       type HostUiRoute	export { type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions, routeHostUi } from "./route.js"
       type PolicyAnswers	export { type PolicyAnswers, policyDefault } from "./policy.js"
       type ResumeAuthority	export { createResumeAuthority, type ResumeAuthority } from "./authority.js"
       type RouteHostUiOptions	export { type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions, routeHostUi } from "./route.js"
       type RoutedHostUi	export { type HostUiRoute, type RoutedHostUi, type RouteHostUiOptions, routeHostUi } from "./route.js"
      +type ScheduleInput	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +type ScheduleState	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +type Scheduler	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +type SchedulerClock	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +type SchedulerFiring	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +type SchedulerOptions	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +type SchedulerTarget	export { createScheduler, type ScheduleInput, type Scheduler, type SchedulerClock, type SchedulerFiring, type SchedulerOptions, type SchedulerTarget, type ScheduleState, } from "./scheduler/index.js"
      +validInput	export declare function validInput(target: SchedulerTarget, input: unknown): asserts input is string | JsonObject
      ```

- [x] Task 6: Exactly-once across processes with `leases`, and the missed-firing policy after a restart
  - Entry gate (2026-10-13): **cleared** by the user-authorized plan 170 Task 1 scheduler amendment. Use registered workflow commands and the documented at-most-once crash contract; Tasks 3–4 remain unchanged.
  - Acceptance Criteria:
    - Functional: With `leases`, each due firing first acquires lease `headless.firing:<scheduleId>:<dueAt ISO>` (`tryAcquireLease` with `ownerId`, `ttlMs = limits.firingLeaseMs`, and the scheduler's ownership). Only the holder does the CAS advance and the run, renewing the lease while the run is active and releasing it at the end. Without `leases`, the CAS advance alone prevents a double advance within one store. The README states the live-worker once-only guarantee and the at-most-once crash limitation; leases do not make external effects transactional.
    - Functional: **Crash guarantee.** Kill a process after claim CAS but before target start: the durable `running` attempt is uncertain, the due firing is not replayed, and later cron occurrences still execute. This proves the accepted loss window without claiming transactional exactly-once side effects.
    - Functional: **Done criterion.** Two scheduler processes (two `Bun.spawn`ed workers) sharing one SQLite store (which provides `checkpoints` and `leases`) fire each due firing exactly once over 10 cron ticks on a shared fake clock file.
    - Functional: **Missed policy.** On `start()`, a schedule with `nextRunAt < now` follows `missed`:
      - `"skip"` advances to the first occurrence after `now` without firing, and records `missed: <count>`
      - `"run-once"` fires once for the whole gap, then advances

      Either way, the decision is recorded in `lastFiring`.
    - Functional: Rejections (probe 3):
      - a lease lost during a run (renewal fails) → the run continues to completion, the firing is recorded `lease_lost`, and no second firing starts for the same `dueAt`
      - a `missed` value other than the two → `invalid_missed_policy`
    - Performance: One lease acquire per firing per process. Renewal runs every `firingLeaseMs / 3`. The README states that the lease adds one acquire, `n` renewals, and one release per firing, and that omitting `leases` avoids them on single-process hosts.
    - Code Quality: Uses only the `LeaseStore` contract (`packages/integrations/workflows/src/contracts.ts:107-112`) and its fencing token. No store-specific code.
    - Security: Lease keys carry the scheduler's ownership, so a scheduler in another scope cannot block or claim a firing.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/workflows/src/{contracts.ts:77-112,memory-leases.ts}`; `packages/stores/sqlite` lease implementation; the `leaseConformance` suite (plan 168 Task 3); plan 169 Task 8 (lease-claimed resume)
    - Options Considered:
      - CAS only, no lease. Rejected: the roadmap names `leases` for cross-process once-only, and a lease also fences a long firing against a second process that sees a stale row.
      - One scheduler-wide leader lease. Rejected: a dead leader stalls every schedule until its lease expires, while per-firing leases let any live process take the next firing.
    - Chosen Approach:
      - A per-firing lease, then the CAS advance, then the run, with renewal. The missed policy is evaluated once at `start()`.
    - API Notes and Examples:
      ```ts
      const lease = await leases.tryAcquireLease({ ...ownership, namespace: "headless.firing", key: `${id}:${dueAt}`, ownerId, ttlMs });
      if (!lease) return; // another process owns this firing
      ```
    - Files to Create/Edit:
      - `packages/hosts/headless/src/scheduler/{lease.ts,missed.ts}`: new.
      - `packages/hosts/headless/src/scheduler/{index.ts,state.ts}`, `src/errors.ts`: claim/lease integration, restart policy, firing metadata and validation. Target execution in `firing.ts` stays shared with manual triggers.
      - `packages/hosts/headless/src/__tests__/scheduler-leases.test.ts`, `scheduler-missed.test.ts`: new.
      - `packages/hosts/headless/src/__tests__/fixtures/scheduler-worker.mjs`: the spawned worker (matching the existing SQLite restart fixture; keeps adapter source types out of host compilation).
      - `packages/hosts/headless/package.json`: reuse the SQLite devDependency already added by Task 5.
      - `scripts/compat-baseline/arnilo__prism-headless.txt`: scanner additions for the two internal module helpers.
    - References:
      - plan 168 Tasks 3–4 (lease contract and store implementations)
  - Test Cases to Write:
    - `crash_after_claim_is_not_replayed`: kill a worker at the CAS/start boundary; record an uncertain running attempt, no replay, and progress on the next occurrence.
    - `two_processes_fire_each_tick_once`: two spawned workers over one SQLite file record exactly 10 firings for 10 ticks, each with one owner. Fails if the lease or CAS is skipped.
    - `missed_skip_after_restart`: stop, advance the clock past three occurrences, restart with `skip`. No firing happens, `missed: 3` is recorded, and `nextRunAt` is in the future.
    - `missed_run_once_after_restart`: the same gap with `run-once` gives exactly one firing.
    - `lease_lost_is_recorded_and_not_refired`: forcing renewal failure records `lease_lost` and starts no second firing for that `dueAt`.
    - `lease_keys_are_scoped`: a scheduler in another ownership scope cannot acquire this scope's firing lease.
    - `invalid_missed_policy_rejected`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — scheduler durability semantics.
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`: "Running more than one process" (leases, cost, the missed policy).
      - `CHANGELOG.md`: `## [Unreleased]` → Added line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - Implemented per-firing ownership-scoped leases before the existing CAS advance, with generated per-instance owner ids, token-authenticated renew/release, persisted fencing counters, renewal every TTL/3, and finally cleanup. A failed/null renewal lets the target finish and records `lease_lost`; CAS prevents replay of that occurrence. Leases remain optional. Contended acquisition retries after a bounded delay rather than spinning.
    - Added scheduler-level `missed` (default `skip`, alternative `run-once`) evaluated against the time captured by each `start()`. Strictly overdue active schedules record the gap count, policy, and original due date. Skip advances/completes without a target call; run-once coalesces the gap. A deadline equal to startup time fires normally. Invalid policy rejects with `invalid_missed_policy`. Normal-running delayed firings still coalesce, preserving Task 5 behavior.
    - Proof: two spawned SQLite workers sharing a fake clock file produce exactly ten distinct firings over ten cron ticks; the final persisted firing includes its lease fencing counter. Killing a worker after the committed CAS and before target start leaves an uncertain `running` attempt, does not replay it, and permits the remaining nine occurrences. Separate tests prove both restart policies, renewal loss/no replay, scope mismatch refusal, and invalid policy rejection.
    - Validation: `cd packages/hosts/headless && bun run typecheck && bun run test`: **51 pass / 0 fail**, including seven Task 6 tests; root `bun run typecheck`: **exit 0**. Focused Biome check: **exit 0** (one informational template-literal suggestion in the test worker). Logs: `/tmp/task6-full-final.log`, `/tmp/task6-types-final.log`, `/tmp/task6-biome.log`.
    - Documented the live-worker guarantee, the accepted at-most-once crash loss window, lease operation costs/default TTL, missed defaults, and independent manual triggers in the README; added an Unreleased changelog entry. No new dependency, kernel contract, root export, or retired name. Workflow invocation and parent links remain unchanged. Tasks 7–8 remain pending; whole-plan verification belongs to their completion.
    - Release gate remains blocked before execution by absent `PRISM_TEST_POSTGRES_URL` (`/tmp/task6-release.log`). The existing offline package gate regenerated the headless baseline and passed again without update (**exit 0**, declaration/API compatibility, range/lock and tarball checks; `/tmp/task6-compat-final.log`). Its only additions are scanner-only module helpers, with no removals:
      ```diff
      +holdFiringLease export declare function holdFiringLease(store: LeaseStore, input: LeaseAcquireInput): Promise<
      +missedOccurrences export declare function missedOccurrences(state: ScheduleState, now: number):
      ```
      Neither helper is reexported by the package root. The scanner does not encode interface members/error unions. PostgreSQL release evidence is still required before release.

- [x] Task 7: `examples/headless-host.ts` and the `prism-headless` README
  - Acceptance Criteria:
    - Functional: `examples/headless-host.ts` runs offline:
      1. creates a mock-provider agent with `approval` in `ask` mode, `host: { ui: routeHostUi([client, channel, policyDefault()]) }`, and one SQLite store
      2. the client route is a `remoteHostUi()` with no client attached, so it answers `unavailable`
      3. the channel route is `channelHostUi` over the scripted channel, which does not reply within its timeout
      4. the policy default answers `unavailable`, and the run suspends
      5. the scripted channel replies later, and `resumeWhenAnswered` resumes the run to completion
      6. registers a small workflow with `workflowCommand`, then a `createScheduler` cron target naming that command fires once on a fake clock; use an agent node to prove child sessions are indexed under the schedule session
      7. `router.answers()` is printed, showing the route of each answer
    - Functional: The example is registered under the execution gate (`examples_demos_run_to_completion_and_emit_no_secret`), with an `examples/README.md` line and a `scripts/e2e-coverage.json` row.
    - Functional: `packages/hosts/headless/README.md` is complete in the package page structure:
      - install and host example
      - configuration tables for `routeHostUi`, `HostUiRoute`, `policyDefault`, and `createScheduler`
      - what it changes
      - cost, security, and failure behavior, including the answer-log write, the lease cost, the scope limit that only asks and elicitations suspend, and the duplicate-prompt trade-off from Task 1 (a)
    - Performance: The example finishes in under 5 s on the mock provider.
    - Code Quality: The example imports only `@arnilo/prism`, `@arnilo/prism/testing`, `@arnilo/prism-headless`, `@arnilo/prism-remote`, `@arnilo/prism-channels`, `@arnilo/prism-workflows`, `@arnilo/prism-approval`, and `@arnilo/prism-store-sqlite`.
    - Security: The scripted channel uses an `env:` token ref set by the example to a dummy value. The no-secret scan covers the output.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 17 Examples; `examples/remote-agent.ts` (plan 170 Task 8); `examples/durable-approval.ts`; the channels test transport
    - Options Considered:
      - Two separate examples for routing and scheduling. Rejected: the roadmap names one `examples/headless-host.ts` that shows both.
    - Chosen Approach:
      - One offline example in two clearly labelled halves, on one SQLite file.
    - API Notes and Examples:
      ```ts
      const ui = routeHostUi([{ name: "client", ui: remoteHostUi() }, { name: "channel", ui: channelUi, timeoutMs: 50 }, policyDefault()]);
      ```
    - Files to Create/Edit:
      - `examples/headless-host.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts` (demo list): rows.
      - `packages/hosts/headless/README.md`: complete.
      - `CHANGELOG.md`: `## [Unreleased]` line.
    - References:
      - plan 170 Task 8
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/headless-host.ts` (an added row).
    - `headless_host_example_output`: asserts in the example's run that the output shows `route: channel`, `resumed`, and one scheduled firing. Fails if routing order or scheduling breaks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — completes the package page.
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`, `examples/README.md`, `CHANGELOG.md`: as listed.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - Added one offline example over a temporary SQLite file shared by scoped agents, channel checkpoints, the answer log, and the scheduler. It creates and consumes a scripted Telegram pairing with an explicit authorizer and a dummy `env:HEADLESS_DEMO_TOKEN` credential, uses an unattached `remoteHostUi`, lets channel offers time out, suspends before the tool executes, answers a fresh channel offer, and drains the resumed run to completion. Cleanup closes the connection, scheduler, agents, and store, removes the temporary directory, and restores the environment variable.
    - The second half registers `workflowCommand` with an agent-node workflow, advances one cron tick on a fake clock, and asserts a successful firing, the persisted next deadline, and exactly one indexed child under the schedule session. The example prints `resumed`, `scheduledFirings: 1`, and value-free `router.answers()` metadata including the channel answer's approval id. Only the authorized public packages and Node built-ins are imported; the remote factory uses the same dynamic import pattern as `remote-agent.ts` to keep Bun transport declarations out of the examples compiler.
    - Registered the example in the existing demo execution/no-secret gate, added explicit output assertions and a dummy-token leak assertion, added the headless coverage row and examples README entry, and added an Unreleased changelog entry. Completed the package README's host example, behavior summary, policy and scheduler option tables, costs, security, and failure contracts.
    - Findings: the approval package's unavailable inline confirmation becomes a kernel ask, which offers confirmation again before suspension; the example asserts both route sequences and answers the fresh resume prompt. This duplicate-prompt behavior is documented. Persistent log rows with equal millisecond timestamps can appear in either order; the example verifies route membership and chronological bounds per offer rather than imposing a tie order. No runtime API change was needed.
    - Validation: `bun run build:core` and root `bun run typecheck`: **exit 0**; `bunx tsc -p examples/tsconfig.json --noEmit`: **exit 0**; focused Biome check: **exit 0**. Direct `bun examples/headless-host.ts`: **exit 0**, **0.257 s**, dummy credential absent from stdout/stderr (`/tmp/task7-example-final.log`). `cd packages/hosts/headless && bun run test`: **51 pass / 0 fail** (`/tmp/task7-headless-isolated.log`). Earlier concurrent checks had scheduler worker timeouts; the isolated suite passed without a runtime change.
    - `bun test --timeout=0 src/__tests__/docs.test.ts`: **145 pass / 25 fail**, including a passing `examples_demos_run_to_completion_and_emit_no_secret` with the compiled new example (`/tmp/task7-docs-final.log`). The other failures concern repository-wide documentation/release drift, missing links, and existing example-surface assertions; they are outside Task 7. The initial stale settings export was resolved by rebuilding core. The example's timestamp tie assertion was corrected before the final run.
    - `bun scripts/e2e-coverage-gate.mjs`: **exit 1**, **105/110 surfaces covered, 5 pending**; the new headless row is accepted, but seven existing suite references point to missing files (`/tmp/task7-coverage.log`). No exports moved, compatibility baseline changed, dependency was added, or name was retired. Release/PostgreSQL and whole-phase completion remain for Task 8; this task does not claim a green whole-plan gate.

- [x] Task 8: Phase 17 Done record (both parts)
  - Acceptance Criteria:
    - Functional: The Notes map each roadmap Phase 17 Done criterion to the test or example that proves it, with its last passing command:
      - `remoteConformance` on stdio, WebSocket, and HTTP with SSE → plan 170 Task 6
      - `origin.remote` and `executedBy: "external"`, with no local `tool.call` → plan 170 Task 4 `connected_tool_events_are_external_and_skip_local_gate`
      - disconnect during a pending approval suspends, and a later answer resumes → plan 170 Task 3
      - wrong token, Origin, Host, and oversized body rejected → plan 170 Task 5
      - `routeHostUi` order, kind limits, and suspension → Task 2
      - two scheduler processes fire once, and the missed policy is honored → Task 6
      - `src/rpc.ts` is gone → plan 170 Task 7 sweep
    - Functional: Each Scope bullet is marked shipped (with its file) or moved to Further Actions with a reason. The `/testing` placement conflict from plan 170 Task 1 (a) is recorded with the user's confirmation, or as open.
    - Functional: `plans/README.md` rows for plans 170 and 171 get their final status.
    - Performance: n/a — record only.
    - Code Quality: Every claim cites a test name or command output from this session.
    - Security: The record confirms that the token-hygiene and secret-route tests ran green.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 17 Done; plans 170 and 171 Notes
    - Options Considered:
      - Put the Done record in plan 170. Rejected: Part B's criteria cannot be checked until this plan's tasks land.
    - Chosen Approach:
      - One record at the end of the phase, as plans 164, 167, and 169 did.
    - API Notes and Examples:
      ```bash
      cd packages/hosts/remote && bun run test
      cd packages/hosts/headless && bun run test
      bun examples/remote-agent.ts && bun examples/headless-host.ts
      ```
    - Files to Create/Edit:
      - `plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md`: Notes.
      - `plans/README.md`: status rows for 170 and 171.
    - References:
      - plan 169 Task 10 (Phase 16 Done record)
  - Test Cases to Write:
    - n/a — record only. It cites the tests above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — record only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Verdict:** both parts' implementation and Phase 17 Done evidence are recorded. This completes the record task, not release readiness: whole-plan verification was executed and retains the blockers below. No runtime code, exports, dependencies, or compatibility baselines changed in Task 8. Scope is this plan, the two index statuses, and the backlog handoff.
    - **Done criteria — last passing commands from this session:** `bun run --cwd packages/hosts/remote test` passed **64/64** (`/tmp/task8-remote.log`); `bun run --cwd packages/hosts/headless test` passed **51/51** on the isolated rerun (`/tmp/task8-headless-rerun.log`). The following tests passed in those commands:

      | Roadmap Phase 17 Done criterion | Proof |
      | --- | --- |
      | Remote conformance on stdio, WebSocket, HTTP/SSE | `packages/hosts/remote/src/__tests__/conformance.test.ts`: `remote_conformance_passes_on_stdio`, `remote_conformance_passes_on_websocket`, `remote_conformance_passes_on_http`, and `remote_conformance_defaults_to_every_transport_under_ten_seconds` (24 legs). Plan 170 Task 6. |
      | Remote attribution, external tool execution, no local gate | `connect.test.ts`: `connected_events_keep_catalog_type_and_gain_remote`, `connected_tool_events_are_external_and_skip_local_gate`, `attribution_merge_keeps_nested_origin`. Plan 170 Task 4. |
      | Disconnect suspends approval; later answer resumes | `serve.test.ts`: `disconnect_during_pending_approval_suspends_then_resumes`, `pending_delivered_after_server_restart`. Plan 170 Task 3. |
      | Reject wrong token, Origin, Host, oversized body | `network.test.ts`: `HTTP gates reject before dispatch and never echo credentials`, `WebSocket upgrade rejects token, Host and Origin before creating sessions`; `http-gate.test.ts`: `body reader cancels an oversized streaming body without reading its tail`. Plan 170 Task 5. |
      | Routing order, kind limits, durable suspension | `packages/hosts/headless/src/__tests__/route.test.ts`: `route_order_client_then_channel_then_default`, `route_kind_limits_are_honored`, `no_route_answers_kernel_suspends`; `resume.test.ts`: `later_channel_answer_resumes_run`, `resume_after_restart_reads_entries`. Tasks 2–3. |
      | Two processes fire once; restart missed policy | `scheduler-leases.test.ts`: `two_processes_fire_each_tick_once` (10 ticks, two spawned SQLite workers); `scheduler-missed.test.ts`: `missed_skip_after_restart`, `missed_run_once_after_restart`. Task 6. `crash_after_claim_is_not_replayed` proves the accepted at-most-once crash-loss limit; this is not transactional exactly-once external effects. |
      | Kernel RPC retired | `test ! -e src/rpc.ts`: exit 0. Retirement command below finds only nine released-doc references and one negative export assertion. Plan 170 Task 7. |

    - **Security evidence:** the same green remote run includes `tokens are random 32 bytes, env refs resolve once, literals and missing refs fail closed`, `keyring resolves once before binding and failure leaves no listener`, `literal secrets and unauthenticated public binds fail closed`, `custom authenticate is fail closed and pins the HTTP principal`, and `secret_requires_capability`. The green headless rerun includes `secret_and_terminal_need_explicit_kinds`, `answer_log_has_no_values_and_survives_restart`, `malformed_answers_cannot_approve`, and `foreign_session_not_offered_and_forged_object_not_used`. `bun run --cwd packages/hosts/channels test` passed **119 / 1 skip / 0 fail** (`/tmp/task8-channels.log`), including channel UI authorization, correlation and expiry tests; the skipped test requires live PostgreSQL. The docs demo execution/no-secret test also passed (`/tmp/task8-docs.log`).
    - **Scope disposition — every roadmap Phase 17 Scope bullet:**

      | Scope | Disposition and shipped files / proof |
      | --- | --- |
      | Remote host library derived from RPC | Shipped: `packages/hosts/remote/src/index.ts`; kernel RPC removed as above. |
      | Versioned protocol and negotiation | Shipped: `packages/hosts/remote/src/protocol.ts`, `dispatcher.ts`; remote dispatcher suite passes. |
      | Sessions open/list/resume | Shipped: `serve.ts`, `session-proxy.ts`; `serve_sessions_open_list_resume`. |
      | Run and unchanged catalog notifications | Shipped: `serve.ts`, `session-proxy.ts`; `serve_run_streams_catalog_events_unchanged`, conformance stream legs. |
      | Steer / abort | Shipped: `serve.ts`, `session-proxy.ts`; `steer_with_no_run_returns_kernel_error_and_abort_reaches_session`, conformance steer/abort legs. |
      | Commands list/run | Shipped: `serve.ts`, `connect.ts`; `serve_commands_inspect_and_messages`, conformance commands legs. |
      | Inspect | Shipped: `serve.ts`, `connect.ts`; `agent_events_and_commands_and_inspect`. |
      | Server-to-client hostUi.request | Shipped: `host-ui.ts`, `serve.ts`; `remote_host_ui_reaches_local_ui`. |
      | Stdio, WebSocket, HTTP/SSE | Shipped: `transports/` and `http-gate.ts`; all three conformance tests above. |
      | Bearer defaults, authenticate principal, Host/Origin/body bounds, token hygiene | Shipped: `auth.ts`, `http-gate.ts`, network transports; auth/network/gate suites pass as above. |
      | serveAgent and durable disconnect suspension | Shipped: `serve.ts`, `host-ui.ts`, `pending.ts`; disconnect/restart proofs above. Only kernel asks and elicitations suspend; other UI requests fail closed. |
      | connectAgent proxy, origin.remote, external tool attribution, local UI | Shipped: `connect.ts`, `session-proxy.ts`, `attribution.ts`; connect suite passes. Unsupported Agent members fail closed (`unsupported_members_fail_closed`), as recorded in Part A. |
      | Optional mirror with parent links and session search | Shipped: `mirror.ts`; `mirror_is_found_by_session_index`, `mirror_reopen_does_not_duplicate_links`, and offline remote example pass. Reconnect registration window remains plan 170's recorded compromise. |
      | Headless host library | Shipped: `packages/hosts/headless/src/index.ts`. |
      | Ordered routing and kind limits | Shipped: `route.ts`, `policy.ts`; route proofs above. Channel route shipped in `packages/hosts/channels/src/host-ui.ts`, authorized by the existing runtime admission path. |
      | Durable unanswered suspension and later answers | Shipped: `resume.ts`, `authority.ts`, `pending.ts`; resume suite and headless example pass. Host must provide the scoped resume authority; remote/router answers use that shared authority. |
      | Answer route recording | Shipped: `answers.ts`; `answer_log_has_no_values_and_survives_restart`, `answer_log_is_bounded_and_returns_copies`. |
      | Cron, one-off, manual agent/workflow scheduling | Shipped: `scheduler/index.ts`, `cron.ts`, `firing.ts`; scheduler suite passes. Public options use `checkpoints` (not roadmap shorthand `store`); workflow targets name registered `workflowCommand`s, per the Task 5 amendment. |
      | Firing parent links | Shipped: `scheduler/firing.ts`; `cron_schedule_fires_on_fake_clock_and_agent_firing_has_parent_link`, `workflow_firing_starts_run_under_schedule_session_and_trigger_fires_immediately`. |
      | Persisted schedule state | Shipped: `scheduler/state.ts`; `SQLite_schedule_and_workflow_parent_survive_process_restart`. |
      | Optional leases for cross-process firing | Shipped: `scheduler/lease.ts`; two-worker and crash proofs above. Live-worker once-only, accepted loss after committed claim, no automatic replay of uncertain attempts. |
      | Missed skip/run-once policy | Shipped: `scheduler/missed.ts`; both restart tests above. |
      | K3 EventOrigin.remote | Shipped by Phase 13: `src/contracts-protocol.ts:199`; connected attribution tests pass. |
      | /testing remoteConformance | Shipped at `packages/hosts/remote/src/testing.ts`, exported as `@arnilo/prism-remote/testing`; all transport conformance passes. **Placement conflict remains open:** plan 170 Task 1 (a) requires user confirmation of the package subpath instead of kernel `/testing`; no confirmation is recorded in this session. Further Actions carries that decision, without importing a package into the kernel. |
      | Package READMEs and staged origin docs | Shipped: `packages/hosts/{remote,headless}/README.md`, `docs/next/events.md` (also `docs/next/host.md`). Broader released-document drift is a verification blocker below. |
      | Offline remote example | Shipped: `examples/remote-agent.ts`, `remote-agent-server.ts`; `bun examples/remote-agent.ts`: exit 0, merged local/remote workflow, approval, two search hits (`/tmp/task8-remote-example.log`). |
      | Offline headless example | Shipped: `examples/headless-host.ts`; `bun examples/headless-host.ts`: exit 0, suspension, channel resume, one scheduled workflow firing (`/tmp/task8-headless-example.log`). |

    - **Whole-plan verification executed:** logs are `/tmp/task8-<name>.log`.
      - `bun run build:core`, root `bun run typecheck`, headless and channels package typechecks: **exit 0** (`build`, `typecheck`, `headless-types`, `channels-types`). `bun run --cwd packages/integrations/workflows test`: **183 pass / 0 fail** (`workflows`). Remote **64/0**, channels **119/1 skip/0**, both offline examples **exit 0**, as above.
      - Initial package-script headless run: **49 pass / 2 fail**, timeouts in `bounded_concurrency_stop_drains_and_completion_preserves_pause_delete` and `crash_after_claim_is_not_replayed` (`headless`). Isolated identical-command rerun: **51 pass / 0 fail** (`headless-rerun`). No source/test change was made; preserve this evidence of timing flakiness rather than claiming every invocation passed.
      - `bun test --timeout=0 src/__tests__/host-surface-gate.test.ts src/__tests__/packaging.test.ts`: **334 pass / 4 fail** (`gates`): inherited MCP host imports, legacy Neuralwatt/provider-family assertions, and `npm ls` workspace cleanliness. Headless and remote packaging checks pass; no headless/remote import violation reported.
      - `bun test --timeout=0 src/__tests__/docs.test.ts`: **145 pass / 25 fail** (`docs`), matching Task 7's recorded count and failure subjects. `examples_demos_run_to_completion_and_emit_no_secret` passes, including both Phase 17 examples.
      - `bun scripts/e2e-coverage-gate.mjs`: **exit 1**, **105/110 surfaces covered, 5 pending**, seven stale missing-suite annotations outside the Phase 17 rows (`coverage`).
      - `bun scripts/release.mjs gate`: **exit 1 before gates**, missing `PRISM_TEST_POSTGRES_URL` (`release`). No release-readiness or publication claim.
      - `rg -n 'runRpcServer|parseRpcRequest|RpcSessionFactory|--mode rpc' src packages scripts examples docs README.md -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**'`: only released docs and the negative root-export test (`retirement`). `apps/` is absent. No active implementation/example hit; released docs remain untouched until Phase 11.
    - **Handoff:** plans 170 and 171 are indexed complete with recorded whole-plan blockers; `/testing` confirmation remains explicitly open. Compromises and Further Actions below are copied to `plans/backlog.md`. Existing plan 170 backlog items remain authoritative for its reconnect-window and malformed-answer-notice limitations.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `cd packages/hosts/headless && bun run typecheck && bun run test`
- `cd packages/hosts/channels && bun run typecheck && bun run test`
- `cd packages/hosts/remote && bun run test`
- `cd packages/integrations/workflows && bun run test`
- `bun test --timeout=0 src/__tests__/host-surface-gate.test.ts src/__tests__/packaging.test.ts`
- `bun examples/headless-host.ts`
- `bun examples/remote-agent.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/e2e-coverage-gate.mjs`
- `bun scripts/release.mjs gate`

## Compromises Made

- P2: Whole-plan checks retain inherited docs, packaging, host-surface, coverage and PostgreSQL-evidence blockers; implementation completion does not establish release readiness. Recorded in plans/backlog.md.
- P2: Headless scheduler tests timed out in the first run and passed the identical isolated rerun; timing reliability is not established. Recorded in plans/backlog.md.
- P3: Scheduler claim CAS precedes target start; a crash can lose a firing, and uncertain claims are not replayed. The accepted live-worker once-only guarantee is tested; external effects are not transactional. Recorded in plans/backlog.md.

## Further Actions

- P2: Restore the recorded repository gates, supply `PRISM_TEST_POSTGRES_URL`, and repeat whole-plan/release verification before publishing; coordinate with plan 170's existing gate-repair handoff. Recorded in plans/backlog.md.
- P2: Diagnose the scheduler test timing failures under package-script parallel execution; retain the two-process and crash-window assertions. Recorded in plans/backlog.md.
- P3: Resolve the roadmap `/testing` placement conflict with the user: conformance currently ships as `@arnilo/prism-remote/testing` to preserve the kernel/package boundary; confirmation remains open. Recorded in plans/backlog.md.
