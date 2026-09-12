// Blocked-gate convention gate (plan 071 Task 14, plan 070 FA 5).
// In-chain: asserts the registry ↔ gate-file truth and that no protected gate
// hand-rolls its blocked message. The protected legs themselves are run in
// child processes with their infrastructure unset, so the canonical record,
// the fail-closed exit, and the env-names-only rule are asserted here without
// any protected service.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  auditBlockedGates,
  BLOCKED_RECORD_TEMPLATE,
  blockedRecord,
  handRolledGateMessages,
  PROTECTED_GATES,
  protectedGateSurfaces,
  validateRegistry,
} from "./blocked-gate.mjs";
import { GATE_FILES } from "./run-all-tests.mjs";

const ROOT = join(import.meta.dirname, "..");
const EMITTER = join(ROOT, "scripts", "release-skip-manifest.mjs");
// One canonical record: id, env NAMES, space-free evidence surface, free-text hint last.
const RECORD = /^BLOCKED GATE (\S+) requires=([A-Z][A-Z0-9_]*(?:,[A-Z][A-Z0-9_]*)*) evidence=(\S+) hint=(\S.*)$/;
const CANARY = "CANARY_PROTECTED_VALUE_MUST_NOT_APPEAR";

/** Child env with every declared requirement removed (and an unrelated canary value set). */
function scrubbedEnv(extra = {}) {
  const env = { ...process.env, PRISM_BLOCKED_GATE_CANARY: CANARY };
  for (const row of PROTECTED_GATES) for (const name of row.requires) delete env[name];
  // NODE_TEST_CONTEXT makes a child runner report into this one instead of
  // running the file (node:test "recursive run" skip), which would hide a
  // gate that no longer fails closed.
  delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
}

function runGate(row) {
  const args = row.style === "test" ? ["--test", row.script] : [row.script];
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: scrubbedEnv(), timeout: 120_000 });
}

test("registry: every protected gate is a real file with env-NAME-only requirements", () => {
  assert.deepEqual(validateRegistry(), [], "registry must be self-consistent");
  assert.ok(
    PROTECTED_GATES.some((row) => row.style === "script") && PROTECTED_GATES.some((row) => row.style === "test"),
    "both gate styles must be exercised by the registry",
  );
  // Negative control: a row for a file that does not exist must be reported.
  const bogus = [...PROTECTED_GATES, { ...PROTECTED_GATES[0], id: "bogus", script: "scripts/does-not-exist.test.mjs" }];
  const problems = validateRegistry(bogus);
  assert.ok(
    problems.some((problem) => problem.includes("scripts/does-not-exist.test.mjs")),
    `a missing gate file must be reported, got ${JSON.stringify(problems)}`,
  );
  assert.ok(
    validateRegistry([{ ...PROTECTED_GATES[0], id: "bogus", requires: ["not-a-name"] }]).some((problem) => problem.includes("not-a-name")),
    "a non-env requirement must be reported",
  );
});

