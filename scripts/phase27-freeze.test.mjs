#!/usr/bin/env node
/**
 * Plan 027 scope/implementation freeze. This gate checks the machine-readable
 * decisions against current manifests and evidence; protected infrastructure
 * remains a separate release gate.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync("scripts/phase27-freeze-manifest.json", "utf8"));
const plan = readFileSync("plans/027-Release-0-2-7-Enterprise-ERP-Production-Readiness.md", "utf8");
const evidence = readFileSync("docs/release-0.2.7-evidence.md", "utf8");

const TASKS = Object.keys(manifest.tasks);
const THREATS = Array.from({ length: 10 }, (_, index) => `ERP-T${index + 1}`);

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: release, task state, evidence, and blocker", () => {
  assert.equal(manifest.release, "0.2.7");
  assert.equal(manifest.line, "0.2.x");
  assert.equal(manifest.type, "enterprise-erp-production-readiness");
  assert.equal(manifest.tasks.task0, "done");
  assert.equal(manifest.tasks.task1, "done");
  assert.equal(manifest.tasks.task2, "done");
  assert.equal(manifest.tasks.task3, "done");
  assert.equal(manifest.tasks.task4, "done");
  assert.equal(manifest.tasks.task5, "done");
  assert.equal(manifest.tasks.task6, "done");
  assert.equal(manifest.tasks.task7, "done");
  assert.equal(manifest.tasks.task8, "done");
  assert.equal(manifest.tasks.task9, "done");
  assert.equal(manifest.tasks.task10, "done");
  for (const task of TASKS.slice(11)) assert.equal(manifest.tasks[task], "pending", `${task} must remain pending`);
  assert.ok(evidence.includes("Task 0 result"));
  assert.ok(evidence.includes("Task 1 result"));
  assert.ok(evidence.includes("Task 2 result"));
  assert.ok(evidence.includes("Task 3 result"));
  assert.ok(evidence.includes("Task 4 result"));
  assert.ok(evidence.includes("Task 5 result"));
  assert.ok(evidence.includes("not implemented\u2014no demand"));
  assert.ok(evidence.includes("Task 6 result"));
  assert.ok(evidence.includes("phase27-ha-evidence.json"));
  assert.ok(evidence.includes("Task 7 result"));
  assert.ok(evidence.includes("phase27-dr-evidence.json"));
  assert.ok(evidence.includes("Task 8 result"));
  assert.ok(evidence.includes("applyFieldPolicy"));
  assert.ok(evidence.includes("Task 9 result"));
  assert.ok(evidence.includes("phase27-erp-journey.json"));
  assert.ok(evidence.includes("createErpInvariantScorers"));
  assert.ok(evidence.includes("Task 10 result"));
  assert.ok(evidence.includes("phase27-release.test.mjs"));
  assert.ok(evidence.includes("004_erp_messaging"));
  assert.ok(evidence.includes("createPostgresErpMessaging"));
  assert.ok(evidence.includes("005_erp_approvals"));
  assert.ok(evidence.includes("createAuditExporter"));
  assert.ok(evidence.includes("verifyAuditBatch"));
  assert.ok(evidence.includes("createPostgresApprovalStore"));
  assert.ok(evidence.includes("0.3.0 live-service matrix"));
  assert.equal(manifest.compatPolicy.noExactlyOnceClaim, true);
  assert.equal(manifest.compatPolicy.noImplicitCredentialDiscovery, true);
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: package and dependency budgets match manifests", () => {
  assert.equal(manifest.packageBudget.publishable, 51);
  assert.equal(manifest.packageBudget.workspace, 50);
  assert.equal(manifest.packageBudget.runtimeDependencyEntries, 69);
  assert.equal(manifest.packageBudget.workspaceRuntimeEdges, 55);
  assert.equal(manifest.packageBudget.rootRuntimeDependencies, 0);
  assert.equal(manifest.packageBudget.lockfilePackageEntries, 347);
  assert.equal(manifest.packageBudget.newPackages, 1);
  assert.equal(manifest.packageBudget.newRuntimeDependencyNames, 0);
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: all four secret-manager demands are explicit deferrals", () => {
  execFileSync(process.execPath, [new URL("./phase27-demand-gate.mjs", import.meta.url).pathname], {
    encoding: "utf8",
    timeout: 10_000,
  });
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: API ownership and threat mappings are complete", () => {
  assert.deepEqual(
    manifest.apiFreeze.map((entry) => entry.id),
    ["messaging", "saga", "approvals", "audit-export", "field-policy", "erp-evals", "ha-dr", "secret-managers"],
  );
  assert.deepEqual(
    manifest.threats.map((entry) => entry.id),
    THREATS,
  );
  for (const threat of manifest.threats) {
    assert.ok(TASKS.includes(threat.task), `${threat.id} points at a known task`);
    assert.ok(threat.tests.length > 0, `${threat.id} has a test plan`);
  }
  for (const name of ["CheckpointStore", "LeaseStore", "ToolEffectStore", "CredentialResolver", "AgentIdentity", "SecretRedactor"]) {
    assert.ok(evidence.includes(name), `evidence inventories ${name}`);
  }
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: protected policy records names, not values", () => {
  assert.equal(manifest.protectedPolicy.missingRequiredInfrastructureIsPassingSkip, false);
  assert.equal(manifest.protectedPolicy.environmentNamesOnly, true);
  for (const name of manifest.protectedPolicy.requiredEnvNames) {
    assert.match(name, /^PRISM_[A-Z0-9_]+$/);
    assert.ok(!evidence.includes(`${name}=postgres://`), `${name} must not contain a connection-string value`);
    assert.ok(!evidence.includes(`${name}=postgresql://`), `${name} must not contain a connection-string value`);
  }
  assert.ok(manifest.frozenCaps.outboxBacklogClaimP95Ms > 0);
  assert.ok(manifest.frozenCaps.auditMaxBytesPerBatch <= 10 * 1024 * 1024);
  assert.equal(manifest.frozenCaps.leaseTtlMsDefault, 30_000);
  assert.equal(manifest.frozenCaps.leaseTtlMsHard, 300_000);
  assert.ok(manifest.protectedPolicy.currentBackupRestore.startsWith("measured"), "backup/restore must be measured, not pending");
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: measured backup/restore/PITR numbers are recorded", () => {
  const measured = manifest.measuredBackupRestore;
  assert.ok(measured.artifactBytes > 0);
  assert.ok(measured.backupMs > 0);
  assert.ok(measured.restoreMs > 0);
  assert.ok(measured.recoveryMs > 0);
  assert.ok(measured.rpoSeconds >= 0);
  assert.ok(measured.rtoSeconds > 0);
  assert.ok(measured.tablesVerified >= 14);
  assert.ok(!evidence.includes("not measured"), "evidence must not claim backup/restore is unmeasured");
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: measured ERP journey numbers are recorded", () => {
  const measured = manifest.measuredErpJourney;
  assert.ok(measured.durationMs > 0);
  assert.equal(measured.scorers, 8);
  assert.equal(measured.allPassed, true);
  assert.equal(measured.restoreDigestMatch, true);
  assert.equal(measured.drEvidenceFresh, true);
  assert.ok(measured.evidenceFile.includes("phase27-erp-journey.json"));
  assert.ok(measured.blocker.includes("0.3.0"));
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: final release manifest records the closeout", () => {
  const rel = manifest.measuredErpJourney;
  assert.ok(rel.evidenceFile.includes("phase27-erp-journey.json"));
  assert.equal(manifest.tasks.task10, "done");
  assert.ok(manifest.protectedPolicy.currentPostgres.startsWith("measured"), "postgres profile measured this release");
  assert.ok(manifest.protectedPolicy.currentBackupRestore.startsWith("measured"), "backup/restore measured this release");
});

test("Task 0/1/2/3/4/5/6/7/8/9/10 freeze: plan checkbox and docs navigation are wired", () => {
  assert.ok(plan.includes("### 0. [x] Freeze primitives, demand, invariants, threat mappings, and release budgets"));
  assert.ok(plan.includes("### 1. [x] Add transactional outbox/inbox state and bounded dispatch recovery"));
  assert.ok(plan.includes("### 2. [x] Add durable saga compensation and reconciliation on existing state primitives"));
  assert.ok(plan.includes("### 3. [x] Add multi-party and separation-of-duties approval records"));
  assert.ok(plan.includes("### 4. [x] Add signed, hash-chained audit export with WORM and SIEM sinks"));
  assert.ok(plan.includes("### 5. [x] Implement only demanded secret-manager adapters behind the credential contract"));
  assert.ok(plan.includes("### 6. [x] Prove HA registries, leases, cursors, failover, and split-brain recovery"));
  assert.ok(plan.includes("### 7. [x] Rehearse backup, restore, migration rollback, PITR, and disaster recovery"));
  assert.ok(plan.includes("### 8. [x] Add field-level classification and fail-closed redaction at data boundaries"));
  for (const number of TASKS.slice(11).map((task) => task.slice(4)))
    assert.ok(plan.includes(`### ${number}. [ ]`), `Task ${number} remains open`);
  const index = readFileSync("docs/index.md", "utf8");
  assert.ok(index.includes("release-0.2.7-evidence.md"));
});
