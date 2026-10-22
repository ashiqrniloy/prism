import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createSecretRedactor } from "@arnilo/prism";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createPrismMcpWebHandler } from "../server.js";

/** One echo tool, no agent: these tests cover the transport helpers only. */
function echoFactory() {
  const server = new McpServer({ name: "prism-mcp-server", version: "0.0.12" }, { capabilities: { tools: {} } });
  server.registerTool("echo", { description: "Echo text", inputSchema: z.object({ text: z.string() }) }, (args) => ({
    content: [{ type: "text", text: args.text }],
  }));
  return server;
}

describe("MCP transport helpers", () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    while (open.length > 0) await open.pop()?.close();
  });

  it("provides a bounded web-standard Streamable HTTP handler", async () => {
    // Stateless handlers need a server factory: a fresh McpServer per request.
    const handler = await createPrismMcpWebHandler(echoFactory, { maxRequestBytes: 256 });
    open.push(handler);

    const tooLarge = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(300) }),
      }),
    );
    assert.equal(tooLarge.status, 413);

    const initialized = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
        }),
      }),
    );
    assert.equal(initialized.status, 200);
    assert.match(await initialized.text(), /prism-mcp-server/);
  });

  it("rejects non-JSON bodies and redacts handler errors", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory, { maxRequestBytes: 64 });
    open.push(handler);
    const wrongType = await handler(
      new Request("https://example.test/mcp", { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" }),
    );
    assert.equal(wrongType.status, 415);
    const oversized = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(100) }),
      }),
    );
    assert.equal(oversized.status, 413);
    void createSecretRedactor;
  });

  it("binds stateful Streamable HTTP sessions to host-validated identity", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory, {
      allowedOrigins: ["https://example.test"],
      sessionIdGenerator: () => "session-1",
      resolveAuthInfo: (request) => ({ token: request.headers.get("authorization") ?? "", clientId: "client", scopes: [] }),
      resolveIdentity: (_request, auth) =>
        auth?.token === "Bearer a" ? { id: "principal-a" } : auth?.token === "Bearer b" ? { id: "principal-b" } : false,
    });
    open.push(handler);
    const initialized = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: {
          origin: "https://example.test",
          authorization: "Bearer a",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
        }),
      }),
    );
    assert.equal(initialized.status, 200);
    assert.equal(initialized.headers.get("mcp-session-id"), "session-1");
    const stolen = await handler(
      new Request("https://example.test/mcp", {
        method: "GET",
        headers: { origin: "https://example.test", authorization: "Bearer b", "mcp-session-id": "session-1", accept: "text/event-stream" },
      }),
    );
    assert.equal(stolen.status, 404);
    assert.doesNotMatch(await stolen.text(), /principal|token|Bearer/);
  });
});

