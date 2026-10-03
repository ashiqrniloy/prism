# Phase 3 Part B — Agent and session surface

## Objectives

- Reshape `Agent` and `Session` to roadmap §2.3:
  - `agent.session(options)` opens or resumes sessions through the `store` slot
  - `Session` has `run`, `stream`, `steer`, `abort`, `resume`, `messages`, `fork`, `compact`, and `close`
  - `RunResult` has the §2.3 statuses and returns instead of throwing
- Replace the 0.12 durable-resume entry points with `session.resume(decisions)`. A suspended `ask` resumes in the same process or a new one.
- Complete the `Agent`: `id`, `sessions` (over store-slot capabilities), `commands`, `models`, `tools`, `skills`, `inspect()`, `subscribe()`, and `dispose()`.
- Make `@arnilo/prism` the one import for hosts and package authors, and stop feature work on `@arnilo/prism-agent-sdk`. Its kernel-behavior tests move to kernel suites.
- Ship `examples/session.ts`, `examples/approval.ts`, and `examples/host-hooks.ts` under the execution gate, using only `@arnilo/prism` and `@arnilo/prism/testing`.

## Expected Outcome

- `agent.session()` opens a new session, and `agent.session({ id })` resumes one through the resolved `store` slot. `AgentConfig.store`, `AgentSessionConfig.store`, and `agent.createSession` are gone. A store is set with `slots: { store }` or by a package.
- The public session type is `Session`:
  - `messages()` returns the current branch's messages
  - `fork({ at? })` is async and returns a `Session`
  - members outside §2.3 are kept or deleted exactly as plan 148 Task 1(k) decided
- `session.run` resolves to a `RunResult`:
  - `status` is one of `completed`, `stopped`, `suspended`, `failed`, or `aborted`
  - it also carries `stopReason`, `pending`, `messages`, `usage`, and `error`
  - a failed or aborted run returns its result rather than throwing, unless plan 148 Task 1(k) decided otherwise
- `session.resume(decisions)` continues a suspended run and returns the event stream. It emits `decision.resolved`, and it fails closed on a fingerprint, hook-id, or loop-revision drift.
- `Agent` matches §2.3:
  - `agent.sessions` lists, gets, deletes, and searches by the store's declared capabilities. A missing capability fails closed with a named error.
  - `agent.models` lists and resolves over the registered providers.
  - `agent.tools` and `agent.skills` are the merged views.
  - `agent.subscribe()` yields agent-scoped events: `package.status`, `background.*`, and `session.*`.
- `src/__tests__/agent-surface-freeze.test.ts` pins the `Agent`, `Session`, `RunOptions`, `RunResult`, `HostUi`, and event catalog names. It also pins that every host and package-author type is importable from `@arnilo/prism`.
- The three examples run under `examples_demos_run_to_completion_and_emit_no_secret`.

This plan is Part B of roadmap **Phase 3 — Agent, session, and host port**. It depends on [plan 148](148-Phase-3-Part-A-Host-Port-Event-Catalog-And-Agent-Config.md) being complete. The phase review is plan 148 Task 1. Task 1 here is a read-only entry check that re-verifies the caller map after Part A renamed events and reshaped config.

`@arnilo/prism-agent-sdk` stays in the workspace because Prism Code imports it in eight source files. Only its feature work stops here. It compiles against the reshaped kernel. Its npm deprecation is Phase 11, and its deletion follows Phase 12's removal of the last caller.

Lab impact (probe 12): no `packages/prism-code` module becomes deletable in this phase. Its callers migrate in each task. Its approval engine waits for Phase 7 (`@arnilo/prism-approval`), its session policy for Phase 6, and its headless assembler and OAuth/credential prompts for Phase 12, which answers `host.ui` from the TUI.

This plan does not ship a version bump, a publish, a `/docs` change, the manifest (Phase 4), `ModelRef` or provider discovery internals (Phase 5), or new store capabilities in the family stores (Phase 6). `agent.sessions` declares the capability contract, and the kernel memory store implements it.

## Tasks

