// scripts/retired-names.test.mjs
// Plan 215 Task 35: the standing retired-name sweep (was plan 187 Task 1). Runs in `bun run test`.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FROM, generate, liveExportNames, ROOT, readList, removalSections, sweep } from "./retired-names.mjs";

const list = readList();

function tagResolves(tag) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${tag}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("retired-name sweep", () => {
  test("no_retired_name_in_live_tree", () => {
    const { hits, ms } = sweep({ list });
    const report = hits.map((hit) => `${hit.file}:${hit.line} ${hit.kind} ${hit.name}`).join("\n");
    expect(hits, `retired names in the live tree (fix them, or record a reason in scripts/retired-names.json):\n${report}`).toEqual([]);
    expect(ms).toBeLessThan(5_000);
  });

  // A shallow CI checkout has no tags; the release workflow fetches full history (`fetch-depth: 0`).
  test.skipIf(!tagResolves(DEFAULT_FROM))("retired_names_cover_baseline_removals", () => {
    const generated = generate({ from: DEFAULT_FROM });
    for (const key of ["packages", "subpaths", "errorCodes", "cliFlags"]) {
      const have = new Set(list[key]);
      const missing = generated[key].filter((name) => !have.has(name));
      expect(missing, `${key} missing from scripts/retired-names.json; run bun scripts/retired-names.mjs --generate`).toEqual([]);
    }
    const have = new Set(list.exports.map((entry) => entry.name));
    const missing = generated.exports.map((entry) => entry.name).filter((name) => !have.has(name));
    expect(missing, "exports missing from scripts/retired-names.json; run bun scripts/retired-names.mjs --generate").toEqual([]);
  });

  test("retired_names_are_not_live", () => {
    const live = liveExportNames();
    const relive = list.exports.map((entry) => entry.name).filter((name) => live.has(name));
    expect(relive, "a listed retired export is exported again; regenerate the list").toEqual([]);
    const tools = JSON.parse(readFileSync(join(ROOT, "scripts/retired-tool-names.json"), "utf8")).tools;
    expect(tools.length).toBeGreaterThan(0);
  });

  test("sweep_flags_each_kind_of_retired_name", () => {
    const exportName = list.exports.find((entry) => /^create[A-Z]/.test(entry.name)).name;
    const files = new Map([
      ["docs/a.md", `Use \`${exportName}()\` here.\n\n\`\`\`ts\nimport { ${exportName} } from "@arnilo/prism";\n\`\`\`\n`],
      ["docs/b.md", `Install ${list.packages[0]} and import ${list.subpaths[0]}.\n`],
      ["docs/c.md", `It throws \`${list.errorCodes[0]}\`. Call \`repo_search\`. Run \`prism ${list.cliFlags[0]} x\`.\n`],
      ["docs/d.md", 'import { notARealExport } from "@arnilo/prism";\n'],
      ["packages/x/src/y.ts", 'const tool = "git_worktree";\n'],
    ]);
    const kinds = new Set(sweep({ list, files }).hits.map((hit) => `${hit.file} ${hit.kind}`));
    for (const expected of [
      "docs/a.md export",
      "docs/b.md package",
      "docs/b.md subpath",
      "docs/c.md error",
      "docs/c.md tool",
      "docs/c.md cli-flag",
      "docs/d.md import",
      "packages/x/src/y.ts tool",
    ]) {
      expect(kinds.has(expected), `${expected} not flagged; got ${[...kinds].join(", ")}`).toBe(true);
    }
  });

  test("sweep_skips_removal_statements_history_and_tests", () => {
    const exportName = list.exports.find((entry) => /^create[A-Z]/.test(entry.name)).name;
    const files = new Map([
      ["docs/a.md", `\`${exportName}\` was removed in 0.13.\n\n## Removed\n\n- \`${exportName}\`\n\n## Next\n\nok\n`],
      ["docs/history/old.md", `\`${exportName}\`\n`],
      ["packages/x/src/__tests__/y.test.ts", `import { ${exportName} } from "@arnilo/prism";\n`],
      ["scripts/z.json", `{\n  "$comment": "retired ${list.packages[0]}"\n}\n`],
    ]);
    expect(sweep({ list, files }).hits).toEqual([]);
  });

  test("removal_sections_end_at_the_next_heading_of_the_same_level", () => {
    const text = "# Page\n\n## Removed\n\nx\n\n### Detail\n\ny\n\n## Use\n\nz\n";
    const [[start, end]] = removalSections(text);
    expect(text.slice(start, end)).toBe("## Removed\n\nx\n\n### Detail\n\ny\n\n");
  });
});
