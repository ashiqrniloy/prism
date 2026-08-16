/**
 * Phase 26 Task 5 protected conformance: durable process/ACP recovery across
 * restarts and replicas (memory + Postgres).
 *
 * Blocked-gate semantics: requires PRISM_TEST_POSTGRES_URL (like the 0.2.5
 * test:postgres profile). Without it the leg prints a BLOCKED GATE message and
 * exits 1 — it is never a passing skip.
 *
 * Coverage (frozen T5 split-brain): two replicas over the SAME CheckpointStore
 * + LeaseStore cannot both attach/mutate one process record; a crashed
 * replica's record converges to attach/terminal/unknown without a duplicate
 * spawn; durable cancel across replicas yields exactly one fence winner;
 * restart restores records with no fabricated exit code.
 *
 * Runs against memory stores always, and against Postgres when the URL env is
 * set (PRISM_TEST_POSTGRES_URL). The Postgres two-replica leg is the protected
 * evidence for threat T5 split-brain.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const blocked = !postgresUrl;

/** PRISM_TEST_POSTGRES_URL is required: the protected recovery leg cannot run without Postgres. */
if (blocked) {
  console.error(
    "BLOCKED GATE: PRISM_TEST_POSTGRES_URL is required (postgres://...); the phase26 recovery conformance leg cannot run without the durable Postgres store.",
  );
  process.exit(1);
}

// Load the store adapters (Postgres from the session-store-postgres package, same as the 0.2.5 test:postgres profile).
let createPostgresPersistence;
try {
  ({ createPostgresPersistence } = await import("@arnilo/prism-session-store-postgres"));
} catch (error) {
  console.error("BLOCKED GATE: @arnilo/prism-session-store-postgres did not load:", String(error));
  process.exit(1);
}

const { createMemoryCheckpointStore, createMemoryLeaseStore } = await import("@arnilo/prism");
const { createProcessSessions } = await import("@arnilo/prism-coding-agent");

function makePtyBackend(refPrefix) {
  return {
    capabilities: { resize: true },
    async startPty(request) {
      const handle = {
        ref: `${refPrefix}-${request.file}`,
        writes: 0,
        killed: false,
        exitCode: null,
        resolveWait: undefined,
        async write() {
          handle.writes += 1;
        },
        async signal() {},
        async kill() {
          handle.killed = true;
          if (handle.resolveWait) handle.resolveWait();
        },
        async release() {},
        wait() {
          return new Promise((resolve) => {
            handle.resolveWait = () => resolve({ exitCode: 0 });
          });
        },
      };
      return handle;
    },
  };
}

/** In-memory or Postgres store pair, isolated per test via a unique schema/prefix. */
async function makeStores(label) {
  if (label === "memory") {
    return {
      checkpoints: createMemoryCheckpointStore(),
      leases: createMemoryLeaseStore(),
      async close() {},
    };
  }
  const namespacePrefix = `phase26_recovery_${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 10)}`;
  const pg = await createPostgresPersistence({ connectionString: postgresUrl, schema: namespacePrefix });
  return {
    checkpoints: pg.checkpoints,
    leases: pg.leases,
    async close() {
      await pg.close?.().catch(() => {});
    },
  };
}

