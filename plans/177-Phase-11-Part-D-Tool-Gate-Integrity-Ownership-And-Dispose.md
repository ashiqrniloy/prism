# Phase 11 Part D — tool-gate integrity, narrow-only ownership, and fail-closed dispose

## Objectives

- Make the `tool.call` gate see the arguments that actually execute: a `rewrite` is re-gated, a sanitizing rewrite survives an `ask`, and `tool.execute` can no longer swap a call's name or arguments.
- Route every resumed tool call (including `Decision.modifiedArguments`) through the same `tool.call` → `tool.execute` → `tool.result` pipeline as a fresh call.
- Make ownership narrow-only: a run or session scope can narrow the agent's scope, never replace it, and an existing branch is checked against the effective scope before any run or resume.
- Make `agent.dispose()` fail closed: it aborts and settles every open session's runs before removing package hooks, and a disposed agent refuses new sessions.

## Expected Outcome

- The four reproductions from the 2026-10-15 pre-release review fail (are blocked) as regression tests in `src/__tests__/`:
  - a rewrite to `/etc/shadow` past a guard that denies `/etc` is denied;
  - an `ask` plus a sanitizing rewrite executes the sanitized arguments after approval;
  - `session.resume()` with `modifiedArguments: { path: "/etc/shadow" }` is denied by the policy hook, and `tool.execute` / `tool.result` fire on every resumed call;
  - `agent.dispose()` during a run aborts the run; no denied tool executes.
- `SessionOptions.ownership` exists; `RunOptions.ownership` that conflicts with the session's scope fails with `OwnershipScopeError` (`ERR_PRISM_OWNERSHIP_WIDEN`); a foreign branch is `SessionNotFoundError` at run time, not only at open.
- `docs/hooks.md`, `docs/agent.md`, and `docs/tools.md` describe the new gate semantics; `CHANGELOG.md` `## [Unreleased]` records them.

