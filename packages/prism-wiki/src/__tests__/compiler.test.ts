import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { WikiCompiler } from "../engine/compiler.js";
import { scaffoldWiki } from "../engine/scaffolder.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-compiler-test");

describe("prism-wiki compiler & scaffolder engine", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("scaffoldWiki_creates_schema_index_log_and_manifest", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-scaffold");
    const result = await scaffoldWiki({
      wikiRoot: wikiDir,
      profile: "codebase",
    });

    assert.equal(result.profile, "codebase");
    assert.ok(result.createdFiles.length >= 4);

    const schema = await readFile(join(wikiDir, "SCHEMA.md"), "utf8");
    const index = await readFile(join(wikiDir, "index.md"), "utf8");
    const log = await readFile(join(wikiDir, "log.md"), "utf8");
    const manifest = await readFile(join(wikiDir, ".manifest.json"), "utf8");

    assert.ok(schema.includes("Codebase Wiki Schema Rules"));
    assert.ok(schema.includes("OKF v0.2"));
    assert.ok(index.includes("# Wiki Index"));
    assert.ok(index.includes('okf_version: "0.2"'));
    assert.ok(!index.includes("[["));
    assert.ok(log.includes("Wiki Scaffolding"));
    assert.ok(log.includes("# Directory Update Log"));
    assert.match(log, /^## \d{4}-\d{2}-\d{2}$/m);
    const entitiesIndex = await readFile(join(wikiDir, "entities/index.md"), "utf8");
    assert.ok(entitiesIndex.startsWith("# Entities"));
    assert.ok(manifest.includes('"version": "1.0.0"'));
  });

  it("WikiCompiler_compiles_mock_codebase_and_generates_entities", async () => {
    const workspaceDir = join(TEST_DIR, "mock-project");
    const srcDir = join(workspaceDir, "src/auth");
    await mkdir(srcDir, { recursive: true });

    await writeFile(
      join(srcDir, "jwt.ts"),
      `export interface Token { id: string; }
export function verifyToken(token: string): boolean {
  return token.length > 0;
}`,
      "utf8",
    );

    const compiler = new WikiCompiler();
    const result = await compiler.compile({
      workspaceRoot: workspaceDir,
      wikiRoot: ".wiki",
      profile: "codebase",
    });

    assert.ok(result.compiledEntities.length >= 1);
    const entity = result.compiledEntities[0];
    assert.ok(entity.id.includes("auth"));

    const entityFile = await readFile(join(workspaceDir, ".wiki/entities", `${entity.id}.md`), "utf8");
    assert.ok(entityFile.includes("verifyToken"));
    assert.ok(entityFile.includes("file:///"));
    assert.match(entityFile, /^type: Module$/m);
    assert.ok(entityFile.includes("description:"));
    assert.ok(entityFile.includes("sources:"));
    assert.ok(entityFile.includes("generated:"));
    assert.ok(!entityFile.includes("\ncategory:"));
    assert.ok(!entityFile.includes("rawSources:"));
    assert.ok(!/^id: /m.test(entityFile.split("\n---")[0]));

    const indexFile = await readFile(join(workspaceDir, ".wiki/index.md"), "utf8");
    assert.ok(indexFile.includes(entity.title));
    assert.ok(indexFile.includes(`](entities/${entity.id}.md)`));
    assert.ok(!indexFile.includes("[["));

    const logFile = await readFile(join(workspaceDir, ".wiki/log.md"), "utf8");
    assert.ok(logFile.includes("entities compiled"));
    assert.match(logFile, /\* \*\*Compiled\*\*:/);

    // Second compile with no changes should be a no-op delta
    const secondResult = await compiler.compile({
      workspaceRoot: workspaceDir,
      wikiRoot: ".wiki",
    });
    assert.equal(secondResult.delta.added.length, 0);
    assert.equal(secondResult.delta.modified.length, 0);
  });
});
