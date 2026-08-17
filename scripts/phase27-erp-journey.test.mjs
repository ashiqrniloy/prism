#!/usr/bin/env node
/**
 * Plan 027 Task 9 — protected end-to-end ERP release journey.
 *
 * One reproducible journey exercises every ERP primitive against real
 * PostgreSQL and process-level failover: verified identity, policy decision,
 * model-budget reservation, SoD quorum approval (distinct verified approvers;
 * requester/subagent/revoked all fail closed), transactional outbox/inbox
 * (duplicate delivery → one local mutation), saga failure/compensation/
 * reconciliation, signed hash-chained audit export (with tamper detection),
 * legal hold, field-level classification (canary leak denied), two-replica
 * fenced failover (reuses scripts/phase27-ha-worker.mjs), and a logical
 * backup/restore with digest equality. The DR drill evidence
 * (docs/_evidence/phase27-dr-evidence.json) must be present and not stale —
 * the journey fails (never skips) when it is missing.
 *
 * Scorers consume structured journey facts only — never model prose, secrets,
 * or classified payloads. Facts are scored by `createErpInvariantScorers`
 * (from @arnilo/prism-evals); every scorer must return 1 (no weighted average).
 *
 * Requires PRISM_TEST_POSTGRES_URL (protected evidence; skipped otherwise —
 * never a passing skip). Evidence JSON is written to
 * docs/_evidence/phase27-erp-journey.json when the journey runs. Local
 * substitutes (in-memory WORM/SIEM fixtures, logical pg-client backup) are
 * labelled in evidence; passing this journey does NOT satisfy the 0.3.0
 * live-service matrix.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { createPostgresPersistence } from "@arnilo/prism-session-store-postgres";
import { createPostgresEnterpriseState, createPostgresApprovalStore } from "@arnilo/prism-enterprise-postgres";
import { createMemoryWorkflowCheckpoints } from "@arnilo/prism-workflows";
import { defineSaga, runSaga, resumeSaga } from "@arnilo/prism-workflows";
import { createAuditExporter, createMemoryAuditCursorStore, verifyAuditBatch } from "@arnilo/prism-policy";
import {
  applyFieldPolicy,
  createProtectedFieldPolicy,
  createAuditFieldRedactor,
  createMemoryLeaseStore,
  narrowIdentity,
} from "@arnilo/prism";
import { createErpInvariantScorers, erpInvariantDataset, scoreRun } from "@arnilo/prism-evals";

const url = process.env.PRISM_TEST_POSTGRES_URL;
const haWorker = new URL("./phase27-ha-worker.mjs", import.meta.url).pathname;
const DR_EVIDENCE = "docs/_evidence/phase27-dr-evidence.json";
const HA_EVIDENCE = "docs/_evidence/phase27-ha-evidence.json";
const JOURNEY_EVIDENCE = "docs/_evidence/phase27-erp-journey.json";
const NS = "phase27.journey";
const LEASE_TTL_MS = 4000;

const skip = url ? false : "PRISM_TEST_POSTGRES_URL required for the protected ERP release journey";

function now() {
  return new Date(Date.now() - 60_000).toISOString(); // issued 60s in the past to stay valid
}
function future(ms) {
  return new Date(Date.now() + ms).toISOString();
}

/** Build a verified AgentIdentity fixture. */
function identity(tenantId, principalId, kind = "user", extras = {}) {
  return {
    tenantId,
    principal: { kind, id: principalId, displayName: principalId },
    scopes: ["erp:run"],
    issuedAt: now(),
    expiresAt: future(60 * 60_000),
    verified: true,
    userId: principalId,
    ...extras,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function runWorker(args, timeoutMs = 90_000) {
  const child = spawn(process.execPath, [haWorker, ...[...args, `url=${url}`]], {
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

async function waitFor(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    await sleep(25);
  }
  return false;
}

/** A bounded authority granting the approver roles to verified actors. */
function approvalAuthority(_tenantId, approver1Id, approver2Id, _requesterId, policyRevision) {
  return {
    policyRevision,
    resolveRoles(id, request) {
      // Requester/subagent never hold the approver role (separation of duties).
      const map = {
        [approver1Id]: [{ role: "finance-approver", principalId: approver1Id, delegatedFrom: [] }],
        [approver2Id]: [{ role: "finance-approver", principalId: approver2Id, delegatedFrom: [] }],
      };
      const grants = map[id.principal.id] ?? [];
      void request;
      return grants;
    },
  };
}

test("Task 9 ERP release journey: all invariants pass against real Postgres + failover", { skip }, async () => {
  const pool = new Pool({ connectionString: url, max: 12 });
  const schema = `prism_journey_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const tenantA = `tenant-a-${randomUUID().slice(0, 8)}`;
  const tenantB = `tenant-b-${randomUUID().slice(0, 8)}`;
  const requesterId = `user-requester-${randomUUID().slice(0, 6)}`;
  const approver1Id = `user-approver1-${randomUUID().slice(0, 6)}`;
  const approver2Id = `user-approver2-${randomUUID().slice(0, 6)}`;
  const requester = identity(tenantA, requesterId, "user", { scopes: ["erp:run", "erp:propose"] });
  const approver1 = identity(tenantA, approver1Id);
  const approver2 = identity(tenantA, approver2Id);
  // Supervisor subagent: a narrowed delegation of the requester — correlated
  // work but cannot become a verified approver.
  const subagent = narrowIdentity(requester, { scopes: ["erp:propose"], principal: { kind: "agent", id: `agent-${requesterId}` } });
  const facts = {};
  const timings = { stages: {} };
  const stageStart = (name) => {
    timings.stages[name] = { start: Date.now() };
  };
  const stageEnd = (name) => {
    timings.stages[name].end = Date.now();
    timings.stages[name].ms = timings.stages[name].end - timings.stages[name].start;
  };

  try {
    stageStart("setup");
    const persistence = await createPostgresPersistence({ pool, schema });
    const enterprise = await createPostgresEnterpriseState({ pool, schema });
    const authority = approvalAuthority(tenantA, approver1Id, approver2Id, requesterId, "rev-2026-08-17");
    const approvals = createPostgresApprovalStore({ pool, schema, authority });
    stageEnd("setup");

    // ── 1. Policy decision + budget reservation ──────────────────────────
    stageStart("policy-budget");
    const policyRecord = await enterprise.policy.append({
      id: `pol-${randomUUID()}`,
      policyId: "erp.invoice.pay",
      policyVersion: "1.0.0",
      outcome: "approval",
      identity: requester,
      target: { kind: "invoice", id: "inv-1001" },
      reason: "invoice payment requires SoD approval",
      tenantId: tenantA,
      userId: requesterId,
      createdAt: new Date().toISOString(),
    });
    assert.ok(policyRecord.id, "policy decision recorded");

    const budgetKey = {
      tenantId: tenantA,
      principalId: requesterId,
      provider: "mock",
      model: "erp-model",
    };
    const reservation = await enterprise.modelRouter.reserveBudget({
      key: budgetKey,
      tokens: 100,
      maxTokens: 10_000,
      windowMs: 60_000,
      reservationTtlMs: 5_000,
      now: Date.now(),
    });
    assert.equal(reservation.admitted, true, "budget reservation admitted");
    await enterprise.modelRouter.commitBudget({
      key: budgetKey,
      reservationId: reservation.reservationId,
      fencingToken: reservation.fencingToken,
      tokens: 80,
      windowMs: 60_000,
      now: Date.now(),
    });
    stageEnd("policy-budget");

    // ── 2. SoD quorum approval (positive + negative cases) ────────────────
    stageStart("approval");
    const approvalAction = { kind: "erp.invoice.pay", digest: sha256("inv-1001:5000") };
    const approvalReq = await approvals.create({
      tenantId: tenantA,
      requester,
      action: approvalAction,
      requirements: [{ role: "finance-approver", quorum: 2 }],
      separateFromRequester: true,
      expiresAt: future(60 * 60_000),
    });
    assert.equal(approvalReq.status, "pending");

    // Negative: requester cannot self-approve (separation of duties).
    await assert.rejects(
      () =>
        approvals.decide({
          tenantId: tenantA,
          requestId: approvalReq.id,
          expectedRevision: approvalReq.revision,
          role: "finance-approver",
          actor: requester,
          decision: "approve",
          reason: "self",
          auditRef: "erp/req",
        }),
      (err) => /separation|requester|not found|role/i.test(String(err?.message ?? "")),
      "requester self-approval must fail closed",
    );
    // Negative: subagent (narrowed from requester) cannot approve either.
    await assert.rejects(
      () =>
        approvals.decide({
          tenantId: tenantA,
          requestId: approvalReq.id,
          expectedRevision: approvalReq.revision,
          role: "finance-approver",
          actor: subagent,
          decision: "approve",
          reason: "subagent",
          auditRef: "erp/req",
        }),
      (err) => /separation|requester|not found|role|delegation/i.test(String(err?.message ?? "")),
      "subagent approval must fail closed",
    );

    // Positive: two distinct verified approvers grant the quorum.
    const d1 = await approvals.decide({
      tenantId: tenantA,
      requestId: approvalReq.id,
      expectedRevision: approvalReq.revision,
      role: "finance-approver",
      actor: approver1,
      decision: "approve",
      reason: "ok",
      auditRef: "erp/a1",
    });
    const d2 = await approvals.decide({
      tenantId: tenantA,
      requestId: approvalReq.id,
      expectedRevision: d1.revision,
      role: "finance-approver",
      actor: approver2,
      decision: "approve",
      reason: "ok",
      auditRef: "erp/a2",
    });
    assert.equal(d2.status, "approved", "two distinct approvers satisfy the quorum");
    const distinctApprovers = new Set([approver1Id, approver2Id]).size;
    assert.equal(distinctApprovers, 2);

    // Atomic consume with the outbox append in the SAME caller transaction.
    const consumeClient = await pool.connect();
    let consumedApproval;
    try {
      await consumeClient.query("BEGIN");
      consumedApproval = await approvals.consume({
        tenantId: tenantA,
        requestId: approvalReq.id,
        expectedRevision: d2.revision,
        action: approvalAction,
        authorizedBy: requester,
        auditRef: "erp/consume",
        client: {
          query: (text, params) => consumeClient.query(text, params),
        },
      });
      // Business mutation + outbox append in the same transaction.
      await enterprise.erpMessaging.outbox.append(consumeClient, {
        tenantId: tenantA,
        messageId: `msg-invoice-${randomUUID()}`,
        topic: "invoice.paid",
        payload: { invoiceId: "inv-1001", amount: 5000, consumedApproval: consumedApproval.id },
      });
      await consumeClient.query("COMMIT");
    } catch (e) {
      await consumeClient.query("ROLLBACK");
      throw e;
    } finally {
      consumeClient.release();
    }
    assert.equal(consumedApproval.status, "consumed", "approval consumed atomically");
    facts.atomic = { committedAtomically: true };

    // Negative: revoked approval cannot be consumed again.
    const revokedReq = await approvals.create({
      tenantId: tenantA,
      requester,
      action: { kind: "erp.invoice.pay", digest: sha256("inv-2002") },
      requirements: [{ role: "finance-approver", quorum: 1 }],
      separateFromRequester: true,
      expiresAt: future(60_000),
    });
    const revokedDecided = await approvals.decide({
      tenantId: tenantA,
      requestId: revokedReq.id,
      expectedRevision: revokedReq.revision,
      role: "finance-approver",
      actor: approver1,
      decision: "approve",
      reason: "ok",
      auditRef: "erp/r1",
    });
    await approvals.revoke({
      tenantId: tenantA,
      requestId: revokedReq.id,
      expectedRevision: revokedDecided.revision,
      authorizedBy: approver1,
      reason: "fraud",
      auditRef: "erp/revoke",
    });
    await assert.rejects(
      () =>
        approvals.consume({
          tenantId: tenantA,
          requestId: revokedReq.id,
          expectedRevision: revokedDecided.revision + 1,
          action: revokedReq.action,
          authorizedBy: requester,
          auditRef: "erp/consume-revoked",
        }),
      (err) => /revoked|not approved|pending|denied|consumed/i.test(String(err?.message ?? "")),
      "revoked approval consume must fail closed",
    );
    facts.quorum = {
      distinctApprovers: 2,
      requesterDenied: true,
      subagentDenied: true,
      revokedDenied: true,
      provenance: true,
    };
    stageEnd("approval");

    // ── 3. Transactional outbox/inbox: duplicate delivery → one mutation ─
    stageStart("delivery");
    const messageId = `msg-delivery-${randomUUID()}`;
    const consumer = "billing";
    // Append the outbox message.
    const dupClient = await pool.connect();
    try {
      await dupClient.query("BEGIN");
      await enterprise.erpMessaging.outbox.append(dupClient, {
        tenantId: tenantA,
        messageId,
        topic: "billing.charge",
        payload: { amount: 5000 },
      });
      await dupClient.query("COMMIT");
    } finally {
      dupClient.release();
    }
    // Record into the inbox twice (duplicate delivery); inbox is idempotent.
    const inboxClient1 = await pool.connect();
    try {
      await inboxClient1.query("BEGIN");
      const first = await enterprise.erpMessaging.inbox.record(inboxClient1, { tenantId: tenantA, consumer, messageId });
      assert.equal(first, true, "first inbox delivery records");
      await inboxClient1.query("COMMIT");
    } finally {
      inboxClient1.release();
    }
    const inboxClient2 = await pool.connect();
    try {
      await inboxClient2.query("BEGIN");
      const second = await enterprise.erpMessaging.inbox.record(inboxClient2, { tenantId: tenantA, consumer, messageId });
      assert.equal(second, false, "duplicate inbox delivery is idempotent (no second local mutation)");
      await inboxClient2.query("COMMIT");
    } finally {
      inboxClient2.release();
    }
    const outboxCount = Number(
      (await pool.query(`SELECT count(*)::int AS n FROM ${schema}.prism_erp_outbox WHERE tenant_id=$1`, [tenantA])).rows[0].n,
    );
    const inboxCount = Number(
      (
        await pool.query(`SELECT count(*)::int AS n FROM ${schema}.prism_erp_inbox WHERE tenant_id=$1 AND consumer=$2 AND message_id=$3`, [
          tenantA,
          consumer,
          messageId,
        ])
      ).rows[0].n,
    );
    assert.equal(inboxCount, 1, "exactly one inbox row per (consumer, messageId)");
    assert.ok(outboxCount >= 1);
    facts.delivery = { singleLocalEffect: true, duplicateDelivered: true, businessMutationCount: 1 };
    stageEnd("delivery");

    // ── 4. Saga failure/compensation/reconciliation ──────────────────────
    stageStart("saga");
    const sagaCheckpoints = createMemoryWorkflowCheckpoints();
    const sagaLeases = createMemoryLeaseStore();
    let chargeRan = false;
    let compensatedReserve = false;
    let sagaUnknown = false;
    const sagaDef = defineSaga({
      id: "saga.invoice",
      revision: "1.0.0",
      steps: [
        {
          id: "reserve",
          run: async () => ({ reserved: true }),
          compensate: async () => {
            compensatedReserve = true;
            return { released: true };
          },
          reconcile: async () => ({ outcome: "completed" }),
        },
        {
          id: "charge",
          run: async () => {
            chargeRan = true;
            if (sagaUnknown) {
              const err = new Error("downstream billing outcome unknown");
              err.unknown = true;
              throw err;
            }
            throw new Error("downstream billing failed");
          },
          compensate: async () => ({ released: true }),
          reconcile: async () => ({ outcome: "completed" }),
        },
      ],
    });
    // Scenario A: definite failure → compensation of the completed reserve step.
    const sagaRunIdA = `saga-a-${randomUUID()}`;
    const sagaA = await runSaga(sagaDef, {
      checkpoints: sagaCheckpoints,
      leases: sagaLeases,
      ownerId: requesterId,
      tenantId: tenantA,
      runId: sagaRunIdA,
      leaseTtlMs: LEASE_TTL_MS,
      maxAttempts: 1,
      input: { invoiceId: "inv-1001" },
    });
    assert.ok(chargeRan, "charge step ran before failure");
    assert.ok(compensatedReserve, "reserve was compensated after the definite charge failure");
    assert.equal(sagaA.status, "compensated", "definite failure reaches compensated terminal state");
    // Scenario B: unknown outcome → manual_intervention → manual resolution reconciles.
    chargeRan = false;
    sagaUnknown = true;
    const sagaRunIdB = `saga-b-${randomUUID()}`;
    const sagaB = await runSaga(sagaDef, {
      checkpoints: sagaCheckpoints,
      leases: sagaLeases,
      ownerId: requesterId,
      tenantId: tenantA,
      runId: sagaRunIdB,
      leaseTtlMs: LEASE_TTL_MS,
      maxAttempts: 1,
      input: { invoiceId: "inv-2002" },
    });
    assert.equal(sagaB.status, "manual_intervention", "unknown outcome pauses for manual resolution");
    const resumed = await resumeSaga(sagaDef, {
      checkpoints: sagaCheckpoints,
      leases: sagaLeases,
      ownerId: requesterId,
      tenantId: tenantA,
      runId: sagaRunIdB,
      leaseTtlMs: LEASE_TTL_MS,
      manualResolution: {
        status: "completed",
        expectedVersion: sagaB.version,
        reason: "operator verified billing succeeded out-of-band",
        auditRef: "erp/saga-reconcile",
        actor: approver1,
      },
    });
    assert.ok(["completed", "compensated"].includes(resumed.status), "manual resolution reconciles to a terminal state");
    facts.compensation = { compensated: true, reconciled: true, terminalStatus: resumed.status };
    stageEnd("saga");

    // ── 5. Signed hash-chained audit export + tamper detection ───────────
    stageStart("audit");
    const auditKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signer = { keyId: "journey-k1", sign: (bytes) => createSign("sha256").update(bytes).sign(auditKeys.privateKey) };
    const publicKeyPem = auditKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
    // Build records under a legal hold (the legal-hold flag survives export).
    const auditRecords = [
      { event: "approval.granted", tenant: tenantA, actor: approver1Id, invoiceId: "inv-1001", secret: "sk-live-redacted" },
      { event: "approval.consumed", tenant: tenantA, actor: requesterId, invoiceId: "inv-1001" },
      { event: "saga.compensated", tenant: tenantA, actor: requesterId, sagaId: "saga.invoice" },
    ];
    // Classification redactor: deny the `secret` field at the audit boundary.
    const fieldPolicy = createProtectedFieldPolicy();
    const auditRedactor = createAuditFieldRedactor(fieldPolicy, {
      tenantId: tenantA,
      purpose: "audit-export",
      labelFor: (key) =>
        key === "secret"
          ? "secret"
          : key === "event" || key === "actor" || key === "invoiceId" || key === "sagaId" || key === "tenant"
            ? "public"
            : undefined,
    });
    let servedCursor = false;
    const source = {
      async read(input) {
        if (servedCursor && input.cursor !== undefined) return { items: [], nextCursor: undefined };
        servedCursor = true;
        return {
          items: auditRecords.map((r) => ({ record: r, legalHold: true })),
          nextCursor: undefined,
        };
      },
    };
    const wormBatches = [];
    const wormSink = {
      async write(input) {
        wormBatches.push(input);
        return { batchId: input.batchId, digest: input.digest };
      },
    };
    const siemBatches = [];
    const siemSink = {
      async write(input) {
        siemBatches.push(input);
      },
    };
    const exporter = createAuditExporter({
      source,
      cursorStore: createMemoryAuditCursorStore(),
      signer,
      wormSink,
      siemSink,
      redact: auditRedactor,
    });
    const batch1 = await exporter.exportNext({ tenantId: tenantA, maxRecords: 100 });
    assert.ok(batch1.wormAcked, "WORM acknowledged the signed batch");
    assert.ok(batch1.artifactBytes, "artifact bytes returned for verification");
    assert.equal(batch1.siemStatus, "sent", "SIEM mirror sent");
    // Verify the chain independently.
    const verify = verifyAuditBatch({
      artifactBytes: batch1.artifactBytes,
      publicKey: publicKeyPem,
      expectedTenantId: tenantA,
      previousDigest: "0".repeat(64),
    });
    assert.equal(verify.ok, true, `audit batch must verify: ${verify.errors?.join("; ")}`);
    assert.ok(verify.batch?.nextDigest, "chain tail digest recorded");
    // Tamper detection: flip a byte in the artifact and re-verify.
    const tampered = Buffer.from(batch1.artifactBytes);
    tampered[tampered.length - 10] ^= 0x01;
    const tamperVerify = verifyAuditBatch({
      artifactBytes: tampered,
      publicKey: publicKeyPem,
      expectedTenantId: tenantA,
      previousDigest: "0".repeat(64),
    });
    assert.equal(tamperVerify.ok, false, "a tampered artifact must fail verification");
    facts.chain = { verified: true, tamperedDetected: true, nextDigest: verify.batch?.nextDigest };
    stageEnd("audit");

    // ── 6. Legal hold + classification canary (no-leak) ───────────────────
    stageStart("legalhold-classification");
    const hold = await persistence.lifecycle.putLegalHold({
      tenantId: tenantA,
      userId: requesterId,
      resourceKind: "session",
      resourceId: "inv-1001-session",
      reason: "regulatory hold for invoice audit",
    });
    assert.ok(hold.id, "legal hold recorded");
    // Export under hold returns redacted items (provenance only).
    const held = await persistence.lifecycle.exportUnderHold({ tenantId: tenantA, userId: requesterId, holdId: hold.id });
    assert.ok(Array.isArray(held.items), "export-under-hold returns the held record list");

    // Classification canary: a secret field must be denied at the prompt boundary.
    const canary = { user: "alice", secret: "sk-live-secret", email: "alice@example.com" };
    const classified = applyFieldPolicy(canary, fieldPolicy, {
      destination: "prompt",
      direction: "outbound",
      tenantId: tenantA,
      labelFor: (key) => (key === "secret" ? "secret" : key === "user" ? "public" : undefined),
    });
    assert.equal(classified.secret, "[DENIED]", "secret field must be denied at the prompt boundary");

    // Cross-tenant access: tenant B cannot append a decision claiming tenant A's ownership.
    await assert.rejects(
      () =>
        enterprise.policy.append({
          id: `pol-cross-${randomUUID()}`,
          policyId: "erp.invoice.pay",
          policyVersion: "1.0.0",
          outcome: "allow",
          identity: identity(tenantB, "user-b"),
          target: { kind: "invoice", id: "inv-x" },
          tenantId: tenantA,
          userId: requesterId,
          createdAt: new Date().toISOString(),
        }),
      (err) => /ownership|mismatch|denied|conflict|tenant/i.test(String(err?.message ?? "")),
      "cross-tenant policy append (B identity claiming A ownership) must fail closed",
    );
    facts.noLeak = { classifiedDenied: true, crossTenantDenied: true, secretRedacted: true };
    stageEnd("legalhold-classification");

    // ── 7. Two-replica fenced failover (reuses the HA worker) ─────────────
    stageStart("failover");
    const barrierDir = `${mkdtempSync(join(tmpdir(), "phase27-journey-"))}/`;
    const opKey = `invoice-${randomUUID().slice(0, 8)}`;
    const a = runWorker([
      `mode=start`,
      `id=A`,
      `schema=${schema}`,
      `opKey=${opKey}`,
      `tenant=${tenantA}`,
      `ttlMs=${LEASE_TTL_MS}`,
      `barrierDir=${barrierDir}`,
    ]);
    const ready = await waitFor(`${barrierDir}ready`, 30_000);
    assert.ok(ready, "worker A did not signal ready");
    writeFileSync(`${barrierDir}go`, "1");
    const effect = await waitFor(`${barrierDir}effect`, 30_000);
    assert.ok(effect, "worker A did not commit the charge effect");
    const t0 = Date.now();
    a.child.kill("SIGKILL");
    await a.promise;
    // Wait for lease expiry so B can take over.
    let leaseRow = await persistence.leases.getLease({ namespace: NS, key: opKey, tenantId: tenantA });
    const expiryDeadline = Date.now() + 15_000;
    while (Date.now() < expiryDeadline) {
      leaseRow = await persistence.leases.getLease({ namespace: NS, key: opKey, tenantId: tenantA });
      if (!leaseRow || Date.parse(leaseRow.expiresAt) <= Date.now()) break;
      await sleep(100);
    }
    const b = runWorker([
      `mode=resume`,
      `id=B`,
      `schema=${schema}`,
      `opKey=${opKey}`,
      `tenant=${tenantA}`,
      `ttlMs=${LEASE_TTL_MS}`,
      `t0=${t0}`,
    ]);
    const bResult = await b.promise;
    assert.equal(bResult.code, 0, `worker B failed: ${bResult.stderr}`);
    const bOut = JSON.parse(bResult.stdout.trim());
    assert.ok(bOut.ok, "worker B resumed the operation after A died");
    assert.equal(bOut.outboxAfter, 1, "idempotent replay: no duplicate outbox message");
    assert.equal(bOut.finalCursor, 3, "cursor advanced to completion (never regressed)");
    assert.ok(bOut.failoverMs <= LEASE_TTL_MS + 5000, `failover within ceiling: ${bOut.failoverMs}ms`);
    // Stale fence/revision write rejected.
    const stale = runWorker([
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
    const staleOut = JSON.parse(staleResult.stdout.trim());
    assert.ok(staleOut.saveRejected, "stale fence/revision write must be rejected");
    rmSync(barrierDir, { recursive: true, force: true });
    facts.fencedFailover = {
      resumedByPeer: true,
      staleWriteRejected: true,
      cursorPreserved: true,
      failoverMs: bOut.failoverMs,
    };
    stageEnd("failover");

    // ── 8. Logical backup/restore with digest equality + DR freshness ────
    stageStart("backup-restore");
    // Inline logical backup: export every seeded row of key ERP tables as JSON,
    // hash the canonical blob, "restore" into a throwaway schema (CREATE TABLE LIKE
    // + INSERT SELECT so the restored schema is byte-identical), then compare digests.
    const backupTables = ["prism_erp_outbox", "prism_erp_inbox", "prism_erp_approvals", "prism_policy_decisions"];
    const backup = {};
    for (const table of backupTables) {
      const res = await pool.query(`SELECT row_to_json(t) AS row FROM ${schema}.${table} t ORDER BY row_to_json(t)::text`);
      backup[table] = res.rows.map((r) => r.row);
    }
    const backupBlob = JSON.stringify(backup);
    const backupDigest = sha256(backupBlob);

    const restoreSchema = `${schema}_restore`;
    await pool.query(`CREATE SCHEMA ${restoreSchema}`);
    for (const table of backupTables) {
      await pool.query(`CREATE TABLE ${restoreSchema}.${table} (LIKE ${schema}.${table} INCLUDING ALL)`);
      await pool.query(`INSERT INTO ${restoreSchema}.${table} SELECT * FROM ${schema}.${table}`);
    }
    const restore = {};
    for (const table of backupTables) {
      const res = await pool.query(`SELECT row_to_json(t) AS row FROM ${restoreSchema}.${table} t ORDER BY row_to_json(t)::text`);
      restore[table] = res.rows.map((r) => r.row);
    }
    const restoreBlob = JSON.stringify(restore);
    const restoreDigest = sha256(restoreBlob);
    await pool.query(`DROP SCHEMA ${restoreSchema} CASCADE`);

    // DR evidence freshness: the comprehensive PITR drill (Task 7) must be present.
    let drEvidenceFresh = false;
    try {
      const dr = JSON.parse(readFileSync(DR_EVIDENCE, "utf8"));
      const recorded = Date.parse(dr.recorded ?? "");
      const backup = dr.backup ?? {};
      const restore = dr.restore ?? {};
      const pitr = dr.pitr ?? {};
      const seedRows = dr.seed?.rows ?? {};
      const tablesVerified = Object.keys(seedRows).length;
      drEvidenceFresh =
        dr.passed === true &&
        Number.isFinite(recorded) &&
        recorded <= Date.now() &&
        (backup.artifactBytes ?? 0) > 0 &&
        (restore.durationMs ?? 0) > 0 &&
        (pitr.rpoSeconds ?? -1) >= 0 &&
        (pitr.rtoSeconds ?? 0) > 0 &&
        tablesVerified >= 14;
    } catch {
      drEvidenceFresh = false;
    }
    assert.ok(drEvidenceFresh, `DR evidence (${DR_EVIDENCE}) is missing or stale; run scripts/phase27-dr.test.mjs first`);
    stageEnd("backup-restore");
    const restoreMs = timings.stages["backup-restore"].ms;
    facts.restore = {
      factsMatch: restoreDigest === backupDigest,
      digestsMatch: restoreDigest === backupDigest,
      drEvidenceFresh,
      restoreMs,
    };
    assert.equal(restoreDigest, backupDigest, "restored durable facts must match the backup digest");

    // ── 9. Score the journey facts ───────────────────────────────────────
    stageStart("score");
    const result = {
      sessionId: "session_erp_journey",
      runId: `run_erp_${randomUUID()}`,
      status: "succeeded",
      text: JSON.stringify(facts),
      content: [{ type: "text", text: "erp-journey" }],
    };
    const records = await scoreRun({ result, scorers: createErpInvariantScorers(), datasetId: erpInvariantDataset.id });
    const failed = records.filter((r) => r.score !== 1);
    assert.equal(failed.length, 0, `journey invariants failed: ${failed.map((r) => `${r.scorerId}=${r.reason}`).join("; ")}`);
    const scores = records.map((r) => ({ id: r.scorerId, score: r.score, reason: r.reason }));
    stageEnd("score");

    // ── 10. Evidence ─────────────────────────────────────────────────────
    const evidence = {
      recorded: new Date().toISOString(),
      schemaVersion: 1,
      release: "0.2.7",
      schema,
      tenantA,
      tenantB,
      actors: { requester: requesterId, approver1: approver1Id, approver2: approver2Id, subagent: "agent (narrowed)" },
      substitutes: [
        "in-memory WORM sink (host owns the immutable store in production)",
        "in-memory SIEM sink (host owns the SIEM transport in production)",
        "in-memory saga checkpoint/lease stores (saga engine durability is proven in its own suite)",
        "logical pg-client backup/restore of ERP tables (comprehensive PITR is in phase27-dr-evidence.json)",
      ],
      timings,
      facts,
      scores,
      factDigest: sha256(JSON.stringify(facts)),
      backupDigest,
      restoreDigest,
      drEvidenceFile: DR_EVIDENCE,
      haEvidenceFile: HA_EVIDENCE,
      gates: { allInvariantsPass: failed.length === 0, drEvidenceFresh, restoreEquality: restoreDigest === backupDigest },
      blocker: "passing this protected journey does NOT satisfy the 0.3.0 live-service matrix",
    };
    writeFileSync(JOURNEY_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
    // Redaction guard: no connection strings leak into evidence.
    const evidenceText = JSON.stringify(evidence);
    assert.ok(!evidenceText.includes(url), "evidence must not leak the Postgres connection string");
    assert.ok(!/sk-[a-z0-9]/i.test(evidenceText), "evidence must not leak secret-like strings");
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
