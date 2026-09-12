#!/usr/bin/env node
// One blocked-gate convention (plan 071 Task 14, plan 070 FA 5).
//
// A protected leg that cannot run on this host must fail closed with a single
// machine-readable record and a non-zero exit — never a passing skip:
//
//   BLOCKED GATE <id> requires=<names> evidence=<surface> hint=<how to unblock>
//
// PROTECTED_GATES is the single registry of those legs: the gates print from
// it, `node scripts/blocked-gate.mjs` audits it ("which legs are blocked
// today?"), and scripts/release-skip-manifest.mjs derives its manual-leg
// evidence rows from it. Env NAMES only, never values (release-evidence rule).
//
// manifestClass says who decides a release:
//   "required"  the release profile is expected to run the leg, so its
//               release-evidence surface (see `surface`) goes blocked when the
//               infrastructure is absent — phase12/phase22 ride
//               `npm run test:postgres`, the coding journey rides
//               coding-journey.yml.
//   "protected" a documented gap the release pipeline does not provision: it
//               stays visible forever and never blocks a release.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** The frozen record shape (scripts/phase27-freeze-manifest.json records it too). */
export const BLOCKED_RECORD_TEMPLATE = "BLOCKED GATE <id> requires=<names> evidence=<surface> hint=<how to unblock>";

/**
 * Protected legs that fail closed without host infrastructure.
 *   style "test"   node:test file: blockedGate() throws inside an it(), so the run fails.
 *   style "script" plain script: blockedGate() prints the record and exits 1.
 *   surface        an existing release-evidence row that already owns this leg, so the
 *                  manifest keeps one row per leg instead of duplicating it.
 */
export const PROTECTED_GATES = [
  {
    id: "phase12-restart-recovery",
    script: "scripts/phase12-restart-recovery.test.mjs",
    style: "test",
    requires: ["PRISM_TEST_POSTGRES_URL"],
    evidence: "scripts/phase12-restart-recovery.json",
    hint: "PRISM_TEST_POSTGRES_URL=<url> npm run test:postgres against a disposable pgvector/pgvector:pg16",
    runner: "npm run test:postgres",
    manifestClass: "required",
    surface: "test:postgres durable conformance",
  },
  {
    id: "phase22-conformance",
    script: "scripts/phase22-conformance.test.mjs",
    style: "test",
    requires: ["PRISM_TEST_POSTGRES_URL"],
    evidence: "scripts/phase22-baseline.json",
    hint: "PRISM_TEST_POSTGRES_URL=<url> npm run test:postgres runs the durable state-concurrency leg",
    runner: "npm run test:postgres",
    manifestClass: "required",
    surface: "test:postgres durable conformance",
  },
  {
    id: "phase26-recovery-conformance",
    script: "scripts/phase26-recovery-conformance.test.mjs",
    style: "script",
    requires: ["PRISM_TEST_POSTGRES_URL"],
    evidence: "scripts/phase26-baseline.json",
    hint: "PRISM_TEST_POSTGRES_URL=<url> node --test scripts/phase26-recovery-conformance.test.mjs",
    runner: "manual protected leg (8/8 recorded in scripts/phase26-baseline.json; not in a release profile)",
    manifestClass: "protected",
  },
  {
    id: "phase26-pty-protected",
    script: "scripts/phase26-pty-protected.test.mjs",
    style: "script",
    requires: ["PRISM_TEST_PTY_BACKEND"],
    evidence: "scripts/phase26-baseline.json",
    hint: "PRISM_TEST_PTY_BACKEND=<module exporting createPtyBackend()> node --test scripts/phase26-pty-protected.test.mjs",
    runner: "manual protected leg (4/4 recorded in scripts/phase26-baseline.json; needs a host PTY engine)",
    manifestClass: "protected",
  },
  {
    id: "phase27-dr",
    script: "scripts/phase27-dr.test.mjs",
    style: "script",
    requires: ["PRISM_TEST_POSTGRES_URL", "PRISM_DR_TARGET_URL", "PRISM_PITR_URL"],
    evidence: "docs/_evidence/phase27-dr-evidence.json",
    hint: "node scripts/phase27-dr.test.mjs --target <loopback-url> --confirm-target prism_dr_restore with the source and PITR containers up; evidence freshness is asserted in-chain by scripts/phase27-erp-journey.test.mjs",
    runner: "manual disaster-recovery drill (needs a PITR target; never part of npm test)",
    manifestClass: "protected",
  },
  {
    id: "phase26-coding-journey",
    script: "scripts/phase26-coding-journey.test.mjs",
    style: "script",
    requires: [
      "PRISM_CODING_JOURNEY",
      "PRISM_TEST_POSTGRES_URL",
      "PRISM_TEST_DOCKER_BIN",
      "PRISM_TEST_DOCKER_IMAGE",
      "PRISM_LIVE_PLAYWRIGHT",
      "PRISM_CODING_FORGE_REPOSITORY",
      "PRISM_CODING_FORGE_TOKEN",
      "PRISM_CODING_PROVIDER",
    ],
    evidence: "scripts/phase26-coding-journey-report.json",
    hint: "provision the frozen profile and run node --test scripts/phase26-coding-journey.test.mjs (coding-journey.yml does this on demand)",
    runner: "coding-journey.yml (real provider, digest-pinned Docker, forge, Postgres, Playwright)",
    manifestClass: "required",
    surface: "protected coding journey (0.2.6, plan 026)",
  },
];

