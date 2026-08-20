/**
 * Phase 18 (0.1.6) Task 0 demand-gate registry and scope gate (plan 018 Task 0).
 * Validates scripts/phase18-freeze-manifest.json: the 0.1.6 release/line/type,
 * the demand-gate registry (five closeouts with status demanded|deferred, named
 * demand evidence, disjoint allowed-file scopes), allowed/forbidden change
 * lists, the additive-only compat promise (no --allow-break), the audit/
 * signed-tag/provenance policy, and per-task evidence tokens. Validates
 * scripts/phase18-baseline.json coherence against the real filesystem and the
 * live source.
 *
 * DEMAND STATE MACHINE:
 * - while a closeout's task token is 'pending', every file in its allowed scope
 *   must be byte-identical to the Task 0 baseline hash (files recorded as
 *   "absent" must not exist) — a deferred closeout's scope is immutable, and a
 *   demanded-but-not-yet-implemented closeout is still frozen;
 * - a closeout flips to 'demanded' ONLY with non-empty named demand evidence
 *   (host/integration/operator + date) in the manifest;
 * - once a task token is 'done' the closeout MUST be demanded (implementing a
 *   deferred closeout fails loud);
 * - the Task 7 exit gate is null until recorded; when recorded it must be green
 *   with all task tokens done and full gate evidence.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase18-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase18-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

const CLOSEOUTS = manifest.demandGates.closeouts;
const CLOSEOUT_IDS = ["acp-session-store", "native-sandbox", "doc-reader", "delete-glob", "checkpoint-bodies"];
const TASKS = ["task1", "task2", "task3", "task4", "task5", "task6", "task7"];

function closeoutById(id) {
  const c = CLOSEOUTS.find((c) => c.id === id);
  assert.ok(c, `closeout ${id} present in the registry`);
  return c;
}

function sha256(file) {
  return createHash("sha256")
    .update(readFileSync(url(`../${file}`)))
    .digest("hex");
}

test("manifest targets release 0.1.6 on the 0.1.x demand-gated-closeouts line off the 0.1.5 baseline", () => {
  assert.equal(manifest.release, "0.1.6");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "demand-gated-closeouts");
  assert.ok(manifest.baseline.startsWith("0.1.5"), "baseline names 0.1.5");
});

test("demand-gate registry lists exactly the five roadmap closeouts with valid status and disjoint allowed scopes", () => {
  const gates = manifest.demandGates;
  assert.equal(gates.active, true);
  assert.equal(CLOSEOUTS.length, 5, "exactly five closeouts");
  assert.deepEqual(CLOSEOUTS.map((c) => c.id).sort(), [...CLOSEOUT_IDS].sort(), "registry ids match the roadmap 0.1.6 closeout set");
  for (const c of CLOSEOUTS) {
    assert.ok(c.task.startsWith("task") && TASKS.includes(c.task), `${c.id} maps to a phase-18 task`);
    assert.ok(c.status === "deferred" || c.status === "demanded", `${c.id} status is demanded|deferred`);
    assert.ok(Array.isArray(c.allowedFiles) && c.allowedFiles.length > 0, `${c.id} lists allowed files`);
    assert.ok(c.rationale.length > 0, `${c.id} records its roadmap rationale`);
  }
  // allowed scopes are disjoint so a single-file diff can never satisfy two closeouts ambiguously
  const seen = new Map();
  for (const c of CLOSEOUTS) {
    for (const f of c.allowedFiles) {
      assert.ok(!seen.has(f), `file ${f} claimed by both ${seen.get(f)} and ${c.id}`);
      seen.set(f, c.id);
    }
  }
});

test("demand evidence is machine-checkable: demanded requires named user + date; deferred requires empty evidence", () => {
  for (const c of CLOSEOUTS) {
    const ev = c.demandEvidence;
    assert.ok(typeof ev === "object" && ev !== null, `${c.id} carries a demandEvidence object`);
    if (c.status === "demanded") {
      assert.ok(typeof ev.user === "string" && ev.user.length > 0, `${c.id} demanded: named user/host required`);
      assert.ok(typeof ev.date === "string" && ev.date.length > 0, `${c.id} demanded: date required`);
      assert.ok(typeof ev.integration === "string" && ev.integration.length > 0, `${c.id} demanded: integration description required`);
    } else {
      assert.deepEqual(ev, {}, `${c.id} deferred: demandEvidence must be empty until demand arrives`);
    }
  }
});

test("allowed and forbidden change lists are disjoint; deviations are structured", () => {
  assert.ok(manifest.allowedChanges.length >= 7, "allowed changes cover registry/review/implementation/docs/bump/baseline/wiring");
  for (const token of [
    "demandEvidence",
    "primitive-review",
    "allowedFiles",
    "additive public exports",
    "version bump 0.1.5 -> 0.1.6",
    "--update-baseline",
    "phase18-freeze.test.mjs",
  ]) {
    assert.ok(
      manifest.allowedChanges.some((c) => c.includes(token)),
      `allowed list names ${token}`,
    );
  }
  assert.ok(manifest.forbiddenChanges.length >= 9, "forbiddenChanges covers deferred-scope/defaults/breaking/deps/0.2.0/baseline items");
  for (const token of [
    "deferred closeout",
    "behavior change to any default",
    "additive-only",
    "--allow-break",
    "dependency-free core",
    "0.1.7 items",
    "0.2.0 items",
    "ponytail: comments",
    "support matrix",
  ]) {
    assert.ok(
      manifest.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  const allowedSet = new Set(manifest.allowedChanges);
  for (const f of manifest.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
  const { deviations } = manifest;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  for (const d of deviations) {
    assert.ok(typeof d.task === "string" && d.task.length > 0, "deviation names its task");
    assert.ok(typeof d.change === "string" && d.change.length > 0, "deviation describes the change");
    assert.ok(typeof d.rationale === "string" && d.rationale.length > 0, "deviation records the rationale");
  }
});

test("compat promise is additive-only: plain gate at 0.1.6, no --allow-break, regeneration only after 0 breaking deltas", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.5");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("ADDITIVE-ONLY"), "0.1.6 compat promise is additive-only");
  assert.ok(compat.promise.includes("WITHOUT --allow-break"), "no --allow-break anywhere in 0.1.6");
  assert.ok(compat.promise.includes("zero breaking declaration deltas"), "plain gate must prove 0 breaking deltas");
  assert.ok(compat.promise.includes("--update-baseline"), "regeneration happens only via --update-baseline");
  assert.ok(compat.promise.includes("doc-reader"), "promise accounts for the optional doc-reader manifest growth");
});

test("support matrix stays frozen at the phase 12 manifest (0.1.6 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.6 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the eight plan 018 tasks with Task 0 done and Tasks 1-7 pending", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", ...TASKS]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  assert.ok(tasks.task0.includes("fc914aa"), "Task 0 token records the 0.1.5 HEAD");
  for (const id of TASKS) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics, moderate audit, and per-closeout fail-closed guarantees", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.blockedGatePolicy.includes("deferred"), "deferred closeouts are recorded, never silently skipped");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
  assert.ok(security.closeoutPolicy.includes("deny-by-default"), "deny-by-default preserved");
  assert.ok(security.closeoutPolicy.includes("explicit activation"), "no implicit activation by import/discovery/sniffing");
  assert.ok(security.closeoutPolicy.includes("ERR_PRISM_ACP_INPUT"), "cross-tenant ownership refusal preserved");
  assert.ok(security.closeoutPolicy.includes("SecretRedactor"), "redaction at payload boundaries preserved");
  assert.ok(security.closeoutPolicy.includes("fail-closed"), "fail-closed without peers/platform guarantees");
});

test("baseline evidence file exists, is valid JSON captured at 0.1.5, with green npm test/audit/release gate", () => {
  assert.ok(existsSync(url("./phase18-baseline.json")));
  assert.equal(baseline.release, "0.1.5");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
  assert.ok(baseline.gitHead.length >= 7, "git head recorded");
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.equal(baseline.npmTest.corePass, 1428, "core pass count recorded (1428)");
  assert.equal(baseline.npmTest.scriptGatesFail, 0);
  assert.equal(baseline.npmTest.scriptGatesPass, 173, "script gate pass count recorded (173)");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
  assert.equal(baseline.releaseGate.version, "0.1.5");
  assert.equal(baseline.releaseGate.packages, 49);
  assert.equal(baseline.releaseGate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem (doc-reader adds exactly one when demanded)", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)))
    .filter((e) => e.name !== "computer-use-linux" && e.name !== "antigravity-agent");
  const providerDirs = workspaceDirs.filter((d) => d.name.startsWith("provider-"));
  const prismDirs = workspaceDirs.filter((d) => d.name.startsWith("prism-"));
  const docReaderDemanded = closeoutById("doc-reader").status === "demanded";
  const expectedWorkspace = mc.workspacePackages + (docReaderDemanded ? 1 : 0);
  assert.equal(
    workspaceDirs.length,
    expectedWorkspace,
    "workspacePackages matches packages/*/package.json count (+doc-reader if demanded)",
  );
  if (docReaderDemanded) {
    assert.ok(
      workspaceDirs.some((d) => d.name === "document-reader"),
      "the extra workspace package is document-reader",
    );
  }
  assert.equal(mc.categories.provider, providerDirs.length, "provider category count matches packages/provider-*");
  assert.equal(mc.categories.prism, prismDirs.length, "prism category count matches packages/prism-*");
  assert.equal(
    mc.categories.capability + (docReaderDemanded ? 1 : 0),
    expectedWorkspace - providerDirs.length - prismDirs.length,
    "capability = remainder (+doc-reader if demanded; document-reader is a capability package)",
  );
  assert.equal(mc.publishable, mc.workspacePackages + 1, "publishable = root + workspace (baseline 49)");
  assert.equal(mc.rootPackage, rootPkg.name, "root package name matches package.json");
});

