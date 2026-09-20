import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { WikiLinter } from "../engine/linter.js";
import { scaffoldWiki } from "../engine/scaffolder.js";
import { hashContent, updateManifestWithEntities } from "../manifest.js";
import { retireWikiSources } from "../retire.js";

/** Page body shaped like the compiler's output, so the `## Raw Sources` projection is exercised. */
function compiledPage(title: string, sources: readonly string[]): string {
  return `---\ntype: entity\ntitle: "${title}"\ngenerated: { by: prism-wiki/0.0.2, at: ${new Date().toISOString()} }\n---\n\n# ${title}\n\nSummary.\n\n## Raw Sources\n${sources.map((src) => `- \`${src}\``).join("\n")}\n`;
}

function entity(id: string, title: string, rawSources: readonly string[]) {
  return {
    id,
    title,
    category: "entity" as const,
    tags: [],
    rawSources,
    anchors: [],
    lastCompiledAt: new Date().toISOString(),
  };
}

const TEST_DIR = mkdtempSync(join(tmpdir(), "prism-wiki-linter-"));

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

    await writeFile(join(wikiDir, "index.md"), `# Wiki Index\n* [Linked](entities/linked-module.md) - referenced`, "utf8");

    const linter = new WikiLinter();
    const report = await linter.lint(wikiDir, TEST_DIR);

    assert.ok(report.orphans.some((o) => o.includes("orphan-module.md")));
  });

  it("linter_reports_entity_whose_only_source_is_gone", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-pruned-single");
    const scaffolded = await scaffoldWiki({ wikiRoot: wikiDir, profile: "codebase" });
    // A source that is gone with the page (and manifest entry) still standing — retire/prune never rewrites pages.
    await writeFile(
      join(wikiDir, ".manifest.json"),
      JSON.stringify(updateManifestWithEntities(scaffolded.manifest, [entity("ghost", "Ghost", ["src/gone.ts"])], new Map()), null, 2),
      "utf8",
    );
    await writeFile(join(wikiDir, "entities/ghost.md"), compiledPage("Ghost", ["src/gone.ts"]), "utf8");

    const report = await new WikiLinter().lint(wikiDir, TEST_DIR);

    assert.deepEqual(report.prunedSources, [{ page: "entities/ghost.md", missing: ["src/gone.ts"] }]);
    assert.equal(report.ok, true, "a pruned page is maintainer work, not a broken wiki");
  });

  it("linter_reports_only_the_missing_source_of_a_partially_pruned_entity", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-pruned-partial");
    const scaffolded = await scaffoldWiki({ wikiRoot: wikiDir, profile: "codebase" });
    await writeFile(
      join(wikiDir, ".manifest.json"),
      JSON.stringify(
        updateManifestWithEntities(scaffolded.manifest, [entity("dual", "Dual", ["src/auth.ts", "src/retired.ts"])], new Map()),
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(join(wikiDir, "entities/dual.md"), compiledPage("Dual", ["src/auth.ts", "src/retired.ts"]), "utf8");

    const retired = await retireWikiSources({ workspaceRoot: TEST_DIR, wikiRoot: wikiDir, sourcePaths: ["src/retired.ts"] });
    assert.deepEqual(retired.pruned, ["dual"], "the manifest drops the retired source, the page keeps listing it");

    const report = await new WikiLinter().lint(wikiDir, TEST_DIR);

    assert.deepEqual(report.prunedSources, [{ page: "entities/dual.md", missing: ["src/retired.ts"] }]);
    assert.equal(report.ok, true);
  });

  it("linter_leaves_fully_retired_entities_to_the_manifest", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-pruned-full");
    const scaffolded = await scaffoldWiki({ wikiRoot: wikiDir, profile: "codebase" });
    await writeFile(
      join(wikiDir, ".manifest.json"),
      JSON.stringify(updateManifestWithEntities(scaffolded.manifest, [entity("solo", "Solo", ["src/solo.ts"])], new Map()), null, 2),
      "utf8",
    );
    await writeFile(join(wikiDir, "entities/solo.md"), compiledPage("Solo", ["src/solo.ts"]), "utf8");

    const retired = await retireWikiSources({ workspaceRoot: TEST_DIR, wikiRoot: wikiDir, sourcePaths: ["src/solo.ts"] });
    assert.deepEqual(retired.retired, ["solo"]);

    const report = await new WikiLinter().lint(wikiDir, TEST_DIR);

    assert.deepEqual(report.prunedSources, [], "entry and page are both gone, so there is nothing left to re-file");
  });

  it("linter_skips_pruned_report_for_a_wiki_without_a_manifest", async () => {
    const report = await new WikiLinter().lint(join(TEST_DIR, ".wiki-missing"), TEST_DIR);

    assert.deepEqual(report.prunedSources, []);
    assert.equal(report.ok, false);
    assert.ok(report.brokenLinks.some((bl) => bl.target.includes("Manifest not found")));
  });

  it("linter_flags_okf_frontmatter_and_wikilinks", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-okf");
    await scaffoldWiki({ wikiRoot: wikiDir, profile: "codebase" });
    await writeFile(
      join(wikiDir, "entities/bad.md"),
      `---\ntitle: "Bad"\ngenerated: { by: prism-wiki/0.0.2, at: not-a-date }\n---\n\n# Bad\nSee [[wikilink]] and [missing](missing.md).\n`,
      "utf8",
    );
    const linter = new WikiLinter();
    const report = await linter.lint(wikiDir, TEST_DIR);
    assert.equal(report.ok, false);
    assert.ok(report.gaps.some((gap) => gap.includes("missing type")));
    assert.ok(report.gaps.some((gap) => gap.includes("generated.at")));
    assert.ok(report.brokenLinks.some((bl) => bl.target.includes("[[wikilink]]")));
    assert.ok(report.brokenLinks.some((bl) => bl.target.includes("missing.md")));
  });
});
