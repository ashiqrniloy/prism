import { isLoopbackHostname, type JsonValue, redactSecrets, resolveCredentialValue } from "@arnilo/prism";
import { resolveWebLimits } from "./limits.js";
import type { ResolvedWebLimits, WebAdapterOptions, WebProvider, WebProviderMetadata } from "./types.js";

export class WebToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WebToolError";
    this.code = code;
  }
}

/**
 * How a request may be retried, chosen by what a provider bills:
 * - `idempotent`: a GET — retry a connection failure and any 429/5xx.
 * - `safe-post`: a POST that creates or bills nothing twice on a 429 retry — retry a connection
 *   failure and a 429, never a 5xx (the request may already have been accepted).
 * - `never`: retry nothing, so a paid job is never submitted twice.
 */
export type WebRetryMode = "idempotent" | "safe-post" | "never";

export interface WebTransport {
  readonly limits: ResolvedWebLimits;
  run<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  json(
    provider: WebProvider,
    credentialName: string,
    url: URL,
    init: RequestInit,
    signal: AbortSignal,
    options?: { readonly retry?: WebRetryMode },
  ): Promise<{ value: unknown; metadata?: WebProviderMetadata }>;
}

/** How a transport authenticates and whether it may reach a plaintext loopback origin. */
export interface WebTransportOptions {
  /** Accept an `http://` origin only when its hostname is loopback (SearXNG on the same machine). */
  readonly allowLoopback?: boolean;
  /** `bearer` (default), `bot` (`Authorization: Bot <key>`, Kagi v1), or `none` (a keyless backend). */
  readonly auth?: "bearer" | "bot" | "none";
}

export function createWebTransport(
  provider: WebProvider,
  apiOrigin: string,
  options: WebAdapterOptions,
  transport: WebTransportOptions = {},
): WebTransport {
  const limits = resolveWebLimits(options.limits),
    origin = new URL(apiOrigin).origin;
  const allowed = (options.allowedOrigins ?? [origin]).map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new WebToolError("ERR_PRISM_WEB_ORIGIN", "Provider API origin is invalid");
    }
    // Plaintext is allowed only where it cannot leave the machine: an explicitly opted-in loopback origin.
    const loopback = parsed.protocol === "http:" && transport.allowLoopback === true && isLoopbackHostname(parsed.hostname);
    if (
      (!loopback && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      value !== parsed.origin
    )
      throw new WebToolError("ERR_PRISM_WEB_ORIGIN", "Provider API origins must be exact HTTPS origins (loopback HTTP only with allowLoopback)");
    return parsed.origin;
  });
  if (!allowed.includes(origin)) throw new WebToolError("ERR_PRISM_WEB_ORIGIN", `Required ${provider} API origin is not allowed`);
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (signal: AbortSignal) => {
    if (active < limits.maxConcurrency) {
      active++;
      return;
    }
    // Past the queue bound a call fails; up to it, a call waits for the next free slot.
    if (waiters.length >= limits.maxQueued) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "Web operation queue is full");
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", abort);
        active++;
        resolve();
      };
      const abort = () => {
        const i = waiters.indexOf(start);
        if (i >= 0) waiters.splice(i, 1);
        reject(signal.reason);
      };
      waiters.push(start);
      signal.addEventListener("abort", abort, { once: true });
    });
  };
  const release = () => {
    active--;
    waiters.shift()?.();
  };
  const sleep =
    options.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        try {
          signal.throwIfAborted();
        } catch (error) {
          reject(error);
          return;
        }
        const timer = setTimeout(done, ms);
        function done() {
          cleanup();
          resolve();
        }
        function abort() {
          clearTimeout(timer);
          cleanup();
          reject(signal.reason);
        }
        function cleanup() {
          signal.removeEventListener("abort", abort);
        }
        signal.addEventListener("abort", abort, { once: true });
      }));
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    limits,
    async run(signal, operation) {
      const timeout = AbortSignal.timeout(limits.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let acquired = false;
      try {
        combined.throwIfAborted();
        await acquire(combined);
        acquired = true;
        return await operation(combined);
      } catch (error) {
        if (combined.aborted)
          throw new WebToolError("ERR_PRISM_WEB_ABORTED", signal?.aborted ? "Web operation aborted" : "Web operation timed out");
        throw error;
      } finally {
        if (acquired) release();
      }
    },
    async json(_provider, credentialName, url, init, signal, request = {}) {
      const retry = request.retry ?? "idempotent";
      const mayRetryStatus = (status: number) =>
        retry === "idempotent" ? status === 429 || status >= 500 : retry === "safe-post" ? status === 429 : false;
      if (url.origin !== origin) throw new WebToolError("ERR_PRISM_WEB_ORIGIN", `${provider} request origin is not allowed`);
      let credential: string | undefined;
      if (transport.auth !== "none") {
        try {
          credential = await resolveCredentialValue(options.credentials, { provider, name: credentialName });
        } catch {
          throw new WebToolError("ERR_PRISM_WEB_CREDENTIAL", `${provider} credential resolution failed`);
        }
        if (!credential) throw new WebToolError("ERR_PRISM_WEB_CREDENTIAL", `${provider} credential is unavailable`);
      }
      const requestBytes = typeof init.body === "string" ? Buffer.byteLength(init.body) : 0;
      if (requestBytes > limits.maxRequestBytes) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "Web request exceeds byte limit");
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await fetcher(url, {
            ...init,
            redirect: "error",
            signal,
            headers: {
              "content-type": "application/json",
              ...init.headers,
              ...(credential === undefined
                ? {}
                : transport.auth === "bot"
                  ? { authorization: `Bot ${credential}` }
                  : provider === "brave"
                    ? { "x-subscription-token": credential }
                    : { authorization: `Bearer ${credential}` }),
            },
          });
        } catch (error) {
          if (signal.aborted) throw error;
          // A connection failure produced no response, so no retry mode rules it out except `never`.
          if (retry === "never" || attempt >= limits.maxRetries)
            throw new WebToolError("ERR_PRISM_WEB_REQUEST", `${provider} request failed`);
          await sleep(Math.min(250 * 2 ** attempt, limits.maxRateLimitDelayMs), signal);
          continue;
        }
        const metadata = responseMetadata(response);
        if (mayRetryStatus(response.status) && attempt < limits.maxRetries) {
          await response.body?.cancel();
          await sleep(Math.min(metadata?.rate?.retryAfterMs ?? 250 * 2 ** attempt, limits.maxRateLimitDelayMs), signal);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new WebToolError("ERR_PRISM_WEB_RESPONSE", `${provider} request failed with status ${response.status}`);
        }
        const text = await readBoundedText(response, limits.maxResponseBytes, signal);
        try {
          const value: unknown = redactSecrets(JSON.parse(text), credential === undefined ? [] : [credential]);
          assertBoundedJson(value, limits.maxJsonDepth, limits.maxJsonProperties, limits.maxResponseBytes);
          return { value, metadata };
        } catch (error) {
          if (error instanceof WebToolError) throw error;
          throw new WebToolError("ERR_PRISM_WEB_RESPONSE", `${provider} returned invalid JSON`);
        }
      }
    },
  };
}

