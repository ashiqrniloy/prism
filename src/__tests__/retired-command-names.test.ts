import { test } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Plan 176 Task 5: the 0.12 command shape is retired with no alias — `PackageCommand` /
 * `PackageCommandContext` replace it. A live file must not name the old types; only frozen records
 * (docs/history, docs/_evidence, scripts/compat-baseline) and the files whose job is to name them may.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const RETIRED = ["CommandDefinition", "CommandExecutionContext", "CommandDrivers", "CommandWorkflowRun", "CommandResult"];
const PATTERN = new RegExp(`\\b(${RETIRED.join("|")})\\b`);
const SCAN_ROOTS = ["src", "packages", "apps", "scripts", "examples", "docs"];
const SKIP_DIR = /^(docs\/history|docs\/_evidence|scripts\/compat-baseline|node_modules|dist|\.types)(\/|$)/;
const ALLOWED = new Set([
  "docs/migrate-to-0.13.md", // the migration note exists to map every removed name to its replacement
  "src/__tests__/docs.test.ts", // its retired-export list cross-checks that note
  "src/__tests__/retired-command-names.test.ts", // this scan's own list
]);

function scanFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const relative = path.slice(root.length + 1);
    if (SKIP_DIR.test(relative)) continue;
    if (entry.isDirectory()) scanFiles(path, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|json|md)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

test("retired_command_names_absent", () => {
  const files = SCAN_ROOTS.flatMap((dir) => scanFiles(join(root, dir)));
  assert.ok(files.length > 500, `the sweep must cover the repository, scanned ${files.length} files`);

  const offenders: string[] = [];
  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    if (PATTERN.test(readFileSync(join(root, file), "utf8"))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `a live file still names the retired 0.12 command shape:\n${offenders.join("\n")}`);
});

test("retired_command_names_absent_matches_whole_words_only", () => {
  assert.equal(PATTERN.test("const command: CommandDefinition = {}"), true);
  assert.equal(PATTERN.test("function f(c: CommandResult): void {}"), true);
  // The workflows and coding packages ship their own `*CommandResult` types; those are live names.
  assert.equal(PATTERN.test("export interface WorkflowCommandResult {}"), false);
  assert.equal(PATTERN.test("export interface E2BCommandResult {}"), false);
});
