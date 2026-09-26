// scripts/run-all-tests.test.mjs — plan 070 Task 15.
//
// The runner's whole point is that a failing stage can no longer hide the rest,
// and that the gate-file policy it encodes (protection gates in, retired phase
// gates out) stays assertable now that the chain is data instead of a
// `package.json` string.
import assert from "node:assert/strict";
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { readManifest } from "./package-truth.mjs";
import { effectiveTestChain, GATE_FILES, runParallelLeaves, runStages, SQLITE_TEST_GLOB, STAGES } from "./run-all-tests.mjs";

const ROOT = join(import.meta.dirname, "..");

/**
 * Expand a package test script's file arguments the way the runner does: directory args
 * (`dist`), last-segment globs, and `--path-ignore-patterns=` filters (plan 124 Task 2).
 * Used by the partition test to compare declared sets against the built tree.
 */
function scriptFiles(script, cwd) {
  const args = (script ?? "").split(/\s+/).map((arg) => arg.replaceAll('"', "").replaceAll("'", ""));
  const start = args.findIndex((arg, index) => arg === "test" && args[index - 1] === "bun");
  const tail = start === -1 ? [] : args.slice(start + 1);
  const ignores = tail.filter((arg) => arg.startsWith("--path-ignore-patterns=")).map((arg) => arg.slice("--path-ignore-patterns=".length));
  const ignorePattern = new RegExp(
    `^(?:${ignores
      .map((glob) =>
        glob
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replaceAll("**", "\u0000")
          .replaceAll("*", "[^/]*")
          .replaceAll("\u0000", ".*"),
      )
      .join("|")})$`,
  );
  return tail
    .filter((arg) => arg === "dist" || arg.includes(".test.js"))
    .flatMap((arg) => globSync(arg === "dist" ? "dist/**/*.test.js" : arg, { cwd }))
    .filter((file) => ignores.length === 0 || !ignorePattern.test(file))
    .sort();
}

async function fakeStages(statuses) {
  const ran = [];
  const lines = [];
  const { results, failed } = await runStages(
    Object.keys(statuses).map((name) => ({ name, command: "fake", args: [] })),
    {
      execute: (stage) => {
        ran.push(stage.name);
        return statuses[stage.name];
      },
      write: (line) => lines.push(line),
    },
  );
  return { ran, lines, results, failed, summary: lines.join("\n") };
}

test("a failing stage never short-circuits the rest and the summary reports every stage", async () => {
  const { ran, results, failed, summary } = await fakeStages({ first: 1, second: 0, third: 2 });
  assert.deepEqual(ran, ["first", "second", "third"], "every stage must run even after an earlier failure");
  assert.deepEqual(
    results.map((result) => result.name),
    ["first", "second", "third"],
  );
  assert.deepEqual(
    failed.map((result) => result.name),
    ["first", "third"],
    "every non-zero status is a failure (not just the first)",
  );
  assert.match(summary, /FAIL\s+\d+ms\s+first/);
  assert.match(summary, /pass\s+\d+ms\s+second/);
  assert.match(summary, /2 of 3 stages failed: first, third/);
});

test("an all-pass run reports no failures", async () => {
  const { failed, summary } = await fakeStages({ alpha: 0, beta: 0 });
  assert.deepEqual(failed, []);
  assert.match(summary, /all 2 stages passed/);
});

test("a throwing stage counts as a failure and does not abort the run", async () => {
  const ran = [];
  const { failed } = await runStages(
    [
      { name: "throws", command: "fake", args: [] },
      { name: "after", command: "fake", args: [] },
    ],
    {
      execute: (stage) => {
        ran.push(stage.name);
        if (stage.name === "throws") throw new Error("boom");
        return 0;
      },
      write: () => {},
    },
  );
  assert.deepEqual(ran, ["throws", "after"]);
  assert.deepEqual(
    failed.map((result) => result.name),
    ["throws"],
  );
});

test("the effective chain is the package.json entry plus every stage", () => {
  const { scripts } = readManifest(join(ROOT, "package.json"));
  assert.equal(scripts.test, "bun scripts/run-all-tests.mjs", "bun test must delegate to the runner");
  const workspaces = readManifest(join(ROOT, "package.json")).workspaces;
  const chain = effectiveTestChain();
  for (const file of GATE_FILES) assert.ok(chain.includes(file), `effective chain missing ${file}`);
  for (const dir of workspaces) assert.ok(chain.includes(`--cwd ${dir}`), `effective chain missing workspace ${dir}`);
  assert.ok(!chain.includes("--workspaces"), "the serial npm workspace loop is replaced by the pool");
  assert.ok(!chain.includes("node "), "no stage may spawn node (plan 124 Task 2)");
});

