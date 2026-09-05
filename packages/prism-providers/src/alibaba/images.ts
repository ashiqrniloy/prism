/** Alibaba DashScope image generation adapter (plan 061 Task 4) — the independent
 *  second adapter. Wanx text-to-image is an async task API: submit with
 *  `X-DashScope-Async: enable`, then poll the task until it succeeds and fetch the
 *  result URLs through `pinnedFetch` (SSRF-guarded, byte-bounded) so the contract
 *  still returns bytes. DashScope has no first-party image-edit route; `edit`
 *  rejects with a typed `unsupported_operation` error. */

import type { ImageEditRequest, ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "@arnilo/prism";
import {
  type CredentialValueSource,
  ImageGenerationError,
  pinnedFetch,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** DashScope wanx per-request image cap (`n`). */
export const ALIBABA_IMAGE_MAX_COUNT = 4;

/** Default ceiling per fetched image payload (25 MiB). */
export const ALIBABA_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export interface AlibabaImageGenerationOptions {
  readonly id?: string;
  readonly apiKey?: CredentialValueSource;
  /** API origin; defaults to the DashScope Singapore endpoint. The native image
   *  routes hang off the region origin, not the OpenAI-compatible path. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Downloader for task result image URLs; defaults to `pinnedFetch` (SSRF-guarded,
   *  DNS-pinned, byte-bounded). Inject a fake for offline tests. */
  readonly fetchUrl?: (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly pollIntervalMs?: number;
  /** Wall-clock cap on the async task; rejects with `request_failed` when exceeded. */
  readonly timeoutMs?: number;
  /** Ceiling applied when downloading result images (25 MiB default). */
  readonly maxImageBytes?: number;
}

interface DashScopeTaskResponse {
  readonly output?: {
    readonly task_id?: string;
    readonly task_status?: string;
    readonly results?: readonly { readonly url?: string }[];
    readonly message?: string;
    readonly code?: string;
  };
  readonly usage?: { readonly image_count?: number };
}

const TERMINAL_OK = new Set(["SUCCEEDED"]);
const TERMINAL_FAIL = new Set(["FAILED", "CANCELED", "UNKNOWN"]);

function assertPrompt(prompt: string): void {
  if (prompt.length === 0) throw new ImageGenerationError("empty_input", "prompt must be non-empty");
  if (prompt.length > 800) {
    throw new ImageGenerationError(
      "input_too_large",
      `DashScope wanx prompts accept at most 800 characters; got ${prompt.length} — shorten the prompt`,
    );
  }
}

function assertCount(count: number | undefined): void {
  if (count !== undefined && count > ALIBABA_IMAGE_MAX_COUNT) {
    throw new ImageGenerationError(
      "input_too_large",
      `DashScope wanx accepts at most ${ALIBABA_IMAGE_MAX_COUNT} images per request; got ${count}`,
    );
  }
}

async function downloadImage(
  url: string,
  maxImageBytes: number,
  fetchUrl: (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetchUrl(new URL(url), { signal });
  if (!response.ok) {
    throw new ImageGenerationError("request_failed", `DashScope image result download failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxImageBytes) {
    throw new ImageGenerationError("response_malformed", `DashScope image result exceeded ${maxImageBytes} bytes`);
  }
  return bytes;
}

export function createAlibabaImageGenerationProvider(options: AlibabaImageGenerationOptions = {}): ImageGenerationProvider {
  const id = options.id ?? "alibaba";
  const origin = trimTrailingSlashes(options.baseUrl ?? "https://dashscope-intl.aliyuncs.com");
  const fetchImpl = options.fetch ?? fetch;
  const fetchUrl = options.fetchUrl ?? ((url, init) => pinnedFetch(url, { method: "GET", ...init }, { maxResponseBytes: maxImageBytes }));
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxImageBytes = options.maxImageBytes ?? ALIBABA_IMAGE_MAX_BYTES;

  async function submit(request: ImageGenerationRequest): Promise<string> {
    assertPrompt(request.prompt);
    assertCount(request.count);
    const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    const response = await fetchImpl(`${origin}/api/v1/services/aigc/text2image/image-synthesis`, {
      method: "POST",
      headers: {
        ...options.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        "x-dashscope-async": "enable",
      },
      body: JSON.stringify({
        model: request.model,
        input: { prompt: request.prompt },
        parameters: {
          ...(request.size ? { size: request.size } : {}),
          ...(request.count ? { n: request.count } : {}),
        },
      }),
      signal: request.signal,
    });
    if (!response.ok) {
      const body = await readBoundedResponseText(response, { secrets: token ? [token] : [] });
      throw new ImageGenerationError(
        "request_failed",
        `DashScope image task submit failed: ${response.status} ${redactSecrets(body, token ? [token] : [])}`,
      );
    }
    const payload = await readBoundedResponseJson<DashScopeTaskResponse>(response);
    const taskId = payload.output?.task_id;
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new ImageGenerationError("response_malformed", "DashScope image task submit missing task_id");
    }
    return taskId;
  }

  async function poll(taskId: string, signal?: AbortSignal): Promise<DashScopeTaskResponse> {
    const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      if (Date.now() > deadline) {
        throw new ImageGenerationError("request_failed", `DashScope image task ${taskId} did not finish within ${timeoutMs}ms`);
      }
      const response = await fetchImpl(`${origin}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          ...options.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal,
      });
      if (!response.ok) {
        const body = await readBoundedResponseText(response, { secrets: token ? [token] : [] });
        throw new ImageGenerationError(
          "request_failed",
          `DashScope image task poll failed: ${response.status} ${redactSecrets(body, token ? [token] : [])}`,
        );
      }
      const payload = await readBoundedResponseJson<DashScopeTaskResponse>(response);
      const status = payload.output?.task_status ?? "";
      if (TERMINAL_OK.has(status)) return payload;
      if (TERMINAL_FAIL.has(status)) {
        throw new ImageGenerationError(
          "request_failed",
          `DashScope image task failed: ${payload.output?.code ?? status} ${payload.output?.message ?? ""}`.trim(),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return {
    id,
    async generate(request): Promise<ImageGenerationResult> {
      const taskId = await submit(request);
      const payload = await poll(taskId, request.signal);
      const urls = (payload.output?.results ?? [])
        .map((entry) => entry.url)
        .filter((url): url is string => typeof url === "string" && url.length > 0);
      if (urls.length === 0) throw new ImageGenerationError("response_malformed", "DashScope image task succeeded without result URLs");
      const images = await Promise.all(
        urls.map(async (url) => ({
          bytes: await downloadImage(url, maxImageBytes, fetchUrl, request.signal),
          mimeType: "image/png",
          provider: id,
          model: request.model,
          url,
        })),
      );
      const imageCount = payload.usage?.image_count;
      return { images, ...(imageCount !== undefined ? { usage: { totalTokens: imageCount } } : {}) };
    },
    async edit(_request: ImageEditRequest): Promise<ImageGenerationResult> {
      throw new ImageGenerationError("unsupported_operation", "DashScope has no first-party image-edit route; use generate");
    },
  };
}
