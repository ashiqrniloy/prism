/**
 * Plan 029 Task 0 scope gate. Schema-only: no live network.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase29-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase29-baseline.json"), "utf8"));
const packageTruth = JSON.parse(readFileSync(url("./package-truth.json"), "utf8"));

const TASK_IDS = ["task0", "task1", "task2", "task3", "task4", "task5", "task6", "task7", "task8", "task9", "task10"];
const REQUIRED_ALLOWED = [
  "packages/provider-deepseek/**",
  "packages/provider-xai/**",
  "packages/provider-clinepass/**",
  "packages/prism-impeccable/**",
  "src/oauth-device-code.ts",
  "SuperGrok",
];
const REQUIRED_FORBIDDEN = [
  "cline-workos-oauth",
  "deepseek-anthropic-route",
  "grok-cli-auth-file-scan",
  "harness-rewrite",
  "independent-package-versions",
];

test("phase29 freeze: release identity and required keys", () => {
  assert.equal(manifest.release, "0.2.9");
  assert.equal(manifest.line, "0.2.x");
  assert.equal(manifest.type, "adoption");
  assert.equal(manifest.baseline, "0.2.8");
  for (const key of ["allowed", "forbidden", "deviations", "packageBudget", "compat", "releasePolicy", "oauth", "tasks", "security"]) {
    assert.ok(key in manifest, `manifest missing ${key}`);
  }
});

test("phase29 freeze: SuperGrok OAuth is allowed; harness and piggyback paths are forbidden", () => {
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
  assert.equal(manifest.oauth.superGrok, "authorized");
  assert.equal(manifest.oauth.hostInvoked, true);
  assert.equal(manifest.oauth.clineWorkos, "out");
  assert.ok(manifest.oauth.eligibility.includes("auth.x.ai"));
});

test("phase29 freeze: deviations require task+change+rationale; Task 1 deferrals recorded", () => {
  assert.ok(Array.isArray(manifest.deviations));
  for (const deviation of manifest.deviations) {
    assert.equal(typeof deviation.task, "string");
    assert.ok(deviation.task.length > 0);
    assert.equal(typeof deviation.change, "string");
    assert.ok(deviation.change.length > 0);
    assert.equal(typeof deviation.rationale, "string");
    assert.ok(deviation.rationale.length > 0);
  }
  const task1 = manifest.deviations.filter((entry) => entry.task === "task1");
  assert.ok(task1.length >= 5, "Task 1 records verified deferrals");
  const blob = JSON.stringify(task1);
  for (const token of ["/anthropic", "grok-4.5", "GET /models", "upstreamPath", "PKCE"]) {
    assert.ok(blob.includes(token), `Task 1 deviations mention ${token}`);
  }
});

test("phase29 freeze: evidence file records primitive + OAuth tokens", () => {
  const evidence = readFileSync(url("../docs/_evidence/phase29-primitive-review.md"), "utf8");
  for (const token of ["pollDeviceCodeToken", "auth.x.ai", "grok-cli:access", "createOpenAICompatibleProvider", "upstreamPath"]) {
    assert.ok(evidence.includes(token), `evidence missing ${token}`);
  }
  assert.ok(evidence.includes("authorized"));
  assert.ok(evidence.includes("WorkOS"));
});

test("phase29 freeze: task0/task1 done, remaining tasks pending-or-done", () => {
  assert.equal(manifest.tasks.task0, "done");
  assert.equal(manifest.tasks.task1, "done");
  for (const id of TASK_IDS) {
    assert.ok(typeof manifest.tasks[id] === "string" && manifest.tasks[id].length > 0, `${id} has a token`);
    assert.ok(manifest.tasks[id] === "done" || manifest.tasks[id] === "pending", `${id} must be pending or done`);
  }
});

test("phase29 freeze: security and compat policy", () => {
  assert.equal(manifest.compat.additiveOnly, true);
  assert.equal(manifest.compat.baselineRelease, "0.2.8");
  assert.ok(existsSync(url("../scripts/compat-baseline")));
  assert.equal(manifest.releasePolicy.auditLevelTarget, "moderate");
  assert.equal(manifest.releasePolicy.noNewCoreRuntimeDependencies, true);
  assert.equal(manifest.security.auditTarget, 0);
  assert.equal(manifest.security.compat, "additive-only");
  assert.ok(manifest.security.superGrok.includes("host-invoked"));
});

test("phase29 freeze: 0.2.8 baseline records exit-gate counts and 51-package graph", () => {
  assert.equal(baseline.release, "0.2.8");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
  assert.equal(baseline.compat.breakingDeltas, 0);
  assert.equal(baseline.compat.policy, "additive-only");
  assert.equal(baseline.manifestCount.publishable, 51);
  assert.equal(baseline.manifestCount.workspace, 50);
  assert.equal(baseline.exitGate.version, "0.2.8");
  assert.equal(baseline.exitGate.green, true);
  assert.equal(baseline.exitGate.counts.publishable, 51);
  assert.ok(String(baseline.exitGate.counts.audit).includes("0"));
});

test("phase29 freeze: package budget transition resolves through the recorded supersession map", () => {
  const budget = manifest.packageBudget;
  // Frozen arithmetic: internal consistency of the 0.2.9 record. It is never re-derived
  // from the live tree (plan 054 consolidated 62 manifests into 10), it only has to stay
  // self-consistent and keep naming real plans below.
  assert.equal(budget.baselinePublishable + budget.newPackages, budget.targetPublishable);
  assert.equal(budget.baselineWorkspace + budget.newPackages, budget.targetWorkspace);
  assert.equal(budget.baselineProvider + 3, budget.targetProvider);
  assert.equal(budget.baselineFamily + 1, budget.targetFamily);
  assert.equal(budget.newRuntimeDependencyNames, 0);

  const livePackages = new Set(Object.keys(packageTruth.versions));
  const liveProviders = new Set(packageTruth.providers);
  const live = new Set([...livePackages, ...packageTruth.family, ...packageTruth.capability, ...liveProviders]);
  const planFiles = readdirSync(url("../plans")).filter((file) => file.endsWith(".md"));
  const assertPlan = (by, where) => {
    const match = /^plan (\d{3})$/.exec(by ?? "");
    assert.ok(match, `${where} names a plan (got ${JSON.stringify(by)})`);
    assert.ok(
      planFiles.some((file) => file.startsWith(match[1])),
      `${where} names an existing plan (plan ${match[1]})`,
    );
  };

  // Every name the era recorded resolves to a live specifier, directly or through a
  // recorded folding that names the plan that folded it.
  const targets = new Set();
  for (const row of budget.supersession) {
    assert.ok(row.name?.startsWith("@arnilo/"), `row ${row.name} names a package`);
    const folded = "foldedInto" in row;
    assert.notEqual("live" in row, folded, `${row.name} has exactly one of live / foldedInto`);
    const target = folded ? row.foldedInto : row.live;
    assert.ok(live.has(target), `${row.name} resolves to a live specifier (${target})`);
    if (folded) assertPlan(row.by, `${row.name} -> ${target}`);
    targets.add(target);
  }
  assert.ok(
    budget.supersession.some((row) => "live" in row),
    "the map keeps at least one still-live name",
  );
  assert.ok(
    budget.supersession.some((row) => "foldedInto" in row),
    "the map keeps at least one recorded folding",
  );

  // Post-era additions are recorded with their plan, not inferred from the count.
  const lateAdditions = Object.entries(budget.lateAdditions);
  assert.ok(lateAdditions.length > 0, "post-era additions are recorded");
  for (const [name, by] of lateAdditions) {
    assert.ok(live.has(name), `late addition ${name} is live`);
    assertPlan(by, name);
  }
  const lateProviders = lateAdditions.filter(([name]) => liveProviders.has(name));
  assert.equal(
    packageTruth.counts.provider,
    budget.targetProvider + lateProviders.length,
    "provider adapters are the era target plus every recorded addition",
  );
  // The era's provider growth is exactly the set of provider foldings the map records: the
  // equation above counts those names inside targetProvider, so a deleted row breaks it.
  const eraProviderRows = budget.supersession.filter((row) => row.foldedInto?.startsWith("@arnilo/prism-providers/"));
  assert.equal(eraProviderRows.length, budget.targetProvider - budget.baselineProvider, "era provider adapters are recorded as foldings");

  // The map explains today's graph exactly: an unrecorded package fails, a retired
  // package with no folding record fails, and the counts are derived from the map.
  const mappedPackages = [...targets, ...lateAdditions.map(([name]) => name)].filter((name) => livePackages.has(name));
  assert.deepEqual([...new Set(mappedPackages)].sort(), [...livePackages].sort());
  assert.equal(packageTruth.counts.publishable, new Set(mappedPackages).size);
  // The root package is the only publishable manifest that is not a workspace.
  assert.equal(packageTruth.counts.workspace, new Set(mappedPackages).size - 1);
  for (const name of packageTruth.family) assert.ok(targets.has(name), `family package ${name} is a recorded target`);
});
