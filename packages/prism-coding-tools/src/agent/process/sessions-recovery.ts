/**
 * Durable recover / reattach phase for managed process sessions.
 */
import { OutputAccumulator } from "../output-accumulator.js";
import {
  acquireRecordLease,
  attachWithTimeout,
  buildProcessRecoveryRecord,
  loadProcessRecoveryRecord,
  loadProcessRecoveryRecords,
  ProcessRecoveryError,
  type ProcessRecoveryRecord,
  type ProcessRecoveryRecordReport,
  type ProcessRecoveryReport,
  releaseRecordLease,
  saveProcessRecoveryRecord,
} from "./recovery.js";
import { assertNotDisposed, isTerminalState, nowIso, type SessionRecord, type SessionsHost } from "./sessions-host.js";
import { persistRecoveryUnknown } from "./sessions-monitor.js";
import { makeHandle } from "./sessions-spawn.js";
import { sweepExpired, terminateRecord } from "./sessions-teardown.js";
import type { ProcessPtyHandle, ProcessSandboxHandle, ProcessSession } from "./types.js";

// Reattach an attested handle into the live registry. Recovered sessions
// expose control (input/signal/kill/release/resize/wait) through the handle;
// output streaming is not re-established after a restart — the host backend
// owns any buffered output behind its opaque ref.
export function attachRecoveredHandle(
  host: SessionsHost,
  current: ProcessRecoveryRecord,
  handle: ProcessPtyHandle | ProcessSandboxHandle,
  version: number,
): void {
  const accumulator = new OutputAccumulator({
    maxBytes: host.limits.maxOutputChunkBytes,
    maxLines: 100_000,
    maxTotalOutputBytes: host.limits.maxTotalOutputBytes,
    tempFilePrefix: "prism-proc",
  });
  const record: SessionRecord = {
    id: current.id,
    owner: current.owner,
    workspace: current.workspace,
    command: current.command,
    args: current.args,
    commandFingerprint: current.commandFingerprint,
    policyDecision: current.policyDecision,
    startedAt: current.startedAt,
    releaseOnCancel: current.releaseOnCancel,
    expiresAt: current.expiresAt,
    state: "running",
    exitCode: null,
    ptyTerminal: current.pty,
    ptyResizeAt: [],
    accumulator,
    waiters: [],
    stdinClosed: false,
    handle: null as unknown as ProcessSession,
    backendRef: current.backendRef,
    recoveryFencingToken: current.fencingToken,
    recoveryVersion: version,
  };
  if (current.pty !== undefined) {
    record.pty = handle as ProcessPtyHandle;
  } else {
    record.backend = handle as ProcessSandboxHandle;
  }
  record.handle = makeHandle(host, record);
  host.sessions.set(record.id, record);
  void handle
    .wait()
    .then((result) => {
      if (record.state !== "running" && record.state !== "starting") return;
      terminateRecord(host, record, "exited", result.exitCode);
    })
    .catch(() => {
      if (record.state !== "running" && record.state !== "starting") return;
      terminateRecord(host, record, "unknown", null);
    });
}

