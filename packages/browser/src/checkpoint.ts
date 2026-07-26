/**
 * Verified-state browser checkpoints (Task 6).
 *
 * A checkpoint records verified navigation state — URL, a domain-state hash,
 * and host-owned data refs — never serialized browser internals (cookies,
 * storage, contexts), which are fragile and secret-bearing. After any resume or
 * interruption the ledger requires a reload + verify before the first mutating
 * action, so side effects never replay on stale/unverified state (fail closed).
 * Checkpoints are run-scoped; a conversation thread composes through the run it
 * owns, reusing the manager's existing sandbox/egress/approval/limit policy.
 */
import { BrowserError } from "./errors.js";

/** Checkpoint URL: 8 KiB default / 16 KiB hard. */
export const DEFAULT_MAX_CHECKPOINT_URL_BYTES = 8 * 1024;
export const HARD_MAX_CHECKPOINT_URL_BYTES = 16 * 1024;
/** Domain state hash: 256 B default / 1 KiB hard. */
export const DEFAULT_MAX_DOMAIN_STATE_HASH_BYTES = 256;
export const HARD_MAX_DOMAIN_STATE_HASH_BYTES = 1024;
/** Host data ref (ref only, never a body): 2 KiB default / 8 KiB hard. */
export const DEFAULT_MAX_HOST_DATA_REF_BYTES = 2 * 1024;
export const HARD_MAX_HOST_DATA_REF_BYTES = 8 * 1024;
/** Checkpoints retained per run: 16 default / 64 hard (oldest evicted). */
export const DEFAULT_MAX_CHECKPOINTS_PER_RUN = 16;
export const HARD_MAX_CHECKPOINTS_PER_RUN = 64;

export interface BrowserCheckpoint {
  readonly checkpointId: string;
  readonly runId: string;
  readonly url: string;
  readonly domainStateHash: string;
  /** Host-owned data reference only — never a serialized browser internal or body. */
  readonly hostDataRef?: string;
  readonly createdAt: string;
  readonly verified: boolean;
}

export interface BrowserCheckpointLimits {
  readonly maxUrlBytes: number;
  readonly maxDomainStateHashBytes: number;
  readonly maxHostDataRefBytes: number;
  readonly maxCheckpointsPerRun: number;
}

export interface BrowserCheckpointLimitOptions {
  readonly maxUrlBytes?: number;
  readonly maxDomainStateHashBytes?: number;
  readonly maxHostDataRefBytes?: number;
  readonly maxCheckpointsPerRun?: number;
}

export interface BrowserCheckpointInput {
  readonly runId: string;
  readonly url: string;
  readonly domainStateHash: string;
  readonly hostDataRef?: string;
}

export interface BrowserCheckpointLedger {
  readonly limits: BrowserCheckpointLimits;
  /** Record verified state during normal operation. */
  checkpoint(input: BrowserCheckpointInput): BrowserCheckpoint;
  list(runId: string): readonly BrowserCheckpoint[];
  /** Mark a run's state stale after resume/interruption; verify required before side effect. */
  markResumed(runId: string): void;
  /** Reload + verify completed; clears the verify gate and records a fresh verified checkpoint. */
  verify(input: BrowserCheckpointInput): BrowserCheckpoint;
  /** Fail closed unless the run holds verified state (reload+verify before any mutating action). */
  assertVerifiedBeforeSideEffect(runId: string): void;
}

function validateBytes(name: string, value: string | undefined, max: number, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `${name} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `${name} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, "utf8") > max) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `${name} exceeds ${max} bytes`);
  }
  return value;
}

function validateCount(name: string, value: number | undefined, def: number, hard: number): number {
  const resolved = value ?? def;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `${name} must be a positive safe integer at most ${hard}`);
  }
  return resolved;
}

