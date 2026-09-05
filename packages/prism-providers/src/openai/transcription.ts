/** OpenAI transcription adapter over `POST {base}/audio/transcriptions` (plan 061 Task 3).
 *  One-shot posts multipart form data and parses the JSON `text`; the streaming variant
 *  uses `stream: true` SSE (`transcript.text.delta` / `transcript.text.done`) and always
 *  requests usage. Audio byte caps reject with typed errors instead of truncating. Keys
 *  resolve through the existing `CredentialValueSource` seam and are redacted. */

import type { TranscriptEvent, TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "@arnilo/prism";
import { type CredentialValueSource, redactSecrets, resolveCredentialValue, TranscriptionError, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";

/** OpenAI transcription audio cap: at most 25 MiB per request. */
export const OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface OpenAITranscriptionOptions {
  readonly id?: string;
  readonly apiKey?: CredentialValueSource;
  /** Explicit base URL; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** Upload filename extension when a request omits `format` (default `wav`). */
  readonly format?: string;
  /** Ceiling on accepted audio input; over-limit requests reject with `audio_too_large`. */
  readonly maxAudioBytes?: number;
}

interface OpenAITranscriptionUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
}

function assertAudio(request: TranscriptionRequest, maxBytes: number): void {
  if (request.audio.byteLength === 0) throw new TranscriptionError("empty_input", "transcribe requires non-empty audio");
  if (request.audio.byteLength > maxBytes) {
    throw new TranscriptionError(
      "audio_too_large",
      `OpenAI transcription accepts at most ${maxBytes} audio bytes; got ${request.audio.byteLength} — split the caller`,
    );
  }
}

function mapUsage(
  usage: OpenAITranscriptionUsage | undefined,
): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  if (!usage) return undefined;
  return {
    ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
  };
}

function buildForm(request: TranscriptionRequest, defaultFormat: string, stream: boolean): FormData {
  const format = request.format ?? defaultFormat;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(request.audio)], { type: `audio/${format}` }), `audio.${format}`);
  form.append("model", request.model);
  form.append("response_format", "json");
  if (request.language !== undefined) form.append("language", request.language);
  if (request.prompt !== undefined) form.append("prompt", request.prompt);
  if (stream) {
    form.append("stream", "true");
    form.append("stream_include_usage", "true");
  }
  return form;
}

export function createOpenAITranscriptionProvider(options: OpenAITranscriptionOptions = {}): TranscriptionProvider {
  const id = options.id ?? "openai";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? "https://api.openai.com/v1");
  const fetchImpl = options.fetch ?? fetch;
  const maxAudioBytes = options.maxAudioBytes ?? OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES;
  const defaultFormat = options.format ?? "wav";

  const send = async (request: TranscriptionRequest, stream: boolean): Promise<Response> => {
    assertAudio(request, maxAudioBytes);
    const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    // FormData body: the runtime sets the multipart content-type with its boundary.
    const response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        ...options.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: buildForm(request, defaultFormat, stream),
      signal: request.signal,
    });
    if (!response.ok) {
      const body = await readBoundedResponseText(response, { secrets: token ? [token] : [] });
      throw new TranscriptionError(
        "request_failed",
        `OpenAI transcription failed: ${response.status} ${redactSecrets(body, token ? [token] : [])}`,
      );
    }
    return response;
  };

  return {
    id,
    async transcribe(request): Promise<TranscriptionResult> {
      const response = await send(request, false);
      const payload = (await response.json()) as { text?: string; usage?: OpenAITranscriptionUsage };
      if (typeof payload.text !== "string") {
        throw new TranscriptionError("response_malformed", "OpenAI transcription response missing text");
      }
      const usage = mapUsage(payload.usage);
      return { text: payload.text, ...(usage ? { usage } : {}) };
    },
    async *transcribeStream(request): AsyncIterable<TranscriptEvent> {
      const response = await send(request, true);
      if (!response.body) throw new TranscriptionError("response_malformed", "OpenAI transcription stream missing body");
      for await (const data of readSseData(response.body, { signal: request.signal })) {
        let payload: { type?: string; text?: string; usage?: OpenAITranscriptionUsage };
        try {
          payload = JSON.parse(data);
        } catch {
          throw new TranscriptionError("response_malformed", "OpenAI transcription stream emitted a non-JSON event");
        }
        if (payload.type === "transcript.text.delta") {
          if (typeof payload.text !== "string") {
            throw new TranscriptionError("response_malformed", "OpenAI transcription delta missing text");
          }
          yield { type: "transcript_delta", text: payload.text };
        } else if (payload.type === "transcript.text.done") {
          const usage = mapUsage(payload.usage);
          yield {
            type: "done",
            ...(typeof payload.text === "string" ? { text: payload.text } : { text: "" }),
            ...(usage ? { usage } : {}),
          };
          return;
        } else if (payload.type === "error") {
          throw new TranscriptionError("request_failed", `OpenAI transcription stream error: ${data}`);
        }
      }
    },
  };
}