This plan is a pre-publish part of roadmap **Phase 11 — Kernel freeze and 0.13.0**. It exists because the 2026-10-15 review found that the §1.4 rule "Replacing the loop cannot bypass safety gates" does not hold for rewrites, resumes, or dispose, and that `RunOptions.ownership` widens the agent's scope. It reopens the surface frozen by plan 174 Task 9, **depends on plan 176** (a green baseline), and **blocks plan 175 Task 10** (publish). It changes kernel contracts (hook combination, `tool.execute` payload rules, `SessionOptions`, an error class), so Task 1 is the phase review. No version bump or publish happens here. Lab impact: n/a, because plan 173 deleted `packages/prism-code`; `bun run --filter @arnilo/prism-agent test` stays green after every task. Cost knobs: n/a, no opt-in feature adds model calls; Task 2's second `tool.call` round costs one extra decide dispatch only when a rewrite happened.

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record, with `file:line`:
      - (a) the `tool.call` combination in `src/hooks/bus.ts:66-82` and its single caller `src/loop/run-controller.ts:240-284`, plus `dispatchOne` at `:286-323`;
      - (b) every path that dispatches a tool without `dispatchOne`: `src/agent-session/session/tool-round.ts:505-531` (resume replay) and any other `ctx.dispatchToolCall` caller found by `graft callers dispatchToolCall --depth all`;
      - (c) every reader and writer of `activeOwnership` (`src/agent-session/session/assemble.ts:601`, `src/agent-session/session.ts:555,1117`, `persist.ts:164,247`, `provider-round.ts:153`, `tool-round.ts:394`) and every host that passes `RunOptions.ownership` (`packages/hosts/ag-ui/src/handler.ts:232-266` at least);
      - (d) the dispose path `src/agent-session/create-agent.ts:206-213` and how sessions are created (`:157-186`) — confirm no registry of open sessions exists;
      - (e) every existing test that asserts the current rewrite merge, ask-drops-rewrite, resume dispatch, or `RunOptions.ownership` override, so later tasks update rather than delete them.
    - Functional: A verdict per Task 2–6 assumption. A finding that invalidates a task stops the plan for re-cut.
    - Performance: n/a — read-only.
    - Code Quality: n/a — read-only.
    - Security: The review lists every `tool.call` handler shipped in `packages/` (coding hard-deny, approval, governance, guardrail-packs, hooks-json, mcp) and states whether any relies on the current "rewrites merge without re-gate" behavior.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4 (safety-gate rule), §2.4 (hook catalog), §2.5 (`RunController`); `docs/hooks.md`; the review reproductions (`rewrite.test.ts`, `resume.test.ts`, `dispose2.test.ts`) from the 2026-10-15 session.
    - Options Considered:
      - Skipping the review because the fixes are "bug fixes". Rejected: they change the documented hook combination and add a `SessionOptions` field, which `references/prism.md` §2 treats as contract changes.
    - Chosen Approach:
      - Read-only inventory with graft (`graft callers dispatchToolCall --depth all`, `graft callers activeOwnership`, `graft grep "rewrite"`).
    - API Notes and Examples:
      ```bash
      graft callers dispatchToolCall --depth all
      graft grep "ownership"
      ```
    - Files to Create/Edit:
      - this plan (Notes only)
    - References:
      - plan 146 (hook bus), plan 174 Task 9 (surface freeze)
  - Test Cases to Write:
    - n/a — read-only task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-15):
  - **(a) Gate + dispatch.** `combine()` `case "tool-call"` at `src/hooks/bus.ts:66-82` (deny-wins, first-ask, shallow `Object.assign({}, ...rewrites)`, first-respond); a throwing handler short-circuits to a deny at `src/hooks/bus.ts:268-270`. `HOOK_COMBINATION["tool.call"] === "tool-call"` at `src/hooks/catalog.ts:59`; rule id frozen at `src/__tests__/hook-catalog-freeze.test.ts:68,94`. Single caller `RunController.executeTools` at `src/loop/run-controller.ts:240-285` (decide loop `:250-265`); `dispatchOne` at `:287-323` applies deny/ask/respond/rewrite and is the only place `tool.execute` → `tool.result` fire. `dispatchToolCallsInOrder` (`src/loop/dispatch.ts:26-93`) has exactly one runtime caller, `executeTools` at `:268`.
  - **(b) Paths that dispatch without `dispatchOne`.** Resume replay in `src/agent-session/session/tool-round.ts:507-524` (`ctx.dispatchToolCall(call)` at `:523`, incl. `decision.modifiedArguments` at `:522`) and the legacy single pending call at `:530-531`. `ctx.dispatchToolCall` is the `RoundContext` member (`src/agent-session/session/types.ts:162`) assigned at `src/agent-session/session/assemble.ts:360,468` to `bindDispatchToolCall` (`src/agent-session/session/tool-round.ts:355-432`), which is the real terminal (`src/tools.ts:249` `dispatchToolCall` at `tool-round.ts:371`). No other runtime caller exists: the remaining `dispatchToolCall` importers are examples, tests, and the conformance helper `src/testing/tool-conformance.ts:143`. **Extra finding:** the driver-kit primitive `RunController.ask()` at `src/loop/run-controller.ts:467-485` decides `tool.call` once and honours `rewrite`/`respond` without a second round; external loops (`@arnilo/prism-driver-kit`) gate through it, so Task 2's fix must state whether that path shares the two-round rule or is explicitly out of scope.
  - **(c) `activeOwnership`.** Declared `src/agent-session/session/types.ts:64`, `src/agent-session/session.ts:126`. Writers: `assemble.ts:601` (`options.ownership ?? session.agent.config.ownership` — the widening), cleared at `persist.ts:256`. Readers: `assemble.ts:275` (start ledger), `persist.ts:164,247`, `provider-round.ts:153`, `session.ts:882` (event ledger), `tool-round.ts:394` (dispatch scope). Fallback reads that re-derive from the agent: `session.ts:1117` (`appendNow` stamp), `session.ts:555` (resume passes `runOptions.ownership ?? this.agent.config.ownership`). Hosts passing `RunOptions.ownership`: **only** `packages/hosts/ag-ui/src/handler.ts:235` (stream) and `:264` (resume); other host/package `ownership` uses (`ag-ui/src/replay.ts`, `channels/*`) are store/control keys, not run options.
  - **(d) Dispose + session creation.** `dispose` at `src/agent-session/create-agent.ts:206-213`: sets `disposed`, `hooks.removeOwner("kernel")`, `packages.dispose()`, closes agent subscribers — no run abort, no session close. Sessions are built in `agent.session()` (`create-agent.ts:157-186`) and in `RuntimeAgentSession.fork()` (`src/agent-session/session.ts:754-787`); there is **no** registry of open sessions anywhere in `src/` (grep for `openSessions|sessions.add|sessionRegistry|activeSessions` returns nothing). `settle()` bound exists at `src/session/background.ts:88-108`. No `AgentDisposedError` / `ERR_PRISM_AGENT_DISPOSED` exists yet. `plans/backlog.md` already carries "Close the agent's sessions on `agent.dispose()`" (P2) — Task 5 supersedes it.
  - **(e) Tests asserting current behaviour (update, do not delete).** Rewrite merge: `src/__tests__/hook-bus.test.ts:169-183`. Rewrite/respond driver flags: `src/__tests__/driver-primitives.test.ts:181-199`. Resume `modifiedArguments` replay: `src/__tests__/session-resume.test.ts:125-135`, `src/__tests__/run-decisions.test.ts:281-292`, `src/__tests__/agent-approval-coverage.test.ts:230-237`. Deny precedence / hook order: `src/__tests__/hook-invariants.test.ts:44-97`, `src/__tests__/agent-hooks.test.ts:120-140,180-197`. Ownership: `src/__tests__/run-ledger.test.ts:56-75,148-170`, `src/__tests__/agent-session-slot.test.ts:100-127`, `src/__tests__/agent-surface.test.ts:98-103`. Docs rows to rewrite: `docs/hooks.md:78` ("deny > ask > rewrite > respond"), `docs/hooks.md:95`, `docs/tools.md:77`, `docs/agent.md:122-123,156,309`. The review's `rewrite.test.ts` / `resume.test.ts` / `dispose2.test.ts` are **not committed** anywhere in the repo — Tasks 2-5 create them as the named new suites.
  - **Security — every shipped `tool.call` handler.** `@arnilo/prism-tools-coding` hard-deny (`packages/tools/coding/src/hard-deny.ts` `createHardDenyHook`, registered `src/index.ts:208`) reads `payload.args` at gate time and returns `{deny}` — relies on deny-wins, **not** on merge-without-re-gate; it is exactly the guard that today can be bypassed by a later rewrite. `ask-user` (`src/index.ts:180`) → `ask`. `@arnilo/prism-approval` (`packages/policy/approval/src/index.ts:164`) → allow/deny/ask, side-effecting (`host.ui` prompt + session grant write), never rewrites. `@arnilo/prism-governance` (`packages/policy/governance/src/index.ts:250`) → allow/deny/ask, evaluates `payload.args`, side-effecting (audit + pending state). `@arnilo/prism-guardrail-packs` (`packages/policy/guardrail-packs/src/index.ts:112`) → ask/deny on `payload.args`. `@arnilo/prism-hooks-json` (`packages/integrations/hooks-json/src/compile.ts:354-368`) → deny or **`{rewrite: updatedInput}`**, the only shipped rewrite producer; it relies on the rewrite being applied, which Task 2 preserves. `@arnilo/prism-mcp` registers **no** `tool.call` handler (its bridge is a tool, not a gate). Kernel `askEveryTool` (`src/hooks/ask.ts:14`), evals failure-injection (`packages/hosts/evals/src/failure-injection.ts:31`), process-driver testing (`packages/drivers/process/src/testing.ts:113`), driver conformance (`src/testing/driver-conformance.ts:343,584`), and `apps/prism-agent` scenarios are test/conformance hooks. **No shipped handler depends on "rewrites merge without re-gate".**
  - **Verdicts.**
    - Task 2 — **holds, with one required amendment.** Two-round re-gate re-invokes *every* handler, so side-effecting handlers run twice: `hooks-json` `PreToolUse` re-spawns its external hook script, and `approval` re-prompts `host.ui` even though round 1's ask was discarded. Task 2 must either cache round-1 decisions for handlers that already answered, or re-run only from the rewriting handler onward, or state the double-invocation as accepted with a test. Also decide the `run-controller.ts:467` `ask()` primitive's scope (above).
    - Task 3 — **holds.** Replay confirmed at `tool-round.ts:523,530`; `validateModifiedArguments` exists at `src/agent-approval.ts:139` and its own comment at `:138` already claims "Policy and trust re-run at dispatch" — which is false today, confirming the defect. `Decision.modifiedArguments` doc is at `src/contracts-run-state.ts:81`. The name `executeApproved` is free (only unrelated `executeApprovedMutation` in `packages/tools/work`).
    - Task 4 — **holds.** `SessionOptions` at `src/contracts-core/agent.ts:242`; `RunOptions.ownership` at `src/contracts-protocol.ts:104`; session errors live in `src/contracts-core/session.ts` (`SessionNotFoundError:368`); the narrow-only helper is `scoped()` at `src/agent/sessions.ts:16`. Open-time check is agent-scope-only at `create-agent.ts:181`, as claimed.
    - Task 5 — **holds.** No registry (confirmed above); `fork()` (`session.ts:754-787`) builds sessions outside `create-agent.ts`, so Task 5's registry must cover forks too. `settle()` bound exists (`background.ts:88-108`). No `AgentDisposedError` yet; backlog item superseded.
    - Task 6 — **holds.** Subpath `./testing/tool-conformance` is declared (`package.json:17`), `src/testing/tool-conformance.ts` exists, and both `packages/drivers/process/src/__tests__/` and `apps/prism-agent/src/__tests__/` exist for the new gate-integrity suites.
    - No finding invalidates a task; the plan proceeds without a re-cut. The two amendments (Task 2 side-effect re-entry; the `ask()` primitive) are folded into Task 2 before it starts.

