/**
 * Durable managed-process recovery (plan 026 Task 5).
 *
 * Metadata-only recovery records over CheckpointStore CAS + LeaseStore fencing.
 * A durable record captures bounded process intent and lifecycle metadata —
 * never a child/PTY handle, controller, promise, raw output, env, token, or
 * credential. Recovery is attach-if-attested: a host `ProcessRecoveryBackend`
 * may reattach an opaque non-secret `backendRef`; otherwise `starting|running`
 * records atomically become `unknown` with no fabricated exit code, and no
 * PID probing or process survival claim is ever made.
 *
 * This module is the pure codec/storage seam: validation, record build, bounded
 * checkpoint/lease access, and the bounded attach deadline. The ProcessSessions
 * state machine (sessions.ts) owns when records are written and how a recovered
 * handle is wired back into the live registry.
 */
import { isAbsolute } from "node:path";
import type { CheckpointStore, LeaseStore, LeaseRecord, OwnershipScope } from "@arnilo/prism";
import {
  DEFAULT_MAX_RECOVERY_ATTACH_TIMEOUT_MS,
  DEFAULT_MAX_RECOVERY_BACKEND_REF_BYTES,
  DEFAULT_MAX_RECOVERY_LEASE_TTL_MS,
  DEFAULT_MAX_RECOVERY_RECORD_BYTES,
  DEFAULT_MAX_RECOVERY_RECORDS,
  HARD_MAX_RECOVERY_ATTACH_TIMEOUT_MS,
  HARD_MAX_RECOVERY_BACKEND_REF_BYTES,
  HARD_MAX_RECOVERY_LEASE_TTL_MS,
  HARD_MAX_RECOVERY_RECORD_BYTES,
  HARD_MAX_RECOVERY_RECORDS,
  validateCodingLimit,
} from "../limits.js";
import type { ProcessPtyHandle, ProcessSandboxHandle, ProcessSessionState } from "./types.js";

/** Versioned durable namespace for managed-process recovery records (separate from CodingCheckpointMetadata v1). */
export const PROCESS_RECOVERY_NAMESPACE = "prism.coding-agent.process.v1";
/** Namespace for per-record recovery leases. */
export const PROCESS_RECOVERY_LEASE_NAMESPACE = "prism.coding-agent.process.lease.v1";
export const PROCESS_RECOVERY_SCHEMA_VERSION = 1;
export const PROCESS_RECOVERY_CATEGORY = "coding-process";

export type ProcessRecoveryOutcome = "attached" | "terminal" | "unknown";

/** One durable process recovery record. Metadata only — no handles, no output, no secrets. */
export interface ProcessRecoveryRecord {
  readonly schemaVersion: typeof PROCESS_RECOVERY_SCHEMA_VERSION;
  /** ProcessSessions session id (`proc_<hex>`); also the checkpoint key. */
  readonly id: string;
  readonly owner: string;
  readonly workspace: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly commandFingerprint: string;
  readonly policyDecision: string;
  readonly startedAt: string;
  readonly state: ProcessSessionState;
  readonly exitCode: number | null;
  readonly releaseOnCancel: boolean;
  readonly expiresAt: number;
  /** Opaque non-secret host reattachment ref; absent => no attach possible. */
  readonly backendRef?: string;
  /** Bounded PTY geometry metadata only (never terminal output); resolved columns/rows/term. */
  readonly pty?: { readonly columns: number; readonly rows: number; readonly term: string };
  /** Monotonic lease fencing token from the record's recovery lease. */
  readonly fencingToken: number;
  readonly updatedAt: string;
}

/** Host-attested reattachment capability. `attach` resolves an opaque ref to a live handle or returns null. */
export interface ProcessRecoveryBackend {
  /**
   * Resolve an opaque non-secret ref to a live process handle. Return null when
   * the ref cannot be attested. Throwing is treated as attach failure and the
   * record becomes unknown; backend error text is never surfaced.
   */
  attach(ref: string): Promise<ProcessPtyHandle | ProcessSandboxHandle | null> | ProcessPtyHandle | ProcessSandboxHandle | null;
}

