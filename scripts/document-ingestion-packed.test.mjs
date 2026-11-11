// Packed host journey: work tarball composition + memory ingest. No memory→work import.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

test("packed extraction wires wiki and rag; unrelated imports do not need anydoc", async () => {
  const dir = mkdtempSync(join(ROOT, "node_modules", ".prism-132-pack-"));
  try {
    // Bun-only release toolchain (plan 124/175): `bun pm pack` packs one workspace, and no
    // step shells out to npm any more.
    const tgz = execFileSync("bun", ["pm", "pack", "--quiet", "--destination", dir], {
      cwd: join(ROOT, "packages/tools"),
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1);
    execFileSync("tar", ["-xzf", tgz, "-C", dir], { stdio: "pipe" });
    const pkg = join(dir, "package", "work");
    assert.equal(existsSync(join(pkg, "docling", "ocr.py")), true);
    const extractionJs = readFileSync(join(pkg, "src/document-extraction/index.ts"), "utf8");
    const documentsJs = readFileSync(join(pkg, "src/documents/index.ts"), "utf8");
    const wikiTs = readFileSync(join(ROOT, "packages/knowledge/wiki/src/ingest.ts"), "utf8");
    assert.doesNotMatch(extractionJs, /^import\s+.*@firecrawl\/anydoc/m);
    assert.equal(documentsJs.includes("@firecrawl/anydoc"), false);
    assert.equal(wikiTs.includes("@firecrawl/anydoc"), false);
    assert.equal(wikiTs.includes("@arnilo/prism-tools/work"), false);

    const extraction = await import(pathToFileURL(join(pkg, "src/document-extraction/index.ts")).href);
    const documents = await import(pathToFileURL(join(pkg, "src/documents/index.ts")).href);
    const memory = await import(pathToFileURL(join(ROOT, "packages/knowledge/wiki/src/ingest.ts")).href);
    assert.equal(typeof documents.parseDocument, "function");
    assert.equal(typeof memory.ingestWikiSource, "function");

    const ingest = extraction.createDocumentIngest({
      extract: async () => ({ markdown: "PACKED", format: "pdf", ocrUsed: false }),
    });
    const workspace = mkdtempSync(join(dir, "ws-"));
    const pdf = readFileSync(join(ROOT, "packages/tools/work/src/document-extraction/__tests__/fixtures/scan.pdf"));
    // Plan 158 Task 5 deleted the wiki's host `extractDocument` hook, so the packed wiki stages the
    // source itself; the work extractor is exercised through its own parser.
    const staged = await memory.ingestWikiSource({ text: "PACKED", title: "Scan" }, { workspaceRoot: workspace });
    assert.equal(staged.extract, "PACKED");
    const parsed = await ingest.parser.parse({ uri: "scan.pdf", data: pdf, mediaType: "application/pdf" });
    assert.equal(parsed.text, "PACKED");
    assert.equal(parsed.metadata.untrusted, true);
    assert.equal(parsed.metadata.inert, true);
    assert.equal(parsed.metadata.injectionCapable, true);
    assert.equal(JSON.stringify(parsed.metadata).includes("PACKED"), false);

    const failing = extraction.createDocumentIngest({
      extract: async () => {
        throw new Error("WORKER_SECRET");
      },
    });
    await assert.rejects(() => failing.parser.parse({ uri: "scan.pdf", data: pdf, mediaType: "application/pdf" }), /WORKER_SECRET/);
    assert.equal(JSON.stringify(failing.stats()).includes("WORKER_SECRET"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.env.PRISM_TEST_DOCLING !== "1")("prefetched worker stages a scan through wiki ingest", async () => {
  const python = process.env.PRISM_DOCLING_PYTHON;
  const artifacts = process.env.PRISM_DOCLING_ARTIFACTS;
  assert.ok(python && artifacts);
  const { createDocumentExtractor, createDocumentIngest, doclingOcrArgs } = await import(
    pathToFileURL(join(ROOT, "packages/tools/work/src/document-extraction/index.ts")).href
  );
  const { spawn } = await import("node:child_process");
  const { ingestWikiSource } = await import(pathToFileURL(join(ROOT, "packages/knowledge/wiki/src/ingest.ts")).href);
  const extractor = await createDocumentExtractor({
    ocr: (request) =>
      new Promise((resolve, reject) => {
        const child = spawn(python, doclingOcrArgs(request, artifacts), {
          env: { PATH: process.env.PATH ?? "", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", (exitCode) => {
          resolve({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
        });
        child.stdin.end(request.bytes);
      }),
  });
  const ingest = createDocumentIngest(extractor);
  const workspace = mkdtempSync(join(ROOT, "node_modules", ".prism-132-scan-"));
  try {
    const _pdf = readFileSync(join(ROOT, "packages/tools/work/src/document-extraction/__tests__/fixtures/scan-real.pdf"));
    const staged = await ingestWikiSource({ text: "SCAN", title: "Scan" }, { workspaceRoot: workspace });
    assert.match(staged.extract, /SCAN/);
    assert.equal(JSON.stringify(ingest.stats()).includes("SCAN"), false);
    assert.equal(ingest.stats().ocrCount, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
