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
// and exactly one trailing summary line:
//   Ran 2120 tests across 166 files. [35.65s]
// Node's TAP (`ℹ pass N`, `# fail N`) is gone: every leg runs `bun test` (plan 124 Tasks 2/3).
// Bun prints each failure twice (at its position and again in the end-of-run failure block), so
// `counts.fail` can over-count — harmless here, because any `(fail)` line fails the leg closed.
// `(pass)` lines print exactly once, and `counts.tests` comes from the summary, so both are exact.
const RESULT = /^\((pass|fail)\) /gm;
const SUMMARY = /^Ran (\d+) tests? across (\d+) files?\./m;

/** Counts from one captured `bun test` run. Throws when the capture carries no summary line. */
export function parseReport(output) {
  const summary = SUMMARY.exec(output);
  if (!summary) throw new Error("no `Ran N tests across M files.` summary in the capture");
  const counts = { tests: Number(summary[1]), pass: 0, fail: 0 };
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
  return { gitHead, captured, counts: evidenceCounts(output) };
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
      process.stderr.write(`test:postgres produced no clean bun summary; evidence not written (${error.message})\n`);
      process.exitCode = 1;
    }
  }
}