export function boundedJson<T>(value: T, maxDepth: number, maxProperties: number, maxBytes: number): T {
  let clone: T;
  try {
    // Deliberate JSON round-trip, not structuredClone: normalizes the value to its wire shape (drops undefined keys) before bounds validation.
    clone = JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new WebToolError("ERR_PRISM_WEB_JSON", "JSON value is cyclic or unserializable");
  }
  assertBoundedJson(clone, maxDepth, maxProperties, maxBytes);
  return clone;
}

export function assertBoundedJson(value: unknown, maxDepth: number, maxProperties: number, maxBytes: number): asserts value is JsonValue {
  let properties = 0,
    bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new WebToolError("ERR_PRISM_WEB_JSON", "JSON value is cyclic or unserializable");
  }
  if (bytes > maxBytes) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "JSON value exceeds byte limit");
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length) {
    const [entry, depth] = stack.pop()!;
    if (depth > maxDepth) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "JSON value exceeds depth limit");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new WebToolError("ERR_PRISM_WEB_JSON", "JSON number must be finite");
      continue;
    }
    if (typeof entry !== "object") throw new WebToolError("ERR_PRISM_WEB_JSON", "Value is not JSON");
    const values = Array.isArray(entry) ? entry : Object.values(entry);
    if (!Array.isArray(entry)) {
      for (const key of Object.keys(entry))
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new WebToolError("ERR_PRISM_WEB_JSON", "JSON contains forbidden key");
      properties += values.length;
      if (properties > maxProperties) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "JSON value exceeds property limit");
    }
    for (const child of values) stack.push([child, depth + 1]);
  }
}

async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new WebToolError("ERR_PRISM_WEB_LIMIT", "Web response exceeds byte limit");
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
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
/** `Retry-After` is either delay-seconds or an HTTP date (RFC 9110 §10.2.3); both become a delay from now. */
function retryAfterDelayMs(header: string | null): number | undefined {
  if (!header) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(header)) return Number(header) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function responseMetadata(response: Response): WebProviderMetadata | undefined {
  const number = (name: string) => {
    const value = response.headers.get(name);
    return value && /^\d+$/u.test(value) ? Number(value) : undefined;
  };
  const retryAfterMs = retryAfterDelayMs(response.headers.get("retry-after"));
  const metadata = {
    requestId: response.headers.get("x-request-id") ?? undefined,
    rate: {
      limit: number("x-ratelimit-limit"),
      remaining: number("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset") ?? undefined,
      retryAfterMs,
    },
  };
  return metadata.requestId || Object.values(metadata.rate).some((v) => v !== undefined) ? metadata : undefined;
}
