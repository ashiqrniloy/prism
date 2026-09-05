/**
 * Terminate / cancel / dispose phases for managed process sessions.
 */
import { killProcessTree } from "../shell.js";
import { acquireRecordLease, loadProcessRecoveryRecords, releaseRecordLease } from "./recovery.js";
import { assertNotDisposed, emit, isTerminalState, nowIso, type SessionRecord, type SessionsHost, settleWaiters } from "./sessions-host.js";
import { persistRecoveryUnknown, persistTransition } from "./sessions-monitor.js";
import { ProcessSessionError, type ProcessSessionState } from "./types.js";

export function reconcileAllUnknown(host: SessionsHost): number {
  let n = 0;
  for (const record of [...host.sessions.values()]) {
    if (record.state !== "running" && record.state !== "starting") continue;
    terminateRecord(host, record, "unknown", null);
    n += 1;
  }
  return n;
}

export async function checkSandboxAlive(host: SessionsHost): Promise<void> {
  if (!host.sandbox?.status || host.sandboxLost) return;
  try {
    const status = await host.sandbox.status();
    if (status.state !== "running") {
      host.sandboxLost = true;
      reconcileAllUnknown(host);
    }
  } catch {
    host.sandboxLost = true;
    reconcileAllUnknown(host);
  }
}

export function sweepExpired(host: SessionsHost): void {
  const now = Date.now();
  for (const record of host.sessions.values()) {
    if (record.state !== "running" && record.state !== "starting") continue;
    if (now < record.expiresAt) continue;
    terminateRecord(host, record, "expired", null);
  }
}

export function terminateRecord(host: SessionsHost, record: SessionRecord, state: ProcessSessionState, exitCode: number | null): void {
  if (
    record.state === "exited" ||
    record.state === "killed" ||
    record.state === "released" ||
    record.state === "expired" ||
    record.state === "unknown"
  ) {
    return;
  }
  const child = record.child;
  const backend = record.backend;
  const pty = record.pty;
  record.child = undefined;
  record.backend = undefined;
  record.pty = undefined;
  if (state === "released") {
    try {
      child?.stdout.removeAllListeners();
      child?.stderr.removeAllListeners();
      child?.stdout.destroy();
      child?.stderr.destroy();
      child?.stdin.destroy();
      child?.unref();
    } catch {
      // best effort
    }
    void backend?.release().catch(() => undefined);
    void pty?.release().catch(() => undefined);
  } else if (state === "killed" || state === "expired" || state === "unknown") {
    if (child?.pid) {
      try {
        killProcessTree(child.pid);
      } catch {
        // best effort
      }
    }
    if (backend) {
      void backend.kill().catch(() => undefined);
    }
    if (pty) {
      void pty.kill().catch(() => undefined);
    }
  } else if (state === "exited" && child) {
    try {
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
    } catch {
      // best effort
    }
  }
  record.state = state;
  record.exitCode = state === "unknown" || state === "released" ? null : exitCode;
  record.exitedAt = nowIso();
  record.stdinClosed = true;
  try {
    record.accumulator.finish();
  } catch {
    // ignore
  }
  persistTransition(host, record);
  settleWaiters(record);
  const type =
    state === "exited"
      ? "process_exited"
      : state === "killed"
        ? "process_killed"
        : state === "released"
          ? "process_released"
          : state === "expired"
            ? "process_expired"
            : "process_unknown";
  emit(host, {
    type,
    sessionId: record.id,
    processId: record.pid !== undefined ? String(record.pid) : record.id,
    owner: record.owner,
    exitCode: record.exitCode,
    at: record.exitedAt,
  });
}

export function requireRecord(host: SessionsHost, sessionId: string, owner?: string): SessionRecord {
  assertNotDisposed(host);
  sweepExpired(host);
  const record = host.sessions.get(sessionId);
  if (!record) throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `unknown session: ${sessionId}`);
  if (owner !== undefined && owner !== record.owner) {
    throw new ProcessSessionError("ERR_PRISM_PROCESS_OWNERSHIP", "session owner mismatch");
  }
  return record;
}

export async function cancelOwned(host: SessionsHost, owner: string, cancelOptions?: { release?: boolean }): Promise<void> {
  assertNotDisposed(host);
  sweepExpired(host);
  await checkSandboxAlive(host);
  const release = cancelOptions?.release === true;
  for (const record of [...host.sessions.values()]) {
    if (record.owner !== owner) continue;
    if (record.state !== "running" && record.state !== "starting") continue;
    const cancelPty = record.pty;
    const cancelBackend = record.backend;
    if (release || record.releaseOnCancel) {
      if (cancelPty || cancelBackend) {
        terminateRecord(host, record, "released", null);
        if (cancelPty) {
          try {
            await cancelPty.release();
          } catch {
            // continue
          }
        } else {
          try {
            await cancelBackend!.release();
          } catch {
            // continue
          }
        }
      } else {
        terminateRecord(host, record, "released", null);
      }
    } else {
      if (cancelPty || cancelBackend) {
        terminateRecord(host, record, "killed", null);
        if (cancelPty) {
          try {
            await cancelPty.kill();
          } catch {
            // continue
          }
        } else {
          try {
            await cancelBackend!.kill();
          } catch {
            // continue
          }
        }
      } else {
        terminateRecord(host, record, "killed", null);
      }
    }
  }
  // Durable pass (plan 026 Task 5): cancellation of a recovered/unattached
  // process either reaches the attached backend (above) or records unknown —
  // never a fabricated exit. Lease + CAS guard every mutation so two replicas
  // cannot cancel the same record into different outcomes.
  if (host.durable) {
    const { records } = await loadProcessRecoveryRecords({
      checkpoints: host.checkpoints!,
      limits: host.recoveryLimits,
      ownership: host.ownership,
    });
    for (const { record, version } of records) {
      if (record.owner !== owner) continue;
      if (isTerminalState(record.state)) continue;
      if (host.sessions.has(record.id)) continue; // handled by the live pass above
      const lease = await acquireRecordLease({
        leases: host.leases!,
        id: record.id,
        ownerId: host.ownerId!,
        ttlMs: host.recoveryLimits.leaseTtlMs,
        ownership: host.ownership,
      });
      if (!lease) continue; // another replica owns or is recovering it
      try {
        await persistRecoveryUnknown(host, record, version);
      } finally {
        await releaseRecordLease({
          leases: host.leases!,
          id: record.id,
          ownerId: host.ownerId!,
          token: lease.token,
          ownership: host.ownership,
        });
      }
    }
  }
}

export async function disposeSessions(host: SessionsHost): Promise<void> {
  if (host.disposed) return;
  host.disposed = true;
  for (const record of [...host.sessions.values()]) {
    if (record.state === "running" || record.state === "starting") {
      if (record.pty) {
        try {
          await record.pty.kill();
        } catch {
          // best effort
        }
      }
      if (record.backend) {
        try {
          await record.backend.kill();
        } catch {
          // best effort
        }
      }
      terminateRecord(host, record, "killed", null);
    } else if (record.state === "released" && record.pid) {
      try {
        killProcessTree(record.pid);
      } catch {
        // best effort
      }
      record.pid = undefined;
    }
    try {
      await record.accumulator.cleanupTempFile();
    } catch {
      // best effort
    }
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
  }
  host.sessions.clear();
}
