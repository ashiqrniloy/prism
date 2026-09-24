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
const READERS = `${LOCK}.readers`;

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
// Node-only-flag leaves (`--test`) spawn `node` by name: under a Bun parent `process.execPath`
// is a Bun child and `bun --test` is a script run, not a test runner (plan 115 Task 3). The
// coverage leaf is the Bun instrument that ships (`bun test --coverage`, plan 115 Task 6) and
// spawns `bun` by name for the same reason. The `-e` snippets and the lock wrapper stay on
// `process.execPath` — Bun's `-e` exists, and the wrapper's leaf is `node` by name already.
const helper = (...args) => run(process.execPath, [join("scripts", "with-build-lock.mjs"), ...args]);
const helperWithEnv = (env, ...args) => run(process.execPath, [join("scripts", "with-build-lock.mjs"), ...args], { env });

// The importer leaf (the consume side of `npm test`): run one small core test file that
// imports the full dist module graph (dist/__tests__/index.test.js imports ../index.js).
const IMPORTER = ["--test", join("dist", "__tests__", "index.test.js")];
// The importer must actually run tests (a vacuous run exits 0 having skipped everything):
// Node reports `ℹ pass N`, Bun reports ` N pass` — either runner counts only above zero.
function importerRan(r) {
  return /^ℹ pass [1-9]/m.test(r.out) || /^\s*[1-9]\d* pass\b/m.test(r.out);
}
// The post-consistency export check: a partial dist missing a known export fails it.
const KNOWN_EXPORTS = ["AgentRunError", "AGENT_RUN_STATE_NAMESPACE"];
const EXPORT_CHECK = [
  "-e",
  `import('@arnilo/prism').then(m=>{for(const k of ${JSON.stringify(KNOWN_EXPORTS)}){if(!(k in m)){console.error('missing export: '+k);process.exit(3)}}})`,
];

