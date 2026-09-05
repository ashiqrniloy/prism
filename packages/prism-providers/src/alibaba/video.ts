/** Alibaba (DashScope) video generation adapter — plan 061 Task 5.
 *
 * wanx video models run through the same async task lifecycle as image
 * generation: submit with `X-DashScope-Async: enable`, poll the task endpoint
 * to a terminal state, then surface the provider's `video_url`. Text-to-video
 * uses `/video-synthesis/video-synthesis`; image-to-video (first `images`
 * entry) uses `/image2video/video-synthesis`.
 */
import {
  pinnedFetch,
  redactSecrets,
  resolveCredentialValue,
  VideoGenerationError,
  type VideoGenerationJob,
  type VideoGenerationProvider,
} from "@arnilo/prism";

/** DashScope wanx prompt cap — conservative shared ceiling with the image adapters. */
export const ALIBABA_VIDEO_PROMPT_MAX_CHARS = 800;
/** wanx video clips are short-form; hard ceiling rejects nonsense durations early. */
export const ALIBABA_VIDEO_MAX_DURATION_SECONDS = 20;

export interface AlibabaVideoGenerationOptions {
  readonly id?: string;
  readonly apiKey?: Parameters<typeof resolveCredentialValue>[0];
  /** Explicit base URL; defaults to the DashScope international endpoint. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Downloader for task result URLs; defaults to `pinnedFetch` (SSRF-guarded,
   *  DNS-pinned, byte-bounded). Inject a fake for offline tests. */
  readonly fetchUrl?: (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>;
  readonly headers?: Readonly<Record<string, string>>;
  /** Poll cadence for convenience only — the contract's `status` stays point-in-time. */
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
/** Videos are large; only invoked for `fetchUrl`-defaulted result downloads. */
const DEFAULT_RESULT_MAX_BYTES = 512 * 1024 * 1024;

/** Create a DashScope wanx `VideoGenerationProvider` (text- and image-to-video).
 *  Credentials resolve per call and are redacted from every thrown error. */
export function createAlibabaVideoGenerationProvider(
  options: AlibabaVideoGenerationOptions,
): VideoGenerationProvider & { waitFor(jobId: string, signal?: AbortSignal): Promise<VideoGenerationJob> } {
  const id = options.id ?? "alibaba";
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const maxResultBytes = DEFAULT_RESULT_MAX_BYTES;
  const _fetchUrl = options.fetchUrl ?? ((url, init) => pinnedFetch(url, { method: "GET", ...init }, { maxResponseBytes: maxResultBytes }));
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  // DashScope status responses do not echo the model; remember it per submitted
  // job so `status` can label provenance truthfully.
  // ponytail: in-memory job→model map; provenance model degrades to the adapter
  // id after a process restart — persist job metadata host-side if that matters.
  const jobModels = new Map<string, string>();

  const headers: Record<string, string> = { "Content-Type": "application/json", "X-DashScope-Async": "enable", ...options.headers };

  async function resolveApiKey(): Promise<string> {
    const apiKey = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    if (!apiKey)
      throw new VideoGenerationError("request_failed", "Alibaba video generation requires an API key (apiKey option or credential source)");
    headers.Authorization = `Bearer ${apiKey}`;
    return apiKey;
  }

  async function callDashScope(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const apiKey = await resolveApiKey();
    const redacted = { ...headers, Authorization: `Bearer ${apiKey}` };
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: redacted,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VideoGenerationError("request_failed", `Alibaba video request failed: ${redactSecrets(String(error), [apiKey])}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new VideoGenerationError(
        "request_failed",
        `Alibaba video request failed with status ${response.status}: ${redactSecrets(text || response.statusText, [apiKey])}`,
      );
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new VideoGenerationError("response_malformed", "Alibaba video response was not valid JSON");
    }
  }

  function mapState(taskStatus: string, label: string): Pick<VideoGenerationJob, "state" | "error"> {
    if (taskStatus === "SUCCEEDED") return { state: "succeeded" };
    if (taskStatus === "FAILED" || taskStatus === "CANCELED" || taskStatus === "UNKNOWN") {
      return { state: "failed", error: label || `DashScope task ended with status ${taskStatus}` };
    }
    if (taskStatus === "RUNNING" || taskStatus === "PAUSED") return { state: "running" };
    return { state: "queued" };
  }

  function extractVideo(payload: Record<string, unknown>, model: string): VideoGenerationJob {
    const output = (payload.output ?? {}) as Record<string, unknown>;
    const results = (output.results ?? []) as { url?: string }[];
    const url = results.find((entry) => typeof entry.url === "string")?.url;
    if (typeof url !== "string" || url.length === 0) {
      throw new VideoGenerationError("response_malformed", "Alibaba video task succeeded without a result video URL");
    }
    return {
      jobId: String(output.task_id ?? ""),
      state: "succeeded",
      video: { url, mimeType: "video/mp4", provider: id, model },
    };
  }

  async function poll(jobId: string, signal?: AbortSignal): Promise<VideoGenerationJob> {
    const apiKey = await resolveApiKey();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/tasks/${encodeURIComponent(jobId)}`, {
        method: "GET",
        headers: { ...headers, Authorization: `Bearer ${apiKey}` },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VideoGenerationError("request_failed", `Alibaba video status request failed: ${redactSecrets(String(error), [apiKey])}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new VideoGenerationError(
        "request_failed",
        `Alibaba video status request failed with status ${response.status}: ${redactSecrets(text || response.statusText, [apiKey])}`,
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new VideoGenerationError("response_malformed", "Alibaba video status response was not valid JSON");
    }
    const output = (payload.output ?? {}) as Record<string, unknown>;
    const taskStatus = String(output.task_status ?? "PENDING");
    const label = [output.code, output.message].filter((part) => typeof part === "string" && part.length > 0).join(" ");
    const mapped = mapState(taskStatus, label);
    if (mapped.state === "succeeded") return extractVideo(payload, jobModels.get(jobId) ?? id);
    return { jobId, ...mapped };
  }

  return {
    id,
    async submit(request) {
      if (request.prompt.length === 0) throw new VideoGenerationError("empty_input", "video prompt must not be empty");
      if (request.prompt.length > ALIBABA_VIDEO_PROMPT_MAX_CHARS) {
        throw new VideoGenerationError("input_too_large", `video prompt exceeds ${ALIBABA_VIDEO_PROMPT_MAX_CHARS} characters`);
      }
      if (request.durationSeconds !== undefined && request.durationSeconds > ALIBABA_VIDEO_MAX_DURATION_SECONDS) {
        throw new VideoGenerationError("input_too_large", `video duration exceeds ${ALIBABA_VIDEO_MAX_DURATION_SECONDS}s`);
      }
      const image = request.images?.[0];
      const path = image ? "/services/aigc/image2video/video-synthesis" : "/services/aigc/video-synthesis/video-synthesis";
      const input: Record<string, unknown> = { prompt: request.prompt };
      if (image) {
        const imageUrl = image.url ?? (image.data ? `data:${image.mimeType ?? "image/png"};base64,${image.data}` : undefined);
        if (!imageUrl) throw new VideoGenerationError("empty_input", "image-to-video requires an image with data or url");
        input.img_url = imageUrl;
      }
      const parameters: Record<string, unknown> = {};
      if (request.size) parameters.size = request.size;
      if (request.durationSeconds !== undefined) parameters.duration = request.durationSeconds;
      if (request.fps !== undefined) parameters.fps = request.fps;
      const payload = await callDashScope(
        path,
        { model: request.model, input, ...(Object.keys(parameters).length > 0 ? { parameters } : {}) },
        request.signal,
      );
      const output = (payload.output ?? {}) as Record<string, unknown>;
      const jobId = output.task_id;
      if (typeof jobId !== "string" || jobId.length === 0) {
        throw new VideoGenerationError("response_malformed", "Alibaba video submit response missing task_id");
      }
      jobModels.set(jobId, request.model);
      return { jobId };
    },
    status(jobId, signal) {
      return poll(jobId, signal);
    },
    async waitFor(jobId, signal) {
      // Convenience poll loop for hosts that do not want to own the cadence.
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const job = await this.status(jobId, signal);
        if (job.state === "succeeded" || job.state === "failed") return job;
        if (Date.now() >= deadline) {
          throw new VideoGenerationError("request_failed", `Alibaba video task ${jobId} did not finish within ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },
  };
}