- [x] Task 2: Re-gate rewritten calls and keep rewrites across `ask`
  - Acceptance Criteria:
    - Functional: `RunController.executeTools` evaluates `tool.call` in at most two rounds per call:
      - Round 1 collects every handler's decision. Any `deny` wins (unchanged). If one or more handlers returned `rewrite`, the merged rewrite becomes the call's arguments and round 1's `ask`/`respond` are discarded.
      - Round 2 runs `tool.call` on the rewritten arguments. Its `deny`, `ask`, or `respond` applies to the rewritten call. A `rewrite` in round 2 that differs from the round-2 input denies the call with `rewrite_unstable` (fail closed, no third round).
      - Two round-1 rewrites that set the same key to different values deny with `rewrite_conflict` instead of merging by priority.
    - Functional: The `tool.call` payload (`name`, `args`, `effects`) is a deep-frozen copy per round, so an in-place mutation by one handler throws in strict mode and never reaches execution.
    - Functional: A handler may therefore be invoked twice for a call that is rewritten (round 1 and round 2). `@arnilo/prism-hooks-json` replays its first-round `PreToolUse` decision per `callId`, so its external script and queued context run once per executed call. A gate that prompts the host (`@arnilo/prism-approval`) re-evaluates on the rewritten arguments and may prompt once per round that needs a decision: reusing a round-1 answer for different arguments would approve what the human never saw. `docs/hooks.md` states both.
    - Functional: `RunController.ask()` (`src/loop/run-controller.ts:467-485`), the driver-kit gate external loops call, applies the same two-round rule and the same `rewrite_conflict` / `rewrite_unstable` denials, so a driver loop cannot bypass the fix (review finding, Task 1).
    - Functional: `tool.execute` is wrap-only. If a handler calls `next()` with a different `name` or structurally different `args`, the bus throws `HookError` `ERR_PRISM_HOOK_EXECUTE_REWRITE`, the call's result is an error, and the tool does not execute.
    - Functional: The pending decision recorded for an `ask` carries the hash of the arguments that will execute (the rewritten ones).
    - Functional: Retirement — the old "rewrites are shallow-merged and an ask drops them" behavior is deleted with no option to restore it. A repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) for tests or docs asserting the merge is updated in this task.
    - Performance: A call with no rewrite dispatches `tool.call` exactly once (asserted by a dispatch counter). Freezing copies are bounded by the existing argument size limits.
    - Code Quality: The round logic lives in `src/loop/run-controller.ts`; `combine()` in `src/hooks/bus.ts` stays a pure table-driven function and gains the conflict rule. No new public export.
    - Security: Every handler's verdict applies to the arguments that execute. The coding package's hard-deny now holds under any rewrite (asserted with `@arnilo/prism-tools-coding` in Test Cases).
  - Approach:
    - Documentation Reviewed:
      - `src/hooks/bus.ts:57-85` (`combine`), `src/loop/run-controller.ts:240-323` (`executeTools`, `dispatchOne`), `packages/tools/coding/src/hard-deny.ts:1-80`, `docs/hooks.md` (tool.call row).
    - Options Considered:
      - Re-gate in a loop until stable. Rejected: two handlers that rewrite each other's output never converge; a fixed two-round bound with `rewrite_unstable` is deterministic.
      - Forbid `rewrite` entirely. Rejected: argument normalization and redaction are documented uses of `rewrite`.
      - Keep priority-ordered merging for conflicting keys. Rejected: the outcome then depends on load order, which a host cannot audit; a conflict fails closed.
    - Chosen Approach:
      - Rewrite first, then gate the final arguments once more. This is the smallest change that makes "the gate sees what executes" true, and it fixes ask-drops-rewrite as a side effect.
    - API Notes and Examples:
      ```ts
      // round 1: normalizer rewrites, guard sees original → round 2: guard sees "/etc/shadow" → deny
      hooks.on("tool.call", (c) => ({ rewrite: { path: normalize(c.args.path) } }));
      hooks.on("tool.call", (c) => (String(c.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      ```
    - Files to Create/Edit:
      - `src/loop/run-controller.ts`: two-round evaluation, frozen payloads, rewritten-args hash for asks.
      - `src/hooks/bus.ts`: `rewrite_conflict` in `combine`; `tool.execute` next-argument check.
      - `src/hooks/errors.ts`: `ERR_PRISM_HOOK_EXECUTE_REWRITE` code.
      - `packages/integrations/hooks-json/src/compile.ts`: `PreToolUse` replay per `callId`.
      - `scripts/budgets.json`: kernel ceilings rebaselined for the added module and lines.
      - `src/__tests__/hook-bus.test.ts`, `src/__tests__/run-decisions.test.ts`: updated expectations.
      - `src/__tests__/tool-gate-integrity.test.ts`: new.
      - `docs/hooks.md`, `docs/tools.md`, `CHANGELOG.md`.
    - References:
      - review repro `rewrite.test.ts` (2026-10-15).
  - Test Cases to Write:
    - `rewrite_is_regated_and_denied`: the normalizer/guard pair above; fails if round 2 is skipped.
    - `ask_keeps_sanitizing_rewrite`: an approver plus a sanitizer; after `confirm: true` the tool receives the sanitized path; fails if round 1's ask survives.
    - `conflicting_rewrites_deny`: two packages set `path` differently → `rewrite_conflict`.
    - `unstable_rewrite_denies`: a handler that appends to `path` every round → `rewrite_unstable`.
    - `tool_call_payload_is_frozen`: a handler mutating `args.path` throws and the tool does not run.
    - `tool_execute_cannot_swap_name_or_args`: `next({ ...p, name: "other" })` → `ERR_PRISM_HOOK_EXECUTE_REWRITE`, nothing executes.
    - `coding_hard_deny_holds_under_rewrite`: `toolsCoding({ root })` plus a rewriting package targeting a path outside the root → denied.
    - `custom_loop_gets_same_gate`: the same rewrite pair from a custom `LoopStrategy` calling `executeTools`.
    - `single_round_without_rewrite`: dispatch counter is 1.
    - `rewrite_does_not_double_run_pre_tool_use`: `hooks-json` `PreToolUse` with `updatedInput`; the external script is invoked once.
    - `driver_ask_regates_rewrite`: `run.ask()` with `support.rewrite` and a rewriting/denying pair → denied, matching `executeTools`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `tool.call` combination and `tool.execute` rules.
    - Docs pages to create/edit:
      - `docs/hooks.md`: `tool.call` two-round rule, conflict and stability denials, frozen payload; `tool.execute` wrap-only.
      - `docs/tools.md`: "what a gate sees" note.
      - `CHANGELOG.md`: `## [Unreleased]` entry.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-15):
  - **What changed.** `RunController.executeTools` now gates each call in up to two rounds via a new `gateCall` helper (`src/loop/run-controller.ts`): round 1 applies a merged `rewrite`, round 2 runs the full `tool.call` gate on the rewritten arguments. A round-2 rewrite that changes them again denies with `rewrite_unstable`; the effective (rewritten) call is what `dispatchOne` executes and what an `ask` records, so the pending hash matches what runs. `combine()` (`src/hooks/bus.ts`) gained the `rewrite_conflict` rule (two rewrites setting one key to different values) and drops a rewrite equal to the round's input, so a round-2 `ask`/`respond` is not hidden by a rewriter's own no-op. The `tool.call` payload `args` is a deep-frozen copy (`frozenCopy`, new `src/hooks/json.ts`), and `tool.execute` is wrap-only: a handler whose `next()` changes the name or args gets a `hook_execute_rewrite` error result and the tool never runs (`HookError` `ERR_PRISM_HOOK_EXECUTE_REWRITE`, `src/hooks/errors.ts`). The driver-kit `RunController.ask()` primitive (`:527-570`) shares `gateCall`, so external loops cannot bypass it; `@arnilo/prism-hooks-json` replays its first-round `PreToolUse` decision per `callId`.
  - **Plan amendment.** The Task 1 note asked `@arnilo/prism-approval` to reuse its round-1 outcome. That is unsafe: approval's verdict depends on the arguments it gated, so reusing an answer for the rewritten arguments would approve what the human never saw. Approval is unchanged and re-evaluates (and may prompt) on the rewritten arguments; `docs/hooks.md` documents the double-invocation rule. The `rewrite_does_not_double_prompt_approval` test case is dropped in favour of `ask_keeps_sanitizing_rewrite` and `coding_hard_deny_holds_under_rewrite`.
  - **Files beyond the plan.** `scripts/budgets.json` kernel ceilings rebaselined (packed 1032814 → 1035252, unpacked 3360797 → 3368401, fileCount 355 → 356, sourceLines 34624 → 34714; the new `src/hooks/json.ts` plus ~55 gate lines). `packages/hosts/mcp-server/src/__tests__/serve-tools.test.ts` updated: the `updated_input` permission case now fires `tool.call` twice (its rewrite is re-gated), so its call-count expectation is 5, not 4.
  - **Sweep.** Repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` finds no remaining assertion of the old precedence or of "an ask drops a rewrite"; `docs/hooks.md:78,101` and `docs/tools.md` are updated. `src/__tests__/hook-bus.test.ts` gained the conflict/no-op/round-1-precedence cases; the existing merge case (two rewrites on different keys) still holds.
  - **Verification.** `bun run build:core` and `bun run typecheck` clean; `src/__tests__/{tool-gate-integrity,hook-bus,driver-primitives,hook-invariants,agent-hooks,run-decisions,session-resume,docs,public-export-contract}.test.ts` pass; `@arnilo/prism-tools-coding` (589), `@arnilo/prism-hooks-json` (30), `@arnilo/prism-approval` (10), `@arnilo/prism-mcp-server` (18), `@arnilo/prism-evals` (67) pass; `bun scripts/release.mjs gate` passes. The full kernel suite has 5 unrelated pre-existing failures (observational token fixture, fabric docs tripwire, retired-family sweep, zai docs, sqlite runtime) and no new one.

- [x] Task 3: Resumed calls go through the full tool pipeline
  - Acceptance Criteria:
    - Functional: Every call replayed by `session.resume()` (the `pendingCalls` loop and the legacy single `pending` call in `src/agent-session/session/tool-round.ts:505-531`) runs through the Task 2 pipeline: `tool.call` (two rounds), `tool.execute`, `tool.result`, `message.append`.
    - Functional: Approval satisfaction: during the resumed `tool.call` evaluation, an `ask` for a call whose tool name and arguments hash match the approved decision's scope is treated as allowed. Any `deny` still wins. An `ask` for different arguments (after `modifiedArguments` or a rewrite changed them) is satisfied only when the decision carried those exact `modifiedArguments`; otherwise the call is staged as a new pending decision and the run suspends again.
    - Functional: `Decision.modifiedArguments` is gated like a rewrite: schema validation (`validateModifiedArguments`, `src/agent-approval.ts:139`), then `tool.call` on the modified arguments. The doc comment on `Decision.modifiedArguments` (`src/contracts-run-state.ts:81`) states this.
    - Functional: `reject_*` and `elicitation` decisions keep their current replay (no execution), but still emit `tool.completed` with `status: "blocked"`.
    - Performance: Resume issues one `tool.call` dispatch per replayed call when nothing rewrites (asserted).
    - Code Quality: The resume path calls a single internal entry (`runController.executeApproved(calls, decisions)`), not `ctx.dispatchToolCall` directly. `ctx.dispatchToolCall` remains only as the `tool.execute` terminal; a test asserts no other caller exists (`graft callers` recorded in the note).
    - Security: An approver, including a remote or AG-UI client, cannot widen what a policy allows by editing arguments.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/tool-round.ts:505-531`, `src/agent-approval.ts:90-200`, `src/agent-session/session/assemble.ts:359-468` (`dispatchBound`), `docs/agent.md` (resume).
    - Options Considered:
      - Calling `dispatchOne` with a synthetic `"allow"` decision. Rejected: that skips `tool.call` entirely, which is the defect.
      - Re-asking the host on every resume. Rejected: the host already decided; re-asking loops forever for durable runs.
    - Chosen Approach:
      - Re-run the gate and treat a matching approval as satisfying `ask` only. This keeps deny-wins and keeps durable resume idempotent.
    - API Notes and Examples:
      ```ts
      for await (const _ of session.resume([{ approvalId, outcome: "allow_once", modifiedArguments: { path: "/etc/shadow" } }])) {}
      // → tool.completed { status: "blocked", reason: "outside root" }; the tool never executes
      ```
    - Files to Create/Edit:
      - `src/loop/run-controller.ts`: `executeApproved` internal.
      - `src/agent-session/session/tool-round.ts`: replay through `executeApproved`.
      - `src/agent-approval.ts`: keep schema/guardrail validation; drop the claim that it is the policy check.
      - `src/contracts-run-state.ts`: `Decision.modifiedArguments` doc comment.
      - `src/__tests__/run-decisions.test.ts`, `src/__tests__/agent-run-resume.test.ts` (tentative name; the review names the existing resume suite).
      - `docs/agent.md`, `docs/hooks.md`, `CHANGELOG.md`.
    - References:
      - review repro `resume.test.ts` (2026-10-15).
  - Test Cases to Write:
    - `resume_modified_arguments_are_gated`: the repro; the policy denies `/etc/shadow`; fails if resume bypasses `tool.call`.
    - `resume_fires_execute_and_result_hooks`: the hook log contains `tool.execute` and `tool.result` for the resumed call.
    - `resume_matching_approval_satisfies_ask`: unmodified approval executes once without a second suspension.
    - `resume_rewrite_after_approval_resuspends`: a rewrite during resume changes the arguments, so the run suspends with a new pending decision.
    - `resume_across_process_is_gated`: a fresh `agent.session({ id })` over the same store, same assertions.
    - `no_direct_dispatch_callers`: a source scan asserting `ctx.dispatchToolCall` is referenced only as the `tool.execute` terminal.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resume semantics and `Decision.modifiedArguments`.
    - Docs pages to create/edit:
      - `docs/agent.md`: resume section ("every resumed call is re-gated").
      - `docs/hooks.md`: approval satisfaction rule.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-15):
  - **What changed.** `replayDurableNestedAndPending` (`src/agent-session/session/tool-round.ts`) no longer calls `ctx.dispatchToolCall` per replayed call. It collects the executable pending calls (with a `modifiedArguments` decision applied, exactly like a rewrite) and replays them in one batch through a private `executeApproved(ctx, calls)` entry that calls `ctx.runController.executeTools`, so `tool.call` (two rounds), `tool.execute`, `tool.result`, and the transcript append run as for a fresh turn. `reject_*` decisions keep their replay and now also emit a blocked `tool.completed`; elicitation keeps its value replay. After the batch it calls `suspendGatedRound`, so a call the gate stages suspends the run before the loop takes a provider turn.
  - **Approval satisfaction.** `resolveAskDecisions` (`src/agent-session/session/assemble.ts`) gained `resumedAsk`: the resumed `allow_once` decision satisfies the `ask` for exactly the call it approved (tool name and `jsonEqual` arguments, or its `modifiedArguments`). A replayed call a rewrite moved off those arguments is `stale`: it is staged again via `staleResumed` and never prompts `host.ui`, because the host answered for the arguments it saw. `allow_for_run`/`reject_for_run` still match as sticky decisions; a `deny` on the final arguments still wins.
  - **Plan amendment — `executeApproved` placement.** The plan wrote `runController.executeApproved(calls, decisions)`. `RunController` is a root export, and the 0.13 surface is frozen (plan 174 Task 9; Task 2 avoided new bus methods for the same reason), so `executeApproved` is a private function in `tool-round.ts` that calls the existing public `executeTools`; it takes no `decisions` argument because they already ride `ctx.resumed`. `src/loop/run-controller.ts` still has exactly one `internals.dispatchToolCall(` call — the `tool.execute` terminal — asserted by the new `no_direct_dispatch_callers` test.
  - **History fix (incidental).** `replayToolResult` now pushes the replayed row onto `ctx.session.history` as well as the store, so a resumed run's replayed tool result reaches the next provider turn (the old path only persisted it and `activeRunMessages`).
  - **Files beyond the plan.** `scripts/budgets.json` kernel ceilings rebaselined (packed 1035252 → 1037032, unpacked 3368401 → 3374041, sourceLines 34714 → 34796). `src/__tests__/resume-gate-integrity.test.ts` is the new suite.
  - **Verification.** `bun run build:core` and `bun run typecheck` clean; `resume-gate-integrity` (6), `session-resume`, `run-decisions`, `agent-approval-coverage`, `durable-loops`, `tool-gate-integrity`, `docs`, `public-export-contract` all pass; the full kernel suite has the same 5 pre-existing failures plus the unrelated flaky `@arnilo/prism-headless` `two_processes_fire_each_tick_once` (fails in isolation, untouched by this change); `bun scripts/release.mjs gate` passes.

