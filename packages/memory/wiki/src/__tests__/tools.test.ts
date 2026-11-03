import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWikiIngestTool } from "../tools/ingest.js";
import { sourcePort } from "./support.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "prism-wiki-tools-"));

describe("wiki_ingest tool", () => {
  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("wiki_ingest_tool_same_staging", async () => {
    const tool = createWikiIngestTool({ workspaceRoot: TEST_DIR, port: sourcePort(TEST_DIR) });
    const result = await tool.execute(
      { text: "Tool-staged note", title: "Tool Note" },
      { sessionId: "s1", runId: "r1", toolCallId: "c20" },
    );

    assert.equal(result.name, "wiki_ingest");
    const value = result.value as { sourcePath: string; extractPath: string; extract: string };
    assert.match(value.sourcePath, /^sources\/.+tool-note\/source\.txt$/);
    assert.equal(await readFile(join(TEST_DIR, value.extractPath), "utf8"), "Tool-staged note");
    assert.ok(result.content?.[0].type === "text" && result.content[0].text.includes("Extract preview"));
    assert.equal((result.metadata as Record<string, unknown>).trust, "untrusted_external");
  });

  it("wiki_ingest_tool_requires_exactly_one_source", async () => {
    const tool = createWikiIngestTool({ workspaceRoot: TEST_DIR, port: sourcePort(TEST_DIR) });
    await assert.rejects(async () => {
      await tool.execute({}, { sessionId: "s1", runId: "r1", toolCallId: "c21" });
    }, /requires exactly one of text, path, or url/);
  });

  it("wiki_ingest_tool_embeds_small_image_and_pointers_for_huge", async () => {
    // Tool schema only accepts text/path/title; image bytes enter through ingestWikiSource.
    // Small images inline as base64 image blocks; huge ones stay path pointers (no multi-MB base64).
    const { ingestImageBlock, ingestWikiSource } = await import("../ingest.js");
    const png = new Uint8Array([137, 80, 78, 71]);
    const smallStaged = await ingestWikiSource({ bytes: png, filename: "shot.png", title: "Shot" }, { workspaceRoot: TEST_DIR });
    const block = await ingestImageBlock(smallStaged, TEST_DIR);
    assert.equal(block?.type, "image");
    assert.equal(block?.mimeType, "image/png");

    const huge = new Uint8Array(300 * 1024).fill(1);
    const hugeStaged = await ingestWikiSource({ bytes: huge, filename: "big.png", title: "Big" }, { workspaceRoot: TEST_DIR });
    assert.equal(await ingestImageBlock(hugeStaged, TEST_DIR), undefined);
  });
});