export function resolveBrowserCheckpointLimits(input: BrowserCheckpointLimitOptions = {}): BrowserCheckpointLimits {
  return {
    maxUrlBytes: validateCount("maxUrlBytes", input.maxUrlBytes, DEFAULT_MAX_CHECKPOINT_URL_BYTES, HARD_MAX_CHECKPOINT_URL_BYTES),
    maxDomainStateHashBytes: validateCount(
      "maxDomainStateHashBytes",
      input.maxDomainStateHashBytes,
      DEFAULT_MAX_DOMAIN_STATE_HASH_BYTES,
      HARD_MAX_DOMAIN_STATE_HASH_BYTES,
    ),
    maxHostDataRefBytes: validateCount(
      "maxHostDataRefBytes",
      input.maxHostDataRefBytes,
      DEFAULT_MAX_HOST_DATA_REF_BYTES,
      HARD_MAX_HOST_DATA_REF_BYTES,
    ),
    maxCheckpointsPerRun: validateCount(
      "maxCheckpointsPerRun",
      input.maxCheckpointsPerRun,
      DEFAULT_MAX_CHECKPOINTS_PER_RUN,
      HARD_MAX_CHECKPOINTS_PER_RUN,
    ),
  };
}

interface RunCheckpointState {
  readonly checkpoints: BrowserCheckpoint[];
  needsVerify: boolean;
}

let checkpointSeq = 0;
function nextCheckpointId(): string {
  checkpointSeq += 1;
  return `bcp_${checkpointSeq}`;
}

export function createBrowserCheckpointLedger(
  options: BrowserCheckpointLimitOptions = {},
): BrowserCheckpointLedger {
  const limits = resolveBrowserCheckpointLimits(options);
  const runs = new Map<string, RunCheckpointState>();

  function record(input: BrowserCheckpointInput): BrowserCheckpoint {
    const runId = validateBytes("runId", input.runId, 256, true)!;
    const url = validateBytes("url", input.url, limits.maxUrlBytes, true)!;
    const domainStateHash = validateBytes(
      "domainStateHash",
      input.domainStateHash,
      limits.maxDomainStateHashBytes,
      true,
    )!;
    const hostDataRef = validateBytes("hostDataRef", input.hostDataRef, limits.maxHostDataRefBytes, false);
    const checkpoint: BrowserCheckpoint = {
      checkpointId: nextCheckpointId(),
      runId,
      url,
      domainStateHash,
      ...(hostDataRef ? { hostDataRef } : {}),
      createdAt: new Date().toISOString(),
      verified: true,
    };
    let state = runs.get(runId);
    if (!state) {
      state = { checkpoints: [], needsVerify: false };
      runs.set(runId, state);
    }
    state.checkpoints.push(checkpoint);
    // Bounded retention: evict oldest beyond the per-run cap.
    while (state.checkpoints.length > limits.maxCheckpointsPerRun) {
      state.checkpoints.shift();
    }
    return checkpoint;
  }

  return {
    limits,
    checkpoint: (input) => record(input),
    list: (runId) => runs.get(runId)?.checkpoints ?? [],
    markResumed(runId) {
      validateBytes("runId", runId, 256, true);
      let state = runs.get(runId);
      if (!state) {
        // Resuming an unknown run is unverified state — fail closed until verify.
        state = { checkpoints: [], needsVerify: true };
        runs.set(runId, state);
      } else {
        state.needsVerify = true;
      }
    },
    verify(input) {
      const checkpoint = record(input);
      const state = runs.get(checkpoint.runId)!;
      state.needsVerify = false;
      return checkpoint;
    },
    assertVerifiedBeforeSideEffect(runId) {
      validateBytes("runId", runId, 256, true);
      const state = runs.get(runId);
      if (!state || state.needsVerify || state.checkpoints.length === 0) {
        throw new BrowserError(
          "ERR_PRISM_BROWSER_STATE",
          "browser side effect requires reload + verify after resume/interruption",
        );
      }
    },
  };
}
