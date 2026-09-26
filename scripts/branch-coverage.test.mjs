import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARTIFACT,
  assertBranchFloor,
  BRANCH_FLOOR,
  isKnownFlake,
  lcovHasBranchRecords,
  parseBranchCoverage,
  probeBunBranchRecords,
} from "./branch-coverage-audit.mjs";

const SAMPLE = [
  "ℹ file | line % | branch % | funcs % | uncovered lines",
  "ℹ all files                            |  93.00 |    86.49 |   93.62 | ",
  "ℹ end of coverage report",
].join("\n");

test("parser reads the Node all-files branch column", () => {
  assert.equal(parseBranchCoverage(SAMPLE)?.branches, 86.49);
  assert.equal(parseBranchCoverage("no table"), undefined);
});

test("a low artifact names the delta", () => {
  assert.throws(() => assertBranchFloor({ core: { branches: 80 } }), /core branches 80\.00 is 3\.49pp below floor 83\.49/);
  assert.throws(() => assertBranchFloor({}), /missing numeric core\.branches/);
  assert.doesNotThrow(() => assertBranchFloor({ core: { branches: BRANCH_FLOOR } }));
});

test("instrumented timing asserts are ignored; any other failure is real", () => {
  const flake = "AssertionError [ERR_ASSERTION]: overhead 172.8% exceeds frozen 10% cap\nℹ fail 1\n";
  const cold = "AssertionError [ERR_ASSERTION]: cold read took 56.10ms\n";
  assert.equal(isKnownFlake(flake, 1), true);
  assert.equal(isKnownFlake(flake, 0), false);
  assert.equal(isKnownFlake(`${cold}${flake}ℹ fail 2\n`, 1), true);
  assert.equal(isKnownFlake("AssertionError [ERR_ASSERTION]: expected 1\nℹ fail 1\n", 1), false);
  assert.equal(isKnownFlake(`${flake}ℹ fail 2\n`, 1), false);
  // The reporter repeats each failure in its summary block; a repeat is not a second failure.
  assert.equal(isKnownFlake(`${flake}${flake}`, 1), true);
});

test("lcov branch records are the delete signal", () => {
  assert.equal(lcovHasBranchRecords("DA:1,1\nLF:1\nLH:1\n"), false);
  assert.equal(lcovHasBranchRecords("BRDA:2,0,0,1\n"), true);
});

test("this Bun still emits no BRDA, so the Node instrument stays", () => {
  assert.equal(
    probeBunBranchRecords(),
    false,
    "Bun now emits BRDA. Delete the Node spawn in branch-coverage-audit.mjs and its tooling-gate exception, then remove this assertion.",
  );
});

test("artifact meets the branch floor", () => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.equal(typeof artifact.measuredAt, "string");
  assert.equal(JSON.stringify(artifact).includes("/home/"), false);
  assert.equal(Number.isFinite(artifact.core.branches), true);
  assertBranchFloor(artifact);
});
