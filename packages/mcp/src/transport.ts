import { assertSsrfAllowedUrl, isLoopbackHostname, MediaContentError, pinnedFetch } from "@arnilo/prism";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";
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
      ...(config.auth.onInsufficientScope !== undefined ? { onInsufficientScope: config.auth.onInsufficientScope } : {}),
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
  const allowLoopback = config.allowLoopbackHttp === true;

  return async (input, init) => {
    const url = input instanceof URL ? new URL(input.href) : new URL(typeof input === "string" ? input : input.url);
    if (allowedOrigins.has(url.origin)) return secureFetch(url, init);
    return oauthDiscoveryFetch(url, init, { resolver: config.resolveHostname, allowLoopback, limits });
  };
}

async function oauthDiscoveryFetch(
  url: URL,
  init: RequestInit | undefined,
  context: {
    readonly resolver: McpStreamableHttpTransport["resolveHostname"];
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
  try {
    // Discovery requests route through the shared core pinnedFetch primitive (task 4);
    // resolution errors keep their McpBridgeError taxonomy, redirects stay discovery errors.
    return await pinnedFetch(
      url,
      { ...init, headers, signal, redirect: "manual" },
      {
        errorPrefix: "OAuth discovery",
        hostnameErrorPrefix: "MCP",
        resolver: context.resolver,
        allowLoopback: context.allowLoopback,
        maxResponseBytes: context.limits.discoveryBytes,
      },
    );
  } catch (error) {
    if (error instanceof MediaContentError) {
      if (error.code === "redirect") throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_DISCOVERY", error.message, { cause: error });
      throw new McpBridgeError(error.message, { cause: error });
    }
    throw error;
  }
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
  return async (input, init) => {
    const url = input instanceof URL ? new URL(input.href) : new URL(typeof input === "string" ? input : input.url);
    validateRequestUrl(url, allowedOrigins, config.allowLoopbackHttp === true);
    if (url.origin !== endpoint.origin) {
      throw new McpBridgeError(`MCP HTTP request origin ${url.origin} does not match configured endpoint`);
    }
    const headers = new Headers(init?.headers);
    if (headers.has("host")) throw new McpBridgeError("MCP HTTP requests must not override Host");
    try {
      // Pinned resolution + redirect rejection + byte bound are the shared core
      // pinnedFetch primitive (task 4); errors keep their McpBridgeError taxonomy.
      return await pinnedFetch(
        url,
        { ...init, headers },
        {
          errorPrefix: "MCP HTTP",
          hostnameErrorPrefix: "MCP",
          resolver: config.resolveHostname,
          allowLoopback: config.allowLoopbackHttp === true,
          maxResponseBytes,
        },
      );
    } catch (error) {
      if (error instanceof MediaContentError) throw new McpBridgeError(error.message, { cause: error });
      throw error;
    }
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

export {
  boundResponse,
  defaultResolver,
  isLoopbackAddress,
  normalizeHostname,
  raceAbort,
  requestPinned,
  resolvePinnedAddress,
} from "@arnilo/prism";
// Lifted to the core pinnedFetch primitive in 0.2.1 (task 4); kept as re-exports
// so existing importers of these MCP transport helpers keep working.
export { isLoopbackHostname };
