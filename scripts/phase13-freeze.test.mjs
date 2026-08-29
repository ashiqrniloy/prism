/**
 * Phase 13 (0.1.1) Task 0 hardening-patch scope gate (plan 013 Task 0).
 * Validates scripts/phase13-freeze-manifest.json: the 0.1.1 release/line/type,
 * the five allowed hardening fixes vs the forbidden 0.1.3+/0.2.0 items, the
 * additive-only compat promise, the audit/signed-tag/provenance policy, the
 * per-task evidence tokens, and the hardening-freeze deviation log. Also
 * validates scripts/phase13-baseline.json coherence against the real filesystem
 * (workspace/provider/prism package counts) and the frozen 0.1.0 evidence, so
 * the baseline used for regression comparison at the Task 6 exit gate is
 * truthful. This is a scope gate, not a release-contract support matrix; the
 * 0.1.x support matrix stays frozen at scripts/phase12-freeze-manifest.json.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase13-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase13-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

test("manifest targets release 0.1.1 on the 0.1.x hardening-patch line off the 0.1.0 baseline", () => {
  assert.equal(manifest.release, "0.1.1");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "hardening-patch");
  assert.ok(manifest.baseline.startsWith("0.1.0"), "baseline names 0.1.0");
});

test("hardening freeze is active with the five allowed fixes and forbidden 0.1.3+/0.2.0 items", () => {
  const freeze = manifest.hardeningFreeze;
  assert.equal(freeze.active, true);
  assert.ok(freeze.allowedChanges.length >= 5, "five hardening fixes allowed");
  for (const token of ["build single-flight", "mcp sse relay", "coverage summary", "manifest-count", "acp modes/config ownership"]) {
    assert.ok(
      freeze.allowedChanges.some((c) => c.includes(token)),
      `allowed list names the ${token} fix`,
    );
  }
  assert.ok(freeze.forbiddenChanges.length >= 4, "forbiddenChanges covers packages/exports/migrations/deps + 0.2.0 + 0.1.3");
  for (const token of [
    "new packages",
    "new public exports or subpaths",
    "new schema migrations",
    "new runtime dependencies",
    "0.2.0 modules",
    "new model providers",
  ]) {
    assert.ok(
      freeze.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  // allowed and forbidden are disjoint (no hardening fix is also forbidden)
  const allowedSet = new Set(freeze.allowedChanges);
  for (const f of freeze.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
});

test("hardening-freeze deviation log is a structured array, empty at Task 0 freeze", () => {
  const { deviations } = manifest.hardeningFreeze;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  assert.equal(deviations.length, 0, "no deviations at Task 0 freeze; each later deviation needs task+change+rationale");
});

test("compat promise is additive-only against the 0.1.0 compat baseline", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.0");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("additive-only"), "0.1.x compat promise is additive-only");
  assert.ok(compat.promise.includes("zero breaking"), "0.1.1 bump targets zero breaking deltas");
});

test("support matrix stays frozen at the phase 12 manifest (0.1.1 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.1 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the seven plan 013 tasks with Task 0 done and Tasks 1-6 pending-or-done", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", "task1", "task2", "task3", "task4", "task5", "task6"]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  for (const id of ["task1", "task2", "task3", "task4", "task5", "task6"]) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics and moderate audit", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
});

test("baseline evidence file exists and is valid JSON captured at 0.1.0", () => {
  assert.ok(existsSync(url("./phase13-baseline.json")));
  assert.equal(baseline.release, "0.1.0");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
});

test("baseline npm test and audit evidence is green at 0.1.0", () => {
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.ok(baseline.npmTest.corePass >= 1416, "core pass count recorded (>= 1416)");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
});

test("baseline coverage is core-only and above the frozen thresholds", () => {
  const cov = baseline.coverage;
  assert.ok(cov.lines >= cov.thresholds.lines, "core lines above threshold");
  assert.ok(cov.functions >= cov.thresholds.functions, "core functions above threshold");
  assert.ok(cov.branches >= cov.thresholds.branches, "core branches above threshold");
  assert.ok(cov.scope.includes("packages/**") && cov.scope.includes("excludes"), "core-only scope documented (plan 010 compromise)");
});

test("baseline release gate is green at 0.1.0 with 49 packages and zero breaking deltas", () => {
  const gate = baseline.releaseGate;
  assert.equal(gate.version, "0.1.0");
  assert.equal(gate.packages, 49);
  assert.equal(gate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)))
    .filter((e) => e.name !== "computer-use-linux" && e.name !== "antigravity-agent" && e.name !== "prism-wiki" && e.name !== "obscura");
  const providerDirs = workspaceDirs.filter((d) => d.name.startsWith("provider-"));
  const prismDirs = workspaceDirs.filter((d) => d.name.startsWith("prism-"));
  assert.equal(mc.workspacePackages, workspaceDirs.length, "workspacePackages matches packages/*/package.json count");
  assert.equal(mc.categories.provider, providerDirs.length, "provider category count matches packages/provider-*");
  assert.equal(mc.categories.prism, prismDirs.length, "prism category count matches packages/prism-*");
  assert.equal(mc.categories.capability, workspaceDirs.length - providerDirs.length - prismDirs.length, "capability = remainder");
  assert.equal(mc.publishable, mc.workspacePackages + 1, "publishable = root + workspace");
  assert.equal(mc.rootPackage, rootPkg.name, "root package name matches package.json");
  assert.ok(mc.contradictionsAudited.length >= 5, "manifest-count contradictions audited for Task 4");
});

test("baseline releaseCheck records the dirty-tree block (clean v0.1.0 passes per plan 012)", () => {
  const check = baseline.releaseCheck;
  assert.equal(check.version, "0.1.0");
  assert.ok(check.status.includes("dirty"), "dirty-tree block recorded (Task 0 uncommitted files)");
  assert.ok(check.status.includes("plan 012"), "points at the plan 012 clean-tree green evidence");
});

test("phase 13 baseline file is newer than the phase 12 freeze manifest (captured at Task 0)", () => {
  assert.ok(
    statSync(url("./phase13-baseline.json")).mtimeMs >= statSync(url("./phase12-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 12 freeze",
  );
});
