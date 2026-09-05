import {
  cdpEmulationClearDeviceMetrics,
  cdpEmulationSetDeviceMetrics,
  cdpEmulationSetUserAgent,
  cdpNetworkEmulateConditions,
  cdpNetworkSetBlockedUrls,
} from "../cdp.js";
import { BrowserError } from "../errors.js";
import {
  HARD_MAX_DEVICE_SCALE_FACTOR,
  HARD_MAX_EMULATE_DIMENSION,
  HARD_MAX_EMULATE_UA_BYTES,
  HARD_MAX_THROTTLE_KBPS,
  HARD_MAX_THROTTLE_LATENCY_MS,
} from "../limits.js";
import type { BrowserActionName, BrowserActRequest, BrowserActResult } from "../types.js";
import type { ActionContext, ActionHandler, PageCdpState, RunSession } from "./types.js";

async function withCdp(
  ctx: ActionContext,
  session: RunSession,
  request: BrowserActRequest,
  action: BrowserActionName,
  run: (state: PageCdpState) => Promise<void>,
): Promise<BrowserActResult> {
  const page = ctx.resolvePage(session, request.pageId);
  ctx.chargeAction(session);
  await ctx.maybeSideEffect(session, action, { pageId: page.pageId });
  const state = await ctx.ensurePageCdp(session, page);
  await run(state);
  ctx.invalidateSnapshot(session);
  return ctx.resultFor(session, action, page);
}

function clampCdpNumber(value: number | undefined, min: number, max: number, name: string, fallback: number): number;
function clampCdpNumber(value: number | undefined, min: number, max: number, name: string, fallback: undefined): number | undefined;
function clampCdpNumber(
  value: number | undefined,
  min: number,
  max: number,
  name: string,
  fallback: number | undefined,
): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `${name} must be ${min}..${max}`);
  }
  return value;
}

function kbpsToBps(kbps: number): number {
  return Math.round((kbps * 1_000) / 8);
}

export const blockUrls: ActionHandler = (ctx, session, request) =>
  withCdp(ctx, session, request, "block_urls", async (state) => {
    const patterns = request.patterns;
    if (!patterns || patterns.length === 0) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "block_urls requires patterns");
    }
    if (patterns.length > ctx.limits.maxBlockedUrlPatterns) {
      throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `block_urls exceeds maxBlockedUrlPatterns ${ctx.limits.maxBlockedUrlPatterns}`);
    }
    for (const pattern of patterns) {
      if (typeof pattern !== "string" || !pattern) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "block_urls patterns must be non-empty strings");
      }
      ctx.assertInputBytes(pattern);
    }
    await cdpNetworkSetBlockedUrls(state.session, patterns);
    state.blockedPatterns = [...patterns];
  });

export const unblockUrls: ActionHandler = (ctx, session, request) =>
  withCdp(ctx, session, request, "unblock_urls", async (state) => {
    await cdpNetworkSetBlockedUrls(state.session, []);
    state.blockedPatterns = undefined;
  });

export const throttle: ActionHandler = (ctx, session, request) =>
  withCdp(ctx, session, request, "throttle", async (state) => {
    if (request.reset === true) {
      await cdpNetworkEmulateConditions(state.session, {
        offline: false,
        latencyMs: 0,
        downloadThroughputBps: -1,
        uploadThroughputBps: -1,
      });
      state.throttled = false;
      return;
    }
    const offline = request.offline === true;
    const latencyMs = clampCdpNumber(request.latencyMs, 0, HARD_MAX_THROTTLE_LATENCY_MS, "latencyMs", 0);
    const downloadKbps = clampCdpNumber(request.downloadKbps, 0, HARD_MAX_THROTTLE_KBPS, "downloadKbps", undefined);
    const uploadKbps = clampCdpNumber(request.uploadKbps, 0, HARD_MAX_THROTTLE_KBPS, "uploadKbps", undefined);
    await cdpNetworkEmulateConditions(state.session, {
      offline,
      latencyMs,
      downloadThroughputBps: downloadKbps === undefined ? -1 : kbpsToBps(downloadKbps),
      uploadThroughputBps: uploadKbps === undefined ? -1 : kbpsToBps(uploadKbps),
    });
    state.throttled = true;
  });

export const emulate: ActionHandler = (ctx, session, request) =>
  withCdp(ctx, session, request, "emulate", async (state) => {
    if (request.reset === true) {
      await cdpEmulationClearDeviceMetrics(state.session);
      state.emulated = false;
      return;
    }
    const width = clampCdpNumber(request.width, 1, HARD_MAX_EMULATE_DIMENSION, "width", undefined);
    const height = clampCdpNumber(request.height, 1, HARD_MAX_EMULATE_DIMENSION, "height", undefined);
    if (width === undefined || height === undefined) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "emulate requires width and height");
    }
    const deviceScaleFactor = clampCdpNumber(request.deviceScaleFactor, 0.01, HARD_MAX_DEVICE_SCALE_FACTOR, "deviceScaleFactor", 1);
    await cdpEmulationSetDeviceMetrics(state.session, {
      width,
      height,
      mobile: request.mobile === true,
      deviceScaleFactor,
    });
    if (typeof request.userAgent === "string" && request.userAgent.length > 0) {
      if (Buffer.byteLength(request.userAgent, "utf8") > HARD_MAX_EMULATE_UA_BYTES) {
        throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `userAgent exceeds ${HARD_MAX_EMULATE_UA_BYTES} bytes`);
      }
      await cdpEmulationSetUserAgent(state.session, request.userAgent);
    }
    state.emulated = true;
  });
