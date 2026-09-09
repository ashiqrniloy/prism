import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { MemoryValidationError } from "../../errors.js";
import { ingestWikiSource } from "../ingest.js";

const UNCOMPRESSED_PDF = "%PDF-1.4\n/Type /Page\nBT (Hello \\(PDF\\)) Tj ET";

let root: string;

async function staged(name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("ingestWikiSource", () => {
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "prism-wiki-ingest-"));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ingest_text_writes_source_and_extract", async () => {
    const workspace = await staged("text");
    const result = await ingestWikiSource({ text: "hello wiki", title: "Hello Note" }, { workspaceRoot: workspace });

    assert.equal(result.mediaType, "text/plain");
    assert.equal(result.truncated, false);
    assert.match(result.sourcePath, /^raw\/ingest\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-hello-note\/source\.txt$/);
    assert.equal(result.extractPath, `${result.rawDir}/extract.md`);
    assert.equal(await readFile(join(workspace, result.sourcePath), "utf8"), "hello wiki");
    assert.equal(await readFile(join(workspace, result.extractPath), "utf8"), "hello wiki");
  });

  it("ingest_markdown_path_copies_bytes", async () => {
    const workspace = await staged("md");
    await writeFile(join(workspace, "notes.md"), "# Notes\n\nbody", "utf8");
    const result = await ingestWikiSource({ path: "notes.md" }, { workspaceRoot: workspace });

    assert.equal(result.mediaType, "text/markdown");
    assert.ok(result.sourcePath.endsWith("source.md"));
    assert.equal(await readFile(join(workspace, result.sourcePath), "utf8"), "# Notes\n\nbody");
    assert.match(result.extract, /^# Notes/);
  });

  it("ingest_pdf_uncompressed_extracts_text", async () => {
    const workspace = await staged("pdf");
    await writeFile(join(workspace, "paper.pdf"), UNCOMPRESSED_PDF, "utf8");
    const result = await ingestWikiSource({ path: "paper.pdf", title: "Paper" }, { workspaceRoot: workspace });

    assert.equal(result.mediaType, "application/pdf");
    assert.ok(result.sourcePath.endsWith("source.pdf"));
    assert.match(result.extract, /Hello \(PDF\)/);
  });

  it("ingest_image_stub_extract_no_ocr", async () => {
    const workspace = await staged("image");
    const result = await ingestWikiSource(
      { bytes: new Uint8Array([137, 80, 78, 71]), filename: "shot.png", title: "Shot" },
      { workspaceRoot: workspace },
    );

    assert.equal(result.mediaType, "image/png");
    assert.ok(result.sourcePath.endsWith("source.png"));
    assert.match(result.extract, /source\.png/);
    assert.match(result.extract, /no OCR|No text extraction/i);
  });

  it("ingest_path_escape_rejected", async () => {
    const workspace = await staged("escape");
    await assert.rejects(
      () => ingestWikiSource({ path: join(root, "outside.txt"), title: "X" }, { workspaceRoot: workspace }),
      MemoryValidationError,
    );
    // A symlink inside the workspace that realpaths outside is equally rejected.
    const outside = join(root, "outside.txt");
    await writeFile(outside, "leak", "utf8");
    await symlink(outside, join(workspace, "leak.txt"));
    await assert.rejects(() => ingestWikiSource({ path: "leak.txt", title: "X" }, { workspaceRoot: workspace }), /escapes the workspace/);
  });

  it("ingest_oversize_rejected", async () => {
    const workspace = await staged("big");
    await assert.rejects(
      () => ingestWikiSource({ text: "x".repeat(100), title: "Big" }, { workspaceRoot: workspace, maxInputBytes: 10 }),
      /exceeds 10 bytes/,
    );
  });

  it("ingest_unknown_binary_rejected_without_hook", async () => {
    const workspace = await staged("binary");
    await assert.rejects(
      () => ingestWikiSource({ bytes: new Uint8Array([0, 159, 146, 150]), filename: "blob.bin" }, { workspaceRoot: workspace }),
      /unsupported ingest format/,
    );
  });

  it("ingest_extractDocument_hook_used_for_unknown", async () => {
    const workspace = await staged("hook");
    const result = await ingestWikiSource(
      { bytes: new Uint8Array([1, 2, 3]), filename: "doc.docx", title: "Docx" },
      {
        workspaceRoot: workspace,
        extractDocument: async () => ({ text: "hooked extract", format: "docx" }),
      },
    );

    assert.equal(result.extract, "hooked extract");
    assert.equal(await readFile(join(workspace, result.extractPath), "utf8"), "hooked extract");
    assert.equal(result.mediaType, undefined);
  });

  it("ingest_compressed_pdf_uses_hook_when_present", async () => {
    const workspace = await staged("pdfhook");
    await writeFile(join(workspace, "compressed.pdf"), "%PDF-1.4\n/Filter /FlateDecode\nBT (x) Tj ET", "utf8");
    const result = await ingestWikiSource(
      { path: "compressed.pdf", title: "Compressed" },
      { workspaceRoot: workspace, extractDocument: async () => ({ text: "host extracted", format: "pdf" }) },
    );
    assert.equal(result.extract, "host extracted");
  });

  it("ingest_missing_wiki_does_not_throw_on_log", async () => {
    const workspace = await staged("nowiki");
    const result = await ingestWikiSource({ text: "orphan" }, { workspaceRoot: workspace });
    assert.ok(result.sourcePath);
    await assert.rejects(() => readFile(join(workspace, ".wiki", "log.md"), "utf8")); // no scaffold
  });

  it("ingest_appends_log_when_wiki_exists", async () => {
    const workspace = await staged("withwiki");
    await mkdir(join(workspace, ".wiki"));
    await ingestWikiSource({ text: "logged", title: "Logged Note" }, { workspaceRoot: workspace });
    const log = await readFile(join(workspace, ".wiki", "log.md"), "utf8");
    assert.match(log, /\*\*Ingested\*\*: Logged Note →/);
    assert.match(log, /extract\.md/);
  });

  it("ingest_title_sanitized_to_single_line_and_slug", async () => {
    const workspace = await staged("slug");
    const result = await ingestWikiSource({ text: "x", title: "My\nTitle: Weird!!" }, { workspaceRoot: workspace });
    assert.ok(result.rawDir.endsWith("-my-title-weird"));
  });

  it("ingest_requires_content", async () => {
    const workspace = await staged("empty");
    await assert.rejects(() => ingestWikiSource({}, { workspaceRoot: workspace }), MemoryValidationError);
  });

  it("ingest_url_without_hook_fails_closed", async () => {
    const workspace = await staged("url-no-hook");
    await assert.rejects(
      () => ingestWikiSource({ url: "https://example.com/paper.md" }, { workspaceRoot: workspace }),
      /fetchUrl host hook/,
    );
  });

  it("ingest_url_ssrf_private_host_rejected_before_hook", async () => {
    const workspace = await staged("url-ssrf");
    await assert.rejects(
      () =>
        ingestWikiSource(
          { url: "http://localhost/secret" },
          {
            workspaceRoot: workspace,
            // Hook must never run: the SSRF check fires first.
            fetchUrl: async () => {
              throw new Error("hook must not be called");
            },
          },
        ),
      /ssrf_denied/,
    );
  });

  it("ingest_url_hook_stages_markdown_and_records_url", async () => {
    const workspace = await staged("url-hook");
    const result = await ingestWikiSource(
      { url: "https://example.com/docs/my-paper" },
      {
        workspaceRoot: workspace,
        fetchUrl: async ({ url }) =>
          url === "https://example.com/docs/my-paper" ? { text: "# Fetched\nbody", filename: "source.md" } : null,
      },
    );
    assert.equal(result.url, "https://example.com/docs/my-paper");
    assert.equal(result.mediaType, "text/markdown");
    assert.match(result.sourcePath, /-my-paper\/source\.md$/);
    assert.equal(await readFile(join(workspace, result.sourcePath), "utf8"), "# Fetched\nbody");
    // Default title derives from the URL pathname (no explicit title given).
    assert.match(result.rawDir, /-my-paper$/);
  });

  it("ingest_url_hook_null_fails_closed", async () => {
    const workspace = await staged("url-null");
    await assert.rejects(
      () => ingestWikiSource({ url: "https://example.com/gone" }, { workspaceRoot: workspace, fetchUrl: async () => null }),
      /returned no content/,
    );
  });
});
