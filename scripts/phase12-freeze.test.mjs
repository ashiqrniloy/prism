/**
 * Phase 12 (0.1.0) Task 0 freeze manifest schema gate (plan 012 Task 0).
 * Validates scripts/phase12-freeze-manifest.json: release-contract fields,
 * support matrix coherence with package.json engines and CI, exact protocol
 * SDK pins against package manifests, capacity ceilings, release policy,
 * and the feature-freeze deviation log. Tasks 1-7 import the manifest and
 * assert docs/CI/benchmark rows agree with it.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase12-freeze-manifest.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

test("manifest targets release 0.1.0 on the 0.0.28 baseline", () => {
  assert.equal(manifest.release, "0.1.0");
  assert.ok(manifest.baseline.startsWith("0.0.28"), "baseline names 0.0.28");
});

test("feature freeze is active with structured deviation log", () => {
  const freeze = manifest.featureFreeze;
  assert.equal(freeze.active, true);
  assert.ok(freeze.allowedChanges.length > 0, "allowedChanges non-empty");
  assert.ok(freeze.forbiddenChanges.length >= 4, "forbiddenChanges covers packages/exports/migrations/deps");
  assert.ok(Array.isArray(freeze.deviations), "deviations is an array");
  for (const deviation of freeze.deviations) {
    assert.ok(typeof deviation.task === "string" && deviation.task.length > 0, "deviation names its task");
    assert.ok(typeof deviation.change === "string" && deviation.change.length > 0, "deviation describes the change");
    assert.ok(typeof deviation.rationale === "string" && deviation.rationale.length > 0, "deviation records rationale");
  }
});

test("node support agrees with engines and CI legs", () => {
  const node = manifest.support.node;
  assert.ok(node.supported.length >= 2, "at least two supported Node lines");
  assert.equal(node.enginesRange, rootPkg.engines.node, "enginesRange matches package.json engines.node");
  for (const major of node.supported) {
    assert.ok(Number(major) >= 20, `${major} honors engines floor >=20`);
    assert.ok(node.measuredInCi.includes(major), `${major} has a CI leg`);
  }
  assert.ok(Number(node.docsExamplesMinimum) >= 20, "docsExamplesMinimum above engines floor");
});

test("postgres support is non-empty and matches the CI image", () => {
  const pg = manifest.support.postgres;
  assert.ok(pg.supportedMajorVersions.length > 0, "supported majors listed");
  for (const major of pg.supportedMajorVersions) {
    assert.ok(Number.isInteger(major) && major >= 14, `${major} plausible supported major`);
  }
  const imageMajor = Number(pg.ciImage.match(/pg(\d+)$/)?.[1]);
  assert.ok(pg.supportedMajorVersions.includes(imageMajor), "CI image major is a supported major");
  assert.ok(pg.driver.startsWith("pg@"), "driver pinned to pg");
  assert.ok(Number.isInteger(pg.schemaVersion) && pg.schemaVersion >= 1, "schema version recorded");
});

test("postgres schemaVersion matches the shipped migration contract", async () => {
  const { createPersistenceMigrationContract } = await import(url("../dist/testing/persistence-schema.js"));
  const contract = createPersistenceMigrationContract();
  assert.equal(
    manifest.support.postgres.schemaVersion,
    contract.targetSchemaVersion,
    "freeze schemaVersion must equal the shipped persistence migration contract target",
  );
  assert.equal(contract.steps.length, contract.targetSchemaVersion, "contract steps count equals target schema version");
});

test("protocol SDK pins match the shipped package manifests exactly", () => {
  const deps = (dir) => {
    const pkgPath = existsSync(url(`../packages/${dir}/package.json`))
      ? url(`../packages/${dir}/package.json`)
      : url("../packages/prism-core/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
  };
  const checks = [
    ["mcp", "@modelcontextprotocol/sdk"],
    ["ag-ui", "@agentclientprotocol/sdk"],
    ["ag-ui", "@ag-ui/core"],
    ["session-store-nats", "@nats-io/jetstream"],
    ["session-store-nats", "@nats-io/transport-node"],
  ];
  for (const [dir, name] of checks) {
    assert.equal(manifest.support.protocolSdks[name], deps(dir)[name], `${dir}: ${name} pin drifts from manifest`);
  }
});

test("unsupported list is non-empty and contradicts nothing supported", () => {
  assert.ok(manifest.unsupported.length >= 5, "explicit unsupported combinations listed");
  for (const entry of manifest.unsupported) {
    assert.ok(typeof entry === "string" && entry.length > 3, "entry is a real statement");
    for (const major of manifest.support.postgres.supportedMajorVersions) {
      assert.ok(!entry.toLowerCase().includes(`postgresql ${major} unsupported`), `contradicts supported pg${major}`);
    }
  }
  const joined = manifest.unsupported.join("\n").toLowerCase();
  for (const major of manifest.support.node.supported) {
    assert.ok(!joined.includes(`node ${major} unsupported`), `contradicts supported node ${major}`);
  }
});

test("release policy targets moderate audit, signed tag, and additive compat", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.compatPromise.includes("additive-only"), "0.1.x compat promise is additive-only");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("capacity ceilings are positive and inherited tolerance is bounded", () => {
  const capacity = manifest.capacity;
  assert.ok(capacity.medianTolerance > 0 && capacity.medianTolerance <= 1, "tolerance in (0, 1]");
  assert.ok(Object.keys(capacity.ceilingsMs).length >= 20, "all inherited scenario ceilings present");
  for (const [name, ceiling] of Object.entries(capacity.ceilingsMs)) {
    assert.ok(Number.isFinite(ceiling) && ceiling > 0, `${name} positive finite ceiling`);
  }
  assert.ok(capacity.startupImportMsCeiling > 0, "startup ceiling");
  assert.ok(capacity.rootPackedBytes.baseline > 0 && capacity.rootPackedBytes.tolerance > 0, "packed bytes baseline");
  assert.ok(capacity.rootFileCount.baseline > 0, "file count baseline");
  assert.ok(capacity.postgresEvidence.pointOpP95Ms > 0, "postgres point-op ceiling");
  assert.ok(capacity.postgresEvidence.reconnectP95Ms > 0, "postgres reconnect ceiling (plan 012 Task 4)");
  assert.ok(capacity.e2eJourneyFixtureMsCeiling > 0, "journey fixture runtime ceiling");
});

test("release.yml CI legs match the support matrix", () => {
  const workflow = readFileSync(url("../.github/workflows/release.yml"), "utf8");
  for (const major of manifest.support.node.supported) {
    assert.ok(workflow.includes(`node-version: "${major}"`), `release.yml missing a Node ${major} leg`);
  }
  assert.ok(workflow.includes(manifest.support.postgres.ciImage), "release.yml postgres image drifts from the freeze manifest");
  assert.ok(workflow.includes("sdk:ready"), "release.yml verify leg must run sdk:ready");
});

test("security policy names blocked-gate semantics and real threat-suite files", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy stated");
  assert.ok(security.threatSuites.length >= 5, "phase conformance suites listed");
  for (const entry of security.threatSuites) {
    const file = entry.split(" ")[0];
    assert.ok(existsSync(url(`../${file}`)), `${file} exists`);
  }
  assert.ok(
    security.supplyChain.some((item) => item.includes("audit-level=moderate")),
    "moderate audit in chain",
  );
  assert.ok(
    security.supplyChain.some((item) => item.includes("scan-secrets")),
    "secret scan in chain",
  );
  assert.ok(
    security.supplyChain.some((item) => item.includes("verify-sbom")),
    "SBOM/license in chain",
  );
});