async function distConsistent() {
  // Export check against the real root dist + a sample of expected test files present.
  const exportsOk = await run(process.execPath, EXPORT_CHECK);
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
    const partial = await run(process.execPath, [
      "-e",
      `import('file://${join(dist, "index.js")}').then(m=>{for(const k of ${JSON.stringify(KNOWN_EXPORTS)}){if(!(k in m)){process.exit(3)}}})`,
    ]);
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

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse `LABEL-start <ms>` / `LABEL-end <ms>` from a child's output. */
function window(out, label) {
  const start = Number(new RegExp(`${label}-start (\\d+)`).exec(out)?.[1]);
  const end = Number(new RegExp(`${label}-end (\\d+)`).exec(out)?.[1]);
  assert.ok(Number.isFinite(start) && Number.isFinite(end), `${label} window missing:\n${out}`);
  return { start, end };
}

const hold = (label, ms) => `console.log("${label}-start", Date.now()); setTimeout(() => console.log("${label}-end", Date.now()), ${ms})`;
const reader = (ms = 900, label = "R") => helper("--shared", "node", "-e", hold(label, ms));
const writer = (ms = 0, label = "W") => helper("node", "-e", hold(label, ms));

test("shared readers overlap — the workspace-stage trim's whole point", async () => {
  const [a, b] = await Promise.all([reader(900, "A"), reader(900, "B")]);
  assert.equal(a.code, 0, `reader A failed:\n${a.out}`);
  assert.equal(b.code, 0, `reader B failed:\n${b.out}`);
  const aw = window(a.out, "A");
  const bw = window(b.out, "B");
  assert.ok(aw.start < bw.end && bw.start < aw.end, `two readers must overlap:\nA ${aw.start}-${aw.end}\nB ${bw.start}-${bw.end}`);
});

test("a reader and a writer never overlap, whichever starts first", async () => {
  // Reader first: the writer must wait in drainReaders for the marker to clear.
  const r1 = reader(900, "R1");
  await sleepMs(200);
  const w1 = await writer(0, "W1");
  const r1done = await r1;
  assert.equal(r1done.code, 0, `reader R1 failed:\n${r1done.out}`);
  assert.equal(w1.code, 0, `writer W1 failed:\n${w1.out}`);
  const r1w = window(r1done.out, "R1");
  const w1w = window(w1.out, "W1");
  assert.ok(w1w.start >= r1w.end, `writer must wait for the reader:\nR1 ${r1w.start}-${r1w.end}\nW1 ${w1w.start}-${w1w.end}`);

  // Writer first: the reader sees the lockfile and backs off; it is a failure, not a warning.
  const w2 = writer(900, "W2");
  await sleepMs(200);
  const r2 = await reader(0, "R2");
  const w2done = await w2;
  assert.equal(w2done.code, 0, `writer W2 failed:\n${w2done.out}`);
  assert.equal(r2.code, 0, `reader R2 failed:\n${r2.out}`);
  const w2w = window(w2done.out, "W2");
  const r2w = window(r2.out, "R2");
  assert.ok(r2w.start >= w2w.end, `reader must wait for the writer:\nW2 ${w2w.start}-${w2w.end}\nR2 ${r2w.start}-${r2w.end}`);
});

test("a writer reclaims a dead reader marker and an abandoned unparseable one", async () => {
  mkdirSync(READERS, { recursive: true });
  const dead = join(READERS, "2147483647"); // beyond the Linux pid max: always ESRCH
  writeFileSync(dead, "2147483647 0\n");
  const first = await writer(0, "W3");
  assert.equal(first.code, 0, `writer must reclaim a dead reader marker:\n${first.out}`);
  assert.equal(existsSync(dead), false, "dead reader marker must be reclaimed");

  const abandoned = join(READERS, "999999");
  writeFileSync(abandoned, ""); // mid-write or crashed before the pid landed
  const startedAt = Date.now();
  const second = await writer(0, "W4");
  assert.equal(second.code, 0, `writer must reclaim an abandoned marker after the grace:\n${second.out}`);
  assert.ok(Date.now() - startedAt >= 900, "the writer must honour UNPARSEABLE_GRACE_MS before stealing");
  assert.equal(existsSync(abandoned), false, "abandoned reader marker must be reclaimed");
});

test("scenario 1: concurrent npm run build + importer never observe partial dist", async () => {
  const [build, importer] = await Promise.all([npm("run", "build"), run("node", IMPORTER)]);
  assert.equal(build.code, 0, `concurrent build failed:\n${build.out}`);
  assert.equal(importer.code, 0, `importer observed a bad dist:\n${importer.out}`);
  assert.ok(importerRan(importer), `importer must actually run tests:\n${importer.out}`);
  assert.equal(await distConsistent(), true);
});

test("scenario 2: two concurrent builds both complete, dist stays consistent", async () => {
  const [a, b, importer] = await Promise.all([npm("run", "build:core"), npm("run", "build:core"), run("node", IMPORTER)]);
  assert.equal(a.code, 0, `build A failed:\n${a.out}`);
  assert.equal(b.code, 0, `build B failed:\n${b.out}`);
  assert.equal(importer.code, 0, `importer observed a bad dist:\n${importer.out}`);
  assert.ok(importerRan(importer), `importer must actually run tests:\n${importer.out}`);
  assert.equal(await distConsistent(), true);
});

test("scenario 3: concurrent npm run typecheck + importer never observe partial dist", async () => {
  const [tc, importer] = await Promise.all([npm("run", "typecheck"), run("node", IMPORTER)]);
  assert.equal(tc.code, 0, `concurrent typecheck failed:\n${tc.out}`);
  assert.equal(importer.code, 0, `importer observed a bad dist:\n${importer.out}`);
  assert.ok(importerRan(importer), `importer must actually run tests:\n${importer.out}`);
  assert.equal(await distConsistent(), true);
});

test("scenario 4: concurrent coverage leaf + build never observe partial dist", async () => {
  // The real leaf: `bun test --coverage --timeout=0` from the repo root, scoped by the root
  // bunfig (Bun 1.4.2 has no --coverage-exclude flag; the instrument that ships is Bun's).
  // No gate thresholds here: the point is the emit/consume race, not the core gate (which is
  // enforced by the real test:coverage leaf over the full suite).
  const coverage = ["test", "--coverage", "--timeout=0", join("dist", "__tests__", "index.test.js")];
  const [cov, build] = await Promise.all([run("bun", coverage), npm("run", "build:core")]);
  assert.equal(cov.code, 0, `coverage leaf failed:\n${cov.out}`);
  assert.ok(importerRan(cov), `coverage leaf must actually run tests:\n${cov.out}`);
  assert.equal(build.code, 0, `concurrent build failed:\n${build.out}`);
  assert.equal(await distConsistent(), true);
});
