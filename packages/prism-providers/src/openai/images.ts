/** OpenAI-compatible image generation/editing adapter over `POST {base}/images/generations`
 *  and `POST {base}/images/edits` (plan 061 Task 4). Always requests `b64_json` so the
 *  contract returns bytes (hosts own persistence); provenance (`provider`/`model`) is
 *  preserved per image. Edit inputs reuse the existing `ImageContent` parts — base64
 *  `data` is decoded, `url` parts are resolved through `pinnedFetch` (SSRF-guarded,
 *  byte-bounded). Keys resolve through the existing `CredentialValueSource` seam and are
 *  redacted from every error. */

import type { GeneratedImage, ImageContent, ImageGenerationProvider, ImageGenerationResult } from "@arnilo/prism";
import {
  type CredentialValueSource,
  ImageGenerationError,
  pinnedFetch,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** OpenAI image prompt cap (gpt-image-1); older models are stricter server-side. */
export const OPENAI_IMAGE_PROMPT_MAX_CHARS = 32_000;

/** OpenAI per-request image cap (`n`). */
export const OPENAI_IMAGE_MAX_COUNT = 10;

/** Default ceiling per fetched image payload (25 MiB). */
export const DEFAULT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export interface OpenAIImageGenerationOptions {
  readonly id?: string;
  readonly apiKey?: CredentialValueSource;
  /** Explicit base URL; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Resolver for `url`-based edit inputs; defaults to `pinnedFetch` (SSRF-guarded,
   *  DNS-pinned, byte-bounded). Inject a fake for offline tests. */
  readonly fetchUrl?: (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>;
  readonly headers?: Readonly<Record<string, string>>;
  /** Ceiling applied when resolving `url`-based edit inputs or provider URLs (25 MiB default). */
  readonly maxImageBytes?: number;
}

interface OpenAIImageResponse {
  readonly data?: readonly {
    readonly b64_json?: string;
    readonly url?: string;
    readonly revised_prompt?: string;
    readonly output_format?: string;
  }[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly total_tokens?: number };
}

function assertPrompt(prompt: string): void {
  if (prompt.length === 0) throw new ImageGenerationError("empty_input", "prompt must be non-empty");
  if (prompt.length > OPENAI_IMAGE_PROMPT_MAX_CHARS) {
    throw new ImageGenerationError(
      "input_too_large",
      `OpenAI image prompts accept at most ${OPENAI_IMAGE_PROMPT_MAX_CHARS} characters; got ${prompt.length} — shorten the prompt`,
    );
  }
}

function assertCount(count: number | undefined): void {
  if (count !== undefined && count > OPENAI_IMAGE_MAX_COUNT) {
    throw new ImageGenerationError(
      "input_too_large",
      `OpenAI images accept at most ${OPENAI_IMAGE_MAX_COUNT} images per request; got ${count}`,
    );
  }
}

function mapUsage(usage: OpenAIImageResponse["usage"]): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  if (!usage) return undefined;
  return {
    ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
  };
}

function decodeBase64(b64: string): Uint8Array {
  try {
    const decoded = Buffer.from(b64, "base64");
    // Node's base64 decoder is lenient — canonical round-trip catches invalid input.
    if (decoded.length === 0 || decoded.toString("base64") !== b64) throw new Error("non-canonical base64");
    return new Uint8Array(decoded);
  } catch {
    throw new ImageGenerationError("response_malformed", "OpenAI images response contained an invalid base64 payload");
  }
}

function mimeTypeFor(format: string | undefined): string {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

/** Bytes for an edit input part: base64 `data` decoded inline; `url` parts resolved
 *  through the injected URL resolver (default `pinnedFetch`). */
async function partBytes(
  part: ImageContent,
  maxImageBytes: number,
  fetchUrl: (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (typeof part.data === "string" && part.data.length > 0) return decodeBase64(part.data);
  if (typeof part.url === "string" && part.url.length > 0) {
    const response = await fetchUrl(new URL(part.url), { signal });
    if (!response.ok) {
      throw new ImageGenerationError("request_failed", `OpenAI image edit could not fetch input image: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxImageBytes) {
      throw new ImageGenerationError("input_too_large", `Edit input image exceeded ${maxImageBytes} bytes`);
    }
    return bytes;
  }
  throw new ImageGenerationError("empty_input", "Edit image parts must carry base64 data or a url");
}

export function createOpenAIImageGenerationProvider(options: OpenAIImageGenerationOptions = {}): ImageGenerationProvider {
  const id = options.id ?? "openai";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? "https://api.openai.com/v1");
  const fetchImpl = options.fetch ?? fetch;
  const fetchUrl = options.fetchUrl ?? ((url, init) => pinnedFetch(url, { method: "GET", ...init }, { maxResponseBytes: maxImageBytes }));
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_IMAGE_MAX_BYTES;

  const sendJson = async (path: string, body: unknown, signal?: AbortSignal): Promise<OpenAIImageResponse> => {
    const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...options.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const errorBody = await readBoundedResponseText(response, { secrets: token ? [token] : [] });
      throw new ImageGenerationError(
        "request_failed",
        `OpenAI images failed: ${response.status} ${redactSecrets(errorBody, token ? [token] : [])}`,
      );
    }
    return readBoundedResponseJson<OpenAIImageResponse>(response);
  };

  const mapImages = (payload: OpenAIImageResponse, provider: string, model: string): GeneratedImage[] => {
    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      throw new ImageGenerationError("response_malformed", "OpenAI images response missing data array");
    }
    // One allocation per image: decode b64 once, no re-encode loops.
    return payload.data.map((entry, index) => {
      if (typeof entry.b64_json !== "string" || entry.b64_json.length === 0) {
        throw new ImageGenerationError("response_malformed", `OpenAI images response missing b64_json at index ${index}`);
      }
      return {
        bytes: decodeBase64(entry.b64_json),
        mimeType: mimeTypeFor(entry.output_format),
        provider,
        model,
        ...(entry.url ? { url: entry.url } : {}),
        ...(entry.revised_prompt ? { revisedPrompt: entry.revised_prompt } : {}),
      };
    });
  };

  return {
    id,
    async generate(request): Promise<ImageGenerationResult> {
      assertPrompt(request.prompt);
      assertCount(request.count);
      const payload = await sendJson(
        "/images/generations",
        {
          model: request.model,
          prompt: request.prompt,
          response_format: "b64_json",
          ...(request.size ? { size: request.size } : {}),
          ...(request.format ? { output_format: request.format } : {}),
          ...(request.quality ? { quality: request.quality } : {}),
          ...(request.count ? { n: request.count } : {}),
        },
        request.signal,
      );
      const images = mapImages(payload, id, request.model);
      const usage = mapUsage(payload.usage);
      return { images, ...(usage ? { usage } : {}) };
    },
    async edit(request): Promise<ImageGenerationResult> {
      assertPrompt(request.prompt);
      assertCount(request.count);
      if (request.images.length === 0) throw new ImageGenerationError("empty_input", "edit requires at least one input image");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const form = new FormData();
      for (const part of request.images) {
        const bytes = await partBytes(part, maxImageBytes, fetchUrl, request.signal);
        form.append("image[]", new Blob([new Uint8Array(bytes)], { type: mimeTypeFor(part.mimeType?.split("/")[1]) }), "image.png");
      }
      if (request.mask) {
        const maskBytes = await partBytes(request.mask, maxImageBytes, fetchUrl, request.signal);
        form.append("mask", new Blob([new Uint8Array(maskBytes)], { type: "image/png" }), "mask.png");
      }
      form.append("model", request.model);
      form.append("prompt", request.prompt);
      if (request.size) form.append("size", request.size);
      if (request.count) form.append("n", String(request.count));
      const response = await fetchImpl(`${baseUrl}/images/edits`, {
        method: "POST",
        headers: {
          ...options.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: form,
        signal: request.signal,
      });
      if (!response.ok) {
        const errorBody = await readBoundedResponseText(response, { secrets: token ? [token] : [] });
        throw new ImageGenerationError(
          "request_failed",
          `OpenAI image edit failed: ${response.status} ${redactSecrets(errorBody, token ? [token] : [])}`,
        );
      }
      const payload = await readBoundedResponseJson<OpenAIImageResponse>(response);
      const images = mapImages(payload, id, request.model);
      const usage = mapUsage(payload.usage);
      return { images, ...(usage ? { usage } : {}) };
    },
  };
}
