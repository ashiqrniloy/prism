import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SpeechError } from "@arnilo/prism";
import { runSpeechConformance } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAISpeechProvider, OPENAI_SPEECH_MAX_INPUT_CHARS } from "../index.js";

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: any;
}

function audioResponse(chunks: readonly Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function captureFetch(chunks: readonly Uint8Array[]) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return audioResponse(chunks);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("createOpenAISpeechProvider", () => {
  it("posts_openai_speech_shape_with_bearer_and_defaults", async () => {
    const { fetchImpl, requests } = captureFetch([new Uint8Array([1, 2, 3])]);
    const provider = createOpenAISpeechProvider({ apiKey: "sk-openai-secret", fetch: fetchImpl });
    const result = await provider.synthesize({ model: "tts-1", input: "hello" });
    assert.equal(requests[0].url, "https://api.openai.com/v1/audio/speech");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-openai-secret");
    assert.equal(requests[0].body.model, "tts-1");
    assert.equal(requests[0].body.input, "hello");
    assert.equal(requests[0].body.response_format, "mp3", "mp3 default format");
    assert.deepEqual(result.audio, new Uint8Array([1, 2, 3]));
    assert.equal(result.format, "mp3");
  });

  it("request_options_override_voice_format_speed", async () => {
    const { fetchImpl, requests } = captureFetch([new Uint8Array([1])]);
    const provider = createOpenAISpeechProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const result = await provider.synthesize({ model: "tts-1", input: "hello", voice: "alloy", format: "opus", speed: 1.5 });
    assert.equal(requests[0].body.voice, "alloy");
    assert.equal(requests[0].body.response_format, "opus");
    assert.equal(requests[0].body.speed, 1.5);
    assert.equal(result.format, "opus");
  });

  it("empty_and_oversized_input_fail_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const provider = createOpenAISpeechProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return audioResponse([]);
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.synthesize({ model: "m", input: "" }),
      (error: unknown) => {
        assert.ok(error instanceof SpeechError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    await assert.rejects(
      () => provider.synthesize({ model: "m", input: "x".repeat(OPENAI_SPEECH_MAX_INPUT_CHARS + 1) }),
      (error: unknown) => {
        assert.ok(error instanceof SpeechError);
        assert.equal(error.code, "input_too_large");
        assert.match(error.message, /4096/);
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const provider = createOpenAISpeechProvider({
      apiKey: "sk-openai-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-openai-secret" } }), { status: 401 })) as typeof fetch,
    });
    await assert.rejects(
      () => provider.synthesize({ model: "m", input: "hi" }),
      (error: unknown) => {
        assert.ok(error instanceof SpeechError);
        assert.equal(error.code, "request_failed");
        assert.ok(error.message.includes("401"), `status surfaced: ${error.message}`);
        assert.ok(!error.message.includes("sk-openai-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("over_max_audio_bytes_response_fails_typed", async () => {
    const { fetchImpl } = captureFetch([new Uint8Array(4)]);
    const provider = createOpenAISpeechProvider({ apiKey: "sk-x", fetch: fetchImpl, maxAudioBytes: 3 });
    await assert.rejects(
      () => provider.synthesize({ model: "m", input: "hi" }),
      (error: unknown) => {
        assert.ok(error instanceof SpeechError);
        assert.equal(error.code, "response_malformed");
        assert.match(error.message, /exceeded 3 bytes/);
        return true;
      },
    );
  });

  it("stream_emits_first_chunk_before_closing_and_enforces_byte_cap", async () => {
    const { fetchImpl } = captureFetch([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const provider = createOpenAISpeechProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const stream = await provider.synthesizeStream({ model: "m", input: "hi" });
    const reader = stream.audio.getReader();
    const first = await reader.read();
    assert.deepEqual(first.value, new Uint8Array([1, 2]), "first chunk available before the stream closes");
    const second = await reader.read();
    assert.deepEqual(second.value, new Uint8Array([3]));
    assert.ok((await reader.read()).done);

    const capped = createOpenAISpeechProvider({ apiKey: "sk-x", fetch: fetchImpl, maxAudioBytes: 2 });
    const cappedStream = await capped.synthesizeStream({ model: "m", input: "hi" });
    const cappedReader = cappedStream.audio.getReader();
    await cappedReader.read();
    await assert.rejects(() => cappedReader.read(), /exceeded 2 bytes/);
  });

  it("passes_speech_conformance_with_fake_transport", async () => {
    const { fetchImpl } = captureFetch([new Uint8Array([1, 2, 3, 4])]);
    await runSpeechConformance({
      provider: createOpenAISpeechProvider({ apiKey: "sk-x", fetch: fetchImpl }),
      model: "tts-1",
      maxInputChars: OPENAI_SPEECH_MAX_INPUT_CHARS,
      sample: { input: "hello world", voice: "alloy", format: "mp3" },
    });
  });
});
