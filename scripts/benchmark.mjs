#!/usr/bin/env node
/**
 * Parameterized benchmark runner (plan 015 Task 1).
 *
 * Single entry point for every release benchmark scenario; replaces the
 * per-version runners scripts/benchmark-0.0.{8..16,23..28}.mjs. Each scenario
 * is a measurement module under scripts/benchmark-scenarios/ that emits the
 * legacy report shape { version, generatedAt, environment, fixture, results }.
 * The 0.1.0 capacity envelope (scripts/benchmark-0.1.0.mjs) composes these
 * scenarios as child processes; humans can run one scenario directly.
 *
 * Usage:
 *   node scripts/benchmark.mjs --list
 *   node scripts/benchmark.mjs --scenario <name>            # report to stdout
 *   node scripts/benchmark.mjs --scenario <name> --out <file>
 *   PRISM_TEST_POSTGRES_URL="postgresql://…" node scripts/benchmark.mjs --scenario phase6-postgres
 *
 * Protected scenarios (phase6-postgres, phase7-postgres) require
 * PRISM_TEST_POSTGRES_URL and fail loud without it — blocked-gate semantics,
 * never a silent skip. Exit code 1 on scenario failure or ceiling breach.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const SCENARIOS = {
  "phase6-postgres": { module: "benchmark-scenarios/phase6-postgres.mjs", phase: 6, protected: true },
  "phase7-postgres": { module: "benchmark-scenarios/phase7-postgres.mjs", phase: 7, protected: true },
  "phase8-loops-hitl": { module: "benchmark-scenarios/phase8-loops-hitl.mjs", phase: 8, protected: false },
  "phase9-coding": { module: "benchmark-scenarios/phase9-coding.mjs", phase: 9, protected: false },
  "phase10-acp": { module: "benchmark-scenarios/phase10-acp.mjs", phase: 10, protected: false },
  "phase11-auth": { module: "benchmark-scenarios/phase11-auth.mjs", phase: 11, protected: false },
};

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      console.log(`${name}${scenario.protected ? " (protected: requires PRISM_TEST_POSTGRES_URL)" : ""}`);
    }
    process.exit(0);
  }
  const index = args.indexOf("--scenario");
  if (index === -1 || !args[index + 1]) {
    console.error("usage: node scripts/benchmark.mjs --scenario <name> [--out <file>] | --list");
    console.error(`scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const name = args[index + 1];
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`unknown scenario: ${name}`);
    process.exitCode = 1;
    return;
  }
  if (scenario.protected && !process.env.PRISM_TEST_POSTGRES_URL?.trim()) {
    console.error(`scenario ${name} is protected and requires PRISM_TEST_POSTGRES_URL (blocked gate, not a skip)`);
    process.exit(1);
  }
  const run = spawnSync(process.execPath, [join(here, scenario.module)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.status !== 0) {
    console.error(`${name} failed (exit ${run.status}):\n${run.stderr || run.stdout}`);
    process.exit(run.status ?? 1);
  }
  const report = JSON.parse(run.stdout);
  const out = args.indexOf("--out");
  if (out !== -1 && args[out + 1]) writeFileSync(args[out + 1], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
