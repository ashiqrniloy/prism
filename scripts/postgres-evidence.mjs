#!/usr/bin/env bun
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const EVIDENCE = join(ROOT, "scripts", "postgres-evidence.json");
const BUN = process.platform === "win32" ? "bun.exe" : "bun";

// Contract: Bun 1.4.2's default reporter — transcript in
// docs/_evidence/phase124-bun-only-inventory.md §3 ("reporter shape"). One result line per
// executed test:
//   (pass) pendingDecisionsOf returns the new pendingDecisions when present [3.19ms]
//   (fail) redaction benchmark scenario (plan 070) > runs through the parameterized runner within the frozen caps [279.18ms]
// and one summary per leg (three workspace-prefixed plus one phase conformance):
//   @arnilo/prism-core test:postgres: Ran 78 tests across 17 files. [8.46s]
//   Ran 11 tests across 3 files. [7.86s]
// Node's TAP (`ℹ pass N`, `# fail N`) is gone: every leg runs `bun test` (plan 124 Tasks 2/3).
// Bun prints each failure twice (at its position and again in the end-of-run failure block), so
// `counts.fail` can over-count — harmless here, because any `(fail)` line fails the leg closed.
// `(pass)` lines print exactly once; counts sum all four leg summaries, never just the final one.
const RESULT = /^(?:@arnilo\/prism-(?:core|memory|channels) test:postgres: )?\((pass|fail)\) /gm;
const SUMMARY = /^(?:(@arnilo\/prism-(?:core|memory|channels) test:postgres): )?Ran (\d+) tests? across (\d+) files?\./gm;
const REQUIRED_POSTGRES_CASES = [
  "scopes ordinary and leaf entry queries to the owning session",
  "filters and keyset-paginates branch entry queries",
  "keeps session activity monotonic across run, usage, and event writes",
];

/** Counts from all captured `bun test` legs. Throws when the capture carries no summary line. */
export function parseReport(output) {
  const summaries = [...output.matchAll(SUMMARY)];
  if (!summaries.length) throw new Error("no `Ran N tests across M files.` summary in the capture");
  const counts = { tests: summaries.reduce((total, summary) => total + Number(summary[2]), 0), pass: 0, fail: 0 };
  for (const [, outcome] of output.matchAll(RESULT)) counts[outcome] += 1;
  return counts;
}

/** Fail closed: an empty, summary-less, or non-clean capture never becomes evidence. */
export function evidenceCounts(output) {
  const counts = parseReport(output);
  if (counts.tests < 1) throw new Error(`no tests ran (${counts.tests} recorded)`);
  if (counts.pass < 1) throw new Error(`no passing tests recorded (${counts.pass} pass lines)`);
  if (counts.fail !== 0) throw new Error(`${counts.fail} failing test(s)`);
  if (counts.pass > counts.tests) throw new Error(`pass count ${counts.pass} exceeds the summary's ${counts.tests}`);
  return counts;
}

/** The only thing that may reach disk: the head, the capture time, and counts — never the capture. */
export function evidenceDocument({ gitHead, captured, output }) {
  const counts = evidenceCounts(output);
  const legs = [...output.matchAll(SUMMARY)].map((summary) => summary[1] ?? "phase conformance");
  for (const leg of [
    "@arnilo/prism-core test:postgres",
    "@arnilo/prism-memory test:postgres",
    "@arnilo/prism-channels test:postgres",
    "phase conformance",
  ]) {
    if (legs.filter((name) => name === leg).length !== 1) throw new Error(`PostgreSQL service leg missing or duplicated: ${leg}`);
    if (leg === "phase conformance" ? !/^\(pass\) /m.test(output) : !output.includes(`${leg}: (pass) `)) {
      throw new Error(`PostgreSQL service leg has no passing tests: ${leg}`);
    }
  }
  const lines = output.split("\n");
  for (const name of REQUIRED_POSTGRES_CASES) {
    if (
      !lines.some((line) => line.startsWith(`@arnilo/prism-core test:postgres: (pass) createPostgresPersistence integration > ${name} [`))
    ) {
      throw new Error(`required PostgreSQL regression did not pass: ${name}`);
    }
  }
  return { gitHead, captured, counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rmSync(EVIDENCE, { force: true });
  const result = spawnSync(BUN, ["run", "test:postgres:run"], { cwd: ROOT, encoding: "utf8", env: process.env });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");

  if (result.error) {
    process.stderr.write(`test:postgres failed to start: ${result.error.message}\n`);
    process.exitCode = 1;
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    try {
      const document = evidenceDocument({
        gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
        captured: new Date().toISOString(),
        output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      });
      writeFileSync(EVIDENCE, `${JSON.stringify(document, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`test:postgres evidence rejected (${error.message})\n`);
      process.exitCode = 1;
    }
  }
}