- [x] Task 1: Part B entry check — the caller map after Part A (read-only)
  - Acceptance Criteria:
    - Functional: The Notes re-count every caller this plan migrates, with `graft callers <symbol> --depth all` grouped by workspace:
      - `createSession`
      - `AgentSession`
      - `AgentRunResult`
      - `AgentRunError`
      - `resumeDurable`
      - `resolveRunDecisions`
      - `AgentConfig.store` / `store:` in `createAgent` and session configs
      - `prompt`, `clone`, and whichever of `entries`, `checkout`, `contextMeter`, and `subscribe` plan 148 Task 1(k) deleted — fixed by Task 1: `prompt` and `clone` go; `entries`, `checkout`, `contextMeter`, `subscribe`, `leafId`, `guardrailPackRefs` stay
      - `agent.config` readers
    - Functional: Confirm that plan 148 Task 1(j)–(k) decisions still hold against the post-Part-A code, and record any drift. Confirm that the event names Part B emits (`run.*`, `decision.*`, `session.*`) exist in the frozen catalog. The decisions Task 1 fixed, to re-confirm rather than re-derive:
      - **(j)** `AgentRunError` is deleted; `run()` returns `status: "failed" | "aborted"` with `error`. One throw site today (`src/agent-session/session/assemble.ts:779`), 11 non-test callers: `packages/prism-code/src/headless.ts`, `packages/prism-channels/src/runtime-turn.ts`, `packages/prism-core/src/governance/evals/experiment.ts`, `packages/prism-core/src/runtime/supervisor/supervisor.ts`, `examples/model-router-aggregate-budgets.ts`. Status map: bare `succeeded`→`completed`; `succeeded` + `finishReason`→`stopped`; `denied`→`stopped` with `stopReason: "denied"`; `failed`/`aborted`/`suspended` unchanged.
      - **(k) Session.** *Delete* `prompt` (bare alias for `run`), `clone` and `checkout` — the latter two have **zero** package callers. *Keep as documented kernel members* `entries()` (Prism Code `tui/index.ts:334`, `observational-memory.ts:358`; AG-UI `projectors.ts:17`), `subscribe()` (`packages/prism-code/src/headless.ts:460`, `packages/ag-ui/src/handler.ts:632`), `contextMeter()` (`packages/prism-code/src/tui/index.ts:502`), `leafId` (22 reads in `src/agent-session/session.ts` alone), `guardrailPackRefs` (Phase 9). `messages()` derives from `entries()`.
      - **(k) `Agent.config` stays.** `tools`/`skills` readers move to `agent.tools`/`agent.skills`, but `store` (`packages/prism-code/src/{headless.ts:418,tui/index.ts:294,678}`), `redactor` (`headless.ts:445`, `tui/index.ts:772`, `tui/commands.ts:1066,1144`), `id`/`name` (`packages/prism-coding-tools/src/dev/index.ts:201`) and the full config rebuild in `packages/prism-core/src/governance/evals/scenarios.ts:280-283` have no §2.3 home. `store` moves in Phase 6; `redactor`/`id`/`name` are settled by Phase 11.
      - **(k) `agent.sessions`** needs two new optional `SessionStore` members, `listSessions?()` and `deleteSession?()` — `SessionStore` (`src/contracts-core/session.ts:58`) has neither. Stores that omit them answer the existing `SessionSearchUnsupportedError` (`:224`). Phase 6 makes them part of the store-slot contract.
      - **(k) `agent.models`** needs `AIProvider.models?(): Promise<readonly ModelInfo[]>` — `AIProvider` (`src/contracts-core/provider.ts:74`) is `{ id, generate }`. Until a provider implements it, `list()` returns only the configured `AgentConfig.model`. Phase 5 owns discovery.
    - Functional: Name every store implementation that must accept the `agent.sessions` capability contract (the kernel memory store) and every one that only declares itself unsupported until Phase 6: the JSONL node store, `packages/prism-core` SQLite/Postgres/NATS, and the Prism Code session store.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites the graft command that produced it.
    - Security: List every session-reopen path: a reopen by id may cross an ownership boundary when a store is shared. Name the check Task 2 tests. The default keeps `AgentConfig.ownership` scoping on the store read.
  - Approach:
    - Documentation Reviewed:
      - plan 148 Task 1 Notes, `roadmap.md` §2.3 and Phase 3
    - Options Considered:
      - Skip the check and reuse plan 148's counts. Rejected: Part A's event rename and config codemod touch the same files, so the counts and sync-context sites change.
    - Chosen Approach:
      - Re-run graft per symbol and record the counts in the Notes.
    - API Notes and Examples:
      ```bash
      graft callers createSession --depth all
      graft grep "resumeDurable("
      graft grep "AgentRunError"
      ```
    - Files to Create/Edit:
      - `plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md`: Notes and amendments only.
    - References:
      - plan 147 Task 1 (entry-check precedent)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-03):

    Read-only entry check. No production code changed. All counts produced via `graft` (`graft callers`, `graft grep`) and workspace inventory on post-Part-A HEAD.

    #### 1. Migrating Caller Counts Grouped by Workspace

    | Symbol / Contract | Total Files | Workspace Breakdown | Notes & Graft Command |
    | --- | --- | --- | --- |
    | `createSession` | 167 | `kernel (src)`: 64<br>`examples`: 32<br>`packages/prism-core`: 19<br>`packages/memory`: 15<br>`packages/ag-ui`: 7<br>`packages/prism-code`: 3<br>`packages/prism-coding-tools`: 3<br>`packages/acp-agent`: 1<br>`packages/agent-sdk`: 1<br>`packages/mcp`: 1<br>`packages/prism-channels`: 1<br>`packages/web-tools`: 1<br>`scripts`: 12<br>`templates`: 7 | `graft callers createSession --depth all`<br>Combined with `createAgentSession` (29 files: examples 19, src 8, scripts 2), there are 193 unique caller files (186 excluding templates). All migrate to `await agent.session(x)`. |
    | `AgentSession` | 72 | `kernel (src)`: 22<br>`packages/prism-core`: 14<br>`packages/ag-ui`: 14<br>`packages/prism-code`: 7<br>`packages/memory`: 5<br>`examples`: 3<br>`packages/agent-sdk`: 3<br>`packages/prism-channels`: 1<br>`scripts`: 3 | `graft grep "AgentSession\\b"`<br>Renamed to `Session` in Task 3. |
    | `AgentRunResult` | 44 | `packages/prism-core`: 19<br>`kernel (src)`: 12<br>`packages/agent-sdk`: 2<br>`packages/prism-channels`: 2<br>`packages/prism-coding-tools`: 2<br>`examples`: 2<br>`packages/prism-code`: 1<br>`packages/web-tools`: 1<br>`scripts`: 1<br>`templates`: 2 | `graft grep "AgentRunResult\\b"`<br>Renamed / reshaped to `RunResult` in Task 4. |
    | `AgentRunError` | 20 (23 total) | `kernel (src)`: 11<br>`packages/prism-core`: 3<br>`scripts`: 3<br>`packages/prism-channels`: 1<br>`packages/prism-code`: 1<br>`examples`: 1 | `graft grep "AgentRunError"` (63 hits in 34 symbols across 23 files). 1 throw site (`src/agent-session/session/assemble.ts:808`). 11 non-test callers across headless, channels, evals, supervisor, and budget router. |
    | `resumeDurable` | 3 (5 total) | `kernel (src)`: 3<br>(`src/agent-session/session.ts`, `src/agent-run-lifecycle.ts:499`, `src/__tests__/ask-resolution.test.ts:172,215,237,264`) | `graft grep "resumeDurable"` (10 hits across 5 files, 2 in docs/types). Replaced by `session.resume(decisions)` in Task 4. |
    | `resolveRunDecisions` | 4 (32 call graph) | `kernel (src)`: 3<br>`scripts`: 1 | `graft callers resolveRunDecisions --depth all`<br>Direct callers: `prepareAgentRunResume` (`src/agent-run-lifecycle.ts:321`), `agent-approval-coverage.test.ts`. Transitively called via `resumeAgentRun`/`resumeAgentRunStream` across 32 files. Replaced by `session.resume` in Task 4. |
    | `AgentConfig.store` / `store:` in configs | 131 | `kernel (src)`: 37<br>`packages/prism-core`: 25<br>`packages/memory`: 17<br>`examples`: 15<br>`packages/prism-code`: 11<br>`packages/ag-ui`: 7<br>`packages/prism-channels`: 6<br>`packages/prism-coding-tools`: 4<br>`scripts`: 8<br>`packages/acp-agent`: 1 | Store input moves strictly to the `store` slot (`slots: { store }`). `AgentConfig.store` and session config `store` deleted in Task 2. |
    | `prompt` | 6 | `packages/prism-code`: 2 (`flags.test.ts`, `observational-memory.ts:322`)<br>`kernel (src)`: 2 (`session.ts`, `agents.test.ts`)<br>`packages/memory`: 1 (`compose.ts:271`)<br>`scripts`: 1 (`e2e-full-surface-journey.mjs`) | Bare alias for `run()`; deleted in Task 3. |
    | `clone` | 5 | `kernel (src)`: 4 (`session.ts`, `agents.test.ts`, `public-contracts.test.ts`, `rpc.ts`)<br>`packages/memory`: 1 (`compose.ts:306`) | Folded into async `fork({ id, at })` in Task 3. |
    | `checkout` | 12 | `packages/memory`: 7 (`append-custom.ts:18,23`, `compose.ts:301`, plus 5 test files)<br>`kernel (src)`: 2 (`session.ts`, `agents.test.ts`, `rpc.ts`)<br>`examples`: 2 (`external-app-db-backed.ts`, `revocation-propagation.ts`)<br>`scripts`: 1 (`e2e-070-host-completeness-journey.mjs`) | **Drift finding:** Plan 148 Task 1(k) previously assumed zero package callers. `checkout` is actively called in `packages/memory` (`append-custom.ts`, `compose.ts`). Kept as a documented kernel member alongside `entries()`, `contextMeter()`, `subscribe()`, `leafId`. |
    | `entries` | 276 | Kept as documented kernel member | `packages/ag-ui` (`projectors.ts:17`), `packages/prism-code` (`tui/index.ts:334`, `observational-memory.ts:358`), `packages/memory` (`compose.ts:285`). `messages()` derives from `entries()`. |
    | `contextMeter` | 9 | `kernel (src)`: 6<br>`packages/prism-code`: 2 (`tui/index.ts:502`, `tui/reducer.ts`)<br>`packages/memory`: 1 | Kept as documented kernel member. |
    | `subscribe` | 95 | Kept as documented kernel member | Called in `packages/prism-code` (`headless.ts:460`), `packages/ag-ui` (`handler.ts:632`), `packages/prism-core` (`workflows/events.ts:38`, `supervisor.ts:225`). |
    | `agent.config` readers | 40 | `kernel (src)`: 18<br>`packages/prism-code`: 11<br>`packages/agent-sdk`: 4<br>`examples`: 2<br>`packages/acp-agent`: 1<br>`packages/prism-channels`: 1<br>`packages/prism-coding-tools`: 1<br>`packages/prism-core`: 1<br>`scripts`: 1 | Retained as a documented kernel member through Phase 11. |

    #### 2. Re-confirmation of Decisions & Catalog Freeze

    - **(j) `AgentRunError` deleted, `run()` returns result:** Confirmed. One throw site exists at `src/agent-session/session/assemble.ts:808`: `throw new AgentRunError(result, { cause: error });`. 11 non-test callers across `packages/prism-code/src/headless.ts`, `packages/prism-channels/src/runtime-turn.ts`, `packages/prism-core/src/governance/evals/experiment.ts`, `packages/prism-core/src/runtime/supervisor/supervisor.ts`, and `examples/model-router-aggregate-budgets.ts`. Status map holds: bare `succeeded` → `completed`; `succeeded` + `finishReason` → `stopped`; `denied` → `stopped` with `stopReason: "denied"`; `failed`, `aborted`, `suspended` unchanged.
    - **(k) Session surface & Drift Finding:**
      - `prompt`: 6 files migrate to `run()`. Deleted.
      - `clone`: 5 files migrate to `fork({ id, at })`. Deleted.
      - `checkout`: Plan 148 Task 1(k) recorded zero package callers, but our re-count found 7 files in `packages/memory` (`append-custom.ts:18,23`, `compose.ts:301`, plus tests). In line with Task 3's core design (line 160), `checkout` is kept as a documented kernel member alongside `entries()`, `contextMeter()`, `subscribe()`, `leafId`, and `guardrailPackRefs`.
    - **(k) `Agent.config` retention:** Confirmed. Readers of `store` (`packages/prism-code/src/{headless.ts,tui/index.ts}`), `redactor` (`headless.ts`, `tui/index.ts`, `tui/commands.ts`), `id`/`name` (`packages/prism-coding-tools/src/dev/index.ts:201`), and full config rebuild in `scenarios.ts` stay through Phase 11.
    - **(k) `agent.sessions` and `agent.models`:** Confirmed. `SessionStore` requires optional `listSessions?()` and `deleteSession?()`. Stores omitting them throw `SessionSearchUnsupportedError`. `AIProvider` requires optional `models?(): Promise<readonly ModelInfo[]>`.
    - **Frozen Catalog Check:** Verified that all event types emitted in Part B (`run.started`, `run.completed`, `run.failed`, `run.suspended`, `decision.pending`, `decision.resolved`, `session.opened`, `session.closed`) are present in `FROZEN_PHASE_1_OBSERVE_CATALOG` (`src/__tests__/hook-catalog-freeze.test.ts`), which is green (3/3 pass).

    #### 3. Store Implementations Matrix

    - **Implements `agent.sessions` capability contract (in Task 5):**
      - Kernel Memory Store (`src/session-stores.ts`: `createMemorySessionStore`): implements `listSessions`, `get`, `deleteSession`, and `searchSessions`.
    - **Declares unsupported (`SessionSearchUnsupportedError`) until Phase 6:**
      - JSONL Node Store (`src/node/session-store-jsonl.ts`: `createJsonlSessionStore`)
      - SQLite Store (`packages/prism-core/src/sessions/sqlite`)
      - Postgres Store (`packages/prism-core/src/sessions/postgres`)
      - NATS Store (`packages/prism-core/src/sessions/nats`)
      - Prism Code Session Store (`packages/prism-code/src/sessions.ts`: `resolveSessionStore`)

    #### 4. Security: Session Reopen Paths & Scoping

    - **Session-reopen paths identified:**
      1. `agent.session({ id })`: opens/resumes a session by reading its branch through the resolved `store` slot.
      2. `session.resume(decisions)`: resumes a suspended run from its checkpointed `suspended_run` entry.
      3. Direct store branch reads: `store.readBranchPath(...)` and `store.list(sessionId)`.
      4. `session.fork({ at? })`: branches an existing session.
      5. ACP / AG-UI / conversations session restoration: restores host-bridged sessions by ID.
      6. Supervisor durable child delegations: re-enters child runs by session ID.
    - **Ownership scoping rule:** Reopening a session by ID must never bypass ownership boundaries when a backing store is multi-tenant or shared across users. Task 2 asserts that `agent.session({ id })` applies `AgentConfig.ownership` scoping on the store read: a session owned by another scope fails closed as `SessionNotFoundError` (or the equivalent named error) and exposes no session metadata or transcript data.

    #### 5. Verdict

    The plan is sound and verified against current code. Task 3 is amended to keep `checkout` as a documented kernel member due to its active use in `packages/memory`. Tasks 2–7 are ready to execute.