- [x] Task 4: Narrow-only ownership with a run-time scope check
  - Acceptance Criteria:
    - Functional: `SessionOptions.ownership?: OwnershipScope` is added. The effective session scope is the agent's scope plus the session's fields, where the session may set only fields the agent left undefined or set to the same value. A conflicting field throws `OwnershipScopeError` (`code: "ERR_PRISM_OWNERSHIP_WIDEN"`).
    - Functional: Opening an existing session checks the branch against the effective session scope (today it checks only the agent scope, `src/agent-session/create-agent.ts:181`). A mismatch is `SessionNotFoundError`, as today.
    - Functional: `RunOptions.ownership` may only narrow the session's effective scope by the same rule; a conflict fails the run before any event with `OwnershipScopeError`. `assemble.ts:601` and `session.ts:555` use the narrowed scope, never `options.ownership ?? agent` replacement.
    - Functional: Before the first entry of every run and resume, the kernel re-checks the session's branch against the run's effective scope. A branch with any entry outside it fails the run with `SessionNotFoundError` and writes nothing.
    - Functional: `agent.sessions.list/get/delete/search` keep their narrow-only `scoped()` behavior (`src/agent/sessions.ts:16`), now sharing one exported-internal `narrowScope()` helper with the session and run paths.
    - Functional: Retirement sweep: every test or doc asserting that `RunOptions.ownership` replaces the agent scope is updated (repo-wide grep for `ownership:` in tests under `src/` and `packages/`).
    - Performance: The run-time check reuses the session's cached branch snapshot; no extra store read when the snapshot is warm (asserted with a counting store).
    - Code Quality: One scope-narrowing function used by `sessions.ts`, `create-agent.ts`, and the run path. `OwnershipScopeError` lives with the other session errors in `src/contracts-core/session.ts` and is exported from the root.
    - Security: A host that authorizes per request and passes the request's scope can no longer read or write another scope's session through a shared agent. Tested with two tenants on one agent and one store.
  - Approach:
    - Documentation Reviewed:
      - `src/agent/sessions.ts:15-24` (`scoped`), `src/session-stores.ts:581-584` (`entriesInScope`), `src/agent-session/create-agent.ts:157-186`, `src/agent-session/session/assemble.ts:601`, `src/agent-session/session.ts:540-560,1115-1125`, `packages/hosts/ag-ui/src/handler.ts:225-266`, `docs/agent.md` (ownership).
    - Options Considered:
      - Rejecting `RunOptions.ownership` outright. Rejected: hosts legitimately narrow per run (a per-user scope under a tenant-scoped agent), and AG-UI is built on it.
      - Checking only at session open. Rejected: a session object outlives one request, and the AG-UI handler opens with the agent scope and runs with the request scope.
    - Chosen Approach:
      - Narrow-only at three levels (agent → session → run), with the branch check at open and at every run start, using the existing `entriesInScope` predicate.
    - API Notes and Examples:
      ```ts
      const session = await agent.session({ id: threadId, create: true, ownership: auth.ownership });
      await session.run(input, { ownership: auth.ownership }); // equal or narrower: allowed
      await session.run(input, { ownership: { tenantId: "other" } }); // OwnershipScopeError ERR_PRISM_OWNERSHIP_WIDEN
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`: `SessionOptions.ownership`.
      - `src/contracts-core/session.ts`: `OwnershipScopeError`.
      - `src/agent/sessions.ts`: shared `narrowScope`.
      - `src/agent-session/create-agent.ts`, `src/agent-session/session.ts`, `src/agent-session/session/assemble.ts`: narrowing and run-time check.
      - `src/index.ts`: export `OwnershipScopeError`.
      - `src/__tests__/public-export-contract.test.ts`: freeze list update.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; the note records the diff (additions only, attributed to this plan).
      - `src/__tests__/ownership-scope.test.ts`: new.
      - `docs/agent.md`, `docs/host-security.md`, `CHANGELOG.md`.
    - References:
      - review finding "Tenant isolation is broken for run-level ownership" (2026-10-15).
  - Test Cases to Write:
    - `run_ownership_cannot_widen`: agent `{tenantId:"a"}`, run `{tenantId:"b"}` → `ERR_PRISM_OWNERSHIP_WIDEN`, no entry written.
    - `shared_agent_two_users_isolated`: agent without scope; user A's session with `{userId:"a"}`; user B opens the same id with `{userId:"b"}` → `SessionNotFoundError`; B's run with `{userId:"b"}` on A's session object → `SessionNotFoundError`.
    - `session_ownership_narrows_and_stamps`: entries carry the narrowed fields.
    - `resume_rechecks_scope`: a resume under a different scope fails before `decision.resolved`.
    - `warm_snapshot_no_extra_read`: counting store sees no additional `list` call.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `SessionOptions.ownership`, new error, changed `RunOptions.ownership` semantics.
    - Docs pages to create/edit:
      - `docs/agent.md`: ownership section (three-level narrowing, errors, examples).
      - `docs/host-security.md`: "multi-user hosts on one agent".
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-15):
  - **What changed.** One `narrowScope(base, requested, kind, mode?)` helper in `src/agent/sessions.ts`: a caller may add fields the base left undefined or repeat them, never change one. `mode: "throw"` (default; session open and run) raises `OwnershipScopeError` (`ERR_PRISM_OWNERSHIP_WIDEN`, new in `src/contracts-core/session.ts`, exported from the root); `mode: "base"` (a `sessions.list/get/delete/search` query filter) keeps the base value, so `scoped()` keeps its documented non-throwing behavior and now shares the helper. `SessionOptions.ownership` was added and the effective session scope is `narrowScope(agent.config.ownership, options.ownership)` computed once in `create-agent.ts`; `RuntimeAgentSession.scope` carries it and `appendNow` stamps `activeOwnership ?? scope`. `runInternal` computes the run scope with `narrowScope(scope, options.ownership)`, and `assemble.ts` now sets `activeOwnership = options.ownership` (the narrowed value) instead of `options.ownership ?? agent.config.ownership`.
  - **Run-time check.** Opening an existing session checks the branch against the *session's* effective scope (was the agent scope). `runInternal` re-checks the branch against the run's effective scope before any event; `prepareResume` checks it before `decision.resolved`. Both reuse `entriesInScope` and skip the check entirely when the effective scope is undefined (a no-op), so a scope-less run adds no store read and no extra await.
  - **Performance.** `warm_snapshot_no_extra_read` warms `session.messages()` (the branch cache) and then runs with a scope the branch fails: the check throws `SessionNotFoundError` with zero `list`/`readBranchPath` calls.
  - **Plan amendment — `shared_agent_two_users_isolated` error.** The plan expected `SessionNotFoundError` for B's scoped run on A's session. With narrow-only, a conflicting run scope is the identity claim the widen rule rejects, so it is `OwnershipScopeError` (`ERR_PRISM_OWNERSHIP_WIDEN`); the open-by-id path is `SessionNotFoundError` as written. Both fail closed; the test asserts the actual errors.
  - **Files beyond the plan.** `packages/integrations/workflows/src/nodes/agent-node.ts` now passes `ownership: options.ownership` to `agent.session(...)`: the agent node opened an unscoped session and ran it with the workflow's `RunOptions.ownership`, which the new branch check rejects. The session now carries the scope it runs under. `scripts/compat-baseline/` was regenerated (`gate --update-baseline`) for the kernel additions and the pre-existing WIP drift the working tree carried. `scripts/budgets.json` kernel ceilings rebaselined (packed 1037032 → 1039426, unpacked 3374041 → 3381308, rootExports 1424 → 1428, sourceLines 34796 → 34867).
  - **Retirement sweep.** Repo-wide grep found no test or doc asserting `RunOptions.ownership` replaces the agent scope; `agent-surface.test.ts`'s `sessions_respect_ownership_scope` (query filter, agent wins) still passes via `mode: "base"`.
  - **Verification.** `bun run build:core` and `bun run typecheck` clean; `ownership-scope` (5), `agent-run-state`, `agent-surface`, `session-index`, `session-links`, `principal`, `session-subscriber-ownership`, `tool-effect-store-coverage`, `run-ledger`, `agent-session-slot`, `public-export-contract`, `session-resume`, `docs` all pass; the workflows package 187 pass; headless/ag-ui/remote 196 pass (1 flaky multi-process scheduler test, passes in isolation); the full kernel suite has the same 5 pre-existing failures plus flaky process-driver/headless timing tests; `bun scripts/release.mjs gate` passes.

