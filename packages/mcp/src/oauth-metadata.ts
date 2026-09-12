import { isLoopbackHostname } from "./transport.js";
import { McpBridgeError, type McpProtectedResource } from "./types.js";

/** RFC 9728 protected-resource metadata path served by the web handler. */
export const WELL_KNOWN_OAUTH_PROTECTED_RESOURCE = "/.well-known/oauth-protected-resource";

export interface NormalizedProtectedResource {
  readonly authorizationServers: readonly string[];
  readonly resource: string;
  readonly scopesSupported?: readonly string[];
}

const UNAUTHORIZED_BODY = { error: { message: "Unauthorized" } };

/** 401 challenge: RFC 9728 resource metadata pointer (and scope when declared). */
export function unauthorizedResponse(protectedResource: NormalizedProtectedResource | undefined, request: Request): Response {
  if (!protectedResource) return Response.json(UNAUTHORIZED_BODY, { status: 401 });
  const origin = new URL(request.url).origin;
  const scope = protectedResource.scopesSupported?.length ? `, scope="${protectedResource.scopesSupported.join(" ")}"` : "";
  const challenge = `Bearer resource_metadata="${origin}${WELL_KNOWN_OAUTH_PROTECTED_RESOURCE}"${scope}`;
  return Response.json(UNAUTHORIZED_BODY, { status: 401, headers: { "content-type": "application/json", "www-authenticate": challenge } });
}

export function normalizeProtectedResource(input: McpProtectedResource): NormalizedProtectedResource {
  if (!Array.isArray(input.authorizationServers) || input.authorizationServers.length < 1 || input.authorizationServers.length > 8) {
    throw new McpBridgeError("protectedResource.authorizationServers must contain 1..8 URLs");
  }
  const authorizationServers = input.authorizationServers.map((value) => validateProtectedResourceUrl(value, "authorization server"));
  if (typeof input.resource !== "string") {
    throw new McpBridgeError("protectedResource.resource is required (RFC 9728)");
  }
  const resource = validateProtectedResourceUrl(input.resource, "protected resource");
  let scopesSupported: readonly string[] | undefined;
  if (input.scopesSupported !== undefined) {
    if (!Array.isArray(input.scopesSupported) || input.scopesSupported.length < 1 || input.scopesSupported.length > 64) {
      throw new McpBridgeError("protectedResource.scopesSupported must contain 1..64 scopes");
    }
    for (const scope of input.scopesSupported) {
      if (typeof scope !== "string" || !scope.trim() || Buffer.byteLength(scope, "utf8") > 128) {
        throw new McpBridgeError("protectedResource.scopesSupported contains an invalid scope");
      }
      // RFC 7235 quoted-string safety: scope values reach the WWW-Authenticate
      // challenge, so reject anything outside the RFC 6749 scope-token charset
      // (no quotes, backslashes, or control characters).
      if (!/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope)) {
        throw new McpBridgeError("protectedResource.scopesSupported contains an invalid scope");
      }
    }
    if (Buffer.byteLength(JSON.stringify(input.scopesSupported), "utf8") > 8 * 1024) {
      throw new McpBridgeError("protectedResource.scopesSupported exceeds 8 KiB");
    }
    scopesSupported = [...input.scopesSupported];
  }
  return {
    authorizationServers,
    resource,
    ...(scopesSupported !== undefined ? { scopesSupported } : {}),
  };
}

function validateProtectedResourceUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpBridgeError(`${label} URL is invalid`);
  }
  if (url.username || url.password || url.hash) throw new McpBridgeError(`${label} URL must not embed credentials or fragments`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    throw new McpBridgeError(`${label} URL must use https: (plaintext loopback is allowed)`);
  }
  return url.href;
}

/** RFC 9728 protected-resource metadata document returned by the discovery route. */
export function protectedResourceMetadata(resource: NormalizedProtectedResource): {
  readonly authorization_servers: readonly string[];
  readonly resource: string;
  readonly scopes_supported?: readonly string[];
} {
  return {
    authorization_servers: resource.authorizationServers,
    resource: resource.resource,
    ...(resource.scopesSupported !== undefined ? { scopes_supported: resource.scopesSupported } : {}),
  };
}
