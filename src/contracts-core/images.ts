/** Provider-neutral image generation/editing contract (plan 061 Task 4).
 *  Generate (prompt→image[s]) and edit (image+mask+prompt) returning `Uint8Array`
 *  bytes plus provenance — hosts own persistence (no disk writes, no URL-only
 *  contract). Edit inputs reuse the existing `ImageContent` binary content parts.
 *  Adapters enforce prompt/content caps with typed errors — they never truncate. */
import type { ImageContent, ModelCapabilities, ModelConfig, Usage } from "./content.js";

export interface ImageGenerationRequest {
  readonly model: string;
  readonly prompt: string;
  /** Pixel dimensions, e.g. `1024x1024` (provider-defined vocabulary). */
  readonly size?: string;
  /** Output container, e.g. `png`, `jpeg`, `webp`. */
  readonly format?: string;
  /** Provider-defined quality tier, e.g. `standard` | `hd`. */
  readonly quality?: string;
  /** Number of images to generate (within the provider cap). */
  readonly count?: number;
  readonly signal?: AbortSignal;
}

export interface ImageEditRequest {
  readonly model: string;
  readonly prompt: string;
  /** Base image(s) as existing binary content parts (base64 `data` or `url`). */
  readonly images: readonly ImageContent[];
  /** Optional mask as an image content part (transparent areas mark edits). */
  readonly mask?: ImageContent;
  readonly size?: string;
  readonly format?: string;
  readonly count?: number;
  readonly signal?: AbortSignal;
}

/** One generated image: bytes plus provenance. `provider`/`model` are preserved
 *  end-to-end so hosts can attribute stored output. */
export interface GeneratedImage {
  readonly bytes: Uint8Array;
  /** e.g. `image/png`. */
  readonly mimeType: string;
  readonly provider: string;
  readonly model: string;
  /** Provider-native URL passthrough, when the provider returns one. */
  readonly url?: string;
  /** Provider-revised prompt, when the provider returns one. */
  readonly revisedPrompt?: string;
}

export interface ImageGenerationResult {
  readonly images: readonly GeneratedImage[];
  readonly usage?: Usage;
}

export interface ImageGenerationProvider {
  readonly id: string;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  edit(request: ImageEditRequest): Promise<ImageGenerationResult>;
}

export type ImageGenerationErrorCode =
  | "empty_input"
  | "input_too_large"
  | "unsupported_operation"
  | "request_failed"
  | "response_malformed"
  | "unsupported_model";

export class ImageGenerationError extends Error {
  readonly code: ImageGenerationErrorCode;

  constructor(code: ImageGenerationErrorCode, message: string) {
    super(message);
    this.name = "ImageGenerationError";
    this.code = code;
  }
}

export function modelSupportsImageGeneration(capabilities?: ModelCapabilities): boolean {
  return capabilities?.imageGeneration === true;
}

export function assertImageGenerationSupported(model: ModelConfig): void {
  if (!modelSupportsImageGeneration(model.capabilities)) {
    throw new ImageGenerationError(
      "unsupported_model",
      `Model ${model.provider}/${model.model} does not declare the imageGeneration capability`,
    );
  }
}
