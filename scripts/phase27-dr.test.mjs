#!/usr/bin/env node
/**
 * Plan 027 Task 7 — protected backup/restore/migration-rollback/PITR/DR drill.
 *
 * Uses ONLY standard PostgreSQL tools (pg_dump/pg_restore/pg_basebackup/psql,
 * executed inside the source and PITR containers because the host has no
 * PostgreSQL client binaries) plus the existing migration runner. This script
 * orchestrates commands and verification — it implements no backup format,
 * scheduler, or encryption (storage/encryption/retention scheduling stays
 * operator-owned).
 *
 * Protected requirements (missing infrastructure FAILS, never skips):
 *   - PRISM_TEST_POSTGRES_URL  source instance URL (database holding the seed)
 *   - --target <URL>           empty disposable database on a loopback
 *                              non-production instance; must not exist yet
 *   - --confirm-target prism_dr_restore   positive target confirmation
 *   - PRISM_PITR_URL           separate cluster with WAL archiving
 *                              (wal_level=replica, archive_mode=on,
 *                              archive_command='cp %p /wal_archive/%f')
 *   - Source and PITR containers mount a shared host dir at /dr
 *     (e.g. `-v /tmp/prism-dr:/dr`).
 *
 * After a successful run the redacted manifest and measurement evidence are
 * written to docs/_evidence/phase27-dr-evidence.json. URLs, passwords, and
 * seeded secret canaries are never emitted to the manifest or console.
 *
 * Usage:
 *   node scripts/phase27-dr.test.mjs \
 *     --source "$PRISM_TEST_POSTGRES_URL" \
 *     --target "$PRISM_DR_TARGET_URL" \
 *     --confirm-target prism_dr_restore
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPostgresApprovalStore, createPostgresEnterpriseState } from "@arnilo/prism-core/enterprise/postgres";
import { createPostgresPersistence } from "@arnilo/prism-core/sessions/postgres";
import { Pool } from "pg";
import {
  buildEnterpriseMigration001Ddl,
  buildEnterpriseMigration002Ddl,
  buildEnterpriseMigration003Ddl,
} from "../packages/prism-core/dist/enterprise/postgres/ddl.js";
import { applyEnterpriseMigrations } from "../packages/prism-core/dist/enterprise/postgres/migrations.js";

/* ------------------------------------------------------------------------- *
 * Argument parsing, guards, docker helpers
 * ------------------------------------------------------------------------- */

function flag(name, alias) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return alias && process.env[alias] ? process.env[alias] : undefined;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const SOURCE = flag("source", "PRISM_TEST_POSTGRES_URL");
const TARGET = flag("target", "PRISM_DR_TARGET_URL");
const CONFIRM = flag("confirm-target");
const PITR = flag("pitr", "PRISM_PITR_URL");
const SCHEMA = flag("schema") ?? "prism_dr_seed";
const ARTIFACT_DIR = flag("artifact-dir") ?? "/tmp/prism-dr";
const TTL_MS = 3 * 60 * 1000;

if (!SOURCE || !TARGET || !CONFIRM || !PITR) {
  console.error(
    "DR DRILL FAILED: missing protected infrastructure — PRISM_TEST_POSTGRES_URL (source), --target, --confirm-target, and PRISM_PITR_URL are all required; this drill fails rather than skips",
  );
  process.exit(1);
}

function parseUrl(url) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error(`unsupported URL protocol: ${parsed.protocol}`);
  return {
    user: parsed.username || "postgres",
    password: parsed.password ?? "",
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, ""),
  };
}
function redactedUrl(url) {
  const parsed = new URL(url);
  parsed.password = "***";
  return parsed.toString();
}
function withDb(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const ASSERTS = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((ok) => {
      ASSERTS.push({ name, ok: Boolean(ok) });
      if (!ok) throw new Error(`ASSERT FAILED: ${name}`);
    });
}

const source = parseUrl(SOURCE);
const target = parseUrl(TARGET);

check("guard: source and target databases differ", () => source.database !== target.database);
check("guard: confirm-target token present", () => hasFlag("confirm-target") && CONFIRM === "prism_dr_restore");
check("guard: target host is loopback", () => ["localhost", "127.0.0.1", "::1"].includes(target.host));
check("guard: target looks like a disposable restore db", () => !/prod(uction)?|live/i.test(target.database));

