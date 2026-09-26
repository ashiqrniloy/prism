/**
 * Child process for classification, slot, and missing-peer checks.
 * Invoked by anydoc.test.ts so a mock peer cannot leak into the real-fixture file.
 */
import assert from "node:assert/strict";
import { mock } from "bun:test";

const indexPath = process.argv[2];
const mode = process.argv[3];
if (!indexPath || (mode !== "policy" && mode !== "missing")) {
  throw new Error("usage: slot-probe <index.js> <policy|missing>");
}

let calls = 0;
let behavior = "ok";
let gate: Promise<void> = Promise.resolve();
globalThis.fetch = (async () => {
  throw new Error("network");
}) as typeof fetch;

if (mode === "missing") {
  mock.module("@firecrawl/anydoc", () => {
    throw new Error("Cannot find package secret");
  });
} else {
  mock.module("@firecrawl/anydoc", () => ({
    formatFromBytes: () => "pdf",
    formatFromExtension: () => "csv",
    toMarkdownBytes: async () => {
      calls += 1;
      await gate;
      if (behavior === "needsOcr") {
        throw Object.assign(new Error("page text secret"), { code: "needsOcr", pages: [3], pageCount: 3 });
      }
      if (behavior !== "ok") {
        throw Object.assign(new Error(`secret ${behavior}`), { code: behavior });
      }
      return "LEAK secret markdown";
    },
  }));
}

const { createDocumentExtractor, DocumentExtractionError, NeedsOcrError } = await import(indexPath);

function extractionError(error: unknown): InstanceType<typeof DocumentExtractionError> {
  assert.ok(error instanceof DocumentExtractionError);
  return error;
}

const bytes = new Uint8Array([1, 2, 3, 4]);

if (mode === "missing") {
  await assert.rejects(createDocumentExtractor(), (error: unknown) => {
    const extraction = extractionError(error);
    assert.equal(extraction.reason, "missingPeer");
    assert.equal(extraction.message.includes("secret"), false);
    return true;
  });
  console.log("ok");
  process.exit(0);
}

const extractor = await createDocumentExtractor();
const before = calls;
await assert.rejects(extractor.extract({ bytes, signal: AbortSignal.abort() }), /aborted|AbortError/i);
assert.equal(calls, before, "aborted before native work");

behavior = "needsOcr";
await assert.rejects(extractor.extract({ bytes }), (error: unknown) => {
  assert.ok(error instanceof NeedsOcrError);
  const needsOcr = error as { pages: readonly number[]; pageCount: number; message: string };
  assert.deepEqual(needsOcr.pages, [3]);
  assert.equal(needsOcr.pageCount, 3);
  assert.equal(needsOcr.message.includes("secret"), false);
  return true;
});

for (const code of ["encrypted", "malformed", "resourceLimit", "missingPart", "io", "hosted", "hunter2"]) {
  behavior = code;
  await assert.rejects(extractor.extract({ bytes }), (error: unknown) => {
    const extraction = extractionError(error);
    assert.equal(extraction instanceof NeedsOcrError, false);
    assert.equal(extraction.reason, code === "hunter2" ? "io" : code);
    assert.equal(extraction.message.includes("secret"), false);
    assert.equal(extraction.message.includes("hunter2"), false);
    return true;
  });
}

let release!: () => void;
gate = new Promise((resolve) => {
  release = resolve;
});
behavior = "ok";
const callsAtHang = calls;
const first = extractor.extract({ bytes });
while (calls === callsAtHang) await Promise.resolve();
const ac = new AbortController();
const second = extractor.extract({ bytes, signal: ac.signal });
await assert.rejects(extractor.extract({ bytes }), (error: unknown) => {
  assert.equal(extractionError(error).reason, "busy");
  return true;
});
ac.abort();
await assert.rejects(second, /aborted|AbortError/i);
release();
const result = await first;
assert.equal(result.ocrUsed, false);
assert.equal(result.markdown, "LEAK secret markdown");
console.log("ok");
