import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createDocumentReader, DocumentReaderError, HARD_MAX_DOCUMENT_PAGES } from "../index.js";

const FIXTURES = new URL("../../../src/document-reader/__tests__/fixtures/", import.meta.url);
const read = (name: string) => readFile(new URL(name, FIXTURES));

/** Whether the optional peers resolved at import time (they are devDeps here; CI parity guard). */
const PEERS_OK = await (async () => {
  try {
    await import("pdf-parse");
    await import("mammoth");
    return true;
  } catch {
    return false;
  }
})();

const envelope = JSON.parse((await readFile(new URL("../../../../../scripts/budgets.json", import.meta.url))).toString()).docReader;
// ponytail: the envelope is a hang/regex-blowup sanity bound, not a benchmark. V8
// coverage instrumentation inflates the pdf-parse path ~20x (162ms idle vs a 3441ms
// measurement under --experimental-test-coverage on a loaded host), which turned the
// coverage gate flaky. Scale the ceiling when instrumented; 20s still catches a hang.
const extractMsCeiling = process.env.NODE_V8_COVERAGE ? envelope.extractMsCeiling * 10 : envelope.extractMsCeiling;

test("D1: creation fails closed with a documented error when no parser is available", async () => {
  await assert.rejects(createDocumentReader({ parsers: [] }), (error: unknown) => {
    assert.ok(error instanceof DocumentReaderError);
    assert.equal(error.code, "ERR_PRISM_DOCUMENT_READER");
    assert.match(error.message, /at least one parser/);
    return true;
  });
  // caps are validated at creation
  await assert.rejects(createDocumentReader({ maxBytes: 0 }), RangeError);
  await assert.rejects(createDocumentReader({ maxPages: HARD_MAX_DOCUMENT_PAGES + 1 }), RangeError);
  await assert.rejects(createDocumentReader({ maxTextBytes: -1 }), RangeError);
});

test("extraction: known fixtures yield expected literal text", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({});
  const pdf = await reader.extract({ buffer: await read("sample.pdf"), path: "sample.pdf" });
  assert.equal(pdf?.format, "pdf");
  assert.equal(pdf?.pages, 2);
  assert.match(pdf!.text, /Hello Prism PDF page 1/);
  assert.match(pdf!.text, /Hello Prism PDF page 2/);
  const docx = await reader.extract({ buffer: await read("sample.docx"), path: "sample.docx" });
  assert.equal(docx?.format, "docx");
  assert.equal(docx?.pages, 1);
  assert.equal(docx?.text.trim(), "Hello Prism DOCX");
});

test("D5: unsupported buffers return null (read falls through to the text path)", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({});
  assert.equal(await reader.extract({ buffer: await read("not-a-docx.zip"), path: "z.zip" }), null);
  assert.equal(await reader.extract({ buffer: await read("junk.bin"), path: "j.bin" }), null);
});

test("bounds: over-page documents refuse with the size error; over-text results truncate", { skip: !PEERS_OK }, async () => {
  const capped = await createDocumentReader({ maxPages: 3 });
  await assert.rejects(capped.extract({ buffer: await read("five-page.pdf"), path: "p.pdf" }), (error: unknown) => {
    assert.ok(error instanceof DocumentReaderError);
    assert.match(error.message, /has 5 pages, exceeds maxPages cap \(3\)/);
    return true;
  });
  const tiny = await createDocumentReader({ maxTextBytes: 16 });
  const result = await tiny.extract({ buffer: await read("sample.pdf"), path: "p.pdf" });
  assert.equal(result?.truncatedBy, "bytes");
  assert.ok(Buffer.byteLength(result!.text, "utf8") <= 16);
});

test("D4: no external resource fetching — linked-image docx extracts text, adapter has no fetch call sites", {
  skip: !PEERS_OK,
}, async () => {
  const reader = await createDocumentReader({});
  const result = await reader.extract({ buffer: await read("linked-image.docx"), path: "linked.docx" });
  assert.equal(result?.text.trim(), "Linked doc body", "literal text extracted, external image never dereferenced");
  // Egress tripwire: the adapter surface must not contain fetch call sites (repo network-free guard).
  const dist = (await readFile(new URL("../index.js", import.meta.url))).toString();
  assert.doesNotMatch(dist, /\bfetch\s*\(/, "adapter must not contain fetch call sites");
});

test("D6: extracted text passes through the redaction boundary", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({
    redactor: { redact: <T>(value: T): T => String(value).replaceAll("Prism", "[REDACTED]") as T },
  });
  const result = await reader.extract({ buffer: await read("sample.pdf"), path: "sample.pdf" });
  assert.ok(!result!.text.includes("Prism"));
  assert.match(result!.text, /Hello \[REDACTED\] PDF page 1/);
});

test("D7: a parser returning text beyond maxTextBytes is refused by the adapter", async () => {
  const reader = await createDocumentReader({
    parsers: [
      {
        format: "fake",
        detect: () => true,
        extract: async () => ({ text: "x".repeat(4096), pages: 1, truncatedBy: null }),
      },
    ],
    maxTextBytes: 1024,
  });
  await assert.rejects(reader.extract({ buffer: Buffer.from("anything"), path: "f" }), (error: unknown) => {
    assert.ok(error instanceof DocumentReaderError);
    assert.match(error.message, /beyond the maxTextBytes cap/);
    return true;
  });
});

test("envelope: a max-page document completes within the recorded budget or refuses", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({ maxPages: envelope.maxPagesBaseline });
  const once = async () => {
    const started = performance.now();
    const result = await reader.extract({ buffer: await read("thousand-page.pdf"), path: "t.pdf" });
    return { result, elapsed: performance.now() - started };
  };
  // ponytail: one retry. 2000ms is a hang bound; suite contention hit 2471ms once. Raise the budget if CI still misses.
  let timed = await once();
  if (timed.elapsed > extractMsCeiling) timed = await once();
  assert.equal(timed.result?.pages, envelope.maxPagesBaseline);
  assert.ok(timed.elapsed <= extractMsCeiling, `extract ${timed.elapsed.toFixed(0)}ms exceeds ${extractMsCeiling}ms ceiling`);
});

test("fuzz: a %PDF- magic buffer with a malformed body rejects promptly, never hangs", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({ maxPages: 10 });
  // valid magic header followed by 256KiB of non-PDF garbage — passes detect(), must fail parse.
  const sizeable = Buffer.concat([Buffer.from("%PDF-1.7", "latin1"), Buffer.alloc(256 * 1024, 0x42)]);
  const started = performance.now();
  await assert.rejects(reader.extract({ buffer: sizeable, path: "broken.pdf" }));
  assert.ok(performance.now() - started < extractMsCeiling, "malformed parse must fail within the same ceiling");
});