test("convention: no protected gate hand-rolls its blocked message", () => {
  assert.deepEqual(handRolledGateMessages(), [], "gate files must call blockedGate() from scripts/blocked-gate.mjs");
  // Positive control: a scratch gate that imports the helper but prints its own record.
  const scratchRoot = mkdtempSync(join(tmpdir(), "prism-blocked-gate-"));
  try {
    mkdirSync(join(scratchRoot, "scripts"));
    const scratch = "scripts/scratch-gate.test.mjs";
    writeFileSync(
      join(scratchRoot, scratch),
      [
        'import { blockedGate } from "./blocked-gate.mjs";',
        "if (!process.env.PRISM_SCRATCH_URL) {",
        '  console.error("BLOCKED GATE: PRISM_SCRATCH_URL is required");',
        "  process.exit(1);",
        "}",
        'blockedGate("phase22-conformance");',
        "",
      ].join("\n"),
    );
    const problems = handRolledGateMessages([{ ...PROTECTED_GATES[0], script: scratch }], scratchRoot);
    assert.ok(
      problems.some((problem) => problem.includes(`${scratch}:3`) && problem.includes("hand-rolled")),
      `a bespoke blocked message must be reported with its line, got ${JSON.stringify(problems)}`,
    );
    // Positive control the other way: a gate that never calls the helper is reported.
    writeFileSync(join(scratchRoot, scratch), "export const nothing = 1;\n");
    assert.ok(
      handRolledGateMessages([{ ...PROTECTED_GATES[0], script: scratch }], scratchRoot).some((problem) =>
        problem.includes("does not call blockedGate"),
      ),
      "a gate without a blockedGate() call must be reported",
    );
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("fail-closed: every protected gate prints one canonical record and exits non-zero", () => {
  const seen = [];
  for (const row of PROTECTED_GATES) {
    const result = runGate(row);
    const output = `${result.stdout}${result.stderr}`;
    seen.push(row.id);
    assert.notEqual(result.status, 0, `${row.id} must fail closed, not skip:\n${output}`);
    // Exactly one canonical record line (the test reporter repeats the message
    // inside its AssertionError line, which is not a record line).
    const records = output.split("\n").filter((line) => line.startsWith("BLOCKED GATE "));
    assert.equal(records.length, 1, `${row.id} must print exactly one canonical record, got ${JSON.stringify(records)}`);
    const match = RECORD.exec(records[0]);
    assert.ok(match, `${row.id} record is not canonical: ${records[0]}`);
    assert.equal(match[1], row.id, "record id");
    assert.equal(match[2], row.requires.join(","), "record requires");
    assert.equal(match[3], row.evidence, "record evidence");
    assert.equal(match[4], row.hint, "record hint");
    assert.equal(blockedRecord(row), records[0], "the registry must render the record the gate printed");
    // Env names only: the child carried a canary value in an unrelated var; no value may surface.
    assert.ok(!output.includes(CANARY), `${row.id} must not print env values`);
  }
  assert.equal(seen.length, PROTECTED_GATES.length);
});

test("audit: lists every leg this environment cannot run, and nothing when they are all declared", () => {
  const blocked = auditBlockedGates(scrubbedEnv());
  assert.deepEqual(
    blocked.map((row) => row.id),
    PROTECTED_GATES.map((row) => row.id),
    "with every requirement unset the audit lists every registry gate",
  );
  for (const id of ["phase12-restart-recovery", "phase22-conformance", "phase26-recovery-conformance", "phase27-dr"]) {
    assert.ok(
      blocked.some((row) => row.id === id),
      `audit must list ${id}`,
    );
  }
  assert.ok(!blocked.some((row) => row.record.includes("undefined")), "records must never carry undefined fields");
  const declared = Object.fromEntries(PROTECTED_GATES.flatMap((row) => row.requires.map((name) => [name, "1"])));
  assert.deepEqual(auditBlockedGates(declared), [], "a fully declared environment blocks nothing");
  // The audit command is the same registry read: one record per blocked leg, exit 0 (a report, not a gate).
  const cli = spawnSync(process.execPath, ["scripts/blocked-gate.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: scrubbedEnv(),
    timeout: 60_000,
  });
  assert.equal(cli.status, 0, `audit must exit 0:\n${cli.stderr}`);
  assert.ok(cli.stdout.includes(BLOCKED_RECORD_TEMPLATE), "audit must print the record shape");
  for (const row of PROTECTED_GATES) assert.ok(cli.stdout.includes(blockedRecord(row)), `audit must list ${row.id}`);
});

test("wiring: release evidence derives the documented-gap rows from the registry", () => {
  const derived = protectedGateSurfaces();
  assert.equal(derived.length, PROTECTED_GATES.filter((row) => !row.surface).length, "one row per surface-less leg");
  for (const row of derived) {
    assert.equal(row.state, "protected", `${row.name} is a documented gap: never pass, never blocks`);
    assert.ok(row.reason.includes("evidence"), `${row.name} must name its evidence surface`);
    assert.match(row.requiredEnv, /^PRISM_[A-Z0-9_]+$/, `${row.name} requiredEnv must be an env NAME`);
  }
  assert.ok(
    GATE_FILES.includes("scripts/blocked-gate.test.mjs"),
    "the convention gate must run in the in-chain gate stage (scripts/run-all-tests.mjs GATE_FILES)",
  );
  // The emitter consumes the registry: its manifest carries the derived rows and its summary points at the audit.
  const dir = mkdtempSync(join(tmpdir(), "prism-blocked-gate-evidence-"));
  try {
    const manifestPath = join(dir, "release-evidence.json");
    const result = spawnSync(process.execPath, [EMITTER], {
      cwd: ROOT,
      encoding: "utf8",
      env: scrubbedEnv({ PRISM_RELEASE_EVIDENCE: manifestPath }),
      timeout: 120_000,
    });
    assert.equal(result.status, 0, `emitter failed:\n${result.stderr}`);
    assert.match(result.stdout, /audit: node scripts\/blocked-gate\.mjs/, "the emitter must point at the audit command");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const row of derived) {
      const surface = manifest.surfaces.find((entry) => entry.name === row.name);
      assert.ok(surface, `${row.name} must appear in release-evidence.json`);
      assert.equal(surface.state, "protected");
      assert.deepEqual(surface.requires, row.requires);
    }
    assert.ok(
      !manifest.surfaces.some((surface) => surface.name.includes("blocked-gate")),
      "derived rows must use gate ids, not module names",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
