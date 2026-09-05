/** Provider-neutral video generation contract (plan 061 Task 5).
 *
 * Minimal submit/status shape — video jobs run minutes, not seconds, so unlike
 * image generation there is no synchronous `generate`. Hosts poll `status`
 * (or a fake transport in conformance runs) and own download/persistence of
 * the resulting video. Input video as a chat content part is the typed
 * `VideoContent` block with the `"video"` input capability (see content.ts).
 */
import type { ImageContent, ModelCapabilities, ModelConfig, Usage } from "./content.js";

/** States mirror the DashScope/OpenAI async job lifecycle; terminal states are
 *  `succeeded` and `failed`. */
export type VideoGenerationJobState = "queued" | "running" | "succeeded" | "failed";

export type VideoGenerationErrorCode =
  | "empty_input"
  | "input_too_large"
  | "unsupported_model"
  | "request_failed"
  | "response_malformed"
  | "unsupported_operation";

export class VideoGenerationError extends Error {
  readonly code: VideoGenerationErrorCode;

  constructor(code: VideoGenerationErrorCode, message: string) {
    super(message);
    this.name = "VideoGenerationError";
    this.code = code;
  }
}

export function modelSupportsVideoGeneration(capabilities?: ModelCapabilities): boolean {
  return capabilities?.videoGeneration === true;
}

export function assertVideoGenerationSupported(model: ModelConfig): void {
  if (!modelSupportsVideoGeneration(model.capabilities)) {
    throw new VideoGenerationError(
      "unsupported_model",
      `Model ${model.provider}/${model.model} does not declare the videoGeneration capability`,
    );
  }
}

/** Video generation request: text-to-video by default; pass `images` (first
 *  entry wins) for image-to-video providers. Provider-defined vocabulary for
 *  `size` (e.g. `1280x720`), `durationSeconds`, and `fps`. */
export interface VideoGenerationRequest {
  readonly model: string;
  readonly prompt: string;
  readonly images?: readonly ImageContent[];
  readonly size?: string;
  readonly durationSeconds?: number;
  readonly fps?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** Provider job handle from `submit`; poll with `status(jobId)`. */
export interface VideoGenerationJobHandle {
  readonly jobId: string;
}

/** The generated video. At least one of `bytes` or `url` is present when the
 *  job succeeded; provenance (`provider`/`model`) is always preserved. */
export interface GeneratedVideo {
  readonly bytes?: Uint8Array;
  readonly url?: string;
  readonly mimeType?: string;
  readonly provider: string;
  readonly model: string;
  readonly durationSeconds?: number;
}

/** Point-in-time job state; `video` only on `succeeded`, `error` only on `failed`. */
export interface VideoGenerationJob {
  readonly jobId: string;
  readonly state: VideoGenerationJobState;
  readonly video?: GeneratedVideo;
  readonly error?: string;
  readonly usage?: Usage;
}

export interface VideoGenerationProvider {
  readonly id: string;
  /** Submit a job; never blocks on generation. */
  submit(request: VideoGenerationRequest): Promise<VideoGenerationJobHandle>;
  /** Point-in-time status probe — host-owned polling loop. */
  status(jobId: string, signal?: AbortSignal): Promise<VideoGenerationJob>;
}
