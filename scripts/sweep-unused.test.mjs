/**
 * Plan 015 Task 3 sweep tests: the unused-code sweep driver always exits 0
 * (non-blocking) even with unused-code diagnostics present, the tsc flags
 * actually catch a seeded unused local, and the dead-export scan reports
 * definition-only exports while leaving referenced exports alone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(new URL(".", import.meta.url).pathname, "..");
const run = (cmd, args, cwd = root) => spawnSync(cmd, args, { cwd, encoding: "utf8" });

test("sweep driver always exits 0 and writes the combined report", () => {
  const result = run(process.execPath, ["scripts/sweep-unused.mjs", "--json"]);
  assert.equal(result.status, 0, `driver must exit 0 (non-blocking), got ${result.status}: ${result.stderr}`);
  const report = readFileSync(join(root, "scripts", "unused-sweep-report.txt"), "utf8");
  assert.ok(report.includes("## tsconfig.json"), "report covers the core tsconfig");
  assert.ok(report.includes("dead-export candidate"), "report includes the dead-export scan section");
  const json = JSON.parse(readFileSync(join(root, "scripts", "unused-report.json"), "utf8"));
  assert.ok(Array.isArray(json.configs) && json.configs.length >= 40, "--json must write the machine-readable per-tsconfig report");
});

test("tsc noUnused flags catch a seeded unused local, and the driver stays non-blocking", () => {
  const fixture = mkdtempSync(join(tmpdir(), "prism-sweep-"));
  writeFileSync(
    join(fixture, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true, noUnusedParameters: true }, include: ["src"] }),
  );
  mkdirSync(join(fixture, "src"));
  writeFileSync(join(fixture, "src", "a.ts"), "export function f() { const unused = 1; return 2; }\n");
  const tsc = run(join(root, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", "tsconfig.json"], fixture);
  assert.notEqual(tsc.status, 0, "tsc with noUnusedLocals must flag the seeded unused local");
  assert.ok(tsc.stdout.includes("unused"), "diagnostic names the unused local");
  // the driver itself scans the real tree (which carries known-intentional
  // diagnostics) and must still exit 0 — proven by the first test; this
  // fixture proves the flags are the ones doing the catching.
});

test("dead-export scan reports definition-only exports and skips referenced ones", () => {
  const fixture = mkdtempSync(join(tmpdir(), "prism-dead-"));
  mkdirSync(join(fixture, "src"));
  writeFileSync(join(fixture, "src", "a.ts"), "export function onlyHere() { return 1; }\nexport function used() { return 2; }\n");
  writeFileSync(join(fixture, "src", "b.ts"), "export const x = used();\n");
  writeFileSync(join(fixture, "src", "c.ts"), 'import { x } from "./b.js";\nexport const y = x + 1;\n');
  const result = run(process.execPath, ["scripts/dead-exports.mjs", fixture], root);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes("onlyHere (defined"), "definition-only export reported as candidate");
  assert.ok(result.stdout.includes("\ny (defined"), "definition-only export reported as candidate");
  assert.ok(!result.stdout.includes("used (defined"), "referenced export not reported");
  assert.ok(!result.stdout.includes("x (defined"), "referenced export not reported");
});
