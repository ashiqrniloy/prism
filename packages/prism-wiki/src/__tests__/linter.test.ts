import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { WikiLinter } from "../engine/linter.js";
import { scaffoldWiki } from "../engine/scaffolder.js";
import { hashContent, updateManifestWithEntities } from "../manifest.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-linter-test");

describe("prism-wiki anti-drift linter", () => {
  before(async () => {
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/auth.ts"),
      `export function verifyToken() { return true; }\nexport function revokeToken() {}`,
      "utf8",
    );
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("linter_detects_broken_wikilinks_and_dead_anchors", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-dirty");
    const scaffolded = await scaffoldWiki({
      wikiRoot: wikiDir,
      profile: "codebase",
    });

    // Create an entity page with a broken link to [[non-existent-page]]
    await writeFile(
      join(wikiDir, "entities/module-auth.md"),
      `# Auth Module\nSee [[non-existent-page]] and [[decisions/ADR-001.md]].`,
      "utf8",
    );

    // Add an entity with a dead anchor (symbol missing in source)
    const deadAnchorEntity = {
      id: "module-auth",
      title: "Auth Module",
      category: "module" as const,
      tags: ["auth"],
      rawSources: ["src/auth.ts"],
      anchors: [
        {
          filePath: "src/auth.ts",
          startLine: 1,
          endLine: 2,
          symbol: "nonExistentSymbol",
          sourceHash: hashContent("nonExistent"),
        },
      ],
      lastCompiledAt: new Date().toISOString(),
    };

    const updatedManifest = updateManifestWithEntities(scaffolded.manifest, [deadAnchorEntity], new Map([["src/auth.ts", "hash1"]]));
    await writeFile(join(wikiDir, ".manifest.json"), JSON.stringify(updatedManifest, null, 2), "utf8");

    const linter = new WikiLinter();
    const report = await linter.lint(wikiDir, TEST_DIR);

    assert.equal(report.ok, false);
    assert.ok(report.brokenLinks.some((bl) => bl.target.includes("non-existent-page")));
    assert.ok(report.deadAnchors.some((da) => da.anchor.symbol === "nonExistentSymbol"));
  });

  it("linter_detects_orphan_pages", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-orphan");
    await scaffoldWiki({
      wikiRoot: wikiDir,
      profile: "codebase",
    });

    // Create two entities where one is an orphan (not linked in index.md or other entity)
    await writeFile(join(wikiDir, "entities/orphan-module.md"), `# Orphan Module\nNo other page links to me.`, "utf8");

    await writeFile(join(wikiDir, "entities/linked-module.md"), `# Linked Module\nI am referenced by index.`, "utf8");

    await writeFile(join(wikiDir, "index.md"), `# Wiki Index\n- [[entities/linked-module.md]]`, "utf8");

    const linter = new WikiLinter();
    const report = await linter.lint(wikiDir, TEST_DIR);

    assert.ok(report.orphans.some((o) => o.includes("orphan-module.md")));
  });
});
