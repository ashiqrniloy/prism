/**
 * CDP session layer + CDP-backed act actions (0.1.4, plan 016 Task 5).
 * Fakes-based: no real browser, no playwright import at load time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserError, createBrowserManager, resolveBrowserLimits, type CreateBrowserManagerOptions } from "../index.js";
import {
  cdpAvailable,
  createPageCdpSession,
  cdpEmulationClearDeviceMetrics,
  cdpEmulationSetDeviceMetrics,
  cdpEmulationSetUserAgent,
  cdpNetworkEmulateConditions,
  cdpNetworkSetBlockedUrls,
  resolveCdpMode,
} from "../cdp.js";
import {
  DEFAULT_MAX_BLOCKED_URL_PATTERNS,
  DEFAULT_MAX_CONSOLE_ENTRIES,
  DEFAULT_MAX_EVALUATE_RESULT_BYTES,
  HARD_MAX_BLOCKED_URL_PATTERNS,
  HARD_MAX_CONSOLE_ENTRIES,
  HARD_MAX_DEVICE_SCALE_FACTOR,
  HARD_MAX_EMULATE_DIMENSION,
  HARD_MAX_EMULATE_UA_BYTES,
  HARD_MAX_EVALUATE_RESULT_BYTES,
  HARD_MAX_THROTTLE_KBPS,
  HARD_MAX_THROTTLE_LATENCY_MS,
} from "../limits.js";
import { classifyBrowserOperation, isSideEffectAction } from "../policy.js";
import { normalizeTarget } from "../targets.js";
import type { PlaywrightBrowser, PlaywrightBrowserContext, PlaywrightPage } from "../types.js";
import { FakeBrowser, FakeCdpSession, type FakeContext, type FakePage } from "./fake-playwright.js";

const testNetwork = { requireContainedProxy: false as const };

function mgr(browser: FakeBrowser, extra: Partial<Omit<CreateBrowserManagerOptions, "browser">> = {}) {
  return createBrowserManager({
    browser,
    limits: { closeGraceMs: 1 },
    networkPolicy: testNetwork,
    ...extra,
  });
}

async function cdpSessionOf(browser: FakeBrowser): Promise<FakeCdpSession> {
  const context = browser.contexts[0]!;
  const session = context.cdpSessions.get(context.pages()[0] as never);
  assert.ok(session instanceof FakeCdpSession, "expected a fake CDP session to exist");
  return session;
}

describe("cdp session layer", () => {
  it("resolveCdpMode defaults to auto and honors explicit modes", () => {
    assert.equal(resolveCdpMode(undefined), "auto");
    assert.equal(resolveCdpMode({}), "auto");
    assert.equal(resolveCdpMode({ mode: "on" }), "on");
    assert.equal(resolveCdpMode({ mode: "off" }), "off");
  });

  it("cdpAvailable requires newCDPSession and rejects firefox/webkit version prefixes", async () => {
    const browser = new FakeBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    assert.equal(cdpAvailable(browser, context), true);

    const noSession = Object.create(context) as unknown as PlaywrightBrowserContext;
    noSession.newCDPSession = undefined as never;
    assert.equal(cdpAvailable(browser, noSession), false);

    const firefox = new FakeBrowser();
    firefox.version = () => "firefox-1.0";
    assert.equal(cdpAvailable(firefox, context), false);
    const webkit = new FakeBrowser();
    webkit.version = () => "webkit-2.0";
    assert.equal(cdpAvailable(webkit, context), false);
    // Structural hosts without version() default to available when newCDPSession exists.
    const bare = Object.create(browser) as PlaywrightBrowser;
    bare.version = undefined as never;
    assert.equal(cdpAvailable(bare, context), true);
    void page;
  });

  it("createPageCdpSession throws ERR_PRISM_BROWSER_CDP_UNAVAILABLE for unusable sessions", async () => {
    const browser = new FakeBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    const fake = new FakeCdpSession();
    (context as unknown as FakeContext).cdpSessions.set(page as unknown as FakePage, fake);
    (context.newCDPSession as unknown) = async () => ({ on: fake.on.bind(fake) }); // no send
    await assert.rejects(
      () => createPageCdpSession(browser, context, page as unknown as PlaywrightPage),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
    );
    // Host throwing is wrapped into ERR_PRISM_BROWSER_CDP_UNAVAILABLE.
    (context.newCDPSession as unknown) = async () => {
      throw new Error("host exploded");
    };
    await assert.rejects(
      () => createPageCdpSession(browser, context, page as unknown as PlaywrightPage),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
    );
  });

  it("domain helpers send the documented CDP methods and params", async () => {
    const session = new FakeCdpSession();
    await cdpNetworkSetBlockedUrls(session, ["*://ads.example/*"]);
    await cdpNetworkEmulateConditions(session, {
      offline: true,
      latencyMs: 250,
      downloadThroughputBps: 125_000,
      uploadThroughputBps: 62_500,
    });
    await cdpEmulationSetDeviceMetrics(session, { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 });
    await cdpEmulationSetUserAgent(session, "FakeUA");
    await cdpEmulationClearDeviceMetrics(session);
    const byMethod = (m: string) => session.sent.filter((s) => s.method === m);
    assert.deepEqual(byMethod("Network.setBlockedURLs")[0]!.params, { urls: ["*://ads.example/*"] });
    assert.deepEqual(byMethod("Network.emulateNetworkConditions")[0]!.params, {
      offline: true,
      latency: 250,
      downloadThroughput: 125_000,
      uploadThroughput: 62_500,
    });
    assert.deepEqual(byMethod("Emulation.setDeviceMetricsOverride")[0]!.params, {
      width: 390,
      height: 844,
      mobile: true,
      deviceScaleFactor: 3,
    });
    assert.deepEqual(byMethod("Emulation.setUserAgentOverride")[0]!.params, { userAgent: "FakeUA" });
    assert.equal(byMethod("Emulation.clearDeviceMetricsOverride").length, 1);
  });
});

describe("cdp act actions", () => {
  it("block_urls/unblock_urls send Network.setBlockedURLs with bounded patterns", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await manager.act("run-1", { action: "block_urls", patterns: ["*://a.test/*", "*://b.test/*"] });
    const session = await cdpSessionOf(browser);
    const block = session.sent.filter((s) => s.method === "Network.setBlockedURLs");
    assert.equal(block.length, 1);
    assert.deepEqual(block[0]!.params, { urls: ["*://a.test/*", "*://b.test/*"] });

    await manager.act("run-1", { action: "unblock_urls" });
    const unblock = session.sent.filter((s) => s.method === "Network.setBlockedURLs").at(-1)!;
    assert.deepEqual(unblock.params, { urls: [] });
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("block_urls validates empty patterns and the maxBlockedUrlPatterns cap", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await assert.rejects(() => manager.act("run-1", { action: "block_urls", patterns: [] }), /patterns/);
    await assert.rejects(
      () => manager.act("run-1", { action: "block_urls", patterns: Array.from({ length: 33 }, (_, i) => `*://${i}.test/*`) }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("throttle validates caps and reset sends CDP -1 throughput", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await manager.act("run-1", { action: "throttle", latencyMs: 500, downloadKbps: 1_000, uploadKbps: 500 });
    const session = await cdpSessionOf(browser);
    const sent = session.sent.filter((s) => s.method === "Network.emulateNetworkConditions");
    assert.deepEqual(sent[0]!.params, { offline: false, latency: 500, downloadThroughput: 125_000, uploadThroughput: 62_500 });
    await manager.act("run-1", { action: "throttle", reset: true });
    const reset = session.sent.filter((s) => s.method === "Network.emulateNetworkConditions").at(-1)!;
    assert.deepEqual(reset.params, { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("throttle rejects out-of-range latency and kbps", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await assert.rejects(
      () => manager.act("run-1", { action: "throttle", latencyMs: HARD_MAX_THROTTLE_LATENCY_MS + 1 }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await assert.rejects(
      () => manager.act("run-1", { action: "throttle", downloadKbps: -1 }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("emulate sends device metrics + optional user agent; reset clears", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await manager.act("run-1", { action: "emulate", width: 390, height: 844, mobile: true, deviceScaleFactor: 3, userAgent: "FakeUA" });
    const session = await cdpSessionOf(browser);
    const metrics = session.sent.filter((s) => s.method === "Emulation.setDeviceMetricsOverride");
    assert.deepEqual(metrics[0]!.params, { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 });
    const ua = session.sent.filter((s) => s.method === "Emulation.setUserAgentOverride");
    assert.equal(ua.length, 1);
    await manager.act("run-1", { action: "emulate", reset: true });
    assert.equal(session.sent.filter((s) => s.method === "Emulation.clearDeviceMetricsOverride").length, 1);
    // userAgent is only sent when explicitly supplied.
    await manager.act("run-1", { action: "emulate", width: 800, height: 600 });
    assert.equal(session.sent.filter((s) => s.method === "Emulation.setUserAgentOverride").length, 1);
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("emulate rejects out-of-range dimensions/scale/ua and oversized user agents", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await assert.rejects(
      () => manager.act("run-1", { action: "emulate", width: 0 }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await assert.rejects(
      () => manager.act("run-1", { action: "emulate", width: HARD_MAX_EMULATE_DIMENSION + 1, height: 100 }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await assert.rejects(
      () => manager.act("run-1", { action: "emulate", width: 100, height: 100, deviceScaleFactor: HARD_MAX_DEVICE_SCALE_FACTOR + 1 }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await assert.rejects(
      () => manager.act("run-1", { action: "emulate", width: 100, height: 100, userAgent: "x".repeat(HARD_MAX_EMULATE_UA_BYTES + 1) }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("css/xpath targets resolve against act actions; selector/evaluate keys stay denied", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await manager.act("run-1", { action: "click", target: { css: "#e4" } });
    await manager.act("run-1", { action: "click", target: { xpath: "//button[@ref='e4']" } });
    const page = browser.contexts[0]!.pages()[0] as FakePage;
    assert.ok(page.actions.some((a) => a.startsWith("click:e4")));
    assert.throws(() => normalizeTarget({ selector: ".x" }), /selector/);
    assert.throws(() => normalizeTarget({ evaluate: "1" }), /selector/);
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("CDP sessions are run-scoped: detached on closeRun and on close", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await manager.act("run-1", { action: "block_urls", patterns: ["*://x.test/*"] });
    const session = await cdpSessionOf(browser);
    assert.equal(session.detached, false);
    await manager.closeRun("run-1");
    assert.equal(session.detached, true);

    await manager.open("run-2");
    await manager.act("run-2", { action: "throttle", latencyMs: 10 });
    const session2 = await cdpSessionOf(browser);
    await manager.close();
    assert.equal(session2.detached, true);
  });

  it("CDP unavailable (mode off) leaves Playwright-only tools working", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser, { cdp: { mode: "off" } });
    await manager.open("run-1", { url: "https://example.com/" });
    const snap = await manager.snapshot("run-1");
    assert.ok(snap.ariaSnapshot.length > 0);
    await manager.act("run-1", { action: "click", target: { role: "button", name: "Go" } });
    await assert.rejects(
      () => manager.act("run-1", { action: "throttle", latencyMs: 10 }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
    );
    await assert.rejects(
      () => manager.act("run-1", { action: "block_urls", patterns: ["*://x.test/*"] }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
    );
    await manager.closeRun("run-1");
    await manager.close();
  });
});

describe("cdp policy + limits", () => {
  it("policy classifies evaluate high_impact/high and CDP act actions mutation/medium", () => {
    const evaluate = classifyBrowserOperation("evaluate");
    assert.equal(evaluate.effect, "high_impact");
    assert.equal(evaluate.risk, "high");
    assert.equal(evaluate.requiresSideEffectHook, true);
    for (const action of ["block_urls", "unblock_urls", "throttle", "emulate"] as const) {
      const classified = classifyBrowserOperation(action);
      assert.equal(classified.effect, "mutation");
      assert.equal(classified.risk, "medium");
      assert.equal(classified.requiresSideEffectHook, true);
    }
    const observe = classifyBrowserOperation("observe");
    assert.equal(observe.effect, "observation");
    assert.equal(observe.risk, "low");
    assert.equal(observe.requiresSideEffectHook, false);
    assert.equal(isSideEffectAction("evaluate"), true);
    assert.equal(isSideEffectAction("observe"), false);
  });

  it("new limits default/hard pairs and validation", () => {
    assert.equal(DEFAULT_MAX_EVALUATE_RESULT_BYTES, 64 * 1024);
    assert.equal(HARD_MAX_EVALUATE_RESULT_BYTES, 256 * 1024);
    assert.equal(DEFAULT_MAX_CONSOLE_ENTRIES, 200);
    assert.equal(HARD_MAX_CONSOLE_ENTRIES, 500);
    assert.equal(DEFAULT_MAX_BLOCKED_URL_PATTERNS, 32);
    assert.equal(HARD_MAX_BLOCKED_URL_PATTERNS, 128);
    const resolved = resolveBrowserLimits({});
    assert.equal(resolved.maxEvaluateResultBytes, DEFAULT_MAX_EVALUATE_RESULT_BYTES);
    assert.equal(resolved.maxConsoleEntries, DEFAULT_MAX_CONSOLE_ENTRIES);
    assert.equal(resolved.maxBlockedUrlPatterns, DEFAULT_MAX_BLOCKED_URL_PATTERNS);
    assert.throws(() => resolveBrowserLimits({ maxEvaluateResultBytes: HARD_MAX_EVALUATE_RESULT_BYTES + 1 }), /maxEvaluateResultBytes/);
    assert.throws(() => resolveBrowserLimits({ maxConsoleEntries: HARD_MAX_CONSOLE_ENTRIES + 1 }), /maxConsoleEntries/);
    assert.throws(() => resolveBrowserLimits({ maxBlockedUrlPatterns: HARD_MAX_BLOCKED_URL_PATTERNS + 1 }), /maxBlockedUrlPatterns/);
    assert.throws(() => resolveBrowserLimits({ maxConsoleEntries: 0 }), /maxConsoleEntries/);
    assert.ok(HARD_MAX_THROTTLE_LATENCY_MS > 0);
    assert.ok(HARD_MAX_THROTTLE_KBPS > 0);
    assert.ok(HARD_MAX_EMULATE_DIMENSION > 0);
    assert.ok(HARD_MAX_DEVICE_SCALE_FACTOR > 0);
    assert.ok(HARD_MAX_EMULATE_UA_BYTES > 0);
  });
});
