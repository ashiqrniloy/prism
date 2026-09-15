import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const apiKey = process.env.PRISM_TEST_MISTRAL_API_KEY;
const FIXTURES = new URL("../../../src/document-reader/__tests__/fixtures/", import.meta.url);

describe("mistral ocr live", { skip: apiKey ? false : "set PRISM_TEST_MISTRAL_API_KEY to probe Mistral OCR" }, () => {
  it("extracts page text from the sample PDF", async () => {
    const { createMistralOcrParser } = await import("../mistral-ocr.js");
    const parser = createMistralOcrParser({ apiKey: apiKey!, maxPages: 4, timeoutMs: 60_000 });
    const buffer = await readFile(new URL("sample.pdf", FIXTURES));
    const result = await parser.extract(buffer, { maxPages: 4, maxTextBytes: 64 * 1024 });
    assert.ok(result.pages >= 1);
    assert.ok(result.text.length > 0);
    assert.ok(result.pageSpans && result.pageSpans.length === result.pages);
  });
});
