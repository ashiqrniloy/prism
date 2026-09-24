# ACP Durable-Write Trigger Follow-Ups: Resolved Lease TTL, Handler Completion, Close Semantics

Recorded from `plans/116-Acp-Durable-Cancel-Vs-Client-Disconnect.md` Further Actions after that plan's
single task landed (2026-09-23). All three items are homed here one-to-one — each task names its source
item — so no trigger from plan 116 is left as folklore. Two tasks are trigger-gated re-probes (resolved
lease TTL, SDK handler completion); one answers a contract question with a runnable probe and a docs
clause. When a task here closes as a no-op, its probe transcript and the next trigger are appended to
`docs/_evidence/phase116-acp-cancel-disconnect.md` (new §7–§9), so the next owner inherits a measurement
instead of a wish.

Plan 116's Further Actions point at this plan's tasks; nothing else dangles behind 116 (its single task
is complete, and its evidence file is the append target here).

## Objectives

- Every trigger plan 116 recorded has an owner, a probe command, and a defined close: the fix it names,
  or a dated no-op transcript naming the next trigger.
- The durable-write bound has one source of truth when the trigger fires: the cancel-lease TTL is
  resolved and clamped once, shared by `createAcpRunRecovery` and the `session/cancel` call site, with
  no public export and no new option.
- The agent-level bounded-write test lands only if the pinned SDK exposes a way to await in-flight
  notification handlers; otherwise the probe names the upstream surface to watch at the next pin bump.
- `session/close`'s interaction with an in-flight durable write is a stated contract, not folklore:
  the probe confirms or contradicts today's behavior, and `docs/acp.md` says which.

## Expected Outcome

- Either `packages/ag-ui/src/acp/agent/core.ts`'s cancel handler and `recovery.ts` share one internal
  resolved TTL (constants plus clamp in a module not reachable from `@arnilo/prism-ag-ui/acp`), with the
  duplicated `30_000` and the `ponytail:` ceiling comment deleted, or
  `docs/_evidence/phase116-acp-cancel-disconnect.md` §7 gains a dated no-op naming the host trigger and
  the next boundary. `scripts/compat-baseline/arnilo__prism-ag-ui.txt` and the `/acp` export list are
  byte-identical either way.
- Either `packages/ag-ui/src/__tests__/acp-recovery.test.ts` gains an agent-level hung-store case driven
  by an SDK handler-completion seam, or §8 records the probe (`registerAppNotification` /
  `processIncomingMessage` / `Connection.closed` on the pinned SDK), the verdict, and the trigger (the
  next SDK pin bump plus the upstream surface to watch).
- `docs/acp.md`'s active-run recovery bullet (or the `session/close` bullet) states whether
  `session/close` aborts an in-flight durable write, with the probe transcript in §9.
- Plan 116's Further Actions name this plan's tasks, and `plans/README.md` lists this plan and marks 116
  complete.

## Tasks

