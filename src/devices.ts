/**
 * Device adapter contract (realtime voice / desktop OS control) — 0.0.14.
 *
 * Contracts + deny-by-default policy ONLY. No vendor voice or desktop-control
 * implementation ships in 0.0.14 (demand-gated to 0.1.x). This module composes
 * over the existing `PermissionPolicy` / `RunLimits` / redactor seams; it adds
 * no second approval runtime and no device framework. Hosts implement
 * `DeviceAdapter`, resolve a policy, and admit sessions through the fail-closed
 * gate below. Conformance fixtures (denial/approval/stream-bounds/redaction)
 * live in `runDevicePolicyConformance` for future vendor adapters to run.
 */
import type { RunLimits } from "./contracts.js";
import { redactSecrets, type SecretRedactor } from "./redaction.js";

/** Audio / screenshot / stream chunk: 1 MiB default / 8 MiB hard. */
export const DEFAULT_DEVICE_MAX_CHUNK_BYTES = 1 * 1024 * 1024;
export const HARD_DEVICE_MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** Concurrent device sessions per identity: 1 default / 4 hard. */
export const DEFAULT_DEVICE_MAX_CONCURRENT_SESSIONS = 1;
export const HARD_DEVICE_MAX_CONCURRENT_SESSIONS = 4;

export type DeviceKind = "voice" | "desktop-control";

export type DevicePolicyErrorCode =
  | "ERR_PRISM_DEVICE_INPUT"
  | "ERR_PRISM_DEVICE_DISABLED"
  | "ERR_PRISM_DEVICE_APPROVAL"
  | "ERR_PRISM_DEVICE_SESSIONS"
  | "ERR_PRISM_DEVICE_CHUNK"
  | "ERR_PRISM_DEVICE_RUN_LIMITS";

export class DevicePolicyError extends Error {
  constructor(
    readonly code: DevicePolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DevicePolicyError";
  }
}

export interface DeviceStreamLimits {
  readonly maxChunkBytes?: number;
  readonly maxConcurrentSessions?: number;
}

/**
 * Host-declared device adapter. `enabled` is deny-by-default: a device is
 * admitted only when the host explicitly sets it `true` AND supplies a sandbox
 * AND (when `requireApproval`) explicit per-side-effect approval.
 */
export interface DeviceAdapter {
  readonly kind: DeviceKind;
  readonly enabled: boolean;
  readonly requireApproval: boolean;
  readonly limits?: DeviceStreamLimits;
  /** Host-owned sandbox identifier; admission fails closed without it. */
  readonly sandbox?: string;
  /** Host-owned network/egress policy identifier. */
  readonly network?: string;
}

export interface ResolvedDevicePolicy {
  readonly kind: DeviceKind;
  readonly enabled: boolean;
  readonly requireApproval: boolean;
  readonly maxChunkBytes: number;
  readonly maxConcurrentSessions: number;
  readonly sandbox?: string;
  readonly network?: string;
  /** Shared run accounting the device session must consume. */
  readonly runLimits?: RunLimits;
}

export interface DevicePolicyOptions {
  readonly maxChunkBytes?: number;
  readonly maxConcurrentSessions?: number;
  readonly runLimits?: RunLimits;
}

function validateCap(name: string, value: number | undefined, def: number, hard: number): number {
  const resolved = value ?? def;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", `${name} must be a positive safe integer at most ${hard}`);
  }
  return resolved;
}

export function resolveDevicePolicy(adapter: DeviceAdapter, options: DevicePolicyOptions = {}): ResolvedDevicePolicy {
  if (!adapter || (adapter.kind !== "voice" && adapter.kind !== "desktop-control")) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", "device kind must be 'voice' or 'desktop-control'");
  }
  return {
    kind: adapter.kind,
    // Deny-by-default: anything but an explicit `true` resolves to disabled.
    enabled: adapter.enabled === true,
    // Approval is required unless the host explicitly opts out (it should not).
    requireApproval: adapter.requireApproval !== false,
    maxChunkBytes: validateCap(
      "maxChunkBytes",
      options.maxChunkBytes ?? adapter.limits?.maxChunkBytes,
      DEFAULT_DEVICE_MAX_CHUNK_BYTES,
      HARD_DEVICE_MAX_CHUNK_BYTES,
    ),
    maxConcurrentSessions: validateCap(
      "maxConcurrentSessions",
      options.maxConcurrentSessions ?? adapter.limits?.maxConcurrentSessions,
      DEFAULT_DEVICE_MAX_CONCURRENT_SESSIONS,
      HARD_DEVICE_MAX_CONCURRENT_SESSIONS,
    ),
    ...(adapter.sandbox ? { sandbox: adapter.sandbox } : {}),
    ...(adapter.network ? { network: adapter.network } : {}),
    ...(options.runLimits ? { runLimits: options.runLimits } : {}),
  };
}

export interface DeviceAdmitRequest {
  /** Explicit host approval for this device side effect. */
  readonly approved: boolean;
  /** Currently active device sessions for this identity. */
  readonly activeSessions: number;
}

/**
 * Fail-closed admission gate. Denies unless the device is explicitly enabled,
 * sandboxed, approved (when required), under the concurrent-session budget, and
 * bound to shared run accounting. Side effects never replay after reconnect:
 * hosts must re-admit on every resume.
 */
