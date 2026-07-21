import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionPolicy, ToolExecutionContext } from "@arnilo/prism";
import {
  createBrowserManager,
  createBrowserTools,
  normalizeTarget,
  packageName,
  parseSnapshotRefs,
  resolveBrowserLimits,
  BrowserError,
} from "../index.js";
import { FakeBrowser, FakeDialog } from "./fake-playwright.js";

/** Unit tests disable contained-proxy requirement; production defaults remain fail-closed. */
const testNetwork = { requireContainedProxy: false as const };

function mgr(
  browser: FakeBrowser,
  limits: Record<string, number> = { closeGraceMs: 1 },
) {
  return createBrowserManager({ browser, limits, networkPolicy: testNetwork });
}

function ctx(runId = "run-1"): ToolExecutionContext {
  return {
    sessionId: "session-1",
    runId,
    toolCallId: `call-${runId}`,
  };
}

describe("@arnilo/prism-browser", () => {
  it("package name is stable and import is inert", () => {
    assert.equal(packageName, "@arnilo/prism-browser");
    assert.equal(new FakeBrowser().contexts.length, 0);
  });

  it("resolveBrowserLimits rejects overflow", () => {
    assert.throws(() => resolveBrowserLimits({ maxPages: 999 }), /maxPages/);
    assert.throws(() => resolveBrowserLimits({ maxSnapshotBytes: 0 }), /maxSnapshotBytes/);
  });

  it("parseSnapshotRefs extracts bounded refs", () => {
    const yaml = [
      '- generic [active] [ref=e1]:',
      '  - button "One" [ref=e2]',
      '  - button "Two" [ref=e3]',
      '  - textbox "Q" [ref=e4]:',
    ].join("\n");
    const parsed = parseSnapshotRefs(yaml, 10);
    assert.equal(parsed.refs.size, 4);
    assert.equal(parsed.refs.get("e2")?.role, "button");
    assert.equal(parsed.refs.get("e2")?.name, "One");
    const capped = parseSnapshotRefs(yaml, 2);
    assert.equal(capped.refs.size, 2);
    assert.equal(capped.truncatedByRefs, true);
  });

  it("normalizeTarget rejects css/xpath/evaluate", () => {
    assert.throws(() => normalizeTarget({ css: ".x" }), /CSS/);
    assert.throws(() => normalizeTarget({ xpath: "//a" }), /CSS/);
    assert.throws(() => normalizeTarget({ evaluate: "1" }), /CSS/);
    assert.deepEqual(normalizeTarget({ ref: "e12" }), { ref: "e12" });
  });

  it("createBrowserManager requires a browser", () => {
    assert.throws(
      () => createBrowserManager({ browser: undefined as never }),
      (error: unknown) => error instanceof BrowserError && error.code === "ERR_PRISM_BROWSER_INPUT",
    );
  });

  it("one context per run with cookie/storage isolation across runs", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    const a = await manager.open("run-a");
    const b = await manager.open("run-b");
    assert.notEqual(a.pageId, b.pageId);
    assert.equal(browser.contexts.length, 2);
    assert.notEqual(browser.contexts[0], browser.contexts[1]);
    await manager.closeRun("run-a");
    assert.equal(manager.hasRun("run-a"), false);
    assert.equal(manager.hasRun("run-b"), true);
    assert.equal(browser.contexts[0]!.closed, true);
    await manager.close();
    assert.equal(browser.contexts[1]!.closed, true);
  });

  it("snapshot returns AI refs and stale refs fail after mutation", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1", { url: "https://example.com/" });
    const snap = await manager.snapshot("run-1");
    assert.ok(snap.snapshotId.startsWith("snap_"));
    assert.ok(snap.ariaSnapshot.includes("[ref=e4]"));
    assert.ok(snap.refCount >= 4);

    await manager.act("run-1", {
      action: "click",
      target: { ref: "e4" },
      snapshotId: snap.snapshotId,
    });

    await assert.rejects(
      () =>
        manager.act("run-1", {
          action: "click",
          target: { ref: "e4" },
          snapshotId: snap.snapshotId,
        }),
      /Stale snapshotId/,
    );
    await manager.close();
  });

  it("role targets work without refs and ambiguous targets fail", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await manager.act("run-1", {
      action: "click",
      target: { role: "button", name: "Go" },
    });
    await assert.rejects(
      () =>
        manager.act("run-1", {
          action: "click",
          target: { role: "button", name: "Missing" },
        }),
      /No element matched/,
    );
    // Add duplicate buttons to force ambiguity.
    const page = browser.contexts[0]!.pages()[0] as unknown as import("./fake-playwright.js").FakePage;
    page.elements.push({ ref: "e9", role: "button", name: "Go" });
    await assert.rejects(
      () =>
        manager.act("run-1", {
          action: "click",
          target: { role: "button", name: "Go" },
        }),
      /Ambiguous/,
    );
    await manager.close();
  });

  it("orders concurrent actions through the per-run queue", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1", { url: "https://example.com/" });
    const snap = await manager.snapshot("run-1");
    const tasks = [
      manager.act("run-1", { action: "fill", target: { ref: "e3" }, snapshotId: snap.snapshotId, text: "a" }),
      manager.act("run-1", { action: "click", target: { role: "button", name: "Go" } }),
      manager.act("run-1", { action: "check", target: { role: "checkbox", name: "Subscribe" } }),
    ];
    // First mutation invalidates snapshot; subsequent ref action must not sneak ahead.
    const results = await Promise.allSettled(tasks);
    assert.equal(results[0]?.status, "fulfilled");
    // Either later tasks succeed via role or fail stale — but queue preserves order: fill first.
    const page = browser.contexts[0]!.pages()[0] as unknown as import("./fake-playwright.js").FakePage;
    assert.equal(page.actions[0], "goto:https://example.com/");
    assert.ok(page.actions.some((a) => a.startsWith("fill:e3:")));
    const fillIdx = page.actions.findIndex((a) => a.startsWith("fill:e3:"));
    const clickIdx = page.actions.findIndex((a) => a.startsWith("click:"));
    if (clickIdx >= 0) assert.ok(fillIdx < clickIdx);
    await manager.close();
  });

  it("enforces page/action/queue limits and http(s)-only navigation", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser, { maxPages: 1, maxActions: 2, maxQueuedActions: 2, closeGraceMs: 1 });
    await manager.open("run-1");
    await manager.act("run-1", { action: "click", target: { role: "button", name: "Go" } });
    await manager.act("run-1", { action: "click", target: { role: "link", name: "Home" } });
    await assert.rejects(
      () => manager.act("run-1", { action: "click", target: { role: "button", name: "Go" } }),
      /maxActions/,
    );
    await assert.rejects(
      () => manager.act("run-1", { action: "navigate", url: "file:///etc/passwd" }),
      /file:|blocked|http\(s\)/,
    );
    await assert.rejects(
      () => manager.open("run-2", { url: "javascript:alert(1)" }),
      /javascript:|blocked|http\(s\)|absolute URL|url/,
    );
    await manager.close();
  });

  it("handles dialogs and closes idempotently", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    const page = browser.contexts[0]!.pages()[0] as unknown as import("./fake-playwright.js").FakePage;
    const dialog = new FakeDialog("alert", "hello");
    await page.emitDialog(dialog);
    await manager.act("run-1", { action: "dialog", dialogResponse: "accept" });
    assert.equal(dialog.accepted, true);
    await manager.closeRun("run-1");
    await manager.closeRun("run-1");
    await manager.close();
    await manager.close();
  });

  it("createBrowserTools exports exactly four exclusive tools", async () => {
    const browser = new FakeBrowser();
    const deny: ExecutionPolicy = {
      check: (action) =>
        action.operation === "click"
          ? { allowed: false, reason: "click denied" }
          : { allowed: true },
    };
    const tools = createBrowserTools({ browser, executionPolicy: deny, limits: { closeGraceMs: 1 }, networkPolicy: testNetwork });
    assert.deepEqual(
      tools.map((t) => t.name),
      ["browser_open", "browser_snapshot", "browser_act", "browser_close"],
    );
    assert.ok(tools.every((t) => t.exclusive === true));

    const open = await tools[0]!.execute({}, ctx("tools-1"));
    assert.equal(open.error, undefined);
    const denied = await tools[2]!.execute(
      { action: "click", target: { role: "button", name: "Go" } },
      ctx("tools-1"),
    );
    assert.ok(denied.error);
    assert.match(denied.error!.message, /click denied/);

    const snap = await tools[1]!.execute({}, ctx("tools-1"));
    assert.equal(snap.error, undefined);
    const closed = await tools[3]!.execute({}, ctx("tools-1"));
    assert.equal(closed.error, undefined);
  });

  it("wrong-run snapshot fails with stable error", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser);
    await manager.open("run-1");
    await assert.rejects(() => manager.snapshot("missing"), /No browser context/);
    await manager.close();
  });

  it("popup cap closes excess pages", async () => {
    const browser = new FakeBrowser();
    const manager = mgr(browser, { maxPages: 2, maxPopups: 1, closeGraceMs: 1 });
    await manager.open("run-1");
    const context = browser.contexts[0]!;
    const p1 = await context.openPopup();
    const p2 = await context.openPopup();
    // Allow event handlers to run.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(p1.isClosed(), false);
    assert.equal(p2.isClosed(), true);
    await manager.close();
  });
});
