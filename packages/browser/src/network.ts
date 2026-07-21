/**
 * Browser egress policy and Playwright context routing (defense in depth).
 * Production DNS/private egress containment remains a host firewall/proxy.
 */
import { BrowserError } from "./errors.js";
import type { ResolvedBrowserLimits } from "./limits.js";
import type { PlaywrightBrowserContext, PlaywrightRoute } from "./types.js";

export type BrowserUrlDecision =
  | { readonly allowed: true; readonly url: URL; readonly kind: "http" | "https" | "ws" | "wss" }
  | { readonly allowed: false; readonly reason: string };

export interface BrowserNetworkPolicy {
  /**
   * When true, external browsing requires `containedProxyAttestation`.
   * Without attestation every non-blank request is aborted (fail closed).
   */
  readonly requireContainedProxy?: boolean;
  /**
   * Host attestation that real egress is forced through an isolated proxy/firewall.
   * Playwright routing alone is never treated as DNS containment.
   */
  readonly containedProxyAttestation?: {
    readonly proxyEndpoint: string;
    readonly denyDirectEgress: true;
  };
  /** Allow loopback destinations (default false). */
  readonly allowLoopback?: boolean;
  /** Allow private/link-local/ULA destinations (default false). */
  readonly allowPrivateHosts?: boolean;
  /** Optional host callback consulted after scheme/host checks. */
  readonly validateUrl?: (url: URL) => boolean | Promise<boolean>;
}

export interface NetworkBudget {
  requestCount: number;
  webSocketCount: number;
  readonly redirects: Map<string, number>;
}

export function createNetworkBudget(): NetworkBudget {
  return { requestCount: 0, webSocketCount: 0, redirects: new Map() };
}

const BLOCKED_SCHEMES = new Set([
  "file:",
  "data:",
  "blob:",
  "javascript:",
  "chrome:",
  "chrome-devtools:",
  "chrome-extension:",
  "devtools:",
  "view-source:",
]);

export function classifyBrowserUrl(
  raw: string,
  policy: BrowserNetworkPolicy = {},
): BrowserUrlDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "url is not absolute" };
  }

  if (url.protocol === "about:") {
    if (url.pathname === "blank" || url.href === "about:blank") {
      return { allowed: false, reason: "about:blank is not a navigable egress target" };
    }
    return { allowed: false, reason: `scheme ${url.protocol} is blocked` };
  }

  if (BLOCKED_SCHEMES.has(url.protocol)) {
    return { allowed: false, reason: `scheme ${url.protocol} is blocked` };
  }

  const kind =
    url.protocol === "http:"
      ? "http"
      : url.protocol === "https:"
        ? "https"
        : url.protocol === "ws:"
          ? "ws"
          : url.protocol === "wss:"
            ? "wss"
            : undefined;
  if (!kind) {
    return { allowed: false, reason: `unsupported scheme ${url.protocol}` };
  }

  if (url.username || url.password) {
    return { allowed: false, reason: "url userinfo is not allowed" };
  }

  const hostClass = classifyHost(url.hostname);
  if (hostClass === "loopback" && !policy.allowLoopback) {
    return { allowed: false, reason: "loopback destinations are denied by default" };
  }
  if ((hostClass === "private" || hostClass === "link-local" || hostClass === "ula") && !policy.allowPrivateHosts) {
    return { allowed: false, reason: "private/link-local destinations are denied by default" };
  }

  if (policy.requireContainedProxy !== false) {
    const attestation = policy.containedProxyAttestation;
    if (!attestation || attestation.denyDirectEgress !== true || !attestation.proxyEndpoint) {
      return {
        allowed: false,
        reason: "contained proxy attestation required for external browser egress",
      };
    }
    try {
      const proxy = new URL(attestation.proxyEndpoint);
      if (proxy.protocol !== "http:" && proxy.protocol !== "https:" && proxy.protocol !== "socks5:") {
        return { allowed: false, reason: "proxyEndpoint must be http(s) or socks5" };
      }
    } catch {
      return { allowed: false, reason: "proxyEndpoint is not a valid URL" };
    }
  }

  return { allowed: true, url, kind };
}