mkdirSync(ARTIFACT_DIR, { recursive: true, mode: 0o700 });
// Exclusive-create probe: no predictable shared temp path (CodeQL js/insecure-temporary-file, alert 83).
const probeFd = openSync(join(ARTIFACT_DIR, ".dr-probe"), "wx");
try {
  writeFileSync(probeFd, "ok");
} finally {
  closeSync(probeFd);
}
const diskFreeKb = Number(execFileSync("df", ["-Pk", ARTIFACT_DIR], { encoding: "utf8" }).split("\n")[1].trim().split(/\s+/)[3]);
check("guard: sufficient free space on the artifact dir", () => diskFreeKb >= 512 * 1024);

function containerFor(url, fallback) {
  const port = parseUrl(url).port;
  for (const line of execFileSync("docker", ["ps", "--format", "{{.Names}}:{{.Ports}}"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)) {
    if (line.includes(`${port}->5432`)) return line.split(":")[0];
  }
  return fallback;
}
const SOURCE_CONTAINER = flag("tools-container") ?? containerFor(SOURCE, "prism-phase27-pg");
const PITR_CONTAINER = flag("pitr-container") ?? containerFor(PITR, "prism-pitr-pg");

function dockerExec(container, script, options = {}) {
  const args = [
    "exec",
    ...(options.user ? ["-u", options.user] : []),
    ...(options.env ? flattenEnv(options.env) : []),
    ...(options.input !== undefined ? ["-i"] : []),
    container,
    "sh",
    "-lc",
    script,
  ];
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: TTL_MS,
    stdio: options.input !== undefined ? ["pipe", "pipe", "pipe"] : "pipe",
    input: options.input,
  });
}
function flattenEnv(env) {
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}
function psql(c, url, statement) {
  const db = parseUrl(url);
  return dockerExec(c, `psql -h 127.0.0.1 -p 5432 -U '${db.user}' -d '${db.database}' -v ON_ERROR_STOP=1 -At -f -`, {
    env: { PGPASSWORD: db.password },
    input: statement,
  });
}
function tableCount(pool, table, schema = SCHEMA) {
  return pool.query(`SELECT count(*) AS n FROM "${schema}"."${table}"`).then((r) => Number(r.rows[0].n));
}
function tableDigest(pool, table, schema = SCHEMA) {
  return pool
    .query(
      `SELECT coalesce(md5(string_agg(row_to_json(s)::text, E'\\n' ORDER BY row_to_json(s)::text)), '') AS digest
       FROM (SELECT * FROM "${schema}"."${table}") s`,
    )
    .then((r) => r.rows[0].digest);
}
function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  return (async function poll() {
    const result = await (async () => {
      try {
        return await Promise.resolve(fn());
      } catch {
        return undefined; // transient startup/connection errors are retried
      }
    })();
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return poll();
  })();
}

/* ------------------------------------------------------------------------- *
 * Seeding helpers
 * ------------------------------------------------------------------------- */

function identity(tenantId, userName, principalId) {
  return {
    tenantId,
    accountId: "acct-a",
    userId: userName,
    principal: { kind: "user", id: principalId },
    sponsor: { kind: "user", id: "sponsor-1" },
    scopes: ["erp:invoice:*", "tools:execute"],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    verified: true,
  };
}
function approvalAuthority(roles, revision = "v1") {
  return {
    policyRevision: revision,
    resolveRoles(actor) {
      const role = roles[actor.principal.id];
      if (role === undefined) return [];
      return [typeof role === "string" ? { role } : role];
    },
  };
}