- [x] Task 1: Resolve the cancel-lease TTL once and reuse it for the durable-write bound (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 116 Further Action 1): probe first and record the transcript with the date
      in `docs/_evidence/phase116-acp-cancel-disconnect.md` §7 — a repo-wide
      `grep -rn "leaseTtlMs" packages/*/src docs examples scripts` for any host configuring the ACP
      `recovery.leaseTtlMs`, plus a read of `packages/ag-ui/src/acp/agent/recovery.ts` (the two constants
      and the clamp) and `packages/ag-ui/src/acp/agent/core.ts`'s cancel call site. State the highest
      configured value found; today the option is unset by every in-repo host seam.
    - Functional: if no host can exceed the hard cap (no in-repo host configures the option at all), the
      task closes as a recorded no-op: the probe, the verdict, and
      `Trigger: a host configures recovery.leaseTtlMs > 300_000` are **appended** to §7; no code change.
    - Functional: if the trigger fires, one internal seam lands: `DEFAULT_CANCEL_LEASE_TTL_MS` (`30_000`),
      `HARD_CANCEL_LEASE_TTL_MS` (`300_000`), and the clamp move into a new module under
      `packages/ag-ui/src/acp/agent/` that `src/acp/index.ts` does not re-export; `createAcpRunRecovery`
      keeps its `ERR_PRISM_RECOVERY_LIMIT` validation for a non-integer/`< 1_000` value; the
      `session/cancel` call site uses the resolved value; the duplicated `30_000` and the `ponytail:`
      ceiling comment are deleted in the same edit.
    - Functional: the seam stays internal — `dist/acp/index.d.ts` gains no symbol and
      `scripts/compat-baseline/arnilo__prism-ag-ui.txt` is unchanged (`npm run release:gate` diff empty).
      If a public export looks required, stop and re-scope: plan 116 rejected a public option, and
      `src/acp/index.ts`'s blanket `export * from "./agent/recovery.js"` would make any export from
      `recovery.ts` public.
    - Performance: the resolver is pure and synchronous; the no-op path costs one grep plus a read. No
      store round trips and no await added.
    - Code Quality: one constant pair and one clamp in one place; no helper that only wraps a `Math.min`
      for its own sake, no option threaded through `CreateAcpRunRecoveryOptions`, no new dependency.
    - Security: no credential and nothing persisted; for a >300 s config the await bound only shrinks to
      the lease cap, never grows; ownership/version/fence checks and `authorize`'s connection signal are
      untouched.
  - Approach:
    - Documentation Reviewed:
      - `packages/ag-ui/src/acp/agent/recovery.ts:L26-L27` (`DEFAULT_CANCEL_LEASE_TTL_MS = 30_000`,
        `HARD_CANCEL_LEASE_TTL_MS = 300_000`) and `:L167-L169` (clamp + `ERR_PRISM_RECOVERY_LIMIT`);
        `packages/ag-ui/src/acp/agent/core.ts:L172` (construction passes `options.recovery.leaseTtlMs`)
        and `:L426-L450` (the cancel call site and its `ponytail:` comment).
      - `packages/ag-ui/src/acp/index.ts:L1` — blanket `export * from "./agent/recovery.js"`; the
        `@arnilo/prism-ag-ui` `exports` map (`.`/`./acp`/`./renderer` only);
        `scripts/compat-baseline/arnilo__prism-ag-ui.txt` and `scripts/phase10-freeze-manifest.json`'s
        ag-ui `/acp` export list; `src/__tests__/public-export-contract.test.ts` — the freeze mechanism.
      - Plan 116 Compromises 1 and Further Action 1; `docs/_evidence/phase116-acp-cancel-disconnect.md`
        §2 (the chosen signal and its bound).
      - `packages/prism-channels/src/signal.ts:L311` — an unrelated bounded-lease precedent in another
        package (different lease, different default); read to confirm it is not a shared seam.
    - Options Considered:
      - Duplicate the clamp in `core.ts` — rejected: plan 116 already rejected duplicating the clamp, and
        a second copy is what the ceiling comment apologizes for.
      - Export the constants/clamp from `recovery.ts` — rejected: `export *` in `src/acp/index.ts` makes
        them public, changing the compat baseline and the freeze tests for an internal bound.
      - Land the internal module now without the trigger — rejected for this plan: the trigger is a host
        config above the cap, and with no such host the two call sites always agree; the no-op path
        records the measurement and keeps the upgrade one task away.
      - A public `cancelTimeoutMs` option — rejected in plan 116 and not revisited here.
    - Chosen Approach: probe for a host above the cap; no-op with a named trigger when none exists, one
      internal resolver when one does.
    - API Notes and Examples:
      ```ts
      // new internal module (not re-exported from src/acp/index.ts)
      export const DEFAULT_CANCEL_LEASE_TTL_MS = 30_000;
      export const HARD_CANCEL_LEASE_TTL_MS = 300_000;
      export function resolveCancelLeaseTtlMs(value?: number): number {
        return Math.min(value ?? DEFAULT_CANCEL_LEASE_TTL_MS, HARD_CANCEL_LEASE_TTL_MS);
      }
      // both call sites: recovery.ts's lease acquire and core.ts's
      // signal: AbortSignal.timeout(resolveCancelLeaseTtlMs(options.recovery?.leaseTtlMs))
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase116-acp-cancel-disconnect.md`: §7 append (probe, verdict, `Trigger:`, date).
      - Conditional (trigger fires): `packages/ag-ui/src/acp/agent/cancel-lease.ts` (new internal module),
        `packages/ag-ui/src/acp/agent/recovery.ts`, `packages/ag-ui/src/acp/agent/core.ts`, and a unit
        case in `packages/ag-ui/src/__tests__/acp-recovery.test.ts`.
    - References:
      - Plan 116 Further Action 1 and Compromises 1; plan 116 evidence §2; `CreateAcpRunRecoveryOptions`
        in `packages/ag-ui/src/acp/agent/types.ts:L95`.
  - Test Cases to Write:
    - Probe: the §7 transcript shows the actual `grep` result and the highest configured value, so a
      no-op is distinguishable from a skipped check.
    - Resolver (only if it lands): `undefined` → `30_000`, `5_000` → `5_000`, `400_000` → `300_000`, and
      `createAcpRunRecovery` still rejects `0`/non-integers with `ERR_PRISM_RECOVERY_LIMIT`.
    - Call site (only if it lands): the immediate-disconnect case stays green under both runners, and the
      hung-store primitive case still settles inside the bound.
    - Surface (only if it lands): `dist/acp/index.d.ts` is unchanged and `release:gate` reports no
      compat-baseline diff.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export, option, or payload change; only the await bound for a
      hypothetical >300 s host config moves to the lease cap.
    - Docs pages to create/edit: none — `docs/acp.md`'s active-run recovery bullet already states the
      write is connection-independent and cancel-lease bounded; an internal clamp is not a contract.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Agent-level bounded-write test when the SDK exposes handler completion (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 116 Further Action 2): probe the pinned `@agentclientprotocol/sdk` and
      record the transcript with the date and version in §8 — the `packages/ag-ui/package.json` pin and
      installed version, then a read of `node_modules/@agentclientprotocol/sdk/dist/acp.d.ts` /
      `acp.js` for a public way to await in-flight notification handlers (`registerAppNotification`,
      `processIncomingMessage`, `Connection.closed`), plus the upstream release notes for the next
      version boundary.
    - Functional: if no seam exists (today: `closed` resolves at transport close, and notification
      handlers are fire-and-forget), the task closes as a recorded no-op: the probe, the verdict, and
      `Trigger: the next @agentclientprotocol/sdk pin bump that exposes an in-flight handler promise or a
      teardown await` are **appended** to §8; no code change.
    - Functional: if a seam exists, one agent-level case lands in `acp-recovery.test.ts`: a checkpoint
      store whose cancel-namespace write hangs until its signal aborts, `recovery: { leaseTtlMs: 1_000 }`
      (the enforced minimum), `session/cancel` followed by an immediate disconnect, the handler awaited
      through the new seam; assert it returned inside ~1 s and that the marker is absent (the failure is
      surfaced, never reported as written). Reuse plan 116's four-method store-wrapper pattern; no
      polling loop.
    - Functional: the case must not replace or weaken plan 116's immediate-disconnect case — both stay
      green under `bun test --timeout=0` and `node --test` over `dist/`.
    - Performance: the no-op path is a read. The landing path costs ~1 s per run (the lease minimum) and
      adds no wait to any other case; the suite must not gain a new 2 s-class hang bound.
    - Code Quality: one test using the SDK seam as-is; no monkey-patching the SDK internals to synthesize
      a seam, no helper extraction for a single call site.
    - Security: the case exercises only the in-repo memory store; no credential, no production signal
      changed, no marker content added.
  - Approach:
    - Documentation Reviewed:
      - `node_modules/@agentclientprotocol/sdk/dist/acp.d.ts` (`Connection.closed`, `runUntil`,
        `registerAppNotification`'s handler context) and `dist/acp.js` (`registerAppNotification`,
        `processIncomingMessage` fired with `.catch`); the SDK pin in `packages/ag-ui/package.json`.
      - Plan 116 §5 (the primitive-level bounded-write case) and Compromises 2 (why it is not
        agent-level today); `acp-recovery.test.ts`'s existing bounded case and store wrapper.
      - The upstream SDK repository/release notes for any handler-tracking surface added after 1.4.0.
    - Options Considered:
      - Keep the primitive-level proof and never re-check — rejected: plan 116 named the trigger and this
        task is its owner.
      - Monkey-patch the SDK to expose handler completion in the test — rejected: it would test the patch,
        not the SDK, and break on any internal rename.
      - Shrink the wait by lowering the lease minimum below `1_000` — rejected: the minimum is recovery's
        validated contract, and the test must use the real bound.
    - Chosen Approach: re-probe at the pin boundary; no-op with a named upstream surface when the SDK
      still offers no await, one agent-level case when it does.
    - API Notes and Examples:
      ```ts
      // today (SDK 1.4.0): no public await for an in-flight notification handler
      // connection.closed resolves at transport close, before the handler finishes
      // trigger to watch: an exported in-flight handler promise / teardown await
      const agent = app.agent; // connectWith's agent side
      await connection.notify(methods.agent.session.cancel, { sessionId });
      // landing path: await the seam, then assert no marker + bounded return
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase116-acp-cancel-disconnect.md`: §8 append (probe, verdict, `Trigger:`, date).
      - Conditional (seam exists): `packages/ag-ui/src/__tests__/acp-recovery.test.ts` — one agent-level
        hung-store case.
    - References:
      - Plan 116 Further Action 2 and Compromises 2; plan 116 evidence §5; `@agentclientprotocol/sdk`
        pin `1.4.0`.
  - Test Cases to Write:
    - Probe: the §8 transcript names the pinned version and the exact symbols inspected, so a no-op is
      distinguishable from a skipped check.
    - Agent-level case (only if the seam lands): hung cancel write + `leaseTtlMs: 1_000` + immediate
      disconnect returns inside the bound with no marker.
    - Regression: plan 116's immediate-disconnect case and bounded primitive case stay green under both
      runners.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test-only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Answer whether `session/close` aborts an in-flight durable write (probe + contract clause)
  - Acceptance Criteria:
    - Functional (source: plan 116 Further Action 3): probe today's behavior with a runnable case and
      record the transcript in §9 — after `session/cancel` followed immediately by `session/close`, the
      durable marker is present, the run controller is aborted, and the run reports `cancelled`; read
      `core.ts`'s `session/close` handler to confirm it evicts the session store, aborts the controller,
      and deletes the session without touching recovery/lease state (no cancel, no lease release).
    - Functional: land one clause in `docs/acp.md` stating the contract the probe observed —
      `session/close` does not abort a durable cancel write already in flight; the write stays bounded by
      the cancel-lease TTL. One sentence in the existing active-run recovery or `session/close` bullet,
      no release narrative.
    - Functional: the clause must not imply a closed session can be resumed: it keeps the existing
      statement that a cancelled run reports `cancelled` and must not be resumed.
    - Functional: a behavior change (a session-scoped controller aborting in-flight durable writes on
      close) stays trigger-gated: it lands only on a host report, and §9 records
      `Trigger: a host reports durable work continuing after session/close`; no speculative controller is
      built, and the connection signal is not reintroduced.
    - Performance: the probe adds one small test (tens of ms); no production cost and no new store round
      trip.
    - Code Quality: the docs clause is one sentence; no new seam, no new option, no test-only wait.
    - Security: the probe and clause preserve ownership/version/fence semantics — the marker is written
      under the session's ownership and a later resume is still refused; close must not be described as a
      way to bypass cancellation.
  - Approach:
    - Documentation Reviewed:
      - `packages/ag-ui/src/acp/agent/core.ts`'s `session/close` handler (store eviction, controller
        abort, session-map delete) and the `session/cancel` handler at `:L426-L450`;
        `packages/ag-ui/src/acp/agent/recovery.ts`'s `cancel()` lease/CAS path.
      - `docs/acp.md:L7` (the method list), `:L27`/`:L40` (the `close` capability and advertise rules),
        and `:L124` (the active-run recovery bullet plan 116 edited).
      - Plan 116 §1/§3 (the disconnect transcripts) and Further Action 3; the ACP SDK's `session/close`
        notification shape (client → agent, no response body).
    - Options Considered:
      - Document today's behavior and leave it — kept: the question's answer is a contract statement, and
        changing behavior needs host demand.
      - Abort in-flight durable writes on `session/close` — deferred behind the host-report trigger: it
        needs a session-scoped controller (the connection signal is exactly what plan 116 removed) and
        would drop a cancel intent the client already sent.
      - Do nothing and rely on the Further Action text — rejected: that is the state this task exists to
        fix.
    - Chosen Approach: probe, state the observed contract in one clause, and keep the behavior change
      trigger-gated with a named report.
    - API Notes and Examples:
      ```ts
      await connection.notify(methods.agent.session.cancel, { sessionId });
      await connection.notify(methods.agent.session.close, { sessionId });
      // probe asserts: marker present under ACP_RUN_CANCEL_NAMESPACE, controller aborted,
      // recovered status "cancelled" — close did not undo the durable cancel
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase116-acp-cancel-disconnect.md`: §9 append (probe transcript, verdict,
        `Trigger:`, date).
      - `docs/acp.md`: one clause in the active-run recovery bullet (or the `session/close` bullet).
      - `packages/ag-ui/src/__tests__/acp-recovery.test.ts`: one probe case (gated cancel write,
        cancel then close, marker present + controller aborted + status `cancelled`) under both
        runners — landed with the clause so the contract stays checked.
      - Conditional (host report): a session-scoped controller — not planned here beyond the trigger.
    - References:
      - Plan 116 Further Action 3; plan 116 evidence §1 and §3; `docs/acp.md:L124`.
  - Test Cases to Write:
    - Probe: `session/cancel` then `session/close` leaves the durable marker present, the controller
      aborted, and the recovered run status `cancelled`.
    - Docs: the clause exists in `docs/acp.md` and does not contradict the "must not be resumed"
      statement (extend `src/__tests__/docs.test.ts`'s acp assertions only if the existing wording checks
      need it).
    - Regression: the immediate-disconnect case and the bounded primitive case stay green under both
      runners.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a stated behavior contract for `session/close` (no behavior
      change); no export, option, or payload change.
    - Docs pages to create/edit: `docs/acp.md` — one clause in the active-run recovery or `session/close`
      bullet.
    - `docs/index.md` update: no — no new page and no navigation-worthy delta beyond the existing ACP
      entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **Tasks 1 and 2 closed as trigger-gated no-ops; no code changed.** No in-repo host sets ACP
  `recovery.leaseTtlMs` (§7), and `@agentclientprotocol/sdk` `1.4.0` — plus the next published
  boundary `1.5.0` — exposes no in-flight notification-handler await or teardown await (§8). The
  resolved-TTL seam and the agent-level hung-store case stay one trigger away; both probes and
  triggers are recorded in the evidence file.
