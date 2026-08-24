import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createWikiReadPageTool } from "../tools/read-page.js";
import { createWikiRecordInsightTool } from "../tools/record-insight.js";
import { createWikiSearchTool } from "../tools/search.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-tools-test");

describe("prism-wiki tools suite", () => {
  before(async () => {
    await mkdir(join(TEST_DIR, ".wiki/entities"), { recursive: true });
    await writeFile(join(TEST_DIR, ".wiki/entities/module-auth.md"), `# Authentication Module\n\nHandles JWT authentication.`, "utf8");
    await writeFile(join(TEST_DIR, ".wiki/index.md"), `# Wiki Index\n`, "utf8");
    await writeFile(join(TEST_DIR, ".wiki/log.md"), `# Wiki Log\n`, "utf8");
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("wiki_search_tool_returns_hydrated_results", async () => {
    const tool = createWikiSearchTool({
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    const result = await tool.execute({ query: "authentication", mode: "search" }, { sessionId: "s1", runId: "r1", toolCallId: "c1" });

    assert.equal(result.name, "wiki_search");
    assert.equal(result.toolCallId, "c1");
    assert.ok(result.content && result.content[0].type === "text");
    assert.ok(result.content[0].type === "text" && result.content[0].text.includes("Authentication Module"));
  });

  it("wiki_read_page_reads_entity_and_rejects_path_traversal", async () => {
    const tool = createWikiReadPageTool({
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    // Read valid entity
    const validRes = await tool.execute({ pagePath: "entities/module-auth.md" }, { sessionId: "s1", runId: "r1", toolCallId: "c2" });
    assert.equal(validRes.name, "wiki_read_page");
    assert.ok(validRes.content && validRes.content[0].type === "text" && validRes.content[0].text.includes("Handles JWT"));

    // Path traversal attempt should throw
    await assert.rejects(async () => {
      await tool.execute({ pagePath: "../../../etc/passwd" }, { sessionId: "s1", runId: "r1", toolCallId: "c3" });
    }, /Access denied/);
  });

  it("wiki_record_insight_creates_decision_and_updates_index_and_log", async () => {
    const tool = createWikiRecordInsightTool({
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    const result = await tool.execute(
      {
        title: "ADR-001 Ed25519 Migration",
        content: "We decided to migrate JWT signing from HMAC to Ed25519.",
        category: "decision",
      },
      { sessionId: "s1", runId: "r1", toolCallId: "c4" },
    );

    assert.equal(result.name, "wiki_record_insight");
    assert.ok(result.content && result.content[0].type === "text" && result.content[0].text.includes("Successfully recorded"));

    // Verify file created
    const decisionFile = await readFile(join(TEST_DIR, ".wiki/decisions/adr-001-ed25519-migration.md"), "utf8");
    assert.ok(decisionFile.includes("Ed25519 Migration"));

    // Verify index.md updated
    const indexContent = await readFile(join(TEST_DIR, ".wiki/index.md"), "utf8");
    assert.ok(indexContent.includes("ADR-001 Ed25519 Migration"));

    // Verify log.md updated
    const logContent = await readFile(join(TEST_DIR, ".wiki/log.md"), "utf8");
    assert.ok(logContent.includes("Recorded decision"));
  });
});
