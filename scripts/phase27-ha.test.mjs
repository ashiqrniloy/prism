#!/usr/bin/env node
/**
 * Plan 027 Task 6 HA/failover/split-brain drill (two-replica proof).
 *
 * Runs the real two-process failover against PostgreSQL: worker A acquires
 * the operation lease, heartbeats, commits the charge side effect (idempotent
 * ERP outbox append), then is SIGKILLed by this orchestrator inside the
 * crash window — before its final checkpoint save. Worker B (a separate
 * process with its own pool and NO access to A's in-memory registry) inspects
 * the durable state, waits out the lease expiry, acquires, replays the
 * uncertain commit idempotently, finishes, and releases.
 *
 * Also proves: stale-fence/stale-revision writes are rejected, old-token
 * renewal is denied, simultaneous acquisition yields exactly one owner, and
 * a foreign tenant can read but never mutate tenant A's records.
 *
 * Requires PRISM_TEST_POSTGRES_URL (protected evidence; skipped otherwise —
 * never a passing skip). Evidence JSON is written to
 * docs/_evidence/phase27-ha-evidence.json when the drill runs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";
import { createPostgresPersistence } from "@arnilo/prism-session-store-postgres";
import { Pool } from "pg";

const url = process.env.PRISM_TEST_POSTGRES_URL;
const worker = new URL("./phase27-ha-worker.mjs", import.meta.url).pathname;
const NS = "phase27.ha";

const skip = url ? false : "PRISM_TEST_POSTGRES_URL required for the protected two-replica HA drill";

function run(args, timeoutMs = 90_000) {
  const child = spawn(process.execPath, [worker, ...[...args, `url=${url}`]], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const promise = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, pid: child.pid });
    });
  });
  return { child, promise };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    await sleep(25);
  }
  return false;
}

test("Task 6 HA drill: two-process failover, fencing, cursors, split-brain, tenant isolation", { skip }, async () => {
  const pool = new Pool({ connectionString: url, max: 10 });
  const schema = `prism_ha_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const barrierDir = `${mkdtempSync(join(tmpdir(), "phase27-ha-"))}/`;
  const ttlMs = 4000;
  const tenantA = `tenant-a-${randomUUID().slice(0, 8)}`;
  const opKey = `invoice-${randomUUID().slice(0, 8)}`;
  const evidence = { schema, ttlMs, tenantA, opKey, pid: { A: null, B: null, stale: null, race: [] }, timings: {}, final: {} };

  try {
    const persistence = await createPostgresPersistence({ pool, schema });
    // Enterprise migrations create prism_erp_outbox; workers open with skipMigrations: true.
    const enterprise = await createPostgresEnterpriseState({ pool, schema });
    void enterprise;
    const leaseKey = { namespace: NS, key: opKey, tenantId: tenantA };

    // 1. Worker A starts, migrates nothing (tables ready), signals ready,
    //    waits for go, runs reserve, commits the charge effect, signals the
    //    crash window, renews its lease until we SIGKILL it.
    const argsA = [
      `mode=start`,
      `id=A`,
      `schema=${schema}`,
      `opKey=${opKey}`,
      `tenant=${tenantA}`,
      `ttlMs=${ttlMs}`,
      `barrierDir=${barrierDir}`,
    ];
    const a = run(argsA);
    const ready = await waitFor(`${barrierDir}ready`, 30_000);
    assert.ok(ready, "worker A did not signal ready");
    writeFileSync(`${barrierDir}go`, "1");
    const effect = await waitFor(`${barrierDir}effect`, 30_000);
    assert.ok(effect, "worker A did not signal the committed charge effect");
    assert.ok(a.child.exitCode === null, "worker A must still be alive (killed only by us)");
    evidence.pid.A = a.child.pid;
    evidence.timings.chargeCommitted = Date.now();

    // 2. Kill A inside the crash window (charge durable, cursor still at 1).
    const t0 = Date.now();
    a.child.kill("SIGKILL");
    await a.promise;
    await sleep(300);
    // The lease row is durable and still active moments after the kill: the
    // fencing counter and ownership survive the owner's death.
    const firstLease = await persistence.leases.getLease(leaseKey);
    assert.ok(firstLease, "lease must be durable and readable while A is dead");

    // 3. Wait for lease expiry so B can take over (bounded, with polls).
    let leaseRow = await persistence.leases.getLease(leaseKey);
    const expiryDeadline = Date.now() + 15_000;
    while (Date.now() < expiryDeadline) {
      leaseRow = await persistence.leases.getLease(leaseKey);
      if (!leaseRow || Date.parse(leaseRow.expiresAt) <= Date.now()) break;
      await sleep(100);
    }
    assert.ok(!leaseRow || Date.parse(leaseRow.expiresAt) <= Date.now(), "lease did not expire in time");
    evidence.timings.leaseExpiredAt = Date.now();

    // 4. Worker B: durable inspect with A dead, then acquire, replay, finish.
    const b = run([`mode=resume`, `id=B`, `schema=${schema}`, `opKey=${opKey}`, `tenant=${tenantA}`, `ttlMs=${ttlMs}`, `t0=${t0}`]);
    const bResult = await b.promise;
    evidence.pid.B = bResult.pid;
    assert.equal(bResult.code, 0, `worker B failed: ${bResult.stderr}`);
    const bOut = JSON.parse(bResult.stdout.trim());
    evidence.final = bOut;
    assert.ok(bOut.ok, "worker B did not complete");

    // Durable state visible while A's registry is gone. The lease has now
    // expired (active reads return null), which is exactly what lets B take over.
    assert.equal(bOut.inspect.lease, null, "lease must be expired so B can acquire it");
    assert.ok(bOut.inspect.checkpoint, "checkpoint must be durable and readable with A dead");
    assert.equal(bOut.inspect.checkpoint.value.cursor, 1, "cursor still marks the uncertain commit");
    assert.equal(bOut.inspect.outboxBefore, 1, "the charge effect landed exactly once before failover");

    // Exactly one committed transition, replay is idempotent, cursor advances.
    assert.equal(bOut.renewed, true, "B renewed its lease (heartbeat)");
    assert.equal(bOut.finalCursor, 3, "B advanced the cursor to completion");
    assert.equal(bOut.outboxAfter, 1, "replay must not duplicate the charge effect");
    assert.ok(bOut.replayReusedMessage, "replay re-used the same idempotent message");

    // Failover ceiling: discoverable within lease TTL + 5 s.
    const ceiling = ttlMs + 5000;
    assert.ok(bOut.failoverMs <= ceiling, `failover took ${bOut.failoverMs}ms, ceiling is ${ceiling}ms`);
    evidence.timings.failoverMs = bOut.failoverMs;
    evidence.timings.ceilingMs = ceiling;

    // 5. Split-brain: a paused/stale owner wakes and tries to write with its
    //    old fence and stale revision — both must fail closed.
    const stale = run([
      `mode=stale`,
      `schema=${schema}`,
      `opKey=${opKey}`,
      `tenant=${tenantA}`,
      `oldVersion=3`,
      `oldExpected=2`,
      `oldFence=1`,
      `oldOwner=worker-A`,
      `oldToken=stale-token`,
    ]);
    const staleResult = await stale.promise;
    evidence.pid.stale = staleResult.pid;
    assert.equal(staleResult.code, 0, `stale probe failed: ${staleResult.stderr}`);
    const staleOut = JSON.parse(staleResult.stdout.trim());
    assert.ok(staleOut.saveRejected, "stale revision/fence write must be rejected");
    assert.ok(staleOut.renewDenied, "old-token renewal must be denied after failover");
    assert.match(staleOut.saveError, /ERR_PRISM_CHECKPOINT_CONFLICT|Stale checkpoint/, staleOut.saveError);

    // 6. Simultaneous acquisition: exactly one owner.
    const raceKey = `race-${randomUUID().slice(0, 8)}`;
    const [r1, r2] = await Promise.all([
      run([`mode=race`, `id=R1`, `schema=${schema}`, `opKey=${raceKey}`, `tenant=${tenantA}`, `ttlMs=${ttlMs}`]).promise,
      run([`mode=race`, `id=R2`, `schema=${schema}`, `opKey=${raceKey}`, `tenant=${tenantA}`, `ttlMs=${ttlMs}`]).promise,
    ]);
    evidence.pid.race = [r1.pid, r2.pid];
    const owners = [r1, r2]
      .filter((r) => r.code === 0)
      .map((r) => JSON.parse(r.stdout.trim()).owner)
      .filter(Boolean);
    assert.equal(owners.length, 1, `exactly one owner expected, got ${owners.length}`);

    // 7. Tenant isolation: a foreign tenant can neither inspect nor mutate A's
    //    records — reads, writes, and lease takeover all fail closed.
    const tenantB = `tenant-b-${randomUUID().slice(0, 8)}`;
    await assert.rejects(
      () => persistence.checkpoints.loadCheckpoint({ namespace: NS, key: opKey, tenantId: tenantB }),
      /ownership mismatch/,
      "foreign tenant read must fail closed",
    );
    await assert.rejects(
      () =>
        persistence.checkpoints.saveCheckpoint({
          namespace: NS,
          key: opKey,
          tenantId: tenantB,
          version: 99,
          expectedVersion: 4,
          fencingToken: 10,
          value: { evil: true },
        }),
      /ownership mismatch/,
      "foreign tenant save must fail closed",
    );
    await assert.rejects(
      () => persistence.leases.tryAcquireLease({ namespace: NS, key: opKey, tenantId: tenantB, ownerId: "worker-B2", ttlMs }),
      /ownership mismatch/,
      "foreign tenant lease takeover must fail closed",
    );
    // Positive isolation: B2's own key works independently.
    const b2Key = `invoice-${randomUUID().slice(0, 8)}`;
    const b2Lease = await persistence.leases.tryAcquireLease({ namespace: NS, key: b2Key, tenantId: tenantB, ownerId: "worker-B2", ttlMs });
    assert.ok(b2Lease, "foreign tenant operates its own keys normally");

    // 8. Cursor cannot skip ahead of its fenced state either.
    await assert.rejects(
      () =>
        persistence.checkpoints.saveCheckpoint({
          namespace: NS,
          key: opKey,
          tenantId: tenantA,
          version: 5,
          expectedVersion: 4,
          fencingToken: 1, // stale fence even though version would be new
          value: { skip: true },
        }),
      /Stale checkpoint fencing token/,
      "skip-ahead write with a stale fence must be rejected",
    );

    evidence.commands = {
      A: `node scripts/phase27-ha-worker.mjs ${argsA.join(" ")}`,
      B: `node scripts/phase27-ha-worker.mjs mode=resume id=B schema=${schema} opKey=${opKey} tenant=${tenantA} ttlMs=${ttlMs} t0=${t0}`,
      stale: `node scripts/phase27-ha-worker.mjs mode=stale schema=${schema} opKey=${opKey} tenant=${tenantA} oldVersion=3 oldExpected=2 oldFence=1 oldOwner=worker-A oldToken=stale-token`,
    };
    evidence.finalStates = {
      checkpointCursor: bOut.finalCursor,
      checkpointVersion: bOut.finalVersion,
      outboxMessages: bOut.outboxAfter,
      leaseOwnerAfter: (await persistence.leases.getLease(leaseKey))?.ownerId ?? null,
    };
    evidence.passed = true;
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
    rmSync(barrierDir, { recursive: true, force: true });
  }

  const evidenceFile = new URL("../docs/_evidence/phase27-ha-evidence.json", import.meta.url);
  writeFileSync(evidenceFile, `${JSON.stringify({ recorded: new Date().toISOString(), ...evidence }, null, 2)}\n`);
  process.stdout.write(`phase27 HA drill passed: failover ${evidence.timings.failoverMs}ms / ceiling ${evidence.timings.ceilingMs}ms\n`);
});
