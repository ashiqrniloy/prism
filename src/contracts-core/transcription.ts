/** Provider-neutral transcription contract (plan 061 Task 3).
 *  One-shot audio→text plus a streaming variant yielding partials; both share the
 *  `TranscriptDelta` event type aligned with `RealtimeEvent.transcript_delta` naming.
 *  Adapters enforce audio byte caps with typed errors — they never silently truncate. */
import type { ModelCapabilities, ModelConfig, Usage } from "./content.js";

export interface TranscriptionRequest {
  readonly model: string;
  /** Audio bytes to transcribe. */
  readonly audio: Uint8Array;
  /** Audio container hint, e.g. `wav`, `mp3`; the adapter maps it to an upload filename. */
  readonly format?: string;
  /** ISO-639-1 hint, e.g. `en`. */
  readonly language?: string;
  /** Optional spelling/style hint text. */
  readonly prompt?: string;
  readonly signal?: AbortSignal;
}

export interface TranscriptionResult {
  readonly text: string;
  /** Provider-reported token usage; absent when the provider does not report it. */
  readonly usage?: Usage;
}

/** Partial transcript. Naming mirrors `RealtimeEvent.transcript_delta` (no `role` —
 *  one-shot transcription has no speaker turn). */
export interface TranscriptDelta {
  readonly type: "transcript_delta";
  readonly text: string;
}

/** Terminal event: final full text plus optional usage. Exactly one per stream. */
export interface TranscriptDone {
  readonly type: "done";
  readonly text: string;
  readonly usage?: Usage;
}

export type TranscriptEvent = TranscriptDelta | TranscriptDone;

export interface TranscriptionProvider {
  readonly id: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  /** Yields `transcript_delta` partials in order, then exactly one `done`. */
  transcribeStream(request: TranscriptionRequest): AsyncIterable<TranscriptEvent>;
}

export type TranscriptionErrorCode = "empty_input" | "audio_too_large" | "request_failed" | "response_malformed" | "unsupported_model";

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;

  constructor(code: TranscriptionErrorCode, message: string) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
  }
}

export function modelSupportsTranscription(capabilities?: ModelCapabilities): boolean {
  return capabilities?.transcription === true;
}

export function assertTranscriptionSupported(model: ModelConfig): void {
  if (!modelSupportsTranscription(model.capabilities)) {
    throw new TranscriptionError(
      "unsupported_model",
      `Model ${model.provider}/${model.model} does not declare the transcription capability`,
    );
  }
}
