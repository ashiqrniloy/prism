/**
 * Durable persist / CAS transitions for managed process sessions.
 */

import type { ProcessRecoveryRecord } from "./recovery.js";
import {
  buildProcessRecoveryRecord,
  deleteProcessRecoveryRecord,
  loadProcessRecoveryRecords,
  PROCESS_RECOVERY_LEASE_NAMESPACE,
  releaseRecordLease,
  saveProcessRecoveryRecord,
} from "./recovery.js";
import { isTerminalState, nowIso, type SessionRecord, type SessionsHost } from "./sessions-host.js";

// Durable transition write: fire-and-forget CAS (fence/version conflicts mean
// another replica moved the record first — the newer state wins). The crash
// window between a terminal transition and its durable write converges on
// recovery to attach/terminal/unknown, never a duplicate spawn.
export function persistTransition(host: SessionsHost, record: SessionRecord): void {
  if (!host.durable || record.recoveryVersion === 0) return;
  const next = buildProcessRecoveryRecord({
    id: record.id,
    owner: record.owner,
    workspace: record.workspace,
    command: record.command,
    args: record.args,
    commandFingerprint: record.commandFingerprint,
    policyDecision: record.policyDecision,
    startedAt: record.startedAt,
    state: record.state,
    exitCode: record.exitCode,
    releaseOnCancel: record.releaseOnCancel,
    expiresAt: record.expiresAt,
    ...(record.backendRef !== undefined ? { backendRef: record.backendRef } : {}),
    ...(record.ptyTerminal !== undefined ? { pty: record.ptyTerminal } : {}),
    fencingToken: record.recoveryFencingToken,
  });
  const expectedVersion = record.recoveryVersion;
  record.recoveryVersion += 1;
  const write = async (): Promise<void> => {
    try {
      await saveProcessRecoveryRecord({
        checkpoints: host.checkpoints!,
        record: next,
        expectedVersion,
        version: record.recoveryVersion,
        ownership: host.ownership,
      });
    } catch {
      // stale fence or store failure: the durable record keeps its last state
      return;
    }
    void evictRecoveryOverflow(host);
    // Terminal transition: release the record lease (clean shutdown makes
    // recovery immediate). Live running/starting transitions renew it so a
    // crashed replica's lease lapses within TTL while a live one stays
    // fenced. Best effort on both.
    if (isTerminalState(record.state)) {
      if (record.recoveryLeaseToken) {
        void releaseRecordLease({
          leases: host.leases!,
          id: record.id,
          ownerId: host.ownerId!,
          token: record.recoveryLeaseToken,
          ownership: host.ownership,
        });
        record.recoveryLeaseToken = undefined;
      }
    } else if (record.recoveryLeaseToken) {
      void host
        .leases!.renewLease({
          namespace: PROCESS_RECOVERY_LEASE_NAMESPACE,
          key: `recover:${record.id}`,
          ownerId: host.ownerId!,
          token: record.recoveryLeaseToken,
          ttlMs: host.recoveryLimits.leaseTtlMs,
          ...host.ownership,
        })
        .catch(() => {
          // lease lapsed or fenced elsewhere; recovery is attestation-gated
        });
    }
  };
  // Per-record chain: transition CAS writes must never invert order on slow
  // stores (a later terminal write landing before the running write would
  // fail its CAS and leave the record running forever).
  record.recoveryWriteChain = (record.recoveryWriteChain ?? Promise.resolve()).then(write, write);
}

// Bound durable record growth: after a terminal transition, drop the oldest
// terminal records until at most maxRecords remain (running/starting records
// are never evicted). Best effort, bounded work.
export async function evictRecoveryOverflow(host: SessionsHost): Promise<void> {
  if (!host.durable) return;
  try {
    const page = await loadProcessRecoveryRecords({
      checkpoints: host.checkpoints!,
      limits: { ...host.recoveryLimits, maxRecords: host.recoveryLimits.maxRecords + 1 },
      ownership: host.ownership,
    });
    if (page.records.length <= host.recoveryLimits.maxRecords) return;
    const overflow = page.records.length - host.recoveryLimits.maxRecords;
    let evicted = 0;
    for (const { record } of [...page.records].reverse()) {
      if (evicted >= overflow) break;
      if (record.state === "running" || record.state === "starting") continue;
      await deleteProcessRecoveryRecord({ checkpoints: host.checkpoints!, id: record.id, ownership: host.ownership });
      evicted += 1;
    }
  } catch {
    // best effort: caps are enforced again on the next transition
  }
}

// Atomic starting|running -> unknown (never an exit code). Returns false when
// a fence/version conflict means another replica moved the record first.
export async function persistRecoveryUnknown(
  host: SessionsHost,
  current: ProcessRecoveryRecord,
  version: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const next = buildProcessRecoveryRecord({ ...current, state: "unknown", exitCode: null, updatedAt: nowIso() });
  try {
    await saveProcessRecoveryRecord({
      checkpoints: host.checkpoints!,
      record: next,
      expectedVersion: version,
      version: version + 1,
      ownership: host.ownership,
      signal,
    });
    return true;
  } catch {
    return false;
  }
}