/** Env names the row needs that this environment does not declare (empty/unset counts as absent). */
export function missingRequirements(row, env = process.env) {
  return row.requires.filter((name) => {
    const value = env[name];
    return value === undefined || value === "";
  });
}

/** The canonical single-line record for a row (hint last: free text, spaces allowed). */
export function blockedRecord(row) {
  return `BLOCKED GATE ${row.id} requires=${row.requires.join(",")} evidence=${row.evidence} hint=${row.hint}`;
}

/**
 * Fail a protected leg closed: the record as the test failure (style "test") or
 * on stderr plus exit 1 (style "script"). `missing` overrides the env check for
 * legs with extra requirements (flags, digest pins, module loads); never pass
 * env VALUES.
 */
export function blockedGate(id, { missing, env = process.env } = {}) {
  const row = PROTECTED_GATES.find((gate) => gate.id === id);
  if (!row) throw new Error(`unknown protected gate ${id}; add it to PROTECTED_GATES in scripts/blocked-gate.mjs`);
  const unmet = missing?.length ? missing : missingRequirements(row, env);
  const details = unmet.filter((entry) => !row.requires.includes(entry));
  const message = details.length ? `${blockedRecord(row)}\n  ${details.join("\n  ")}` : blockedRecord(row);
  if (row.style === "test") {
    // Print the record itself, then fail the test: hosts get the same canonical
    // line from both styles, while the leg stays a test failure (never a skip).
    console.error(message);
    assert.fail(message);
  }
  console.error(message);
  process.exit(1);
}

/** Every leg this environment cannot run, with the record it would print. Pure registry/env read. */
export function auditBlockedGates(env = process.env) {
  return PROTECTED_GATES.filter((row) => missingRequirements(row, env).length > 0).map((row) => ({
    id: row.id,
    script: row.script,
    requires: row.requires,
    missing: missingRequirements(row, env),
    evidence: row.evidence,
    runner: row.runner,
    manifestClass: row.manifestClass,
    record: blockedRecord(row),
  }));
}

/**
 * Release-evidence rows for the documented-gap legs (rows with a `surface` are
 * already owned by that row). Always state "protected": the release pipeline
 * does not provision them, so they can never turn a release green or block it.
 */
