// Packed host journey: work tarball composition + memory ingest. No memory→work import.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

test("packed extraction wires wiki and rag; unrelated imports do not need anydoc", async () => {
  const dir = mkdtempSync(join(ROOT, "node_modules", ".prism-132-pack-"));
  try {
    // release-host registry toolchain — runner images ship Node; contributors never invoke npm
    const tgz = execFileSync("npm", ["pack", "-w", "@arnilo/prism-work", "--pack-destination", dir], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1);
    execFileSync("tar", ["-xzf", join(dir, tgz), "-C", dir], { stdio: "pipe" });
    const pkg = join(dir, "package");
    assert.equal(existsSync(join(pkg, "docling", "ocr.py")), true);
    const extractionJs = readFileSync(join(pkg, "dist/document-extraction/index.js"), "utf8");
    const documentsJs = readFileSync(join(pkg, "dist/documents/index.js"), "utf8");
    const wikiJs = readFileSync(join(ROOT, "packages/memory/dist/wiki/ingest.js"), "utf8");
    assert.doesNotMatch(extractionJs, /^import\s+.*@firecrawl\/anydoc/m);
    assert.equal(documentsJs.includes("@firecrawl/anydoc"), false);
    assert.equal(wikiJs.includes("@firecrawl/anydoc"), false);
    assert.equal(wikiJs.includes("@arnilo/prism-work"), false);

    const extraction = await import(pathToFileURL(join(pkg, "dist/document-extraction/index.js")).href);
    const documents = await import(pathToFileURL(join(pkg, "dist/documents/index.js")).href);
    const memory = await import(pathToFileURL(join(ROOT, "packages/memory/dist/wiki/ingest.js")).href);
    assert.equal(typeof documents.parseDocument, "function");
    assert.equal(typeof memory.ingestWikiSource, "function");

    const ingest = extraction.createDocumentIngest({
      extract: async () => ({ markdown: "PACKED", format: "pdf", ocrUsed: false }),
    });
    const workspace = mkdtempSync(join(dir, "ws-"));
    const pdf = readFileSync(join(ROOT, "packages/prism-work/src/document-extraction/__tests__/fixtures/scan.pdf"));
    const staged = await memory.ingestWikiSource(
      { bytes: pdf, filename: "scan.pdf", title: "Scan" },
      { workspaceRoot: workspace, extractDocument: ingest.extractDocument },
    );
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
    const refused = mkdtempSync(join(dir, "refused-"));
    await assert.rejects(
      () =>
        memory.ingestWikiSource(
          { bytes: pdf, filename: "scan.pdf", title: "Scan" },
          { workspaceRoot: refused, extractDocument: failing.extractDocument },
        ),
      /WORKER_SECRET/,
    );
    assert.equal(existsSync(join(refused, "raw")), false);
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
    pathToFileURL(join(ROOT, "packages/prism-work/dist/document-extraction/index.js")).href
  );
  const { spawn } = await import("node:child_process");
  const { ingestWikiSource } = await import(pathToFileURL(join(ROOT, "packages/memory/dist/wiki/ingest.js")).href);
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
    const pdf = readFileSync(join(ROOT, "packages/prism-work/src/document-extraction/__tests__/fixtures/scan-real.pdf"));
    const staged = await ingestWikiSource(
      { bytes: pdf, filename: "scan-real.pdf", title: "Scan" },
      { workspaceRoot: workspace, extractDocument: ingest.extractDocument },
    );
    assert.match(staged.extract, /SCAN/);
    assert.equal(JSON.stringify(ingest.stats()).includes("SCAN"), false);
    assert.equal(ingest.stats().ocrCount, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
