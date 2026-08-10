/**
 * Chrome DevTools Protocol session layer (0.1.4, plan 016 Task 4).
 * Rides playwright-core's existing CDP transport (context.newCDPSession(page)) —
 * zero new dependencies, host-supplied Chromium browser only, Prism never
 * launches or downloads browsers. Domain allowlist: Runtime, Network, Emulation.
 * No cookies/tracing/IndexedDB/worker-attach domains in 0.1.4.
 */
import { BrowserError } from "./errors.js";
import type { BrowserCdpOptions, PlaywrightBrowser, PlaywrightBrowserContext, PlaywrightCdpSession, PlaywrightPage } from "./types.js";

export type CdpMode = "auto" | "on" | "off";

export function resolveCdpMode(options?: BrowserCdpOptions): CdpMode {
  return options?.mode ?? "auto";
}

/**
 * Chromium-only capability signal. Playwright exposes page-level CDP sessions
 * only for Chromium; belt-and-braces: version() strings prefixed firefox-/webkit-
 * are treated as non-CDP even if a host layered newCDPSession on them.
 */
export function cdpAvailable(browser: PlaywrightBrowser, context: PlaywrightBrowserContext): boolean {
  if (typeof context.newCDPSession !== "function") return false;
  const version = browser.version?.() ?? "";
  if (/^(firefox|webkit)-/u.test(version)) return false;
  return true;
}

/** Create a page-level CDP session or throw ERR_PRISM_BROWSER_CDP_UNAVAILABLE. */
export async function createPageCdpSession(
  browser: PlaywrightBrowser,
  context: PlaywrightBrowserContext,
  page: PlaywrightPage,
): Promise<PlaywrightCdpSession> {
  if (!cdpAvailable(browser, context)) {
    throw new BrowserError(
      "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
      "CDP requires a Chromium-based host browser whose contexts expose newCDPSession(page)",
    );
  }
  try {
    const session = await context.newCDPSession!(page);
    if (!session || typeof session.send !== "function") {
      throw new BrowserError("ERR_PRISM_BROWSER_CDP_UNAVAILABLE", "Host newCDPSession did not return a usable CDP session");
    }
    return session;
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    throw new BrowserError(
      "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
      `CDP session creation failed: ${error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256)}`,
    );
  }
}

/** Bounded JSON-serializable value carried by a CDP RemoteObject. */
export interface CdpRemoteObject {
  readonly type?: string;
  readonly subtype?: string;
  readonly value?: unknown;
  readonly description?: string;
}

export interface CdpExceptionDetails {
  readonly text?: string;
  readonly url?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
  readonly exception?: CdpRemoteObject;
}

export interface CdpRuntimeEvaluateResponse {
  readonly result?: CdpRemoteObject;
  readonly exceptionDetails?: CdpExceptionDetails;
}

export async function cdpRuntimeEvaluate(
  session: PlaywrightCdpSession,
  params: {
    expression: string;
    awaitPromise?: boolean;
    returnByValue?: boolean;
    userGesture?: boolean;
    timeout?: number;
  },
): Promise<CdpRuntimeEvaluateResponse> {
  try {
    return await session.send<CdpRuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: params.expression,
      awaitPromise: params.awaitPromise === true,
      returnByValue: params.returnByValue === true,
      userGesture: params.userGesture === true,
      ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
    });
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpRuntimeEnable(session: PlaywrightCdpSession): Promise<void> {
  try {
    await session.send("Runtime.enable");
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpNetworkEnable(session: PlaywrightCdpSession): Promise<void> {
  try {
    await session.send("Network.enable");
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpNetworkSetBlockedUrls(session: PlaywrightCdpSession, urls: readonly string[]): Promise<void> {
  try {
    await session.send("Network.setBlockedURLs", { urls: [...urls] });
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpNetworkEmulateConditions(
  session: PlaywrightCdpSession,
  params: { offline: boolean; latencyMs: number; downloadThroughputBps: number; uploadThroughputBps: number },
): Promise<void> {
  try {
    await session.send("Network.emulateNetworkConditions", {
      offline: params.offline,
      latency: params.latencyMs,
      downloadThroughput: params.downloadThroughputBps,
      uploadThroughput: params.uploadThroughputBps,
    });
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpEmulationSetDeviceMetrics(
  session: PlaywrightCdpSession,
  params: { width: number; height: number; mobile: boolean; deviceScaleFactor: number },
): Promise<void> {
  try {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: params.width,
      height: params.height,
      mobile: params.mobile,
      deviceScaleFactor: params.deviceScaleFactor,
    });
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpEmulationSetUserAgent(session: PlaywrightCdpSession, userAgent: string): Promise<void> {
  try {
    await session.send("Emulation.setUserAgentOverride", { userAgent });
  } catch (error) {
    throw cdpSendError(error);
  }
}

export async function cdpEmulationClearDeviceMetrics(session: PlaywrightCdpSession): Promise<void> {
  try {
    await session.send("Emulation.clearDeviceMetricsOverride");
  } catch (error) {
    throw cdpSendError(error);
  }
}

function cdpSendError(error: unknown): BrowserError {
  if (error instanceof BrowserError) return error;
  return new BrowserError(
    "ERR_PRISM_BROWSER_CDP",
    `CDP send failed: ${error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256)}`,
  );
}
