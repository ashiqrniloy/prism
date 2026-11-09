/**
 * Plan 209 Task 3: the pinned core became the standing rules. 0.13.0 is unpublished, so the retired names
 * are removed, not aliased. A repo-wide scan (source, packages, apps, scripts, examples, docs) fails on any.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const SCAN = ["src", "packages", "apps", "scripts", "examples", "docs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "history", "_evidence", "graft", "coverage"]);
const SKIP_FILES = /(^|\/)(CHANGELOG\.md|migrate-to-[0-9.]+\.md)$/;
// Built from fragments so this file does not contain the names it forbids.
const c = "co" + "re";
const RETIRED: readonly [string, RegExp][] = [
  ["the derived rules file name", new RegExp(`\\b${c}\\.md\\b`)],
  ["createFabric" + "Core", new RegExp(`\\bcreateFabric${c[0]!.toUpperCase()}${c.slice(1)}\\b`)],
  ["resolveFabric" + "CoreOptions", new RegExp(`\\bresolveFabric${c[0]!.toUpperCase()}${c.slice(1)}Options\\b`)],
  ["MemoryFabric" + "CoreConfig", new RegExp(`\\bMemoryFabric${c[0]!.toUpperCase()}${c.slice(1)}Config\\b`)],
  ["the block source", new RegExp(`fabric-${c}\\b`)],
  ["the block heading", new RegExp(`${c[0]!.toUpperCase()}${c.slice(1)} memory \\(`)],
  ["the budget field", new RegExp(`\\b${c}\\.(maxTokens|scopes|kinds)\\b`)],
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (/\.(ts|mjs|md|json)$/.test(name) && stat.size < 2_000_000) yield path;
  }
}

describe("retired pinned-core names (plan 209 Task 3)", () => {
  it("retired_core_names_absent_repo_wide", () => {
    const hits: string[] = [];
    for (const top of SCAN) {
      const dir = join(ROOT, top);
      try {
        statSync(dir);
      } catch {
        continue;
      }
      for (const path of walk(dir)) {
        const rel = relative(ROOT, path).split("\\").join("/");
        if (SKIP_FILES.test(rel) || rel.endsWith("retired-names.test.ts")) continue;
        const text = readFileSync(path, "utf8");
        for (const [label, pattern] of RETIRED) if (pattern.test(text)) hits.push(`${rel}: ${label}`);
      }
    }
    assert.deepEqual(hits, []);
  });
});
