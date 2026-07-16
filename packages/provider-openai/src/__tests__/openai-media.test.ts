import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertProviderStreamConforms, assertSerializedRequestCoversContent } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAIResponsesProvider } from "../responses.js";
import { createOpenAIFileUploadManager } from "../uploads.js";

const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
const tinyWav = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]).toString("base64");

describe("@arnilo/prism-provider-openai multimodal responses", () => {
  it("openai_responses_serializes_file_audio_and_document_blocks", async () => {
    const replay: ProviderRequest = {
      model: {
        provider: "openai",
        model: "gpt-5.1",
        capabilities: { input: ["text", "image", "audio", "file", "document"] },
      },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "review" },
          { type: "file", mediaType: "application/pdf", name: "report.pdf", data: tinyPdf },
          { type: "document", mediaType: "application/pdf", name: "brief.pdf", data: tinyPdf },
          { type: "audio", mediaType: "audio/wav", name: "note.wav", data: tinyWav },
        ],
      }],
    };
    let body: unknown;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-openai-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
    const serialized = JSON.stringify(body);
    assert.match(serialized, /input_file/);
    assert.match(serialized, /report\.pdf/);
    assert.match(serialized, /input_audio/);
    assert.match(serialized, /"format":"wav"/);
    assert.ok(!serialized.includes(tinyPdf.slice(0, 8)) || serialized.includes(tinyPdf), "inline file_data should preserve canary");
  });

  it("openai_responses_rejects_undeclared_audio_modality", async () => {
    const request: ProviderRequest = {
      model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["text", "image"] } },
      messages: [{ role: "user", content: [{ type: "audio", mediaType: "audio/wav", data: tinyWav }] }],
    };
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(request)) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } })?.error?.message ?? events.at(-1)), /audio input/);
  });

  it("openai_responses_rejects_request media limits before upload or provider fetch", async () => {
    let uploads = 0;
    let providerFetches = 0;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-openai-key",
      uploadManager: {
        inlineMaxBytes: 1,
        maxItemBytes: 10_000_000,
        resolveFileWire: async (_mediaType, _bytes, filename) => { uploads += 1; return { filename, fileId: "unexpected", uploaded: true }; },
        cleanup: async () => {},
      },
      fetch: (async () => { providerFetches += 1; return ok(sse([])); }) as typeof fetch,
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["file"] } },
      messages: [{
        role: "user",
        content: Array.from({ length: 33 }, (_, index) => ({
          type: "file" as const,
          mediaType: "application/pdf",
          name: `${index}.pdf`,
          data: tinyPdf,
        })),
      }],
    })) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(uploads, 0);
    assert.equal(providerFetches, 0);
  });

  it("openai_upload_manager_caches_and_cleans_up_remote_files", async () => {
    const deleted: string[] = [];
    const uploaded: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/files") && init?.method === "POST") {
        uploaded.push("upload");
        return new Response(JSON.stringify({ id: "file-remote-1" }), { status: 200 });
      }
      if (url.includes("/files/file-remote-1") && init?.method === "DELETE") {
        deleted.push("file-remote-1");
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const manager = createOpenAIFileUploadManager({
      apiKey: "fake-openai-key",
      fetch: fetchImpl,
      inlineMaxBytes: 1,
      scope: { sessionId: "sess-1" },
    });
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const first = await manager.resolveFileWire("application/pdf", bytes, "big.pdf");
    const second = await manager.resolveFileWire("application/pdf", bytes, "big.pdf");
    assert.equal(first.fileId, "file-remote-1");
    assert.equal(second.fileId, "file-remote-1");
    assert.equal(uploaded.length, 1);
    await manager.cleanup();
    assert.deepEqual(deleted, ["file-remote-1"]);
  });
});

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
