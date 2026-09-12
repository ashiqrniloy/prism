import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createWikiIngestTool } from "../tools/ingest.js";
import { createWikiReadPageTool } from "../tools/read-page.js";
import { createWikiRecordInsightTool } from "../tools/record-insight.js";
import { createWikiSearchTool } from "../tools/search.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "prism-wiki-tools-"));

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

  it("wiki_read_page_denies_sibling_prefix_traversal", async () => {
    const tool = createWikiReadPageTool({ workspaceRoot: TEST_DIR, wikiRoot: ".wiki" });
    await mkdir(join(TEST_DIR, ".wiki-evil"), { recursive: true });
    await writeFile(join(TEST_DIR, ".wiki-evil/secret.md"), "secret", "utf8");

    await assert.rejects(async () => {
      await tool.execute({ pagePath: "../.wiki-evil/secret.md" }, { sessionId: "s1", runId: "r1", toolCallId: "c5" });
    }, /Access denied/);
  });

  it("wiki_read_page_denies_symlink_escape", async () => {
    const tool = createWikiReadPageTool({ workspaceRoot: TEST_DIR, wikiRoot: ".wiki" });
    await writeFile(join(TEST_DIR, "outside-secret.md"), "outside", "utf8");
    await symlink(join(TEST_DIR, "outside-secret.md"), join(TEST_DIR, ".wiki/entities/escape.md"));

    await assert.rejects(async () => {
      await tool.execute({ pagePath: "entities/escape.md" }, { sessionId: "s1", runId: "r1", toolCallId: "c6" });
    }, /Access denied/);
  });

  it("wiki_read_page_reports_missing_contained_page_as_not_found", async () => {
    const tool = createWikiReadPageTool({ workspaceRoot: TEST_DIR, wikiRoot: ".wiki" });

    const result = await tool.execute({ pagePath: "entities/missing.md" }, { sessionId: "s1", runId: "r1", toolCallId: "c7" });
    assert.equal((result.value as { found: boolean }).found, false);
  });

  it("wiki_record_insight_rejects_empty_oversize_and_injecting_titles", async () => {
    const tool = createWikiRecordInsightTool({ workspaceRoot: TEST_DIR, wikiRoot: ".wiki" });

    await assert.rejects(async () => {
      await tool.execute({ title: "   ", content: "x" }, { sessionId: "s1", runId: "r1", toolCallId: "c8" });
    }, /title must be a non-empty/);
    await assert.rejects(async () => {
      await tool.execute({ title: "ok", content: "  " }, { sessionId: "s1", runId: "r1", toolCallId: "c9" });
    }, /content must be a non-empty/);
    await assert.rejects(async () => {
      await tool.execute({ title: "t".repeat(201), content: "x" }, { sessionId: "s1", runId: "r1", toolCallId: "c10" });
    }, /title exceeds/);
    await assert.rejects(async () => {
      await tool.execute({ title: "ok", content: "x".repeat(65_537) }, { sessionId: "s1", runId: "r1", toolCallId: "c11" });
    }, /content exceeds/);

    // Newline/control injection collapses to a single line: no extra heading/index/log entry.
    await tool.execute(
      { title: "evil insight\n## injected heading", content: "body" },
      { sessionId: "s1", runId: "r1", toolCallId: "c12" },
    );
    const log = await readFile(join(TEST_DIR, ".wiki/log.md"), "utf8");
    const index = await readFile(join(TEST_DIR, ".wiki/index.md"), "utf8");
    assert.ok(!log.includes("\n## injected heading"));
    assert.ok(!index.includes("\n## injected heading"));
  });

  it("wiki_ingest_tool_same_staging", async () => {
    const tool = createWikiIngestTool({ workspaceRoot: TEST_DIR, wikiRoot: ".wiki" });
    const result = await tool.execute(
      { text: "Tool-staged note", title: "Tool Note" },
      { sessionId: "s1", runId: "r1", toolCallId: "c20" },
    );

    assert.equal(result.name, "wiki_ingest");
    const value = result.value as { sourcePath: string; extractPath: string; extract: string };
    assert.match(value.sourcePath, /^raw\/ingest\/.+tool-note\/source\.txt$/);
    assert.equal(await readFile(join(TEST_DIR, value.extractPath), "utf8"), "Tool-staged note");
    assert.ok(result.content?.[0].type === "text" && result.content[0].text.includes("Filing checklist"));
    assert.equal((result.metadata as Record<string, unknown>).trust, "untrusted_external");
  });

  it("wiki_ingest_tool_requires_exactly_one_source", async () => {
    const tool = createWikiIngestTool({ workspaceRoot: TEST_DIR, wikiRoot: ".wiki" });
    await assert.rejects(async () => {
      await tool.execute({}, { sessionId: "s1", runId: "r1", toolCallId: "c21" });
    }, /requires exactly one of text, path, or url/);
  });

  it("wiki_ingest_tool_embeds_small_image_and_pointers_for_huge", async () => {
    // Tool schema only accepts text/path/title; image bytes enter through ingestWikiSource.
    // Small images inline as base64 image blocks; huge ones stay path pointers (no multi-MB base64).
    const { ingestImageBlock, ingestWikiSource } = await import("../ingest.js");
    const png = new Uint8Array([137, 80, 78, 71]);
    const smallStaged = await ingestWikiSource(
      { bytes: png, filename: "shot.png", title: "Shot" },
      { workspaceRoot: TEST_DIR, wikiRoot: ".wiki" },
    );
    const block = await ingestImageBlock(smallStaged, TEST_DIR);
    assert.equal(block?.type, "image");
    assert.equal(block?.mimeType, "image/png");

    const huge = new Uint8Array(300 * 1024).fill(1);
    const hugeStaged = await ingestWikiSource(
      { bytes: huge, filename: "big.png", title: "Big" },
      { workspaceRoot: TEST_DIR, wikiRoot: ".wiki" },
    );
    assert.equal(await ingestImageBlock(hugeStaged, TEST_DIR), undefined);
  });
});
