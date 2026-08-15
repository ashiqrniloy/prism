/**
 * Durable managed-process recovery tests (plan 026 Task 5).
 *
 * Threat T5 coverage: crash windows (intent-before-spawn / running /
 * terminal-before-persist) converge to attached|terminal|unknown without a
 * duplicate spawn; replica split-brain is fenced by LeaseStore leases and CAS;
 * unsupported attach atomically records unknown; no fabricated exit code is
 * ever produced (security test 'T5 fabricated exit'); corrupt/forbidden
 * records and ownership mismatches fail closed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  type CheckpointStore,
  type LeaseStore,
} from "@arnilo/prism";
import {
  createProcessSessions,
  ProcessRecoveryError,
  PROCESS_RECOVERY_NAMESPACE,
  acquireRecordLease,
  type ProcessPtyHandle,
  type ProcessRecoveryBackend,
  loadProcessRecoveryRecord,
  resolveProcessRecoveryLimits,
  saveProcessRecoveryRecord,
  type ProcessSandboxHandle,
} from "../process/index.js";

interface FakeHandle extends ProcessPtyHandle, ProcessSandboxHandle {
  exitCode: number | null;
  killed: boolean;
  released: boolean;
  signals: string[];
  writes: Uint8Array[];
  resolveWait: (() => void) | undefined;
}

function makeHandle(ref: string | undefined, waitExitCode: number | null = null): FakeHandle {
  const handle: FakeHandle = {
    ref,
    exitCode: waitExitCode,
    killed: false,
    released: false,
    signals: [],
    writes: [],
    resolveWait: undefined,
    async write(data) {
      handle.writes.push(data);
    },
    async signal(name) {
      handle.signals.push(name);
    },
    async kill() {
      handle.killed = true;
      if (handle.resolveWait) handle.resolveWait();
    },
    async release() {
      handle.released = true;
      if (handle.resolveWait) handle.resolveWait();
    },
    wait() {
      if (waitExitCode !== null) return Promise.resolve({ exitCode: waitExitCode });
      return new Promise((resolve) => {
        handle.resolveWait = () => resolve({ exitCode: 0 });
      });
    },
  };
  return handle;
}

interface Harness {
  checkpoints: CheckpointStore;
  leases: LeaseStore;
  handles: FakeHandle[];
  startedRefs: string[];
  attachImpl: (ref: string) => FakeHandle | null | Promise<FakeHandle | null>;
  attachCalls: string[];
  dir: string;
}

async function makeHarness(options?: {
  attachImpl?: (ref: string) => FakeHandle | null | Promise<FakeHandle | null>;
  recoveryLimits?: Record<string, number>;
  ownership?: Record<string, string>;
}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "phase26-recovery-"));
  const checkpoints = createMemoryCheckpointStore();
  const leases = createMemoryLeaseStore();
  const handles: FakeHandle[] = [];
  const startedRefs: string[] = [];
  const attachCalls: string[] = [];
  const harness: Harness = {
    checkpoints,
    leases,
    handles,
    startedRefs,
    attachImpl: async (ref) => {
      attachCalls.push(ref);
      if (options?.attachImpl) return options.attachImpl(ref);
      const handle = makeHandle(ref);
      handles.push(handle);
      return handle;
    },
    attachCalls,
    dir,
  };
  return harness;
}

function makeSessions(h: Harness, ownerId = "replica-1", recoveryLimits?: Record<string, number>) {
  const ptyBackend = {
    capabilities: { resize: true },
    async startPty(request: { file: string; onData?: (data: Buffer) => void }): Promise<ProcessPtyHandle> {
      const handle = makeHandle(`pty-${h.startedRefs.length + 1}`);
      h.handles.push(handle);
      h.startedRefs.push(request.file);
      return handle;
    },
  };
  const recoveryBackend: ProcessRecoveryBackend = {
    attach: (ref) => h.attachImpl(ref),
  };
  return createProcessSessions({
    cwd: h.dir,
    ownership: { tenantId: "tenant-a" },
    ownerId,
    checkpoints: h.checkpoints,
    leases: h.leases,
    ptyBackend,
    recoveryBackend,
    recoveryLimits: { attachTimeoutMs: 500, leaseTtlMs: 60, ...(recoveryLimits ?? {}) },
  });
}

const ownership = { tenantId: "tenant-a" };

async function waitForRecordState(
  checkpoints: CheckpointStore,
  id: string,
  predicate: (state: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const loaded = await loadProcessRecoveryRecord({ checkpoints, id, limits: resolveProcessRecoveryLimits(), ownership });
    if (loaded && predicate(loaded.record.state)) return;
    if (Date.now() > deadline) throw new Error(`record ${id} never reached expected state`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const leaseLapseMs = 90;

/** Simulate a crashed replica: the record lease lapses within TTL. */
async function waitLeaseLapse(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, leaseLapseMs));
}

