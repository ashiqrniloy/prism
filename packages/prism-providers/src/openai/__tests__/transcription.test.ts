import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type TranscriptEvent, TranscriptionError } from "@arnilo/prism";
import { runTranscriptionConformance } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAITranscriptionProvider, OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES } from "../index.js";

interface CapturedRequest {
  url: string;
  headers: Headers;
  form: FormData;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function sseResponse(events: readonly unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function captureJsonFetch(payload: unknown) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      form: init?.body as FormData,
    });
    return jsonResponse(payload);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function captureSseFetch(events: readonly unknown[]) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), form: init?.body as FormData });
    return sseResponse(events);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const AUDIO = new Uint8Array([1, 2, 3, 4]);

describe("createOpenAITranscriptionProvider", () => {
  it("posts_multipart_form_with_model_file_and_hints", async () => {
    const { fetchImpl, requests } = captureJsonFetch({ text: "hello world" });
    const provider = createOpenAITranscriptionProvider({ apiKey: "sk-openai-secret", fetch: fetchImpl });
    const result = await provider.transcribe({ model: "whisper-1", audio: AUDIO, format: "mp3", language: "en", prompt: "greeting" });
    assert.equal(requests[0].url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-openai-secret");
    assert.equal(requests[0].form.get("model"), "whisper-1");
    assert.equal(requests[0].form.get("language"), "en");
    assert.equal(requests[0].form.get("prompt"), "greeting");
    const file = requests[0].form.get("file") as File;
    assert.equal(file.name, "audio.mp3", "format maps to the upload filename");
    assert.equal((await file.arrayBuffer()).byteLength, AUDIO.byteLength);
    assert.equal(result.text, "hello world");
  });

  it("empty_and_oversized_audio_fail_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const provider = createOpenAITranscriptionProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return jsonResponse({});
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.transcribe({ model: "m", audio: new Uint8Array(0) }),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptionError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    await assert.rejects(
      () => provider.transcribe({ model: "m", audio: new Uint8Array(OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES + 1) }),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptionError);
        assert.equal(error.code, "audio_too_large");
        assert.match(error.message, /26214400/);
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("malformed_response_missing_text_fails_typed", async () => {
    const { fetchImpl } = captureJsonFetch({});
    const provider = createOpenAITranscriptionProvider({ apiKey: "sk-x", fetch: fetchImpl });
    await assert.rejects(
      () => provider.transcribe({ model: "m", audio: AUDIO }),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptionError);
        assert.equal(error.code, "response_malformed");
        return true;
      },
    );
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const provider = createOpenAITranscriptionProvider({
      apiKey: "sk-openai-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-openai-secret" } }), { status: 401 })) as typeof fetch,
    });
    await assert.rejects(
      () => provider.transcribe({ model: "m", audio: AUDIO }),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptionError);
        assert.equal(error.code, "request_failed");
        assert.ok(error.message.includes("401"), `status surfaced: ${error.message}`);
        assert.ok(!error.message.includes("sk-openai-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("streams_deltas_then_one_done_with_usage", async () => {
    const { fetchImpl, requests } = captureSseFetch([
      { type: "transcript.text.delta", text: "hello " },
      { type: "transcript.text.delta", text: "world" },
      { type: "transcript.text.done", text: "hello world", usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
    ]);
    const provider = createOpenAITranscriptionProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const events: TranscriptEvent[] = [];
    for await (const event of provider.transcribeStream({ model: "whisper-1", audio: AUDIO })) {
      events.push(event);
    }
    assert.deepEqual(
      events,
      [
        { type: "transcript_delta", text: "hello " },
        { type: "transcript_delta", text: "world" },
        { type: "done", text: "hello world", usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
      ],
      "deltas in provider order, then exactly one done with mapped usage",
    );
    assert.equal(requests[0].form.get("stream"), "true");
    assert.equal(requests[0].form.get("stream_include_usage"), "true");
  });

  it("passes_transcription_conformance_with_fake_transport", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      return form.get("stream") === "true"
        ? sseResponse([
            { type: "transcript.text.delta", text: "hello " },
            { type: "transcript.text.delta", text: "world" },
            { type: "transcript.text.done", text: "hello world", usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
          ])
        : jsonResponse({ text: "hello world" });
    }) as typeof fetch;
    await runTranscriptionConformance({
      provider: createOpenAITranscriptionProvider({ apiKey: "sk-x", fetch: fetchImpl }),
      model: "whisper-1",
      maxAudioBytes: OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES,
      sample: { audio: AUDIO, textIncludes: "hello" },
    });
  });
});
