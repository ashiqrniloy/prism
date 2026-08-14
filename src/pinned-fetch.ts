/**
 * DNS-pinned outbound fetch primitive (0.2.1 task 4).
 *
 * One resolve per request, bounded to 1..32 addresses, family-verified, and
 * every candidate checked against `assertSsrfAllowedUrl` BEFORE the connect —
 * the connect itself uses a node lookup hook that returns exactly the pinned
 * address, so the socket cannot re-resolve (DNS-rebinding defense). Redirects
 * are rejected outright (3xx), and the response stream is byte-bounded.
 *
 * Throws `MediaContentError` (`ssrf_denied` for address violations, `redirect`
 * for 3xx). Error messages are parameterized by `errorPrefix` so each caller
 * (MCP, OIDC, OPA, content) keeps its own taxonomy and message text.
 *
 * NOTE: imports from ./content.js and is imported by it (content's default
 * media fetch routes through here) — a deliberate ESM cycle; both modules only
 * reference the other's exports inside function bodies, never at module scope.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { assertSsrfAllowedUrl, MediaContentError, type MediaHostAddress, type MediaHostnameResolver, type SsrfPolicy } from "./content.js";

export interface PinnedFetchOptions {
  /** Prefix for request-level error messages ("redirects are not allowed", "response exceeds", ...). Default "Request". */
  readonly errorPrefix?: string;
  /** Prefix for hostname-resolution error messages. Default: `errorPrefix`. */
  readonly hostnameErrorPrefix?: string;
  /** Custom resolver; defaults to `node:dns/promises` lookup (all answers, verbatim). */
  readonly resolver?: MediaHostnameResolver;
  /** Allow loopback destinations only when the requested hostname is itself loopback AND this is true. */
  readonly allowLoopback?: boolean;
  /** SSRF policy applied to the URL precheck and to every resolved candidate. */
  readonly ssrf?: SsrfPolicy;
  /** Byte ceiling for the response stream (content-length precheck + streaming bound). */
  readonly maxResponseBytes?: number;
}

/** One DNS-pinned, redirect-free, byte-bounded fetch. See module comment. */
export async function pinnedFetch(url: URL, init: RequestInit | undefined, options?: PinnedFetchOptions): Promise<Response> {
  const errorPrefix = options?.errorPrefix ?? "Request";
  if (url.username || url.password) throw new MediaContentError("ssrf_denied", `${errorPrefix} URL must not embed credentials`);
  if (url.hash) throw new MediaContentError("ssrf_denied", `${errorPrefix} URL must not contain a fragment`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MediaContentError("ssrf_denied", `${errorPrefix} URL must use https: (got ${url.protocol})`);
  }
  if (url.protocol === "http:" && !(options?.allowLoopback === true && isLoopbackHostname(url.hostname))) {
    throw new MediaContentError("ssrf_denied", `Plaintext ${errorPrefix} is allowed only for an explicitly enabled loopback endpoint`);
  }
  if (!(options?.allowLoopback === true && isLoopbackHostname(url.hostname))) {
    try {
      assertSsrfAllowedUrl(url.href, options?.ssrf);
    } catch (error) {
      if (error instanceof MediaContentError && error.code === "unsupported_url_scheme") throw error;
      throw new MediaContentError("ssrf_denied", `${errorPrefix} URL is not public`, { cause: error });
    }
  }
  const signal = init?.signal;
  const address = await resolvePinnedAddress(
    url,
    options?.resolver ?? defaultResolver,
    signal,
    options?.allowLoopback === true,
    options?.ssrf,
  );
  const response = await requestPinned(url, address, init, errorPrefix);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new MediaContentError("redirect", `${errorPrefix} redirects are not allowed (status ${response.status})`);
  }
  return options?.maxResponseBytes === undefined ? response : boundResponse(response, options.maxResponseBytes, errorPrefix);
}