/** Per-record recovery report entry. */
export interface ProcessRecoveryRecordReport {
  readonly id: string;
  readonly outcome: ProcessRecoveryOutcome;
  readonly state: ProcessSessionState;
  readonly exitCode: number | null;
  /** Generic failure code when the record could not be attached or transitioned (never backend error text). */
  readonly error?: ProcessRecoveryErrorCode;
}

/** Bounded recover() report. */
export interface ProcessRecoveryReport {
  readonly records: readonly ProcessRecoveryRecordReport[];
  readonly attached: number;
  readonly terminal: number;
  readonly unknown: number;
}

export type ProcessRecoveryErrorCode =
  | "ERR_PRISM_RECOVERY_UNSUPPORTED"
  | "ERR_PRISM_RECOVERY_LIMIT"
  | "ERR_PRISM_RECOVERY_OWNERSHIP"
  | "ERR_PRISM_RECOVERY_FENCE"
  | "ERR_PRISM_RECOVERY_UNKNOWN"
  | "ERR_PRISM_RECOVERY_UNTRUSTED"
  | "ERR_PRISM_RECOVERY_TIMEOUT";

/** Stable typed failures for the recovery seam. */
export class ProcessRecoveryError extends Error {
  readonly code: ProcessRecoveryErrorCode;
  constructor(code: ProcessRecoveryErrorCode, message: string) {
    super(message);
    this.name = "ProcessRecoveryError";
    this.code = code;
  }
}

export interface ProcessRecoveryLimits {
  readonly maxRecords?: number;
  readonly leaseTtlMs?: number;
  readonly attachTimeoutMs?: number;
  readonly backendRefBytes?: number;
  readonly recordBytes?: number;
}

export interface ResolvedProcessRecoveryLimits {
  readonly maxRecords: number;
  readonly leaseTtlMs: number;
  readonly attachTimeoutMs: number;
  readonly backendRefBytes: number;
  readonly recordBytes: number;
}

export function resolveProcessRecoveryLimits(limits?: ProcessRecoveryLimits): ResolvedProcessRecoveryLimits {
  return {
    maxRecords: validateCodingLimit("maxRecords", limits?.maxRecords ?? DEFAULT_MAX_RECOVERY_RECORDS, HARD_MAX_RECOVERY_RECORDS),
    leaseTtlMs: validateCodingLimit("leaseTtlMs", limits?.leaseTtlMs ?? DEFAULT_MAX_RECOVERY_LEASE_TTL_MS, HARD_MAX_RECOVERY_LEASE_TTL_MS),
    attachTimeoutMs: validateCodingLimit(
      "attachTimeoutMs",
      limits?.attachTimeoutMs ?? DEFAULT_MAX_RECOVERY_ATTACH_TIMEOUT_MS,
      HARD_MAX_RECOVERY_ATTACH_TIMEOUT_MS,
    ),
    backendRefBytes: validateCodingLimit(
      "backendRefBytes",
      limits?.backendRefBytes ?? DEFAULT_MAX_RECOVERY_BACKEND_REF_BYTES,
      HARD_MAX_RECOVERY_BACKEND_REF_BYTES,
    ),
    recordBytes: validateCodingLimit(
      "recordBytes",
      limits?.recordBytes ?? DEFAULT_MAX_RECOVERY_RECORD_BYTES,
      HARD_MAX_RECOVERY_RECORD_BYTES,
    ),
  };
}

const STATE_SET: ReadonlySet<string> = new Set(["starting", "running", "exited", "killed", "released", "expired", "unknown"]);