test("performance budget runs solo, single-process, outside the parallel gate suite", () => {
  assert.ok(!GATE_FILES.includes("scripts/budget-gate.test.mjs"));
  const args = STAGES.find((stage) => stage.name === "performance budget")?.args;
  assert.deepEqual(args, ["scripts/with-build-lock.mjs", "bun", "test", "--timeout=0", "scripts/budget-gate.test.mjs"]);
  assert.ok(!args.includes("--parallel=4"), "the host-contention ceiling must stay a solo measurement");
  assert.ok(!args.includes("--test-concurrency=4"), "no Node-only flag may survive the flip");
  assert.ok(!JSON.stringify(STAGES.find((stage) => stage.name === "performance budget")).includes("node"));
});

test("timing-sensitive stages carry the measured --parallel=4 bound", () => {
  // Plan 124 Task 2: `--parallel=4` replaces plan 123's `--test-concurrency=4` — Task 1 §6.1
  // measured the same 2120 tests at 20.0 s bounded vs 27.4 s at the default pool on a loaded host.
  const assertBound = (name, args, lastArg) => {
    assert.equal(args.at(-1), lastArg);
    assert.ok(args.includes("--parallel=4"), `${name} needs the measured worker bound`);
    assert.ok(args.indexOf("--parallel=4") > args.indexOf("test"), `${name}: the bound must follow test`);
    assert.ok(args.indexOf("--parallel=4") < args.length - 1, `${name}: the bound must precede the file list`);
    assert.ok(!args.includes("--test-concurrency=4"), `${name}: the Node flag must be gone`);
    return args;
  };
  const rootArgs = STAGES.find((stage) => stage.name === "root suites")?.args;
  assertBound("root suites", rootArgs, "dist/__tests__/*.test.js");
  assert.ok(rootArgs.includes("--path-ignore-patterns=packages/**"), "the root stage must not pull the workspace twins (Task 1 §1.3)");
  assert.throws(
    () =>
      assertBound(
        "root suites",
        rootArgs.filter((arg) => arg !== "--parallel=4"),
        "dist/__tests__/*.test.js",
      ),
    /needs the measured worker bound/,
    "positive control: a copy without the bound must fail the assertion",
  );
  assertBound("gate suites", STAGES.find((stage) => stage.name === "gate suites")?.args, GATE_FILES.at(-1));
  for (const dir of readManifest(join(ROOT, "package.json")).workspaces) {
    const script = readManifest(join(ROOT, dir, "package.json")).scripts.test;
    assert.ok(script.includes("bun test"), `${dir} test must run bun test`);
    assert.ok(script.includes("--timeout=0"), `${dir} test needs --timeout=0`);
    assert.ok(!script.includes("node ") && !script.includes("--test-concurrency"), `${dir} test must not keep Node flags`);
  }
});

test("the workspace test scripts declare bun test file sets that resolve on disk", () => {
  const packagesDir = join(ROOT, "packages");
  for (const dir of readManifest(join(ROOT, "package.json")).workspaces) {
    const script = readManifest(join(ROOT, dir, "package.json")).scripts?.test ?? "";
    assert.match(script, /bun test --parallel=4 --timeout=0 /, `${dir} must run a bounded bun test`);
    const files = scriptFiles(script, join(ROOT, dir));
    assert.ok(files.length > 0, `${dir}: the declared file set must be non-empty (build first)`);
    for (const file of files) assert.ok(existsSync(join(ROOT, dir, file)), `${dir}: ${file} does not exist (build first)`);
  }
  // The two packages whose pre-flip globs needed shell quoting now pass a directory: Bun's glob
  // engine matches only the last path segment (measured 2026-09-25), so `dist/**` matched nothing.
  for (const dir of ["packages/hooks", "packages/prism-coding-tools"]) {
    assert.match(readManifest(join(ROOT, dir, "package.json")).scripts.test, /--timeout=0 dist$/, `${dir} must pass the dist directory`);
  }
  const coreTest = readManifest(join(packagesDir, "prism-core", "package.json")).scripts.test;
  assert.ok(
    !coreTest.includes("$(") && !coreTest.includes('"dist/**'),
    "prism-core must not reintroduce a shell substitution or a mid-path ** glob",
  );
});

