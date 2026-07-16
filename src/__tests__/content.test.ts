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
  resolveMediaContentBlocks,
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

  it("denies private, local, unspecified, multicast, and mapped SSRF literals", () => {
    for (const url of [
      "http://127.0.0.1/secret",
      "http://%31%32%37.0.0.1/secret",
      "http://localhost/file",
      "http://10.0.0.5/file",
      "http://192.168.1.10/file",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/file",
      "http://224.0.0.1/file",
      "http://[::]/file",
      "http://[::1]/file",
      "http://[fe80::1]/file",
      "http://[fc00::1]/file",
      "http://[fd00::1]/file",
      "http://[ff02::1]/file",
      "http://[::ffff:127.0.0.1]/file",
      "http://[::ffff:10.0.0.1]/file",
    ]) {
      assert.throws(() => assertSsrfAllowedUrl(url), (error: unknown) => error instanceof MediaContentError && error.code === "ssrf_denied", url);
    }
    assert.doesNotThrow(() => assertSsrfAllowedUrl("https://CDN.EXAMPLE.TEST./file.pdf"));
    assert.doesNotThrow(() => assertSsrfAllowedUrl("https://93.184.216.34/file.pdf"));
    assert.doesNotThrow(() => assertSsrfAllowedUrl("http://[::1]/file", { allowedHostnames: ["::1"] }));
  });

  it("rejects private DNS answers and pins one validated public address", async () => {
    const block: FileContent = {
      type: "file",
      mediaType: "application/pdf",
      url: "https://media.example.test/report.pdf",
    };
    let requests = 0;
    const resolved = await resolveMediaContentBlock(block, {
      resolveHostname: async (hostname) => {
        assert.equal(hostname, "media.example.test");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      requestUrl: async ({ url, address }) => {
        requests++;
        assert.equal(url.hostname, "media.example.test");
        assert.deepEqual(address, { address: "93.184.216.34", family: 4 });
        return tinyPdf;
      },
    });
    assert.deepEqual(resolved.bytes, tinyPdf);
    assert.equal(requests, 1);

    for (const answers of [
      [{ address: "127.0.0.1", family: 4 as const }],
      [
        { address: "93.184.216.34", family: 4 as const },
        { address: "10.0.0.1", family: 4 as const },
      ],
      [{ address: "::ffff:127.0.0.1", family: 6 as const }],
    ]) {
      await assert.rejects(
        () => resolveMediaContentBlock(block, {
          resolveHostname: async () => answers,
          requestUrl: async () => {
            assert.fail("request must not run for private DNS answers");
          },
        }),
        (error: unknown) => error instanceof MediaContentError && error.code === "ssrf_denied",
      );
    }
  });

  it("bounds DNS lookup failure, timeout, and abort", async () => {
    const block: FileContent = {
      type: "file",
      mediaType: "application/pdf",
      url: "https://media.example.test/report.pdf",
    };
    await assert.rejects(
      () => resolveMediaContentBlock(block, { resolveHostname: async () => { throw new Error("lookup failed"); } }),
      (error: unknown) => error instanceof MediaContentError && error.code === "fetch_failed",
    );
    await assert.rejects(
      () => resolveMediaContentBlock(block, {
        resolveHostname: async () => Array.from({ length: 33 }, () => ({ address: "93.184.216.34", family: 4 as const })),
      }),
      (error: unknown) => error instanceof MediaContentError && error.code === "fetch_failed",
    );
    await assert.rejects(
      () => resolveMediaContentBlock(block, {
        bounds: { fetchTimeoutMs: 5 },
        resolveHostname: () => new Promise(() => {}),
      }),
      (error: unknown) => error instanceof MediaContentError && error.code === "fetch_timeout",
    );
    const controller = new AbortController();
    controller.abort(new Error("stop lookup"));
    await assert.rejects(
      () => resolveMediaContentBlock(block, {
        signal: controller.signal,
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
      /stop lookup/,
    );
  });

  it("enforces aggregate resolved bytes and item count before provider work", async () => {
    const blocks = Array.from({ length: 4 }, () => ({
      type: "file" as const,
      mediaType: "application/octet-stream",
      data: Buffer.from("abc").toString("base64"),
    }));
    let providerCalls = 0;
    await assert.rejects(
      async () => {
        await resolveMediaContentBlocks(blocks, { bounds: { maxRequestBytes: 10 } });
        providerCalls += 1;
      },
      (error: unknown) => error instanceof MediaContentError && error.code === "request_too_large",
    );
    assert.equal(providerCalls, 0);

    let resolutions = 0;
    await assert.rejects(
      () => resolveMediaContentBlocks(Array.from({ length: 33 }, (_, index) => ({
        type: "file" as const,
        mediaType: "application/octet-stream",
        url: `https://example.com/${index}`,
      })), {
        resolveHostname: async () => { resolutions += 1; return [{ address: "93.184.216.34", family: 4 }]; },
        requestUrl: async () => new Uint8Array(),
      }),
      (error: unknown) => error instanceof MediaContentError && error.code === "too_many_items",
    );
    assert.equal(resolutions, 0);
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
