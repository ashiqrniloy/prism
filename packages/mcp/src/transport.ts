import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { assertSsrfAllowedUrl, type MediaHostAddress, type MediaHostnameResolver } from "@arnilo/prism";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpClientAuth, type McpClientAuth, McpOAuthError, type ResolvedMcpOAuthLimits, resolveMcpOAuthLimits } from "./auth.js";
import { DEFAULT_MAX_HTTP_RESPONSE_BYTES, HARD_MAX_HTTP_RESPONSE_BYTES, validateMcpLimit } from "./limits.js";
import type { McpStreamableHttpTransport, McpTransportConfig } from "./types.js";
import { McpBridgeError } from "./types.js";

export function createMcpTransport(config: McpTransportConfig): Transport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args ? [...config.args] : undefined,
        env: config.env ? { ...config.env } : undefined,
        cwd: config.cwd,
        stderr: config.stderr,
      });
    case "streamable-http": {
      const url = validateEndpoint(config);
      if (config.auth) return createMcpOAuthTransport(config).transport;
      return new StreamableHTTPClientTransport(url, {
        requestInit: config.requestInit,
        sessionId: config.sessionId,
        fetch: createSecureMcpFetch(config),
      });
    }
    default: {
      const exhaustive: never = config;
      throw new McpBridgeError(`Unsupported MCP transport: ${(exhaustive as { type: string }).type}`);
    }
  }
}

/** OAuth-aware Streamable HTTP transport plus the auth handle (finishAuth/revoke). */
export function createMcpOAuthTransport(config: McpStreamableHttpTransport): {
  readonly transport: Transport;
  readonly auth: McpClientAuth;
} {
  if (!config.auth) throw new McpBridgeError("createMcpOAuthTransport requires an auth option");
  const url = validateEndpoint(config);
  const limits = resolveMcpOAuthLimits(config.auth.limits);
  const oauthFetch = createMcpOAuthFetch(config, limits);
  const auth = createMcpClientAuth(config.auth, { serverUrl: url, fetch: oauthFetch, limits });
  return {
    transport: new StreamableHTTPClientTransport(url, {
      requestInit: config.requestInit,
      sessionId: config.sessionId,
      authProvider: auth.provider,
      fetch: oauthFetch,
    }),
    auth,
  };
}

/**
 * Fetch seam for OAuth-enabled transports: requests against allow-listed
 * server origins keep the existing pinned secure policy; every other origin
 * (authorization server metadata, token/revocation endpoints) is treated as a
 * discovery endpoint — SSRF-checked, https-only (loopback opt-in), DNS-pinned,
 * redirect-free, byte-bounded, and stripped of any bearer credentials.
 */
export function createMcpOAuthFetch(
  config: McpStreamableHttpTransport,
  limits: ResolvedMcpOAuthLimits = resolveMcpOAuthLimits(config.auth?.limits),
): typeof globalThis.fetch {
  const allowedOrigins = resolveAllowedOrigins(config.allowedOrigins, config.allowLoopbackHttp === true);
  const secureFetch = createSecureMcpFetch(config);
  const resolver = config.resolveHostname ?? defaultResolver;
  const allowLoopback = config.allowLoopbackHttp === true;

  return async (input, init) => {
    const url = input instanceof URL ? new URL(input.href) : new URL(typeof input === "string" ? input : input.url);
    if (allowedOrigins.has(url.origin)) return secureFetch(url, init);
    return oauthDiscoveryFetch(url, init, { resolver, allowLoopback, limits });
  };
}

