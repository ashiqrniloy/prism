# Phase 116 — ACP Durable Cancel vs Client Disconnect

Plan: [116-Acp-Durable-Cancel-Vs-Client-Disconnect.md](../../plans/116-Acp-Durable-Cancel-Vs-Client-Disconnect.md) Task 1.
Date: 2026-09-23. Host: Linux 7.2.6-1-cachyos x86_64, 16 cores, AMD Ryzen 9 PRO 7940HS.
Bun 1.4.2 (`744846f84`), Node v26.9.0. Tree: HEAD `3129d5cf` (0.10.1 WIP), branch
`migration/bun`, root and workspace `dist/` built from this tree.

Method: every transcript below is the current output of the command above it. Both runners
execute the same case: `packages/ag-ui/src/__tests__/acp-recovery.test.ts`
("persists the active-run ref on live runs and restores it across a restart") — Bun runs the
TypeScript source, Node runs the compiled `packages/ag-ui/dist/__tests__/acp-recovery.test.js`.
Repo paths are elided to `<repo>`.

---

## 0. Verdict summary

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | With plan 114's polling loop removed, the immediate-disconnect marker assert fails under Bun and passes under Node | CONFIRMED |
| 2 | The failure is the connection signal: `session/cancel` passes `context.signal` to `runRecovery.cancel`; the SDK aborts it when the transport closes | CONFIRMED |
| 3 | The handler outlives the connection; with the polling loop the marker lands under Bun | CONFIRMED (plan 114 §7.1, re-observed) |
| 4 | Replacing the connection signal with `AbortSignal.timeout(leaseTtlMs ?? 30_000)` makes the immediate-disconnect case pass under both runners | CONFIRMED |
| 5 | The write is bounded and the failure is surfaced: a hung store settles only through the signal and `cancel` rejects, writing no marker | CONFIRMED |

---

## 1. Reproduction (before the fix)

`core.ts` still passed `signal: context.signal`; plan 114 Task 2's polling block was deleted
from the test, leaving `notify` → callback return (disconnect) → marker read.

```text
$ bun test --timeout=0 packages/ag-ui/src/__tests__/acp-recovery.test.ts
(pass) durable cancellation > bounds a hung cancel write on the signal and reports no marker [50.32ms]
(pass) durable cancellation > corrupt cancel markers fail closed and are rewritten by a later cancel [0.37ms]
459 |     const marker = await checkpoints.loadCheckpoint({
460 |       namespace: ACP_RUN_CANCEL_NAMESPACE,
461 |       key: persisted.runId,
462 |       userId: "user-1",
463 |     });
464 |     assert.ok(marker, "durable cancel marker missing after an immediate client disconnect");
                 ^
AssertionError: durable cancel marker missing after an immediate client disconnect
(fail) ACP agent wiring > persists the active-run ref on live runs and restores it across a restart [2023.18ms]

 16 pass
 1 fail
Ran 17 tests across 1 file. [2.16s]
real 0m2.170s
```

```text
$ node --test packages/ag-ui/dist/__tests__/acp-recovery.test.js
  ✔ persists the active-run ref on live runs and restores it across a restart (15.796935ms)
ℹ tests 17
ℹ pass 17
ℹ fail 0
ℹ duration_ms 257.632331
real 0m0.288s
```

The 2023 ms failure is the test's own 2000 ms hang bound (a dropped write must fail, not
hang); the marker itself never landed. The SDK's notification handler lifetime is not tied to
the transport: `registerAppNotification` hands the handler the connection's `AbortSignal`
(`node_modules/@agentclientprotocol/sdk/dist/acp.js`, `registerAppNotification` →
`cx.signal`), which `Connection.close()` aborts. The handler promise keeps running after the
close, but every `request.signal?.throwIfAborted()` / store call in `runRecovery.cancel`
(`packages/ag-ui/src/acp/agent/recovery.ts:L222-L320`) then throws `AbortError`, so the
`saveCheckpoint` never happens. Plan 114 Task 2's in-connection polling kept the signal alive
long enough for Bun's later-scheduled handler to finish, which is why the marker appeared
there; the product gap was the signal, not delivery.

A first reproduction on the plain (pre-wrapper) test, before the hang bound was added, was
the same failure in 119 ms (`AssertionError: null == true`), Node 16 pass / 236 ms — the race
is scheduling, not message loss.

