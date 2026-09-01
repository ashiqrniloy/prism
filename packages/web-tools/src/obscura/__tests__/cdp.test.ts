import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { PlaywrightBrowser } from "../../browser/index.js";
import type { ObscuraPlaywright } from "../cdp.js";
import { connectObscuraCdp, endpointFromServeArgs, validateObscuraEndpoint } from "../cdp.js";
import { ObscuraError } from "../errors.js";

/** Fake Playwright: only connectOverCDP exists — connect/launch are absent by construction. */
function fakePlaywright(record: { calls: string[]; browsers: FakeCdpBrowser[] }): ObscuraPlaywright {
  return {
    chromium: {
      connectOverCDP: async (endpoint: string) => {
        record.calls.push(endpoint);
        const browser = new FakeCdpBrowser();
        record.browsers.push(browser);
        return browser as unknown as PlaywrightBrowser;
      },
    },
  };
}

class FakeCdpBrowser {
  closeCount = 0;
  async newContext(): Promise<never> {
    throw new Error("not used in cdp tests");
  }
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function httpServer(
  handler?: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (handler) {
        handler(req, res);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Browser: "obscura-fake" }));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function freePort(): Promise<number> {
  return httpServer().then(({ server, port }) => {
    return new Promise((resolve) => {
      server.close(() => resolve(port));
    });
  });
}

const EXEC = process.execPath;
const STAY = "setTimeout(()=>{},30000)";

test("connectOverCDP is the only Playwright entrypoint used", async () => {
  const record: { calls: string[]; browsers: FakeCdpBrowser[] } = { calls: [], browsers: [] };
  const { server, port } = await httpServer();
  try {
    const session = await connectObscuraCdp({
      endpoint: `ws://127.0.0.1:${port}`,
      playwright: fakePlaywright(record),
    });
    assert.deepEqual(record.calls, [`ws://127.0.0.1:${port}`]);
    await session.close();
    assert.equal(record.browsers[0]!.closeCount, 1);
    assert.equal(session.process, undefined);
  } finally {
    server.close();
  }
});

test("managed serve retries until ready, connects once, and close kills only the owned process", async () => {
  const record: { calls: string[]; browsers: FakeCdpBrowser[] } = { calls: [], browsers: [] };
  const port = await freePort();
  // Readiness appears only after 150ms — the connect must wait, not give up or sleep fixed.
  const server = await new Promise<Server>((resolve) => {
    const s = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Browser: "obscura-fake" }));
    });
    s.listen(port, "127.0.0.1", () => setTimeout(() => resolve(s), 150));
  });
  try {
    const session = await connectObscuraCdp({
      command: EXEC,
      args: ["-e", STAY, "--port", String(port), "--host", "127.0.0.1"],
      playwright: fakePlaywright(record),
      limits: { startupTimeoutMs: 5000 },
    });
    assert.deepEqual(record.calls, [`ws://127.0.0.1:${port}`]);
    assert.ok(session.process, "managed mode owns the spawned process");
    const exited = session.process.exited;
    await session.close();
    await exited;
    assert.equal(record.browsers[0]!.closeCount, 1);
  } finally {
    server.close();
  }
});

test("abort during managed startup kills the owned process", async () => {
  const record: { calls: string[]; browsers: FakeCdpBrowser[] } = { calls: [], browsers: [] };
  const { server, port } = await httpServer(() => {
    // never becomes "ready"
  });
  // Override handler: keep the port occupied but return 500 so readiness never succeeds.
  server.close();
  const blocker = createServer(() => undefined);
  await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
  const controller = new AbortController();
  try {
    const pending = connectObscuraCdp({
      command: EXEC,
      args: ["-e", STAY],
      endpoint: `ws://127.0.0.1:${port}`,
      playwright: fakePlaywright(record),
      signal: controller.signal,
      limits: { startupTimeoutMs: 5000 },
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, (error: ObscuraError) => error.code === "ERR_OBSCURA_ABORTED");
    assert.equal(record.calls.length, 0);
  } finally {
    blocker.close();
  }
});

test("startup timeout kills the owned process with the timeout error", async () => {
  const record: { calls: string[]; browsers: FakeCdpBrowser[] } = { calls: [], browsers: [] };
  const port = await freePort();
  const pending = connectObscuraCdp({
    command: EXEC,
    args: ["-e", STAY],
    endpoint: `ws://127.0.0.1:${port}`,
    playwright: fakePlaywright(record),
    limits: { startupTimeoutMs: 150 },
  });
  await assert.rejects(pending, (error: ObscuraError) => {
    assert.equal(error.code, "ERR_OBSCURA_START_TIMEOUT");
    assert.deepEqual(record.calls, []);
    return true;
  });
});

test("external browser disconnect leaves the external server alive", async () => {
  const record: { calls: string[]; browsers: FakeCdpBrowser[] } = { calls: [], browsers: [] };
  const { server, port } = await httpServer();
  try {
    const session = await connectObscuraCdp({
      endpoint: `ws://127.0.0.1:${port}`,
      playwright: fakePlaywright(record),
    });
    await session.close();
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  } finally {
    server.close();
  }
});

test("endpoint validation fails closed", async () => {
  assert.throws(() => validateObscuraEndpoint("ws://10.0.0.5:9222", false), /allowRemoteEndpoint/);
  // Remote plain ws is refused even with opt-in: no authentication exists.
  assert.throws(() => validateObscuraEndpoint("ws://10.0.0.5:9222", true), /authentication/);
  assert.throws(() => validateObscuraEndpoint("ws://user:pass@127.0.0.1:9222", false), /credentials/);
  assert.throws(() => validateObscuraEndpoint("ftp://127.0.0.1:9222", false), /scheme/);
  assert.throws(() => validateObscuraEndpoint("not-a-url", false), /absolute URL/);
  // Loopback always allowed; remote wss with explicit opt-in is accepted.
  assert.equal(validateObscuraEndpoint("ws://localhost:9222", false).hostname, "localhost");
  assert.equal(validateObscuraEndpoint("wss://gateway.example.com", true).protocol, "wss:");
  await assert.rejects(connectObscuraCdp({}), /requires endpoint or command/);
});

test("endpointFromServeArgs parses --port forms and rejects malformed ports", () => {
  assert.equal(endpointFromServeArgs(["serve", "--port", "9222"]), "ws://127.0.0.1:9222");
  assert.equal(endpointFromServeArgs(["serve", "--port=9223", "--host", "127.0.0.1"]), "ws://127.0.0.1:9223");
  assert.throws(() => endpointFromServeArgs(["serve", "--port", "0"]), /invalid --port/);
  assert.throws(() => endpointFromServeArgs(["serve", "--port", "99999"]), /invalid --port/);
  assert.throws(() => endpointFromServeArgs(["serve", "--port", "abc"]), /invalid --port/);
  assert.throws(() => endpointFromServeArgs(["serve"]), /--port/);
});