test("baseline closeout inventory mirrors the manifest registry (same ids/tasks/status)", () => {
  assert.equal(baseline.closeouts.length, CLOSEOUTS.length, "inventory and registry list the same count");
  for (const b of baseline.closeouts) {
    const c = closeoutById(b.id);
    assert.equal(b.task, c.task, `${b.id} task matches`);
    assert.equal(b.status, c.status, `${b.id} status matches`);
    assert.deepEqual(b.seamFiles, c.allowedFiles, `${b.id} seam scope matches the registry allowed files`);
    for (const f of b.seamFiles) {
      assert.ok(baseline.fileHashes[f] !== undefined, `baseline records a hash for ${f}`);
    }
  }
});

test("DEMAND STATE MACHINE: pending closeouts keep their seam files byte-identical; absent files stay absent", () => {
  for (const c of CLOSEOUTS) {
    const token = manifest.tasks[c.task];
    for (const f of c.allowedFiles) {
      const recorded = baseline.fileHashes[f];
      assert.ok(recorded !== undefined, `baseline records ${f}`);
      if (token.startsWith("pending")) {
        if (recorded === "absent") {
          assert.ok(!existsSync(url(`../${f}`)), `${c.task} pending: ${f} must not exist yet`);
        } else {
          assert.equal(
            sha256(f),
            recorded,
            `${c.task} pending: ${f} changed — Task 0 baseline no longer matches live source (deferred scope is immutable)`,
          );
        }
      } else {
        assert.ok(token.startsWith("done"), `${c.task} token must be pending or done, got: ${token}`);
        assert.equal(c.status, "demanded", `${c.task} done: closeout ${c.id} must be demanded, not deferred`);
      }
    }
  }
});