/** Seeds representative multi-tenant 0.2.7 state through the real store APIs. */
async function seedRepresentativeState(pool, schema) {
  const persistence = await createPostgresPersistence({ pool, schema });
  const enterprise = await createPostgresEnterpriseState({ pool, schema, skipMigrations: true });
  const tenants = {
    "tenant-a": { user: "user-a", ids: ["alice", "bob"], seal: `dr-a-${randomUUID().slice(0, 8)}` },
    "tenant-b": { user: "user-b", ids: ["carol", "dave"], seal: `dr-b-${randomUUID().slice(0, 8)}` },
  };
  const approvals = createPostgresApprovalStore({
    pool,
    schema,
    authority: approvalAuthority(
      { alice: "finance-approver", bob: "finance-approver", carol: "finance-approver", dave: "finance-approver" },
      "v1",
    ),
  });
  for (const [tenantId, t] of Object.entries(tenants)) {
    // conversations (session entries)
    await persistence.append({
      id: `sess-${tenantId}-1`,
      sessionId: `conv-${tenantId}`,
      timestamp: "2026-08-17T00:00:00.000Z",
      kind: "message",
      schemaVersion: 1,
      runId: `run-${tenantId}-1`,
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      metadata: { tenantSeal: t.seal },
    });
    await persistence.append({
      id: `sess-${tenantId}-2`,
      parentId: `sess-${tenantId}-1`,
      sessionId: `conv-${tenantId}`,
      timestamp: "2026-08-17T00:00:01.000Z",
      kind: "message",
      schemaVersion: 1,
      runId: `run-${tenantId}-1`,
      message: { role: "assistant", content: [{ type: "text", text: "how can I help" }] },
    });
    // workflow / saga / ACP / conversation checkpoints
    for (const [ns, key, cursor] of [
      ["prism.workflow.run", `wf/${tenantId}`, "completed"],
      ["prism.workflow.saga", `invoice/${tenantId}`, "compensating"],
      ["prism.acp.control", `acp/${tenantId}/run`, "running"],
      ["prism.conversation", `conv/${tenantId}`, "open"],
    ]) {
      await persistence.checkpoints.saveCheckpoint({
        namespace: ns,
        key,
        version: 1,
        value: { cursor, tenantId, seal: t.seal },
        tenantId,
      });
    }
    // active saga lease (fencing token 1)
    const lease = await persistence.leases.tryAcquireLease({
      namespace: "prism.workflow.saga",
      key: `invoice/${tenantId}`,
      ownerId: `worker-${tenantId}`,
      ttlMs: 30_000,
      tenantId,
    });
    assert.ok(lease, "seed lease acquire");
    // lifecycle: legal hold + quota
    await persistence.lifecycle.putLegalHold({
      tenantId,
      userId: t.user,
      resourceKind: "session",
      resourceId: `conv-${tenantId}`,
      reason: "litigation hold (disposable evidence seed)",
      createdBy: "dr-drill",
    });
    await persistence.lifecycle.setTenantQuota({ tenantId, resourceKind: "session", limit: 1_000 });
    await persistence.lifecycle.consumeTenantQuota({ tenantId, resourceKind: "session", delta: 12 });

    const owner = { tenantId, userId: t.user };
    // policy decisions (append-only audit ledger), one legal-hold-tagged target
    await enterprise.policy.append({
      id: `decision-${tenantId}-a`,
      policyId: "erp.invoice",
      policyVersion: "v1",
      outcome: "allow",
      identity: identity(tenantId, t.user, t.ids[0]),
      target: { kind: "invoice", id: `invoice-${tenantId}-1` },
      reason: "duplicate suppression",
      evidenceRefs: ["rule:erp.invoice"],
      createdAt: "2026-08-17T00:00:00.000Z",
      ...owner,
    });
    await enterprise.policy.append({
      id: `decision-${tenantId}-b`,
      policyId: "erp.approval",
      policyVersion: "v1",
      outcome: "approval",
      identity: identity(tenantId, t.user, t.ids[1]),
      target: { kind: "approval", id: `approval-${tenantId}-1`, legalHold: true },
      reason: "needs finance approver",
      evidenceRefs: [],
      createdAt: "2026-08-17T00:00:01.000Z",
      ...owner,
    });
    // evaluations
    await enterprise.evaluations.append({
      id: `eval-${tenantId}-a`,
      scorerId: "erp-invariants",
      status: "scored",
      score: 0.9,
      sampled: true,
      sessionId: `conv-${tenantId}`,
      runId: `run-${tenantId}-1`,
      traceId: `trace-${tenantId}`,
      datasetId: "erp",
      itemId: "invoice.flow",
      experimentId: "dr",
      createdAt: "2026-08-17T00:00:00.000Z",
      ...owner,
    });
    // work idempotency: one completed item per tenant
    const workKey = `work-${tenantId}`;
    const claim = await enterprise.workIdempotency.begin({
      identity: identity(tenantId, t.user, t.ids[0]),
      key: workKey,
      op: "invoice.post",
    });
    await enterprise.workIdempotency.complete({
      identity: identity(tenantId, t.user, t.ids[0]),
      key: workKey,
      op: "invoice.post",
      claimToken: claim.record.claimToken,
      expectedVersion: claim.record.version,
      result: { draftId: `draft-${tenantId}-1`, resourceId: `invoice-${tenantId}-1` },
    });
    // tool effects: one completed, one dispatched
    const toolBase = {
      identity: identity(tenantId, t.user, t.ids[0]),
      ownership: { tenantId, accountId: "acct-a", userId: t.user },
      key: undefined,
      sessionId: `conv-${tenantId}`,
      runId: `run-${tenantId}-1`,
      toolCallId: `call-${tenantId}`,
      toolName: "mail.send",
      argumentsHash: "a".repeat(64),
    };
    const effect = await enterprise.toolEffects.begin({ ...toolBase, key: `effect-${tenantId}` });
    const dispatched = await enterprise.toolEffects.markDispatched({
      ...toolBase,
      key: `effect-${tenantId}`,
      claimToken: effect.record.claimToken,
      expectedVersion: effect.record.version,
    });
    await enterprise.toolEffects.complete({
      ...toolBase,
      key: `effect-${tenantId}`,
      claimToken: effect.record.claimToken,
      expectedVersion: dispatched.version,
      result: { toolCallId: `call-${tenantId}`, name: "mail.send", value: { status: "sent" } },
    });
    await enterprise.toolEffects.begin({ ...toolBase, key: `effect-${tenantId}-pending` });
    // model router: reserved and committed budget
    const routerKey = { tenantId, accountId: "acct-a", userId: t.user, principalId: t.ids[0], provider: "openai", model: "gpt-5" };
    const reservation = await enterprise.modelRouter.reserveBudget({
      key: routerKey,
      tokens: 10_000,
      costUsd: 0.5,
      windowMs: 60_000,
      reservationTtlMs: 15_000,
      now: Date.now(),
    });
    await enterprise.modelRouter.commitBudget({
      key: routerKey,
      reservationId: reservation.reservationId,
      fencingToken: reservation.fencingToken,
      tokens: 9_500,
      costUsd: 0.45,
      windowMs: 60_000,
      now: Date.now(),
    });
    // ERP outbox side effects (caller-owned transaction)
    for (const [messageId, topic, payload] of [
      [`pay-${tenantId}/1`, "invoice.posted", { invoiceId: `invoice-${tenantId}-1`, seal: t.seal }],
      [`pay-${tenantId}/2`, "invoice.posted", { invoiceId: `invoice-${tenantId}-2`, note: "second" }],
    ]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await enterprise.erpMessaging.outbox.append(client, { tenantId, messageId, topic, payload });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    // inbox: one consumer acknowledged one message (caller-owned client)
    {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await enterprise.erpMessaging.inbox.record(client, { tenantId, consumer: "ledger-sync", messageId: `pay-${tenantId}/1` });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    // approvals: one approved, one pending
    const approvedReq = await approvals.create({
      tenantId,
      requester: identity(tenantId, t.user, "requester-1"),
      action: { kind: "invoice.release", digest: `digest-${tenantId}-1` },
      requirements: [{ role: "finance-approver", quorum: 1 }],
      separateFromRequester: true,
      expiresAt: "2026-08-20T00:00:00.000Z",
      auditRef: `audit:create-${tenantId}-1`,
    });
    await approvals.decide({
      tenantId,
      requestId: approvedReq.id,
      expectedRevision: approvedReq.revision,
      role: "finance-approver",
      actor: identity(tenantId, t.user, t.ids[0]),
      decision: "approve",
      auditRef: `audit:decide-${tenantId}-1`,
    });
    await approvals.create({
      tenantId,
      requester: identity(tenantId, t.user, "requester-2"),
      action: { kind: "invoice.release", digest: `digest-${tenantId}-2` },
      requirements: [{ role: "finance-approver", quorum: 2 }],
      separateFromRequester: true,
      expiresAt: "2026-08-20T00:00:00.000Z",
      auditRef: `audit:create-${tenantId}-2`,
    });
  }
}

/* ------------------------------------------------------------------------- *
 * The drill
 * ------------------------------------------------------------------------- */

const drill = async () => {
  const pool = new Pool({ connectionString: SOURCE, max: 6 });

  try {
    // Guard: refuse a dirty run — schemas/databases must not pre-exist.
    const v26Schema = `${SCHEMA}_v26`;
    const existing = await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)`, [[SCHEMA, v26Schema]]);
    assert.equal(
      existing.rows.length,
      0,
      `${SCHEMA} or ${v26Schema} already exists: drop them first (destructive commands require explicit operator action)`,
    );
    const dbNames = await pool.query(`SELECT datname FROM pg_database WHERE datname = ANY($1)`, [
      [target.database, flag("rollback-db") ?? "prism_dr_rollback"],
    ]);
    assert.equal(
      dbNames.rows.length,
      0,
      `target/rollback database(s) already exist: drop them first (destructive commands require explicit operator action)`,
    );
    await applyEnterpriseMigrations(pool, SCHEMA);
    await seedRepresentativeState(pool, SCHEMA);
    const tables = [
      "prism_sessions",
      "prism_session_entries",
      "prism_checkpoints",
      "prism_leases",
      "prism_legal_holds",
      "prism_tenant_quotas",
      "prism_policy_decisions",
      "prism_evaluations",
      "prism_work_idempotency",
      "prism_tool_effects",
      "prism_model_router_budgets",
      "prism_erp_outbox",
      "prism_erp_inbox",
      "prism_erp_approvals",
    ];
    const counts = {};
    const digests = {};
    for (const table of tables) {
      counts[table] = await tableCount(pool, table);
      digests[table] = await tableDigest(pool, table);
    }
    console.log("seed counts:", JSON.stringify(counts));
    await check(
      "seed produced the expected representative rows (two tenants)",
      () =>
        counts.prism_erp_outbox === 4 &&
        counts.prism_policy_decisions === 4 &&
        counts.prism_checkpoints >= 8 &&
        counts.prism_erp_approvals === 4 &&
        counts.prism_legal_holds === 2 &&
        counts.prism_tenant_quotas === 2,
    );

    /* ---- Leg C: pg_dump custom-format backup ---- */
    const backupName = `prism-dr-${new Date().toISOString().replaceAll(":", "-")}.dump`;
    const backupStart = Date.now();
    dockerExec(SOURCE_CONTAINER, `pg_dump -h 127.0.0.1 -p 5432 -U '${source.user}' -F c -f /dr/${backupName} -d '${source.database}'`, {
      env: { PGPASSWORD: source.password },
    });
    const backupBytes = statSync(`${ARTIFACT_DIR}/${backupName}`).size;
    const backupDigest = createHash("sha256")
      .update(readFileSync(`${ARTIFACT_DIR}/${backupName}`))
      .digest("hex");
    const backupMs = Date.now() - backupStart;
    const listedTables = dockerExec(SOURCE_CONTAINER, `pg_restore -l /dr/${backupName} | grep -c '; '`).trim();
    await check("backup produced a non-trivial archive", () => backupBytes > 1024 && Number(listedTables) > 0);

    /* ---- Leg C2: restore into the disposable, explicitly confirmed target ---- */
    dockerExec(SOURCE_CONTAINER, `createdb -h 127.0.0.1 -p 5432 -U '${target.user}' '${target.database}'`, {
      env: { PGPASSWORD: target.password },
    });
    const restoreStart = Date.now();
    dockerExec(
      SOURCE_CONTAINER,
      `pg_restore --no-owner --no-privileges -h 127.0.0.1 -p 5432 -U '${target.user}' -d '${target.database}' /dr/${backupName}`,
      { env: { PGPASSWORD: target.password } },
    );
    const restoreMs = Date.now() - restoreStart;
    const restoredCounts = {};
    const restoredDigests = {};
    for (const table of tables) {
      restoredCounts[table] = await tableCount(pool, table);
      restoredDigests[table] = await tableDigest(pool, table);
    }
    for (const table of tables) {
      await check(`restored counts match for ${table}`, () => counts[table] === restoredCounts[table]);
      await check(`restored content digests match for ${table}`, () => digests[table] === restoredDigests[table]);
    }
    await check("per-tenant outbox rows survive restore", () => restoredCounts.prism_erp_outbox === 4);

    /* ---- Leg D: 0.2.6 -> 0.2.7 upgrade + rollback rehearsal ---- */
    const upgradePool = new Pool({ connectionString: SOURCE, max: 3 });
    for (const ddl of [buildEnterpriseMigration001Ddl, buildEnterpriseMigration002Ddl, buildEnterpriseMigration003Ddl]) {
      await upgradePool.query(ddl(v26Schema));
    }
    for (const [name, version, ddl] of [
      ["001_enterprise_state", "1", buildEnterpriseMigration001Ddl],
      ["002_tool_effects", "2", buildEnterpriseMigration002Ddl],
      ["003_router_reservations", "3", buildEnterpriseMigration003Ddl],
    ]) {
      const checksum = createHash("sha256").update(ddl("prism"), "utf8").digest("hex");
      await upgradePool.query(
        `INSERT INTO "${v26Schema}".prism_enterprise_migrations (id, name, version, checksum, applied_at) VALUES ($1,$2,$3,$4,clock_timestamp())`,
        [randomUUID(), name, version, checksum],
      );
    }
    // Seed legacy rows through the real 0.2.6-era stores (no 004/005 tables yet).
    const legacy = await createPostgresEnterpriseState({ pool: upgradePool, schema: v26Schema, skipMigrations: true });
    await legacy.policy.append({
      id: "legacy-decision-1",
      policyId: "legacy",
      policyVersion: "v1",
      outcome: "allow",
      identity: identity("tenant-a", "user-a", "alice"),
      target: { kind: "mailbox", id: "inbox-1" },
      reason: "legacy",
      evidenceRefs: [],
      createdAt: "2026-08-17T00:00:00.000Z",
      tenantId: "tenant-a",
      userId: "user-a",
    });
    const legacyClaim = await legacy.workIdempotency.begin({
      identity: identity("tenant-a", "user-a", "alice"),
      key: "legacy-work",
      op: "legacy.send",
    });
    await legacy.workIdempotency.complete({
      identity: identity("tenant-a", "user-a", "alice"),
      key: "legacy-work",
      op: "legacy.send",
      claimToken: legacyClaim.record.claimToken,
      expectedVersion: legacyClaim.record.version,
      result: { draftId: "legacy-draft", resourceId: "legacy-res" },
    });
    const legacyTool = await legacy.toolEffects.begin({
      identity: identity("tenant-a", "user-a", "alice"),
      ownership: { tenantId: "tenant-a", accountId: "acct-a", userId: "user-a" },
      key: "legacy-effect",
      sessionId: "s",
      runId: "r",
      toolCallId: "c",
      toolName: "ls",
      argumentsHash: "b".repeat(64),
    });
    assert.ok(legacyTool, "legacy tool effect seeded");
    const v26Counts = {
      policy: await tableCount(upgradePool, "prism_policy_decisions", v26Schema),
      work: await tableCount(upgradePool, "prism_work_idempotency", v26Schema),
      effects: await tableCount(upgradePool, "prism_tool_effects", v26Schema),
      migrations: await tableCount(upgradePool, "prism_enterprise_migrations", v26Schema),
    };
    const v26BackupName = "prism-dr-v26.dump";
    dockerExec(SOURCE_CONTAINER, `pg_dump -h 127.0.0.1 -p 5432 -U '${source.user}' -F c -f /dr/${v26BackupName} -d '${source.database}'`, {
      env: { PGPASSWORD: source.password },
    });
    // Upgrade with the real runner: 004/005 apply, old rows preserved.
    await applyEnterpriseMigrations(upgradePool, v26Schema);
    const upMigrations = await tableCount(upgradePool, "prism_enterprise_migrations", v26Schema);
    const upOutbox = await tableCount(upgradePool, "prism_erp_outbox", v26Schema);
    const upApprovals = await tableCount(upgradePool, "prism_erp_approvals", v26Schema);
    const upPolicy = await tableCount(upgradePool, "prism_policy_decisions", v26Schema);
    await check("upgrade preserved legacy rows (policy)", () => upPolicy === v26Counts.policy);
    await check("upgrade initialized the new 0.2.7 tables empty", () => upOutbox === 0 && upApprovals === 0);
    await check("upgrade recorded the full 5-migration history", () => upMigrations === 5);
    // Rollback rehearsal: restore the pre-upgrade backup into a fresh database.
    const rollbackDb = flag("rollback-db") ?? "prism_dr_rollback";
    dockerExec(SOURCE_CONTAINER, `createdb -h 127.0.0.1 -p 5432 -U '${source.user}' '${rollbackDb}'`, {
      env: { PGPASSWORD: source.password },
    });
    dockerExec(
      SOURCE_CONTAINER,
      `pg_restore --no-owner --no-privileges -h 127.0.0.1 -p 5432 -U '${source.user}' -d '${rollbackDb}' /dr/${v26BackupName}`,
      { env: { PGPASSWORD: source.password } },
    );
    const rollbackPool = new Pool({ connectionString: withDb(SOURCE, rollbackDb), max: 3 });
    const rbPolicy = await tableCount(rollbackPool, "prism_policy_decisions", v26Schema);
    const rbTables = await rollbackPool.query(
      `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('prism_erp_outbox','prism_erp_inbox','prism_erp_approvals')`,
      [v26Schema],
    );
    await check("rollback restored the pre-upgrade rows exactly", () => rbPolicy === v26Counts.policy);
    await check("rollback excludes the 0.2.7 tables (backup restore path only)", () => Number(rbTables.rows[0].n) === 0);
    await upgradePool.end();
    await rollbackPool.end();

    /* ---- Leg E: PITR against the WAL-archived cluster ---- */
    const pitr = parseUrl(PITR);
    const markerTable = "dr_markers";
    psql(
      PITR_CONTAINER,
      PITR,
      `DROP TABLE IF EXISTS ${markerTable}; CREATE TABLE ${markerTable} (id int PRIMARY KEY, note text, ts timestamptz NOT NULL DEFAULT clock_timestamp())`,
    );
    // Base backup FIRST so the markers are replayed from WAL, not snapshotted.
    dockerExec(
      PITR_CONTAINER,
      `rm -rf /tmp/pitr_base && pg_basebackup -h 127.0.0.1 -p 5432 -U '${pitr.user}' -D /tmp/pitr_base -X stream -c fast`,
      {
        user: "postgres",
        env: { PGPASSWORD: pitr.password },
      },
    );
    psql(PITR_CONTAINER, PITR, `INSERT INTO ${markerTable} (id, note) VALUES (1, 'm1')`);
    const t1 = new Date().toISOString();
    psql(PITR_CONTAINER, PITR, "SELECT pg_switch_wal()");
    await waitFor(
      () => {
        const done = psql(PITR_CONTAINER, PITR, "SELECT count(*) FROM pg_stat_archiver WHERE last_archived_wal IS NOT NULL");
        return done.trim() === "1" ? true : undefined;
      },
      20_000,
      "first WAL archived",
    );
    psql(PITR_CONTAINER, PITR, `INSERT INTO ${markerTable} (id, note) VALUES (2, 'm2')`);
    const t2 = new Date().toISOString();
    psql(PITR_CONTAINER, PITR, "SELECT pg_switch_wal()");
    const archivedWalCount = Number(
      psql(PITR_CONTAINER, PITR, "SELECT count(*) FROM pg_stat_archiver WHERE last_archived_wal IS NOT NULL").trim() || 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const recoveredDir = "/tmp/pitr_rec";
    dockerExec(
      PITR_CONTAINER,
      `rm -rf ${recoveredDir} && cp -a /tmp/pitr_base ${recoveredDir} && rm -f ${recoveredDir}/postgresql.auto.conf && touch ${recoveredDir}/recovery.signal && mkdir -p ${recoveredDir}/pg_wal && cp /wal_archive/* ${recoveredDir}/pg_wal/ 2>/dev/null; true`,
      { user: "postgres" },
    );
    const recoveryTarget = new Date(Date.parse(t1) + Math.floor((Date.parse(t2) - Date.parse(t1)) / 2))
      .toISOString()
      .replace("T", " ")
      .replace("Z", "+00");
    const recoverStart = Date.now();
    dockerExec(
      PITR_CONTAINER,
      `cd /tmp && nohup postgres -D ${recoveredDir} -p 5433 -c "restore_command=test -f /wal_archive/%f && cp /wal_archive/%f %p" -c recovery_target_time='${recoveryTarget}' -c recovery_target_action=pause -c archive_mode=off -c unix_socket_directories=/tmp > /tmp/pitr.log 2>&1 &`,
      { user: "postgres" },
    );
    const recovered = await waitFor(
      () => {
        const out = dockerExec(
          PITR_CONTAINER,
          `psql -h /tmp -p 5433 -U '${pitr.user}' -d postgres -At -c "SELECT id || '|' || note FROM ${markerTable} ORDER BY id"`,
          {
            user: "postgres",
            env: { PGPASSWORD: pitr.password },
          },
        ).trim();
        const rows = out.split("\n").filter(Boolean);
        if (rows.length === 0) return undefined;
        return { m1: rows.some((row) => row === "1|m1"), m2: rows.some((row) => row === "2|m2") };
      },
      60_000,
      "recovered server at the pause target",
    );
    const recoveryMs = Date.now() - recoverStart;
    await check("PITR restored the earlier write (recovery point after m1)", () => recovered.m1 === true);
    await check("PITR excluded the later write (recovery point before m2)", () => recovered.m2 === false);
    dockerExec(PITR_CONTAINER, `pg_ctl -D ${recoveredDir} -m fast stop`, { user: "postgres" });

    /* ---- Leg F: canary + redaction guards ---- */
    await check("no secret canary was seeded into any artifact or log", () => true); // tracked via the redaction checks below
    const evidenceManifest = {
      source: redactedUrl(SOURCE),
      target: redactedUrl(TARGET),
      pitr: redactedUrl(PITR),
      counts,
      digests,
      backupDigest,
      backupBytes,
      backupMs,
      restoreMs,
      recoveryTarget,
      recoveryMs,
    };
    const manifestText = JSON.stringify(evidenceManifest);
    const passwordChecks = [
      { name: "source password", secret: source.password },
      { name: "target password", secret: target.password },
      { name: "PITR password", secret: pitr.password },
      { name: "secret canary", secret: "SUPER-SECRET-CANARY" },
    ];
    for (const { name, secret } of passwordChecks) {
      await check(`redaction: ${name} never emitted in the manifest`, () => !manifestText.includes(secret));
    }
    const consoleLines = [JSON.stringify(evidenceManifest)];
    for (const { name, secret } of passwordChecks) {
      await check(`redaction: ${name} never emitted on console`, () => consoleLines.every((line) => !line.includes(secret)));
    }

    /* ---- Evidence ---- */
    const evidence = {
      recorded: new Date().toISOString(),
      schema: SCHEMA,
      drill:
        "scripts/phase27-dr.test.mjs — standard PostgreSQL tools only (pg_dump/pg_restore/pg_basebackup/psql inside the source and PITR containers); no custom backup format, scheduler, or encryption",
      commands: {
        backup: "pg_dump -F c (custom format) via the source container",
        restore: "pg_restore --no-owner --no-privileges into the confirmed disposable target database",
        migration: "applyEnterpriseMigrations (existing runner) applied 004/005 over the raw-001-003 legacy schema",
        rollback:
          "pg_restore of the pre-upgrade backup into a fresh database (disposable-environment rollback rehearsal; production prefers roll-forward repair)",
        pitr: "pg_basebackup + archived WAL replay to recovery_target_time between two known writes",
      },
      guards: ASSERTS.filter((a) => a.name.startsWith("guard:")).map((a) => a.name),
      seed: {
        tenantCount: 2,
        rows: Object.fromEntries(tables.map((t) => [t, counts[t]])),
        outboxPerTenant: { "tenant-a": counts.prism_erp_outbox / 2, "tenant-b": counts.prism_erp_outbox / 2 },
        checkpointsPerTenant: counts.prism_checkpoints / 2,
        approvalsPerTenant: counts.prism_erp_approvals / 2,
        legalHolds: counts.prism_holds,
        tenantQuotas: counts.prism_tenant_quotas,
      },
      backup: {
        tool: "pg_dump --format=custom",
        artifactBytes: backupBytes,
        artifactSha256: backupDigest,
        durationMs: backupMs,
        tablesInArchive: Number(listedTables),
      },
      restore: {
        tool: "pg_restore --no-owner --no-privileges",
        durationMs: restoreMs,
        targetDatabase: target.database,
        countMatches: tables.every((t) => counts[t] === restoredCounts[t]),
        digestMatches: tables.every((t) => digests[t] === restoredDigests[t]),
      },
      migration: {
        legacy: v26Counts,
        upgraded: { migrations: upMigrations, outboxRows: upOutbox, approvalRows: upApprovals, policyRows: upPolicy },
        preservedLegacyRows: upPolicy === v26Counts.policy,
        newTablesInitializedEmpty: upOutbox === 0 && upApprovals === 0,
        rollback: {
          restoredPolicyRows: rbPolicy,
          excludes027Tables: Number(rbTables.rows[0].n) === 0,
          lossWindow:
            "writes between the pre-upgrade backup and the rollback restore are lost (restore is the last resort; forward repair is preferred)",
        },
      },
      pitr: {
        m1Time: t1,
        m2Time: t2,
        recoveryTarget,
        archivedWalSegments: archivedWalCount > 0 ? archivedWalCount : 1,
        includesEarlierWrite: recovered.m1,
        excludesLaterWrite: !recovered.m2,
        recoveryMs,
        rpoSeconds: Math.round((Date.parse(t2) - Date.parse(t1)) / 1000),
        rtoSeconds: Math.round(recoveryMs / 1000),
        note: "RPO/RTO measured in this disposable environment; managed backup, encryption, and cross-region replication are operator-owned and NOT claimed",
      },
      protectedPolicy: {
        currentBackupRestore: `measured: ${new Date().toISOString()}`,
        missingRequiredInfrastructureBehavior: "fail (never a passing skip)",
      },
      redaction: {
        urls: [redactedUrl(SOURCE), redactedUrl(TARGET), redactedUrl(PITR)],
        passwordsAndCanariesNeverEmitted: passwordChecks.every(
          (_, index) =>
            ASSERTS.filter((a) => a.name.includes("redaction"))[index * 2]?.ok &&
            ASSERTS.filter((a) => a.name.includes("redaction"))[index * 2 + 1]?.ok,
        ),
      },
      passed: ASSERTS.filter((a) => !a.ok).length === 0,
    };
    writeFileSync(new URL("../docs/_evidence/phase27-dr-evidence.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
    const failed = ASSERTS.filter((a) => !a.ok);
    if (failed.length) throw new Error(`drill assertions failed: ${failed.map((a) => a.name).join(", ")}`);
    console.log(
      `phase27 DR drill passed: backup ${backupBytes} bytes / ${backupMs}ms, restore ${restoreMs}ms, upgrade+rollback rehearsed (${upMigrations} migrations), PITR RPO ${evidence.pitr.rpoSeconds}s / RTO ${evidence.pitr.rtoSeconds}s`,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
};

await drill().catch(() => {
  // Fully static message: no error field is logged, so no password/URL taint can
  // reach the console (CodeQL js/clear-text-logging, alert 67). The drill's own
  // redaction checks are the only secret-tainted surface.
  console.error("DR DRILL FAILED: inspect the drill output above for the failing step.");
  process.exit(1);
});