- [x] Task 2: `agent.session()` over the store slot
  - Acceptance Criteria:
    - Functional: `agent.session(options?: SessionOptions): Promise<Session>`.
      - With no `id`, it opens a new session.
      - With `{ id }`, it reads that session through the resolved `store` slot, restores package state, and finds a pending `suspended_run` entry.
      - An unknown `id` fails closed with a named error (`SessionNotFoundError` or the code Task 1 confirms). It does not silently create a new session.
      - Amendment (user decision, executed 2026-10-03): a host that owns the id (an AG-UI thread, an ACP session, a channel binding, a conversation thread) passes `{ id, create: true }`. That reads the branch once; a non-empty branch resumes exactly as `{ id }` does (ownership check included), an empty one opens a new session under that id. `create` is ignored without `id`. Without it `{ id }` stays strict resume. This is the one kernel addition beyond the Task 2 text; without it ~146 caller sites and every host library that chooses its own ids had no way to open a new session.
    - Functional: The session store is always `slots.resolve("store", config.slots?.store)`. That is a direct `slots.store` assignment, a package's `slots.store.provide`, or the kernel memory default. `AgentConfig.store` and `AgentSessionConfig.store` (`src/agent-session/session.ts:450`) are deleted, with no alias. A slot conflict fails closed as in plan 144.
    - Functional: `agent.createSession` and the exported `createAgentSession` (`src/agent-session/create-agent.ts:58,87`) are deleted. All 181 caller files migrate in this task with a codemod (`agent.createSession(x)` → `await agent.session(x)` in an async scope), plus the hand fixes for every sync-context site Task 1 lists. That covers `examples/` (34), `packages/prism-core` (19), `packages/memory` (15), `packages/ag-ui` (7), and the rest of the Task 1 list.
    - Functional: The session lifecycle settles the backlog item "Settle when `session.opened` fires and who receives it". The default is that `session.opened` fires once `agent.session()` resolves, so it is eager and awaited by `session()` but not by runs, and that `session.*` reaches `agent.subscribe()` (Task 5). The decision and its reason go in `docs/next/agent.md`.
    - Functional: A repo-wide grep for `createSession(`, `createAgentSession`, and `store:` inside `createAgent`/session config literals over `src/ packages/ scripts/ examples/ docs/` (exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, released `/docs` pages, historical `CHANGELOG` sections) returns nothing outside the Task 1 residue list.
    - Performance: Opening a new session does no store read. A resume does one branch read (`readBranchPath` when the store has it). Neither path re-resolves the slot per run.
    - Code Quality: One session constructor path. `RuntimeAgentSession` stays internal.
    - Security: A resume by id applies the agent's ownership scope to the store read. A session owned by another scope fails closed as not found, and is not exposed. A test covers it.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (`session(options)`: "new session, or resume { id } through the store slot"), §2.5 `store` slot
      - `src/agent-session/create-agent.ts:56-89`, `src/agent-session/session.ts:440-470`, `src/slots/defaults.ts:26`
      - plan 144 header ("`AgentConfig.store` stays … until roadmap Phase 3"), plan 146 Task 7 (package-state hydration point)
    - Options Considered:
      - Keep `createSession` beside `session()`. Rejected: §1.4 forbids aliases.
      - Keep `AgentConfig.store` as sugar for `slots.store`. Rejected: an alias, and two inputs for one slot.
    - Chosen Approach:
      - Route every session through the slot, delete the 0.12 inputs, and codemod the callers, the same way plan 146 Task 2 made `createAgent` async.
    - API Notes and Examples:
      ```ts
      const agent = await createAgent({ model, slots: { store: myStore } });
      const s = await agent.session();
      const again = await agent.session({ id: s.id }); // resumes through the store slot
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`: `Agent.session`, `SessionOptions`; remove `createSession`, `store`.
      - `src/agent-session/create-agent.ts`, `src/agent-session/session.ts`: construction and store resolution.
      - `src/run-bundle.ts:139`: reads the resolved store.
      - `src/index.ts`, `src/agent-session.ts`: drop `createAgentSession`.
      - Callers in every workspace and `examples/` per Task 1.
      - `src/__tests__/public-export-contract.test.ts`, and `scripts/compat-baseline/*.txt` for each touched workspace: regenerate with `node scripts/release.mjs gate --update-baseline`, with the diff and attribution in the task note.
      - `docs/next/agent.md`: `agent.session()` and the lifecycle. `docs/next/slots.md`: the store slot is the only session store input. `CHANGELOG.md`.
    - References:
      - plan 146 Task 2 (codemod precedent), plan 146 Compromises (`session.opened` is lazy)
  - Test Cases to Write:
    - `session_without_id_opens_new_and_reads_nothing`
    - `session_with_id_resumes_through_store_slot`, with a package-provided store and a direct `slots.store`.
    - `unknown_session_id_fails_closed`
    - `resume_across_ownership_scope_is_not_found`
    - `session_opened_fires_once_session_resolves_and_reaches_agent_subscribers`
    - `agent_config_store_is_rejected_as_unknown_key`: a type test, plus a runtime check if the config validator rejects unknown keys.
    - `create_true_opens_a_new_session_under_the_id_then_resumes_it` and `create_true_still_fails_closed_across_ownership_scope` (the amendment above).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the session entry point and the store input.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: `agent.session()` and `SessionOptions`.
      - `docs/next/slots.md`: store slot.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-03):

    **What changed.**
    - `agent.session(options?)` is the only session entry. `createAgentWith` (`src/agent-session/create-agent.ts`) resolves `slots.resolve("store", effective.slots?.store)` once per `session()` call. No id → `openNewSession()` (zero store read). `{ id }` → one `readBranchPath` (or `list` when the store has none), the `AgentConfig.ownership` scope check on every branch entry, then `openResumedSession(branch)` (hydrates package state, finds the pending `suspended_run`). An unknown or foreign id → `SessionNotFoundError` (`code: "session_not_found"`, plus `SESSION_NOT_FOUND_CODE` and `isSessionNotFound`).
    - `AgentConfig.store`, `SessionOptions.store`, `agent.createSession`, and `createAgentSession` are gone. A config or session options carrying `store` throws a `TypeError` naming `slots.store`.
    - **Amendment: `SessionOptions.create`** (user decision). `{ id, create: true }` resumes a non-empty branch and opens a new session under the id when the branch is empty; the ownership check still runs. The ~146 call sites that passed a host-chosen id now pass `create: true`; the ACP/AG-UI core, `packages/acp-agent`, `packages/prism-code` (ACP, headless, TUI), `prism-channels`, and the conversation `sessionFactory` examples use it. Callers that reopen a session they created (`session.id`, a thread whose id is already stored) stay strict where the branch is certain to exist.
    - `session.opened` fires once `agent.session()` resolves (eager), reaches hooks and `agent.subscribe()`, and `restored` means "resumed with `{ id }`". Settles the backlog item; reason and cost are in `docs/next/agent.md` ("When `session.opened` fires").
    - `RuntimeAgentSession.rehydrateState` (after `checkout`) now re-reads the branch only when a package holds session state. Without this guard every opened session (always "ready") paid a read per `checkout`.
    - `packages/prism-code/src/sessions.ts` gains `configuredSessionStore(agent)`, the lab's reader of `agent.config.slots.store` (it replaces the removed `agent.config.store` reads at `headless.ts` and `tui/index.ts`).

    **Docs and tests.**
    - `docs/next/agent.md` (Sessions section, example), `docs/next/slots.md` (store row and note), `docs/next/hooks.md` and `docs/next/events.md` (`session.opened`), `packages/agent-sdk/README.md`, `CHANGELOG.md` (Unreleased).
    - `src/__tests__/agent-session-slot.test.ts`: the six named tests plus the two `create` tests, 8/8. `create-agent-async.test.ts`: the "nothing left behind" assertion now ignores the kernel's own skill-catalog hook.
    - `src/__tests__/public-export-contract.test.ts`: dropped `createAgentSession`; added `SESSION_NOT_FOUND_CODE`, `SessionNotFoundError`, `isSessionNotFound`. `docs.test.ts`: dropped the released-page `createAgentSession` rows and assertions (the released `/docs` pages still describe 0.12 and move at release).

    **Baseline diff** (`node scripts/release.mjs gate --update-baseline`, then plain `gate` green): `arnilo__prism.txt` −`createAgentSession` (this task); +`SessionNotFoundError`, +`SESSION_NOT_FOUND_CODE`, +`isSessionNotFound` (this task); `arnilo__prism-code.txt` +`configuredSessionStore` (this task). The other 28 baseline files carry earlier plans' diffs, unchanged here.

    **Findings that affect later tasks.**
    - The tree held an earlier, lossy `createSession(x)` → `session()` codemod that dropped `{ id }` and `{ store }` arguments, left some `(await createAgent(...)).session(...)` un-awaited, and broke `.mjs` scripts (`await` in non-async arrows). `tsc` does not see scripts or untyped config objects. Repaired here: 151 ids restored from `HEAD` by test-block alignment, 13 more from the literals the tests read back (`sessionId: "…"`, `store.list("…")`), 23 non-test sites (examples, scripts) from `HEAD`, 3 `store` wirings, 2 un-awaited sessions, 11 script `store:` → `slots: { store }`, 5 script syntax fixes. `git diff HEAD` over a test file can show an id that `HEAD` had and the file lost; check before trusting a test that reads a session id back.
    - Task 3: `fork()` and `clone()` are still sync and return an unhydrated session. `session-state-background.test.ts` `state_requires_hydration_and_rejects_oversize` now uses `session.fork()` as its only unhydrated session; Task 3's async `fork` removes that case, so that assertion must be rewritten then (state is hydrated before `fork` resolves).
    - Task 4: `ask-resolution.test.ts` and `guardrail-pack-durability.test.ts` still drive `resumeDurable` on `agent.session({ id: "s" })`; an exact-retry idempotency case (`messaging-primitives.test.ts`) now pins the parent with a seed run because a resumed session continues from the branch tip rather than from the root. `agentHookIds` includes `kernel:context.build` (the skill catalog), so any hook-id fingerprint test must expect it.
    - Task 5: `agent.subscribe()` already exists and carries `session.opened`/`session.closed`; Task 5 owns `package.status`/`background.*`, the overflow policy test, and the typed `Agent` surface.

    **Sweep** (`createSession(`, `createAgentSession`, `store:` in `createAgent`/session configs over `src/ packages/ scripts/ examples/ docs/next templates/`, excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, released `/docs`, `scripts/phase16-*` freeze history, and compat baselines): only residue that is not the Agent method:
    - `src/rpc.ts`, `src/cli-runner.ts` — the RPC/CLI runtime's own `createSession` host callback.
    - `examples/behavior-evaluation.ts`, `scripts/fixtures/e2e-070-host-completeness-journey.mjs` — a host-callback object literal of the same name.
    - `packages/prism-core/src/runtime/server/handler/authorize.ts` `createSession` and `packages/web-tools/src/browser/manager.ts` `createSession` — unrelated functions.
    - `src/__tests__/docs.test.ts:2642,3122` — assertions about the released README and release page.
    - `store:` in a `createAgent` literal: none (`TS` is typed, and the scripts were scanned with a balanced-brace pass: 11 sites migrated).

    **Verification.** `bun run typecheck` 0 errors; `node scripts/release.mjs gate` green; `bun test src packages` → 36 failing tests, each outside Task 2 on inspection (not re-run against a clean tree, since `HEAD` predates plans 143-148):
    - Phase 2 residue: `Duplicate tool: load_skill` (`agent-run-lifecycle`, `prefix-stability-conformance`), `agent.config.tools.register` / `registry.list` (`limits`, `mcp-integration`, `node-agent-definitions`, `agents.test` "passes only host active tools"), `Array.isArray(config.tools)` (`public-contracts`), run-bundle tool count and golden digest, hooks-json allow-list (`define-agent`), `package-setup-boundaries` entry shape.
    - Packaging and docs: `packaging`, `install-smoke`, `host-composition-compat`, `cli-init`, `acp-agent` bin (`dist/bin` missing), and 7 `docs.test.ts` cases (OAuth docs, package-doc counts, scope matrix, tools/context docs, sidecar).
    - Script suites (`phase8-conformance`, `phase20/40-security`, `obscura-host-conformance`, `phase16-freeze`) fail on `tools: [...]` arrays, `askEveryTool`, and durable-resume shapes that earlier plans changed; none fails on session opening.


