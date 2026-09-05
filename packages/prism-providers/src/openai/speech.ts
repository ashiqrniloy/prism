/** OpenAI speech synthesis adapter over `POST {base}/audio/speech` (plan 061 Task 3).
 *  One-shot returns full bytes; the streaming variant returns the response body as a
 *  `ReadableStream<Uint8Array>` with a byte ceiling. Input caps reject with typed
 *  errors instead of truncating. Keys resolve through the existing
 *  `CredentialValueSource` seam and are redacted from every error. */

import type { SpeechProvider, SpeechRequest, SpeechResult, SpeechStreamResult } from "@arnilo/prism";
import { type CredentialValueSource, redactSecrets, resolveCredentialValue, SpeechError, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** OpenAI TTS input cap: at most 4,096 characters per request. */
export const OPENAI_SPEECH_MAX_INPUT_CHARS = 4096;

/** Default ceiling on a synthesized audio response (25 MiB, generous for TTS output). */
export const DEFAULT_SPEECH_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface OpenAISpeechOptions {
  readonly id?: string;
  readonly apiKey?: CredentialValueSource;
  /** Explicit base URL; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** Default voice when a request omits it (OpenAI's server default is `alloy`). */
  readonly voice?: string;
  /** Default audio format when a request omits it (OpenAI's server default is `mp3`). */
  readonly format?: string;
  /** Ceiling on synthesized audio bytes; over-limit responses reject with `response_malformed`. */
  readonly maxAudioBytes?: number;
}

async function _bearerHeaders(options: OpenAISpeechOptions, id: string): Promise<Record<string, string>> {
  const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
  return {
    ...options.headers,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function assertInput(request: SpeechRequest, maxChars: number): void {
  if (request.input.length === 0) throw new SpeechError("empty_input", "synthesize requires non-empty input");
  if (request.input.length > maxChars) {
    throw new SpeechError(
      "input_too_large",
      `OpenAI speech accepts at most ${maxChars} input characters; got ${request.input.length} — split the caller`,
    );
  }
}

/** Consume the body under a byte ceiling, cancelling the stream on overflow. */
async function readBoundedBytes(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new SpeechError("response_malformed", `OpenAI speech audio exceeded ${maxBytes} bytes`);
      parts.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream may already be closed
    }
  }
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    audio.set(part, offset);
    offset += part.byteLength;
  }
  return audio;
}

/** Wrap a body stream so consumption fails fast once the byte ceiling is crossed. */
function boundedAudioStream(body: ReadableStream<Uint8Array> | null, maxBytes: number): ReadableStream<Uint8Array> {
  if (!body) return new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new SpeechError("response_malformed", `OpenAI speech audio exceeded ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export function createOpenAISpeechProvider(options: OpenAISpeechOptions = {}): SpeechProvider {
  const id = options.id ?? "openai";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? "https://api.openai.com/v1");
  const fetchImpl = options.fetch ?? fetch;
  const maxAudioBytes = options.maxAudioBytes ?? DEFAULT_SPEECH_MAX_AUDIO_BYTES;
  const defaultFormat = options.format ?? "mp3";

  const send = async (request: SpeechRequest): Promise<Response> => {
    assertInput(request, OPENAI_SPEECH_MAX_INPUT_CHARS);
    const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    const response = await fetchImpl(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        ...options.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        ...((request.voice ?? options.voice) ? { voice: request.voice ?? options.voice } : {}),
        ...((request.format ?? defaultFormat) ? { response_format: request.format ?? defaultFormat } : {}),
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) {
      const body = await readBoundedResponseText(response, { secrets: token ? [token] : [] });
      throw new SpeechError("request_failed", `OpenAI speech failed: ${response.status} ${redactSecrets(body, token ? [token] : [])}`);
    }
    return response;
  };

  return {
    id,
    async synthesize(request): Promise<SpeechResult> {
      const response = await send(request);
      const audio = await readBoundedBytes(response.body, maxAudioBytes);
      return { audio, format: request.format ?? defaultFormat };
    },
    async synthesizeStream(request): Promise<SpeechStreamResult> {
      const response = await send(request);
      return { audio: boundedAudioStream(response.body, maxAudioBytes), format: request.format ?? defaultFormat };
    },
  };
}
