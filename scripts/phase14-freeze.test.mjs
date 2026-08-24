/**
 * Phase 14 (0.1.2) Task 0 provider-enrichment scope gate (plan 014 Task 0).
 * Validates scripts/phase14-freeze-manifest.json: the 0.1.2 release/line/type,
 * the allowed provider-alibaba enrichment surfaces vs the forbidden
 * core/package/native-endpoint items, the additive-only compat promise, the
 * audit/signed-tag/provenance policy, the per-task evidence tokens, and the
 * enrichment-freeze deviation log. Also validates scripts/phase14-baseline.json
 * coherence against the real filesystem (workspace/provider/prism package
 * counts) and the frozen 0.1.1 evidence, so the baseline used for regression
 * comparison at the Task 6 exit gate is truthful. This is a scope gate, not a
 * release-contract support matrix; the 0.1.x support matrix stays frozen at
 * scripts/phase12-freeze-manifest.json.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase14-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase14-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

test("manifest targets release 0.1.2 on the 0.1.x provider-enrichment line off the 0.1.1 baseline", () => {
  assert.equal(manifest.release, "0.1.2");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "provider-enrichment");
  assert.ok(manifest.baseline.startsWith("0.1.1"), "baseline names 0.1.1");
});

test("enrichment freeze is active with the allowed provider-alibaba surfaces and forbidden items", () => {
  const freeze = manifest.enrichmentFreeze;
  assert.equal(freeze.active, true);
  assert.ok(freeze.allowedChanges.length >= 4, "allowed enrichment surfaces listed");
  for (const token of ["embeddings", "document and video input", "rerank", "docs/providers/alibaba.md"]) {
    assert.ok(
      freeze.allowedChanges.some((c) => c.includes(token)),
      `allowed list names the ${token} surface`,
    );
  }
  assert.ok(freeze.forbiddenChanges.length >= 6, "forbiddenChanges covers core/package/native/0.1.3+/0.2.0 items");
  for (const token of [
    "new packages",
    "core public surface",
    "new runtime dependencies",
    "native DashScope endpoints",
    "async task polling",
    "0.2.0 platform adapters",
    "0.1.3 items",
    "0.1.4 items",
    "0.1.5 items",
    "0.1.6 items",
    "0.1.7 items",
  ]) {
    assert.ok(
      freeze.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  // allowed and forbidden are disjoint (no enrichment surface is also forbidden)
  const allowedSet = new Set(freeze.allowedChanges);
  for (const f of freeze.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
});

test("enrichment-freeze deviation log is a structured array; Task 1 entries carry task+change+rationale", () => {
  const { deviations } = manifest.enrichmentFreeze;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  for (const d of deviations) {
    assert.ok(typeof d.task === "string" && d.task.length > 0, "deviation names its task");
    assert.ok(typeof d.change === "string" && d.change.length > 0, "deviation describes the change");
    assert.ok(typeof d.rationale === "string" && d.rationale.length > 0, "deviation records the rationale");
  }
  const docInput = deviations.find((d) => d.task === "task1" && d.change.includes("document input deferred"));
  assert.ok(docInput, "Task 1 document-input deferral is logged (no compatible-mode document content part)");
});

test("compat promise is additive-only against the 0.1.1 compat baseline", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.1");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("additive-only"), "0.1.x compat promise is additive-only");
  assert.ok(compat.promise.includes("zero breaking"), "0.1.2 bump targets zero breaking deltas");
});

test("support matrix stays frozen at the phase 12 manifest (0.1.2 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.2 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the seven plan 014 tasks with Task 0 done and Tasks 1-6 pending-or-done", () => {
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

test("baseline evidence file exists and is valid JSON captured at 0.1.1", () => {
  assert.ok(existsSync(url("./phase14-baseline.json")));
  assert.equal(baseline.release, "0.1.1");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
});

test("baseline npm test and audit evidence is green at 0.1.1", () => {
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.ok(baseline.npmTest.corePass >= 1418, "core pass count recorded (>= 1418)");
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

test("baseline release gate is green at 0.1.1 with 49 packages and zero breaking deltas", () => {
  const gate = baseline.releaseGate;
  assert.equal(gate.version, "0.1.1");
  assert.equal(gate.packages, 49);
  assert.equal(gate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)))
    .filter((e) => e.name !== "computer-use-linux" && e.name !== "antigravity-agent" && e.name !== "prism-wiki");
  const providerDirs = workspaceDirs.filter((d) => d.name.startsWith("provider-"));
  const prismDirs = workspaceDirs.filter((d) => d.name.startsWith("prism-"));
  assert.equal(mc.workspacePackages, workspaceDirs.length, "workspacePackages matches packages/*/package.json count");
  assert.equal(mc.categories.provider, providerDirs.length, "provider category count matches packages/provider-*");
  assert.equal(mc.categories.prism, prismDirs.length, "prism category count matches packages/prism-*");
  assert.equal(mc.categories.capability, workspaceDirs.length - providerDirs.length - prismDirs.length, "capability = remainder");
  assert.equal(mc.publishable, mc.workspacePackages + 1, "publishable = root + workspace");
  assert.equal(mc.rootPackage, rootPkg.name, "root package name matches package.json");
});

test("baseline provider-alibaba evidence is recorded (suite pass count + tarball size)", () => {
  const pa = baseline.providerAlibaba;
  assert.ok(pa.suitePass >= 1, "provider-alibaba suite pass count recorded");
  assert.ok(pa.tarballPackedBytes > 0, "provider-alibaba tarball packed bytes recorded");
  assert.ok(pa.tarballUnpackedBytes > 0, "provider-alibaba tarball unpacked bytes recorded");
});

test("baseline releaseCheck records the dirty-tree block (clean v0.1.1 passes per plan 013)", () => {
  const check = baseline.releaseCheck;
  assert.equal(check.version, "0.1.1");
  assert.ok(check.status.includes("dirty"), "dirty-tree block recorded (Task 0 uncommitted files)");
  assert.ok(check.status.includes("plan 013"), "points at the plan 013 clean-tree green evidence");
});

test("phase 14 baseline file is newer than the phase 13 freeze manifest (captured at Task 0)", () => {
  assert.ok(
    statSync(url("./phase14-baseline.json")).mtimeMs >= statSync(url("./phase13-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 13 freeze",
  );
});
