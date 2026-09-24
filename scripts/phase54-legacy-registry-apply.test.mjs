// scripts/phase54-legacy-registry-apply.test.mjs
// Plan 054 Task 7 legacy npm dist-tag + deprecation apply tests: idempotent apply and the
// `--confirm` gate. Plan 115 Task 2 split the single critical-path file into one file per
// independent mkdtemp() scenario so `node --test` workers overlap the three slow registry
// runs; every assertion is unchanged. Fixture shim:
// scripts/fixtures/phase54-legacy-registry-fixture.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeFixture, mkdtemp, PUBLISHED, readState, run } from "./fixtures/phase54-legacy-registry-fixture.mjs";
import { legacyMessage } from "./phase54-legacy-registry.mjs";
import { CONSOLIDATION_SPEC } from "./phase54-package-map.mjs";

test("phase54 legacy registry: apply is idempotent and a second apply only skips", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir);
  const first = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(first.status, 0, `first apply exit 0\nstderr: ${first.stderr}`);
  const state = readState(statePath);
  for (const name of PUBLISHED) {
    assert.equal(state.packages[name].tags.legacy, "0.3.1", `legacy tag on final release: ${name}`);
    assert.equal(
      state.packages[name].deprecated["0.3.1"],
      legacyMessage(CONSOLIDATION_SPEC.retiredPackages.find((r) => r.name === name)),
      `warning message: ${name}`,
    );
  }
  const afterFirst = readFileSync(statePath, "utf8");
  const plan1 = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan1.summary.applied, 53, "53 published entries applied on first run");
  assert.equal(plan1.summary.unpublished, 2, "never-published entries stay recorded");

  const second = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(second.status, 0, `second apply exit 0\nstderr: ${second.stderr}`);
  assert.equal(readFileSync(statePath, "utf8"), afterFirst, "second apply is a registry no-op");
  const plan2 = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan2.summary.skipped, 53, "already-correct entries are skipped");
  assert.equal(plan2.summary.applied, 0, "no re-application");
});

test("phase54 legacy registry: apply without --confirm refuses and never mutates", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir);
  const before = readFileSync(statePath, "utf8");
  const res = run(["--apply"], dir, statePath);
  assert.equal(res.status, 2, "refuses without --confirm");
  assert.ok(res.stderr.includes("--confirm"), "refusal names the gate");
  assert.equal(readFileSync(statePath, "utf8"), before, "no mutation without confirmation");
});
