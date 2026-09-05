/**
 * Failure-injection tests for extracted process session phases.
 * These paths lived inside the createProcessSessions closure and could not be reached directly.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type CheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import { OutputAccumulator } from "../output-accumulator.js";
import { type CodingProcessEvent, type ProcessPtyHandle, type ProcessSession } from "../process/index.js";
import { buildProcessRecoveryRecord } from "../process/recovery.js";
import { createSessionsHost, type SessionRecord } from "../process/sessions-host.js";
import { persistRecoveryUnknown } from "../process/sessions-monitor.js";
import { disposeSessions, terminateRecord } from "../process/sessions-teardown.js";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "prism-proc-phases-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function accumulator(): OutputAccumulator {
  return new OutputAccumulator({
    maxBytes: 1024,
    maxLines: 16,
    maxTotalOutputBytes: 1024,
    tempFilePrefix: "prism-proc",
  });
}

function failingPty(): ProcessPtyHandle {
  return {
    async write() {},
    async signal() {},
    async kill() {
      throw new Error("injected kill failure");
    },
    async release() {
      throw new Error("injected release failure");
    },
    wait() {
      return new Promise(() => {});
    },
  };
}

function liveRecord(id: string, pty?: ProcessPtyHandle): SessionRecord {
  return {
    id,
    owner: "owner",
    workspace: root,
    command: "echo",
    args: [],
    commandFingerprint: "fp",
    policyDecision: "allow",
    startedAt: new Date().toISOString(),
    releaseOnCancel: false,
    expiresAt: Date.now() + 60_000,
    state: "running",
    exitCode: null,
    pty,
    ptyResizeAt: [],
    accumulator: accumulator(),
    waiters: [],
    stdinClosed: false,
    handle: null as unknown as ProcessSession,
    recoveryFencingToken: 1,
    recoveryVersion: 1,
  };
}

test("terminateRecord stays killed when backend kill throws", () => {
  const events: CodingProcessEvent[] = [];
  const host = createSessionsHost({ cwd: root, onEvent: (event) => events.push(event) });
  const record = liveRecord("proc_kill", failingPty());
  terminateRecord(host, record, "killed", null);
  assert.equal(record.state, "killed");
  assert.equal(record.exitCode, null);
  assert.equal(record.pty, undefined);
  assert.ok(events.some((event) => event.type === "process_killed" && event.sessionId === "proc_kill"));
});

test("persistRecoveryUnknown returns false when CAS write fails", async () => {
  const checkpoints = {
    async saveCheckpoint() {
      throw new Error("injected cas conflict");
    },
  } as unknown as CheckpointStore;
  const host = createSessionsHost({
    cwd: root,
    checkpoints,
    leases: createMemoryLeaseStore(),
    ownerId: "replica-1",
  });
  const current = buildProcessRecoveryRecord({
    id: "proc_cas",
    owner: "owner",
    workspace: root,
    command: "echo",
    args: [],
    commandFingerprint: "fp",
    policyDecision: "allow",
    startedAt: new Date().toISOString(),
    state: "running",
    exitCode: null,
    releaseOnCancel: false,
    expiresAt: Date.now() + 60_000,
    fencingToken: 1,
  });
  assert.equal(await persistRecoveryUnknown(host, current, 1), false);
});

test("disposeSessions clears registry when live kill throws", async () => {
  const host = createSessionsHost({ cwd: root });
  const record = liveRecord("proc_dispose", failingPty());
  host.sessions.set(record.id, record);
  await disposeSessions(host);
  assert.equal(host.disposed, true);
  assert.equal(host.sessions.size, 0);
});
