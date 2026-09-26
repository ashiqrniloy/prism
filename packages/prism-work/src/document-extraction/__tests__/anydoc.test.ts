import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";
import { createDocumentExtractor, DocumentExtractionError, HARD_MAX_EXTRACTION_BYTES, NeedsOcrError } from "../index.js";

const read = (url: URL) => readFile(url);
const fixture = (name: string) => new URL(`../../../src/document-extraction/__tests__/fixtures/${name}`, import.meta.url);
const readerFixture = (name: string) => new URL(`../../../src/document-reader/__tests__/fixtures/${name}`, import.meta.url);
const workFile = (rel: string) => new URL(`../../../${rel}`, import.meta.url);

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), code });
    });
  });
}

const PEER_OK = await (async () => {
  try {
    await import("@firecrawl/anydoc");
    return true;
  } catch {
    return false;
  }
})();

test("caps fail closed at creation", async () => {
  await assert.rejects(createDocumentExtractor({ maxBytes: 0 }), RangeError);
  await assert.rejects(createDocumentExtractor({ maxBytes: HARD_MAX_EXTRACTION_BYTES + 1 }), RangeError);
  await assert.rejects(createDocumentExtractor({ maxTextBytes: 1.5 }), RangeError);
});

function resolveOwn(name: string): URL {
  const ts = new URL(`../${name}.ts`, import.meta.url);
  return existsSync(ts) ? ts : new URL(`../${name}.js`, import.meta.url);
}

