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
import { test } from "node:test";
import { readManifest } from "./package-truth.mjs";
import { effectiveTestChain, GATE_FILES, runParallelLeaves, runStages, SQLITE_TEST_GLOB, STAGES } from "./run-all-tests.mjs";

const ROOT = join(import.meta.dirname, "..");

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
  assert.equal(scripts.test, "node scripts/run-all-tests.mjs", "npm test must delegate to the runner");
  const workspaces = readManifest(join(ROOT, "package.json")).workspaces;
  const chain = effectiveTestChain();
  for (const file of GATE_FILES) assert.ok(chain.includes(file), `effective chain missing ${file}`);
  for (const dir of workspaces) assert.ok(chain.includes(`--workspace ${dir}`), `effective chain missing workspace ${dir}`);
  assert.ok(!chain.includes("--workspaces"), "the serial npm workspace loop is replaced by the pool");
});

test("performance budget runs outside the parallel gate suite", () => {
  assert.ok(!GATE_FILES.includes("scripts/budget-gate.test.mjs"));
  assert.deepEqual(STAGES.find((stage) => stage.name === "performance budget")?.args.slice(-2), ["--test", "scripts/budget-gate.test.mjs"]);
});

test("workspace test globs quote `**` so the shell cannot collapse nested suites", () => {
  const packagesDir = join(ROOT, "packages");
  const quoted = [];
  for (const dir of readdirSync(packagesDir).sort()) {
    const script = readManifest(join(packagesDir, dir, "package.json")).scripts?.test ?? "";
    if (!script.includes("**")) continue;
    const match = /"([^"]*\*\*[^"]*)"/.exec(script);
    assert.ok(match, `${dir} test script must quote its ** glob (plan 080 Task 2)`);
    const files = globSync(match[1], { cwd: join(packagesDir, dir) });
    const collapsed = globSync(match[1].replaceAll("**", "*"), { cwd: join(packagesDir, dir) });
    assert.ok(files.length > 0, `${dir}: ${match[1]} matched no files (build first)`);
    assert.ok(
      files.length > collapsed.length,
      `${dir}: quoting ${match[1]} must run more than the shell-collapsed ${collapsed.length} file(s) (plan 080 Task 2)`,
    );
    quoted.push(dir);
  }
  assert.deepEqual(quoted, ["hooks", "prism-coding-tools"], "positive control: every remaining nested-glob package is covered");
  // Plan 113 Task 3 moved prism-core's SQLite files to `bun test`; its Node side discovers the rest
  // with `find`, which the shell cannot collapse at all.
  const coreTest = readManifest(join(packagesDir, "prism-core", "package.json")).scripts.test;
  assert.ok(!coreTest.includes("**"), "prism-core must not reintroduce a shell-collapsible ** glob");
});

/** Bun's default per-test timeout is 5000 ms; `--timeout=0` matches Node's no-default-timeout (Task 1 §1.3). */
function assertBunTimeout(args) {
  assert.ok(args.includes("bun") && args.includes("test"), "expected a bun test invocation");
  assert.ok(args.includes("--timeout=0"), "every bun test invocation needs --timeout=0 (Bun's default is 5000 ms)");
}

test("the runner's only Bun stage owns the measured SQLite glob and passes --timeout=0", () => {
  const bunStages = STAGES.filter((stage) => stage.args?.includes("bun"));
  assert.deepEqual(
    bunStages.map((stage) => stage.name),
    ["sqlite suites"],
    "Task 1 measured exactly one `bun-ok` file set faster than Node (Task 1 §2.2, §4)",
  );
  assert.deepEqual(bunStages[0].args, ["scripts/with-build-lock.mjs", "bun", "test", "--timeout=0", SQLITE_TEST_GLOB]);
  assert.equal(SQLITE_TEST_GLOB, "packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js");
  assertBunTimeout(bunStages[0].args);
  assert.throws(
    () => assertBunTimeout(bunStages[0].args.filter((arg) => arg !== "--timeout=0")),
    /--timeout=0/,
    "positive control: a copy without the flag must fail the assertion",
  );
});

