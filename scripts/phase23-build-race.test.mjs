// scripts/phase23-build-race.test.mjs — Task 1 stress regression.
//
// Proves build serialization (scripts/with-build-lock.mjs, Option A): a concurrent dist
// consumer must never observe a partially-emitted dist/. Runs inside `npm test`'s gate
// segment (unwrapped — the gate segment is not a dist-consuming leaf), so its own children
// acquire the REAL lock.
//
// The four named orchestrator combos (build+test, two builds, typecheck+test, coverage+test)
// reduce to the same wrapped leaves, so each scenario runs the actual leaf commands
// concurrently. Spawning full `npm test` inside `npm test` would recurse (phase23 runs in
// the gate segment); the leaves are what the orchestrators serialize.
//
// Deterministic pre-fix repro: the "partial dist" sensitivity test proves the importer's
// consistency check catches a partial module graph (the failure a pre-fix race could
// produce for real). The lock-behavior tests prove the serialization primitive; the
// concurrency scenarios prove the wrapped leaves hold up under the four named combos.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const LOCK = join(ROOT, "node_modules", ".prism-build.lock");

function run(execPath, args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    // NODE_TEST_* env leaks from the test-worker parent would make nested `node --test`
    // runs skip everything ("recursively within a test file"); strip it so the importer
    // really runs the suite.
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST_")));
    const child = spawn(execPath, args, {
      cwd,
      env: { ...childEnv, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code, signal) => resolve({ code, signal, out }));
  });
}
const npm = (...args) => run(process.platform === "win32" ? "npm.cmd" : "npm", args);
const node = (...args) => run(process.execPath, args);
const helper = (...args) => node(join("scripts", "with-build-lock.mjs"), ...args);
const helperWithEnv = (env, ...args) => run(process.execPath, [join("scripts", "with-build-lock.mjs"), ...args], { env });

// The importer leaf (the consume side of `npm test`): run one small core test file that
// imports the full dist module graph (dist/__tests__/index.test.js imports ../index.js).
const IMPORTER = ["--test", join("dist", "__tests__", "index.test.js")];
// The importer must actually run tests (a vacuous run exits 0 having skipped everything).
function importerRan(r) {
  return /^ℹ pass/m.test(r.out);
}
// The post-consistency export check: a partial dist missing a known export fails it.
const KNOWN_EXPORTS = ["AgentRunError", "AGENT_RUN_STATE_NAMESPACE"];
const EXPORT_CHECK = [
  "-e",
  `import('@arnilo/prism').then(m=>{for(const k of ${JSON.stringify(KNOWN_EXPORTS)}){if(!(k in m)){console.error('missing export: '+k);process.exit(3)}}})`,
];

async function distConsistent() {
  // Export check against the real root dist + a sample of expected test files present.
  const exportsOk = await node(...EXPORT_CHECK);
  if (exportsOk.code !== 0) return false;
  for (const f of ["index.test.js", "agent-config.types.test.js"]) {
    try {
      readFileSync(join(ROOT, "dist", "__tests__", f));
    } catch {
      return false;
    }
  }
  return true;
}

