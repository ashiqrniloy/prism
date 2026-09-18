import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentReaderError } from "../errors.js";
import { createDocumentReader } from "../index.js";
import { createMistralOcrParser } from "../mistral-ocr.js";

const PDF = Buffer.from("%PDF-1.7\n%", "latin1");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function ocrResponse(markdown = "scanned line"): Response {
  return new Response(
    JSON.stringify({
      pages: [{ index: 1, markdown, images: [], dimensions: {} }],
      model: "mistral-ocr-latest",
      usage_info: { pages_processed: 1, doc_size_bytes: 32 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("createMistralOcrParser refuses empty apiKey", () => {
  assert.throws(() => createMistralOcrParser({ apiKey: "  " }), DocumentReaderError);
});

test("OCR extract posts inline data URL, no Files API, records usage, keeps page spans", async () => {
  const calls: Array<{ url: string; body: string; auth: string }> = [];
  const usage: Array<{ pagesProcessed: number; model: string }> = [];
  const parser = createMistralOcrParser({
    apiKey: "sk-test",
    fetch: async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(input),
        body: String(init?.body),
        auth: String(headers.authorization),
      });
      return ocrResponse("hello scan");
    },
    recordUsage: (entry) => {
      usage.push({ pagesProcessed: entry.pagesProcessed, model: entry.model });
    },
  });
  assert.equal(parser.detect(PDF), true);
  assert.equal(parser.detect(PNG), true);
  assert.equal(parser.detect(Buffer.from("not-a-doc")), false);
  const result = await parser.extract(PDF, { maxPages: 8, maxTextBytes: 4096 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.mistral.ai/v1/ocr");
  assert.equal(calls[0]?.auth, "Bearer sk-test");
  assert.match(calls[0]?.body ?? "", /data:application\/pdf;base64,/);
  assert.match(calls[0]?.body ?? "", /include_image_base64":false/);
  assert.doesNotMatch(calls[0]?.body ?? "", /\/v1\/files/);
  assert.equal(result.pages, 1);
  assert.match(result.text, /prism-page 1/);
  assert.match(result.text, /hello scan/);
  assert.equal(result.pageSpans?.[0]?.page, 1);
  assert.deepEqual(usage, [{ pagesProcessed: 1, model: "mistral-ocr-latest" }]);
});

test("documentUrl is SSRF-checked; loopback is denied before fetch", () => {
  assert.throws(
    () =>
      createMistralOcrParser({
        apiKey: "sk-test",
        documentUrl: "http://127.0.0.1/secret.pdf",
        fetch: async () => ocrResponse(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof DocumentReaderError);
      assert.match(error.message, /documentUrl is not allowed/);
      return true;
    },
  );
});

test("oversized buffer refuses before fetch", async () => {
  let fetched = 0;
  const parser = createMistralOcrParser({
    apiKey: "sk-test",
    maxBytes: 16,
    fetch: async () => {
      fetched += 1;
      return ocrResponse();
    },
  });
  await assert.rejects(parser.extract(Buffer.concat([PDF, Buffer.alloc(64)]), { maxPages: 1, maxTextBytes: 1024 }), /maxBytes/);
  assert.equal(fetched, 0);
});

test("HTTP error does not leak body or apiKey", async () => {
  const parser = createMistralOcrParser({
    apiKey: "sk-secret-key",
    fetch: async () => new Response("sk-secret-key IGNORE THIS DOCUMENT TEXT", { status: 401, headers: { "content-type": "text/plain" } }),
  });
  await assert.rejects(parser.extract(PDF, { maxPages: 1, maxTextBytes: 1024 }), (error: unknown) => {
    assert.ok(error instanceof DocumentReaderError);
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /sk-secret-key/);
    assert.doesNotMatch(error.message, /DOCUMENT THIS/);
    return true;
  });
});

test("over-page OCR result refuses after recording usage", async () => {
  const usage: number[] = [];
  const parser = createMistralOcrParser({
    apiKey: "sk-test",
    maxPages: 1,
    fetch: async () =>
      new Response(
        JSON.stringify({
          pages: [
            { index: 1, markdown: "a" },
            { index: 2, markdown: "b" },
          ],
          model: "mistral-ocr-latest",
          usage_info: { pages_processed: 2 },
        }),
        { status: 200 },
      ),
    recordUsage: (entry) => {
      usage.push(entry.pagesProcessed);
    },
  });
  await assert.rejects(parser.extract(PDF, { maxPages: 8, maxTextBytes: 4096 }), /has 2 pages/);
  assert.deepEqual(usage, [2]);
});

test("default createDocumentReader parsers never call fetch", async () => {
  const dist = await (await import("node:fs/promises")).readFile(new URL("../index.js", import.meta.url), "utf8");
  assert.doesNotMatch(dist, /\bfetch\s*\(/);
  const reader = await createDocumentReader({
    parsers: [
      {
        format: "fake",
        detect: () => true,
        extract: async () => ({ text: "local", pages: 1, truncatedBy: null }),
      },
    ],
  });
  const result = await reader.extract({ buffer: PDF, path: "x.pdf" });
  assert.equal(result?.format, "fake");
  assert.equal(result?.text, "local");
});
