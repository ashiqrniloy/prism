# ACP Durable Cancel vs Client Disconnect: the Marker Lands Before the Connection Can Take It Away

Recorded from `plans/114-Bun-Coverage-Gate.md` Further Actions 1. Plan 114's Bun coverage run surfaced a product race, not a test flake: `session/cancel` writes the durable cancel marker on the connection's notification signal (`context.signal`), so a client that disconnects immediately after sending the cancel can abort the marker write mid-flight. Node usually wins the scheduling race and writes the marker; Bun loses it and the run stays resumable after the host intended a durable cancel. Plan 114 Task 2 made the test poll for the marker **while connected** so the gate could go green, and left the product behavior unchanged.

Evidence: `docs/_evidence/phase114-bun-coverage.md` §7.1 (the measured race and the polling workaround) and `packages/ag-ui/src/__tests__/acp-recovery.test.ts` ("restart + cancel writes a durable marker", the case plan 114 Task 2 edited).

## Objectives

- A durable cancel intent received over an ACP connection completes even if that connection drops immediately afterwards: the marker write does not depend on a signal the client can abort by hanging up.
- The ACP agent's cancel handler stays ownership/version/fence checked and terminal/idempotent; authorization still uses the connection signal, because an unauthenticated or already-disconnected principal must not cancel.
- No new option on the public recovery API, no new dependency, and no test-only wait: the fix is one signal decision at the call site, proved by a test that disconnects before observing anything.
- The disconnect guarantee is stated where the cancel contract already lives (`docs/acp.md`'s active-run recovery bullet), or the task records why the existing wording already implies it.

## Expected Outcome

- `packages/ag-ui/src/acp/agent/core.ts`'s `session/cancel` handler no longer forwards `context.signal` to `runRecovery.cancel`; `authorize` and `restore` keep it. The durable write runs on a connection-independent signal whose bound is named in the task note (the marker lease TTL, or an explicit timeout) so a hung store cannot pin the handler forever.
- `packages/ag-ui/src/__tests__/acp-recovery.test.ts` asserts the marker exists after the client disconnects **immediately** after `notify` — no polling loop — and plan 114's polling workaround is deleted.
- The same test passes under both pinned runners (`node --test` and `bun test --timeout=0`), closing the runtime-dependent flake plan 114 measured.
- `docs/_evidence/phase116-acp-cancel-disconnect.md` holds the reproduced race, the chosen signal and its bound, and the before/after transcripts; `docs/acp.md:124` states the disconnect guarantee.
- `recovery.cancel(ref, { signal })` keeps its public shape: hosts that want a connection-tied write can still pass their own signal.

## Tasks

- [x] Task 1: The durable cancel marker survives an immediate client disconnect (reproduce, decide the signal, fix, prove)
  - Acceptance Criteria:
    - Functional: the race is reproduced first, on this tree, under both runners: the current test with plan 114's polling loop removed fails (or passes only by scheduling) under `bun test --timeout=0 packages/ag-ui/src/__tests__/acp-recovery.test.ts` and passes under `node --test packages/ag-ui/dist/__tests__/acp-recovery.test.js`; the transcript goes into `docs/_evidence/phase116-acp-cancel-disconnect.md`. If the race does not reproduce on the installed Bun, the task records that and stops before changing code — no speculative signal plumbing.
    - Functional: `packages/ag-ui/src/acp/agent/core.ts`'s `session/cancel` handler stops passing `context.signal` to `runRecovery.cancel`. The chosen replacement is named in the task note and is connection-independent: a dedicated session/agent-scoped `AbortController` that aborts on agent teardown, or no signal whose write is bounded by the store's own lease/TTL. `authorize(...)` and `restore(...)` keep `context.signal` unchanged.
    - Functional: the write stays bounded: if the store never settles, the handler still returns — through the existing lease/`AbortSignal.timeout` bound (names its milliseconds) — and the failure is surfaced on the error path, not swallowed and not reported as a written marker.
    - Functional: `packages/ag-ui/src/__tests__/acp-recovery.test.ts`'s "restart + cancel writes a durable marker" case disconnects immediately after `notify` and then asserts the marker from outside the connection, with no `setTimeout` polling loop; the polling block plan 114 Task 2 added is deleted.
    - Functional: `recovery.cancel`'s public request shape (`readonly signal?: AbortSignal` in `packages/ag-ui/src/acp/agent/recovery.ts`) is unchanged — a host can still pass its own signal; no new public option is added for this fix.
    - Functional: `docs/acp.md:124` states, in the existing active-run recovery bullet, that the durable cancel lands even when the client disconnects right after `session/cancel` — one clause, no release narrative.
    - Performance: no measurable cost; the change removes one signal hop and adds no store round trips. The disconnect reproduction's runtime is recorded once (before/after) to show the test does not get slower.
    - Code Quality: the choice is one expression at the call site with one comment naming the race and the bound; no `cancelSignal()` helper, no option threaded through `CreateAcpRunRecoveryOptions`, no new dependency. If the bound is a `ponytail:` simplification (for example reusing the lease TTL rather than a per-call timeout), the comment names the ceiling and the upgrade path.
    - Security: cancellation remains ownership/version/fence checked, terminal/idempotent, and marker-payload-identical (metadata only); `authorize` still sees the connection signal so a disconnected or unauthenticated principal cannot cause a cancel; the new signal source carries no credential and is not persisted.
  - Approach:
    - Documentation Reviewed:
      - `packages/ag-ui/src/acp/agent/core.ts:L426-L450` — the `session/cancel` handler and the `signal: context.signal` argument this task changes; `packages/ag-ui/src/acp/agent/recovery.ts:L222-L320` — `cancel()` and the `request.signal?.throwIfAborted()` / `signal:` checkpoints the abort races at.
      - `packages/ag-ui/src/__tests__/acp-recovery.test.ts:L383-L408` — the case plan 114 Task 2 edited (the polling loop and its comment); plan 114 §7.1 — the measured Bun-vs-Node scheduling difference and the deliberate product-behavior hold.
      - `docs/acp.md:124` — the durable-cancellation contract sentence this task extends; `docs/durable-runs.md` — checked for an existing cancel-durability statement (none).
      - The ACP SDK's notification handler lifetime — whether an in-flight handler is cancelled when the transport closes, or only the `context.signal` aborts (verified by the reproduction, not assumed).
    - Options Considered:
      - Keep `context.signal` and make the write fast enough to win — rejected: a race that depends on scheduling is exactly the bug; Bun's loss is the honest measurement.
      - Retry the marker write after the disconnect — rejected: the handler is gone with the connection, and a retry queue duplicates the durable store's own idempotency.
      - Poll for the marker in the test — rejected: plan 114's workaround; it hides the product gap and stays runtime-dependent.
      - Pass no signal at all — kept only if the store's own lease/TTL bounds the write; otherwise it trades a race for an unbounded await in the handler.
      - A dedicated agent/session-scoped `AbortController` for durable writes — kept when the reproduction shows handler lifetime outliving the connection: it keeps cancellation on teardown while decoupling from the client.
      - Add a `cancelTimeoutMs` option to the public recovery API — rejected: a knob for a bound the store's lease already provides, and a public-surface change for an internal fix.
    - Chosen Approach: reproduce on both runners, then replace the connection signal with the named connection-independent bound, delete the test polling loop, and state the guarantee in `docs/acp.md`. Which of the two bounded forms lands is decided by the reproduction transcript, and the task note records why.
    - API Notes and Examples:
      ```ts
      // before — the client can abort its own cancel by hanging up
      await runRecovery.cancel(ref, { ownership, agentId, expectedVersion, signal: context.signal });
      // after — auth still sees the connection signal; the durable write does not
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      // … marker write bounded by the chosen connection-independent signal
      await runRecovery.cancel(ref, { ownership, agentId, expectedVersion });
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/acp/agent/core.ts`: the cancel handler's signal argument (and the chosen bound).
      - `packages/ag-ui/src/__tests__/acp-recovery.test.ts`: immediate-disconnect assertion; delete plan 114's polling block.
      - `docs/acp.md`: the disconnect clause at the active-run recovery bullet.
      - `docs/_evidence/phase116-acp-cancel-disconnect.md`: reproduce/decide/fix transcripts, both runners, before/after.
      - `docs/_evidence/phase114-bun-coverage.md`: one-line pointer in §7.1 to this plan's evidence (append-only; do not rewrite the measurement).
    - References:
      - Plan 114 Further Actions 1 — this task is its destination; `docs/_evidence/phase114-bun-coverage.md` §7.1; `packages/ag-ui/README.md` if it restates the cancel contract (checked, not assumed).
  - Test Cases to Write:
    - Immediate disconnect: the test sends `session/cancel` and disconnects before reading anything, then asserts the durable marker from outside the connection — the failing-before/passing-after case for this task.
    - Both runners: the same case passes under `bun test --timeout=0` and `node --test` over the built `dist/` — the runtime difference plan 114 measured stays closed.
    - Bounded write: a checkpoint store whose write never settles still lets the handler return inside the named bound, with the failure surfaced (and no marker reported as written).
    - Authorization: a disconnected or unauthorized principal (`authorize` false) writes no marker — the connection signal still governs the permission check.
    - API shape: `recovery.cancel(ref, { signal })` still aborts a write when a host passes an already-aborted signal (the public seam is unchanged).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the ACP agent's durable-cancel guarantee across a client disconnect; no export, option, or payload shape changes.
    - Docs pages to create/edit: `docs/acp.md` — one clause in the existing active-run recovery bullet (current contract, no plan number); `packages/ag-ui/README.md` only if it restates the cancel contract.
    - `docs/index.md` update: no — no new page and no navigation-worthy behavior delta beyond the existing ACP entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task Note (completed 2026-09-23):
    - Reproduction: plan 114's polling loop removed → Bun 1.4.2 fails (`AssertionError: null == true`, 119 ms; with the hang bound added, `durable cancel marker missing after an immediate client disconnect`, 2.02 s) and Node v26.9.0 passes. Transcript in `docs/_evidence/phase116-acp-cancel-disconnect.md` §1. The handler outlives the connection; the loss is the connection signal (`context.signal` aborted by `Connection.close()`), not message delivery.
    - Chosen replacement: `AbortSignal.timeout(options.recovery?.leaseTtlMs ?? 30_000)` at the `session/cancel` call site — connection-independent and bounded by the cancel-lease TTL (default 30 s; `createAcpRunRecovery` enforces a 1 s minimum). `authorize`/`restore` keep `context.signal`. A `ponytail:` comment names the reuse-without-300 s-clamp ceiling.
    - Test: "persists the active-run ref on live runs and restores it across a restart" disconnects immediately after `notify`, awaits the cancel-namespace write itself (no polling), then reads the marker from outside the connection; new "bounds a hung cancel write on the signal and reports no marker" case. Both runners green (Bun 17/17, Node 17/17), and the new case is ~2× faster than the polling workaround (evidence §4).
    - Docs: `docs/acp.md:L124` clause added; `packages/ag-ui/README.md` checked, no change needed; `docs/_evidence/phase114-bun-coverage.md` §7.1 pointer added.

## Compromises Made

- **The bound reuses the host's `leaseTtlMs` without `createAcpRunRecovery`'s 300 s clamp.** A host
  that sets a TTL above 300 s gets a longer await bound than the lease it holds; the code comment
  names this (`ponytail:`) and why it is harmless — the checkpoint CAS/fencing token rejects a
  write after lease expiry, so the worst case is a longer wait, not a stale marker. Threading the
  resolved TTL through would be the upgrade path if it ever matters.
- **The bounded-write proof is primitive-level, not end-to-end through the agent handler.** The new
  case exercises `recovery.cancel(ref, { signal })` against a hung store (the signal contract the
  call site now uses); the call site's exact expression is covered by the immediate-disconnect test
  and the code comment. An agent-level hung-store case would need a way to observe handler
  completion that the ACP SDK does not expose, plus a ~1 s wait per run.
- **The immediate-disconnect test awaits a store-write completion signal instead of a plain marker
  read.** The SDK's notification handler can outlive the connection under Bun, so a bare read races
  the handler even after the fix. The test wraps the checkpoint store (no polling loop) and bounds a
  dropped write with a 2 s race so a regression fails instead of hanging.

## Further Actions

1. **Thread the resolved cancel-lease TTL into the durable-write bound (low).** `createAcpRunRecovery`
   resolves and clamps `leaseTtlMs` internally; exposing that resolved value (or a resolved-TTL
   accessor) would remove the duplicated `30_000` default and the unclamped ceiling named in the
   code comment. No public option needed. **Trigger: a host configures `leaseTtlMs > 300_000`.**
   **Destination: `plans/118-Acp-Durable-Write-Trigger-Follow-Ups.md` Task 1.**
2. **Agent-level bounded-write test when the SDK exposes handler completion (low).** Today the
   primitive-level case plus the disconnect case cover the behavior; an end-to-end hung-store case
   would pin the call site's TTL choice directly. **Trigger: `@agentclientprotocol/sdk` exposes an
   in-flight notification-handler promise or a teardown await.**
   **Destination: `plans/118-Acp-Durable-Write-Trigger-Follow-Ups.md` Task 2.**
3. **Check whether `session/close` should abort in-flight durable writes (low).** A client that
   sends `session/cancel` and then `session/close` still lets the bounded write land; if a host
   wants close to mean "drop pending durable work", it needs a session-scoped controller, not the
   connection signal. **Trigger: a host reports durable work continuing after `session/close`.**
   **Destination: `plans/118-Acp-Durable-Write-Trigger-Follow-Ups.md` Task 3.**