export function assertDeviceAdmit(policy: ResolvedDevicePolicy, request: DeviceAdmitRequest): void {
  if (!policy.enabled) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_DISABLED", `${policy.kind} device is disabled by default`);
  }
  if (!policy.sandbox) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_DISABLED", `${policy.kind} device requires an explicit sandbox`);
  }
  if (policy.requireApproval && !request.approved) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_APPROVAL", `${policy.kind} device side effect requires approval`);
  }
  if (!Number.isSafeInteger(request.activeSessions) || request.activeSessions < 0) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", "activeSessions must be a non-negative safe integer");
  }
  if (request.activeSessions >= policy.maxConcurrentSessions) {
    throw new DevicePolicyError(
      "ERR_PRISM_DEVICE_SESSIONS",
      `concurrent ${policy.kind} sessions capped at ${policy.maxConcurrentSessions}`,
    );
  }
  if (!policy.runLimits) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_RUN_LIMITS", `${policy.kind} device must consume shared RunLimits`);
  }
}

export interface DeviceChunkResult {
  readonly accepted: boolean;
  readonly bytes: number;
  /** Present when the chunk exceeded the stream bound and was dropped. */
  readonly marker?: "dropped_oversize";
}

/** Stream bound: oversize audio/screenshot/stream chunks are dropped with a marker, never forwarded. */
export function acceptDeviceChunk(policy: ResolvedDevicePolicy, bytes: number): DeviceChunkResult {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_CHUNK", "chunk bytes must be a non-negative safe integer");
  }
  if (bytes > policy.maxChunkBytes) {
    return { accepted: false, bytes, marker: "dropped_oversize" };
  }
  return { accepted: true, bytes };
}

/** Telemetry must be metadata-safe: apply the host redactor before any emit/persist. */
export function redactDeviceTelemetry<T>(redactor: SecretRedactor | undefined, telemetry: T): T {
  return redactor ? redactor.redact(telemetry) : telemetry;
}

export interface DeviceConformanceResult {
  readonly passed: readonly string[];
}

/**
 * Conformance pair for future voice / desktop-control adapters. Runs the
 * deny-by-default fixtures (denial, approval, stream bounds, session budget,
 * run accounting, redaction) against a resolved policy and throws on any
 * regression. Tested in 0.0.14 via fixtures only.
 */
export function runDevicePolicyConformance(adapter: DeviceAdapter, options: DevicePolicyOptions = {}): DeviceConformanceResult {
  const runLimits = options.runLimits ?? { maxTurns: 1 };
  const expectThrow = (code: DevicePolicyErrorCode, fn: () => void): void => {
    let threw = false;
    try {
      fn();
    } catch (error) {
      threw = error instanceof DevicePolicyError && error.code === code;
    }
    if (!threw) throw new DevicePolicyError(code, `conformance: expected ${code}`);
  };
  const passed: string[] = [];

  // 1. Denial by default: a disabled adapter never admits.
  const disabled = resolveDevicePolicy({ ...adapter, enabled: false }, { ...options, runLimits });
  expectThrow("ERR_PRISM_DEVICE_DISABLED", () => assertDeviceAdmit(disabled, { approved: true, activeSessions: 0 }));
  passed.push("denial-by-default");

  // 2. Approval gate: enabled+sandboxed but unapproved denies; approved admits.
  const enabled = resolveDevicePolicy(
    { ...adapter, enabled: true, requireApproval: true, sandbox: adapter.sandbox ?? "sandbox" },
    { ...options, runLimits },
  );
  expectThrow("ERR_PRISM_DEVICE_APPROVAL", () => assertDeviceAdmit(enabled, { approved: false, activeSessions: 0 }));
  assertDeviceAdmit(enabled, { approved: true, activeSessions: 0 });
  passed.push("approval-gate");

  // 3. Session budget: at/over the concurrent cap denies.
  expectThrow("ERR_PRISM_DEVICE_SESSIONS", () =>
    assertDeviceAdmit(enabled, { approved: true, activeSessions: enabled.maxConcurrentSessions }),
  );
  passed.push("session-budget");

  // 4. Run accounting: no shared RunLimits denies.
  const unaccounted = resolveDevicePolicy({ ...adapter, enabled: true, sandbox: "sandbox" }, { ...options, runLimits: undefined });
  expectThrow("ERR_PRISM_DEVICE_RUN_LIMITS", () => assertDeviceAdmit(unaccounted, { approved: true, activeSessions: 0 }));
  passed.push("run-accounting");

  // 5. Stream bounds: oversize chunk dropped with marker; in-bound accepted.
  const over = acceptDeviceChunk(enabled, enabled.maxChunkBytes + 1);
  if (over.accepted || over.marker !== "dropped_oversize") {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_CHUNK", "conformance: oversize chunk must be dropped");
  }
  if (!acceptDeviceChunk(enabled, enabled.maxChunkBytes).accepted) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_CHUNK", "conformance: in-bound chunk must accept");
  }
  passed.push("stream-bounds");

  // 6. Redaction: telemetry passes through the host redactor (secrets stripped), passthrough when absent.
  const secret = "super-secret-device-token";
  const redactor: SecretRedactor = { redact: (value) => redactSecrets(value, [secret]) };
  const redacted = redactDeviceTelemetry(redactor, { note: `leak ${secret}` });
  if (redacted.note.includes(secret)) {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", "conformance: telemetry secret must be redacted");
  }
  if (redactDeviceTelemetry(undefined, { note: "ok" }).note !== "ok") {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", "conformance: telemetry must pass through without a redactor");
  }
  passed.push("redaction");

  return { passed };
}
