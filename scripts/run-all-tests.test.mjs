// scripts/run-all-tests.test.mjs — plan 070 Task 15.
//
// The runner's whole point is that a failing stage can no longer hide the rest,
// and that the gate-file policy it encodes (protection gates in, retired phase
// gates out) stays assertable now that the chain is data instead of a
// `package.json` string.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readManifest } from "./package-truth.mjs";
import { effectiveTestChain, GATE_FILES, runStages, STAGES } from "./run-all-tests.mjs";

const ROOT = join(import.meta.dirname, "..");

function fakeStages(statuses) {
  const ran = [];
  const lines = [];
  const { results, failed } = runStages(
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

test("a failing stage never short-circuits the rest and the summary reports every stage", () => {
  const { ran, results, failed, summary } = fakeStages({ first: 1, second: 0, third: 2 });
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

test("an all-pass run reports no failures", () => {
  const { failed, summary } = fakeStages({ alpha: 0, beta: 0 });
  assert.deepEqual(failed, []);
  assert.match(summary, /all 2 stages passed/);
});

test("a throwing stage counts as a failure and does not abort the run", () => {
  const ran = [];
  const { failed } = runStages(
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
  const chain = effectiveTestChain();
  for (const file of GATE_FILES) assert.ok(chain.includes(file), `effective chain missing ${file}`);
  assert.ok(chain.includes("--workspaces"), "effective chain must keep the workspace suites");
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