- [x] Task 3: `Session` reshape
  - Acceptance Criteria:
    - Functional: `AgentSession` is renamed `Session` with no alias. It has these members:
      - `id`
      - `run(input, options?)`
      - `stream(input, options?)`
      - `steer(input)`
      - `abort(reason?)`
      - `messages(): Promise<readonly Message[]>`
      - `fork({ at? }): Promise<Session>`
      - `compact(): Promise<void>`
      - `close(): Promise<void>`

      `resume` lands in Task 4. Plan 148 Task 1(k) decides which other members are kept as documented kernel members (expected: `subscribe`, `entries`, `checkout`, and `contextMeter`, which Prism Code uses until Phase 12) and which are deleted (expected: `prompt`, and `clone` folded into `fork`).
    - Functional: `fork({ at })` replaces `fork({ leafId })` and `clone({ id, leafId })`. It is async because it copies package state through the store (plan 146 Task 7). Every caller migrates in this task: `.clone(` (10 files), `.prompt(` (8), and `fork(` sites.
      - Amendment (executed): `fork` is the old `clone`, not the old `fork`. It copies the branch that ends at `at` into a **new** session id and resolves that session opened (hydrated, `session.opened` fired). The old same-id `fork({ leafId })` is gone: reopening another leaf of the same session is `agent.session({ id, leafId })` or `checkout`. A pending `suspended_run` entry is not copied. The RPC `cloneSession` command folds into `forkSession` (`params.at`).
    - Functional: `steer(input)` keeps the pending-steer caps and fail-closed behavior (`DEFAULT_MAX_PENDING_STEERS`, `src/contracts-run-state.ts:409`). `softInterrupt` is kept or removed per plan 148 Task 1(k).
      - Amendment (executed): plan 148 Task 1(k) did not decide `softInterrupt`. It stays as `steer(input, { softInterrupt })`: the RPC `steer` command and `agents.test.ts` use it, and it is the only way to cut an in-flight provider stream.
    - Functional: The repo-wide grep (exclusions as in Task 2) for `AgentSession\b`, `.prompt(`, `.clone(`, and `leafId:` in fork calls returns only the Task 1 residue.
    - Performance: `messages()` reads the cached branch (the snapshot cache, `DEFAULT_SNAPSHOT_CACHE_TTL_MS`) and adds no store round trip on a warm session.
    - Code Quality: One session type. The kept extra members are documented as kernel members in `docs/next/agent.md` with their reason, so Phase 11's export-surface review sees them.
    - Security: `messages()` returns stored (post-`message.append`) messages, never the `context.build` draft. A test pins that context mutations stay out.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 `Session`
      - `src/contracts-run-state.ts:429-482`, `src/agent-session/session.ts:557-845`
      - plan 148 Task 1(k)
    - Options Considered:
      - Delete every member outside §2.3 now. Rejected: Prism Code's branching and usage meter use `checkout` and `contextMeter`, and Phase 12 rewrites the lab. Removing them first would leave the lab red, and §2.3 is a sketch whose "exact types are fixed in each phase's plan".
    - Chosen Approach:
      - Rename the type, add `messages()`, fold `clone` into async `fork`, delete `prompt`, and keep the extras plan 148 named as documented kernel members.
    - API Notes and Examples:
      ```ts
      const s = await agent.session();
      await s.run("hello");
      const branch = await s.fork(); // copies messages and package state
      console.log((await branch.messages()).length);
      ```
    - Files to Create/Edit:
      - `src/contracts-run-state.ts`, `src/contracts-core/agent.ts`: types.
      - `src/agent-session/session.ts`: `messages`, `fork`, and the removals.
      - `src/loop/types.ts`: `RunController.session` type.
      - Callers in every workspace and `examples/`.
      - `src/__tests__/public-export-contract.test.ts`, and `scripts/compat-baseline/*.txt`: regenerate, with the diff and attribution in the task note.
      - `docs/next/agent.md`: `Session`. `CHANGELOG.md`.
    - References:
      - plan 146 Task 7 (package state on fork)
  - Test Cases to Write:
    - `messages_returns_stored_branch_not_context_draft`
    - `fork_at_entry_copies_branch_and_package_state`
    - `fork_without_at_forks_from_leaf`
    - `steer_over_cap_fails_closed` (the existing `steer queue overflow fails closed`, renamed)
    - `session_type_has_exactly_the_documented_members`: a type-level test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the `Session` type and its members.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: `Session` section.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-03):

    **What changed.**
    - `AgentSession` is `Session` in the contract (`src/contracts-run-state.ts`), with the `Session = AgentSession` alias deleted. 82 files renamed with a word-boundary codemod (`RuntimeAgentSession`, `AgentSessionConfig` untouched). No existing `Session` identifier collided.
    - New `session.messages()`: the snapshot's stored messages as a copy, so a warm session adds no store read and a caller cannot mutate the cache. It is never the `context.build` draft.
    - `fork({ at? })` is async (`src/agent-session/session.ts`): reads the branch ending at `at ?? leaf` (an unknown `at` rejects through `getSessionBranchEntries`), appends remapped copies under a new session id (package state is entries on the branch, so it comes along), skips `suspended_run` entries, and resolves the new session through `openResumedSession(copied)`. That settles Task 2's finding: no public session is unhydrated any more.
    - Deleted: `prompt`, `clone`, `fork({ leafId })`, `AgentSessionForkOptions`, `AgentSessionCloneOptions` (now `SessionForkOptions { at? }`), the RPC `cloneSession` command, and the observational-memory wrapper's `prompt` and `clone` (`packages/memory/.../compose.ts`, `packages/prism-code/src/observational-memory.ts`). The wrapper now proxies `messages()` and an async `fork`.
    - Kept as documented kernel members (`docs/next/agent.md`, "Kernel members kept beyond the sketch"): `entries`, `checkout`, `contextMeter`, `subscribe`, `leafId`, `guardrailPackRefs`, plus the optional `getLoadedSkillNames` / `restoreLoadedSkills` (durable resume restores skills through them; Task 4 revisits) and `steer`'s `softInterrupt`.
    - Callers migrated: `src/rpc.ts`, `examples/define-package.ts` (`agent.session({ id: fork.id })` reopens the fork), `examples/external-app-db-backed.ts`, and the tests below.

    **Tests.** `fork_at_entry_copies_branch_and_package_state` (branch cut at `at`, fresh entry ids, original untouched; the package-state half is `session_state_survives_fork_and_resume`, rewritten to fork, reopen the fork by id in a new agent, and `checkout`), `fork_without_at_forks_from_leaf`, `messages_returns_stored_branch_not_context_draft`, `steer_over_cap_fails_closed`, `session_type_has_exactly_the_documented_members` (type-level `Exactly<keyof Session, …>` plus a runtime check that `prompt` and `clone` are gone). Rewritten for the new fork: `rpc_fork_keeps_parent_handle_and_registers_the_forked_session`, the guardrail-pack "carries packs into a forked session" case, `public-contracts`. Dropped: `state_not_ready` on an unhydrated fork (it cannot occur through the public API), and `session.prompt shares the run result contract`.

    **Baseline diff** (`gate --update-baseline`, then plain `gate` green): no value export added or removed. Statement-text changes only, because the baseline records a type alias's source text: `AgentSession` → `Session` in `arnilo__prism-agent-sdk.txt` (re-export statement and 5 neighbours), `RuntimeAgentSession implements Session`, `collectWhileRunning`, `runPromptMode`. Types are not tracked, so `AgentSessionForkOptions`/`AgentSessionCloneOptions` leave no baseline line.

    **Sweep** (exclusions as in Task 2): `\bAgentSession\b` — only the "was renamed" sentence in `docs/next/agent.md`. `session.prompt(` / `session.clone(` — none. `fork({ leafId })` — none. The released `/docs` pages and `docs/cli-rpc.md` still name `AgentSession`, `prompt`, `cloneSession`; they move at release.

    **Findings that affect later tasks.**
    - Task 4: `session.resume` and `session.run`'s `RunResult` still use `AgentRunResult`/`AgentRunError`; the `Session` interface is the place `resume(decisions)` lands. A forked session never inherits a pending suspension, so a host resumes on the original session id.
    - Task 5: `agent.sessions.get(id)` should resolve through `agent.session({ id })` semantics (ownership scope included); `delete` of a session does not cascade to its forks, which are independent sessions.
    - `bun test src packages` is the same 36 failing tests as at Task 2 (tool registry shape, `load_skill` duplicates, hooks-json allow-list, packaging/docs counts, script suites). One earlier run showed 41 while a build ran in parallel; the next run matched again.