test("demand gate ordering: a done closeout task requires named demand evidence; Task 1 requires at least one demanded closeout", () => {
  const tasks = manifest.tasks;
  for (const c of CLOSEOUTS) {
    if (tasks[c.task].startsWith("done")) {
      const ev = c.demandEvidence;
      assert.ok(typeof ev.user === "string" && ev.user.length > 0, `${c.id} done: named demand evidence required`);
      assert.ok(typeof ev.integration === "string" && ev.integration.length > 0, `${c.id} done: integration recorded`);
    }
  }
  if (tasks.task1.startsWith("done")) {
    assert.ok(
      CLOSEOUTS.some((c) => c.status === "demanded"),
      "Task 1 (primitive review) may land only after at least one closeout is demanded",
    );
  }
});

test("exit gate: null until Task 7 records it; green with full evidence once recorded", () => {
  const gate = baseline.exitGate;
  if (gate === null) return; // pre-Task-7 state
  const extraManifests = closeoutById("doc-reader").status === "demanded" ? 1 : 0;
  assert.equal(gate.green, true, "exit gate must be green");
  assert.equal(gate.npmTest.exitCode, 0);
  assert.equal(gate.npmTest.coreFail, 0, "no core failures at the exit gate");
  assert.equal(gate.npmTest.scriptGatesFail, 0, "no script-gate failures at the exit gate");
  assert.equal(gate.sdkReady.exitCode, 0);
  assert.equal(gate.audit.vulnerabilities, 0);
  assert.equal(gate.audit.level, "moderate");
  assert.equal(gate.packDryRun.packages, 49 + extraManifests, "pack dry-run covers baseline manifests (+doc-reader)");
  assert.equal(gate.packDryRun.deterministic, true, "two dry-runs must be byte-identical");
  assert.equal(gate.releaseGate.version, "0.1.6", "release gate ran at 0.1.6");
  assert.equal(gate.releaseGate.packages, 49 + extraManifests);
  assert.equal(gate.releaseGate.errors, 0, "release gate must be clean at 0.1.6");
  for (const id of ["task0", ...TASKS]) {
    assert.ok(manifest.tasks[id]?.startsWith("done"), `task ${id} token must be done before the exit gate records evidence`);
  }
});

test("phase18-freeze.test.mjs is wired into the npm test script after phase 17 (Task 0 wiring)", () => {
  assert.ok(
    rootPkg.scripts.test.includes("scripts/phase18-freeze.test.mjs"),
    "package.json test script runs scripts/phase18-freeze.test.mjs",
  );
  assert.ok(
    rootPkg.scripts.test.indexOf("scripts/phase18-freeze.test.mjs") > rootPkg.scripts.test.indexOf("scripts/phase17-freeze.test.mjs"),
    "phase18 freeze test runs after phase17 freeze test",
  );
});

test("phase 18 baseline is newer than the phase 17 freeze manifest (captured at Task 0)", () => {
  assert.ok(
    statSync(url("./phase18-baseline.json")).mtimeMs >= statSync(url("./phase17-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 17 freeze manifest",
  );
});