test("bun-blocked paths never reach the Bun stage and stay on node --test", () => {
  // Task 1 §5 / §2.3: Node-only-flag spawners, the host-contention budget, the Postgres TAP leg,
  // and the coverage command (Bun since plan 114; it is not a run-all-tests stage).
  const blocked = [
    "src/__tests__/cli-provider-add.test.ts",
    "scripts/wiki-scratch-isolation.test.mjs",
    "scripts/budget-gate.test.mjs",
    "packages/prism-channels/src/__tests__/postgres.integration.test.ts",
    "scripts/coverage-summary.mjs",
  ];
  const bunArgs = STAGES.filter((stage) => stage.args?.includes("bun")).flatMap((stage) => stage.args);
  for (const file of blocked) assert.ok(!bunArgs.some((arg) => arg.includes(file)), `${file} must stay off every bun test argument`);
  assert.ok(!JSON.stringify(bunArgs).includes("--experimental-test-coverage"), "coverage runs in its own bun stage, not in run-all-tests");
  assert.ok(!JSON.stringify(STAGES).includes("--test-isolation"), "wiki-scratch-isolation keeps its node --test-isolation=none spawn");
  assert.ok(
    STAGES.find((stage) => stage.name === "performance budget")?.args.includes("scripts/budget-gate.test.mjs"),
    "the budget gate stays a single-process node run",
  );
});

test("prism-core's split runs every dist test file exactly once", () => {
  const pkgDir = join(ROOT, "packages", "prism-core");
  const script = readManifest(join(pkgDir, "package.json")).scripts.test;
  assert.match(
    script,
    /find dist -name '\*\.test\.js' ! -path 'dist\/sessions\/sqlite\/__tests__\/\*'/,
    "the Node side must exclude exactly the Bun-owned SQLite dir",
  );
  const all = globSync("dist/**/__tests__/*.test.js", { cwd: pkgDir }).sort();
  assert.ok(all.length > 0, "build first: prism-core dist tests must exist");
  const sqlite = globSync(SQLITE_TEST_GLOB, { cwd: ROOT }).map((file) => file.replace("packages/prism-core/", ""));
  const nodeSide = all.filter((file) => !file.startsWith("dist/sessions/sqlite/__tests__/"));
  assert.deepEqual([...nodeSide, ...sqlite].sort(), all, "no prism-core test file may be skipped or run twice");
  assert.ok(nodeSide.length > 0 && sqlite.length > 0, "both sides of the split must be non-empty (build first)");
});

test("the runner spawns node and bun by name, never through process.execPath", () => {
  const source = readFileSync(join(ROOT, "scripts", "run-all-tests.mjs"), "utf8");
  // Comments may name the rule; code may not use it. Under a Bun parent `process.execPath` is Bun,
  // and `bun --test` is not `node --test` (Task 1 §1.2).
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(!code.includes("process.execPath"), "no stage may pass --test through process.execPath");
  for (const stage of STAGES) {
    for (const leaf of stage.parallel ?? [stage]) {
      assert.ok(["node", "npm", "bun"].includes(leaf.command), `stage ${stage.name} must name its binary`);
    }
  }
  assert.equal(STAGES.filter((stage) => stage.command === "bun").length, 0, "the Bun child runs inside the build lock");
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
    assert.ok(!chain.includes(`scripts/${file}`), `retired gate scripts/${file} must not run in npm test`);
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
  assert.ok(Number.isInteger(stage.concurrency) && stage.concurrency >= 2, "the pool needs a bound >= 2");
  assert.ok(stage.concurrency <= availableParallelism(), "the bound stays inside the host's capacity");
  for (const leaf of stage.parallel) {
    assert.equal(leaf.command, "npm");
    assert.deepEqual(leaf.args, ["run", "test", "--workspace", leaf.name, "--if-present"]);
    const script = readManifest(join(ROOT, leaf.name, "package.json")).scripts.test;
    assert.ok(script.includes("with-build-lock.mjs --shared"), `${leaf.name} test must take the shared reader lock`);
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
