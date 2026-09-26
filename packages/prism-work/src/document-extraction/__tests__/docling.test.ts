import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";
import {
  createDocumentExtractor,
  doclingOcrArgs,
  doclingOcrHelperPath,
  DocumentExtractionError,
  HARD_MAX_OCR_PAGES,
  NeedsOcrError,
  type OcrRunner,
  type OcrWorkerResult,
} from "../index.js";

const fixture = (name: string) => new URL(`../../../src/document-extraction/__tests__/fixtures/${name}`, import.meta.url);
const samplePdf = new URL("../../../src/document-reader/__tests__/fixtures/sample.pdf", import.meta.url);
const read = (url: URL) => readFile(url);
const LEAK = "LEAK132";

const PEER_OK = await (async () => {
  try {
    await import("@firecrawl/anydoc");
    return true;
  } catch {
    return false;
  }
})();

function worker(body: string, extra: Partial<OcrWorkerResult> = {}): OcrWorkerResult {
  return { exitCode: extra.exitCode ?? 0, stdout: Buffer.from(body), stderr: extra.stderr ?? Buffer.alloc(0), ...extra };
}

function ok(markdown: string, pages = 1): OcrWorkerResult {
  return worker(JSON.stringify({ ok: true, markdown, pages }));
}

function counting(result: OcrWorkerResult | ((calls: number) => Promise<OcrWorkerResult>)): { runner: OcrRunner; calls: () => number } {
  let calls = 0;
  const runner: OcrRunner = async (request) => {
    calls += 1;
    assert.equal(request.helperPath, doclingOcrHelperPath);
    return typeof result === "function" ? result(calls) : result;
  };
  return { runner, calls: () => calls };
}

test("ocr caps and artifact args fail closed", () => {
  assert.equal(doclingOcrHelperPath.endsWith(`${"/docling/ocr.py"}`), true);
  assert.equal(existsSync(doclingOcrHelperPath), true);
  assert.throws(() => doclingOcrArgs(request(), "https://models.example/artifacts"), DocumentExtractionError);
  assert.throws(() => doclingOcrArgs(request(), "file:///tmp/models"), DocumentExtractionError);
  const args = doclingOcrArgs(request(), "/opt/docling/models");
  assert.equal(args.includes(LEAK), false);
  assert.equal(args.includes("--format"), true);
  assert.equal(args.filter((arg) => arg === "pdf").length, 1);
});

test("helper refuses a URL, a missing model dir, and oversized stdin", async () => {
  const python = await pythonBin();
  if (!python) return;
  const url = await helper(
    python,
    [
      doclingOcrHelperPath,
      "--format",
      "pdf",
      "--max-pages",
      "1",
      "--max-bytes",
      "8",
      "--max-text-bytes",
      "8",
      "--timeout-s",
      "1",
      "--artifacts",
      "https://evil.example/m",
    ],
    Buffer.from("SECRET"),
  );
  assert.equal(url.code, 1);
  assert.equal(JSON.parse(url.stdout).error, "unsupported");
  assert.equal(url.stdout.includes("SECRET"), false);
  const missing = await helper(
    python,
    [
      doclingOcrHelperPath,
      "--format",
      "pdf",
      "--max-pages",
      "1",
      "--max-bytes",
      "8",
      "--max-text-bytes",
      "8",
      "--timeout-s",
      "1",
      "--artifacts",
      "/tmp/prism-132-no-such-models",
    ],
    Buffer.from("abcd"),
  );
  assert.equal(JSON.parse(missing.stdout).error, "missing_models");
  assert.equal(missing.stdout.includes("abcd"), false);
  const over = await helper(
    python,
    [
      doclingOcrHelperPath,
      "--format",
      "png",
      "--max-pages",
      "1",
      "--max-bytes",
      "4",
      "--max-text-bytes",
      "8",
      "--timeout-s",
      "1",
      "--artifacts",
      "/tmp",
    ],
    Buffer.from("SECRET"),
  );
  assert.equal(JSON.parse(over.stdout).error, "input_limit");
  assert.equal(over.stdout.includes("SECRET"), false);
});

