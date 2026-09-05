import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReadTool, type DocumentReader } from "../../agent/index.js";
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

async function withCwd(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "prism-docreader-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function callRead(
  readTool: ReturnType<typeof createReadTool>,
  params: Record<string, unknown>,
): Promise<{ content: string; metadata?: Record<string, unknown>; error?: { message: string } }> {
  return readTool.execute(params as never, {
    sessionId: "s",
    runId: "r",
    toolCallId: "t1",
  }) as unknown as Promise<{ content: string; metadata?: Record<string, unknown>; error?: { message: string } }>;
}

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

test("read tool: input size cap refuses before loading; metadata carries the document shape", { skip: !PEERS_OK }, async () => {
  await withCwd(async (cwd) => {
    const big = Buffer.alloc(2048, 0x61);
    await writeFile(join(cwd, "big.pdf"), big);
    const reader = await createDocumentReader({ maxBytes: 1024 });
    const readTool = createReadTool(cwd, { documentReader: reader });
    const result = await callRead(readTool, { path: "big.pdf" });
    assert.ok(result.error, "oversize document refuses");
    assert.match(result.error!.message, /exceeds .* limit/);
  });
});

test("read tool: full extraction path returns text content and document metadata", { skip: !PEERS_OK }, async () => {
  await withCwd(async (cwd) => {
    await writeFile(join(cwd, "sample.pdf"), await read("sample.pdf"));
    const reader = await createDocumentReader({});
    const readTool = createReadTool(cwd, { documentReader: reader });
    const result = await callRead(readTool, { path: "sample.pdf" });
    assert.ok(!result.error);
    const text = (result.content as unknown as { text: string }[])[0].text;
    assert.match(text, /Hello Prism PDF page 1/);
    const document = result.metadata?.document as { format: string; pages: number };
    assert.equal(document.format, "pdf");
    assert.equal(document.pages, 2);
  });
});

test("read tool: unsupported file falls through to the text path (no parsing by default)", { skip: !PEERS_OK }, async () => {
  await withCwd(async (cwd) => {
    await writeFile(join(cwd, "junk.bin"), await read("junk.bin"));
    const reader = await createDocumentReader({});
    const readTool = createReadTool(cwd, { documentReader: reader });
    const result = await callRead(readTool, { path: "junk.bin" });
    assert.ok(!result.error, "no error for unsupported buffers");
    assert.ok(!result.metadata?.document, "no document metadata");
  });
});

test("read tool: a reader returning text beyond maxTextBytes is refused by the tool", async () => {
  await withCwd(async (cwd) => {
    await writeFile(join(cwd, "x.bin"), Buffer.from("abc"));
    const oversized: DocumentReader = {
      maxInputBytes: 1024,
      maxTextBytes: 16,
      extract: async () => ({ text: "y".repeat(64), format: "fake", pages: 1, truncatedBy: null }),
    };
    const readTool = createReadTool(cwd, { documentReader: oversized });
    const result = await callRead(readTool, { path: "x.bin" });
    assert.match(result.error?.message ?? "", /beyond its maxTextBytes cap/);
  });
});

test("envelope: a max-page document completes within the recorded budget or refuses", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({ maxPages: envelope.maxPagesBaseline });
  const started = performance.now();
  const result = await reader.extract({ buffer: await read("thousand-page.pdf"), path: "t.pdf" });
  const elapsed = performance.now() - started;
  assert.equal(result?.pages, envelope.maxPagesBaseline);
  assert.ok(elapsed <= envelope.extractMsCeiling, `extract ${elapsed.toFixed(0)}ms exceeds ${envelope.extractMsCeiling}ms ceiling`);
});

test("fuzz: a %PDF- magic buffer with a malformed body rejects promptly, never hangs", { skip: !PEERS_OK }, async () => {
  const reader = await createDocumentReader({ maxPages: 10 });
  // valid magic header followed by 256KiB of non-PDF garbage — passes detect(), must fail parse.
  const sizeable = Buffer.concat([Buffer.from("%PDF-1.7", "latin1"), Buffer.alloc(256 * 1024, 0x42)]);
  const started = performance.now();
  await assert.rejects(reader.extract({ buffer: sizeable, path: "broken.pdf" }));
  assert.ok(performance.now() - started < envelope.extractMsCeiling, "malformed parse must fail within the same ceiling");
});
