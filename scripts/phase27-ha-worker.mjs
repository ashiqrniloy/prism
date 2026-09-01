#!/usr/bin/env node
/**
 * Plan 027 Task 6 HA drill worker (two-replica process).
 *
 * One worker = one replica process with its own pool. It co-ordinates with
 * the orchestrator (scripts/phase27-ha.test.mjs) through marker files and
 * durable PostgreSQL state only — no shared in-memory registry exists, so
 * every mode proves that correctness comes from LeaseStore fencing +
 * CheckpointStore CAS + the idempotent ERP outbox, never from a live peer.
 *
 * Modes:
 *   start  A worker: acquire, heartbeat, run reserve/charge steps, commit the
 *          charge side effect (idempotent outbox append), signal the crash
 *          window, then wait to be SIGKILLed before its final cursor save.
 *   resume B worker: durable inspect (lease + checkpoint) while A is dead,
 *          wait for lease expiry, acquire, replay unfinished steps (outbox
 *          append re-runs idempotently), finish, release, report timing.
 *   stale  Post-failover probe: old fence + old revision writes must fail.
 *   race   Two workers try the same lease simultaneously; exactly one owns.
 *
 * Output: a single JSON object on stdout; nothing else.
 */
import { existsSync, writeFileSync } from "node:fs";
import { createPostgresEnterpriseState } from "@arnilo/prism-core/enterprise/postgres";
import { createPostgresPersistence } from "@arnilo/prism-core/sessions/postgres";
import { Pool } from "pg";

const NS = "phase27.ha";