test("helper source stays offline and local", async () => {
  const source = await readFile(doclingOcrHelperPath, "utf8");
  assert.match(source, /enable_remote_services=False/);
  assert.match(source, /allow_external_plugins=False/);
  assert.match(source, /RapidOcrOptions\(backend="torch"\)/);
  assert.match(source, /HF_HUB_OFFLINE/);
  assert.match(source, /raises_on_error=False/);
  assert.match(source, /ConversionStatus.SUCCESS/);
  assert.match(source, /DocumentStream\(/);
  assert.doesNotMatch(source, /download_models|enable_remote_services=True|ocr:\s*["']hosted["']/);
});

test("bad ocr options fail at creation", async () => {
  await assert.rejects(createDocumentExtractor({ maxPages: 0 }), RangeError);
  await assert.rejects(createDocumentExtractor({ maxPages: HARD_MAX_OCR_PAGES + 1 }), RangeError);
  await assert.rejects(createDocumentExtractor({ ocr: "nope" as unknown as OcrRunner }), TypeError);
});

test.skipIf(!PEER_OK)("runner stays idle unless a PDF needs OCR or image OCR is explicit", async () => {
  const idle = counting(ok("NO"));
  const extractor = await createDocumentExtractor({ ocr: idle.runner });
  const text = await extractor.extract({ bytes: await read(samplePdf), ocr: true });
  assert.equal(text.ocrUsed, false);
  assert.equal(text.pages, undefined);
  const malformed = Buffer.from("%PDF-1.4\nnot a pdf");
  await assert.rejects(extractor.extract({ bytes: malformed }), (error: unknown) => {
    assert.equal(error instanceof NeedsOcrError, false);
    assert.equal((error as DocumentExtractionError).reason, "malformed");
    return true;
  });
  const png = await read(fixture("scan.png"));
  await assert.rejects(extractor.extract({ bytes: png }), (error: unknown) => {
    assert.equal((error as DocumentExtractionError).reason, "unsupported");
    return true;
  });
  assert.equal(idle.calls(), 0);

  const scan = counting(ok("SCAN", 1));
  const scanned = await createDocumentExtractor({ ocr: scan.runner });
  const result = await scanned.extract({ bytes: await read(fixture("scan.pdf")) });
  assert.equal(result.ocrUsed, true);
  assert.equal(result.markdown, "SCAN");
  assert.equal(result.pages, 1);
  assert.equal(result.format, "pdf");
  const mixed = await scanned.extract({ bytes: await read(fixture("mixed.pdf")) });
  assert.equal(mixed.ocrUsed, true);
  assert.equal(scan.calls(), 2);

  const image = await scanned.extract({ bytes: png, ocr: true });
  assert.equal(image.format, "png");
  assert.equal(image.ocrUsed, true);
  assert.equal(scan.calls(), 3);

  const capped = counting(ok("NO"));
  const tight = await createDocumentExtractor({ ocr: capped.runner, maxPages: 1 });
  await assert.rejects(tight.extract({ bytes: await read(fixture("mixed.pdf")) }), (error: unknown) => {
    assert.equal((error as DocumentExtractionError).reason, "resourceLimit");
    assert.equal((error as Error).message.includes(LEAK), false);
    return true;
  });
  assert.equal(capped.calls(), 0);

  await assert.rejects(
    createDocumentExtractor().then((plain) => plain.extract({ bytes: png, ocr: true })),
    NeedsOcrError,
  );
});

test.skipIf(!PEER_OK)("failed OCR returns no partial text", async () => {
  const cases: { name: string; result: OcrWorkerResult | "abort"; reason: string }[] = [
    {
      name: "timeout",
      result: worker(JSON.stringify({ ok: true, markdown: LEAK, pages: 1 }), { timedOut: true, exitCode: null }),
      reason: "resourceLimit",
    },
    { name: "stdout", result: worker("x".repeat(80_000)), reason: "outputLimit" },
    {
      name: "stderr",
      result: worker(JSON.stringify({ ok: true, markdown: LEAK, pages: 1 }), {
        stderr: Buffer.from("SECRET-STDERR"),
        stderrTruncated: true,
      }),
      reason: "io",
    },
    { name: "exit", result: worker(JSON.stringify({ ok: true, markdown: LEAK, pages: 1 }), { exitCode: 1 }), reason: "io" },
    { name: "json", result: worker("{"), reason: "io" },
    {
      name: "models",
      result: worker(JSON.stringify({ ok: false, error: "missing_models", markdown: LEAK }), { exitCode: 1 }),
      reason: "io",
    },
    { name: "partial", result: worker(JSON.stringify({ ok: false, error: "partial", markdown: LEAK }), { exitCode: 1 }), reason: "io" },
    { name: "pages", result: worker(JSON.stringify({ ok: false, error: "over_page" }), { exitCode: 1 }), reason: "resourceLimit" },
    { name: "empty-fail", result: worker(JSON.stringify({ ok: true, markdown: LEAK, pages: 0 })), reason: "io" },
  ];
  const scan = await read(fixture("scan.pdf"));
  for (const item of cases) {
    const runner: OcrRunner = async () => {
      if (item.result === "abort") throw new DOMException("aborted", "AbortError");
      return item.result;
    };
    const extractor = await createDocumentExtractor({ ocr: runner, maxStderrBytes: 64, maxTextBytes: 64 });
    await assert.rejects(extractor.extract({ bytes: scan }), (error: unknown) => {
      const extraction = error as DocumentExtractionError;
      assert.equal(extraction.reason, item.reason, item.name);
      assert.equal(extraction.message.includes(LEAK), false, item.name);
      assert.equal(extraction.message.includes("SECRET"), false, item.name);
      return true;
    });
  }
  let sawSignal = false;
  const aborted = await createDocumentExtractor({
    ocr: async (request) => {
      sawSignal = request.signal !== undefined;
      return worker(JSON.stringify({ ok: true, markdown: LEAK, pages: 1 }), { aborted: true });
    },
  });
  await assert.rejects(aborted.extract({ bytes: scan, signal: new AbortController().signal }), /abort/i);
  assert.equal(sawSignal, true);

  const empty = await createDocumentExtractor({ ocr: async () => ok("", 1) });
  const blank = await empty.extract({ bytes: scan });
  assert.equal(blank.markdown, "");
  assert.equal(blank.ocrUsed, true);
  assert.equal(blank.pages, 1);
});

test.skipIf(!PEER_OK)("one OCR job in flight, third call is busy", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const extractor = await createDocumentExtractor({
    ocr: async () => {
      entered += 1;
      await gate;
      return ok("SCAN");
    },
  });
  const scan = await read(fixture("scan.pdf"));
  const first = extractor.extract({ bytes: scan });
  while (entered < 1) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = extractor.extract({ bytes: scan });
  await assert.rejects(extractor.extract({ bytes: scan }), (error: unknown) => {
    assert.equal((error as DocumentExtractionError).reason, "busy");
    return true;
  });
  release();
  assert.equal((await first).markdown, "SCAN");
  assert.equal((await second).markdown, "SCAN");
});

test.skipIf(process.env.PRISM_TEST_DOCLING !== "1")("offline helper converts a scan without network", async () => {
  const python = process.env.PRISM_DOCLING_PYTHON;
  const artifacts = process.env.PRISM_DOCLING_ARTIFACTS;
  assert.ok(python && artifacts, "PRISM_DOCLING_PYTHON and PRISM_DOCLING_ARTIFACTS");
  const bytes = await read(fixture("scan-real.pdf"));
  const extractor = await createDocumentExtractor({
    ocr: async (request) => {
      const result = await spawnHelper(python, doclingOcrArgs(request, artifacts), request);
      assert.doesNotMatch(Buffer.from(result.stderr).toString(), /https?:\/\/|FIRECRAWL|Downloading/);
      return result;
    },
  });
  const result = await extractor.extract({ bytes });
  assert.equal(result.ocrUsed, true);
  assert.match(result.markdown, /SCAN/);
  assert.equal(result.pages, 1);
});

function request() {
  return {
    bytes: Buffer.from(LEAK),
    format: "pdf" as const,
    maxPages: 1,
    maxBytes: 8,
    maxTextBytes: 8,
    timeoutMs: 1000,
    maxStderrBytes: 64,
    helperPath: doclingOcrHelperPath,
  };
}

function pythonBin(): Promise<string | null> {
  const bin = process.env.PRISM_DOCLING_PYTHON ?? "python3";
  return helper(bin, ["-c", "print(1)"], Buffer.alloc(0)).then(
    () => bin,
    () => null,
  );
}

function helper(cmd: string, args: string[], stdin: Buffer): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), code });
    });
    child.stdin.end(stdin);
  });
}

function spawnHelper(
  python: string,
  args: string[],
  request: { bytes: Uint8Array; signal?: AbortSignal; maxStderrBytes: number },
): Promise<OcrWorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;
    const kill = () => child.kill("SIGKILL");
    request.signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > request.maxStderrBytes) {
        stderrTruncated = true;
        kill();
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      request.signal?.removeEventListener("abort", kill);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        aborted: request.signal?.aborted,
        stderrTruncated,
      });
    });
    child.stdin.end(request.bytes);
  });
}