test("sibling subpaths do not import anydoc", async () => {
  const own = await readFile(resolveOwn("index"), "utf8");
  assert.doesNotMatch(own, /^import\s+.*@firecrawl\/anydoc/m);
  assert.doesNotMatch(own, /process\.env|child_process|Bun\.spawn/);
  assert.doesNotMatch(own, /toMarkdownBytes\(\s*[^,\n]+,\s*[^,\n]+,/);
  for (const rel of ["documents/index", "connectors/index", "document-reader/index", "sheets/index"]) {
    const js = new URL(`../../${rel}.js`, import.meta.url);
    const ts = new URL(`../../../src/${rel}.ts`, import.meta.url);
    const text = await readFile(existsSync(js) ? js : ts, "utf8");
    assert.equal(text.includes("@firecrawl/anydoc"), false, rel);
  }
});

test("missing peer and error map stay content-free", async () => {
  const probeTs = new URL("./slot-probe.ts", import.meta.url);
  const probe = existsSync(probeTs) ? probeTs : new URL("./slot-probe.js", import.meta.url);
  const index = resolveOwn("index");
  for (const mode of ["missing", "policy"]) {
    const { stdout, stderr, code } = await run(process.execPath, [probe.pathname, index.pathname, mode]);
    assert.equal(code, 0, `${mode}\n${stdout}\n${stderr}`);
    assert.match(stdout, /ok/);
  }
});

test.skipIf(!PEER_OK)("real fixtures preserve text", async () => {
  const extractor = await createDocumentExtractor();
  const cases: Array<{ file: URL; filename?: string; format: string; includes: string[] }> = [
    { file: readerFixture("sample.docx"), format: "docx", includes: ["Hello Prism DOCX"] },
    { file: readerFixture("sample.pdf"), format: "pdf", includes: ["Hello Prism PDF page 1", "Hello Prism PDF page 2"] },
    { file: workFile("golden/golden.pptx"), format: "pptx", includes: ["Prism Agent Framework", "Key Platform Pillars"] },
    { file: workFile("golden/golden.xlsx"), format: "xlsx", includes: ["Operating Budget", "Engineering"] },
    {
      file: workFile("fixtures/dialects/comma.csv"),
      filename: "comma.csv",
      format: "csv",
      includes: ["| id | count | enabled | score |", "false"],
    },
    { file: fixture("hello.odt"), format: "odt", includes: ["Hello Prism ODT"] },
  ];
  for (const item of cases) {
    const result = await extractor.extract({ bytes: await read(item.file), filename: item.filename });
    assert.equal(result.format, item.format);
    assert.equal(result.ocrUsed, false);
    assert.equal("pages" in result, false);
    for (const needle of item.includes) assert.match(result.markdown, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const pdf = await read(readerFixture("sample.pdf"));
  const signed = await extractor.extract({ bytes: pdf, filename: "/no/such/notes.csv" });
  assert.equal(signed.format, "pdf");
  assert.match(signed.markdown, /Hello Prism PDF page 1/);

  await assert.rejects(extractor.extract({ bytes: await read(workFile("fixtures/dialects/comma.csv")) }), (error: unknown) => {
    assert.ok(error instanceof DocumentExtractionError);
    assert.equal(error.reason, "unsupported");
    return true;
  });
  const csv = await extractor.extract({
    bytes: await read(workFile("fixtures/dialects/comma.csv")),
    filename: "/no/such/dir/NOTES.CSV",
  });
  assert.equal(csv.format, "csv");

  await assert.rejects(extractor.extract({ bytes: await read(readerFixture("junk.bin")), filename: "junk.bin" }), (error: unknown) => {
    assert.ok(error instanceof DocumentExtractionError);
    assert.equal(error.reason, "unsupported");
    assert.equal(error instanceof NeedsOcrError, false);
    return true;
  });
  await assert.rejects(extractor.extract({ bytes: new Uint8Array(Buffer.from("%PDF-1.4\n")) }), (error: unknown) => {
    assert.ok(error instanceof DocumentExtractionError);
    assert.equal(error.reason, "malformed");
    assert.equal(error.message.includes("%PDF"), false);
    return true;
  });

  await assert.rejects(extractor.extract({ bytes: await read(fixture("scan.pdf")) }), (error: unknown) => {
    assert.ok(error instanceof NeedsOcrError);
    assert.deepEqual(error.pages, [1]);
    assert.equal(error.pageCount, 1);
    return true;
  });
  await assert.rejects(extractor.extract({ bytes: await read(fixture("mixed.pdf")) }), (error: unknown) => {
    assert.ok(error instanceof NeedsOcrError);
    assert.deepEqual(error.pages, [3]);
    assert.equal(error.pageCount, 3);
    return true;
  });
});

test.skipIf(!PEER_OK)("input and output caps refuse without returning text", async () => {
  const extractor = await createDocumentExtractor({ maxBytes: 8, maxTextBytes: 4 });
  await assert.rejects(extractor.extract({ bytes: await read(readerFixture("sample.pdf")) }), (error: unknown) => {
    assert.ok(error instanceof DocumentExtractionError);
    assert.equal(error.reason, "inputLimit");
    return true;
  });
  const tiny = await createDocumentExtractor({ maxTextBytes: 4 });
  await assert.rejects(tiny.extract({ bytes: await read(readerFixture("sample.docx")) }), (error: unknown) => {
    assert.ok(error instanceof DocumentExtractionError);
    assert.equal(error.reason, "outputLimit");
    return true;
  });
});

test.skipIf(!PEER_OK)("small text PDF stays inside the Task 1 envelope", async () => {
  // ponytail: isolated process so the suite RSS does not hide a regression.
  // Ceiling is the Task 1 gate (500 ms, 128 MiB), not the 2 ms / 62 MiB measurement.
  const index = resolveOwn("index");
  const pdf = readerFixture("sample.pdf");
  const script = `
    import { readFileSync } from "node:fs";
    const { createDocumentExtractor } = await import(${JSON.stringify(index.pathname)});
    const bytes = readFileSync(${JSON.stringify(pdf.pathname)});
    const started = performance.now();
    const extractor = await createDocumentExtractor();
    const result = await extractor.extract({ bytes, filename: "sample.pdf" });
    const status = readFileSync("/proc/self/status", "utf8");
    const hwm = Number(status.match(/VmHWM:\\s+(\\d+)/)[1]);
    console.log(JSON.stringify({ ms: performance.now() - started, hwm, format: result.format }));
  `;
  const { stdout, stderr, code } = await run(process.execPath, ["-e", script]);
  assert.equal(code, 0, stderr);
  const measured = JSON.parse(stdout) as { ms: number; hwm: number; format: string };
  assert.equal(measured.format, "pdf");
  const ceiling = process.env.NODE_V8_COVERAGE ? 5_000 : 500;
  assert.ok(measured.ms < ceiling, `elapsed ${measured.ms}ms`);
  assert.ok(measured.hwm < 128 * 1024, `VmHWM ${measured.hwm} KiB`);
});
