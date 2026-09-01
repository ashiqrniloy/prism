/**
 * Plan 030 Task 0 scope gate. Schema-only: no live network, no desktop binary.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase30-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase30-baseline.json"), "utf8"));
const packageTruth = JSON.parse(readFileSync(url("./package-truth.json"), "utf8"));
const antigravity = JSON.parse(readFileSync(url("./phase30-antigravity-assessment.json"), "utf8"));

const TASK_IDS = ["task0", "task1", "task2", "task3", "task4", "task5", "task6", "task7", "task8", "task9", "task10"];
const REQUIRED_ALLOWED = [
  "packages/computer-use-linux/**",
  "packages/antigravity-agent/**",
  "findText",
  "^0.3.0",
  "createAcpFilesystemOperations",
];
const REQUIRED_FORBIDDEN = [
  "changesets",
  "desktop-in-umbrellas",
  "reimplement-computer-use-linux",
  "live-canary-matrix",
  "delegated-cursor",
  "antigravity-direct-oauth-or-session-reuse",
  "antigravity-private-api-or-protocol",
  "antigravity-raw-chain-of-thought-scraping",
  "antigravity-in-provider-catalog-or-umbrellas",
];

test("phase30 freeze: release identity and required keys", () => {
  assert.equal(manifest.release, "0.3.0");
  assert.equal(manifest.line, "0.3.x");
  assert.equal(manifest.type, "demand");
  assert.equal(manifest.baseline, "0.2.9");
  for (const key of [
    "allowed",
    "forbidden",
    "deviations",
    "packageBudget",
    "compat",
    "releasePolicy",
    "desktop",
    "versioning",
    "tasks",
    "amendments",
    "security",
  ]) {
    assert.ok(key in manifest, `manifest missing ${key}`);
  }
});

test("phase30 freeze: allowed tokens and forbidden categories", () => {
  assert.ok(Array.isArray(manifest.allowed) && manifest.allowed.length > 0);
  assert.ok(Array.isArray(manifest.forbidden) && manifest.forbidden.length > 0);
  for (const token of REQUIRED_ALLOWED) {
    assert.ok(
      manifest.allowed.some((item) => item.includes(token)),
      `allowed list must include ${token}`,
    );
  }
  for (const token of REQUIRED_FORBIDDEN) {
    assert.ok(manifest.forbidden.includes(token), `forbidden list must include ${token}`);
  }
  const allowedSet = new Set(manifest.allowed);
  for (const item of manifest.forbidden) {
    assert.ok(!allowedSet.has(item), `forbidden item also allowed: ${item}`);
  }
});

test("phase30 freeze: deviations require task+change+rationale; empty at freeze", () => {
  assert.ok(Array.isArray(manifest.deviations));
  for (const deviation of manifest.deviations) {
    assert.equal(typeof deviation.task, "string");
    assert.ok(deviation.task.length > 0);
    assert.equal(typeof deviation.change, "string");
    assert.ok(deviation.change.length > 0);
    assert.equal(typeof deviation.rationale, "string");
    assert.ok(deviation.rationale.length > 0);
  }
  if (manifest.tasks.task1 === "pending") {
    assert.equal(manifest.deviations.length, 0);
  }
});

test("phase30 freeze: Task 1 primitive-review evidence records implement-or-defer", () => {
  const evidence = readFileSync(url("../docs/_evidence/phase30-primitive-review.md"), "utf8");
  for (const token of [
    "DeviceAdapter",
    "connectMcpTools",
    "assertExecutionAllowed",
    "ReadOperations.readText",
    "AcpClientFilesystem",
    "no core primitive",
  ]) {
    assert.ok(evidence.includes(token), `evidence missing ${token}`);
  }
  const task1 = manifest.deviations.filter((entry) => entry.task === "task1");
  assert.ok(task1.length >= 5, "Task 1 records verified deferrals");
  const blob = JSON.stringify(task1);
  for (const token of [
    "Collapsed desktop API",
    "npm peer",
    "device-primitive",
    "ReadOperations interface",
    "fs/edit",
    "Changesets",
    "umbrellas",
  ]) {
    assert.ok(blob.includes(token), `Task 1 deviations mention ${token}`);
  }
});

test("phase30 freeze: task0 done, remaining tasks pending-or-done", () => {
  assert.equal(manifest.tasks.task0, "done");
  for (const id of TASK_IDS) {
    assert.ok(typeof manifest.tasks[id] === "string" && manifest.tasks[id].length > 0, `${id} has a token`);
    assert.ok(manifest.tasks[id] === "done" || manifest.tasks[id] === "pending", `${id} must be pending or done`);
  }
});

test("phase30 amendment: Antigravity Task 0 records product/terms GO without credential access", () => {
  const amendment = manifest.amendments.antigravity;
  assert.equal(amendment.plan, "031");
  assert.equal(amendment.status, "done");
  assert.equal(amendment.decision, "conditional-go");
  assert.equal(amendment.surface, "official-agy-headless-cli");
  assert.equal(amendment.authenticationOwner, "agy");
  assert.equal(amendment.prismCredentialAccess, false);
  assert.equal(amendment.umbrellaMembership, "omit");
  assert.equal(amendment.providerCatalogMembership, "omit");
  assert.equal(amendment.tasks.task0, "done");
  assert.equal(amendment.tasks.task1, "done");
  assert.equal(amendment.tasks.task2, "done");
  assert.equal(amendment.tasks.task3, "done");
  assert.equal(amendment.tasks.task4, "done");
  assert.equal(amendment.tasks.task5, "done");
  assert.equal(amendment.tasks.task6, "done");
  assert.equal(amendment.tasks.task7, "done");

  assert.equal(antigravity.release, "0.3.0");
  assert.equal(antigravity.plan, "031");
  assert.equal(antigravity.decision, "conditional_go");
  assert.equal(antigravity.product.delegatedLoopAccepted, true);
  assert.equal(antigravity.product.surface, "official-agy-headless-cli");
  assert.equal(antigravity.product.rawChainOfThought, false);
  assert.equal(antigravity.authentication.owner, "official-agy-cli");
  assert.equal(antigravity.authentication.prismCredentialAccess, false);
  assert.equal(antigravity.terms.status, "implementation_go_publication_conditional");
  assert.ok(antigravity.terms.forbidden.includes("antigravity-oauth-reuse"));
  assert.ok(antigravity.terms.forbidden.includes("private-api-or-protocol"));
  assert.equal(antigravity.scope.targetPublishable, 57);
  assert.equal(antigravity.protocolProof.status, "fixture_and_live_stream_passed");
  assert.equal(antigravity.protocolProof.liveStatus, "mcp_permission_blocked");
  assert.equal(antigravity.protocolProof.liveCliVersion, "1.1.16");
  assert.equal(antigravity.protocolProof.liveMcpCalls, 0);
  assert.equal(existsSync(url("./phase30-antigravity-probe.mjs")), true);
  assert.equal(antigravity.protocolProof.task, "task1");
  const primitiveReview = readFileSync(url("../docs/_evidence/phase30-antigravity-primitive-review.md"), "utf8");
  for (const token of [
    "createPrismMcpServer",
    "delegated_agent_step",
    "--fixture",
    "official SDK stdio transport",
    "agy` 1.1.16",
    "auto-denied",
  ]) {
    assert.ok(primitiveReview.includes(token), `Antigravity primitive review missing ${token}`);
  }

  const evidence = readFileSync(url("../docs/_evidence/phase30-antigravity-assessment.md"), "utf8");
  for (const token of [
    "conditional GO",
    "official `agy`",
    "Google AI Pro",
    "Prism never reads credential files",
    "Public publication remains conditional",
    "auto-denied",
    "--dangerously-skip-permissions",
  ]) {
    assert.ok(evidence.includes(token), `Antigravity assessment evidence missing ${token}`);
  }
});

test("phase30 freeze: security, desktop wrap, independent versions after cut", () => {
  assert.equal(manifest.compat.additiveOnly, true);
  assert.equal(manifest.compat.baselineRelease, "0.2.9");
  assert.ok(existsSync(url("./compat-baseline")));
  assert.equal(manifest.releasePolicy.auditLevelTarget, "moderate");
  assert.equal(manifest.releasePolicy.noNewCoreRuntimeDependencies, true);
  assert.equal(manifest.releasePolicy.lastLockstep, true);
  assert.equal(manifest.releasePolicy.peerPolicyAfterCut, "^0.3.0");
  assert.equal(manifest.security.auditTarget, 0);
  assert.equal(manifest.security.desktopBinary, "host-owned");
  assert.equal(manifest.security.antigravityBinary, "host-owned-official-agy");
  assert.equal(manifest.security.antigravityAuthentication, "cli-owned");
  assert.equal(manifest.security.antigravityCredentialAccess, false);
  assert.equal(manifest.desktop.wrapOnly, true);
  assert.equal(manifest.desktop.umbrellaMembership, "omit");
  assert.equal(manifest.desktop.setupToolsDefault, false);
  assert.equal(manifest.versioning.changesets, false);
  assert.equal(manifest.versioning.peerRange, "^0.3.0");
  assert.equal(manifest.versioning.afterCut, "independent");
});

test("phase30 freeze: 0.2.9 baseline records 55-package graph and Decision A", () => {
  assert.equal(baseline.release, "0.2.9");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
  assert.equal(baseline.compat.breakingDeltas, 0);
  assert.equal(baseline.manifestCount.publishable, 55);
  assert.equal(baseline.manifestCount.workspace, 54);
  assert.equal(baseline.peerPolicy.decision, "A");
  assert.equal(baseline.peerPolicy.lockstep, true);
  assert.equal(baseline.exitGate.version, "0.2.9");
  assert.equal(baseline.exitGate.green, true);
  assert.equal(baseline.exitGate.counts.publishable, 55);
  assert.ok(String(baseline.exitGate.counts.audit).includes("0"));
});

test("phase30 freeze: package budget 55→57; graph gains desktop then Antigravity packages", () => {
  const budget = manifest.packageBudget;
  assert.equal(budget.baselinePublishable, 55);
  assert.equal(budget.targetPublishable, 57);
  assert.equal(budget.targetWorkspace, 56);
  assert.equal(budget.newPackages, 2);
  assert.equal(budget.newRuntimeDependencyNames, 0);
  assert.equal(packageTruth.counts.provider, 17);
  const hasGraft = packageTruth.capability.includes("@arnilo/prism-graft"); // plan 033 optional context-graph package
  const hasOffice = packageTruth.capability.includes("@arnilo/prism-office"); // plan 054 Task 8 office family
  assert.equal(
    packageTruth.counts.prismFamily,
    hasOffice
      ? 3
      : packageTruth.family?.includes("@arnilo/prism-coding-tools")
        ? 7
        : packageTruth.family?.includes("@arnilo/prism-core")
          ? 11
          : 10,
  );
  const desktopDone = manifest.tasks.task7 === "done";
  const antigravityDone = manifest.amendments.antigravity.tasks.task6 === "done";
  const hasWiki = packageTruth.capability.includes("@arnilo/prism-wiki");
  const graftTerm = Number(hasGraft);
  // Plan 039: optional host-owned-binary Obscura package (deliberately outside umbrella profiles).
  const hasObscura = packageTruth.capability.includes("@arnilo/prism-obscura");
  const obscuraTerm = Number(hasObscura);
  // Plan 040: dev-only inspector package (deliberately outside umbrella profiles).
  const hasDevInspector = packageTruth.capability.includes("@arnilo/prism-dev");
  // Plan 042: optional versioned prompt registry (deliberately outside umbrella profiles).
  const hasPrompts = packageTruth.capability.includes("@arnilo/prism-prompts");
  // Plan 051: documents engine (deliberately outside umbrella profiles).
  const hasDocuments = packageTruth.capability.includes("@arnilo/prism-documents");
  // Plan 052: sheets engine (deliberately outside umbrella profiles).
  const hasSheets = packageTruth.capability.includes("@arnilo/prism-sheets");
  // Plan 053: diagrams engine (deliberately outside umbrella profiles).
  const hasDiagrams = packageTruth.capability.includes("@arnilo/prism-diagrams");
  const hasCodingTools = packageTruth.family?.includes("@arnilo/prism-coding-tools");
  const hasCore = packageTruth.family?.includes("@arnilo/prism-core");
  // Plan 054 Task 8: -46 folds the 4 profiles + 3 office drafts into the office family
  // (2 done-terms + 1 = 55+3-46 = 11 publishable / 10 workspace).
  const delta = hasOffice ? -46 : hasCodingTools ? -43 : hasCore ? -14 : 0;
  assert.equal(
    packageTruth.counts.publishable,
    55 +
      Number(desktopDone) +
      Number(antigravityDone) +
      Number(hasWiki) +
      graftTerm +
      obscuraTerm +
      Number(hasDevInspector) +
      Number(hasPrompts) +
      Number(hasDocuments) +
      Number(hasSheets) +
      Number(hasDiagrams) +
      delta,
  );
  assert.equal(
    packageTruth.counts.workspace,
    54 +
      Number(desktopDone) +
      Number(antigravityDone) +
      Number(hasWiki) +
      graftTerm +
      obscuraTerm +
      Number(hasDevInspector) +
      Number(hasPrompts) +
      Number(hasDocuments) +
      Number(hasSheets) +
      Number(hasDiagrams) +
      delta,
  );
  if (desktopDone && !hasCodingTools) assert.ok(packageTruth.capability.includes("@arnilo/prism-computer-use-linux"));
  if (hasCodingTools) assert.ok(packageTruth.family.includes("@arnilo/prism-coding-tools"));
  if (antigravityDone) assert.ok(packageTruth.capability.includes("@arnilo/prism-antigravity-agent"));
  if (hasWiki) assert.ok(packageTruth.capability.includes("@arnilo/prism-wiki"));
  if (manifest.tasks.task9 === "pending") {
    assert.equal(packageTruth.peerPolicy.decision, "A");
    assert.equal(packageTruth.root.version, "0.2.9");
  } else {
    // Decision B allows the root to patch independently after the 0.3.0 cut
    // (plan 039 moved the root to 0.3.1 with every changed package).
    assert.ok(
      ["0.3.0", "0.3.1", "0.3.2", "0.3.3", "0.4.0"].includes(packageTruth.root.version),
      `root version ${packageTruth.root.version}`,
    );
    assert.equal(packageTruth.peerPolicy.decision, "B");
    // Peer spec follows the root version (plan 039: ^0.3.0 window peers rewritten to ^0.3.1).
    assert.equal(packageTruth.peerPolicy.spec, `^${packageTruth.root.version}`);
    assert.equal(packageTruth.peerPolicy.atomicUpgrade, false);
  }
});

test("phase30 closeout: current docs, roadmap, and changelogs record the cut", () => {
  assert.equal(manifest.tasks.task10, "done");
  const read = (path) => readFileSync(url(`../${path}`), "utf8");
  const index = read("docs/index.md");
  assert.match(index, /current \*\*0\.[34]\.\d+\*\*/); // current line advances with Decision B / 0.4 lockstep
  for (const token of ["computer-use-linux", "findText", "Decision B", "ACP editor-buffer"]) {
    assert.ok(index.includes(token), `docs/index.md missing ${token}`);
  }
  const roadmap = read("roadmap.md");
  assert.match(roadmap, /### 0\.3\.0 .*(?:Antigravity amendment in progress|Antigravity CLI delegation)/);
  assert.match(roadmap, /Plan 030 is complete/);
  const migration = read("docs/migration.md");
  assert.match(migration, /deny-by-default/);
  assert.match(migration, /outside umbrella/);
  assert.match(migration, /image\/document reads fail closed/);
  for (const path of [
    "CHANGELOG.md",
    existsSync(url("../packages/computer-use-linux/CHANGELOG.md"))
      ? "packages/computer-use-linux/CHANGELOG.md"
      : "packages/prism-coding-tools/CHANGELOG.md",
    existsSync(url("../packages/coding-agent/CHANGELOG.md"))
      ? "packages/coding-agent/CHANGELOG.md"
      : "packages/prism-coding-tools/CHANGELOG.md",
    "packages/ag-ui/CHANGELOG.md",
    "packages/acp-agent/CHANGELOG.md",
    "packages/antigravity-agent/CHANGELOG.md",
  ]) {
    assert.match(read(path), /## \[0\.3\.0\] - 2026-08-20/, `${path} missing 0.3.0 entry`);
  }
});