- **Task 3's probe landed as a permanent case in `acp-recovery.test.ts`, not just a transcript.**
  The plan's Files list named only the evidence append and the docs clause; the runnable probe is
  the contract's only automated check, so it stays green under both runners (the task's Files list
  was updated to name it).
- **One pasted grep line in §7 escapes its markdown link (`\]\(`).** `docs.test.ts`'s local-link
  scan reads fenced transcripts as markdown, so the verbatim `docs/messaging-channel-operations.md`
  line would otherwise register as a broken link in this evidence file. The transcript is otherwise
  verbatim, and the escape is noted inline.

## Further Actions

1. **Land the internal resolved-TTL seam when a host configures above the cap (low).**
   `DEFAULT_CANCEL_LEASE_TTL_MS` + `HARD_CANCEL_LEASE_TTL_MS` + clamp move into a non-exported
   `packages/ag-ui/src/acp/agent/` module shared by `createAcpRunRecovery` and the `session/cancel`
   call site, deleting the duplicated `30_000` and the `ponytail:` ceiling comment.
   **Trigger: a host configures `recovery.leaseTtlMs > 300_000`.**
2. **Land the agent-level bounded-write case when the SDK adds handler completion (low).** Hung
   cancel-namespace write + `leaseTtlMs: 1_000` + immediate disconnect, handler awaited through the
   new seam; asserts return inside ~1 s and no marker. **Trigger: the next
   `@agentclientprotocol/sdk` pin bump that exposes an in-flight handler promise or a teardown
   await.**
3. **Decide whether `session/close` should abort in-flight durable writes (low).** Today close
   evicts/aborts/deletes without touching recovery state and the bounded write lands; "close drops
   pending durable work" needs a session-scoped controller (the connection signal was removed in
   plan 116). **Trigger: a host reports durable work continuing after `session/close`.**
4. **Make `docs.test.ts`'s local-link scan skip fenced code blocks (low).** Pasted transcripts in
   `docs/_evidence/**` are currently parsed as markdown links; today's escape workaround is
   manual and easy to miss on the next evidence append.