/** Bun's default per-test timeout is 5000 ms; `--timeout=0` matches Node's no-default-timeout (Task 1 §1.3). */
function assertBunTimeout(args) {
  assert.ok(args.includes("bun") && args.includes("test"), "expected a bun test invocation");
  assert.ok(args.includes("--timeout=0"), "every bun test invocation needs --timeout=0 (Bun's default is 5000 ms)");
}

test("every stage runs bun test with --timeout=0 and the sqlite stage owns its measured glob", () => {
  const testStages = STAGES.filter((stage) => stage.args?.includes("test"));
  assert.deepEqual(
    testStages.map((stage) => stage.name),
    ["performance budget", "root suites", "sqlite suites", "gate suites", "build race", "examples execution"],
    "every bun test stage must be named here (build and branch coverage run scripts, not test sets)",
  );
  for (const stage of STAGES) {
    for (const leaf of stage.parallel ?? [stage]) assert.equal(leaf.command, "bun", `${stage.name} must run the Bun binary`);
  }
  for (const stage of testStages) {
    assert.ok(stage.args.includes("--timeout=0"), `${stage.name} needs --timeout=0 (Bun's default is 5000 ms)`);
  }
  const sqlite = STAGES.find((stage) => stage.name === "sqlite suites");
  assert.deepEqual(sqlite.args, ["scripts/with-build-lock.mjs", "bun", "test", "--timeout=0", SQLITE_TEST_GLOB]);
  assert.equal(SQLITE_TEST_GLOB, "packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js");
  assert.throws(
    () => assertBunTimeout(sqlite.args.filter((arg) => arg !== "--timeout=0")),
    /--timeout=0/,
    "positive control: a copy without the flag must fail the assertion",
  );
  // The budget gate stays solo: no parallel bound, and its absolute ceiling keeps its own process.
  const budget = STAGES.find((stage) => stage.name === "performance budget");
  assert.ok(!budget.args.includes("--parallel=4"), "the budget gate must stay single-process");
  assert.ok(!JSON.stringify(STAGES).includes("--test-concurrency"), "no Node worker flag may survive");
  assert.ok(!JSON.stringify(STAGES).includes("node --test"), "no stage may keep a node test runner");
});

