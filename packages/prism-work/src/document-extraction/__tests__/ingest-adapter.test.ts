import assert from "node:assert/strict";
import { test } from "bun:test";
import { createDocumentIngest, DocumentExtractionError, type DocumentExtractor } from "../index.js";

const MARK = "BODY_MARK_132";

function extractor(result: { markdown: string; ocrUsed?: boolean; pages?: number } | "fail"): Pick<DocumentExtractor, "extract"> {
  return {
    extract: async (input) => {
      assert.equal(JSON.stringify(input).includes("SECRET"), false);
      if (result === "fail") throw new DocumentExtractionError("io");
      return {
        markdown: result.markdown,
        format: "pdf",
        ocrUsed: result.ocrUsed ?? false,
        ...(result.pages !== undefined ? { pages: result.pages } : {}),
      };
    },
  };
}

test("wiki and rag adapters keep trust metadata and drop failed OCR", async () => {
  const ingest = createDocumentIngest(extractor({ markdown: MARK, ocrUsed: true, pages: 1 }), { ocrImages: true });
  const hooked = await ingest.extractDocument({ bytes: new Uint8Array([1]), filename: "scan.pdf", mediaType: "application/pdf" });
  assert.deepEqual(hooked, { text: MARK, format: "pdf" });
  const parsed = await ingest.parser.parse({ uri: "raw/scan.pdf", data: new Uint8Array([1]), mediaType: "application/pdf" });
  assert.equal(parsed.text, MARK);
  assert.equal(parsed.metadata.untrusted, true);
  assert.equal(parsed.metadata.inert, true);
  assert.equal(parsed.metadata.injectionCapable, true);
  assert.equal(parsed.metadata.ocrUsed, true);
  assert.equal(parsed.metadata.uri, "raw/scan.pdf");
  assert.equal(JSON.stringify(parsed.metadata).includes(MARK), false);
  const stats = ingest.stats();
  assert.equal(stats.extractions, 2);
  assert.equal(stats.ocrCount, 2);
  assert.equal(JSON.stringify(stats).includes(MARK), false);

  const failing = createDocumentIngest(extractor("fail"));
  await assert.rejects(failing.parser.parse({ uri: "scan.pdf", data: new Uint8Array([1]) }), DocumentExtractionError);
  assert.equal(failing.stats().ocrCount, 0);
  assert.equal(failing.stats().extractions, 0);
  const late = createDocumentIngest(extractor({ markdown: MARK }));
  await assert.rejects(
    late.parser.parse({ uri: "scan.pdf", data: new Uint8Array([1]) }, { maxParseMs: -1 }),
    (error: unknown) => error instanceof DocumentExtractionError && error.reason === "resourceLimit",
  );
  assert.equal(late.stats().extractions, 0);
});

test("image OCR is explicit", async () => {
  let saw = false;
  const ingest = createDocumentIngest(
    {
      extract: async (input) => {
        saw = input.ocr === true;
        return { markdown: "ALT", format: "png", ocrUsed: true };
      },
    },
    { ocrImages: true },
  );
  await ingest.extractDocument({ bytes: new Uint8Array([137, 80, 78, 71]), mediaType: "image/png" });
  assert.equal(saw, true);
  assert.equal(ingest.ocrImages, true);
});
