import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEVICE_MAX_CHUNK_BYTES,
  DEFAULT_DEVICE_MAX_CONCURRENT_SESSIONS,
  DevicePolicyError,
  HARD_DEVICE_MAX_CHUNK_BYTES,
  HARD_DEVICE_MAX_CONCURRENT_SESSIONS,
  acceptDeviceChunk,
  assertDeviceAdmit,
  redactDeviceTelemetry,
  resolveDevicePolicy,
  runDevicePolicyConformance,
} from "../index.js";
import type { DeviceAdapter } from "../index.js";
import { createSecretRedactor } from "../index.js";

const runLimits = { maxTurns: 4, maxToolCalls: 10 };

function adapter(overrides: Partial<DeviceAdapter> = {}): DeviceAdapter {
  return {
    kind: "voice",
    enabled: false,
    requireApproval: true,
    sandbox: "sandbox-a",
    network: "egress-strict",
    ...overrides,
  };
}

describe("resolveDevicePolicy", () => {
  it("resolves deny-by-default defaults and frozen caps", () => {
    const policy = resolveDevicePolicy(adapter(), { runLimits });
    assert.equal(policy.enabled, false);
    assert.equal(policy.requireApproval, true);
    assert.equal(policy.maxChunkBytes, DEFAULT_DEVICE_MAX_CHUNK_BYTES);
    assert.equal(policy.maxConcurrentSessions, DEFAULT_DEVICE_MAX_CONCURRENT_SESSIONS);
    assert.equal(policy.sandbox, "sandbox-a");
    assert.equal(policy.network, "egress-strict");
  });

  it("treats any non-explicit enabled as disabled (deny-by-default)", () => {
    assert.equal(resolveDevicePolicy(adapter({ enabled: false }), { runLimits }).enabled, false);
    assert.equal(resolveDevicePolicy(adapter({ enabled: true }), { runLimits }).enabled, true);
  });

  it("rejects unknown device kinds and caps above the hard ceiling", () => {
    assert.throws(
      () => resolveDevicePolicy({ ...adapter(), kind: "brain" } as unknown as DeviceAdapter),
      DevicePolicyError,
    );
    assert.throws(
      () => resolveDevicePolicy(adapter(), { maxChunkBytes: HARD_DEVICE_MAX_CHUNK_BYTES + 1, runLimits }),
      DevicePolicyError,
    );
    assert.throws(
      () => resolveDevicePolicy(adapter(), { maxConcurrentSessions: HARD_DEVICE_MAX_CONCURRENT_SESSIONS + 1, runLimits }),
      DevicePolicyError,
    );
  });
});

describe("assertDeviceAdmit (fail-closed gate)", () => {
  it("denies a disabled device even with approval + sandbox", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: false }), { runLimits });
    assert.throws(
      () => assertDeviceAdmit(policy, { approved: true, activeSessions: 0 }),
      /disabled by default/,
    );
  });

  it("denies an enabled device without an explicit sandbox", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true, sandbox: undefined }), { runLimits });
    assert.throws(() => assertDeviceAdmit(policy, { approved: true, activeSessions: 0 }), /sandbox/);
  });

  it("denies without approval when requireApproval, admits with approval", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true }), { runLimits });
    assert.throws(() => assertDeviceAdmit(policy, { approved: false, activeSessions: 0 }), /approval/);
    assert.doesNotThrow(() => assertDeviceAdmit(policy, { approved: true, activeSessions: 0 }));
  });

  it("denies at/over the concurrent-session budget", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true }), { runLimits, maxConcurrentSessions: 2 });
    assert.doesNotThrow(() => assertDeviceAdmit(policy, { approved: true, activeSessions: 1 }));
    assert.throws(() => assertDeviceAdmit(policy, { approved: true, activeSessions: 2 }), /capped at 2/);
  });

  it("denies without shared RunLimits accounting", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true }));
    assert.throws(() => assertDeviceAdmit(policy, { approved: true, activeSessions: 0 }), /RunLimits/);
  });

  it("rejects malformed activeSessions", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true }), { runLimits });
    assert.throws(() => assertDeviceAdmit(policy, { approved: true, activeSessions: -1 }), DevicePolicyError);
  });
});

describe("acceptDeviceChunk (stream bounds)", () => {
  it("drops oversize chunks with a marker and accepts in-bound chunks", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true }), { runLimits, maxChunkBytes: 1024 });
    const over = acceptDeviceChunk(policy, 1025);
    assert.equal(over.accepted, false);
    assert.equal(over.marker, "dropped_oversize");
    const within = acceptDeviceChunk(policy, 1024);
    assert.equal(within.accepted, true);
    assert.equal(within.marker, undefined);
  });

  it("rejects malformed byte counts", () => {
    const policy = resolveDevicePolicy(adapter({ enabled: true }), { runLimits });
    assert.throws(() => acceptDeviceChunk(policy, -1), DevicePolicyError);
    assert.throws(() => acceptDeviceChunk(policy, Number.NaN), DevicePolicyError);
  });
});

describe("redactDeviceTelemetry (metadata-safe)", () => {
  it("applies the host redactor and passes through when absent", () => {
    const secret = "device-secret-token";
    const redactor = createSecretRedactor([secret]);
    const redacted = redactDeviceTelemetry(redactor, { note: `audio ${secret}` });
    assert.ok(!redacted.note.includes(secret));
    assert.equal(redactDeviceTelemetry(undefined, { note: "ok" }).note, "ok");
  });
});

describe("runDevicePolicyConformance (fixtures for future voice/desktop adapters)", () => {
  it("passes all deny-by-default fixtures for a voice adapter", () => {
    const result = runDevicePolicyConformance(adapter({ kind: "voice" }), { runLimits });
    assert.deepEqual(result.passed, [
      "denial-by-default",
      "approval-gate",
      "session-budget",
      "run-accounting",
      "stream-bounds",
      "redaction",
    ]);
  });

  it("passes for a desktop-control adapter", () => {
    const result = runDevicePolicyConformance(adapter({ kind: "desktop-control" }), { runLimits });
    assert.equal(result.passed.length, 6);
  });
});