## 2. Chosen signal and its bound

`packages/ag-ui/src/acp/agent/core.ts` (`session/cancel` handler):

```ts
// The durable write must outlive a client disconnect, so it is not
// tied to `context.signal` (aborted when the connection closes).
// AbortSignal.timeout bounds a hung store with the cancel-lease
// TTL (default 30_000 ms); the store still observes the signal.
// ponytail: the host's leaseTtlMs is reused without recovery's
// 300s clamp; a longer await bound than the lease is harmless
// (fencing rejects a write after lease expiry).
signal: AbortSignal.timeout(options.recovery?.leaseTtlMs ?? 30_000),
```

- `authorize(...)` and `restore(...)` keep `context.signal` unchanged; a disconnected or
  unauthenticated principal still cannot cancel.
- The signal is connection-independent and carries no credential; nothing new is persisted
  and `recovery.cancel`'s public request shape (`readonly signal?: AbortSignal`) is unchanged.
- Bound: the resolved cancel-lease TTL (default `30_000` ms, minimum `1_000` ms enforced by
  `createAcpRunRecovery`). `AbortSignal.timeout`'s timer is unref'd on both runners (the suite
  exits immediately, §4).
- The store observes the signal (`CheckpointStore`/`LeaseStore` take `signal`); a store that
  ignores it cannot be bounded by any caller-side signal. The bound's failure is a rejected
  `cancel()` — surfaced on the handler error path, never reported as a written marker.

## 3. After the fix

```text
$ bun test --timeout=0 packages/ag-ui/src/__tests__/acp-recovery.test.ts
(pass) durable cancellation > bounds a hung cancel write on the signal and reports no marker [50.41ms]
(pass) durable cancellation > corrupt cancel markers fail closed and are rewritten by a later cancel [0.38ms]
(pass) ACP agent wiring > persists the active-run ref on live runs and restores it across a restart [21.22ms]

 17 pass
 0 fail
Ran 17 tests across 1 file. [160.00ms]
real 0m0.168s
```

```text
$ node --test packages/ag-ui/dist/__tests__/acp-recovery.test.js
  ✔ bounds a hung cancel write on the signal and reports no marker (50.08937ms)
  ✔ persists the active-run ref on live runs and restores it across a restart (15.31623ms)
ℹ tests 17
ℹ pass 17
ℹ fail 0
ℹ duration_ms 251.711686
real 0m0.281s
```

The disconnect case now asserts from outside the connection with no polling loop: it awaits
the durable write itself (a store wrapper resolves on the cancel-namespace `saveCheckpoint`,
raced against a 2000 ms hang bound) and then reads the marker from the store. The plan 114
Task 2 polling block is deleted.

## 4. Runtime, before/after

The plan 114 polling variant (same product fix) and the immediate-disconnect variant, full
`acp-recovery` file, warm, one run each:

| Variant | Bun | Node |
| --- | --- | --- |
| plan 114 polling loop (16 tests) | 0.454 s | 0.572 s |
| immediate disconnect + awaited write (17 tests) | 0.168 s | 0.281 s |

The new case is ~2.7×/2.0× faster because it stops the polling sleeps; the added
bounded-write case costs 50 ms (its own signal). No store round trips were added — the
durable write path is unchanged apart from the signal source.

Full `@arnilo/prism-ag-ui` suite after the fix: Node `node --test dist/__tests__/*.test.js`
238 pass / 0 fail (5.31 s); Bun `bun test --timeout=0` in the package 462 pass / 0 fail
(1.20 s).

## 5. Bounded write and failure path

New case: `bounds a hung cancel write on the signal and reports no marker`. A checkpoint
store whose cancel-namespace `saveCheckpoint` settles only on the caller's signal; with
`signal: AbortSignal.timeout(50)`, `recovery.cancel` rejects with the signal's
`TimeoutError` (the `request.signal?.aborted` rethrow in `recovery.ts`), and the marker read
stays `null`:

```text
(pass) durable cancellation > bounds a hung cancel write on the signal and reports no marker [50.41ms]
  ✔ bounds a hung cancel write on the signal and reports no marker (50.08937ms)
```

The agent call site uses the same signal contract (`AbortSignal.timeout(leaseTtlMs ?? 30_000)`),
so the handler returns inside that bound instead of hanging on the store.