export async function resolvePinnedAddress(
  url: URL,
  resolver: MediaHostnameResolver,
  signal: AbortSignal | null | undefined,
  allowLoopback: boolean,
  ssrf: SsrfPolicy | undefined,
  hostnameErrorPrefix = "Request",
): Promise<MediaHostAddress> {
  signal?.throwIfAborted();
  const hostname = normalizeHostname(url.hostname);
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : await raceAbort(resolver(hostname, signal ?? new AbortController().signal), signal);
  if (addresses.length < 1 || addresses.length > 32)
    throw new MediaContentError("fetch_failed", `${hostnameErrorPrefix} hostname returned an invalid address count`);

  for (const candidate of addresses) {
    const normalized = normalizeHostname(candidate.address);
    if (isIP(normalized) !== candidate.family)
      throw new MediaContentError("fetch_failed", `${hostnameErrorPrefix} hostname resolver returned an invalid address`);
    if (allowLoopback && isLoopbackHostname(hostname)) {
      if (!isLoopbackAddress(normalized))
        throw new MediaContentError("ssrf_denied", `${hostnameErrorPrefix} loopback hostname resolved outside loopback`);
      continue;
    }
    const literal = candidate.family === 6 ? `[${normalized}]` : normalized;
    // Fail closed on resolved candidates: an explicit hostname allow-list is honored
    // for the URL itself, but every resolved address is still private-checked.
    const candidatePolicy = ssrf?.allowedHostnames?.length ? { denyPrivateHosts: ssrf.denyPrivateHosts } : ssrf;
    try {
      assertSsrfAllowedUrl(`${url.protocol}//${literal}`, candidatePolicy);
    } catch (error) {
      throw new MediaContentError("ssrf_denied", `${hostnameErrorPrefix} hostname resolved to a private or non-public address`, {
        cause: error,
      });
    }
  }
  // ponytail: pin first validated address; add bounded public-address retry only if availability data requires it.
  const selected = addresses[0]!;
  return { address: normalizeHostname(selected.address), family: selected.family };
}

export async function defaultResolver(hostname: string): Promise<readonly MediaHostAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true }) as Promise<readonly MediaHostAddress[]>;
}

export async function requestPinned(
  url: URL,
  address: MediaHostAddress,
  init: RequestInit | undefined,
  errorPrefix = "Request",
): Promise<Response> {
  const body = await requestBody(init?.body, errorPrefix);
  const headers = new Headers(init?.headers);
  const method = init?.method ?? "GET";
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const nodeRequest = request(
      url,
      {
        method,
        headers: Object.fromEntries(headers.entries()),
        signal: init?.signal ?? undefined,
        lookup: ((_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: address.address, family: address.family }]);
          else callback(null, address.address, address.family);
        }) satisfies LookupFunction,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        const noBody = method === "HEAD" || incoming.statusCode === 204 || incoming.statusCode === 304;
        const iterator = incoming[Symbol.asyncIterator]();
        const stream = noBody
          ? null
          : new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const next = await iterator.next();
                  if (next.done) controller.close();
                  else controller.enqueue(new Uint8Array(next.value));
                } catch (error) {
                  controller.error(error);
                }
              },
              cancel(reason) {
                incoming.destroy(reason instanceof Error ? reason : undefined);
              },
            });
        resolve(
          new Response(stream, {
            status: incoming.statusCode ?? 500,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    nodeRequest.on("error", reject);
    if (body) nodeRequest.end(body);
    else nodeRequest.end();
  });
}

async function requestBody(body: BodyInit | null | undefined, errorPrefix: string): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new MediaContentError("ssrf_denied", `${errorPrefix} request body type is not supported by the pinned transport`);
}

export function boundResponse(response: Response, maxBytes: number, errorPrefix = "Request"): Response {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new MediaContentError("ssrf_denied", `${errorPrefix} response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          reader.releaseLock();
          controller.close();
          return;
        }
        bytes += next.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          reader.releaseLock();
          controller.error(new MediaContentError("ssrf_denied", `${errorPrefix} response exceeds ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        try {
          reader.releaseLock();
        } catch {
          /* Already released after EOF/overflow. */
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      try {
        reader.releaseLock();
      } catch {
        /* Already released after EOF/overflow. */
      }
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function normalizeHostname(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function isLoopbackHostname(value: string): boolean {
  const hostname = normalizeHostname(value);
  return hostname === "localhost" || hostname.endsWith(".localhost") || isLoopbackAddress(hostname);
}

export function isLoopbackAddress(value: string): boolean {
  const address = normalizeHostname(value);
  if (address === "::1") return true;
  if (isIP(address) !== 4) return false;
  return Number(address.split(".", 1)[0]) === 127;
}