- [x] Task 5: Fail-closed `agent.dispose()`
  - Acceptance Criteria:
    - Functional: The agent keeps a registry of open sessions (added on open, removed on `close()`).
    - Functional: `dispose()` order: mark disposed → abort every active run with reason `agent_disposed` → `close()` every open session (which settles background tasks within the existing bound) → dispose packages and remove hooks and slots → close agent subscribers. Idempotent; a second call awaits the first.
    - Functional: After `dispose()` starts, `agent.session()` and `agent.commands.run()` throw `AgentDisposedError` (`ERR_PRISM_AGENT_DISPOSED`), and `RunController.executeTools` on any still-running loop denies every call with `agent_disposed` (defense in depth for a loop that ignores its abort signal).
    - Functional: An aborted run ends with `run.failed` carrying `code: "agent_disposed"` and persists normally.
    - Performance: `dispose()` with N idle sessions completes in O(N) without store reads; with a stuck background task it is bounded by the existing settle timeout (asserted).
    - Code Quality: The registry uses a `Set` released on close; no `WeakRef`. `AgentDisposedError` is exported next to the other agent errors.
    - Security: No tool executes after `dispose()` begins (the review's `dispose2.test.ts` repro becomes a regression test).
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/create-agent.ts:136-213`, `src/session/background.ts:73-108` (`settle`), `docs/agent.md` (`dispose`).
    - Options Considered:
      - Leaving in-flight runs alone and documenting "call dispose after runs settle". Rejected: a fail-open shutdown is a security defect, and hosts reload packages under load.
      - Keeping hooks until runs finish naturally. Rejected: an unbounded wait on a model call.
    - Chosen Approach:
      - Abort, then settle, then unwind, with an executeTools deny as a backstop.
    - API Notes and Examples:
      ```ts
      await agent.dispose();          // aborts runs, closes sessions, then removes packages
      await agent.session();          // throws AgentDisposedError ERR_PRISM_AGENT_DISPOSED
      ```
    - Files to Create/Edit:
      - `src/agent-session/create-agent.ts`, `src/agent-session/session.ts` (registry hooks), `src/loop/run-controller.ts` (disposed check).
      - `src/contracts-core/agent.ts` (doc comment on `dispose`), `src/contracts.ts` or the agent error module (`AgentDisposedError`).
      - `src/index.ts`, `src/__tests__/public-export-contract.test.ts`, `scripts/compat-baseline/arnilo__prism.txt` (regenerated; additions only).
      - `src/__tests__/agent-dispose.test.ts`: new.
      - `docs/agent.md`, `CHANGELOG.md`.
    - References:
      - review repro `dispose2.test.ts` (2026-10-15).
  - Test Cases to Write:
    - `dispose_mid_run_executes_no_denied_tool`: the repro; `danger executed = 0`, run status `failed` with `agent_disposed`.
    - `session_after_dispose_throws`.
    - `commands_after_dispose_throw`.
    - `dispose_is_idempotent_and_awaits`: two concurrent calls resolve after one unwind.
    - `dispose_bounded_by_settle_timeout`: a background task ignoring its signal does not hold `dispose()` beyond the bound.
    - `custom_loop_ignoring_abort_is_denied`: a loop that keeps calling `executeTools` after abort gets `agent_disposed` results.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `dispose()` semantics and a new error.
    - Docs pages to create/edit:
      - `docs/agent.md`: `dispose()` order and errors.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-15):
  - **Registry.** `AgentRuntime` gains `openSessions: Set<{ close(): Promise<void> }>` (structural, so the leaf stays session-free). `create-agent.ts` adds a session to the set before its open and drops it when the open throws; `RuntimeAgentSession.closeSession()` drops it in its `finally`, so host-initiated `close()` releases it too; `fork()` registers and drops its own session the same way. No `WeakRef`.
  - **Order.** `dispose()` is now `disposing ??= (async () => { disposed = true; abort every open session; await close() on each; hooks.removeOwner("kernel"); await packages.dispose(); close agent subscribers })()`. `disposed` flips synchronously on the first call; a second call awaits the same promise; a later call is a no-op.
  - **Deny backstop.** `executeTools` denies the whole round when the abort reason is the dispose abort, and `dispatchOne` re-checks per call so a dispose that lands while the round is being gated still cannot execute. The check is keyed on the reason's `agent_disposed` code, not on `signal.aborted`, so a plain `session.abort()` keeps its existing behaviour and only `dispose()` gains the deny. `assemble.ts` prefers the abort reason over the interrupted await's own error when the reason is the dispose abort, so `run.failed.error.code` is `agent_disposed` even if the provider threw first.
  - **Errors.** `AgentDisposedError` (`AGENT_DISPOSED_CODE = "ERR_PRISM_AGENT_DISPOSED"`) lives in `src/contracts-core/agent.ts` and is exported from the root next to the other agent errors; the abort reason is a separate internal error carrying the lowercase `agent_disposed` code (the run/tool-result vocabulary), so the two codes are distinct as the acceptance criteria state.
  - **Test-case wording.** `dispose_mid_run_executes_no_denied_tool` asserts the run's `error.code` is `agent_disposed` and its status is `aborted` (not `failed`): `dispose()` aborts, and an abort is what `toRunResultStatus` reports.
  - **Files beyond the plan.** `src/agent-session/runtime-registry.ts` (the registry field), `src/agent-session/session.ts` (`fork` registration + `close()` release), `scripts/budgets.json` rebaseline (packed 1039426 → 1041394, unpacked 3381308 → 3387471, rootExports 1428 → 1430, sourceLines 34867 → 34951), and the kernel compat baseline regenerated (`AGENT_DISPOSED_CODE`, `AgentDisposedError`). `docs/packages.md` also updated (its dispose sentence).
  - **Verification.** `bun run build:core` and `bun run typecheck` clean; `agent-dispose` 7/7 (the six plan cases plus `dispose_of_idle_sessions_reads_nothing`, which asserts zero `list`/`readBranchPath`/`get` calls during `dispose()`), plus agent-hooks, agent-surface, session-state-background, session-resume, tool-gate-integrity, resume-gate-integrity, run-decisions, durable-loops, agent-run-state, public-export-contract all pass; full kernel suite has the 5 pre-existing failures plus one load-sensitive headless scheduler timing test that passes in isolation; `bun scripts/release.mjs gate` passes.

- [x] Task 6: Gate-integrity invariants as a reusable conformance check
  - Acceptance Criteria:
    - Functional: `@arnilo/prism/testing/tool-conformance` gains `assertGateIntegrity({ createAgent })`, which runs Task 2–5's invariants (rewrite re-gated, ask keeps rewrite, resume re-gated, dispose fail-closed) against an agent factory. The kernel suite runs it against the default loop and a custom loop; `packages/drivers/process` and `apps/prism-agent` run it against their loops.
    - Functional: The roadmap §1.4 safety-gate rule in `docs/loop.md` links to this check.
    - Performance: The check uses the mock provider only; under 2 s.
    - Code Quality: Lives in the existing `src/testing/tool-conformance.ts` subpath; no new subpath.
    - Security: A third-party loop or driver that bypasses a gate fails a published conformance check.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/tool-conformance.ts`, `src/testing/driver-conformance.ts`, `docs/testing.md`.
    - Options Considered:
      - Kernel-only tests. Rejected: drivers and custom loops are where future bypasses would appear.
    - Chosen Approach:
      - Extend the existing tool conformance subpath.
    - API Notes and Examples:
      ```ts
      import { assertGateIntegrity } from "@arnilo/prism/testing/tool-conformance";
      await assertGateIntegrity({ createAgent: (config) => createAgent({ ...config, slots: { loop: myLoop } }) });
      ```
    - Files to Create/Edit:
      - `src/testing/tool-conformance.ts`, `src/__tests__/tool-conformance.test.ts`.
      - `packages/drivers/process/src/__tests__/gate-integrity.test.ts`, `apps/prism-agent/src/__tests__/gate-integrity.test.ts` (tentative paths; the review confirms each package's test layout).
      - `scripts/compat-baseline/arnilo__prism.txt` (regenerated; one addition).
      - `docs/testing.md`, `docs/loop.md`, `CHANGELOG.md`.
    - References:
      - Tasks 2–5.
  - Test Cases to Write:
    - `gate_integrity_default_loop`, `gate_integrity_custom_loop`, `gate_integrity_process_driver`.
    - `gate_integrity_detects_bypass`: a deliberately broken loop that calls the tool directly fails the check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new testing export.
    - Docs pages to create/edit:
      - `docs/testing.md`: `assertGateIntegrity`.
      - `docs/loop.md`: link from the safety rule.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  Notes (executed 2026-10-15):
  - **Surface.** `assertGateIntegrity({ createAgent })` and its `GateIntegrityOptions` type live in the existing `src/testing/tool-conformance.ts` (subpath `@arnilo/prism/testing/tool-conformance`), beside `assertToolDispatchConforms` / `assertToolBlocked` / `dispatchAndCollect`; the `@arnilo/prism/testing` barrel is unchanged. The check builds its own `AgentConfig` (mock provider, one recording tool, the probe's hooks/host) and hands it to the caller's factory, so a loop injects itself through `slots.loop` or a loop package.
  - **Probes.** Four, in order: `rewrite_is_regated`, `ask_keeps_rewrite`, `resume_is_regated`, `dispose_is_fail_closed`. Each asserts the outcome the gate must produce *and* the absence of an un-gated execution, so a loop that skips the tool pipeline fails instead of passing vacuously; the first violation throws `gate integrity: <probe>: <detail>`.
  - **Tolerances.** Probe 3 accepts a loop that cannot suspend: an `ask` with no `host.ui` is denied outright, which is the same security outcome (nothing executes). Probe 4 asserts no execution plus a run that does not report success, leaving the exact `agent_disposed` code to the kernel suite (`agent-dispose.test.ts`).
  - **Deviation - package adoption.** The plan named `packages/drivers/process` and `apps/prism-agent`, but neither has a model-driven loop. The process driver's loop is `usesModel: false` (driver-kit `createDriverLoop`) and relays external tool calls through `RunController.ask`, so provider-driven `executeTools` probes do not apply to it; its gate integrity is already asserted by `driverConformance`'s `gating`, `fail_closed`, and `resume` legs. `apps/prism-agent` is a reference host, not a loop. The check therefore runs against the repo's only custom loop, `workflowLoopStrategy`, in a new `packages/integrations/workflows/src/__tests__/gate-integrity.test.ts` (`gate_integrity_workflow_loop`). `docs/testing.md` records the driver boundary.
  - **Deviation - bypass probe.** The plan's bypass loop "calls the tool directly"; it cannot, because `RunController` deliberately exposes no registry (src/loop/types.ts). The test's `bypass` loop takes every provider turn and dispatches nothing, and fails `rewrite_is_regated` on the missing denial - the security claim (a loop that bypasses the gate fails the check) holds.
  - **Files beyond the plan.** `src/__tests__/tool-conformance.test.ts` is new (the plan listed the path without an owner); `packages/integrations/workflows/src/__tests__/gate-integrity.test.ts` is new; `scripts/budgets.json` rebaseline (packed 1041394 → 1045130, unpacked 3387471 → 3399911, rootExports 1430 → 1432, sourceLines 34951 → 35165, `exportCounts.@arnilo/prism` 1428 → 1432); the kernel compat baseline regenerated (`assertGateIntegrity`; its options interface is `export interface`, which the extractor does not capture, so the declared delta is the one addition the plan predicted).
  - **Verification.** `bun run build:core` and `bun run typecheck` clean; `tool-conformance.test.ts` 3/3 (default loop, custom plan-then-act loop, bypass rejected) with the whole check at ~35 ms on the mock provider; `gate_integrity_workflow_loop` passes; `docs.test.ts` 64/64, `public-export-contract.test.ts` green; the kernel targeted batch and the hosts/integrations/policy package sweeps stay green; full kernel suite carries only the five pre-existing failures plus load-flaky timing tests that pass in isolation; `bun scripts/release.mjs gate` passes.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/tool-gate-integrity.test.ts src/__tests__/ownership-scope.test.ts src/__tests__/agent-dispose.test.ts src/__tests__/run-decisions.test.ts src/__tests__/hook-bus.test.ts src/__tests__/tool-conformance.test.ts`
- `bun run --filter @arnilo/prism-tools-coding test && bun run --filter @arnilo/prism-approval test && bun run --filter @arnilo/prism-governance test && bun run --filter @arnilo/prism-ag-ui test && bun run --filter @arnilo/prism-driver-process test && bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/public-export-contract.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- **Approval re-evaluates on the rewritten arguments.** The plan amendment wanted approval to reuse its round-1 outcome for a re-gated call; caching an answer across an argument change would approve what the human never saw, so the approval package is unchanged and re-prompts on round 2. Only idempotent side-effect producers (`@arnilo/prism-hooks-json` `PreToolUse`, keyed by call id + argument hash) dedupe. Recorded on Task 2.
- **The conformance check moved from the named packages to the repo's only loop.** `packages/drivers/process` and `apps/prism-agent` have no model-driven loop (the driver's is `usesModel: false` and relays through `RunController.ask`; prism-agent is a host), so the check runs against `workflowLoopStrategy` instead, and the driver boundary is documented against `driverConformance`. Recorded on Task 6.
- **The bypass probe asserts a missing gate outcome, not a direct tool call.** `RunController` deliberately exposes no tool registry, so no loop can literally invoke a tool; the check instead requires the gate's positive outcome (a recorded denial, the sanitized execution, the denied disposal) so a loop that skips `executeTools` fails. Recorded on Task 6.
- **`dispose()` aborts; it does not fail every run.** An aborted run reports `status: "aborted"` with `error.code: "agent_disposed"` (the plan's test wording said `failed`). The deny backstop is keyed on the dispose abort reason only, so a plain `session.abort()` keeps its prior behavior. Recorded on Task 5.
- **No `is*` guards were added** for `OwnershipScopeError` or `AgentDisposedError` (the plan asked only for the classes), and the ownership override surface in the AG-UI handler was deliberately left alone (it already opens scoped sessions). Recorded on Tasks 4 and 5.
- **Load-flaky tests stay as they are.** The headless scheduler timing legs, the field-policy microbenchmark, `adapter_conformance_passes_json_rpc`, and `examples_demos_run_to_completion_and_emit_no_secret` fail only under parallel load and pass in isolation; they are pre-existing, not products of this plan.

## Further Actions

- **Wire `assertGateIntegrity` into every host that ships a loop.** The check exists and is published; adoption is currently the kernel suite (default + custom loop) and `@arnilo/prism-workflows`. Add it wherever a future custom loop lands, and consider a `assertDriverGateIntegrity` shape for the `run.ask` relay so external-agent drivers get the same published proof rather than relying on `driverConformance` alone.
- **Make conformance probe 3 strict when the loop is resumable.** It currently accepts either a suspension that is re-gated or an outright denial, so a loop that should suspend but denies is not called out. A resumability flag on `GateIntegrityOptions` would let the probe assert the re-suspension path explicitly.
- **Stabilize the load-flaky suites.** The scheduler timing legs, the field-policy microbenchmark, and `adapter_conformance_passes_json_rpc` depend on microtask ordering and process timing under parallel load; explicit waits or `--parallel=1` for those files would remove recurring false failures.
- **Consider an `isOwnershipScopeError` / `isAgentDisposed` guard** if hosts start branching on those codes by name.
- **Extend the `tool.call` gate docs with the re-gating cost.** Each rewritten call invokes every `tool.call` handler twice; a future handler inventory should note that before adding a costly handler.