async function oauthDiscoveryFetch(
  url: URL,
  init: RequestInit | undefined,
  context: {
    readonly resolver: NonNullable<McpStreamableHttpTransport["resolveHostname"]>;
    readonly allowLoopback: boolean;
    readonly limits: ResolvedMcpOAuthLimits;
  },
): Promise<Response> {
  if (url.username || url.password) throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_SSRF", "OAuth discovery URL must not embed credentials");
  if (url.hash) throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_SSRF", "OAuth discovery URL must not contain a fragment");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_SSRF", `OAuth discovery URL must use https: (got ${url.protocol})`);
  }
  if (url.protocol === "http:" && !(context.allowLoopback && isLoopbackHostname(url.hostname))) {
    throw new McpOAuthError(
      "ERR_PRISM_MCP_OAUTH_SSRF",
      "Plaintext OAuth discovery is allowed only for an explicitly enabled loopback endpoint",
    );
  }
  if (!(context.allowLoopback && isLoopbackHostname(url.hostname))) {
    try {
      assertSsrfAllowedUrl(url.href);
    } catch (error) {
      throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_SSRF", "OAuth discovery URL is not public", { cause: error });
    }
  }
  // Discovery GETs never carry bearer credentials, even if the host configured
  // requestInit headers (confused-deputy defense); token/revocation POSTs keep
  // their own client authentication (Basic/secret_post) intact.
  const headers = new Headers(init?.headers);
  if ((init?.method ?? "GET") === "GET") {
    headers.delete("authorization");
    headers.delete("proxy-authorization");
  }
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(context.limits.handshakeTimeoutMs)])
    : AbortSignal.timeout(context.limits.handshakeTimeoutMs);
  const address = await resolvePinnedAddress(url, context.resolver, signal, context.allowLoopback);
  const response = await requestPinned(url, address, { ...init, headers, signal, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_DISCOVERY", `OAuth discovery redirects are not allowed (status ${response.status})`);
  }
  return boundResponse(response, context.limits.discoveryBytes);
}

/** Fetch seam used for every SDK POST/GET/DELETE, including sessions and reconnects. */
export function createSecureMcpFetch(config: McpStreamableHttpTransport): typeof globalThis.fetch {
  const endpoint = validateEndpoint(config);
  const allowedOrigins = resolveAllowedOrigins(config.allowedOrigins, config.allowLoopbackHttp === true);
  const maxResponseBytes = validateMcpLimit(
    "maxResponseBytes",
    config.maxResponseBytes ?? DEFAULT_MAX_HTTP_RESPONSE_BYTES,
    HARD_MAX_HTTP_RESPONSE_BYTES,
  );
  const resolver = config.resolveHostname ?? defaultResolver;

  return async (input, init) => {
    const url = input instanceof URL ? new URL(input.href) : new URL(typeof input === "string" ? input : input.url);
    validateRequestUrl(url, allowedOrigins, config.allowLoopbackHttp === true);
    if (url.origin !== endpoint.origin) {
      throw new McpBridgeError(`MCP HTTP request origin ${url.origin} does not match configured endpoint`);
    }
    const headers = new Headers(init?.headers);
    if (headers.has("host")) throw new McpBridgeError("MCP HTTP requests must not override Host");
    const address = await resolvePinnedAddress(url, resolver, init?.signal, config.allowLoopbackHttp === true);
    const response = await requestPinned(url, address, { ...init, headers });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new McpBridgeError(`MCP HTTP redirects are not allowed (status ${response.status})`);
    }
    return boundResponse(response, maxResponseBytes);
  };
}

function validateEndpoint(config: McpStreamableHttpTransport): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch (error) {
    throw new McpBridgeError(`Invalid MCP HTTP URL: ${config.url}`, { cause: error });
  }
  const allowedOrigins = resolveAllowedOrigins(config.allowedOrigins, config.allowLoopbackHttp === true);
  validateRequestUrl(url, allowedOrigins, config.allowLoopbackHttp === true);
  if (!allowedOrigins.has(url.origin)) throw new McpBridgeError(`MCP HTTP origin ${url.origin} is not allow-listed`);
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new McpBridgeError("Plaintext MCP HTTP is allowed only for an explicit loopback endpoint");
  }
  return url;
}

