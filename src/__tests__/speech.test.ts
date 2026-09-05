import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpeechProvider, SpeechResult, TranscriptEvent, TranscriptionProvider, } from "../contracts.js";
import {
  assertSpeechSupported,
  assertTranscriptionSupported,
  modelSupportsSpeech,
  modelSupportsTranscription,
  SpeechError,
  TranscriptionError,
} from "../contracts.js";
import { runSpeechConformance, runTranscriptionConformance } from "../testing/provider-conformance.js";

function fakeSpeechProvider(overrides?: Partial<Pick<SpeechResult, "audio">>): SpeechProvider {
  return {
    id: "fake",
    async synthesize(request) {
      if (request.input.length === 0) throw new SpeechError("empty_input", "empty");
      if (request.input.length > 3) throw new SpeechError("input_too_large", "cap");
      return { audio: overrides?.audio ?? new Uint8Array([1, 2, 3]), format: request.format ?? "mp3" };
    },
    async synthesizeStream(request) {
      const result = await this.synthesize(request);
      return {
        audio: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(result.audio.subarray(0, 2));
            controller.enqueue(result.audio.subarray(2));
            controller.close();
          },
        }),
        format: result.format,
      };
    },
  };
}

function fakeTranscriptionProvider(): TranscriptionProvider {
  return {
    id: "fake",
    async transcribe(request) {
      if (request.audio.byteLength === 0) throw new TranscriptionError("empty_input", "empty");
      if (request.audio.byteLength > 3) throw new TranscriptionError("audio_too_large", "cap");
      return { text: "hello world", usage: { inputTokens: 2, totalTokens: 2 } };
    },
    async *transcribeStream(request) {
      const result = await this.transcribe(request);
      yield { type: "transcript_delta", text: result.text.slice(0, 5) };
      yield { type: "transcript_delta", text: result.text.slice(5) };
      yield { type: "done", text: result.text, usage: result.usage };
    },
  };
}

describe("speech contract", () => {
  it("modelSupportsSpeech_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsSpeech(undefined), false);
    assert.equal(modelSupportsSpeech({}), false);
    assert.equal(modelSupportsSpeech({ speech: true }), true);
    assert.equal(modelSupportsSpeech({ speech: false }), false);
  });

  it("assertSpeechSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "tts-1", capabilities: { embeddings: true } };
    assert.throws(
      () => assertSpeechSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof SpeechError);
        assert.equal(error.code, "unsupported_model");
        return true;
      },
    );
  });

  it("runSpeechConformance_passes_fake_provider_probes", async () => {
    const result = await runSpeechConformance({
      provider: fakeSpeechProvider(),
      model: "tts-1",
      maxInputChars: 3,
      sample: { input: "hi", format: "wav" },
    });
    assert.equal(result?.format, "wav");
    assert.ok((result?.audio.byteLength ?? 0) > 0);
  });

  it("runSpeechConformance_fails_on_empty_audio_bytes", async () => {
    await assert.rejects(
      () =>
        runSpeechConformance({
          provider: fakeSpeechProvider({ audio: new Uint8Array(0) }),
          model: "tts-1",
          sample: { input: "hi" },
        }),
      /non-empty audio bytes/,
    );
  });

  it("runSpeechConformance_fails_when_stream_closes_without_chunks", async () => {
    const provider = fakeSpeechProvider();
    provider.synthesizeStream = async () => ({ audio: new ReadableStream<Uint8Array>({ start: (c) => c.close() }), format: "mp3" });
    await assert.rejects(() => runSpeechConformance({ provider, model: "tts-1", sample: { input: "hi" } }), /at least one non-empty chunk/);
  });
});

describe("transcription contract", () => {
  it("modelSupportsTranscription_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsTranscription(undefined), false);
    assert.equal(modelSupportsTranscription({}), false);
    assert.equal(modelSupportsTranscription({ transcription: true }), true);
  });

  it("assertTranscriptionSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "whisper-1", capabilities: {} };
    assert.throws(
      () => assertTranscriptionSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptionError);
        assert.equal(error.code, "unsupported_model");
        return true;
      },
    );
  });

  it("runTranscriptionConformance_passes_fake_provider_probes", async () => {
    const result = await runTranscriptionConformance({
      provider: fakeTranscriptionProvider(),
      model: "whisper-1",
      maxAudioBytes: 3,
      sample: { audio: new Uint8Array([1, 2, 3]), textIncludes: "hello" },
    });
    assert.equal(result?.text, "hello world");
  });

  it("runTranscriptionConformance_fails_when_oversized_audio_resolves", async () => {
    const lax: TranscriptionProvider = {
      id: "fake",
      transcribe: async (request) => {
        if (request.audio.byteLength === 0) throw new TranscriptionError("empty_input", "empty");
        return { text: "x" };
      },
      transcribeStream: async function* (request): AsyncIterable<TranscriptEvent> {
        if (request.audio.byteLength === 0) throw new TranscriptionError("empty_input", "empty");
        yield { type: "done", text: "x" };
      },
    };
    await assert.rejects(() => runTranscriptionConformance({ provider: lax, model: "m", maxAudioBytes: 3 }), /audio_too_large/);
  });

  it("runTranscriptionConformance_fails_without_a_terminal_done_event", async () => {
    const provider = fakeTranscriptionProvider();
    provider.transcribeStream = async function* (): AsyncIterable<TranscriptEvent> {
      yield { type: "transcript_delta", text: "partial" };
    };
    await assert.rejects(
      () => runTranscriptionConformance({ provider, model: "m", sample: { audio: new Uint8Array([1]) } }),
      /exactly one done event/,
    );
  });
});
