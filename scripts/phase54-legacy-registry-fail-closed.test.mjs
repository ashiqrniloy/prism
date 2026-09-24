// scripts/phase54-legacy-registry-fail-closed.test.mjs
// Plan 054 Task 7 legacy npm dist-tag + deprecation fail-closed test: a mismatched tag or
// warning aborts with zero mutations and a later run resumes. Plan 115 Task 2 split the
// single critical-path file into one file per independent mkdtemp() scenario so
// `node --test` workers overlap the three slow registry runs; every assertion is
// unchanged. Fixture shim: scripts/fixtures/phase54-legacy-registry-fixture.mjs.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeFixture, mkdtemp, readState, run } from "./fixtures/phase54-legacy-registry-fixture.mjs";

test("phase54 legacy registry: mismatched tag/warning fails closed with zero mutations; repair resumes", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir, { corruptLegacy: ["@arnilo/prism-browser"], corruptMessage: ["@arnilo/prism-rag"] });
  const before = readFileSync(statePath, "utf8");
  const res = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(res.status, 1, "apply fails closed");
  assert.ok(res.stderr.includes("@arnilo/prism-browser"), "report names the mismatched tag");
  assert.ok(res.stderr.includes("@arnilo/prism-rag"), "report names the mismatched warning");
  assert.ok(res.stderr.includes("unmodified names safe for resume"), "resume report present");
  assert.equal(readFileSync(statePath, "utf8"), before, "zero registry mutations on mismatch");

  // Repair the fixture, then resume: remaining 53 apply, and a later run skips all.
  const state = readState(statePath);
  delete state.packages["@arnilo/prism-browser"].tags.legacy;
  delete state.packages["@arnilo/prism-rag"].deprecated["0.3.1"];
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const resumed = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(resumed.status, 0, `resume exit 0\nstderr: ${resumed.stderr}`);
  const plan = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan.summary.applied, 53, "resume completes all published entries");
});