export async function recoverSessions(host: SessionsHost, recoverOptions?: { signal?: AbortSignal }): Promise<ProcessRecoveryReport> {
  assertNotDisposed(host);
  if (!host.durable) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNSUPPORTED", "durable process recovery is not configured on this host");
  }
  sweepExpired(host);
  const { records } = await loadProcessRecoveryRecords({
    checkpoints: host.checkpoints!,
    limits: host.recoveryLimits,
    ownership: host.ownership,
    signal: recoverOptions?.signal,
  });
  const report: ProcessRecoveryRecordReport[] = [];
  let attached = 0;
  let terminal = 0;
  let unknown = 0;
  for (const { record } of records) {
    const live = host.sessions.get(record.id);
    if (live) {
      // Already live in this registry: nothing to do, report the truth.
      report.push({ id: record.id, outcome: "attached", state: live.state, exitCode: live.exitCode });
      if (live.state === "running" || live.state === "starting") attached += 1;
      else terminal += 1;
      continue;
    }
    if (
      record.state === "exited" ||
      record.state === "killed" ||
      record.state === "released" ||
      record.state === "expired" ||
      record.state === "unknown"
    ) {
      report.push({ id: record.id, outcome: "terminal", state: record.state, exitCode: record.exitCode });
      terminal += 1;
      continue;
    }
    // starting | running durable record without a live handle: attach-if-
    // attested, else atomic unknown. Never fabricate an exit code.
    const lease = await acquireRecordLease({
      leases: host.leases!,
      id: record.id,
      ownerId: host.ownerId!,
      ttlMs: host.recoveryLimits.leaseTtlMs,
      ownership: host.ownership,
      signal: recoverOptions?.signal,
    });
    if (!lease) {
      // Another replica owns or is recovering this record.
      report.push({ id: record.id, outcome: "unknown", state: record.state, exitCode: null });
      unknown += 1;
      continue;
    }
    try {
      // Fresh CAS read under the lease: another replica may have moved the record.
      const fresh = await loadProcessRecoveryRecord({
        checkpoints: host.checkpoints!,
        id: record.id,
        limits: host.recoveryLimits,
        ownership: host.ownership,
        signal: recoverOptions?.signal,
      });
      if (!fresh) {
        report.push({ id: record.id, outcome: "terminal", state: "unknown", exitCode: null, error: "ERR_PRISM_RECOVERY_UNKNOWN" });
        terminal += 1;
        continue;
      }
      const current = fresh.record;
      if (
        current.state === "exited" ||
        current.state === "killed" ||
        current.state === "released" ||
        current.state === "expired" ||
        current.state === "unknown"
      ) {
        report.push({ id: current.id, outcome: "terminal", state: current.state, exitCode: current.exitCode });
        terminal += 1;
        continue;
      }
      if (Date.now() >= current.expiresAt) {
        // Lifetime lapsed while unrecovered: persist the expiry.
        const expired = buildProcessRecoveryRecord({
          ...current,
          state: "expired",
          exitCode: null,
          updatedAt: nowIso(),
        });
        await saveProcessRecoveryRecord({
          checkpoints: host.checkpoints!,
          record: expired,
          expectedVersion: fresh.version,
          version: fresh.version + 1,
          ownership: host.ownership,
          signal: recoverOptions?.signal,
        });
        report.push({ id: current.id, outcome: "terminal", state: "expired", exitCode: null });
        terminal += 1;
        continue;
      }
      const active = [...host.sessions.values()].filter((s) => s.state === "running" || s.state === "starting").length;
      if (active >= host.limits.maxSessions) {
        // Cannot admit another live session: record unknown (fails closed).
        await persistRecoveryUnknown(host, current, fresh.version, recoverOptions?.signal);
        report.push({ id: current.id, outcome: "unknown", state: "unknown", exitCode: null });
        unknown += 1;
        continue;
      }
      let attachErrorCode: ProcessRecoveryRecordReport["error"];
      if (current.backendRef !== undefined && host.recoveryBackend) {
        try {
          const handle = await attachWithTimeout(host.recoveryBackend, current.backendRef, host.recoveryLimits.attachTimeoutMs);
          if (handle) {
            attachRecoveredHandle(host, current, handle, fresh.version);
            attached += 1;
            report.push({ id: current.id, outcome: "attached", state: "running", exitCode: null });
            continue;
          }
        } catch (attachError) {
          attachErrorCode = attachError instanceof ProcessRecoveryError ? attachError.code : ("ERR_PRISM_RECOVERY_UNKNOWN" as const);
        }
      }
      // No ref, no backend, unattested attach, or attach failure: atomic unknown.
      const saved = await persistRecoveryUnknown(host, current, fresh.version, recoverOptions?.signal);
      if (!saved) {
        // CAS/fence conflict: another replica moved the record; re-report its state.
        const again = await loadProcessRecoveryRecord({
          checkpoints: host.checkpoints!,
          id: current.id,
          limits: host.recoveryLimits,
          ownership: host.ownership,
          signal: recoverOptions?.signal,
        });
        const reported = again?.record;
        report.push({
          id: current.id,
          outcome: reported && isTerminalState(reported.state) ? "terminal" : "unknown",
          state: reported?.state ?? "unknown",
          exitCode: reported?.exitCode ?? null,
          error: attachErrorCode,
        });
        if (reported && isTerminalState(reported.state)) terminal += 1;
        else unknown += 1;
        continue;
      }
      report.push({ id: current.id, outcome: "unknown", state: "unknown", exitCode: null, error: attachErrorCode });
      unknown += 1;
    } finally {
      await releaseRecordLease({
        leases: host.leases!,
        id: record.id,
        ownerId: host.ownerId!,
        token: lease.token,
        ownership: host.ownership,
        signal: recoverOptions?.signal,
      });
    }
  }
  return { records: report, attached, terminal, unknown };
}
