import { type AgentIdentity, pinnedFetch } from "@arnilo/prism";
import { WorkToolError } from "./errors.js";
import type { ResolvedWorkLimits, WorkTokenProvider } from "./types.js";

interface WorkHttpClientOptions {
  readonly identity: AgentIdentity;
  readonly tokenProvider: WorkTokenProvider;
  readonly accessEnvVar: string;
  readonly allowedOrigins: readonly string[];
  readonly limits: ResolvedWorkLimits;
  readonly fetch?: typeof globalThis.fetch;
}

interface WorkHttpRequest {
  readonly url: URL;
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly body?: string | Uint8Array;
  readonly responseType?: "bytes";
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}

type WorkHttpClient = (request: WorkHttpRequest) => Promise<unknown>;

/** Creates a bounded, pinned, token-at-the-edge HTTP client for work adapters. */
export function createWorkHttpClient(options: WorkHttpClientOptions): WorkHttpClient {
  const allowedOrigins = new Set(options.allowedOrigins);

  return async (request) => {
    if (!allowedOrigins.has(request.url.origin)) {
      throw new WorkToolError("ERR_PRISM_WORK_POLICY", `Connector request origin ${request.url.origin} is not allowed`);
    }
    const env = await options.tokenProvider.tokenEnv(options.identity, request.signal);
    const token = env?.[options.accessEnvVar];
    if (typeof token !== "string" || !token) {
      throw new WorkToolError("ERR_PRISM_WORK_CREDENTIAL", "Connector credential unavailable, expired, or revoked");
    }
    if (request.body !== undefined && bodyBytes(request.body) > options.limits.maxRequestBytes) {
      throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Request body exceeds byte limit");
    }
    const maxResponseBytes = request.maxResponseBytes ?? options.limits.maxResponseBytes;
    if (
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes < 0 ||
      (request.responseType === "bytes" && maxResponseBytes > options.limits.maxFileBytes)
    ) {
      throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Response byte limit is invalid");
    }

    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", request.responseType === "bytes" ? "application/octet-stream" : "application/json");
    let response: Response;
    try {
      response = await (
        options.fetch ??
        ((url: URL, init?: RequestInit) => pinnedFetch(url, init, { errorPrefix: "Work connector HTTP", maxResponseBytes }))
      )(request.url, {
        method: request.method ?? "GET",
        headers,
        ...(request.body === undefined ? {} : { body: request.body as unknown as BodyInit }),
        signal: request.signal,
      });
    } catch {
      throw new WorkToolError("ERR_PRISM_WORK_HTTP", "Connector request failed");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WorkToolError("ERR_PRISM_WORK_HTTP", `Connector request failed (${response.status})`);
    }
    if (request.responseType === "bytes") return readBytes(response, maxResponseBytes, request.signal);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Response body exceeds byte limit");
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new WorkToolError("ERR_PRISM_WORK_HTTP", "Connector response was not valid JSON");
    }
  };
}

async function readBytes(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Response body exceeds byte limit");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Response body exceeds byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bodyBytes(value: string | Uint8Array): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
}
