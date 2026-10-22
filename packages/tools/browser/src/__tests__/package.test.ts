import { afterEach, describe, it, mock } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import {
  mockProvider,
  packageConformance,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { approvalPackage } from "@arnilo/prism-approval";
import toolsBrowser from "../index.js";
import { FakeBrowser } from "./fake-playwright.js";

/** Launched fakes, so a test can assert the package closed the browser it opened. */
const launched: FakeBrowser[] = [];

mock.module("playwright-core", () => ({
  chromium: {
    launch: async () => {
      const browser = new FakeBrowser();
      launched.push(browser);
      return browser;
    },
  },
}));

afterEach(() => {
  launched.length = 0;
});

const EXPECTED_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  browser_open: ["network"],
  browser_snapshot: ["network"],
  browser_act: ["network", "write"],
  browser_close: [],
  browser_evaluate: ["execute", "network"],
  browser_observe: ["network"],
};

function toolResults(entries: readonly { kind: string; message?: { content: readonly unknown[] } }[]) {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.message
      ? (entry.message.content.filter(
          (block): block is { type: "tool_result"; error?: { code: string; message: string } } =>
            (block as { type: string }).type === "tool_result",
        ) as { type: "tool_result"; error?: { code: string; message: string } }[])
      : [],
  );
}

describe("@arnilo/prism-tools-browser package", () => {
  it("tools_browser_package_conformance", async () => {
    const result = await packageConformance(toolsBrowser({ headless: true }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("tools_browser_registers_tools_with_effects", async () => {
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsBrowser({ headless: true })] });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), Object.keys(EXPECTED_EFFECTS).sort());
      for (const tool of agent.tools) {
        assert.deepEqual(tool.effects, EXPECTED_EFFECTS[tool.name], `${tool.name} must declare its effects`);
        assert.equal(tool.package, "@arnilo/prism-tools-browser");
      }
    } finally {
      await agent.dispose();
    }
  });

  it("tools_browser_blocked_origin_denied_in_auto", async () => {
    const provider = mockProvider(
      [
        [providerToolCall(toolCallContent("c1", "browser_open", {})), providerDone()],
        [providerToolCall(toolCallContent("c2", "browser_act", { action: "navigate", url: "https://blocked.example/" })), providerDone()],
        [providerTextDelta("ok"), providerDone()],
      ],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        provider,
        approvalPackage({ mode: "auto" }),
        toolsBrowser({
          headless: true,
          allowOrigins: ["https://allowed.example"],
          containedProxy: { proxyEndpoint: "http://proxy.internal:8080", denyDirectEgress: true },
        }),
      ],
    });
    try {
      const session = await agent.session({ id: "blocked-origin", create: true });
      await session.run("navigate to the blocked origin");
      await session.close();
      const denied = toolResults(await session.entries()).find((block) => block.error !== undefined);
      assert.ok(denied, "blocked-origin navigation was not denied under approval auto");
      assert.match(denied.error?.message ?? "", /denied|blocked/i);
    } finally {
      await agent.dispose();
    }
  });

  it("tools_browser_disposes_manager", async () => {
    const provider = mockProvider(
      [
        [providerToolCall(toolCallContent("c1", "browser_open", {})), providerDone()],
        [providerTextDelta("ok"), providerDone()],
      ],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        provider,
        toolsBrowser({ headless: true, containedProxy: { proxyEndpoint: "http://proxy.internal:8080", denyDirectEgress: true } }),
      ],
    });
    const browser = launched[0];
    assert.ok(browser, "the package launched a browser");
    try {
      const session = await agent.session({ id: "dispose-manager", create: true });
      await session.run("open the browser");
      await session.close();
      const context = browser.contexts[0];
      assert.ok(context, "browser_open created a run context");
      assert.equal(context.closed, false);
      await agent.dispose();
      assert.equal(context.closed, true, "dispose closes the run context through the manager");
      assert.equal(browser.closeCount, 1, "dispose closes the browser the package launched");
    } finally {
      await agent.dispose();
    }
  });
});