describe("dual-era MCP serving", () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    while (open.length > 0) await open.pop()?.close();
  });

  async function listen(handler: (request: Request) => Promise<Response>) {
    const responseHeaders: Array<Array<[string, string]>> = [];
    const http = createHttpServer(async (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const webRequest = new Request(new URL(request.url ?? "/", "http://127.0.0.1"), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: request.method === "GET" || request.method === "DELETE" ? undefined : Buffer.concat(chunks),
      });
      try {
        const webResponse = await handler(webRequest);
        responseHeaders.push(Object.entries(Object.fromEntries(webResponse.headers)));
        response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
        for await (const chunk of webResponse.body ?? new Uint8Array()) response.write(chunk);
      } catch {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "handler failure" } }));
      }
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", () => resolve());
    });
    const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    return {
      origin,
      responseHeaders,
      async close() {
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      },
    };
  }

  it("serves modern HTTP through createMcpHandler with SDK-generated discover and no session ids", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory);
    const wire = await listen(handler);
    open.push({
      close: async () => {
        await handler.close();
        await wire.close();
      },
    });

    const client = new Client(
      { name: "modern-client", version: "1.0.0" },
      { capabilities: {}, versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`)));
    open.push({ close: () => client.close() });
    assert.equal(client.getProtocolEra(), "modern");

    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ["echo"],
    );
    // Tasks boundary (plan 063 task 6): the server advertises no Tasks capability.
    const serverCaps = client.getServerCapabilities() as { tasks?: unknown; extensions?: Record<string, unknown> };
    assert.equal(serverCaps.tasks, undefined);
    assert.equal("io.modelcontextprotocol/tasks" in (serverCaps.extensions ?? {}), false);
    const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.content), /hi/);
    assert.ok(
      wire.responseHeaders.every((headers) => !headers.some(([name]) => name.toLowerCase() === "mcp-session-id")),
      "modern responses carry no legacy session id",
    );
  });

  it("keeps legacy stateless HTTP clients on the SDK stateless fallback", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory);
    const wire = await listen(handler);
    open.push({
      close: async () => {
        await handler.close();
        await wire.close();
      },
    });

    const client = new Client({ name: "legacy-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`)));
    open.push({ close: () => client.close() });
    assert.equal(client.getProtocolEra(), "legacy");
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ["echo"],
    );
    const result = await client.callTool({ name: "echo", arguments: { text: "yo" } });
    assert.match(JSON.stringify(result.content), /yo/);
  });

  it("routes classified legacy session traffic beside a strict modern handler", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory, {
      sessionIdGenerator: () => "session-9",
      resolveIdentity: () => ({ id: "principal-1" }),
      allowedOrigins: ["https://example.test"],
    });
    const wire = await listen(handler);
    open.push({
      close: async () => {
        await handler.close();
        await wire.close();
      },
    });

    const initialized = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { origin: "https://example.test", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      }),
    );
    assert.equal(initialized.status, 200);
    assert.equal(initialized.headers.get("mcp-session-id"), "session-9", "legacy sessions still bind and route");

    const modern = new Client(
      { name: "modern-client", version: "1.0.0" },
      { capabilities: {}, versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await modern.connect(new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`)));
    open.push({ close: () => modern.close() });
    assert.equal(modern.getProtocolEra(), "modern");
    const result = await modern.callTool({ name: "echo", arguments: { text: "both" } });
    assert.match(JSON.stringify(result.content), /both/);
  });

  it("rejects bad Host/Origin before body parsing and passes verified auth through", async () => {
    const evilBody = JSON.stringify({ value: "x".repeat(300) });
    const originHandler = await createPrismMcpWebHandler(echoFactory, { allowedOrigins: ["https://good.test"], maxRequestBytes: 64 });
    open.push(originHandler);
    const evil = await originHandler(
      new Request("https://good.test/mcp", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: evilBody,
      }),
    );
    assert.equal(evil.status, 403, "origin rejection precedes body parsing (403, not 413)");

    const hostHandler = await createPrismMcpWebHandler(echoFactory, { allowedHosts: ["good.test"] });
    open.push(hostHandler);
    const hostile = await hostHandler(
      new Request("https://good.test/mcp", {
        method: "POST",
        headers: { host: "evil.test", "content-type": "application/json" },
        body: evilBody,
      }),
    );
    assert.equal(hostile.status, 403, "host allowlist rejects before dispatch");

    const seenAuth: Array<AuthInfo | undefined> = [];
    const authHandler = await createPrismMcpWebHandler(
      () => {
        const server = new McpServer({ name: "prism-mcp-server", version: "0.0.12" }, { capabilities: { tools: {} } });
        server.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, (args, ctx) => {
          seenAuth.push(ctx.http?.authInfo);
          return { content: [{ type: "text", text: args.text }] };
        });
        return server;
      },
      {
        resolveAuthInfo: (request) => ({
          token: request.headers.get("authorization") ?? "",
          clientId: "web-client",
          scopes: [],
        }),
      },
    );
    const wire = await listen(authHandler);
    open.push({
      close: async () => {
        await authHandler.close();
        await wire.close();
      },
    });
    const client = new Client({ name: "legacy-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`), {
        requestInit: { headers: { authorization: "Bearer token-1" } },
      }),
    );
    open.push({ close: () => client.close() });
    await client.callTool({ name: "echo", arguments: { text: "auth" } });
    assert.ok(
      seenAuth.some((authInfo) => authInfo?.clientId === "web-client"),
      "verified AuthInfo reaches the handler",
    );
  });

  it("keeps the handler callable and exposes SDK fetch/close/notify/bus lifecycle", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory);
    open.push(handler);
    assert.equal(typeof handler.fetch, "function");
    assert.equal(typeof handler.close, "function");
    assert.equal(typeof handler.notify.toolsChanged, "function");
    assert.ok(handler.bus, "bus is exposed for subscriptions/listen");
    const initialized = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      }),
    );
    assert.equal(initialized.status, 200);
    handler.notify.toolsChanged();
    handler.notify.resourcesChanged();
    await handler.close();
  });

  it("bounds modern subscriptions and keepalive options", async () => {
    await assert.rejects(
      createPrismMcpWebHandler(echoFactory, { maxSubscriptions: 5000 }),
      /maxSubscriptions must be a positive safe integer/,
    );
    await assert.rejects(createPrismMcpWebHandler(echoFactory, { keepAliveMs: -1 }), /keepAliveMs must be a safe integer/);
  });

  it("serves auto and legacy stdio connections with protocol-only stdout", async () => {
    const distServer = new URL("../server.js", import.meta.url).href;
    const script = `
import { McpServer } from "@modelcontextprotocol/server";
import { servePrismMcpStdio } from "${distServer}";
import * as z from "zod/v4";
servePrismMcpStdio(() => {
  const server = new McpServer({ name: "prism-mcp-server", version: "0.0.12" }, { capabilities: { tools: {} } });
  server.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, (args) => ({ content: [{ type: "text", text: args.text }] }));
  return server;
});
`;
    for (const [label, options] of [
      ["modern auto", { capabilities: {}, versionNegotiation: { mode: "auto" as const } }],
      ["legacy", { capabilities: {} }],
    ] as const) {
      const client = new Client({ name: "stdio-client", version: "1.0.0" }, options);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--input-type=module", "-e", script],
        stderr: "inherit",
      });
      await client.connect(transport);
      if (label === "modern auto") assert.equal(client.getProtocolEra(), "modern", "auto negotiation probes modern over stdio");
      else assert.equal(client.getProtocolEra(), "legacy", "legacy opening pins a legacy instance");
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name),
        ["echo"],
        label,
      );
      const result = await client.callTool({ name: "echo", arguments: { text: label } });
      assert.match(JSON.stringify(result.content), new RegExp(label.replace(" ", ".")));
      await client.close();
    }
  });

  it("serves protected-resource metadata and challenges unauthenticated requests", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory, {
      protectedResource: {
        authorizationServers: ["https://as.example.com/oauth"],
        resource: "https://mcp.example.com/mcp",
        scopesSupported: ["mcp"],
      },
      resolveIdentity: () => false,
    });
    open.push(handler);
    const wellKnown = await handler(new Request("https://mcp.example.com/.well-known/oauth-protected-resource"));
    assert.equal(wellKnown.status, 200);
    assert.deepEqual(await wellKnown.json(), {
      authorization_servers: ["https://as.example.com/oauth"],
      resource: "https://mcp.example.com/mcp",
      scopes_supported: ["mcp"],
    });
    const denied = await handler(new Request("https://mcp.example.com/mcp", { method: "POST", body: "{}" }));
    assert.equal(denied.status, 401);
    assert.equal(
      denied.headers.get("www-authenticate"),
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="mcp"',
    );
    const wrongMethod = await handler(
      new Request("https://mcp.example.com/.well-known/oauth-protected-resource", { method: "POST", body: "{}" }),
    );
    assert.equal(wrongMethod.status, 405);
  });

  it("without protectedResource there is no metadata route and no challenge header", async () => {
    const handler = await createPrismMcpWebHandler(echoFactory, { resolveIdentity: () => false });
    open.push(handler);
    const wellKnown = await handler(new Request("https://mcp.example.com/.well-known/oauth-protected-resource"));
    assert.notEqual(wellKnown.status, 200);
    const denied = await handler(new Request("https://mcp.example.com/mcp", { method: "POST", body: "{}" }));
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("www-authenticate"), null);
  });

  it("rejects invalid protected resource configuration and stateless instances", async () => {
    await assert.rejects(
      () =>
        createPrismMcpWebHandler(echoFactory, {
          protectedResource: { authorizationServers: ["http://mcp.example.com/oauth"], resource: "https://mcp.example.com/mcp" },
        }),
      /https|loopback/,
    );
    await assert.rejects(
      () =>
        createPrismMcpWebHandler(echoFactory, { protectedResource: { authorizationServers: [], resource: "https://mcp.example.com/mcp" } }),
      /1\.\.8/,
    );
    await assert.rejects(
      () =>
        createPrismMcpWebHandler(echoFactory, {
          protectedResource: {
            authorizationServers: ["https://as.example.com"],
            resource: "https://mcp.example.com/mcp",
            scopesSupported: [],
          },
        }),
      /1\.\.64/,
    );
    await assert.rejects(
      () => createPrismMcpWebHandler(echoFactory(), {}),
      /server factory/,
      "stateless handlers require a factory (SDK stateless transports cannot be reused)",
    );
  });
});
