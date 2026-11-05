import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SWEPT = ["src", "packages", "apps", "scripts", "examples", "docs", "README.md", "PRODUCT.md"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git", "history", "_evidence"]);

/** 0.12 wiki names that plan 207 Task 5 deleted with no alias. `prism-wiki` is the retired bin and the 0.4-era package name. */
const RETIRED = [
  "wiki_search",
  "wiki_read_page",
  "wiki_record_insight",
  "wiki-init",
  "wiki-refresh",
  "wiki-lint",
  "wiki-ingest",
  "wiki-searcher",
  "wiki-maintainer",
  "wiki-guidance",
  "WIKI_INJECTOR_NAME",
  "WIKI_SEARCH_TOOL_NAME",
  "WIKI_READ_PAGE_TOOL_NAME",
  "WIKI_RECORD_INSIGHT_TOOL_NAME",
  "qmdPath",
  "autoDeploySkills",
  "deployWikiSkills",
  "createWikiDeletionHandler",
  "createWikiRepointHandler",
  "retireWikiSources",
  "repointWikiSources",
  "WikiCompiler",
  "wikiRoot",
  "context7-hydrator",
  "qmd-client",
  "initWiki",
  "refreshWiki",
  "lintWiki",
  ".wiki/",
];

/**
 * Files that record the retired names on purpose: this test, release history, the migration map, frozen
 * 0.x freeze records and reports, and the baselines of the retired line. Each is history, not a live caller.
 */
function isRecord(path: string): boolean {
  return (
    path === "packages/memory/wiki/src/__tests__/retired-names.test.ts" ||
    path === "packages/memory/wiki/src/__tests__/package.test.ts" || // the config-rejection test names the dead fields
    path === "docs/migrate-to-0.13.md" ||
    /^docs\/migrate-to-0\.\d+\.md$/.test(path) ||
    /(^|\/)CHANGELOG\.md$/.test(path) ||
    /^scripts\/phase\d+/.test(path) || // frozen phase freeze records and tests
    path === "scripts/budgets.json" || // historical rationale prose
    path === "scripts/deprecations-0.13.json" ||
    path === "scripts/retired-tool-names.json" || // the retired tool-name inventory (plan 215 Task 7)
    path === "scripts/unused-report.json" ||
    path === "scripts/unused-sweep-report.txt" ||
    /^scripts\/compat-baseline\/arnilo__prism(-memory|-wiki)?\.txt$/.test(path) || // the 0.12 family baselines
    path === "src/__tests__/packaging.test.ts" || // asserts the bin and skills are gone
    path === "packages/memory/fabric/src/__tests__/package.test.ts" // its allowlist names the frozen record
  );
}

function* walk(path: string): Generator<string> {
  const info = statSync(path);
  if (info.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    yield* walk(join(path, entry));
  }
}

describe("retired wiki names", () => {
  it("retired_wiki_names_absent_repo_wide", () => {
    const hits: string[] = [];
    for (const start of SWEPT) {
      for (const file of walk(join(ROOT, start))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (isRecord(rel) || /\.(png|jpe?g|gif|webp|ico|pdf|lock|sarif)$/.test(rel)) continue;
        const text = readFileSync(file, "utf8");
        for (const name of RETIRED) if (text.includes(name)) hits.push(`${rel}: ${name}`);
      }
    }
    assert.deepEqual(hits, [], "a retired wiki name is still named outside the history records");
  });
});