export function protectedGateSurfaces() {
  return PROTECTED_GATES.filter((row) => !row.surface && row.manifestClass === "protected").map((row) => ({
    name: `${row.id} protected leg`,
    state: "protected",
    protected: true,
    requiredEnv: row.requires[0],
    requires: row.requires,
    reason: `${row.runner}; evidence ${row.evidence}`,
    source: "scripts/blocked-gate.mjs PROTECTED_GATES (plan 071 Task 14)",
  }));
}

/** Registry self-checks (gate files exist, ids unique, env names not values, records printable). */
export function validateRegistry(rows = PROTECTED_GATES, root = ROOT) {
  const problems = [];
  const ids = new Set();
  for (const row of rows) {
    const where = row?.id ?? "(unnamed)";
    if (!row?.id || ids.has(row.id)) problems.push(`${where}: gate id must be unique and non-empty`);
    else ids.add(row.id);
    if (typeof row.script !== "string" || !existsSync(join(root, row.script)))
      problems.push(`${where}: gate file ${row.script} does not exist`);
    if (!["test", "script"].includes(row.style)) problems.push(`${where}: style must be "test" or "script"`);
    if (!Array.isArray(row.requires) || row.requires.length === 0) problems.push(`${where}: requires must list env names`);
    else
      for (const name of row.requires)
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) problems.push(`${where}: requires entry ${name} is not an env NAME`);
    if (typeof row.evidence !== "string" || !/^\S+$/.test(row.evidence)) problems.push(`${where}: evidence must be a space-free surface`);
    if (typeof row.hint !== "string" || !row.hint.trim() || row.hint.includes("\n")) problems.push(`${where}: hint must be a single line`);
    if (typeof row.runner !== "string" || !row.runner.trim()) problems.push(`${where}: runner must say who runs the leg`);
    if (!["required", "protected"].includes(row.manifestClass)) problems.push(`${where}: manifestClass must be "required" or "protected"`);
    if (row.surface !== undefined && (typeof row.surface !== "string" || !row.surface.trim()))
      problems.push(`${where}: surface must name the release-evidence row that owns the leg`);
  }
  return problems;
}

/** Protected-gate files that hand-roll a blocked message instead of calling blockedGate(). */
export function handRolledGateMessages(rows = PROTECTED_GATES, root = ROOT) {
  const violations = [];
  for (const row of rows) {
    const path = join(root, row.script);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    const code = lines.filter((line) => !isCommentLine(line)).map(codeOfLine);
    if (!code.some((line) => line.includes("blocked-gate.mjs")))
      violations.push(`${row.script}: must import blockedGate from ./blocked-gate.mjs`);
    if (!code.some((line) => /\bblockedGate\(/.test(line)))
      violations.push(`${row.script}: does not call blockedGate() for its protected leg`);
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      const bespoke = /\bBLOCKED GATE\b|\bDR DRILL FAILED\b/.exec(codeOfLine(line));
      if (bespoke)
        violations.push(`${row.script}:${index + 1}: hand-rolled "${bespoke[0]}" message; use blockedGate() from scripts/blocked-gate.mjs`);
    });
  }
  return violations;
}

function isCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line);
}

function codeOfLine(line) {
  return line.replace(/\/\/.*$/, "");
}

// Audit: which protected legs cannot run here, and which of them a release
// cares about. Exits 0 either way — the release decision belongs to
// scripts/release-evidence.json (release:evidence + release:gate).
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = validateRegistry();
  if (problems.length) {
    console.error(`blocked-gate registry is invalid:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const blocked = auditBlockedGates();
  const summary = (rows) => (rows.length ? rows.map((row) => row.id).join(", ") : "none");
  console.log(`${blocked.length} of ${PROTECTED_GATES.length} protected legs cannot run with this environment`);
  for (const row of blocked) console.log(row.record);
  console.log(`release-profile legs among them: ${summary(blocked.filter((row) => row.manifestClass === "required"))}`);
  console.log(
    `documented gaps (never a passing skip, never a release block): ${summary(blocked.filter((row) => row.manifestClass === "protected"))}`,
  );
  console.log(`record shape: ${BLOCKED_RECORD_TEMPLATE}`);
}