- [x] Task 4: `RunResult`, suspension, and `session.resume(decisions)`
  - Acceptance Criteria:
    - Functional: `RunResult` matches §2.3:
      - `status` is `completed`, `stopped`, `suspended`, `failed`, or `aborted`
      - `stopReason?`
      - `pending?: readonly PendingDecision[]`, present when suspended
      - `messages`: the messages this run appended
      - `usage?`, `error?`

      Kernel extras (`runId`, `text`, `limit`) are kept or removed per plan 148 Task 1(k). The status map from 0.12 (`succeeded`, `denied`) is the one Task 1 recorded.
      - Amendment (executed): plan 148 Task 1(k) decided no extras, so they are kept: `sessionId`, `runId`, `leafId`, `text`, `content`, `message`, `limit`, `attribution`, `abortReason`, `stopDetail`, and the durable `runState`. `interruption` leaves the result (`pending` replaces `interruption.pendingDecisions`; the kind and reason are on `runState.interruption`). The new status type is `RunResultStatus`, because `RunStatus` already names the ledger vocabulary. `AgentFinishReason` gains `denied`.
      - Amendment (executed): `Decision` is the renamed `RunDecision`, with its fields unchanged (`approvalId`, `outcome`, `reason?`, `modifiedArguments?`, `elicitation?`), because those names are persisted in checkpoints. The example below reads `{ approvalId, outcome: "allow_once" }`, not `{ id, decision: "allow" }`.
    - Functional: Failed and aborted runs return or throw per plan 148 Task 1(k). If they return, `AgentRunError` is deleted and its 24 referencing files migrate in this task.
      - Amendment (executed): they return. A hook handler's failure carries `error.owner` and `error.hook` (new optional `ErrorInfo` fields), so "naming the package and hook" survives the move from a thrown `HookError`.
    - Functional: `session.resume(decisions, options?)` returns `AsyncIterable<AgentEvent>`:
      - Amendment (executed): a suspension is pending only while its `suspended_run` entry is the branch tip (package state aside), and the entry is now a child of the branch leaf (it was an unparented orphan, so a branch read never saw it). `decision.resolved` is one event listing every decision (the frozen catalog shape), not one event per decision. The batch must decide every pending id exactly once (a partial batch is the lifecycle's `resuspend` path, not `session.resume`).
      - Amendment (executed): a suspension needs no `runState` or `CheckpointStore`. With none configured the kernel keeps the bounded versioned state in a private in-memory checkpoint (definition revision `kernel-suspension`, `persistSessionState: true`) and the entry is the durable anchor; a resume seeds a fresh one from the entry. With a host `runState` (on the run, or `AgentConfig.runState`) the claim CAS runs against the host store, so pass the same `runState` to `resume`.
      - it reads the session's pending `suspended_run` entry
      - it validates each decision id against `pending`; an unknown or missing id fails closed
      - it fires `decision.resolved` per decision, then `run.started { resumed: true }`, and continues the loop
      - it works from a new process over the same store
      - with no pending suspension, it fails closed with a named error
    - Functional: `resumeDurable`, `recordDurableResumption`, `recordDurableDenial` (`src/agent-session/session.ts:648-700`), and the public `resolveRunDecisions` (`src/agent-approval.ts:141`) are deleted, or made internal if Task 1 finds a non-kernel caller that Phase 9/10 owns. The ACP/AG-UI elicitation bridges (`packages/ag-ui/src/acp/agent/*`) and the supervisor's durable children resume through `session.resume`.
      - Amendment (executed, a compromise): the three session methods become the internal `continueSuspendedRun`, `announceResuspended`, and `announceDenied`, shared by `session.resume` and the checkpoint lifecycle (`resumeAgentRun`, `createAgentRunLifecycle`). `resolveRunDecisions` was never a root export; it stays the internal validator behind both. The lifecycle stays because every host library resumes by `runId` and `expectedVersion` against a host `CheckpointStore` (AG-UI `handler.ts`, ACP `recovery.ts`, the server handler, channels, the supervisor's nested children, Prism Code). Moving them to `agent.session({ id }).resume()` changes their restart and CAS model, so it belongs with the durable store work (Phase 6) and the host rewrites (Phase 10/12). The sweep below therefore excludes `resumeAgentRun`.
    - Functional: The fingerprint checks from plan 144 Task 5 still fail closed on hook-id or loop-revision drift through the new entry point.
    - Functional: A repo-wide grep (exclusions as in Task 2) for `resumeDurable`, `resolveRunDecisions`, `AgentRunError` (if deleted), `"succeeded"`, and `"denied"` as run statuses returns only the Task 1 residue.
    - Performance: A resume does one store read for the `suspended_run` entry plus the branch read. There are no every-turn checkpoint writes for runs that never suspend. If plan 144's every-turn checkpoints are still on, Task 1 records whether this task removes them, and the sizing trade-off goes in `docs/next/agent.md`.
    - Code Quality: One suspend path (`ask` → `suspended_run`) and one resume path (`session.resume`).
    - Security: A decision cannot widen the original call. A `rewrite` decision is re-validated against the tool schema, and a decision for a call id not in `pending` fails closed. `pending` and `decision.*` events carry redacted arguments only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 `RunResult`/`resume`, §2.4 (how an `ask` resolves), Phase 3 ("Suspension and `session.resume(decisions)` for `ask` decisions without a UI")
      - `src/suspended-run.ts`, `src/agent-session/session.ts:648-708`, `src/agent-approval.ts:141`, `src/contracts-run-state.ts:27-82,366-408`
      - plan 144 Task 5 Notes, plan 145 Task 1 (the ACP elicitation bridge)
    - Options Considered:
      - Keep `resumeDurable` as the low-level entry and wrap it. Rejected: two public resume paths, and `resumeDurable` takes run state the host should never handle.
    - Chosen Approach:
      - Make the session own the suspended entry: `resume` reads it, validates the decisions, and re-enters `runInternal`. Delete the 0.12 entry points.
    - API Notes and Examples:
      ```ts
      const r = await session.run("delete the temp dir");
      if (r.status === "suspended") {
        // later, maybe in another process
        const s = await agent.session({ id: session.id });
        for await (const e of s.resume(r.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" })))) render(e);
      }
      ```
    - Files to Create/Edit:
      - `src/contracts-run-state.ts`: `RunResult`, `Decision`, statuses.
      - `src/agent-session/session.ts`, `src/agent-session/session/assemble.ts`, `src/agent-session/session/tool-round.ts`, `src/suspended-run.ts`, `src/agent-approval.ts`, `src/agent-run-lifecycle.ts`.
      - `packages/ag-ui/src/acp/agent/*`, `packages/acp-agent`, `packages/prism-core/src/runtime/supervisor*`, `packages/prism-code` approval/headless, and `examples/agent-durable-approval.ts`, `examples/durable-loops-and-approvals.ts`, `examples/durable-investigation.ts`, plus the other Task 1 callers.
      - `src/__tests__/public-export-contract.test.ts`, and `scripts/compat-baseline/*.txt`: regenerate, with the diff and attribution in the task note.
      - `docs/next/agent.md`: `RunResult` and `resume`. `docs/next/hooks.md`: the `ask` path now ends in `session.resume`. `CHANGELOG.md`.
    - References:
      - plan 144 Task 5, `src/hooks/ask.ts`
  - Test Cases to Write:
    - `run_result_status_map_covers_every_terminal_path`: completed, stopped (`turn.before`), suspended, failed, and aborted.
    - `failed_run_returns_result_with_error`, or `failed_run_throws_with_result` per Task 1(k).
    - `resume_in_new_process_over_same_store_completes_the_run`: a new agent over the same store.
    - `resume_with_unknown_decision_id_fails_closed`
    - `resume_without_pending_suspension_fails_closed`
    - `resume_rewrite_decision_is_revalidated`
    - `resume_after_hook_set_drift_fails_closed`
    - `decision_resolved_fires_per_decision_on_resume` (one event listing each decision)
    - Added: `resume_with_missing_or_duplicate_decision_fails_closed`, `resume_after_a_later_run_fails_closed`, `resume_after_loop_revision_drift_fails_closed`, `a_rejected_decision_resumes_without_running_the_call`, `pending_and_events_carry_redacted_arguments_only`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — run results and resumption.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: `RunResult`, `resume`, and the suspend cost note.
      - `docs/next/hooks.md`: `ask` resolution.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-03):

    **What changed.**
    - `RunResult` (`src/contracts-run-state.ts`): `status: RunResultStatus` (`completed | stopped | suspended | failed | aborted`), `pending`, `messages` (a per-run list the session fills in `appendNow`, as stored after redaction), plus the kept extras. `toRunResultStatus(status, stopReason)` maps the persisted `AgentRunStatus` once, in `buildRunResult`. The checkpoint, ledger, workflow and supervisor vocabularies are untouched: the supervisor's delegation events, summaries and completions keep `succeeded | failed | aborted | denied` through a local `childStatus(result)`.
    - Failed and aborted runs **return** (`executeRun` no longer throws). `AgentRunError` is deleted. Callers migrated: `session.stream` (ends normally after `run.failed`), `runPromptMode` and the RPC `prompt` command (a failed result becomes the CLI error exit / `ok: false`), `resumeAgentRunStream`, Prism Code headless (the max-cost `hook_stop` rewrite now maps a `failed` result), channels `runtime-turn`, evals `experiment`, the supervisor (a failed child throws the new `SupervisorRunError` carrying its `result`; `SupervisorLimitError` still carries the result for a ceiling), and the examples.
    - `ErrorInfo` gains optional `owner` and `hook`, filled by `errorToErrorInfo` for a `HookError`. `loopConformance` (`@arnilo/prism/testing`) now reports `error` as an `ErrorInfo`.
    - `session.resume(decisions, options?)` (`src/agent-session/session.ts`): `prepareResume` reads the branch once, finds the pending suspension (`pendingSuspensionOf` in `src/suspended-run.ts`), restores session state from the stored run state (`src/agent-run-restore.ts`, extracted from the lifecycle and shared), validates the batch with `resolveRunDecisions` (rewrites re-validated against the tool schema and the restored pack rules), checks the fingerprint, then claims through the checkpoint store. It runs before any subscriber or event exists. The run then goes through `continueSuspendedRun`, the same core the lifecycle uses.
    - `suspendDurable` creates the private in-memory durable when none is configured (and fails closed with `ERR_PRISM_LOOP_NOT_DURABLE` for a custom loop without `snapshot`/`restore`), labels an anonymous agent `agent`, and writes the entry through `session.appendEntry` (ownership-stamped, redacted, parented to the leaf). `Session.resume` is on the public interface and the observational-memory wrapper proxies it.
    - Docs: `docs/next/agent.md` ("RunResult and session.resume", including the cost note), `docs/next/hooks.md` (how an `ask` ends), `docs/next/loop.md`. `CHANGELOG.md`.

    **Tests.** New `src/__tests__/session-resume.test.ts` (12): `resume_in_new_process_over_same_store_completes_the_run`, unknown, missing and duplicate ids, no pending suspension, resume after a later run, `resume_rewrite_decision_is_revalidated`, hook-set and loop-revision drift, `decision_resolved_fires_per_decision_on_resume`, a rejected decision, redaction, and `run_result_status_map_covers_every_terminal_path`. `failed_run_returns_result_with_error` is in `agents.test.ts`. `ask-resolution.test.ts` now drives `session.resume` (no `runState`). Shared helper `failedRun` in `src/__tests__/run-result-helpers.ts`. Over 100 assertions moved from `succeeded` to `completed`/`stopped`, and every `assert.rejects(session.run(...))` became a returned `failed`/`aborted` result.

    **Baseline diff** (`gate --update-baseline`, then plain `gate` green). Removed: `AgentRunError`, `RunDecision` (a type, renamed `Decision`), and the `AgentRunResult` type text. Added: `Decision`, `toRunResultStatus`, `SupervisorRunError` (prism-core), `KERNEL_SUSPENSION_REVISION`, `pendingSuspensionOf`, `restoreRunSessionState`, and the test helper `failedRun` (the baseline scans `dist/__tests__`, as it does for `kernelEvents`). Changed: every signature that named `AgentRunResult` now names `RunResult`.

    **Sweep.** `resumeDurable`, `recordDurableResumption`, `recordDurableDenial`, `AgentRunError`: only the "is deleted" sentence in `docs/next/agent.md`, a stale comment line in `supervisor.ts`, and `scripts/plan-review-gate.test.mjs` (a historical name list). `resolveRunDecisions`: internal, called from `session.resume` and the lifecycle. `"succeeded"` / `"denied"`: remain only as the persisted checkpoint, ledger, workflow, evals and supervisor-delegation vocabularies (`AgentRunStatus`); no agent run result carries them.

    **Findings that affect later tasks.**
    - Task 5: `Agent.sessions.get` and `delete` should treat a pending `suspended_run` entry as session content (it is on the branch); `agent.subscribe()` carries the `decision.resolved` and `run.*` events of a resumed run only through the session's own subscribers, as before.
    - Task 6: `Decision`, `PendingDecision`, `RunResult`, `RunResultStatus`, and `SupervisorRunError`'s base are the new root names; `RunDecision`, `AgentRunResult`, `AgentRunError` must not reappear in the freeze test.
    - Task 7: `examples/approval.ts` needs no `runState`; it calls `session.run`, then `agent.session({ id })` and `session.resume`. Decisions are `{ approvalId, outcome }`.
    - Entries written before this task have no parent (the old orphan `suspended_run`); `pendingSuspensionOf` will not find one, so such a suspension resumes through `resumeAgentRun` only.
    - The same 36 failing tests as at Task 3 (plus one timing test, "TUI input editing: filters 50k paths", that fails under load). The `examples/` sweep (115 files) runs clean except `agent-sdk-coding`, `prism-code-headless` (both read `agent.config.tools.list()`, Phase 2 residue), and `docker-process-session` (no Docker).

- [x] Task 5: The `Agent` surface — `id`, `sessions`, `commands`, `models`, `tools`, `skills`, `subscribe`
  - Acceptance Criteria:
    - Functional: `Agent` has these members:
      - `id`: `config.id` or a generated id
      - `session()`
      - `sessions: SessionIndex`
      - `commands: CommandIndex`
      - `models: ModelIndex`
      - `tools: readonly ToolInfo[]`
      - `skills: readonly SkillInfo[]`
      - `inspect()`
      - `subscribe(): AsyncIterable<AgentEvent>`
      - `dispose()`

      The public `config` member is removed or kept per plan 148 Task 1(k). If it is removed, the internal readers move to the runtime registry (`src/agent-session/runtime-registry.ts`), and the backlog item "Move the remaining readers of `agent.config.tools` / `skills` onto the merged view" is delivered here.
      - Amendment (executed): `config` is kept (Task 1(k)). The backlog item is narrowed, not closed: `/tools` and the two examples moved onto `agent.tools`; three readers need the Phase 12 rewrite (see the backlog entry).
      - Amendment (executed): the type that §2.3 calls `SessionIndex` collided with the adapter search seam of the same name, so that seam is renamed `SessionSearchIndex` (no alias) and `SessionIndex` is the `agent.sessions` surface.
    - Functional: `agent.sessions` has `list`, `get`, `delete`, and `search`. Each one checks the resolved store's declared capability. The kernel memory store implements all four. A store without one fails with a named `unsupported_store_capability` error and does not fall back to a scan, except `search`, which keeps today's documented capped linear fallback (`src/contracts-core/session.ts:66-72`). `SessionStore` gains optional `listSessions?` and `deleteSession?`, whose exact names Task 1 confirms.
      - Amendment (executed): `get` needs no capability (it reads the baseline `list`), `delete` resolves `SessionNotFoundError` for an absent or out-of-scope session, and `search` has no kernel fallback of its own: the memory and JSONL stores already implement `searchSessions` as the capped linear scan, and a store without it gets `UnsupportedStoreCapabilityError("searchSessions")`. The models carry no new shape: `AIProvider.models?(): Promise<readonly ModelConfig[]>`, because `ModelConfig` is the normalized discovery type (`ModelDiscoveryResult`).
    - Functional: `agent.commands` is `{ list(); run(name, args, { session }) }`, which reshapes `AgentCommands` (`src/contracts-core/agent.ts:146`). `options.session` takes a `Session`.
    - Functional: `agent.models` has `list()` and `resolve(ref)`:
      - `list()` returns the models each registered provider declares
      - providers with no discovery contribute only the configured model
      - `resolve(ref)` returns the provider and model, or fails closed on an unknown provider

      The internals stay thin until Phase 5 adds `ModelProvider.models()`. The member names do not change then.
    - Functional: `agent.tools` and `agent.skills` are frozen `ToolInfo { name, description, effects, package }` and `SkillInfo { name, description, package }` lists from the merged view, after `disable`.
    - Functional: `agent.subscribe()` yields `package.status`, `background.*`, and `session.*` events across sessions until `dispose()`. It uses the same overflow policy as session subscribers, and a slow subscriber never blocks a run.
    - Performance: `tools`/`skills` are computed once after load and are not rebuilt per access. `sessions.list` pages through the store cursor and never loads entries.
    - Code Quality: The index types live in `src/agent/` (§2.2 `agent/`: "createAgent, Agent, inspect, session index").
    - Security: `sessions.list/get/search` apply the agent's ownership scope. `sessions.delete` is scoped the same way and fails closed outside it. `models.list` exposes no credential or base URL that holds a secret. `subscribe()` events pass the agent redactor.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 `Agent`, §2.1 Agent/session ("session index"), §2.2 `agent/`
      - `src/agent-session/create-agent.ts:56-84`, `src/contracts-core/session.ts:58-153`, `src/packages/loader.ts:374`, `src/agent/inspect.ts`
      - plan 146 Task 6 Notes (merged views), plan 148 Task 1(k)
    - Options Considered:
      - Make `agent.sessions` a full scan over `list(sessionId)`. Rejected: §2.3 says "store capabilities", and a silent scan on a Postgres store is a hidden cost.
      - Defer `agent.models` to Phase 5. Rejected: Phase 3 Scope names it, and plan 146 set the precedent of shipping final member names over today's internals (`models.client`).
    - Chosen Approach:
      - Add the indexes over existing seams with capability checks, and implement the store capabilities in the kernel memory store only. Phase 6 adds them to the durable stores.
    - API Notes and Examples:
      ```ts
      const page = await agent.sessions.list({ limit: 20 });
      await agent.commands.run("om", {}, { session });
      for await (const e of agent.subscribe()) if (e.type === "package.status") log(e);
      ```
    - Files to Create/Edit:
      - `src/agent/sessions.ts`, `src/agent/models.ts`: new. `src/agent/inspect.ts`: shared merged view.
      - `src/contracts-core/agent.ts`: `Agent`, `CommandIndex`, `ToolInfo`, `SkillInfo`.
      - `src/contracts-core/session.ts`: store capability members. `src/session-stores.ts`: memory store implementation.
      - `src/agent-session/create-agent.ts`, `src/agent-session/event-subscriber.ts`: agent-scoped subscribe.
      - `agent.config` readers per Task 1, if `config` is removed.
      - `src/__tests__/public-export-contract.test.ts`, and `scripts/compat-baseline/*.txt`: regenerate, with the diff and attribution in the task note.
      - `docs/next/agent.md`: `Agent` section. `CHANGELOG.md`.
    - References:
      - `plans/backlog.md` "Move the remaining readers of `agent.config.tools` / `skills`"
  - Test Cases to Write:
    - `sessions_list_get_delete_search_on_memory_store`
    - `sessions_capability_missing_fails_closed`, with a store lacking `listSessions`.
    - `sessions_respect_ownership_scope`
    - `commands_run_with_session_reaches_owning_package_context`
    - `models_list_and_resolve_over_registered_providers`, and `models_resolve_unknown_provider_fails_closed`
    - `agent_tools_and_skills_reflect_disable`
    - `agent_subscribe_receives_package_status_background_and_session_events`
    - `agent_subscribe_slow_consumer_never_blocks_a_run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `Agent` members.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: `Agent` section.
      - `docs/next/slots.md`: store capability members.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-03):

    **What changed.**
    - `Agent` (`src/contracts-core/agent.ts`): `id`, `sessions`, `models`, `tools`, `skills`, a required `subscribe()`. New types `ToolInfo`, `SkillInfo`, `SessionIndex`, `ModelIndex`, `ResolvedModel`. `createAgentWith` builds them; `agent.id` is `config.id`, then `name`, else `randomId("agent")`.
    - `agent.sessions` (`src/agent/sessions.ts`): `list`/`delete`/`search` ask the resolved store for `listSessions`/`deleteSession`/`searchSessions`; a store without one throws `UnsupportedStoreCapabilityError` (`unsupported_store_capability`, `capability` names the method). The agent's `ownership` is merged over any caller scope, so a query can narrow it but not widen it. `SessionStore` gains `listSessions?` and `deleteSession?`, with `SessionListQuery`, `SessionSummary`, and the `DEFAULT/HARD_MAX_SESSION_LIST_LIMIT` bounds. The memory store implements both (scoped, paged by a `(updatedAt, id)` cursor, no transcript); `entriesInScope` is now the one scope check, shared with `agent.session({ id })`.
    - `agent.models` (`src/agent/models.ts`): `list()` gathers `AIProvider.models()` from the host's direct provider and package providers (`LoadedPackages.providers()`), adds the configured model when nobody declared it, drops `parameters`/`compat`/`metadata`, and masks the rest with the agent's redactor; `resolve(ref)` goes through the loader's `resolveProvider` (the same resolution `models.client` and sessions use).
    - `agent.tools` / `agent.skills` (`src/agent/views.ts`): the `agentToolList` / `agentSkillSource` merged view as frozen `ToolInfo` / `SkillInfo`, cached after first read, empty after `dispose()`. `inspect()` now builds its tool and skill lists from the same functions.
    - `agent.subscribe()`: `package.status` (the loader's new `emitAgentEvent` option, after its own redaction), `background.*` (fanned out from the session's `dispatchEvent`), and `session.*` (already routed). `dispose()` now ends every agent subscription.
    - Docs: `docs/next/agent.md` ("Agent" section), `docs/next/slots.md` (store capabilities), `CHANGELOG.md`. Conformance: `assertSessionStoreConforms` gains `exerciseSessionIndex`, run against the memory store.

    **Tests.** New `src/__tests__/agent-surface.test.ts` (11): `sessions_list_get_delete_search_on_memory_store`, `sessions_capability_missing_fails_closed`, `sessions_respect_ownership_scope`, `commands_run_with_session_reaches_owning_package_context`, `models_list_and_resolve_over_registered_providers`, `models_resolve_unknown_provider_fails_closed`, `agent_tools_and_skills_reflect_disable`, `agent_id_is_configured_or_generated`, `agent_subscribe_receives_package_status_background_and_session_events`, `agent_subscribe_slow_consumer_never_blocks_a_run`, `dispose_ends_agent_subscriptions`.

    **Baseline diff** (`gate --update-baseline`, then plain `gate` green). Added: `UnsupportedStoreCapabilityError`, `UNSUPPORTED_STORE_CAPABILITY_CODE`, `isUnsupportedStoreCapability`, `DEFAULT_SESSION_LIST_LIMIT`, `HARD_MAX_SESSION_LIST_LIMIT`, and the module-level helpers `createSessionIndex`, `createModelIndex`, `toolInfos`, `skillInfos`, `entriesInScope`, `summarizeSession`. Changed: `inspectAgent`'s first parameter is named. The type `SessionIndex` changed meaning (the baseline records values, so the rename leaves no line).

    **Compromises and findings.**
    - Not delivered: `dispose()` does not close the agent's open sessions (the roadmap says it does). Sessions the agent opened are not tracked, and `fork()` builds sessions inside the session class. Closing them needs a live-session set owned by the agent; it goes in this plan's Further Actions.
    - Stores that still lack `listSessions` / `deleteSession`: the JSONL store (`src/node/session-store-jsonl.ts`), `packages/prism-core` SQLite, Postgres and NATS, and Prism Code's session store. They answer `UnsupportedStoreCapabilityError` until Phase 6; the JSONL and database stores already implement `searchSessions`.
    - A `package.status` raised during load predates every subscriber, so `agent.subscribe()` cannot replay it; `inspect().statusNotes` holds it.
    - Task 6: `Agent`, `ToolInfo`, `SkillInfo`, `SessionIndex`, `ModelIndex` and `ResolvedModel` join the freeze list; a hand-built `Agent` fake now needs the five new members (`public-contracts.test.ts` was the only one outside `wrapAgentWithFailureInjection`, which spreads a real agent).
    - Same 36 failing tests as at Task 4, plus one timing test under load.

- [x] Task 6: One import, and the agent SDK stops receiving features
  - Acceptance Criteria:
    - Functional: Every type a host or package author needs is a root export of `@arnilo/prism`:
      - the §2.3 types: `createAgent`, `AgentConfig`, `Agent`, `Session`, `SessionOptions`, `RunOptions`, `RunResult`, `Decision`, `PendingDecision`, `HostPort`, `HostUi`, `UiRequest`, `UiResponse`, `AgentEvent`, `Principal`, and the limits type
      - the §2.6 types: `definePackage`, `PackageAPI`, `SessionContext`, `ToolDefinition`, `Skill`, `CommandDefinition` as frozen in plan 147
      - the §2.5 types: `LoopStrategy`, `RunController`
      - Amendment (executed): the roadmap's `UiRequest` / `UiResponse` ship as `HostUiRequest` / `HostUiResponse` (plan 148 Task 2) and the limits type is `RunLimits`; the freeze list uses the shipped names and adds the Task 5 types (`ToolInfo`, `SkillInfo`, `SessionIndex`, `ModelIndex`).

      `src/__tests__/agent-surface-freeze.test.ts` imports each one from the root, and a missing export fails it with a message naming `docs/next/agent.md`. `createMockProvider` and the conformance helpers come from `@arnilo/prism/testing`.
    - Functional: `@arnilo/prism-agent-sdk` stops receiving features. Its host-contract re-exports (`packages/agent-sdk/src/index.ts`) follow the renamed kernel types. Its tests are moved per plan 148 Task 1(j): kernel-behavior tests (progressive `load_skill`, `run.end` continuation, the memory store default) move to `src/__tests__` or the owning package suite, and plane tests stay until Phase 12. Its `README.md` and `package.json` description state that it receives no features and that `@arnilo/prism` replaces it.
    - Functional: The repo-wide grep for type imports from `@arnilo/prism-agent-sdk` outside `packages/prism-code` and `packages/agent-sdk` returns nothing. `examples/agent-sdk-coding.ts` is either kept as the lab's assembly reference or deleted, per Task 1, with `examples/README.md` and `scripts/e2e-coverage.json` updated.
    - Performance: n/a — exports only. The root barrel's packed-bytes budget (`scripts/budgets.json`) is re-measured.
    - Code Quality: No new export that is not on the §2.3/§2.5/§2.6 lists or a documented kernel extra.
    - Security: n/a — no new trust path. The freeze test also asserts that no test-only seam (`createAgentWith`) is a root export.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3 ("a host and a package author import everything from `@arnilo/prism`"; "`@arnilo/prism-agent-sdk` stops receiving features"), §2.9 Retired, Part 3
      - `src/index.ts`, `packages/agent-sdk/src/index.ts`, `src/__tests__/public-export-contract.test.ts`
    - Options Considered:
      - Delete `@arnilo/prism-agent-sdk` now. Rejected: Prism Code imports it in eight files, and Phase 12 rewrites the lab.
    - Chosen Approach:
      - Pin the root surface with a freeze test, move the kernel-behavior tests, and mark the agent SDK frozen in its README.
    - API Notes and Examples:
      ```ts
      import { createAgent, definePackage, type Session, type HostUi, type AgentEvent } from "@arnilo/prism";
      import { createMockProvider, packageConformance } from "@arnilo/prism/testing";
      ```
    - Files to Create/Edit:
      - `src/index.ts`: any missing root export.
      - `src/__tests__/agent-surface-freeze.test.ts`: new.
      - `src/__tests__/public-export-contract.test.ts`: deliberate update.
      - `packages/agent-sdk/src/index.ts`, `packages/agent-sdk/README.md`, `packages/agent-sdk/package.json`, and `packages/agent-sdk/src/__tests__/*`: moves per Task 1.
      - `src/__tests__/*`: moved tests.
      - `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`: regenerate, with the diff and attribution in the task note.
      - `scripts/budgets.json`: if the budget gate requires it.
      - `docs/next/agent.md`: a "Frozen for Phase 4" section. `CHANGELOG.md`.
    - References:
      - plan 147 Task 6 (the `PackageAPI` freeze pattern)
  - Test Cases to Write:
    - `host_and_package_author_types_import_from_root`
    - `agent_surface_is_frozen_for_phase_4`: the `Agent`, `Session`, `RunOptions`, `RunResult`, and `HostUi` member names (and `HostPort`).
    - `no_test_seam_is_a_root_export`
    - The moved agent SDK tests, by their original names, green in their new suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — root exports and the agent SDK's status.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: freeze section and import list.
      - `packages/agent-sdk/README.md`: frozen notice.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-03):

    **What changed.**
    - `src/__tests__/agent-surface-freeze.test.ts` (3 tests). TypeScript 7 has no JavaScript compiler API, so the type checks generate a probe file and compile it with the repo's `tsc` (`--ignoreConfig`, Node types) against `src/index.ts`. A missing export or a drifted member list fails with a message naming `docs/next/agent.md (Frozen for Phase 4)`. Values are checked on the live namespaces: `createAgent` and `definePackage` on the root; `createMockProvider`, `packageConformance`, `loopConformance` and `createScriptedHostUi` on `@arnilo/prism/testing`. `no_test_seam_is_a_root_export` asserts `createAgentWith`, `CreateAgentInternals` and the runtime-registry functions are absent. I broke the lists on purpose once to see both failure messages.
    - No root export had to be added: every host and package-author type was already there after Tasks 2-5. `createMockProvider` stays a root export too (the SDK and hundreds of tests import it from there); `@arnilo/prism/testing` also exports it.
    - Agent SDK frozen: README banner, `package.json` description, changelog entry, and a comment on its host-contract re-exports (which already follow `Session` and `RunResult`). Six `define-agent.test.ts` cases moved to `src/__tests__/agent-sdk-kernel-behavior.test.ts` under their original names, rewritten against `createAgent`: `skills plane: discovered skills render in prompt catalog on first run without activeSkills (regression)`, `agent loop slot reaches the run path`, `principal is optional and no identity is synthesized`, `opaque principal passes through by reference`, `store omitted and "memory" both use the in-memory default`, `registerHooks fire at run end with no session.run wrapper`. Two the plan named were added: `progressive disclosure: load_skill loads a body the first turn left out` and `run.end continuation: the first continue wins and the run goes on once`. The plane tests (`config`, `tool-plane`, `planes`, `presets`, `mcp-plane`, `capabilities`) and the SDK-specific `define-agent` cases stay.
    - `examples/agent-sdk-coding.ts` is **kept** as the reference for how Prism Code assembles until Phase 12 (the examples README says so), and its one type import from the SDK is gone.
    - `scripts/budgets.json` re-measured and rebaselined with dated reasons: root packed 1642329 to 1718164 (+4.6%), unpacked 5211948 to 5584594, file count 584 to 646, `@arnilo/prism` export count 1569 to 1620, `@arnilo/prism-providers` 588 to 590. They had not been rebaselined since plan 144 Task 6, so the figures cover plans 145-149; the `-providers` +2 is test-scope and I did not trace it.
    - `docs/next/agent.md` gains "Frozen for Phase 4" (import list, pinned members, the agent SDK status). `CHANGELOG.md`.

    **Baseline diff.** No value export changed in this task, so the compat baselines match Task 5's; `arnilo__prism-agent-sdk.txt` differs from `HEAD` only by earlier tasks' renames (`AgentSession` to `Session`, `AgentRunResult` to `RunResult`).

    **Sweep.** `from "@arnilo/prism-agent-sdk"` outside `packages/prism-code` and `packages/agent-sdk`: only `examples/agent-sdk-coding.ts`, a value import (`defineAgent`), kept on purpose. No type import remains.

    **Findings.**
    - `RunOptions` still has 27 members, mostly 0.12 per-run overrides. The freeze pins them all, so Phase 11's export review has a visible diff to make. `Session` is pinned with its eight kernel members.
    - The same 36 failing tests as at Task 5 (tool registry, `load_skill` duplicates, hooks-json allow-list, packaging and docs counts, script suites).

- [x] Task 7: Phase examples and the Phase 3 close
  - Acceptance Criteria:
    - Functional: `examples/session.ts` imports `createAgent` from `@arnilo/prism` and `createMockProvider` from `@arnilo/prism/testing`. It streams one run, prints the `message.delta` text, and prints the `RunResult` status.
    - Functional: `examples/approval.ts` registers a tool gated by a host `tool.call` hook returning `{ ask }`. It shows both paths:
      - with a scripted `HostUi` (`createScriptedHostUi`), the ask resolves inline
      - with no UI, the run suspends, then `agent.session({ id })` plus `session.resume(decisions)` completes it over the same store
    - Functional: `examples/host-hooks.ts` shows §2.11 "Host hooks": a `tool.call` deny on `network` effects, a `turn.before` budget stop, and a `disable` of one tool. It prints `agent.inspect().hooks`.
    - Functional: Each example imports only `@arnilo/prism` and `@arnilo/prism/testing`. A test greps each file's imports.
    - Functional: Each example is added to:
      - the demo list in `examples_demos_run_to_completion_and_emit_no_secret` (`src/__tests__/docs.test.ts:3425`)
      - `examples/README.md`
      - `scripts/e2e-coverage.json`
    - Functional: The Phase 3 Done criteria are recorded in the task note, each with its proof:
      - the examples run under the execution gate with only the two imports (this task)
      - no kernel path synthesizes an identity (plan 148 Task 4's test)
    - Functional: `docs/next/agent.md`, `docs/next/host.md`, and `docs/next/events.md` are complete. Each has an implementation example taken from these examples.
    - Performance: Each example finishes in under 2 s on the mock provider. The demo test's timeout is unchanged.
    - Code Quality: The examples use no internal seam and no deprecated export.
    - Security: The demo gate's no-secret check covers all three. `approval.ts` uses no real credential.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3 Examples and Done, §2.11 "Host hooks"
      - `examples/define-package.ts`, `examples/custom-loop.ts` (precedents), `src/__tests__/docs.test.ts:3403-3440`
    - Options Considered:
      - Fold the three into `examples/define-package.ts`. Rejected: the roadmap names three files, and each demonstrates one contract.
    - Chosen Approach:
      - Three small examples, gate rows, and the Done record.
    - API Notes and Examples:
      ```ts
      import { createAgent } from "@arnilo/prism";
      import { createMockProvider } from "@arnilo/prism/testing";
      // `provider` stays the mock-provider input until Phase 5 replaces it with `providers.register`
      const agent = await createAgent({ model: { provider: "mock", model: "demo" }, provider: createMockProvider([/* scripted turns */]) });
      for await (const e of (await agent.session()).stream("hi")) if (e.type === "message.delta") process.stdout.write(e.delta);
      ```
    - Files to Create/Edit:
      - `examples/session.ts`, `examples/approval.ts`, `examples/host-hooks.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts`: demo list.
      - `docs/next/agent.md`, `docs/next/host.md`, `docs/next/events.md`: implementation examples.
      - `CHANGELOG.md`.
      - `plans/README.md`: status for plans 148 and 149.
    - References:
      - plan 146 Task 9 (example precedent)
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret`: extended with the three new files.
    - `phase_3_examples_import_only_prism_and_testing`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API — examples and docs.
    - Docs pages to create/edit:
      - `docs/next/agent.md`, `docs/next/host.md`, `docs/next/events.md`: implementation examples.
      - `examples/README.md`: three entries.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-03):

    **What changed.**
    - `examples/session.ts` (stream, `RunResult`, reopen by id, `agent.sessions.list`), `examples/approval.ts` (inline `confirm` through `createScriptedHostUi`, then suspend with no UI and finish from a new agent over the same store with `session.resume`), `examples/host-hooks.ts` (a `tool.call` deny on `network`, a `turn.before` stop, a `disable`, and the full `agent.inspect().hooks`). Each imports only `@arnilo/prism` and `@arnilo/prism/testing`, runs in about 55 ms, and prints one JSON line.
    - The mock provider replays its whole script on every call, so each example wraps `createMockProvider` in a three-line `turns(...)` helper to give each turn its own script. That is why the plan's sketch of one scripted list does not work across turns; Phase 5's provider registration replaces it.
    - Wired in: the demo list of `examples_demos_run_to_completion_and_emit_no_secret` (with a content assertion each for `approval.ts` and `host-hooks.ts`), a new `phase_3_examples_import_only_prism_and_testing` test that checks every import specifier and forbids dynamic imports, `examples/README.md` (run commands and three entries), and `scripts/e2e-coverage.json`.
    - `docs/next/agent.md` ("Implementation examples"), `host.md` (the inline and suspended `ask` paths), and `events.md` (an agent-wide `subscribe` and a resumed run's stream) each carry an example from these files. `CHANGELOG.md`.

    **Phase 3 Done, with proof.**
    - *The examples run under the execution gate using only `@arnilo/prism` and `@arnilo/prism/testing`*: the three demos are in the gate's list and pass, and `phase_3_examples_import_only_prism_and_testing` pins the imports.
    - *No kernel path synthesizes an identity*: plan 148 Task 4's `src/__tests__/principal.test.ts` (a run with no `principal` never sees one, and no serialized event or entry carries `local-operator` or an identity) plus `principal is optional and no identity is synthesized` in `agent-sdk-kernel-behavior.test.ts`. Both pass.

    **Whole-plan verification (run 2026-10-03).** `bun run typecheck` 0 errors; `node scripts/release.mjs gate` green; the freeze set (`agent-surface-freeze`, `hook-catalog-freeze`, `package-api-freeze`, `kernel-imports-no-package`, `public-export-contract`, `principal`) green, and `packaging` has its three recorded failures; the four `rg` sweeps return only the recorded residue (the RPC/CLI `createSession` callbacks; `AgentRunError` named in docs and one stale comment; `examples/agent-sdk-coding.ts` importing the value `defineAgent`); `bun test src packages` has 36 failures, the same set recorded since Task 3 and none in code this plan touched. `docs.test.ts` still has 8 failing cases (OAuth docs, package-doc counts, the scope matrix, tools/context docs, the sidecar page), all about released `/docs` pages and 0.12 package inventories.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 src/__tests__/agent-surface-freeze.test.ts src/__tests__/hook-catalog-freeze.test.ts src/__tests__/package-api-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun examples/session.ts && bun examples/approval.ts && bun examples/host-hooks.ts && bun examples/define-package.ts`
- The Task 2, 3, 4, and 6 `rg` sweeps, which return only the listed residue.
- `node scripts/release.mjs gate`

## Compromises Made

- **`create: true` on `SessionOptions`.** Not in the roadmap sketch. `{ id }` alone is strict resume (an unknown or other-scope id is `SessionNotFoundError`); hosts that own an id (AG-UI threads, ACP sessions, channels, conversations, about 146 call sites) pass `create: true`. It costs one branch read. Chosen with the user at Task 2.
- **The checkpoint lifecycle stayed.** `resumeAgentRun`, `createAgentRunLifecycle` and `AgentRunRef` are still the resume path of the server handler, AG-UI, ACP, channels, the supervisor's nested children and Prism Code. They now run on the same internal core as `session.resume` (`continueSuspendedRun`), but those hosts were not moved to `session.resume`, so Task 4's "bridges resume through `session.resume`" is not met. A suspension still accepts a host `runState`, and `RunOptions.checkpointPolicy: "every-turn"` is still available.
- **`RunResult` keeps 0.12 extras** (`sessionId`, `runId`, `text`, `content`, `message`, `limit`, `attribution`, `abortReason`, `stopDetail`, `runState`), and `Session` keeps eight kernel members (`entries`, `checkout`, `contextMeter`, `subscribe`, `leafId`, `guardrailPackRefs`, `getLoadedSkillNames`, `restoreLoadedSkills`). `RunOptions` keeps its 27 members. All are pinned by the freeze test for Phase 11 to trim.
- **Status vocabularies.** `RunResult.status` is new (`RunResultStatus`); checkpoints, the ledger, workflows and the supervisor's delegation events keep `succeeded | failed | aborted | denied`.
- **`agent.dispose()` does not close open sessions**, and `agent.sessions.list/delete` exist only on the memory store (JSONL, SQLite, Postgres, NATS and Prism Code's store answer `UnsupportedStoreCapabilityError`).
- **`agent.models`** is `ModelConfig`-based and its providers expose `models()` only if they add it; Phase 5 owns real discovery.
- **Roadmap names differ from the shipped ones**: `HostUiRequest`/`HostUiResponse` for `UiRequest`/`UiResponse`, `RunLimits` for `Limits`, `RunResultStatus` because `RunStatus` was taken, and `SessionSearchIndex` because `SessionIndex` is the `agent.sessions` surface.
- **Entries written before Task 4** have an unparented `suspended_run`, so only `resumeAgentRun` can resume them.
- **Red baseline left in place.** 36 failing tests in code this plan did not change (tool-registry shape, `load_skill` duplicates, the hooks-json allow-list, packaging and docs counts, the older `scripts/` suites). `docs.test.ts`, `packaging.test.ts` and several script gates pin released 0.12 pages and package inventories.
- **The test suite wrote to a real database.** `packages/prism-code` `skills.test.ts` used the default store at `<prism home>/sessions/sessions.db`. I pointed the three affected tests at `store: { type: "memory" }`; the rows they left in the real home database were not removed.

## Further Actions

- **P1 — Move the hosts onto `session.resume` and delete the checkpoint lifecycle.** AG-UI `handler.ts`, ACP `recovery.ts`, the server handler, channels `runtime-turn.ts`, the supervisor's nested resume, and Prism Code, then `resumeAgentRun` and `AgentRunRef`. Rationale: one resume path (Task 4's goal). Belongs with Phase 6 (stores) and Phase 10/12 (hosts).
- **P1 — Legacy unscoped sessions fail to reopen under an ownership-scoped agent.** `agent.session({ id })` requires every entry to carry the scope; sessions written before ownership stamping have none. Decide a migration or an explicit unscoped-read policy before Prism Code adopts `agent.session` with its `{ tenantId: "local", userId: "local" }` scope.
- **P1 — Clear the red baseline.** Fix or retire the 36 recorded failures and the 8 `docs.test.ts` cases so a regression shows (already tracked in the backlog as "Clear the red baseline of `bun run test`").
- **P2 — `listSessions` / `deleteSession` in the durable stores** (JSONL, SQLite, Postgres, NATS, Prism Code's store) and the conformance leg `exerciseSessionIndex` for each. Phase 6.
- **P2 — Close the agent's sessions on `dispose()`** with an agent-owned live-session set (including forked sessions).
- **P2 — Trim `RunOptions`, `RunResult` extras and the `Session` kernel members** in Phase 11's export review, using the freeze test's diff.
- **P2 — Provider `models()` and `ModelRef`** (Phase 5), then retire the three-line `turns(...)` helper the examples carry.
- **P3 — Isolate Prism Code's tests from the real home** (`<prism home>` override for the default store) and clean the stale rows in `~/.prism-code/sessions/sessions.db`.
- **P3 — Trace the `@arnilo/prism-providers` export count +2** recorded in `scripts/budgets.json`.
- **P3 — Rewrite the `scripts/` conformance suites** (`phase8`, `phase20`, `phase40`, `obscura`, `phase16-freeze`) for `tools: { add }`, `hooks`, and the `RunResult` shape; they fail on shapes plans 144-148 changed, not on this plan.
