import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, initWiki, lintWiki, refreshWiki } from "../index.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-commands-test");

describe("prism-wiki commands & lifecycle hooks", () => {
  before(async () => {
    await mkdir(join(TEST_DIR, "src/auth"), { recursive: true });
    await writeFile(join(TEST_DIR, "src/auth/jwt.ts"), `export function verifyToken() { return true; }`, "utf8");
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("initWiki_scaffolds_and_compiles_initial_entities", async () => {
    const res = await initWiki({
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
      profile: "codebase",
    });

    assert.equal(res.status, "initialized");
    assert.equal(res.profile, "codebase");
    assert.ok(res.compiledEntities >= 1);

    const schema = await readFile(join(TEST_DIR, ".wiki/SCHEMA.md"), "utf8");
    assert.ok(schema.includes("Codebase Wiki Schema Rules"));

    const index = await readFile(join(TEST_DIR, ".wiki/index.md"), "utf8");
    assert.ok(index.includes("Auth Module"));
  });

  it("refreshWiki_recompiles_modified_files", async () => {
    // Modify source file
    await writeFile(
      join(TEST_DIR, "src/auth/jwt.ts"),
      `export function verifyToken() { return true; }\nexport function revokeToken() {}`,
      "utf8",
    );

    const res = await refreshWiki({
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    assert.equal(res.status, "refreshed");
    assert.ok(res.delta.modified.includes("src/auth/jwt.ts"));
  });

  it("lintWiki_validates_clean_wiki_health", async () => {
    const report = await lintWiki({
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    assert.equal(report.ok, true);
    assert.equal(report.deadAnchors.length, 0);
    assert.equal(report.brokenLinks.length, 0);
  });

  it("commands_execute_via_prism_extension_kernel", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([
      createWikiExtension({
        workspaceRoot: TEST_DIR,
        wikiRoot: ".wiki",
      }),
    ]);

    const initCmd = kernel.registries.commands.get("wiki-init");
    const refreshCmd = kernel.registries.commands.get("wiki-refresh");
    const lintCmd = kernel.registries.commands.get("wiki-lint");

    assert.ok(initCmd);
    assert.ok(refreshCmd);
    assert.ok(lintCmd);

    const refreshResult = await refreshCmd.execute({}, { sessionId: "s1", runId: "r1" });
    assert.equal(refreshResult.name, "wiki-refresh");
    assert.ok(refreshResult.content && refreshResult.content[0].type === "text" && refreshResult.content[0].text.includes("Refreshed"));

    const lintResult = await lintCmd.execute({}, { sessionId: "s1", runId: "r1" });
    assert.equal(lintResult.name, "wiki-lint");
    assert.ok(lintResult.content && lintResult.content[0].type === "text" && lintResult.content[0].text.includes("health check passed"));
  });
});
