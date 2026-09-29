/**
 * Plan 058 Task 1: dead-export verification gate.
 * The committed evidence doc (docs/_evidence/dead-export-verification-*.md)
 * must classify every candidate in scripts/unused-report.json and never put a
 * `remove` verdict on an export present in a compat baseline (zero false
 * removes). The verifier runs <30 s (acceptance criterion).
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(new URL(".", import.meta.url).pathname, "..");

test("dead-export evidence table is complete and has zero false removes", () => {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["scripts/dead-export-verify.mjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `--check must pass: ${result.stderr || result.stdout}`);
  // Plan 058 set a 30 s dev-machine target. A shared CI runner is several times slower, so the gate
  // only enforces the target locally and keeps CI honest with a generous ceiling.
  const budgetMs = process.env.CI ? 180_000 : 30_000;
  assert.ok(Date.now() - started < budgetMs, `verifier must run in <${budgetMs / 1000} s`);
});

test("plan 058 task 2: every deprecate/remove export carries @deprecated JSDoc + CHANGELOG entry", () => {
  const result = spawnSync(process.execPath, ["scripts/dead-export-verify.mjs", "--deprecations"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `--deprecations must pass: ${result.stderr || result.stdout}`);
});

test("verifier emits one evidence row per candidate", () => {
  const out = execFileSync(process.execPath, ["scripts/dead-export-verify.mjs"], { cwd: root, encoding: "utf8" });
  const rows = out
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("| `"));
  const report = JSON.parse(readFileSync(join(root, "scripts", "unused-report.json"), "utf8"));
  const candidates = [...report.deadExports.matchAll(/^([A-Za-z_$][\w$]*) \(defined in/gm)].map((m) => m[1]);
  assert.equal(rows.length, candidates.length, "one evidence row per candidate");
});