/** Bounded validation of one recovery record. Corrupt/oversized/foreign records fail closed. */
export function validateProcessRecoveryRecord(record: unknown, limits: ResolvedProcessRecoveryLimits): ProcessRecoveryRecord {
  if (typeof record !== "object" || record === null) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "recovery record is not an object");
  }
  const value = record as Record<string, unknown>;
  if (value.schemaVersion !== PROCESS_RECOVERY_SCHEMA_VERSION) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", `unsupported recovery record schema version`);
  }
  const id = value.id;
  if (typeof id !== "string" || !/^proc_[0-9a-f]{16}$/.test(id)) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery record id");
  }
  for (const forbidden of ["env", "token", "credential", "secret", "output", "stdout", "stderr", "commandOutput", "rawOutput"]) {
    if (forbidden in value) {
      throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", `forbidden field ${forbidden} in recovery record`);
    }
  }
  const { owner, workspace, command, args, commandFingerprint, policyDecision, startedAt, state, releaseOnCancel, updatedAt } = value;
  const exitCode = value.exitCode as number | null | undefined;
  const expiresAt = value.expiresAt as number | undefined;
  const fencingToken = value.fencingToken as number | undefined;
  if (typeof owner !== "string" || owner.length === 0 || Buffer.byteLength(owner, "utf8") > 512) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery owner");
  }
  if (typeof workspace !== "string" || !isAbsolute(workspace) || Buffer.byteLength(workspace, "utf8") > 4096) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery workspace");
  }
  if (typeof command !== "string" || command.length === 0 || Buffer.byteLength(command, "utf8") > 4096) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery command");
  }
  if (!Array.isArray(args) || args.length > 64) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery args");
  }
  for (const arg of args) {
    if (typeof arg !== "string" || Buffer.byteLength(arg, "utf8") > 4096) {
      throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery arg");
    }
  }
  if (typeof commandFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(commandFingerprint)) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery command fingerprint");
  }
  if (typeof policyDecision !== "string" || Buffer.byteLength(policyDecision, "utf8") > 512) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery policy decision");
  }
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery startedAt");
  }
  if (typeof state !== "string" || !STATE_SET.has(state)) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery state");
  }
  if (exitCode !== null && exitCode !== undefined && (!Number.isSafeInteger(exitCode) || exitCode < 0)) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery exitCode");
  }
  if (exitCode === undefined) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery exitCode");
  }
  if (typeof releaseOnCancel !== "boolean") {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery releaseOnCancel");
  }
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery expiresAt");
  }
  if (typeof fencingToken !== "number" || !Number.isSafeInteger(fencingToken) || fencingToken < 0) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery fencingToken");
  }
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery updatedAt");
  }
  let backendRef: string | undefined;
  if (value.backendRef !== undefined) {
    backendRef = validateBackendRef(value.backendRef, limits);
  }
  let pty: { columns: number; rows: number; term: string } | undefined;
  if (value.pty !== undefined) {
    const raw = value.pty as Record<string, unknown>;
    const columns = raw.columns as number | undefined;
    const rows = raw.rows as number | undefined;
    const term = raw.term as string | undefined;
    if (
      typeof columns !== "number" ||
      !Number.isSafeInteger(columns) ||
      columns < 1 ||
      columns > 500 ||
      typeof rows !== "number" ||
      !Number.isSafeInteger(rows) ||
      rows < 1 ||
      rows > 200
    ) {
      throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery pty geometry");
    }
    if (typeof term !== "string" || Buffer.byteLength(term, "utf8") > 256) {
      throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed recovery pty term");
    }
    pty = { columns, rows, term };
  }
  const recordValue: ProcessRecoveryRecord = {
    schemaVersion: PROCESS_RECOVERY_SCHEMA_VERSION,
    id,
    owner,
    workspace,
    command,
    args: [...args],
    commandFingerprint,
    policyDecision,
    startedAt,
    state: state as ProcessSessionState,
    exitCode,
    releaseOnCancel,
    expiresAt,
    ...(backendRef !== undefined ? { backendRef } : {}),
    ...(pty !== undefined ? { pty } : {}),
    fencingToken,
    updatedAt,
  };
  if (Buffer.byteLength(JSON.stringify(recordValue), "utf8") > limits.recordBytes) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_LIMIT", `recovery record exceeds ${limits.recordBytes} bytes`);
  }
  return recordValue;
}