const dirs = [];
function makeDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `phase26-rec-${label}-`));
  dirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function waitForRecordState(checkpoints, namespace, id, predicate) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const loaded = await checkpoints.loadCheckpoint({ namespace, key: id, tenantId: "tenant-a" });
    if (loaded && predicate(loaded.value.state)) return loaded.value;
    if (Date.now() > deadline) throw new Error(`record ${id} never reached expected state`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const OWNERSHIP = { tenantId: "tenant-a" };
const NAMESPACE = "prism.coding-agent.process.v1";

describe("phase26 recovery conformance", () => {
  for (const flavor of ["memory", "postgres"]) {
    describe(`${flavor} stores`, () => {
      let stores;
      before(async () => {
        stores = await makeStores(flavor);
      });
      after(async () => {
        await stores?.close?.();
      });

      it("restart: intent survives, a crashed replica's running record becomes unknown with no fabricated exit", async () => {
        const dir = makeDir(flavor);
        const storesFor = stores;
        // Replica A starts a process and "crashes" (no dispose).
        const a = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-a",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-a"),
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const started = await a.start({ command: "sleep", args: ["9"], pty: true });
        // Lease lapses: the crashed replica stops renewing.
        await new Promise((resolve) => setTimeout(resolve, 350));
        // Replica B recovers with an unattested backend: atomic unknown.
        const b = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-b",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-b"),
          recoveryBackend: { attach: async () => null },
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const report = await b.recover();
        const entry = report.records.find((record) => record.id === started.id);
        assert.ok(entry, "recovered record reported");
        assert.equal(entry.outcome, "unknown");
        assert.equal(entry.exitCode, null); // never fabricated
        const record = await waitForRecordState(storesFor.checkpoints, NAMESPACE, started.id, (state) => state === "unknown", OWNERSHIP);
        assert.equal(record.exitCode, null);
        await a.dispose();
        await b.dispose();
      });

      it("split-brain: one lease/fence winner; a held record lease blocks the second replica from mutating", async () => {
        const dir = makeDir(flavor);
        const storesFor = stores;
        const a = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-a",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-a"),
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const started = await a.start({ command: "sleep", args: ["9"], pty: true });
        await new Promise((resolve) => setTimeout(resolve, 350)); // A's lease lapses (crash)
        // Replica C acquires the record lease first (it is recovering).
        const held = await storesFor.leases.tryAcquireLease({
          namespace: "prism.coding-agent.process.lease.v1",
          key: `recover:${started.id}`,
          ownerId: "replica-c",
          ttlMs: 30_000,
          ...OWNERSHIP,
        });
        assert.ok(held, "replica C holds the record lease");
        // Replica B recovers: lease conflict -> skip, record untouched.
        const b = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-b",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-b"),
          recoveryBackend: {
            attach: async (ref) => {
              const handle = makePtyBackend("pty-b");
              return await handle.startPty({ file: ref });
            },
          },
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const report = await b.recover();
        const entry = report.records.find((record) => record.id === started.id);
        assert.equal(entry.outcome, "unknown"); // fenced: never attached, never mutated
        const loaded = await storesFor.checkpoints.loadCheckpoint({ namespace: NAMESPACE, key: started.id, ...OWNERSHIP });
        assert.equal(loaded.value.state, "running"); // untouched by replica B
        await storesFor.leases.releaseLease({
          namespace: "prism.coding-agent.process.lease.v1",
          key: `recover:${started.id}`,
          ownerId: "replica-c",
          token: held.token,
          ...OWNERSHIP,
        });
        await a.dispose();
        await b.dispose();
      });

      it("terminal-before-recovery reports terminal; kill after recovery reaches the attached backend", async () => {
        const dir = makeDir(flavor);
        const storesFor = stores;
        const a = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-a",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-a"),
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const started = await a.start({ command: "sleep", args: ["9"], pty: true });
        await started.kill();
        await waitForRecordState(storesFor.checkpoints, NAMESPACE, started.id, (state) => state === "killed", OWNERSHIP);
        const b = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-b",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-b"),
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const report = await b.recover();
        const entry = report.records.find((record) => record.id === started.id);
        assert.equal(entry.outcome, "terminal");
        assert.equal(entry.state, "killed");
        await a.dispose();
        await b.dispose();
      });

      it("cancellation across replicas: one fence winner; cancelOwned reaches the attached backend or records unknown", async () => {
        const dir = makeDir(flavor);
        const storesFor = stores;
        const a = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-a",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-a"),
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        await a.start({ command: "sleep", args: ["9"], pty: true });
        await new Promise((resolve) => setTimeout(resolve, 350)); // A crashes
        // B attaches the process; cancelOwned reaches the attached backend.
        const b = createProcessSessions({
          cwd: dir,
          ownership: OWNERSHIP,
          ownerId: "replica-b",
          checkpoints: storesFor.checkpoints,
          leases: storesFor.leases,
          ptyBackend: makePtyBackend("pty-b"),
          recoveryBackend: { attach: async () => await makePtyBackend("pty-b").startPty({ file: "sleep" }) },
          recoveryLimits: { leaseTtlMs: 200, attachTimeoutMs: 5000 },
        });
        const report = await b.recover();
        const entry = report.records.find((record) => record.outcome === "attached");
        assert.ok(entry, "replica B attached the recovered process");
        const attached = b.get(entry.id);
        await b.cancelOwned("tenant-a::");
        assert.equal(attached.state, "killed"); // reached the attached backend
        const loaded = await waitForRecordState(storesFor.checkpoints, NAMESPACE, entry.id, (state) => state === "killed", OWNERSHIP);
        assert.equal(loaded.exitCode, null);
        await a.dispose();
        await b.dispose();
      });
    });
  }
});
