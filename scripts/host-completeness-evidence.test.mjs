/**
 * Plan 073 Task 27: 0.7.0 host-completeness evidence matrix.
 * Hermetic. Fails if a required ledger row or live suite is missing,
 * claimed passed while blocked/out, or a required test path vanished.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadMatrix } from "./live-matrix.mjs";

const ROOT = join(import.meta.dirname, "..");
const evidence = JSON.parse(readFileSync(join(ROOT, "docs/_evidence/0.7.0-host-completeness.json"), "utf8"));
const matrix = loadMatrix(ROOT);

const LEDGER = [
  "Trap A",
  "Trap B",
  "Trap C",
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
];

function assertRequiredLive(suites) {
  const byId = new Map(suites.map((suite) => [suite.id, suite]));
  for (const id of evidence.requiredLive) {
    const suite = byId.get(id);
    if (suite?.status !== "active") {
      throw new Error(`required live suite missing or not active: ${id}`);
    }
  }
}

test("evidence schema and every ledger row is present", () => {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.release, "0.7.0");
  const ids = evidence.rows.map((row) => row.id);
  assert.deepEqual([...ids].sort(), [...LEDGER].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test("rows cannot claim passed while out, blocked, or live-only", () => {
  for (const row of evidence.rows) {
    if (evidence.outOfRelease.includes(row.id)) {
      assert.equal(row.status, "out", `${row.id} must stay out`);
      continue;
    }
    if (row.id === "R17") {
      assert.equal(row.status, "passed", "R17 is proven by plan 074 and the packed journey leg");
      assert.equal(row.tier, "hermetic");
      continue;
    }
    if (row.live?.length) {
      // Hermetic proof exists but the row claims a live integration: it may not read as released.
      assert.equal(row.status, "environment-blocked", `${row.id} claims live integration; cannot be passed without it`);
      assert.equal(row.tier, "live");
      continue;
    }
    assert.equal(row.status, "passed", `${row.id} has hermetic proof only; it must pass`);
    assert.equal(row.tier, "hermetic");
  }
});

test("hermetic/live rows name existing tests; required live suites are active", () => {
  assertRequiredLive(matrix.suites);
  const byId = new Map(matrix.suites.map((suite) => [suite.id, suite]));
  for (const row of evidence.rows) {
    for (const file of row.tests ?? []) {
      assert.ok(existsSync(join(ROOT, file)), `missing test ${file} for ${row.id}`);
    }
    for (const id of row.live ?? []) {
      const suite = byId.get(id);
      assert.ok(suite, `${row.id} live suite missing: ${id}`);
      assert.equal(suite.status, "active", `${row.id} live suite must be active: ${id}`);
    }
    for (const file of row.docs ?? []) assert.ok(existsSync(join(ROOT, file)), `missing docs pointer ${file} for ${row.id}`);
    if (row.status === "passed") assert.ok(row.tests?.length, `${row.id} passed without a test`);
  }
  assert.ok(existsSync(join(ROOT, evidence.packedJourney)));
  assert.ok(existsSync(join(ROOT, "docs/_evidence/0.7.0-host-completeness.md")));
});

test("removing a required live suite from the matrix is a release fail", () => {
  const clone = matrix.suites.filter((suite) => suite.id !== evidence.requiredLive[0]);
  assert.throws(() => assertRequiredLive(clone), /required live suite missing/);
});

test("0.7.0 is the six-plan line, channels are deferred to 0.8.0, and the cut tasks ran", () => {
  assert.deepEqual(evidence.releasePlans, [
    "plans/072-Host-Eval-And-Observability-Cockpit.md",
    "plans/073-Release-0-7-0-Host-Completeness.md",
    "plans/074-Attention-Compiler.md",
    "plans/075-Memory-Fabric.md",
    "plans/077-Work-Scope-Memory-Index.md",
    "plans/078-Host-Owned-Subagent-Spawn-And-Parallel-Agents.md",
  ]);
  for (const file of evidence.releasePlans) assert.ok(existsSync(join(ROOT, file)), `missing release plan ${file}`);
  assert.ok(
    (evidence.deviations ?? []).some((note) => note.includes("079") && note.includes("0.8.0")),
    "the channels deferral must be recorded as a deviation",
  );
  assert.deepEqual(evidence.cutTasks, {
    plan: "plans/073-Release-0-7-0-Host-Completeness.md",
    tasks: ["Task 28", "Task 29"],
    state: "executed",
  });
  // The cut tasks must read as executed in the plan, and each later plan must
  // reflect the line it actually shipped in.
  const cut = readFileSync(join(ROOT, evidence.cutTasks.plan), "utf8");
  assert.match(cut, /^- \[x\] Task 28 —/m, "Task 28 must read as executed");
  assert.match(cut, /^- \[x\] Task 29 —/m, "Task 29 must read as executed");
  assert.doesNotMatch(cut, /^- \[ \] Task 2[89] —.*Deferred/m, "no cut task may stay deferred");
  for (const file of evidence.releasePlans.filter((entry) => !entry.includes("073-"))) {
    const text = readFileSync(join(ROOT, file), "utf8");
    assert.match(text, /0\.7\.0/, `${file} must state the 0.7.0 release vehicle`);
  }
  const channels = readFileSync(join(ROOT, "plans/079-Prism-Messaging-Channels-Telegram-Signal.md"), "utf8");
  assert.match(channels, /0\.8\.0/, "plan 079 must state its 0.8.0 release vehicle");
});

test("R16 and R17 both have packed public-surface proof", () => {
  const journey = readFileSync(join(ROOT, evidence.packedJourney), "utf8");
  assert.match(journey, /R16 OK/);
  assert.doesNotMatch(journey, /R16 BLOCKED/);
  assert.match(journey, /R17 OK/);
  assert.doesNotMatch(journey, /R17 BLOCKED/);
});
