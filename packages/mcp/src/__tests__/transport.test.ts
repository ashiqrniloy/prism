import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpTransport, createSecureMcpFetch } from "../transport.js";

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
});

describe("secure MCP Streamable HTTP transport", () => {
  it("requires an exact HTTPS origin and rejects credentials, fragments, and public HTTP", () => {
    assert.doesNotThrow(() => createMcpTransport({
      type: "streamable-http",
      url: "https://mcp.example.test/mcp",
      allowedOrigins: ["https://mcp.example.test"],
    }));
    assert.throws(() => createMcpTransport({
      type: "streamable-http",
      url: "https://mcp.example.test/mcp",
      allowedOrigins: ["https://mcp.example.test/"],
    }), /exact/);
    assert.throws(() => createMcpTransport({
      type: "streamable-http",
      url: "https://user:pass@mcp.example.test/mcp",
      allowedOrigins: ["https://mcp.example.test"],
    }), /credentials/);
    assert.throws(() => createMcpTransport({
      type: "streamable-http",
      url: "https://mcp.example.test/mcp#fragment",
      allowedOrigins: ["https://mcp.example.test"],
    }), /fragment/);
    assert.throws(() => createMcpTransport({
      type: "streamable-http",
      url: "http://mcp.example.test/mcp",
      allowedOrigins: ["http://mcp.example.test"],
      allowLoopbackHttp: true,
    }), /HTTPS|loopback/);
  });

  it("blocks private IPv4/IPv6 and mixed DNS answers before requests", async () => {
    for (const url of ["https://127.0.0.1/mcp", "https://[::1]/mcp", "https://169.254.169.254/mcp"]) {
      assert.throws(() => createMcpTransport({ type: "streamable-http", url, allowedOrigins: [new URL(url).origin] }), /not public/);
    }
    const fetch = createSecureMcpFetch({
      type: "streamable-http",
      url: "https://mcp.example.test/mcp",
      allowedOrigins: ["https://mcp.example.test"],
      resolveHostname: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    });
    await assert.rejects(fetch("https://mcp.example.test/mcp"), /private or non-public/);
  });

  it("allows plaintext loopback only with explicit opt-in and rejects rebinding", async () => {
    const { origin } = await listen((_request, response) => response.end("ok"));
    assert.throws(() => createSecureMcpFetch({
      type: "streamable-http",
      url: `${origin}/mcp`,
      allowedOrigins: [origin],
    }), /HTTPS/);
    const fetch = createSecureMcpFetch({
      type: "streamable-http",
      url: `${origin.replace("127.0.0.1", "localhost")}/mcp`,
      allowedOrigins: [origin.replace("127.0.0.1", "localhost")],
      allowLoopbackHttp: true,
      resolveHostname: (() => {
        let calls = 0;
        return async () => calls++ === 0
          ? [{ address: "127.0.0.1", family: 4 as const }]
          : [{ address: "10.0.0.1", family: 4 as const }];
      })(),
    });
    assert.equal(await (await fetch(`${origin.replace("127.0.0.1", "localhost")}/mcp`)).text(), "ok");
    await assert.rejects(fetch(`${origin.replace("127.0.0.1", "localhost")}/mcp`), /outside loopback/);
  });

  it("rejects redirects and bounds chunked responses", async () => {
    const { origin } = await listen((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "https://example.test/elsewhere" });
        response.end();
        return;
      }
      response.write("x".repeat(8));
      response.end("y".repeat(8));
    });
    const fetch = loopbackFetch(origin, 10);
    await assert.rejects(fetch(`${origin}/redirect`, { headers: { authorization: "Bearer canary" } }), /redirects are not allowed/);
    const response = await fetch(`${origin}/large`);
    await assert.rejects(response.text(), /exceeds 10 bytes/);
  });

  it("applies origin, pinned resolution, headers, methods, response cap, and abort to every request", async () => {
    const seen: Array<{ method?: string; authorization?: string }> = [];
    const { origin } = await listen((request, response) => {
      seen.push({ method: request.method, authorization: request.headers.authorization });
      if (request.url === "/slow") return void setTimeout(() => response.end("late"), 200);
      response.end("ok");
    });
    const fetch = loopbackFetch(origin, 1024);
    for (const method of ["POST", "GET", "DELETE"]) {
      const response = await fetch(`${origin}/mcp`, {
        method,
        headers: { authorization: "Bearer canary", "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(await response.text(), "ok");
    }
    assert.deepEqual(seen.slice(0, 3), [
      { method: "POST", authorization: "Bearer canary" },
      { method: "GET", authorization: "Bearer canary" },
      { method: "DELETE", authorization: "Bearer canary" },
    ]);
    await assert.rejects(fetch("http://example.test/mcp"), /not allow-listed/);
    const controller = new AbortController();
    const pending = fetch(`${origin}/slow`, { signal: controller.signal });
    controller.abort(new Error("stop"));
    await assert.rejects(pending, /stop|abort/i);
  });

  it("validates the HTTP response limit before transport creation", () => {
    for (const value of [0, NaN, Infinity, 64 * 1024 * 1024 + 1]) {
      assert.throws(() => createMcpTransport({
        type: "streamable-http",
        url: "https://mcp.example.test/mcp",
        allowedOrigins: ["https://mcp.example.test"],
        maxResponseBytes: value,
      }));
    }
  });
});

function loopbackFetch(origin: string, maxResponseBytes: number): typeof fetch {
  return createSecureMcpFetch({
    type: "streamable-http",
    url: `${origin}/mcp`,
    allowedOrigins: [origin],
    allowLoopbackHttp: true,
    maxResponseBytes,
  });
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  return { origin: `http://127.0.0.1:${address.port}` };
}