/** Validate one opaque backend ref (non-secret, bounded, control-free). */
export function validateBackendRef(ref: unknown, limits: ResolvedProcessRecoveryLimits): string {
  if (typeof ref !== "string" || ref.length === 0 || Buffer.byteLength(ref, "utf8") > limits.backendRefBytes) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", `invalid backend ref (max ${limits.backendRefBytes} bytes)`);
  }
  if (/[\u0000-\u001f\u007f]/.test(ref)) {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "backend ref contains control characters");
  }
  return ref;
}

/** Build a fresh record for an in-memory session (intent or transition). */
export function buildProcessRecoveryRecord(input: {
  readonly id: string;
  readonly owner: string;
  readonly workspace: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly commandFingerprint: string;
  readonly policyDecision: string;
  readonly startedAt: string;
  readonly state: ProcessSessionState;
  readonly exitCode: number | null;
  readonly releaseOnCancel: boolean;
  readonly expiresAt: number;
  readonly backendRef?: string;
  readonly pty?: { readonly columns: number; readonly rows: number; readonly term: string };
  readonly fencingToken: number;
  readonly updatedAt?: string;
}): ProcessRecoveryRecord {
  const record: ProcessRecoveryRecord = {
    schemaVersion: PROCESS_RECOVERY_SCHEMA_VERSION,
    id: input.id,
    owner: input.owner,
    workspace: input.workspace,
    command: input.command,
    args: [...input.args],
    commandFingerprint: input.commandFingerprint,
    policyDecision: input.policyDecision,
    startedAt: input.startedAt,
    state: input.state,
    exitCode: input.exitCode,
    releaseOnCancel: input.releaseOnCancel,
    expiresAt: input.expiresAt,
    ...(input.backendRef !== undefined ? { backendRef: input.backendRef } : {}),
    ...(input.pty !== undefined ? { pty: input.pty } : {}),
    fencingToken: input.fencingToken,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  return record;
}

export interface RecoveryRecordPage {
  readonly records: ReadonlyArray<{ readonly record: ProcessRecoveryRecord; readonly version: number }>;
}

/** Bounded load of recovery records under one ownership scope (O(maxRecords)). */
export async function loadProcessRecoveryRecords(input: {
  readonly checkpoints: CheckpointStore;
  readonly limits: ResolvedProcessRecoveryLimits;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}): Promise<RecoveryRecordPage> {
  const page = await input.checkpoints.listCheckpoints({
    namespace: PROCESS_RECOVERY_NAMESPACE,
    keyPrefix: "proc_",
    category: PROCESS_RECOVERY_CATEGORY,
    limit: input.limits.maxRecords,
    ...input.ownership,
    signal: input.signal,
  });
  const records: Array<{ readonly record: ProcessRecoveryRecord; readonly version: number }> = [];
  for (const item of page.items) {
    try {
      records.push({ record: validateProcessRecoveryRecord(item.value, input.limits), version: item.version });
    } catch (error) {
      if (error instanceof ProcessRecoveryError && error.code === "ERR_PRISM_RECOVERY_LIMIT") throw error;
      void error; // Corrupt/foreign records fail closed: dropped, never recovered, never fabricated.
    }
  }
  return { records };
}

/** Load one recovery record by session id (null when absent or corrupt). */
export async function loadProcessRecoveryRecord(input: {
  readonly checkpoints: CheckpointStore;
  readonly id: string;
  readonly limits: ResolvedProcessRecoveryLimits;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}): Promise<{ readonly record: ProcessRecoveryRecord; readonly version: number } | null> {
  const item = await input.checkpoints.loadCheckpoint({
    namespace: PROCESS_RECOVERY_NAMESPACE,
    key: input.id,
    ...input.ownership,
    signal: input.signal,
  });
  if (!item) return null;
  try {
    return { record: validateProcessRecoveryRecord(item.value, input.limits), version: item.version };
  } catch {
    return null; // corrupt record fails closed
  }
}

/** CAS save of one recovery record. Fence/version conflicts throw ERR_PRISM_RECOVERY_FENCE. */
export async function saveProcessRecoveryRecord(input: {
  readonly checkpoints: CheckpointStore;
  readonly record: ProcessRecoveryRecord;
  readonly expectedVersion: number;
  readonly version: number;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}): Promise<{ readonly version: number }> {
  try {
    const saved = await input.checkpoints.saveCheckpoint({
      namespace: PROCESS_RECOVERY_NAMESPACE,
      key: input.record.id,
      category: PROCESS_RECOVERY_CATEGORY,
      value: input.record,
      version: input.version,
      expectedVersion: input.expectedVersion,
      fencingToken: input.record.fencingToken,
      ...input.ownership,
      signal: input.signal,
    });
    return { version: saved.version };
  } catch {
    throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_FENCE", "recovery record CAS or fencing conflict");
  }
}

/** Delete one recovery record (false when absent). */
export async function deleteProcessRecoveryRecord(input: {
  readonly checkpoints: CheckpointStore;
  readonly id: string;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}): Promise<boolean> {
  return input.checkpoints.deleteCheckpoint({
    namespace: PROCESS_RECOVERY_NAMESPACE,
    key: input.id,
    ...input.ownership,
    signal: input.signal,
  });
}

/** Acquire the per-record recovery lease; null => another replica owns or is recovering the record. */
export async function acquireRecordLease(input: {
  readonly leases: LeaseStore;
  readonly id: string;
  readonly ownerId: string;
  readonly ttlMs: number;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}): Promise<LeaseRecord | null> {
  try {
    return await input.leases.tryAcquireLease({
      namespace: PROCESS_RECOVERY_LEASE_NAMESPACE,
      key: `recover:${input.id}`,
      ownerId: input.ownerId,
      ttlMs: input.ttlMs,
      ...input.ownership,
      signal: input.signal,
    });
  } catch (error) {
    if (isOwnershipConflict(error)) {
      throw new ProcessRecoveryError("ERR_PRISM_RECOVERY_OWNERSHIP", "recovery lease ownership mismatch");
    }
    throw error;
  }
}

/** Release a recovery lease (best effort; ignores conflicts). */
export async function releaseRecordLease(input: {
  readonly leases: LeaseStore;
  readonly id: string;
  readonly ownerId: string;
  readonly token: string;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}): Promise<void> {
  try {
    await input.leases.releaseLease({
      namespace: PROCESS_RECOVERY_LEASE_NAMESPACE,
      key: `recover:${input.id}`,
      ownerId: input.ownerId,
      token: input.token,
      ...input.ownership,
      signal: input.signal,
    });
  } catch {
    // best effort: lease expiry is the backstop
  }
}

/** Bounded attach deadline: a backend that does not answer within attachTimeoutMs fails closed. */
export async function attachWithTimeout(
  backend: ProcessRecoveryBackend,
  ref: string,
  timeoutMs: number,
): Promise<ProcessPtyHandle | ProcessSandboxHandle | null> {
  return await new Promise<ProcessPtyHandle | ProcessSandboxHandle | null>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ProcessRecoveryError("ERR_PRISM_RECOVERY_TIMEOUT", `recovery attach timed out (${timeoutMs}ms)`)),
      timeoutMs,
    );
    Promise.resolve()
      .then(() => backend.attach(ref))
      .then(
        (handle) => {
          clearTimeout(timer);
          resolve(handle);
        },
        (error) => {
          clearTimeout(timer);
          reject(
            error instanceof ProcessRecoveryError
              ? error
              : new ProcessRecoveryError("ERR_PRISM_RECOVERY_UNKNOWN", "recovery attach failed"),
          );
        },
      );
  });
}

/** True when a checkpoint load/save failure is an ownership conflict (fail closed as OWNERSHIP). */
export function isOwnershipConflict(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ERR_PRISM_LEASE_CONFLICT"
  );
}