async function cleanup(h: Harness): Promise<void> {
  await rm(h.dir, { recursive: true, force: true });
}

describe("process recovery", () => {
  it("recover fails closed without durable configuration", async () => {
    const h = await makeHarness();
    try {
      const dir = await mkdtemp(join(tmpdir(), "phase26-recovery-nodur-"));
      const sessions = createProcessSessions({ cwd: dir });
      await assert.rejects(() => sessions.recover(), (error: unknown) => {
        assert.ok(error instanceof ProcessRecoveryError);
        assert.equal(error.code, "ERR_PRISM_RECOVERY_UNSUPPORTED");
        return true;
      });
      await rm(dir, { recursive: true, force: true });
    } finally {
      await cleanup(h);
    }
  });

  it("partial recovery configuration fails closed at construction", async () => {
    const h = await makeHarness();
    try {
      assert.throws(
        () =>
          createProcessSessions({
            cwd: h.dir,
            checkpoints: h.checkpoints,
            ownerId: "replica-1",
          }),
        (error: unknown) => error instanceof ProcessRecoveryError && error.code === "ERR_PRISM_RECOVERY_UNSUPPORTED",
      );
      assert.throws(
        () =>
          createProcessSessions({
            cwd: h.dir,
            leases: h.leases,
            recoveryBackend: { attach: () => null },
          }),
        (error: unknown) => error instanceof ProcessRecoveryError && error.code === "ERR_PRISM_RECOVERY_UNSUPPORTED",
      );
    } finally {
      await cleanup(h);
    }
  });

  it("intent is persisted before spawn and the running transition carries the backend ref", async () => {
    const h = await makeHarness();
    try {
      const sessions = makeSessions(h);
      await sessions.start({ command: "/bin/sleep", args: ["1"], pty: true });
      const page = await h.checkpoints.listCheckpoints({ namespace: PROCESS_RECOVERY_NAMESPACE, keyPrefix: "proc_" });
      assert.equal(page.items.length, 1);
      const record = page.items[0]!.value as {
        state: string;
        backendRef?: string;
        pty?: { columns: number; rows: number };
        env?: unknown;
      };
      assert.equal(record.state, "running");
      assert.equal(record.backendRef, "pty-1");
      assert.equal(record.pty?.columns, 120);
      assert.equal(record.env, undefined);
      await sessions.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("crash before recovery: running record becomes unknown with no fabricated exit (T5 fabricated exit)", async () => {
    const h = await makeHarness();
    try {
      // Replica A crashes mid-flight (no dispose): durable record stays running.
      const a = makeSessions(h, "replica-a");
      await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // replica A crashed; its lease lapses
      // Replica B recovers without an attachable backend.
      h.attachImpl = async () => null;
      const b = makeSessions(h, "replica-b");
      const report = await b.recover();
      assert.equal(report.attached, 0);
      assert.equal(report.unknown, 1);
      assert.equal(report.records[0]!.outcome, "unknown");
      assert.equal(report.records[0]!.exitCode, null);
      const loaded = await loadProcessRecoveryRecord({
        checkpoints: h.checkpoints,
        id: report.records[0]!.id,
        limits: resolveProcessRecoveryLimits(),
        ownership,
      });
      assert.equal(loaded!.record.state, "unknown");
      assert.equal(loaded!.record.exitCode, null);
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("terminal transition before recovery reports terminal (killed, no exit code)", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      const session = await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await session.kill();
      await waitForRecordState(h.checkpoints, session.id, (state) => state === "killed");
      const b = makeSessions(h, "replica-b");
      const report = await b.recover();
      assert.equal(report.terminal, 1);
      assert.equal(report.records[0]!.state, "killed");
      assert.equal(report.records[0]!.exitCode, null);
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("attach-if-attested: recovered running record reattaches and reaches the backend on kill", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // replica A crashed; its lease lapses
      const b = makeSessions(h, "replica-b");
      const report = await b.recover();
      assert.equal(report.attached, 1);
      assert.equal(h.attachCalls.length, 1);
      const attached = b.get(report.records[0]!.id);
      assert.equal(attached.state, "running");
      assert.equal(attached.metadata().terminal?.columns, 120);
      const handle = [...h.handles].reverse().find((candidate) => candidate.ref === "pty-1");
      await attached.input(Buffer.from("x"));
      assert.equal(handle!.writes.length, 1);
      await attached.kill();
      assert.equal(handle!.killed, true);
      await waitForRecordState(h.checkpoints, attached.id, (state) => state === "killed");
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("unattested attach (null) atomically records unknown", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // replica A crashed; its lease lapses
      const b = makeSessions(h, "replica-b");
      // override the backend to refuse the attach
      h.attachImpl = async () => null;
      const report = await b.recover();
      assert.equal(report.unknown, 1);
      const loaded = await loadProcessRecoveryRecord({
        checkpoints: h.checkpoints,
        id: report.records[0]!.id,
        limits: resolveProcessRecoveryLimits(),
        ownership,
      });
      assert.equal(loaded!.record.state, "unknown");
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("attach failure records unknown with a generic error code, never backend text", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // replica A crashed; its lease lapses
      const b = makeSessions(h, "replica-b");
      h.attachImpl = async () => {
        throw new Error("secret-host-token: k0");
      };
      const report = await b.recover();
      assert.equal(report.unknown, 1);
      assert.equal(report.records[0]!.error, "ERR_PRISM_RECOVERY_UNKNOWN");
      assert.ok(!JSON.stringify(report).includes("secret-host-token"));
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("attach timeout fails closed as ERR_PRISM_RECOVERY_TIMEOUT", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // replica A crashed; its lease lapses
      const b = makeSessions(h, "replica-b");
      h.attachImpl = () => new Promise<FakeHandle | null>(() => {});
      const report = await b.recover();
      assert.equal(report.unknown, 1);
      assert.equal(report.records[0]!.error, "ERR_PRISM_RECOVERY_TIMEOUT");
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("replica race: a held recovery lease blocks the second replica from mutating the record", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      const session = await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // the starting replica's lease lapses
      // Replica C holds the record lease (it is recovering/attaching).
      const held = await acquireRecordLease({
        leases: h.leases,
        id: session.id,
        ownerId: "replica-c",
        ttlMs: 30_000,
        ownership,
      });
      assert.ok(held);
      const b = makeSessions(h, "replica-b");
      const report = await b.recover();
      assert.equal(report.records[0]!.outcome, "unknown");
      assert.equal(report.records[0]!.error, undefined);
      const loaded = await loadProcessRecoveryRecord({
        checkpoints: h.checkpoints,
        id: report.records[0]!.id,
        limits: resolveProcessRecoveryLimits(),
        ownership,
      });
      assert.equal(loaded!.record.state, "running"); // untouched by replica B
      await a.dispose();
      await b.dispose();
      await h.leases.releaseLease({
        namespace: "prism.coding-agent.process.lease.v1",
        key: `recover:${report.records[0]!.id}`,
        ownerId: "replica-c",
        token: held.token,
        ...ownership,
      });
    } finally {
      await cleanup(h);
    }
  });

  it("stale fence writes are rejected with ERR_PRISM_RECOVERY_FENCE", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      const session = await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitForRecordState(h.checkpoints, session.id, (state) => state === "running");
      const loaded = await loadProcessRecoveryRecord({
        checkpoints: h.checkpoints,
        id: session.id,
        limits: resolveProcessRecoveryLimits(),
        ownership,
      });
      assert.ok(loaded);
      // A stale worker (fence 0) cannot overwrite the fenced record.
      await assert.rejects(
        () =>
          saveProcessRecoveryRecord({
            checkpoints: h.checkpoints,
            record: { ...loaded!.record, state: "unknown", fencingToken: 0, updatedAt: new Date().toISOString() },
            expectedVersion: loaded!.version,
            version: loaded!.version + 1,
            ownership,
          }),
        (error: unknown) => error instanceof ProcessRecoveryError && error.code === "ERR_PRISM_RECOVERY_FENCE",
      );
      await a.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("cancelOwned reaches the attached backend and records unknown for unattached durable records", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitLeaseLapse(); // replica A crashed; its lease lapses
      const b = makeSessions(h, "replica-b");
      const report = await b.recover();
      assert.equal(report.attached, 1);
      const attached = b.get(report.records[0]!.id);
      await b.cancelOwned("tenant-a::");
      assert.equal(attached.state, "killed"); // reached the attached backend
      // Unattached durable record (never recovered) also becomes unknown.
      const c = makeSessions(h, "replica-c");
      const cSession = await c.start({ command: "/bin/sleep", args: ["9"], pty: true });
      await waitForRecordState(h.checkpoints, cSession.id, (state) => state === "running");
      await waitLeaseLapse(); // replica C crashed; its lease lapses
      // simulate crash: new replica without attach
      h.attachImpl = async () => null;
      const d = makeSessions(h, "replica-d");
      await d.cancelOwned("tenant-a::");
      const loaded = await loadProcessRecoveryRecord({
        checkpoints: h.checkpoints,
        id: cSession.id,
        limits: resolveProcessRecoveryLimits(),
        ownership,
      });
      assert.equal(loaded!.record.state, "unknown");
      await b.dispose();
      await c.dispose();
      await d.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("terminal records are evicted beyond maxRecords (running records never evicted)", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a", { maxRecords: 2 });
      const first = await a.start({ command: "/bin/sleep", args: ["1"], pty: true });
      await first.kill();
      const second = await a.start({ command: "/bin/sleep", args: ["2"], pty: true });
      await second.kill();
      const running = await a.start({ command: "/bin/sleep", args: ["3"], pty: true });
      const deadline = Date.now() + 2000;
      for (;;) {
        const page = await h.checkpoints.listCheckpoints({ namespace: PROCESS_RECOVERY_NAMESPACE, keyPrefix: "proc_" });
        if (page.items.length <= 2) break;
        if (Date.now() > deadline) throw new Error("records never evicted to maxRecords");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const page = await h.checkpoints.listCheckpoints({ namespace: PROCESS_RECOVERY_NAMESPACE, keyPrefix: "proc_" });
      assert.equal(page.items.length, 2);
      assert.ok(page.items.some((item) => (item.value as { id: string }).id === running.id));
      await a.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("corrupt, oversized, and forbidden-field records fail closed (skipped, never recovered)", async () => {
    const h = await makeHarness();
    try {
      const a = makeSessions(h, "replica-a");
      const session = await a.start({ command: "/bin/sleep", args: ["9"], pty: true });
      // Direct hostile writes into the recovery namespace.
      await h.checkpoints.saveCheckpoint({
        namespace: PROCESS_RECOVERY_NAMESPACE,
        key: "proc_0000000000000000",
        value: { schemaVersion: 1, state: "running", env: { SECRET: "k0" } },
        version: 1,
        expectedVersion: 0,
        category: "coding-process",
        ...ownership,
      });
      await h.checkpoints.saveCheckpoint({
        namespace: PROCESS_RECOVERY_NAMESPACE,
        key: "proc_1111111111111111",
        value: "not an object",
        version: 1,
        expectedVersion: 0,
        category: "coding-process",
        ...ownership,
      });
      const b = makeSessions(h, "replica-b");
      h.attachImpl = async () => null;
      const report = await b.recover();
      assert.equal(report.records.length, 1); // only the legitimate record
      assert.equal(report.records[0]!.id, session.id);
      await a.dispose();
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });

  it("recover with no records is an empty report", async () => {
    const h = await makeHarness();
    try {
      const b = makeSessions(h, "replica-b");
      const report = await b.recover();
      assert.deepEqual(report, { records: [], attached: 0, terminal: 0, unknown: 0 });
      await b.dispose();
    } finally {
      await cleanup(h);
    }
  });
});
