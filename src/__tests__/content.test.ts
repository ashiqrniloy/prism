import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertDeclaredMediaTypeMatches,
  assertMediaBlocksWithinBounds,
  assertMessagesSupportModelCapabilities,
  assertModelSupportsContentBlocks,
  assertSsrfAllowedUrl,
  DEFAULT_MAX_AUDIO_DURATION_MS,
  DEFAULT_MAX_MEDIA_ITEM_BYTES,
  DEFAULT_MAX_MEDIA_REQUEST_BYTES,
  MediaContentError,
  resolveMediaContentBlock,
  sniffMediaMimeType,
  UnsupportedModalityError,
  type AudioContent,
  type DocumentContent,
  type FileContent,
} from "../content.js";
import { assembleProviderInput } from "../input.js";

const tinyPdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const tinyPdfBase64 = Buffer.from(tinyPdf).toString("base64");
const tinyWav = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]);
const tinyWavBase64 = Buffer.from(tinyWav).toString("base64");

describe("multimodal content contracts", () => {
  it("sniffs common media MIME types", () => {
    assert.equal(sniffMediaMimeType(tinyPdf), "application/pdf");
    assert.equal(sniffMediaMimeType(tinyWav), "audio/wav");
  });

  it("resolves inline file and audio blocks from base64 data", async () => {
    const file: FileContent = {
      type: "file",
      mediaType: "application/pdf",
      name: "report.pdf",
      data: tinyPdfBase64,
    };
    const audio: AudioContent = {
      type: "audio",
      mediaType: "audio/wav",
      data: tinyWavBase64,
      durationMs: 1_000,
    };

    const resolvedFile = await resolveMediaContentBlock(file);
    assert.equal(resolvedFile.mediaType, "application/pdf");
    assert.equal(resolvedFile.name, "report.pdf");
    assert.deepEqual(resolvedFile.bytes, tinyPdf);

    const resolvedAudio = await resolveMediaContentBlock(audio);
    assert.equal(resolvedAudio.mediaType, "audio/wav");
    assert.equal(resolvedAudio.durationMs, 1_000);
  });

  it("resolves resourceUri blocks through a bounded loader", async () => {
    const block: DocumentContent = {
      type: "document",
      mediaType: "application/pdf",
      resourceUri: "package://demo/report.pdf",
      transcript: "summary",
    };
    const resolved = await resolveMediaContentBlock(block, {
      loader: {
        async load(uri) {
          assert.equal(uri, "package://demo/report.pdf");
          return { uri, mediaType: "application/pdf", data: tinyPdf };
        },
      },
    });
    assert.equal(resolved.transcript, "summary");
    assert.deepEqual(resolved.bytes, tinyPdf);
  });

  it("resolves url blocks with injectable fetch and SSRF checks", async () => {
    const block: FileContent = {
      type: "file",
      mediaType: "application/pdf",
      url: "https://cdn.example.test/report.pdf",
    };
    const resolved = await resolveMediaContentBlock(block, {
      fetch: async () => new Response(tinyPdf, { status: 200 }),
    });
    assert.deepEqual(resolved.bytes, tinyPdf);
  });

  it("rejects ambiguous or missing media sources", async () => {
    await assert.rejects(
      () => resolveMediaContentBlock({
        type: "file",
        mediaType: "application/pdf",
        data: tinyPdfBase64,
        url: "https://cdn.example.test/report.pdf",
      }),
      (error: unknown) => error instanceof MediaContentError && error.code === "ambiguous_source",
    );
    await assert.rejects(
      () => resolveMediaContentBlock({ type: "audio", mediaType: "audio/wav" }),
      (error: unknown) => error instanceof MediaContentError && error.code === "missing_source",
    );
  });

  it("enforces byte, count, and audio duration bounds", () => {
    assert.throws(
      () => assertMediaBlocksWithinBounds([
        { type: "file", mediaType: "application/pdf", data: "a".repeat(40_000_000) },
      ], { maxItemBytes: 1_000 }),
      (error: unknown) => error instanceof MediaContentError && error.code === "item_too_large",
    );
    assert.throws(
      () => assertMediaBlocksWithinBounds(
        Array.from({ length: 40 }, (_, index) => ({
          type: "file" as const,
          mediaType: "application/pdf",
          name: String(index),
          data: tinyPdfBase64,
        })),
        { maxItems: 2 },
      ),
      (error: unknown) => error instanceof MediaContentError && error.code === "too_many_items",
    );
    assert.throws(
      () => assertMediaBlocksWithinBounds([
        { type: "audio", mediaType: "audio/wav", data: tinyWavBase64, durationMs: DEFAULT_MAX_AUDIO_DURATION_MS + 1 },
      ]),
      (error: unknown) => error instanceof MediaContentError && error.code === "audio_too_long",
    );
    assert.throws(
      () => assertMediaBlocksWithinBounds([
        { type: "file", mediaType: "application/pdf", data: tinyPdfBase64 },
        { type: "file", mediaType: "application/pdf", data: tinyPdfBase64 },
      ], { maxItemBytes: tinyPdf.byteLength + 10, maxRequestBytes: tinyPdf.byteLength + 5 }),
      (error: unknown) => error instanceof MediaContentError && error.code === "request_too_large",
    );
  });

  it("denies private-network SSRF targets by default", () => {
    for (const url of [
      "http://127.0.0.1/secret",
      "http://localhost/file",
      "http://10.0.0.5/file",
      "http://192.168.1.10/file",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      assert.throws(() => assertSsrfAllowedUrl(url), (error: unknown) => error instanceof MediaContentError && error.code === "ssrf_denied");
    }
    assert.doesNotThrow(() => assertSsrfAllowedUrl("https://cdn.example.test/file.pdf"));
  });

  it("rejects MIME spoofing when magic bytes disagree", () => {
    assert.throws(
      () => assertDeclaredMediaTypeMatches("audio/wav", tinyPdf),
      (error: unknown) => error instanceof MediaContentError && error.code === "mime_mismatch",
    );
    assert.doesNotThrow(() => assertDeclaredMediaTypeMatches("application/pdf", tinyPdf));
  });

  it("rejects unsupported modalities when capabilities are declared", () => {
    const model = { provider: "demo", model: "text-only", capabilities: { input: ["text"] } };
    assert.throws(
      () => assertModelSupportsContentBlocks(model, [{ type: "audio", mediaType: "audio/wav", data: tinyWavBase64 }]),
      UnsupportedModalityError,
    );
    assert.doesNotThrow(() => assertModelSupportsContentBlocks(model, [{ type: "text", text: "hello" }]));
    assert.doesNotThrow(() => assertModelSupportsContentBlocks(
      { provider: "demo", model: "undeclared" },
      [{ type: "audio", mediaType: "audio/wav", data: tinyWavBase64 }],
    ));
  });

  it("assembleProviderInput rejects unsupported modalities before provider calls", async () => {
    await assert.rejects(
      () => assembleProviderInput({
        model: { provider: "demo", model: "text-only", capabilities: { input: ["text"] } },
        input: [{ role: "user", content: [{ type: "document", mediaType: "application/pdf", data: tinyPdfBase64 }] }],
      }),
      UnsupportedModalityError,
    );
  });

  it("aborts url resolution when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(
      () => resolveMediaContentBlock(
        { type: "file", mediaType: "application/pdf", url: "https://cdn.example.test/report.pdf" },
        {
          fetch: async () => {
            throw new Error("fetch should not run");
          },
          signal: controller.signal,
        },
      ),
      /stop|aborted/i,
    );
  });

  it("does not include raw bytes in media error messages", async () => {
    try {
      await resolveMediaContentBlock({
        type: "file",
        mediaType: "audio/wav",
        data: tinyPdfBase64,
      });
      assert.fail("expected mime mismatch");
    } catch (error) {
      assert.ok(error instanceof MediaContentError);
      assert.equal(error.code, "mime_mismatch");
      assert.ok(!error.message.includes(tinyPdfBase64));
    }
  });

  it("exports documented default media ceilings", () => {
    assert.equal(DEFAULT_MAX_MEDIA_ITEM_BYTES, 10_000_000);
    assert.equal(DEFAULT_MAX_MEDIA_REQUEST_BYTES, 32 * 1024 * 1024);
    assert.equal(DEFAULT_MAX_AUDIO_DURATION_MS, 5 * 60 * 1000);
  });
});