test("sensitivity: the consistency check catches a partial dist (deterministic pre-fix repro)", async () => {
  // mkdtemp: atomically unique dir, no pid/time collision or overwrite of an attacker-precreated path.
  const dir = mkdtempSync(join(tmpdir(), "prism-partial-"));
  try {
    const dist = join(dir, "dist");
    // A module graph missing one known export — the shape a mid-emit tsc could leave behind.
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.js"), "export const AgentRunError = class {};\n");
    const partial = await node(
      "-e",
      `import('file://${join(dist, "index.js")}').then(m=>{for(const k of ${JSON.stringify(KNOWN_EXPORTS)}){if(!(k in m)){process.exit(3)}}})`,
    );
    assert.notEqual(partial.code, 0, "partial dist must fail the consistency check");
    assert.equal(await distConsistent(), true, "real dist must pass the consistency check");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("temp fixture directories are atomically unique and cleaned up even on assertion failure", () => {
  const dirs = [];
  try {
    for (let i = 0; i < 2; i++) dirs.push(mkdtempSync(join(tmpdir(), "prism-phase23-")));
    assert.notEqual(dirs[0], dirs[1], "concurrent temp dirs must never collide");
    assert.throws(() => {
      throw new Error("simulated assertion failure");
    });
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
  for (const d of dirs) assert.equal(existsSync(d), false, "finally must clean up on failure");
});

test("stale lock (dead holder) is reclaimed and the child runs", async () => {
  // 2147483647 is beyond the Linux pid max — process.kill(pid, 0) is always ESRCH.
  writeFileSync(LOCK, "2147483647 0\n");
  const r = await helper("node", "-e", "1");
  assert.equal(r.code, 0, `stale lock must be reclaimed; got: ${r.out}`);
  let released = true;
  try {
    readFileSync(LOCK);
    released = false;
  } catch {
    /* gone — expected */
  }
  assert.equal(released, true, "lock must be released after the child");
});

test("live lock is not stolen: the second acquirer fails closed on timeout", async () => {
  const fd = openSync(LOCK, "wx");
  writeFileSync(fd, `${process.pid} ${Date.now()}\n`);
  try {
    const r = await helperWithEnv({ PRISM_BUILD_LOCK_TIMEOUT_MS: "500" }, "node", "-e", "1");
    assert.notEqual(r.code, 0, "a live lock must never be stolen; holder pid was ours");
  } finally {
    rmSync(LOCK, { force: true });
  }
});

test("clean stays standalone and unwrapped", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts.clean, "rm -rf dist packages/*/dist");
});

test("scenario 1: concurrent npm run build + importer never observe partial dist", async () => {
  const [build, importer] = await Promise.all([npm("run", "build"), node(...IMPORTER)]);
  assert.equal(build.code, 0, `concurrent build failed:\n${build.out}`);
  assert.equal(importer.code, 0, `importer observed a bad dist:\n${importer.out}`);
  assert.ok(importerRan(importer), `importer must actually run tests:\n${importer.out}`);
  assert.equal(await distConsistent(), true);
});

test("scenario 2: two concurrent builds both complete, dist stays consistent", async () => {
  const [a, b, importer] = await Promise.all([npm("run", "build:core"), npm("run", "build:core"), node(...IMPORTER)]);
  assert.equal(a.code, 0, `build A failed:\n${a.out}`);
  assert.equal(b.code, 0, `build B failed:\n${b.out}`);
  assert.equal(importer.code, 0, `importer observed a bad dist:\n${importer.out}`);
  assert.ok(importerRan(importer), `importer must actually run tests:\n${importer.out}`);
  assert.equal(await distConsistent(), true);
});

test("scenario 3: concurrent npm run typecheck + importer never observe partial dist", async () => {
  const [tc, importer] = await Promise.all([npm("run", "typecheck"), node(...IMPORTER)]);
  assert.equal(tc.code, 0, `concurrent typecheck failed:\n${tc.out}`);
  assert.equal(importer.code, 0, `importer observed a bad dist:\n${importer.out}`);
  assert.ok(importerRan(importer), `importer must actually run tests:\n${importer.out}`);
  assert.equal(await distConsistent(), true);
});

test("scenario 4: concurrent coverage leaf + build never observe partial dist", async () => {
  const coverage = [
    "--test",
    "--experimental-test-coverage",
    // No gate thresholds here: the point is the emit/consume race, not the 60/70/75
    // core gate (which is enforced by the real test:coverage leaf over the full suite).
    "--test-coverage-exclude=**/__tests__/**",
    "--test-coverage-exclude=**/node_modules/**",
    "--test-coverage-exclude=**/scripts/**",
    "--test-coverage-exclude=**/packages/**",
    "--test-coverage-exclude=**/examples/**",
    join("dist", "__tests__", "index.test.js"),
  ];
  const [cov, build] = await Promise.all([node(...coverage), npm("run", "build:core")]);
  assert.equal(cov.code, 0, `coverage leaf failed:\n${cov.out}`);
  assert.ok(importerRan(cov), `coverage leaf must actually run tests:\n${cov.out}`);
  assert.equal(build.code, 0, `concurrent build failed:\n${build.out}`);
  assert.equal(await distConsistent(), true);
});