test("the branch-coverage stage runs bun but keeps the Node branch instrument as its documented exception", () => {
  // Plan 124 Task 2: the default suite is Bun-only. The two documented exceptions are the
  // release-host registry toolchain (plan 125 Task 5) and the branch-coverage audit, which keeps
  // the Node instrument because Bun 1.4.2 emits no branch data (plan 120 Task 6).
  const audit = readFileSync(join(ROOT, "scripts", "branch-coverage-audit.mjs"), "utf8");
  assert.match(audit, /spawnSync\(\s*"node",[\s\S]*--experimental-test-coverage/, "the branch audit keeps the Node instrument");
  const stage = STAGES.find((candidate) => candidate.name === "branch coverage");
  assert.equal(stage.command, "bun", "the stage wrapper itself runs Bun");
  assert.deepEqual(stage.args, ["scripts/with-build-lock.mjs", "bun", "scripts/branch-coverage-audit.mjs"]);
});

test("the bun-blocked paths stay off the stage file sets", () => {
  // Task 1 §6.9 / §7: the runner spawns `bun test`; the only Node legs left are the branch
  // instrument (above) and the release-host registry scripts. No stage may smuggle a Node-only
  // flag or a live/postgres leg into the default suite's argument lists.
  const stageArgs = JSON.stringify(STAGES);
  for (const needle of ["--test-isolation", "--experimental-test-coverage", "--test-concurrency", "npm run"]) {
    assert.ok(!stageArgs.includes(needle), `STAGES must not carry ${needle}`);
  }
  for (const file of ["src/__tests__/cli-provider-add.test.ts", "packages/prism-channels/src/__tests__/postgres.integration.test.ts"]) {
    assert.ok(!stageArgs.includes(file), `${file} must stay off every stage argument`);
  }
  assert.ok(
    STAGES.find((stage) => stage.name === "performance budget")?.args.includes("scripts/budget-gate.test.mjs"),
    "the budget gate stays a solo stage",
  );
});

test("prism-core's split runs every dist test file exactly once", () => {
  const pkgDir = join(ROOT, "packages", "prism-core");
  const script = readManifest(join(pkgDir, "package.json")).scripts.test;
  assert.match(
    script,
    /--path-ignore-patterns='dist\/sessions\/sqlite\/\*\*' dist/,
    "the default side must exclude exactly the Bun-owned SQLite dir",
  );
  const all = globSync("dist/**/*.test.js", { cwd: pkgDir }).sort();
  assert.ok(all.length > 0, "build first: prism-core dist tests must exist");
  const sqlite = globSync(SQLITE_TEST_GLOB, { cwd: ROOT }).map((file) => file.replace("packages/prism-core/", ""));
  const nodeSide = all.filter((file) => !file.startsWith("dist/sessions/sqlite/__tests__/"));
  assert.deepEqual([...nodeSide, ...sqlite].sort(), all, "no prism-core test file may be skipped or run twice");
  assert.ok(nodeSide.length > 0 && sqlite.length > 0, "both sides of the split must be non-empty (build first)");
});

test("every workspace test file runs exactly once: default suite, sqlite stage, or an opt-in leg", () => {
  // Plan 124 Task 2's partition rule. The default suite's declared sets must cover every built
  // workspace test file except the files a package owns through `test:postgres`/`test:live`
  // (env-gated legs that intentionally re-run a subset with real infrastructure).
  const sqlite = new Set(globSync(SQLITE_TEST_GLOB, { cwd: ROOT }));
  const claimed = new Map();
  const claim = (file, owner) => {
    assert.ok(existsSync(join(ROOT, file)), `${owner} claims a missing file: ${file}`);
    assert.ok(!claimed.has(file), `${file} runs in two stages: ${claimed.get(file)} and ${owner}`);
    claimed.set(file, owner);
  };
  for (const file of globSync("dist/__tests__/*.test.js", { cwd: ROOT })) claim(file, "root suites");
  assert.equal(
    globSync("dist/__tests__/*.test.js", { cwd: ROOT }).length,
    globSync("dist/**/*.test.js", { cwd: ROOT }).length,
    "the root stage glob must cover every root dist test file",
  );
  for (const file of sqlite) claim(file, "sqlite suites");
  for (const file of GATE_FILES) claim(file, "gate suites");
  for (const file of ["scripts/phase23-build-race.test.mjs", "scripts/budget-gate.test.mjs", "scripts/examples-execution.test.mjs"]) {
    claim(file, "stage");
  }
  for (const dir of readManifest(join(ROOT, "package.json")).workspaces) {
    const pkgDir = join(ROOT, dir);
    const scripts = readManifest(join(pkgDir, "package.json")).scripts;
    const declared = scriptFiles(scripts.test, pkgDir);
    assert.ok(declared.length > 0, `${dir} test script must declare test files`);
    for (const file of declared) claim(join(dir, file), `${dir} default suite`);
    const optIn = new Set([...scriptFiles(scripts["test:postgres"], pkgDir), ...scriptFiles(scripts["test:live"], pkgDir)]);
    for (const file of globSync("dist/**/*.test.js", { cwd: pkgDir })) {
      if (declared.includes(file) || sqlite.has(join(dir, file))) continue;
      assert.ok(optIn.has(file), `${dir}/${file} runs in no stage — add it to the package test script or an opt-in leg`);
    }
    assert.ok(
      !declared.some((file) => file.startsWith("dist/sessions/sqlite/")),
      `${dir}: the default suite must not overlap the sqlite stage`,
    );
  }
  assert.ok(claimed.size > 0, "the partition must be non-empty (positive control)");
});

test("the runner spawns bun by name, never through process.execPath, and never node", () => {
  const source = readFileSync(join(ROOT, "scripts", "run-all-tests.mjs"), "utf8");
  // Comments may name the rule; code may not use it. Under the Bun parent `process.execPath` is Bun,
  // and `bun --test` is not a test runner (Task 1 §1.2).
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(!code.includes("process.execPath"), "no stage may pass a runner through process.execPath");
  for (const stage of STAGES) {
    for (const leaf of stage.parallel ?? [stage]) {
      assert.ok(["bun"].includes(leaf.command), `stage ${stage.name} must name its binary`);
    }
  }
  assert.equal(STAGES.filter((stage) => stage.command === "bun").length, STAGES.length - 1, "every non-pool stage runs bun");
  assert.ok(!code.includes('"node"') && !code.includes("'node'"), "the runner may not spawn node");
});

test("protection gates stay in the chain and retired phase gates stay out", () => {
  const chain = effectiveTestChain();
  for (const gate of ["release-gate", "tooling-gate", "budget-gate", "phase23-quality-gates", "truth-current", "packaging-current"]) {
    assert.ok(chain.includes(`scripts/${gate}.test.mjs`), `effective chain must run scripts/${gate}.test.mjs`);
  }
  const retired = readdirSync(join(ROOT, "scripts"))
    .filter((file) => /^phase\d+-(freeze|release)\.test\.mjs$/.test(file))
    .sort();
  assert.ok(retired.length > 0, "expected retired freeze/release gate files to exist");
  for (const file of retired) {
    assert.ok(!chain.includes(`scripts/${file}`), `retired gate scripts/${file} must not run in bun run test`);
  }
  // Positive controls: the collector reads more than an empty stage list, and a
  // non-retired phase gate really is present.
  assert.ok(STAGES.length >= 5, "expected the full stage list");
  assert.ok(chain.includes("scripts/phase23-build-race.test.mjs"), "build-race stage must be in the chain");
  assert.ok(chain.includes("scripts/run-all-tests.test.mjs"), "the runner's own test must be in the chain");
});

test("the gate list is a partition: every file distinct, present, and the split critical path lands in it", () => {
  assert.equal(new Set(GATE_FILES).size, GATE_FILES.length, "no gate file may run twice");
  for (const file of GATE_FILES) assert.ok(existsSync(join(ROOT, file)), `${file} must exist`);
  const split = [
    "scripts/phase54-legacy-registry-dry-run.test.mjs",
    "scripts/phase54-legacy-registry-apply.test.mjs",
    "scripts/phase54-legacy-registry-fail-closed.test.mjs",
  ];
  for (const file of split) assert.ok(GATE_FILES.includes(file), `${file} must run in the gate stage`);
  assert.ok(
    !GATE_FILES.includes("scripts/phase54-legacy-registry.test.mjs") && !existsSync(join(ROOT, "scripts/phase54-legacy-registry.test.mjs")),
    "the single critical-path file is split, not shadowed",
  );
  // Positive control: the split keeps every scenario test count (6 tests across 3 files).
  const source = split.map((file) => readFileSync(join(ROOT, file), "utf8"));
  assert.equal(source.join("\n").match(/^test\(/gm)?.length, 6, "the split preserves all six scenario tests");
});

test("the workspace stage is one shared-lock reader per package behind a bounded pool", () => {
  const stage = STAGES.find((candidate) => candidate.name === "workspace suites");
  const workspaces = readManifest(join(ROOT, "package.json")).workspaces;
  assert.ok(stage?.parallel, "workspace suites must be a parallel stage");
  assert.deepEqual(
    stage.parallel.map((leaf) => leaf.name),
    workspaces,
    "every workspace is a leaf exactly once",
  );
  assert.equal(stage.concurrency, 2, "the pool bound stays 2 (plan 123 Task 1)");
  assert.ok(stage.concurrency <= availableParallelism(), "the bound stays inside the host's capacity");
  for (const leaf of stage.parallel) {
    assert.equal(leaf.command, "bun");
    assert.deepEqual(leaf.args, ["run", "--cwd", leaf.name, "test"]);
    const script = readManifest(join(ROOT, leaf.name, "package.json")).scripts.test;
    assert.ok(script.includes("with-build-lock.mjs --shared"), `${leaf.name} test must take the shared reader lock`);
    assert.ok(!script.includes("node "), `${leaf.name} test must not spawn node`);
  }
  // Writers keep the exclusive default: a build never opts into reader mode.
  for (const dir of workspaces) {
    const build = readManifest(join(ROOT, dir, "package.json")).scripts.build ?? "";
    assert.ok(build.includes("with-build-lock.mjs") && !build.includes("--shared"), `${dir} build must keep the exclusive lock`);
  }
  const buildCore = readManifest(join(ROOT, "package.json")).scripts["build:core"];
  assert.ok(buildCore.includes("with-build-lock.mjs") && !buildCore.includes("--shared"), "tsc keeps the exclusive lock");
});

test("the parallel pool bounds concurrency and never hides a later leaf after a failure", async () => {
  let inFlight = 0;
  let peak = 0;
  const ran = [];
  const leaves = Array.from({ length: 7 }, (_, index) => ({ name: `leaf-${index}` }));
  const { results, failed } = await runParallelLeaves(leaves, 3, async (leaf) => {
    ran.push(leaf.name);
    peak = Math.max(peak, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return leaf.name === "leaf-2" ? 1 : 0; // one leaf fails mid-run
  });
  assert.equal(peak, 3, "the pool must never exceed its bound");
  assert.deepEqual(ran.sort(), leaves.map((leaf) => leaf.name).sort(), "a failure must not hide later leaves");
  assert.equal(results.length, 7);
  assert.deepEqual(
    failed.map((leaf) => leaf.name),
    ["leaf-2"],
    "exactly the failing leaf fails the stage",
  );
});
