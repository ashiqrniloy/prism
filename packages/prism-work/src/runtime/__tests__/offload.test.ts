import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";
import { createDocumentReader } from "../../document-reader/index.js";
import { createPdfParser } from "../../document-reader/parsers.js";
import { WORKER_POOL_OFFLOAD_MIN_BYTES } from "../worker-pool.js";

const FIXTURE = new URL("../../../src/document-reader/__tests__/fixtures/thousand-page.pdf", import.meta.url);

/**
 * Plan 127 Task 3: the document reader moves large-buffer extraction onto the pool; the offloaded
 * result must be text-identical to the inline parser. The sheets/documents model parses were
 * measured, regressed on the result-clone cost, and reverted (evidence §9), so they stay inline.
 */
test("offloaded document-reader extract equals the inline parser result", async () => {
  const buffer = await readFile(FIXTURE);
  assert.ok(buffer.byteLength > WORKER_POOL_OFFLOAD_MIN_BYTES);
  const reader = await createDocumentReader({ maxPages: 1000 });
  const parser = await createPdfParser();
  const offloaded = await reader.extract({ buffer, path: "t.pdf" });
  const inline = await parser.extract(buffer, { maxPages: 1000, maxTextBytes: reader.maxTextBytes });
  assert.ok(offloaded);
  assert.equal(offloaded.format, "pdf");
  assert.equal(offloaded.pages, inline.pages);
  assert.equal(offloaded.text, inline.text);
  assert.equal(offloaded.truncatedBy, inline.truncatedBy);
});