## 6. Files touched

- `packages/ag-ui/src/acp/agent/core.ts` — cancel-handler signal argument and comment.
- `packages/ag-ui/src/__tests__/acp-recovery.test.ts` — immediate-disconnect assert (write
  completion signal, 2000 ms hang bound), plan 114 polling block deleted, bounded-write case.
- `docs/acp.md:L124` — active-run recovery bullet: the durable marker write is not tied to
  the connection.
- `docs/_evidence/phase114-bun-coverage.md` §7.1 — one-line pointer to this file.

`packages/ag-ui/README.md` was checked: it states durable, ownership/version/fence-checked
cancellation but no disconnect timing, so it needs no edit.

---

## 7. Cancel-lease TTL resolution — plan 118 Task 1 (trigger-gated no-op)

Date: 2026-09-23. Plan 116 Further Action 1: the `session/cancel` await bound
(`core.ts`'s `AbortSignal.timeout(options.recovery?.leaseTtlMs ?? 30_000)`) skips
`recovery.ts`'s `Math.min(..., 300_000)` clamp, so a host configuring above the cap would
await longer than the lease. Probe: is there any such host?

Probe (repo-wide, per plan 118 Task 1):

```text
$ grep -rn "leaseTtlMs" packages/*/src docs examples scripts
packages/ag-ui/src/__tests__/acp-recovery.test.ts:85:  leaseTtlMs?: number;
packages/ag-ui/src/__tests__/acp-recovery.test.ts:92:    ...(overrides?.leaseTtlMs !== undefined ? { leaseTtlMs: overrides.leaseTtlMs } : {}),
packages/ag-ui/src/acp/agent/core.ts:172:        leaseTtlMs: options.recovery.leaseTtlMs,
packages/ag-ui/src/acp/agent/core.ts:447:              // ponytail: the host's leaseTtlMs is reused without recovery's
packages/ag-ui/src/acp/agent/core.ts:450:              signal: AbortSignal.timeout(options.recovery?.leaseTtlMs ?? 30_000),
packages/ag-ui/src/acp/agent/recovery.ts:62:  readonly leaseTtlMs?: number;
packages/ag-ui/src/acp/agent/recovery.ts:167:  const leaseTtlMs = Math.min(options.leaseTtlMs ?? DEFAULT_CANCEL_LEASE_TTL_MS, HARD_CANCEL_LEASE_TTL_MS);
packages/ag-ui/src/acp/agent/recovery.ts:168:  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1_000) {
packages/ag-ui/src/acp/agent/recovery.ts:169:    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_LIMIT", `leaseTtlMs must be a positive safe integer`);
packages/ag-ui/src/acp/agent/recovery.ts:260:          ttlMs: leaseTtlMs,
packages/ag-ui/src/acp/agent/types.ts:95:    readonly leaseTtlMs?: number;
packages/prism-channels/src/limits.ts:17:  leaseTtlMs: 30_000,
packages/prism-channels/src/limits.ts:34:  leaseTtlMs: 5 * 60_000,
packages/prism-channels/src/runtime-core.ts:468:    if (current !== undefined && current.expiresAt - now > limits.leaseTtlMs / 3) return "ok";
packages/prism-channels/src/runtime-core.ts:477:          ttlMs: limits.leaseTtlMs,
packages/prism-channels/src/runtime-core.ts:497:        ttlMs: limits.leaseTtlMs,
packages/prism-channels/src/signal.ts:62:  readonly leaseTtlMs?: number;
packages/prism-channels/src/signal.ts:311:  const leaseTtlMs = bounded(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, 5_000, 300_000, "leaseTtlMs");
packages/prism-channels/src/signal.ts:408:        ttlMs: leaseTtlMs,
packages/prism-channels/src/signal.ts:612:          ttlMs: leaseTtlMs,
packages/prism-channels/src/signal.ts:619:        renewTimer = setInterval(() => void renew(), Math.max(1_000, Math.floor(leaseTtlMs / 2)));
packages/prism-channels/src/telegram.ts:101:  readonly leaseTtlMs?: number;
packages/prism-channels/src/telegram.ts:123:  readonly leaseTtlMs?: number;
packages/prism-channels/src/telegram.ts:737:  const leaseTtlMs = boundedInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, pollTimeoutSeconds * 1000 + 10_000, 300_000, "leaseTtlMs");
packages/prism-channels/src/telegram.ts:812:        ttlMs: leaseTtlMs,
packages/prism-channels/src/telegram.ts:961:          ttlMs: leaseTtlMs,
packages/prism-channels/src/telegram.ts:1068:  const leaseTtlMs = boundedInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, 5_000, 300_000, "leaseTtlMs");
packages/prism-channels/src/telegram.ts:1117:        ttlMs: leaseTtlMs,
packages/prism-channels/src/types.ts:215:  readonly leaseTtlMs?: number;
packages/prism-channels/src/types.ts:234:  readonly leaseTtlMs: number;
packages/prism-coding-tools/src/agent/__tests__/process-recovery.test.ts:133:    recoveryLimits: { attachTimeoutMs: 500, leaseTtlMs: 60, ...(recoveryLimits ?? {}) },
packages/prism-coding-tools/src/agent/process/recovery.ts:117:  readonly leaseTtlMs?: number;
packages/prism-coding-tools/src/agent/process/recovery.ts:125:  readonly leaseTtlMs: number;
packages/prism-coding-tools/src/agent/process/recovery.ts:134:    leaseTtlMs: validateCodingLimit("leaseTtlMs", limits?.leaseTtlMs ?? DEFAULT_MAX_RECOVERY_LEASE_TTL_MS, HARD_MAX_RECOVERY_LEASE_TTL_MS),
packages/prism-coding-tools/src/agent/process/sessions-monitor.ts:78:          ttlMs: host.recoveryLimits.leaseTtlMs,
packages/prism-coding-tools/src/agent/process/sessions-recovery.ts:125:      ttlMs: host.recoveryLimits.leaseTtlMs,
packages/prism-coding-tools/src/agent/process/sessions-spawn.ts:428:      ttlMs: host.recoveryLimits.leaseTtlMs,
packages/prism-coding-tools/src/agent/process/sessions-teardown.ts:215:        ttlMs: host.recoveryLimits.leaseTtlMs,
packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:136:  readonly leaseTtlMs?: number;
packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:144:  readonly leaseTtlMs: number;
packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:165:    leaseTtlMs: validateCodingLimit(
packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:166:      "leaseTtlMs",
packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:167:      options?.leaseTtlMs ?? DEFAULT_MAX_WORKSPACE_LEASE_TTL_MS,
packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:335:        ttlMs: limits.leaseTtlMs,
packages/prism-core/src/enterprise/postgres/erp-messaging.ts:123:  const leaseTtlMs = boundedInteger(input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS, "ERP outbox lease TTL", 1, HARD_LEASE_TTL_MS);
packages/prism-core/src/enterprise/postgres/erp-messaging.ts:178:      [tenantId, batchSize, claimToken, leaseTtlMs, attemptLimit],
packages/prism-core/src/enterprise/postgres/types.ts:78:  readonly leaseTtlMs?: number;
packages/prism-core/src/runtime/workflows/__tests__/admission.test.ts:57:        leaseTtlMs: 10_000,
packages/prism-core/src/runtime/workflows/__tests__/admission.test.ts:99:      leaseTtlMs: 10_000,
packages/prism-core/src/runtime/workflows/__tests__/admission.test.ts:111:      leaseTtlMs: 10_000,
packages/prism-core/src/runtime/workflows/__tests__/admission.test.ts:167:      leaseTtlMs: 50,
packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts:44:      leaseTtlMs: 100,
packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts:52:      leaseTtlMs: 100,
packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts:82:      leaseTtlMs: 10_000,
packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts:120:      leaseTtlMs: 60,
packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts:146:      leaseTtlMs: 15,
packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts:155:      leaseTtlMs: 100,
packages/prism-core/src/runtime/workflows/__tests__/saga.test.ts:30:    readonly leaseTtlMs?: number;
packages/prism-core/src/runtime/workflows/__tests__/saga.test.ts:42:    leaseTtlMs: overrides.leaseTtlMs ?? 30_000,
packages/prism-core/src/runtime/workflows/__tests__/saga.test.ts:252:    const staleRun = runSaga(saga, options({ checkpoints, leases: staleLeases, ownerId: "stale", runId: "crash-1", leaseTtlMs: 30 }));
packages/prism-core/src/runtime/workflows/__tests__/saga.test.ts:258:    const resumed = await resumeSaga(saga, options({ checkpoints, leases, ownerId: "replacement", runId: "crash-1", leaseTtlMs: 100 }));
packages/prism-core/src/runtime/workflows/__tests__/saga.test.ts:367:    const staleRun = runSaga(saga, options({ checkpoints, leases: staleLeases, ownerId: "stale", runId: "bounded-100-1", leaseTtlMs: 30 }));
packages/prism-core/src/runtime/workflows/__tests__/saga.test.ts:375:      options({ checkpoints, leases, ownerId: "replacement", runId: "bounded-100-1", leaseTtlMs: 100 }),
packages/prism-core/src/runtime/workflows/coordinator.ts:117:  readonly leaseTtlMs?: number;
packages/prism-core/src/runtime/workflows/coordinator.ts:134:  const leaseTtlMs = integer(options.leaseTtlMs ?? 30_000, "leaseTtlMs");
packages/prism-core/src/runtime/workflows/coordinator.ts:135:  const renewalIntervalMs = integer(options.renewalIntervalMs ?? Math.max(1, Math.floor(leaseTtlMs / 3)), "renewalIntervalMs");
packages/prism-core/src/runtime/workflows/coordinator.ts:148:  if (renewalIntervalMs >= leaseTtlMs) throw new WorkflowRuntimeError("renewalIntervalMs must be less than leaseTtlMs");
packages/prism-core/src/runtime/workflows/coordinator.ts:203:          ttlMs: leaseTtlMs,
packages/prism-core/src/runtime/workflows/coordinator.ts:270:            ttlMs: leaseTtlMs,
packages/prism-core/src/runtime/workflows/saga-types.ts:86:  readonly leaseTtlMs?: number;
packages/prism-core/src/runtime/workflows/saga-types.ts:182:  readonly leaseTtlMs: number;
packages/prism-core/src/runtime/workflows/saga.ts:94:    ttlMs: options.leaseTtlMs,
packages/prism-core/src/runtime/workflows/saga.ts:155:  const leaseTtlMs = positiveBoundedInteger(input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS, HARD_LEASE_TTL_MS, "leaseTtlMs");
packages/prism-core/src/runtime/workflows/saga.ts:171:    leaseTtlMs,
packages/prism-core/src/runtime/workflows/saga.ts:228:    const intervalMs = Math.max(1, Math.floor(options.leaseTtlMs / 3));
packages/prism-core/src/runtime/workflows/saga.ts:242:          ttlMs: options.leaseTtlMs,
packages/prism-core/src/runtime/workflows/schedules.ts:109:  readonly leaseTtlMs?: number;
packages/prism-core/src/runtime/workflows/schedules.ts:135:  const leaseTtlMs = positive(options.leaseTtlMs ?? DEFAULT_SCHEDULE_LEASE_TTL_MS, "leaseTtlMs");
packages/prism-core/src/runtime/workflows/schedules.ts:175:      ttlMs: leaseTtlMs,
packages/prism-core/src/runtime/workflows/schedules.ts:228:      ttlMs: leaseTtlMs,
docs/_evidence/phase116-acp-cancel-disconnect.md:23:| 4 | Replacing the connection signal with `AbortSignal.timeout(leaseTtlMs ?? 30_000)` makes the immediate-disconnect case pass under both runners | CONFIRMED |
docs/_evidence/phase116-acp-cancel-disconnect.md:87:// ponytail: the host's leaseTtlMs is reused without recovery's
docs/_evidence/phase116-acp-cancel-disconnect.md:90:signal: AbortSignal.timeout(options.recovery?.leaseTtlMs ?? 30_000),
docs/_evidence/phase116-acp-cancel-disconnect.md:165:The agent call site uses the same signal contract (`AbortSignal.timeout(leaseTtlMs ?? 30_000)`),
docs/messaging-channel-operations.md:110:When `leases` is configured, a turn acquires a lease on its binding before the claim, renews it while work is queued on the route, passes the fencing token to journal writes, and releases it when the route goes idle or the runtime stops. If release fails, the runtime keeps its in-memory lease and retries on the next idle or stop path; it never treats the binding as free. `leaseTtlMs` remains the cross-process backstop.
docs/messaging-channel-operations.md:146:All journal paths are bounded by the channel limits in [Messaging channels]\(messaging-channels.md\): `maxJournalPage` (list page, ≤ 500), `maxJournalRecordBytes` (per-record value, checked before save), `retentionDays`, `leaseTtlMs` and the input/response caps that decide what may enter or leave the journal. Durable admission is one create and (after claim) one update plus the reply records; the plan's p95 target for durable admission is < 100 ms on a reference SSD excluding network and model time. The sqlite host suite times duplicate admission (journal CAS only) and keeps a generous CI bound of 500 ms so slow runners do not flake; treat 100 ms as the operator target, not the CI gate.
docs/messaging-channel-operations.md:148:Process crash injection uses `scripts/fixtures/messaging-restart-worker.mjs`: SIGKILL leaves an `executing` record for authorized `reconcile` (never a second model/tool run). `reconcile` reuses the stored checkpoint fencing token so a crashed lease holder can still be filed as `execution_unknown` without waiting out `leaseTtlMs`. Graceful shutdown is `await runtime.stop()` (host SIGTERM handler); two sqlite connections on one file defer to the binding-lease holder.
docs/messaging-channels.md:126:| `leaseTtlMs` | 30 s | 5 min |
docs/workflows.md:117:`createWorkflowCoordinator({ coordinatorId, workflows, checkpoints, leases, ... })` polls queued/running checkpoints with bounded pages, atomically claims each run, renews its lease, and aborts/fences work after lease loss. Key controls: `leaseTtlMs` (default 30s), `renewalIntervalMs` (default TTL/3), `pollIntervalMs` (default 1s), `maxConcurrentRuns` (default 4), and `pageSize` (default 100, maximum 500). Optional `admission` wraps claims: cursor wrap across pages (default 4 pages/poll, hard 16) so a noisy first page cannot starve later tenants; `perTenant` / `perClass` cap concurrent claims on that worker; `deadlineMs` skips stale `createdAt`; `drain` stops new claims while draining and aborts in-flight after `snapshot().expired`. Workload class is `metadata.workloadClass` (`^[a-z][a-z0-9_-]{0,31}$`, else `default`). `onMetric` labels are `outcome` + `class` only — never tenant or run ids. This is not a second scheduler.
docs/workflows.md:119:`defineSaga({ id, revision, steps })` validates a bounded linear definition. Each step supplies `run`, `compensate`, and `reconcile`; handlers receive a stable tenant-scoped `operationId`, redacted bounded input/output, prior outputs, and an abort signal. `runSaga(definition, { checkpoints, leases, ownerId, tenantId, runId?, input?, maxAttempts?, leaseTtlMs?, redactor?, onEvent? })` stores a surrogate workflow checkpoint through `WorkflowCheckpointAdapter`, acquires a fenced `LeaseStore` lease, and advances one cursor at a time. `resumeSaga` takes over an expired run; it never replays durably succeeded steps. Forward or compensation handlers mark ambiguous failures with `unknown: true` (or `ERR_PRISM_SAGA_UNKNOWN`), and `reconcile` must return `succeeded`, `failed`, or `unknown` before retry.
examples/workflow-distributed-coordinator.ts:43:      leaseTtlMs: 1_000,
examples/workflow-distributed-coordinator.ts:51:      leaseTtlMs: 1_000,
scripts/fixtures/phase26-coding-journey.mjs:525:    const limits = { leaseTtlMs: 3_000 };
scripts/phase26-freeze-manifest.json:682:      "leaseTtlMs": "30000 / 300000",
scripts/phase26-freeze-manifest.json:686:      "leaseTtlMs": "30000 / 300000",
scripts/phase26-recovery-conformance.test.mjs:142:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:156:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:179:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:206:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:234:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:246:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:266:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase26-recovery-conformance.test.mjs:279:          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
scripts/phase27-erp-journey.test.mjs:457:      leaseTtlMs: LEASE_TTL_MS,
scripts/phase27-erp-journey.test.mjs:474:      leaseTtlMs: LEASE_TTL_MS,
scripts/phase27-erp-journey.test.mjs:485:      leaseTtlMs: LEASE_TTL_MS,
scripts/phase27-freeze-manifest.json:224:    "leaseTtlMsDefault": 30000,
scripts/phase27-freeze-manifest.json:225:    "leaseTtlMsHard": 300000,
scripts/phase27-freeze.test.mjs:111:  assert.equal(manifest.frozenCaps.leaseTtlMsDefault, 30_000);
scripts/phase27-freeze.test.mjs:112:  assert.equal(manifest.frozenCaps.leaseTtlMsHard, 300_000);
```

The only ACP `recovery.leaseTtlMs` hits are the option's own definition cluster and one
test seam:

The transcript above is verbatim except one `docs/messaging-channel-operations.md` line,
whose markdown link is escaped (`\]\(`) so this evidence file does not itself trip
`docs.test.ts`'s local-link check; that line is a channel-journal doc, not an ACP host.

- `packages/ag-ui/src/acp/agent/recovery.ts:62` (`CreateAcpRunRecoveryOptions.leaseTtlMs`),
  `:167-169` (clamp + `ERR_PRISM_RECOVERY_LIMIT`).
- `packages/ag-ui/src/acp/agent/types.ts:95` (the agent option shape).
- `packages/ag-ui/src/acp/agent/core.ts:172` (pass-through), `:447-450` (cancel call site).
- `packages/ag-ui/src/__tests__/acp-recovery.test.ts:85,92` (the `makeRecovery` test helper).

Both in-repo host constructions omit the option:

- `examples/acp-coding-host.ts:29` — `createPrismAcpAgent` with no `recovery` block.
- `scripts/fixtures/phase26-coding-journey.mjs:340,636` — `recovery: { checkpoints, leases, ownerId: "replica-a" }`, no `leaseTtlMs`.

Every other `leaseTtlMs` in the transcript belongs to a different seam (`prism-channels`
signal/telegram/limits, `prism-coding-tools` process/workspace recovery, `prism-core`
workflows/ERP/schedules), not the ACP recovery option.

Reads:

```ts
// packages/ag-ui/src/acp/agent/recovery.ts
const DEFAULT_CANCEL_LEASE_TTL_MS = 30_000;
const HARD_CANCEL_LEASE_TTL_MS = 300_000;
...
const leaseTtlMs = Math.min(options.leaseTtlMs ?? DEFAULT_CANCEL_LEASE_TTL_MS, HARD_CANCEL_LEASE_TTL_MS);
if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1_000) {
  throw new AcpRecoveryError("ERR_PRISM_RECOVERY_LIMIT", `leaseTtlMs must be a positive safe integer`);
}
```

```ts
// packages/ag-ui/src/acp/agent/core.ts — session/cancel call site
signal: AbortSignal.timeout(options.recovery?.leaseTtlMs ?? 30_000),
```

Verdict: highest configured value found — none. No in-repo host sets
`recovery.leaseTtlMs`; the default `30_000` is what every host gets and the hard cap
`300_000` is never reached, so the call site and `createAcpRunRecovery` always resolve the
same TTL. Task 1 closes as a no-op: no internal `cancel-lease.ts` module, no code change,
`scripts/compat-baseline/arnilo__prism-ag-ui.txt` and the `/acp` export list untouched.

Trigger: a host configures `recovery.leaseTtlMs > 300_000`.

---

## 8. SDK handler completion — plan 118 Task 2 (trigger-gated no-op)

Date: 2026-09-23. Plan 116 Further Action 2 / Compromises 2: plan 116's bounded-write
proof is primitive-level because the pinned SDK had no way to await an in-flight
notification handler (`session/cancel`) after `session/close`/disconnect. Re-probe at the
pin boundary: does the pinned SDK expose a public await for an in-flight handler?

Pin and installed version:

```text
$ grep -n "agentclientprotocol" packages/ag-ui/package.json
37:    "@agentclientprotocol/sdk": "1.4.0"
$ node -p "require('./node_modules/@agentclientprotocol/sdk/package.json').version"
1.4.0
```

The three inspected symbols on 1.4.0:

```js
// node_modules/@agentclientprotocol/sdk/dist/acp.js:583-585 — the handler is called,
// its promise is passed to the builder; nothing awaits or retains it here
function registerAppNotification(builder, spec, context, handler) {
    builder.onReceiveNotification(spec.method, (params) => parseParams(spec.params, params), (params, cx) => handler(context(params, cx, cx.signal)));
}
```

```js
// node_modules/@agentclientprotocol/sdk/dist/jsonrpc.js:942-953 — the dispatch loop
// does await the handler inside handleMessage ...
onReceiveNotification(method, parse, handler) {
    return this.withHandler({
        handleMessage: async (message, cx) => {
            ...
            return (await handler(notification, cx)) ?? Handled.yes();
        },
        ...
    });
}
```

```js
// ... but the receive loop invokes processIncomingMessage fire-and-forget
// (jsonrpc.js:738, same shape at :439 for the batch path):
return this.processIncomingMessage(this.toIncomingMessage(message, sendResponse, batchSize)).catch((error) => this.close(error));
```

`Connection.closed` (`acp.d.ts:117`, `jsonrpc.js:604-608`) resolves when `close()` aborts
the connection's `AbortController` — i.e. at transport close — and no in-flight
notification promise is tracked: the handler keeps running after `closed` resolves, exactly
as plan 116 observed.

Upstream next boundary: the pin is `1.4.0`; the next published version is `1.5.0`
(2026-09-21). Its release notes list only schema updates (v1.22.0/v2.0.0-alpha.4 and
v1.23.0/v2.0.0-alpha.5). A tarball check of `1.5.0` confirms the same fire-and-forget
dispatch (`dist/jsonrpc.js:439,738`; `registerAppNotification` unchanged at
`dist/acp.js:583`) and the same transport-close `closed` promise — no in-flight handler
await or teardown await was added.

Verdict: no public seam in the pin (`1.4.0`) or the next published boundary (`1.5.0`).
Task 2 closes as a no-op: no agent-level case is added to `acp-recovery.test.ts`; plan 116's
immediate-disconnect case and bounded primitive case stay as the proof. No SDK internals are
monkey-patched and no test-only SDK seam exists to patch.

Trigger: the next `@agentclientprotocol/sdk` pin bump that exposes an in-flight handler
promise or a teardown await.

---

## 9. `session/close` vs an in-flight durable write — plan 118 Task 3 (probe + contract)

Date: 2026-09-23. Plan 116 Further Action 3: does `session/close` abort a durable cancel
write already in flight? Probe with a runnable case,
`packages/ag-ui/src/__tests__/acp-recovery.test.ts` — "session/close does not abort an
in-flight durable cancel write": a live prompt whose provider hangs until the run
controller aborts; `session/cancel`; the cancel-namespace `saveCheckpoint` is gated so the
write is provably in flight; `session/close` (a request — the close handler completes before
its response); the gate is released after close; then the test asserts the marker is present,
the run controller aborted, and `recovery.status` reports `cancelled`.

Both runners:

```text
$ bun test --timeout=0 src/__tests__/acp-recovery.test.ts
(pass) ACP agent wiring > session/close does not abort an in-flight durable cancel write [2.13ms]
 18 pass
 0 fail
Ran 18 tests across 1 file. [162.00ms]
```

```text
$ node --test packages/ag-ui/dist/__tests__/acp-recovery.test.js
  ✔ session/close does not abort an in-flight durable cancel write (3.410438ms)
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

The close handler in `packages/ag-ui/src/acp/agent/core.ts:456-464`:

```ts
.onRequest(methods.agent.session.close, async (context) => {
  const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
  if (!authorization) throw new Error("Unauthorized ACP session");
  await restore(authorization, context.signal);
  if (options.sessionStore) await options.sessionStore.evict(context.params.sessionId, context.signal); // evict first: a failed store write surfaces before the session is torn down
  const current = sessions.get(context.params.sessionId);
  current?.controller?.abort(new Error("ACP session closed"));
  sessions.delete(context.params.sessionId);
});
```

It evicts the persisted session, aborts the live controller, and deletes the in-memory
session; it never calls `runRecovery.cancel`/`status` and never touches the cancel lease, so
the in-flight marker write is unaffected and the lease release remains the cancel path's own
`finally` (best effort; expiry is the backstop).

Verdict: `session/close` does not abort a durable cancel write already in flight; the write
stays bounded by the cancel-lease TTL, the controller is aborted, and the run reports
`cancelled`. `docs/acp.md`'s active-run recovery bullet states this in one clause and keeps
the "a cancelled run reports `cancelled` and must not be resumed" statement intact.

No behavior change: no session-scoped controller is introduced and the connection signal is
not reintroduced.

Trigger: a host reports durable work continuing after `session/close`.