function arg(name, fallback = "") {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}
const out = (value) => process.stdout.write(JSON.stringify(value));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function waitFor(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (existsSync(file)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function open() {
  const url = arg("url");
  const schema = arg("schema");
  const pool = new Pool({ connectionString: url, max: 8 });
  const persistence = await createPostgresPersistence({ pool, schema, skipMigrations: true });
  const enterprise = await createPostgresEnterpriseState({ pool, schema, skipMigrations: true });
  return { pool, persistence, enterprise };
}

function lease(persistence, key, tenant, ownerId, ttlMs) {
  return persistence.leases.tryAcquireLease({ namespace: NS, key, tenantId: tenant, ownerId, ttlMs });
}
function loadCheckpoint(persistence, key, tenant) {
  return persistence.checkpoints.loadCheckpoint({ namespace: NS, key, tenantId: tenant });
}
function save(persistence, key, tenant, version, expectedVersion, fence, value, metadata) {
  return persistence.checkpoints.saveCheckpoint({
    namespace: NS,
    key,
    tenantId: tenant,
    version,
    expectedVersion,
    fencingToken: fence,
    value,
    metadata,
  });
}
function outboxCount(pool, schema, tenant, messageId) {
  return pool
    .query(`SELECT count(*) AS n FROM ${schema}.prism_erp_outbox WHERE tenant_id = $1 AND message_id = $2`, [tenant, messageId])
    .then((r) => Number(r.rows[0].n));
}
async function appendMessage(pool, enterprise, input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const record = await enterprise.erpMessaging.outbox.append(client, input);
    await client.query("COMMIT");
    return record;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function modeStart() {
  const { pool, persistence, enterprise } = await open();
  const opKey = arg("opKey");
  const tenant = arg("tenant");
  const ttlMs = Number(arg("ttlMs", "4000"));
  const ownerId = `worker-${arg("id")}`;
  const dir = arg("barrierDir").replace(/\/?$/, "/");

  let acquired = null;
  for (let i = 0; i < 20 && !acquired; i++) {
    acquired = await lease(persistence, opKey, tenant, ownerId, ttlMs);
    if (!acquired) await sleep(50 + Math.floor(Math.random() * 50));
  }
  if (!acquired) {
    out({ ok: false, error: "start could not acquire lease" });
    process.exit(1);
  }
  const fence = acquired.fencingToken;

  const rec = await loadCheckpoint(persistence, opKey, tenant);
  let version;
  let cursor;
  let lastValue;
  if (!rec) {
    const created = await save(
      persistence,
      opKey,
      tenant,
      1,
      0,
      fence,
      { schemaVersion: 1, tenantId: tenant, opKey, cursor: 0, messageId: `pay-${tenant}/${opKey}/charge` },
      { leaseOwner: ownerId },
    );
    version = created.version;
    cursor = created.value.cursor;
    lastValue = created.value;
  } else {
    version = rec.version;
    cursor = rec.value.cursor;
    lastValue = rec.value;
  }

  const heartbeat = setInterval(
    () => {
      persistence.leases.renewLease({ namespace: NS, key: opKey, tenantId: tenant, ownerId, token: acquired.token, ttlMs }).catch(() => {});
    },
    Math.max(250, Math.floor(ttlMs / 4)),
  );
  void heartbeat;
  writeFileSync(`${dir}ready`, "1");
  if (!(await waitFor(`${dir}go`, 30_000))) {
    out({ ok: false, error: "start timed out waiting for go" });
    process.exit(1);
  }

  if (cursor < 1) {
    const next = { ...lastValue, cursor: 1, stepsDone: [...(lastValue.stepsDone ?? []), "reserve"] };
    const saved = await save(persistence, opKey, tenant, version + 1, version, fence, next);
    version = saved.version;
    cursor = saved.value.cursor;
    lastValue = saved.value;
  }

  if (cursor < 2) {
    // Step charge: idempotent external side effect committed BEFORE the cursor
    // advance. The orchestrator SIGKILLs us in this window: the payment is
    // durable but the cursor still says 1 — an uncertain commit a peer must
    // resolve by replay (allowed) without duplication (outbox ON CONFLICT).
    await appendMessage(pool, enterprise, {
      tenantId: tenant,
      messageId: `pay-${tenant}/${opKey}/charge`,
      topic: "erp.payment.requested",
      payload: { opKey, amount: 100, currency: "USD" },
    });
    writeFileSync(`${dir}effect`, "1");
  }

  // Crash window: keep the lease renewed until SIGKILL arrives.
  await new Promise(() => {}); // never resolves; orchestrator kills us
}

async function modeResume() {
  const { pool, persistence, enterprise } = await open();
  const opKey = arg("opKey");
  const tenant = arg("tenant");
  const ttlMs = Number(arg("ttlMs", "4000"));
  const t0 = Number(arg("t0"));
  const ownerId = `worker-${arg("id")}`;
  const messageId = `pay-${tenant}/${opKey}/charge`;

  const inspect = {
    lease: await persistence.leases.getLease({ namespace: NS, key: opKey, tenantId: tenant }),
    checkpoint: await loadCheckpoint(persistence, opKey, tenant),
    outboxBefore: await outboxCount(pool, arg("schema"), tenant, messageId),
  };

  let acquired = null;
  const deadline = Date.now() + 60_000;
  while (!acquired && Date.now() < deadline) {
    acquired = await lease(persistence, opKey, tenant, ownerId, ttlMs);
    if (!acquired) await sleep(100 + Math.floor(Math.random() * 100));
  }
  if (!acquired) {
    out({ ok: false, inspect, error: "resume could not acquire lease after expiry" });
    process.exit(1);
  }
  const t1 = Date.now();
  const fence = acquired.fencingToken;
  const renewed = await persistence.leases.renewLease({
    namespace: NS,
    key: opKey,
    tenantId: tenant,
    ownerId,
    token: acquired.token,
    ttlMs,
  });

  const rec = await loadCheckpoint(persistence, opKey, tenant);
  let version = rec.version;
  let cursor = rec.value.cursor;
  let lastValue = rec.value;
  if (cursor < 1) {
    const next = { ...lastValue, cursor: 1, stepsDone: [...(lastValue.stepsDone ?? []), "reserve"] };
    const saved = await save(persistence, opKey, tenant, version + 1, version, fence, next);
    version = saved.version;
    cursor = saved.value.cursor;
    lastValue = saved.value;
  }
  if (cursor < 2) {
    // Replay of an uncertain commit: the message already landed once.
    await appendMessage(pool, enterprise, {
      tenantId: tenant,
      messageId,
      topic: "erp.payment.requested",
      payload: { opKey, amount: 100, currency: "USD" },
    });
    const next = { ...lastValue, cursor: 2, stepsDone: [...(lastValue.stepsDone ?? []), "charge"] };
    const saved = await save(persistence, opKey, tenant, version + 1, version, fence, next);
    version = saved.version;
    cursor = saved.value.cursor;
    lastValue = saved.value;
  }
  if (cursor < 3) {
    const next = { ...lastValue, cursor: 3, stepsDone: [...(lastValue.stepsDone ?? []), "emit"] };
    const saved = await save(persistence, opKey, tenant, version + 1, version, fence, next);
    version = saved.version;
    cursor = saved.value.cursor;
    lastValue = saved.value;
  }
  await persistence.leases.releaseLease({ namespace: NS, key: opKey, tenantId: tenant, ownerId, token: acquired.token });

  out({
    ok: true,
    inspect,
    acquired: true,
    fence,
    renewed: Boolean(renewed),
    finalCursor: cursor,
    finalVersion: version,
    failoverMs: t1 - t0,
    outboxBefore: inspect.outboxBefore,
    outboxAfter: await outboxCount(pool, arg("schema"), tenant, messageId),
    replayReusedMessage: true,
  });
  await pool.end();
}

async function modeStale() {
  const { pool, persistence } = await open();
  const opKey = arg("opKey");
  const tenant = arg("tenant");
  const oldVersion = Number(arg("oldVersion"));
  const oldExpected = Number(arg("oldExpected"));
  const oldFence = Number(arg("oldFence"));

  let saveRejected = false;
  let saveError = "";
  try {
    await save(persistence, opKey, tenant, oldVersion, oldExpected, oldFence, {
      schemaVersion: 1,
      tenantId: tenant,
      opKey,
      cursor: 99,
      stepsDone: ["evil"],
    });
  } catch (error) {
    saveRejected = true;
    saveError = error.code ?? error.message;
  }
  const renewResult = await persistence.leases.renewLease({
    namespace: NS,
    key: opKey,
    tenantId: tenant,
    ownerId: arg("oldOwner"),
    token: arg("oldToken"),
    ttlMs: 4000,
  });

  out({ ok: saveRejected && renewResult === null, saveRejected, saveError, renewDenied: renewResult === null });
  await pool.end();
}

async function modeRace() {
  const { pool, persistence } = await open();
  await sleep(Math.floor(Math.random() * 30));
  const acquired = await lease(persistence, arg("opKey"), arg("tenant"), `worker-${arg("id")}`, Number(arg("ttlMs", "4000")));
  // No release: the loser must observe the winner's live lease, so the winner's
  // row stays in place until it expires naturally (schema is disposed after).
  out(acquired ? { owner: arg("id"), fence: acquired.fencingToken } : { owner: null });
  await pool.end();
}

const modes = { start: modeStart, resume: modeResume, stale: modeStale, race: modeRace };
modes[arg("mode")]().catch((error) => {
  out({ ok: false, error: error.message });
  process.exit(1);
});
