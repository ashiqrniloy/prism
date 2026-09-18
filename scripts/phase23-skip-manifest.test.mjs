// Plan 023 Task 3 regression: release skip manifest (release-evidence.json).
// Requires the real coverage artifact (scripts/coverage-summary.json) — runs
// after test:coverage in sdk:ready, like scripts/phase23-coverage.test.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkReleaseEvidence } from "./release.mjs";

const ROOT = join(import.meta.dirname, "..");
const EMITTER = join(ROOT, "scripts", "release-skip-manifest.mjs");
const DUMMY_POSTGRES_URL = "postgres://ci:ci@localhost:5432/ci"; // presence signal only; must never appear in the manifest
const CURRENT_HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

function latestBaseline() {
  const files = readdirSync(join(ROOT, "scripts"))
    .filter((f) => /^phase\d+-baseline\.json$/.test(f))
    .sort();
  const name = files.at(-1);
  return { name, data: JSON.parse(readFileSync(join(ROOT, "scripts", name), "utf8")) };
}

function matchingPostgresEvidence(overrides = {}) {
  return { gitHead: CURRENT_HEAD, captured: new Date().toISOString(), counts: { tests: 3, pass: 3, fail: 0 }, ...overrides };
}

function runEmitter(env, postgresEvidence) {
  const dir = mkdtempSync(join(tmpdir(), "prism-evidence-"));
  const manifestPath = join(dir, "release-evidence.json");
  const childEnv = { ...env, PRISM_RELEASE_EVIDENCE: manifestPath };
  if (postgresEvidence === undefined) {
    childEnv.PRISM_POSTGRES_EVIDENCE = join(dir, "missing-postgres-evidence.json");
  } else {
    const evidencePath = join(dir, "postgres-evidence.json");
    writeFileSync(evidencePath, JSON.stringify(postgresEvidence));
    childEnv.PRISM_POSTGRES_EVIDENCE = evidencePath;
  }
  const result = spawnSync(process.execPath, [EMITTER], {
    encoding: "utf8",
    // env is the authoritative full child env (callers start from a process.env
    // copy); re-spreading process.env here would resurrect keys callers deleted.
    env: childEnv,
  });
  assert.equal(result.status, 0, `emitter failed:\n${result.stderr}`);
  return { dir, manifestPath, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) };
}

