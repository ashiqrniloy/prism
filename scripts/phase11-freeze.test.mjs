/**
 * Phase 11 (0.0.28) Task 0 freeze manifest schema gate (plan 011 Task 0).
 * Validates scripts/phase11-freeze-manifest.json: placement decisions,
 * cap default/hard pairs, p95 ceilings, security invariants, and fixture
 * lists. Tasks 1-6 tests import the manifest and assert their exports,
 * error codes, and caps match it exactly.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync(new URL("./phase11-freeze-manifest.json", import.meta.url), "utf8"));

test("manifest targets release 0.0.28", () => {
  assert.equal(manifest.release, "0.0.28");
  assert.equal(manifest.baseline.startsWith("0.0.27"), true);
});

test("placement: module keys are real packages plus exactly one flagged new package", () => {
  const modules = manifest.placement.modules;
  const names = Object.keys(modules);
  assert.ok(names.length >= 5, "expected all five adapter placements");
  const realPackages = new Set(readdirSync(new URL("../packages", import.meta.url)));
  const newNames = new Set(manifest.placement.newPackages.map((p) => p.name));
  for (const name of names) {
    const pkgName = name.split("/").slice(0, 2).join("/");
    if (newNames.has(pkgName)) continue; // created in Task 4
    if (pkgName === "@arnilo/prism") continue; // core lives in root src/, not packages/
    const dir = pkgName.replace("@arnilo/prism-", "");
    assert.ok(realPackages.has(dir) || realPackages.has("prism-core"), `placement package ${pkgName} must exist in packages/`);
  }
  assert.equal(manifest.placement.packageCountAtFreeze, 47);
  assert.equal(manifest.placement.packageCountPlanned, 48);
  assert.equal(manifest.placement.newPackages[0].name, "@arnilo/prism-openapi-tools");
});

test("every module placement has newExports, reusedSeams, and error surface", () => {
  for (const [name, module] of Object.entries(manifest.placement.modules)) {
    assert.ok(Array.isArray(module.newExports), `${name}: newExports`);
    assert.ok(module.newExports.length > 0, `${name}: newExports non-empty`);
    assert.ok(typeof module.reusedSeams === "string", `${name}: reusedSeams`);
    const codes = module.errorCodes ?? module.errorReasons;
    assert.ok(Array.isArray(codes) && codes.length > 0, `${name}: error codes/reasons`);
    for (const code of codes) assert.ok(code.startsWith("ERR_PRISM_"), `${name}: ${code} prefix`);
  }
});

test("caps: every default/hard pair is numeric with default <= hard", () => {
  for (const [group, caps] of Object.entries(manifest.caps)) {
    if (group === "$comment") continue;
    for (const [name, cap] of Object.entries(caps)) {
      if (name === "reuse" || name === "$comment") continue;
      if (cap.kind === "enum") continue;
      assert.ok(Number.isFinite(cap.default) && Number.isFinite(cap.hard), `${group}.${name}: numeric default/hard`);
      assert.ok(cap.default >= 0, `${group}.${name}: default >= 0`);
      assert.ok(cap.hard >= cap.default, `${group}.${name}: hard >= default`);
    }
    if (caps.reuse) {
      for (const entry of Object.values(caps.reuse)) {
        assert.equal(typeof entry, "string", `${group}.reuse entries name the source cap`);
      }
    }
  }
});

test("fixed invariants: oidc algorithms and mcp maxRedirects", () => {
  const oidc = manifest.caps.oidc;
  assert.deepEqual(oidc.algorithms.default, ["RS256", "ES256"]);
  assert.ok(oidc.algorithms.hard.includes("narrow"));
  assert.equal(manifest.caps.mcpOauth.maxRedirects.default, 0);
  assert.equal(manifest.caps.mcpOauth.maxRedirects.hard, 0);
  assert.equal(manifest.caps.oidc.jwksRefetchOnUnknownKid.hard, 1);
});

test("p95 targets: numeric and positive", () => {
  for (const [name, target] of Object.entries(manifest.p95Targets)) {
    if (name === "$comment") continue;
    assert.ok(Number.isFinite(target) && target > 0, `p95 ${name}`);
  }
  assert.ok(manifest.p95Targets.oidcVerifyCacheHitMs < manifest.p95Targets.oidcVerifyCacheMissMs);
});

test("security invariants cover all five adapters", () => {
  for (const key of ["oidc", "policy", "mcpOauth", "openapi", "artifacts"]) {
    assert.ok(manifest.securityInvariants[key].length > 100, `securityInvariants.${key} populated`);
  }
});

test("test fixtures cover all five adapter suites", () => {
  for (const key of ["oidcCases", "policyCases", "mcpOauthCases", "openapiCases", "artifactCases"]) {
    assert.ok(manifest.testFixtures[key].length > 50, `testFixtures.${key} populated`);
  }
});
