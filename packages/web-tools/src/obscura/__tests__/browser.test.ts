import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import {
  createBrowserTools,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightCdpSession,
  type PlaywrightPage,
} from "../../browser/index.js";
import type { ObscuraPlaywright } from "../cdp.js";
import { connectObscuraCdp } from "../cdp.js";

/**
 * Minimal Obscura-compatible Playwright fake: the same structural surface
 * @arnilo/prism-web-tools/browser's createBrowserTools consumes over connectOverCDP.
 */
class FakeObscuraPage {
  listeners = new Map<string, Array<(params: Record<string, unknown>) => void>>();
  currentUrl = "about:blank";
  closed = false;
  on(event: string, handler: (params: Record<string, unknown>) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }
  off(event: string, handler: (params: Record<string, unknown>) => void): void {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((h) => h !== handler),
    );
  }
  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  isClosed(): boolean {
    return this.closed;
  }
  url(): string {
    return this.currentUrl;
  }
  async ariaSnapshot(): Promise<string> {
    return '- heading "Example" [level=1]';
  }
  emit(event: string, params: Record<string, unknown>): void {
    for (const handler of this.listeners.get(event) ?? []) handler(params);
  }
}

class FakeObscuraContext {
  readonly page = new FakeObscuraPage();
  async newPage(): Promise<PlaywrightPage> {
    return this.page as unknown as PlaywrightPage;
  }
  pages(): PlaywrightPage[] {
    return [this.page as unknown as PlaywrightPage];
  }
  async close(): Promise<void> {
    await this.page.close();
  }
  on(): void {}
  off(): void {}
  setDefaultTimeout(): void {}
  setDefaultNavigationTimeout(): void {}
  async route(): Promise<void> {}
  async unroute(): Promise<void> {}
  async newCDPSession(): Promise<PlaywrightCdpSession> {
    return {
      send: async (method: string) => {
        if (method === "Runtime.evaluate") return { result: { type: "string", value: "evaluated" } };
        return {};
      },
      on: () => {},
      off: () => {},
      detach: async () => {},
    } as unknown as PlaywrightCdpSession;
  }
}

class FakeObscuraBrowser {
  context = new FakeObscuraContext();
  closeCount = 0;
  async newContext(): Promise<PlaywrightBrowserContext> {
    return this.context as unknown as PlaywrightBrowserContext;
  }
  isConnected(): boolean {
    return this.closeCount === 0;
  }
  async close(): Promise<void> {
    this.closeCount += 1;
  }
  version(): string {
    return "Obscura/0.1.0 CDP-fake";
  }
}

function obscuraPlaywright(record: { browsers: FakeObscuraBrowser[]; endpoints: string[] }): ObscuraPlaywright {
  return {
    chromium: {
      connectOverCDP: async (endpoint: string) => {
        record.endpoints.push(endpoint);
        const browser = new FakeObscuraBrowser();
        record.browsers.push(browser);
        return browser as unknown as PlaywrightBrowser;
      },
    },
  };
}

function context(): ToolExecutionContext {
  return { sessionId: "s", runId: "r1", toolCallId: "c1" };
}

async function callTool(tools: ReturnType<typeof createBrowserTools>, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} present`);
  return tool.execute(args as never, context());
}

function cdpServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

test("connected Obscura browser composes into Prism browser tools end to end", async () => {
  const record: { browsers: FakeObscuraBrowser[]; endpoints: string[] } = { browsers: [], endpoints: [] };
  const { server, port } = await cdpServer();
  try {
    const session = await connectObscuraCdp({
      endpoint: `ws://127.0.0.1:${port}`,
      playwright: obscuraPlaywright(record),
    });
    const tools = createBrowserTools({
      browser: session.browser,
      networkPolicy: { requireContainedProxy: false },
      cdp: { mode: "auto" },
    });
    assert.deepEqual(
      tools.map((t) => t.name),
      ["browser_open", "browser_snapshot", "browser_act", "browser_close", "browser_evaluate", "browser_observe"],
    );

    const open = await callTool(tools, "browser_open", { url: "http://example.com/" });
    assert.equal(open.error, undefined);
    const snapshot = await callTool(tools, "browser_snapshot", {});
    assert.ok(JSON.stringify(snapshot.value).includes("heading"));
    const evaluate = await callTool(tools, "browser_evaluate", { expression: "1+1" });
    assert.equal((evaluate.value as { value?: string }).value, "evaluated");
    const observe = await callTool(tools, "browser_observe", {});
    assert.deepEqual((observe.value as { console: unknown[] }).console, []);
    const close = await callTool(tools, "browser_close", {});
    assert.equal(close.error, undefined);
    assert.ok(record.browsers[0]!.context.page.closed);

    await session.close();
    assert.equal(record.browsers[0]!.closeCount, 1);
  } finally {
    server.close();
  }
});
