/**
 * CDP observation ring + browser_observe (0.1.4, plan 016 Task 5).
 * Fakes-based: drain semantics, cap eviction, sequence ids, and the
 * body/cookie/auth-header never-captured invariant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserError, createBrowserManager } from "../index.js";
import { createObservationRing, installCdpObservation } from "../observe.js";
import type { CdpNetworkEntry } from "../types.js";
import { FakeBrowser, FakeCdpSession } from "./fake-playwright.js";

const testNetwork = { requireContainedProxy: false as const };

describe("createObservationRing", () => {
  it("drains entries since the previous call with sequence ids", () => {
    const ring = createObservationRing({ maxConsoleEntries: 10, maxNetworkRequests: 10 });
    ring.recordConsole({ seq: 0, type: "log", args: ["a"] });
    ring.recordConsole({ seq: 0, type: "error", args: ["b"] });
    ring.recordNetwork({ seq: 0, phase: "request", requestId: "1", url: "https://a.test/" });
    const first = ring.drain();
    assert.equal(first.console.length, 2);
    assert.equal(first.network.length, 1);
    assert.deepEqual(
      first.console.map((e) => e.seq),
      [1, 2],
    );
    assert.equal(first.truncated, false);
    const second = ring.drain();
    assert.equal(second.console.length, 0);
    assert.equal(second.network.length, 0);
  });

  it("evicts oldest entries over the cap and marks truncated until the next drain", () => {
    const ring = createObservationRing({ maxConsoleEntries: 3, maxNetworkRequests: 2 });
    for (let i = 0; i < 5; i += 1) ring.recordConsole({ seq: 0, type: "log", args: [`c${i}`] });
    ring.recordNetwork({ seq: 0, phase: "request", requestId: "1", url: "https://a.test/1" });
    ring.recordNetwork({ seq: 0, phase: "request", requestId: "2", url: "https://a.test/2" });
    ring.recordNetwork({ seq: 0, phase: "request", requestId: "3", url: "https://a.test/3" });
    const drained = ring.drain();
    assert.equal(drained.truncated, true);
    assert.deepEqual(
      drained.console.map((e) => e.args?.[0]),
      ["c2", "c3", "c4"],
    );
    assert.deepEqual(
      drained.network.map((e) => e.requestId),
      ["2", "3"],
    );
    const after = ring.drain();
    assert.equal(after.truncated, false);
  });
});

describe("installCdpObservation", () => {
  function wired(options: { maxConsoleEntries?: number; maxNetworkRequests?: number } = {}) {
    const ring = createObservationRing({
      maxConsoleEntries: options.maxConsoleEntries ?? 10,
      maxNetworkRequests: options.maxNetworkRequests ?? 10,
    });
    const session = new FakeCdpSession();
    const unsubscribe = installCdpObservation(session, ring);
    return { ring, session, unsubscribe };
  }

  it("maps console/exceptions and network events into bounded entries", () => {
    const { ring, session } = wired();
    session.emit("Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "careful" }] });
    session.emit("Runtime.exceptionThrown", {
      exceptionDetails: { text: "boom", url: "https://a.test/x.js", exception: { description: "boom desc" } },
    });
    session.emit("Network.requestWillBeSent", { requestId: "r1", request: { url: "https://a.test/data", method: "GET" } });
    session.emit("Network.responseReceived", { requestId: "r1", response: { url: "https://a.test/data", status: 200 } });
    session.emit("Network.loadingFailed", { requestId: "r2", errorText: "net::ERR_BLOCKED" });
    const { console: consoleEntries, network } = ring.drain();
    assert.equal(consoleEntries.length, 2);
    assert.deepEqual(consoleEntries[0], { seq: 1, type: "warning", args: ['"careful"'] });
    assert.equal(consoleEntries[1]!.type, "exception");
    assert.deepEqual(consoleEntries[1]!.args, ["boom desc"]);
    assert.equal(consoleEntries[1]!.text, "https://a.test/x.js");
    assert.equal(network.length, 3);
    assert.deepEqual(
      network.map((n) => n.phase),
      ["request", "response", "failed"],
    );
    assert.equal((network[0] as CdpNetworkEntry).method, "GET");
    assert.equal((network[1] as CdpNetworkEntry).status, 200);
    assert.equal((network[2] as CdpNetworkEntry).errorText, "net::ERR_BLOCKED");
  });

  it("never captures bodies, cookies, or auth headers", () => {
    const { ring, session } = wired();
    session.emit("Network.requestWillBeSent", {
      requestId: "r1",
      request: {
        url: "https://a.test/login",
        method: "POST",
        postData: "password=secret",
        headers: { cookie: "session=topsecret", authorization: "Bearer abc", "content-type": "application/json" },
      },
    });
    session.emit("Network.responseReceived", {
      requestId: "r1",
      response: {
        url: "https://a.test/login",
        status: 200,
        headers: { "set-cookie": "session=topsecret" },
        body: "secret-response",
      },
    });
    const { network } = ring.drain();
    assert.equal(network.length, 2);
    for (const entry of network) {
      const text = JSON.stringify(entry);
      assert.ok(!text.includes("secret"), `entry must not contain body/cookie/auth material: ${text}`);
      assert.ok(!text.includes("cookie"), `entry must not contain cookie material: ${text}`);
      assert.ok(!text.includes("Bearer"), `entry must not contain auth material: ${text}`);
      assert.ok(!text.includes("postData"), `entry must not contain postData: ${text}`);
      assert.ok(!text.includes("password"), `entry must not contain body material: ${text}`);
    }
  });

  it("bounds arg count and preview bytes", () => {
    const { ring, session } = wired();
    session.emit("Runtime.consoleAPICalled", {
      type: "log",
      args: Array.from({ length: 10 }, (_, i) => ({ type: "string", value: `arg${i}` })),
    });
    const { console: consoleEntries } = ring.drain();
    assert.equal(consoleEntries[0]!.args.length, 4);
    const { ring: ring2, session: session2 } = wired();
    session2.emit("Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "x".repeat(10_000) }] });
    const { console: second } = ring2.drain();
    assert.ok((second[0]!.args[0] as string).length <= 513); // 512-byte cap + ellipsis mark
  });

  it("unsubscribe removes the handlers", () => {
    const { ring, session, unsubscribe } = wired();
    unsubscribe();
    session.emit("Runtime.consoleAPICalled", { type: "log", args: [] });
    session.emit("Network.requestWillBeSent", { requestId: "r1", request: { url: "https://a.test/", method: "GET" } });
    const drained = ring.drain();
    assert.equal(drained.console.length, 0);
    assert.equal(drained.network.length, 0);
  });
});

describe("manager.observe", () => {
  it("enables Runtime+Network once per page and drains on read", async () => {
    const browser = new FakeBrowser();
    const manager = createBrowserManager({ browser, limits: { closeGraceMs: 1 }, networkPolicy: testNetwork });
    await manager.open("run-1");
    const first = await manager.observe("run-1");
    assert.deepEqual(first.console, []);
    assert.deepEqual(first.network, []);
    const context = browser.contexts[0]!;
    const session = context.cdpSessions.get(context.pages()[0] as never)!;
    assert.ok(session instanceof FakeCdpSession);
    const methods = session.sent.map((s) => s.method);
    assert.deepEqual(methods, ["Runtime.enable", "Network.enable"]);
    session.emit("Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "hi" }] });
    session.emit("Network.responseReceived", { requestId: "r1", response: { url: "https://a.test/", status: 200 } });
    const batch = await manager.observe("run-1");
    assert.equal(batch.console.length, 1);
    assert.equal(batch.console[0]!.args[0], '"hi"');
    assert.equal(batch.network.length, 1);
    const empty = await manager.observe("run-1");
    assert.equal(empty.console.length, 0);
    assert.equal(empty.network.length, 0);
    // Domains are not re-enabled on subsequent calls.
    assert.equal(session.sent.filter((s) => s.method === "Runtime.enable").length, 1);
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("applies the maxConsoleEntries cap through the manager", async () => {
    const browser = new FakeBrowser();
    const manager = createBrowserManager({ browser, limits: { closeGraceMs: 1, maxConsoleEntries: 3 }, networkPolicy: testNetwork });
    await manager.open("run-1");
    await manager.observe("run-1");
    const context = browser.contexts[0]!;
    const session = context.cdpSessions.get(context.pages()[0] as never)!;
    for (let i = 0; i < 5; i += 1) session.emit("Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: `c${i}` }] });
    const batch = await manager.observe("run-1");
    assert.equal(batch.truncated, true);
    assert.deepEqual(
      batch.console.map((e) => e.args[0]),
      ['"c2"', '"c3"', '"c4"'],
    );
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("mode off makes observe throw ERR_PRISM_BROWSER_CDP_UNAVAILABLE", async () => {
    const browser = new FakeBrowser();
    const manager = createBrowserManager({
      browser,
      cdp: { mode: "off" },
      limits: { closeGraceMs: 1 },
      networkPolicy: testNetwork,
    });
    await manager.open("run-1");
    await assert.rejects(
      () => manager.observe("run-1"),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
    );
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("observe never triggers the side-effect hook (observation only)", async () => {
    const browser = new FakeBrowser();
    const hooks: string[] = [];
    const manager = createBrowserManager({
      browser,
      limits: { closeGraceMs: 1 },
      networkPolicy: testNetwork,
      beforeSideEffect: async (info) => {
        hooks.push(info.action);
      },
    });
    await manager.open("run-1");
    await manager.observe("run-1");
    assert.deepEqual(hooks, []);
    await manager.closeRun("run-1");
    await manager.close();
  });
});