export function classifyHost(hostname: string): "public" | "loopback" | "private" | "link-local" | "ula" | "invalid" {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return "invalid";
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host === "0.0.0.0" || host === "::" || host === "0:0:0:0:0:0:0:0") return "loopback";

  if (isIpv4(host)) {
    const parts = host.split(".").map((p) => Number(p));
    const [a, b] = parts;
    if (a === 127) return "loopback";
    if (a === 10) return "private";
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 169 && b === 254) return "link-local";
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return "private"; // CGNAT
    if (a !== undefined && a >= 224) return "private"; // multicast/reserved treated as non-public
    return "public";
  }

  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("::1/") || host === "0:0:0:0:0:0:0:1") return "loopback";
    if (host.startsWith("fe80:") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
      return "link-local";
    }
    if (host.startsWith("fc") || host.startsWith("fd")) return "ula";
    if (host.startsWith("ff")) return "private";
    return "public";
  }

  // Hostnames without dots that are not localhost are still resolved by the browser;
  // treat as public for URL classification — DNS containment remains host-owned.
  return "public";
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

export async function assertBrowserUrlAllowed(
  raw: string,
  policy: BrowserNetworkPolicy = {},
): Promise<URL> {
  const decision = classifyBrowserUrl(raw, policy);
  if (!decision.allowed) {
    throw new BrowserError("ERR_PRISM_BROWSER_NETWORK", decision.reason);
  }
  if (policy.validateUrl) {
    const ok = await policy.validateUrl(decision.url);
    if (!ok) {
      throw new BrowserError("ERR_PRISM_BROWSER_NETWORK", "host validateUrl denied the URL");
    }
  }
  return decision.url;
}

export interface InstallNetworkRoutingOptions {
  readonly context: PlaywrightBrowserContext;
  readonly policy: BrowserNetworkPolicy;
  readonly limits: ResolvedBrowserLimits;
  readonly budget: NetworkBudget;
}

/**
 * Install context-wide request routing. Defense in depth only — not a DNS firewall.
 * Requires `serviceWorkers: "block"` on the context so routes observe requests.
 */
export async function installNetworkRouting(options: InstallNetworkRoutingOptions): Promise<() => void> {
  const { context, policy, limits, budget } = options;
  if (typeof context.route !== "function") {
    throw new BrowserError(
      "ERR_PRISM_BROWSER",
      "BrowserContext.route is required for network policy enforcement",
    );
  }

  const handler = async (route: PlaywrightRoute): Promise<void> => {
    try {
      const request = route.request();
      const url = request.url();
      // about:blank is the initial empty document — allow without charging egress budget.
      if (url === "about:blank") {
        await route.continue();
        return;
      }
      const resourceType = typeof request.resourceType === "function" ? request.resourceType() : undefined;
      const isWebSocket = resourceType === "websocket" || url.startsWith("ws:") || url.startsWith("wss:");

      if (isWebSocket) {
        if (budget.webSocketCount >= limits.maxWebSockets) {
          await route.abort("blockedbyclient");
          return;
        }
      } else if (budget.requestCount >= limits.maxNetworkRequests) {
        await route.abort("blockedbyclient");
        return;
      }

      const redirectedFrom = typeof request.redirectedFrom === "function" ? request.redirectedFrom() : null;
      if (redirectedFrom) {
        const key = redirectedFrom.url();
        const count = (budget.redirects.get(key) ?? 0) + 1;
        budget.redirects.set(key, count);
        if (count > limits.maxRedirectsPerRequest) {
          await route.abort("blockedbyclient");
          return;
        }
      }

      const decision = classifyBrowserUrl(url, policy);
      if (!decision.allowed) {
        await route.abort("blockedbyclient");
        return;
      }
      if (policy.validateUrl) {
        const ok = await policy.validateUrl(decision.url);
        if (!ok) {
          await route.abort("blockedbyclient");
          return;
        }
      }

      if (isWebSocket) budget.webSocketCount += 1;
      else budget.requestCount += 1;
      await route.continue();
    } catch {
      try {
        await route.abort("failed");
      } catch {
        /* ignore */
      }
    }
  };

  await context.route("**/*", handler);
  return () => {
    void context.unroute?.("**/*", handler).catch?.(() => undefined);
  };
}
