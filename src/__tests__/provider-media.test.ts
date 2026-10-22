import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  bytesToBase64,
  createBoundedUploadCache,
  isPdfMediaType,
  mediaFingerprint,
  providerUploadCacheKey,
  rejectProviderMediaBlock,
  serializePdfDocumentWireBlock,
} from "../provider-kit/media.js";

describe("provider media primitives", () => {
  it("serializes Anthropic PDF documents and rejects non-pdf", () => {
    assert.deepEqual(
      serializePdfDocumentWireBlock({
        mediaType: "application/pdf",
        data: "abc",
        title: "report.pdf",
      }),
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "abc" },
        title: "report.pdf",
      },
    );
    assert.throws(() => serializePdfDocumentWireBlock({ mediaType: "text/plain", data: "abc" }), /application\/pdf/);
  });

  it("bounded upload cache evicts oldest entries", () => {
    const cache = createBoundedUploadCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.get("b"), "2");
    assert.equal(cache.get("c"), "3");
  });

  it("scopes upload cache keys by session and fingerprint", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const fingerprint = mediaFingerprint("application/pdf", bytes, "report.pdf");
    assert.match(providerUploadCacheKey({ sessionId: "s1" }, fingerprint), /^s1:/);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
    assert.equal(isPdfMediaType("application/pdf"), true);
  });

  it("rejectProviderMediaBlock throws for undeclared modalities", () => {
    const model = { provider: "demo", model: "text-only", capabilities: { input: ["text"] } };
    assert.throws(
      () => rejectProviderMediaBlock({ type: "audio", mediaType: "audio/wav", data: "abc" }, model.capabilities ?? {}, model),
      /does not support audio input/,
    );
  });
});
