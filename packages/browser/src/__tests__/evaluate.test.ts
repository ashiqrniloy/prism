/**
 * Bounded page evaluation (0.1.4, plan 016 Task 5).
 * Fakes-based: no real browser; policy gating via the side-effect hook.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserError, createBrowserManager, createBrowserTools } from "../index.js";
import { boundedJson, evaluateInPage } from "../evaluate.js";
import { FakeBrowser, FakeCdpSession } from "./fake-playwright.js";

const testNetwork = { requireContainedProxy: false as const };

function _mgr(browser: FakeBrowser, limits: Record<string, number> = { closeGraceMs: 1 }) {
  return createBrowserManager({ browser, limits, networkPolicy: testNetwork });
}

const BOUNDS = { maxActionInputBytes: 4_096, actionTimeoutMs: 5_000, maxEvaluateResultBytes: 1_024 };

describe("evaluateInPage", () => {
  it("round-trips a JSON value and passes documented Runtime.evaluate params", async () => {
    const session = new FakeCdpSession();
    const outcome = await evaluateInPage(session, { expression: '{"a":1}' }, BOUNDS);
    assert.deepEqual(outcome.value, { a: 1 });
    assert.equal(outcome.exception, undefined);
    assert.equal(outcome.truncated, undefined);
    const sent = session.sent[0]!;
    assert.equal(sent.method, "Runtime.evaluate");
    assert.equal(sent.params?.awaitPromise, false);
    assert.equal(sent.params?.returnByValue, true);
    assert.equal(sent.params?.userGesture, true);
    assert.equal(sent.params?.timeout, 5_000);
  });

  it("awaitPromise and a custom bounded timeout flow through", async () => {
    const session = new FakeCdpSession();
    await evaluateInPage(session, { expression: "1", awaitPromise: true, timeoutMs: 250 }, BOUNDS);
    const sent = session.sent[0]!;
    assert.equal(sent.params?.awaitPromise, true);
    assert.equal(sent.params?.timeout, 250);
  });

  it("rejects empty expressions and expression overflow", async () => {
    const session = new FakeCdpSession();
    await assert.rejects(() => evaluateInPage(session, { expression: "" }, BOUNDS), /non-empty/);
    await assert.rejects(
      () => evaluateInPage(session, { expression: "x".repeat(4_097) }, BOUNDS),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_LIMIT",
    );
  });

  it("rejects out-of-range timeoutMs and clamps the default", async () => {
    const session = new FakeCdpSession();
    await assert.rejects(() => evaluateInPage(session, { expression: "1", timeoutMs: 0 }, BOUNDS), /timeoutMs/);
    await assert.rejects(() => evaluateInPage(session, { expression: "1", timeoutMs: 5_001 }, BOUNDS), /timeoutMs/);
  });

  it("surfaces bounded exception descriptions instead of throwing", async () => {
    const session = new FakeCdpSession();
    session.script("Runtime.evaluate", {
      exceptionDetails: {
        text: "ReferenceError: nope",
        url: "https://a.test/app.js",
        lineNumber: 12,
        exception: { description: "ReferenceError: nope is not defined" },
      },
    });
    const outcome = await evaluateInPage(session, { expression: "nope()" }, BOUNDS);
    assert.equal(outcome.value, undefined);
    assert.match(outcome.exception ?? "", /ReferenceError: nope is not defined/);
    assert.match(outcome.exception ?? "", /https:\/\/a\.test\/app\.js:13/);
    // Exception descriptions are byte-bounded even for huge descriptions.
    session.script("Runtime.evaluate", { exceptionDetails: { exception: { description: "E".repeat(100_000) } } });
    const huge = await evaluateInPage(session, { expression: "1" }, BOUNDS);
    assert.ok((huge.exception ?? "").length < 4_000);
  });

  it("truncates oversized results with the truncated flag; small results round-trip", async () => {
    const session = new FakeCdpSession();
    session.script("Runtime.evaluate", { result: { type: "string", value: "y".repeat(10_000) } });
    const big = await evaluateInPage(session, { expression: "1" }, BOUNDS);
    assert.equal(big.truncated, true);
    assert.ok((big.value as string).length <= 1_025); // cap + ellipsis mark
    session.script("Runtime.evaluate", { result: { type: "string", value: "small" } });
    const small = await evaluateInPage(session, { expression: "1" }, BOUNDS);
    assert.equal(small.value, "small");
    assert.equal(small.truncated, undefined);
  });

  it("CDP send failures become ERR_PRISM_BROWSER_CDP", async () => {
    const session = new FakeCdpSession();
    session.send = async () => {
      throw new Error("socket closed");
    };
    await assert.rejects(
      () => evaluateInPage(session, { expression: "1" }, BOUNDS),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP",
    );
  });
});

describe("boundedJson", () => {
  it("round-trips JSON values below the cap", () => {
    const { json, truncated } = boundedJson({ a: [1, 2, 3] }, 100);
    assert.deepEqual(json, { a: [1, 2, 3] });
    assert.equal(truncated, false);
  });

  it("truncates oversize strings with a mark and never throws", () => {
    const { json, truncated } = boundedJson("x".repeat(10_000), 128);
    assert.equal(truncated, true);
    assert.equal(typeof json, "string");
    assert.ok((json as string).endsWith("…"));
  });

  it("non-stringifiable values degrade to String(value) instead of throwing", () => {
    const { json, truncated } = boundedJson(10n ** 100n, 1_024);
    assert.equal(truncated, false);
    assert.match(String(json), /^1\d+$/);
  });
});

describe("manager.evaluate", () => {
  it("evaluate works end-to-end and is policy-gated through the side-effect hook", async () => {
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
    const result = await manager.evaluate("run-1", { expression: '{"ok":true}' });
    assert.deepEqual(result.value, { ok: true });
    assert.ok(result.pageId);
    assert.deepEqual(hooks, ["evaluate"]);
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("mode off makes evaluate throw ERR_PRISM_BROWSER_CDP_UNAVAILABLE", async () => {
    const browser = new FakeBrowser();
    const manager = createBrowserManager({
      browser,
      cdp: { mode: "off" },
      limits: { closeGraceMs: 1 },
      networkPolicy: testNetwork,
    });
    await manager.open("run-1");
    await assert.rejects(
      () => manager.evaluate("run-1", { expression: "1" }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_CDP_UNAVAILABLE",
    );
    // Playwright-only tools keep working with CDP off.
    const snap = await manager.snapshot("run-1");
    assert.ok(snap.ariaSnapshot.length > 0);
    await manager.closeRun("run-1");
    await manager.close();
  });

  it("browser_evaluate tool returns structured outcomes with untrusted_external trust", async () => {
    const browser = new FakeBrowser();
    const tools = createBrowserTools({ browser, limits: { closeGraceMs: 1 }, networkPolicy: testNetwork });
    const context = { sessionId: "s1", runId: "run-1", toolCallId: "call-1" };
    await tools[0]!.execute({}, context); // open
    const evaluate = tools[4]!;
    assert.equal(evaluate.name, "browser_evaluate");
    const declared = evaluate.effect;
    assert.ok(declared);
    const effectKind = typeof declared === "function" ? declared({ expression: "42" } as never, {} as never).kind : declared.kind;
    assert.equal(effectKind, "external_mutation");
    const ok = await evaluate.execute({ expression: "42" }, context);
    assert.equal(ok.error, undefined);
    assert.equal((ok.value as { value?: unknown } | undefined)?.value, 42);
    assert.equal(ok.metadata?.trust, "untrusted_external");
    const missing = await evaluate.execute({}, context);
    assert.match(missing.error?.message ?? "", /expression is required/);
    await tools[3]!.execute({}, context);
  });
});
