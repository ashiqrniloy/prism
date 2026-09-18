#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const EVIDENCE = join(ROOT, "scripts", "postgres-evidence.json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function total(output, label) {
  return [...output.matchAll(new RegExp(`^(?:#|ℹ) ${label} (\\d+)$`, "gm"))].reduce((sum, match) => sum + Number(match[1]), 0);
}

rmSync(EVIDENCE, { force: true });
const result = spawnSync(npm, ["run", "test:postgres:run"], { cwd: ROOT, encoding: "utf8", env: process.env });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

if (result.error) {
  process.stderr.write(`test:postgres failed to start: ${result.error.message}\n`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const counts = { tests: total(output, "tests"), pass: total(output, "pass"), fail: total(output, "fail") };
  if (counts.tests === 0 || counts.pass === 0 || counts.fail !== 0) {
    process.stderr.write("test:postgres produced no clean TAP summary; evidence not written\n");
    process.exitCode = 1;
  } else {
    const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    writeFileSync(EVIDENCE, `${JSON.stringify({ gitHead, captured: new Date().toISOString(), counts }, null, 2)}\n`);
  }
}
