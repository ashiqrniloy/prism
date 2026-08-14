// Plan 023 Task 4 regression: quality-gate stabilization (Biome migration,
// warning/info resolution, timing-assertion quarantine, machine-readable
// reports). Runs in the npm test gate segment after sweep-unused.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });

test("lint clean: biome lint . exits 0 with zero diagnostics and writes the SARIF report", () => {
  const result = run(join(ROOT, "node_modules", ".bin", "biome"), [
    "lint",
    ".",
    "--reporter=sarif",
    "--reporter-file=scripts/lint-report.sarif",
  ]);
  assert.equal(result.status, 0, `biome lint must exit 0 (no unexplained warnings/infos):\n${result.stdout.slice(0, 800)}`);
  const sarif = JSON.parse(readFileSync(join(ROOT, "scripts", "lint-report.sarif"), "utf8"));
  assert.ok(Array.isArray(sarif.runs?.[0]?.results), "lint report must be well-formed SARIF");
  assert.equal(sarif.runs[0].results.length, 0, "zero diagnostics may remain after the Task 4 resolution");
});

test("config migrated: biome.json uses preset, not the deprecated recommended key", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "biome.json"), "utf8"));
  assert.equal(config.linter.rules.preset, "recommended", "2.x canonical form is linter.rules.preset");
  assert.ok(config.linter.rules.recommended !== true, "the deprecated linter.rules.recommended:true key must be gone");
  const result = run(join(ROOT, "node_modules", ".bin", "biome"), ["lint", "biome.json"]);
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes("DEPRECATED"), "linting the config itself must report no deprecations");
});

test("timing quarantine: the racy elapsed assert is gone; kept guards carry named ceilings", () => {
  const bridge = readFileSync(join(ROOT, "packages", "mcp", "src", "__tests__", "bridge.test.ts"), "utf8");
  assert.ok(!bridge.includes("Date.now() - started"), "the bridge timeout test must not measure wall-clock deltas");
  assert.ok(!bridge.includes("hung MCP call exceeded timeout bound"), "the old 150ms elapsed bound is replaced by a test-level timeout");
  for (const [file, needle] of [
    ["packages/coding-agent/src/__tests__/repository.test.ts", "ponytail: wall-clock anti-block guard"],
    ["packages/coding-security/src/__tests__/native-sandbox.test.ts", "ponytail: wall-clock promptness guard"],
    ["packages/credentials-node/src/__tests__/credentials-node.test.ts", "ponytail: anti-hang guard"],
  ]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.ok(src.includes(needle), `${file} must document its kept timing ceiling`);
  }
});

test("safe-fix review: every biome-ignore carries a justification", () => {
  const grep = run("grep", [
    "-rn",
    "biome-ignore",
    "src",
    "packages",
    "scripts",
    "--include=*.ts",
    "--include=*.mjs",
    "--include=*.js",
    "--exclude=phase23-quality-gates.test.mjs",
  ]);
  assert.equal(grep.status, 0);
  const unJustified = grep.stdout.split("\n").filter((line) => line && !/biome-ignore[^:]*:/.test(line));
  assert.deepEqual(unJustified, [], "every biome-ignore needs a ': reason' suffix");
});

test("machine-readable reports: unused-report.json is well-formed and both reports are CI-retained", () => {
  const result = run(process.execPath, ["scripts/sweep-unused.mjs", "--json"]);
  assert.equal(result.status, 0);
  const json = JSON.parse(readFileSync(join(ROOT, "scripts", "unused-report.json"), "utf8"));
  assert.ok(Array.isArray(json.configs) && json.configs.length >= 40, "per-tsconfig rows must cover the core plus every workspace");
  assert.equal(typeof json.totalErrors, "number");
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.ok(workflow.includes("lint-report.sarif") && workflow.includes("unused-report.json"), "release CI must retain both reports");
});
