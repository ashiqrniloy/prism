/** Provider-neutral speech synthesis contract (plan 061 Task 3).
 *  Text→audio bytes plus a streaming variant whose first chunk resolves as soon as the
 *  provider starts responding. Adapters enforce input caps with typed errors — they never
 *  silently truncate. Audio bytes use `Uint8Array`/`ReadableStream` (repo convention). */
import type { ModelCapabilities, ModelConfig } from "./content.js";

export interface SpeechRequest {
  readonly model: string;
  readonly input: string;
  /** Provider voice id, e.g. `alloy`. Adapter default when omitted. */
  readonly voice?: string;
  /** Audio container, e.g. `mp3`, `wav`, `opus`. Adapter default when omitted. */
  readonly format?: string;
  /** Playback speed multiplier (e.g. 0.25–4.0 on OpenAI). */
  readonly speed?: number;
  readonly signal?: AbortSignal;
}

export interface SpeechResult {
  readonly audio: Uint8Array;
  /** Actual audio container of `audio` (request value or provider default). */
  readonly format: string;
}

export interface SpeechStreamResult {
  /** Audio chunks in order; the first chunk is available as soon as the provider responds. */
  readonly audio: ReadableStream<Uint8Array>;
  /** Actual audio container of the stream (request value or provider default). */
  readonly format: string;
}

export interface SpeechProvider {
  readonly id: string;
  synthesize(request: SpeechRequest): Promise<SpeechResult>;
  synthesizeStream(request: SpeechRequest): Promise<SpeechStreamResult>;
}

export type SpeechErrorCode = "empty_input" | "input_too_large" | "request_failed" | "response_malformed" | "unsupported_model";

export class SpeechError extends Error {
  readonly code: SpeechErrorCode;

  constructor(code: SpeechErrorCode, message: string) {
    super(message);
    this.name = "SpeechError";
    this.code = code;
  }
}

export function modelSupportsSpeech(capabilities?: ModelCapabilities): boolean {
  return capabilities?.speech === true;
}

export function assertSpeechSupported(model: ModelConfig): void {
  if (!modelSupportsSpeech(model.capabilities)) {
    throw new SpeechError("unsupported_model", `Model ${model.provider}/${model.model} does not declare the speech capability`);
  }
}