function resolveAllowedOrigins(values: readonly string[], allowLoopbackHttp: boolean): ReadonlySet<string> {
  if (!Array.isArray(values) || values.length < 1 || values.length > 64) {
    throw new McpBridgeError("allowedOrigins must contain 1..64 exact origins");
  }
  const origins = new Set<string>();
  for (const value of values) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new McpBridgeError(`Invalid MCP allowed origin: ${value}`);
    }
    if (value !== parsed.origin || parsed.username || parsed.password) {
      throw new McpBridgeError(`MCP allowed origin must be exact (scheme, host, optional port): ${value}`);
    }
    if (parsed.protocol !== "https:" && !(allowLoopbackHttp && parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))) {
      throw new McpBridgeError(`MCP allowed origin must use HTTPS: ${value}`);
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function validateRequestUrl(url: URL, allowedOrigins: ReadonlySet<string>, allowLoopbackHttp: boolean): void {
  if (url.username || url.password) throw new McpBridgeError("MCP HTTP URL must not embed credentials");
  if (url.hash) throw new McpBridgeError("MCP HTTP URL must not contain a fragment");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new McpBridgeError(`MCP HTTP URL must use https: (got ${url.protocol})`);
  }
  if (!allowedOrigins.has(url.origin)) throw new McpBridgeError(`MCP HTTP origin ${url.origin} is not allow-listed`);
  if (url.protocol === "http:") {
    if (!allowLoopbackHttp || !isLoopbackHostname(url.hostname)) {
      throw new McpBridgeError("Plaintext MCP HTTP is allowed only for an explicitly enabled loopback endpoint");
    }
  }
  if (!(allowLoopbackHttp && isLoopbackHostname(url.hostname))) {
    try {
      assertSsrfAllowedUrl(url.href);
    } catch (error) {
      throw new McpBridgeError("MCP HTTP URL is not public", { cause: error });
    }
  }
}

export async function resolvePinnedAddress(
  url: URL,
  resolver: MediaHostnameResolver,
  signal: AbortSignal | null | undefined,
  allowLoopback: boolean,
): Promise<MediaHostAddress> {
  signal?.throwIfAborted();
  const hostname = normalizeHostname(url.hostname);
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : await raceAbort(resolver(hostname, signal ?? new AbortController().signal), signal);
  if (addresses.length < 1 || addresses.length > 32) throw new McpBridgeError("MCP hostname returned an invalid address count");

  for (const candidate of addresses) {
    const normalized = normalizeHostname(candidate.address);
    if (isIP(normalized) !== candidate.family) throw new McpBridgeError("MCP hostname resolver returned an invalid address");
    if (allowLoopback && isLoopbackHostname(hostname)) {
      if (!isLoopbackAddress(normalized)) throw new McpBridgeError("MCP loopback hostname resolved outside loopback");
      continue;
    }
    const literal = candidate.family === 6 ? `[${normalized}]` : normalized;
    try {
      assertSsrfAllowedUrl(`${url.protocol}//${literal}`);
    } catch (error) {
      throw new McpBridgeError("MCP hostname resolved to a private or non-public address", { cause: error });
    }
  }
  // ponytail: pin first validated address; add bounded public-address retry only if availability data requires it.
  const selected = addresses[0]!;
  return { address: normalizeHostname(selected.address), family: selected.family };
}

export async function defaultResolver(hostname: string): Promise<readonly MediaHostAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true }) as Promise<readonly MediaHostAddress[]>;
}

export async function requestPinned(url: URL, address: MediaHostAddress, init: RequestInit): Promise<Response> {
  const body = await requestBody(init.body);
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const nodeRequest = request(
      url,
      {
        method,
        headers: Object.fromEntries(headers.entries()),
        signal: init.signal ?? undefined,
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

async function requestBody(body: BodyInit | null | undefined): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new McpBridgeError("MCP HTTP request body type is not supported by the pinned transport");
}

export function boundResponse(response: Response, maxBytes: number): Response {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new McpBridgeError(`MCP HTTP response exceeds ${maxBytes} bytes`);
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
          controller.error(new McpBridgeError(`MCP HTTP response exceeds ${maxBytes} bytes`));
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
    const abort = () => reject(signal.reason ?? new McpBridgeError("MCP HTTP request aborted"));
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