test("blocked-not-skip: a missing required env records the durable legs blocked, never pass/skip, and the gate fails closed", () => {
  const env = { ...process.env };
  delete env.PRISM_TEST_POSTGRES_URL;
  const { dir, manifestPath, manifest } = runEmitter(env);
  try {
    const postgres = manifest.surfaces.find((s) => s.name === "test:postgres durable conformance");
    assert.ok(postgres, "postgres durable surface must be listed");
    assert.equal(postgres.state, "blocked");
    assert.equal(postgres.requiredEnv, "PRISM_TEST_POSTGRES_URL");
    assert.equal(postgres.protected, true);
    assert.equal(manifest.blocked, true);
    assert.throws(
      () => checkReleaseEvidence({ manifestPath }),
      /test:postgres durable conformance/,
      "release gate must fail closed on a blocked required surface",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CI verify defers postgres to postgres-integration via PRISM_RELEASE_POSTGRES_JOB", () => {
  const env = { ...process.env, PRISM_RELEASE_POSTGRES_JOB: "1" };
  delete env.PRISM_TEST_POSTGRES_URL;
  const { dir, manifestPath, manifest } = runEmitter(env, matchingPostgresEvidence({ gitHead: "0".repeat(40) }));
  try {
    const postgres = manifest.surfaces.find((s) => s.name === "test:postgres durable conformance");
    assert.equal(postgres.state, "protected");
    assert.match(postgres.reason, /postgres-integration/);
    assert.doesNotThrow(() => checkReleaseEvidence({ manifestPath }), "deferred postgres must not block the gate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("postgres requires matching this-tree evidence", () => {
  const env = { ...process.env, PRISM_TEST_POSTGRES_URL: DUMMY_POSTGRES_URL };
  const missing = runEmitter(env);
  const stale = runEmitter(env, matchingPostgresEvidence({ gitHead: "0".repeat(40) }));
  const matching = runEmitter(env, matchingPostgresEvidence());
  try {
    for (const [label, result, reason] of [
      ["missing", missing, /no postgres evidence/],
      ["stale", stale, /not for current git HEAD/],
    ]) {
      const postgres = result.manifest.surfaces.find((surface) => surface.name === "test:postgres durable conformance");
      assert.equal(postgres.state, "blocked", `${label} evidence must block postgres`);
      assert.match(postgres.reason, reason);
    }
    const postgres = matching.manifest.surfaces.find((surface) => surface.name === "test:postgres durable conformance");
    assert.equal(postgres.state, "pass");
    assert.equal(postgres.count, 3);
  } finally {
    for (const { dir } of [missing, stale, matching]) rmSync(dir, { recursive: true, force: true });
  }
});

test("protected-named: every protected/live skip class has a reason and required env; the 33 skips stay visible", () => {
  const { dir, manifestPath, manifest } = runEmitter(
    { ...process.env, PRISM_TEST_POSTGRES_URL: DUMMY_POSTGRES_URL },
    matchingPostgresEvidence(),
  );
  try {
    assert.equal(manifest.blocked, false, "with the required env declared nothing may be blocked");
    const baseline = latestBaseline();
    const counts = baseline.data.exitGate?.counts ?? {};
    const core = manifest.surfaces.find((s) => s.name === "core npm test");
    assert.equal(core.state, "pass");
    assert.equal(
      core.skip,
      Number(/(\d+) tests? \/ (\d+) pass \/ (\d+) skip/.exec(counts.npmTest ?? "")?.[3]),
      "skip count must match the phase baseline",
    );
    assert.ok(core.skip >= 33, `the frozen floor of 33 protected/live skips must stay visible, got ${core.skip}`);
    const protectedRows = manifest.surfaces.filter((s) => s.state === "protected");
    for (const row of protectedRows) {
      assert.ok(row.reason, `${row.name} needs a documented reason`);
      if (row.requiredEnv) assert.match(row.requiredEnv, /^PRISM_[A-Z0-9_]+$/, `${row.name} requiredEnv must be an env NAME`);
      assert.ok(row.protected, `${row.name} must be classified protected`);
    }
    const requiredEnvs = new Set(protectedRows.map((s) => s.requiredEnv).filter(Boolean));
    for (const env of ["PRISM_TEST_POSTGRES_URL", "PRISM_TEST_NATS_URL", "PRISM_LIVE_PROVIDER_TESTS"]) {
      assert.ok(requiredEnvs.has(env), `protected classes must cover ${env}`);
    }
    assert.ok(
      protectedRows.filter((s) => s.name.includes("live provider legs")).length >= 8,
      "the PRISM_LIVE_PROVIDER_TESTS provider classes must all be named",
    );
    const nats = manifest.surfaces.find((s) => s.name === "test:nats real JetStream legs");
    assert.doesNotMatch(nats.reason, /no suite references PRISM_TEST_NATS_URL/);
    assert.doesNotThrow(() => checkReleaseEvidence({ manifestPath }), "the declared-profile manifest must pass the gate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live-canary-not-pass + cross-reference: canaries are protected with inherited evidence, never pass", () => {
  const { dir, manifest } = runEmitter({ ...process.env, PRISM_TEST_POSTGRES_URL: DUMMY_POSTGRES_URL }, matchingPostgresEvidence());
  try {
    const canaries = manifest.surfaces.filter((s) => s.live && /canary/.test(s.name));
    assert.equal(canaries.length, 4, "the four live canaries from live-canary.mjs must be named");
    for (const canary of canaries) {
      assert.equal(canary.state, "protected", `${canary.name} can never be pass`);
      assert.ok(canary.reason, `${canary.name} needs a documented reason`);
      assert.ok(canary.source.includes("live-canaries.yml"), `${canary.name} must cite its workflow`);
      assert.ok(canary.source.includes(manifest.crossRef.baseline), `${canary.name} must inherit baseline evidence`);
    }
    assert.match(manifest.crossRef.baseline, /^phase\d+-baseline\.json$/);
    assert.ok(manifest.crossRef.exitGate, "cross-reference must carry the exitGate shape");
    assert.ok(manifest.crossRef.protectedEvidence, "cross-reference must carry protectedEvidence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unexplained-skip-rejected: a skip without reason and required env fails the gate; a documented one passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-evidence-"));
  try {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ release: "0.2.3", surfaces: [{ name: "mystery suite", state: "skip" }] }));
    assert.throws(() => checkReleaseEvidence({ manifestPath: bad }), /unexplained skips/);
    const good = join(dir, "good.json");
    writeFileSync(
      good,
      JSON.stringify({
        release: "0.2.3",
        surfaces: [
          { name: "documented suite", state: "skip", reason: "needs a real service", requiredEnv: "PRISM_TEST_NATS_URL" },
          { name: "core npm test", state: "pass", count: 1, skip: 0 },
        ],
      }),
    );
    assert.doesNotThrow(() => checkReleaseEvidence({ manifestPath: good }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no-secret: the manifest records env var names only, never values", () => {
  const { dir, manifest } = runEmitter({ ...process.env, PRISM_TEST_POSTGRES_URL: DUMMY_POSTGRES_URL }, matchingPostgresEvidence());
  try {
    const text = JSON.stringify(manifest);
    assert.doesNotMatch(text, /postgres:\/\//, "the declared URL value must never appear");
    assert.doesNotMatch(text, /PRISM_[A-Z0-9_]+=/, "no env assignments may be recorded");
    assert.ok(!manifest.surfaces.some((s) => Object.hasOwn(s, "value")), "no row may carry a value field");
    for (const row of manifest.surfaces) {
      if (row.requiredEnv) assert.match(row.requiredEnv, /^PRISM_[A-Z0-9_]+$/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wiring: release:evidence is emitted before release:gate and retained by CI", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  assert.equal(scripts["release:evidence"], "node scripts/release-skip-manifest.mjs");
  assert.ok(scripts["release:gate"].includes("release-skip-manifest.mjs"), "release:gate must emit the manifest first");
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.ok(workflow.includes("PRISM_TEST_POSTGRES_URL"), "verify job must declare the postgres release profile");
  assert.ok(workflow.includes("release-evidence.json"), "release.yml must retain the manifest");
  assert.ok(existsSync(join(ROOT, "scripts", "release-skip-manifest.mjs")), "emitter must exist");
});
