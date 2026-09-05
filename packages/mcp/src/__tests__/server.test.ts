import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  type CommandDefinition,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemoryToolEffectStore,
  createMockProvider,
  createSecretRedactor,
  createStaticPermissionPolicy,
  providerDone,
  type ToolDefinition,
  toolCallContent,
} from "@arnilo/prism";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createPrismMcpServer, createPrismMcpWebHandler } from "../server.js";
import { McpBridgeError } from "../types.js";

async function fixture(options: Parameters<typeof createPrismMcpServer>[0]) {
  const server = createPrismMcpServer(options);
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    server,
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe("Prism MCP server", () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    while (open.length > 0) await open.pop()?.close();
  });

  it("lists and calls only selected Prism tools and commands", async () => {
    const tool: ToolDefinition = {
      name: "echo",
      description: "Echo text",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute(args, context) {
        return { toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } };
      },
    };
    const command: CommandDefinition = {
      name: "workflow.status",
      parameters: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      execute(args) {
        return { name: "workflow.status", value: { runId: args.runId, status: "suspended" } };
      },
    };
    const seen: string[] = [];
    const item = await fixture({
      tools: [tool],
      commands: [command],
      authorize(input) {
        seen.push(`${input.kind}:${input.name}`);
        return { allowed: true, ownership: { tenantId: "tenant-1" } };
      },
    });
    open.push(item);

    const listed = await item.client.listTools();
    assert.deepEqual(listed.tools.map((entry) => entry.name).sort(), ["echo", "workflow.status"]);
    const echo = await item.client.callTool({ name: "echo", arguments: { text: "hi" } });
    assert.equal(echo.isError, false);
    assert.match(JSON.stringify(echo.content), /hi/);
    const status = await item.client.callTool({ name: "workflow.status", arguments: { runId: "r1" } });
    assert.match(JSON.stringify(status.content), /suspended/);
    assert.deepEqual(seen, ["tool:echo", "command:workflow.status"]);
  });

  it("passes the configured effect store and verified owner into core dispatch", async () => {
    let key: string | undefined;
    const identity = {
      tenantId: "tenant-1",
      userId: "user-1",
      principal: { kind: "user" as const, id: "user-1" },
      scopes: ["tool:execute"],
      issuedAt: "2026-08-04T00:00:00.000Z",
      verified: true as const,
    };
    const item = await fixture({
      effectStore: createMemoryToolEffectStore(),
      tools: [
        {
          name: "mutate",
          effect: { kind: "external_mutation", idempotency: "required" },
          execute: (_args, context) => {
            key = context.idempotencyKey;
            return { toolCallId: context.toolCallId, name: "mutate", value: "done" };
          },
        },
      ],
      authorize: () => ({ allowed: true, ownership: { tenantId: "tenant-1", userId: "user-1" }, identity }),
    });
    open.push(item);
    const result = await item.client.callTool({ name: "mutate", arguments: {} });
    assert.equal(result.isError, false);
    assert.match(key ?? "", /^prism:tool-effect:v1:[a-f0-9]{64}$/);
  });

  it("registers durable agent lifecycle tools only when explicitly selected", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    const agent = createAgent({
      id: "support",
      model: { provider: "mock", model: "offline" },
      provider: createMockProvider([{ type: "tool_call", call: toolCallContent("call-1", "write", {}) }, providerDone()]),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: ++calls }) }],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const suspended = await agent.createSession().run("go", { ownership: { tenantId: "tenant-1", userId: "user-1" } });
    const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
    const item = await fixture({
      agentRuns: { support: { lifecycle } },
      authorize: () => ({ allowed: true, ownership: { tenantId: "tenant-1", userId: "user-1" } }),
    });
    open.push(item);
    assert.deepEqual((await item.client.listTools()).tools.map((entry) => entry.name).sort(), [
      "agent.support.resume",
      "agent.support.status",
    ]);
    const status = await item.client.callTool({ name: "agent.support.status", arguments: { runId: suspended.runId } });
    assert.equal(status.isError, false);
    assert.match(JSON.stringify(status.content), /suspended/);
    const denied = await item.client.callTool({
      name: "agent.support.resume",
      arguments: {
        runId: suspended.runId,
        decision: "deny",
        expectedVersion: suspended.runState!.version,
      },
    });
    assert.equal(denied.isError, false);
    assert.match(JSON.stringify(denied.content), /denied/);
    assert.equal(calls, 0);

    const empty = await fixture({
      tools: [{ name: "echo", execute: () => ({ toolCallId: "echo", name: "echo" }) }],
      authorize: () => ({ allowed: true, ownership: { tenantId: "tenant-1", userId: "user-1" } }),
    });
    open.push(empty);
    assert.equal(
      (await empty.client.listTools()).tools.some((tool) => tool.name.startsWith("agent.")),
      false,
    );
  });

  it("fails closed on authorization, validation, permission, duplicate names, and unknown tools", async () => {
    let executions = 0;
    const tool: ToolDefinition = {
      name: "danger",
      parameters: { type: "object", properties: { ok: { type: "boolean" } } },
      execute(_args, context) {
        executions += 1;
        return { toolCallId: context.toolCallId, name: "danger", value: "ran" };
      },
    };
    const denied = await fixture({ tools: [tool], authorize: () => false });
    open.push(denied);
    assert.equal((await denied.client.callTool({ name: "danger", arguments: {} })).isError, true);
    assert.equal(executions, 0);
    await denied.close();
    open.pop();

    const guarded = await fixture({
      tools: [tool],
      authorize: () => ({ allowed: true }),
      validate: () => "blocked by validator",
    });
    open.push(guarded);
    const invalid = await guarded.client.callTool({ name: "danger", arguments: {} });
    assert.equal(invalid.isError, true);
    assert.match(JSON.stringify(invalid.content), /blocked by validator/);
    assert.equal(executions, 0);
    // v2 SDK: McpServer rejects unknown tools with a JSON-RPC error instead of
    // returning an isError tool result.
    await assert.rejects(() => guarded.client.callTool({ name: "missing", arguments: {} }), /missing/);
    await guarded.close();
    open.pop();

    const permissionDenied = await fixture({
      tools: [tool],
      authorize: () => ({ allowed: true }),
      permission: createStaticPermissionPolicy(false),
    });
    open.push(permissionDenied);
    assert.equal((await permissionDenied.client.callTool({ name: "danger", arguments: {} })).isError, true);
    assert.equal(executions, 0);

    assert.throws(
      () =>
        createPrismMcpServer({
          tools: [tool],
          commands: [{ name: "danger", execute: () => ({ name: "danger" }) }],
          authorize: () => ({ allowed: true }),
        }),
      McpBridgeError,
    );
  });

  it("bounds concurrent calls, timeouts, results, and redacts errors", async () => {
    const secret = "mcp-server-canary";
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tool: ToolDefinition = {
      name: "slow",
      execute: async (_args, context) => {
        await Promise.race([
          gate,
          new Promise<void>((resolve) => context.signal?.addEventListener("abort", () => resolve(), { once: true })),
        ]);
        return { toolCallId: context.toolCallId, name: "slow", value: `${secret}-${"x".repeat(100)}` };
      },
    };
    const item = await fixture({
      tools: [tool],
      authorize: () => ({ allowed: true }),
      redactor: createSecretRedactor([secret]),
      maxConcurrentCalls: 1,
      callTimeoutMs: 20,
      maxResultBytes: 40,
    });
    open.push(item);

    const first = item.client.callTool({ name: "slow", arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const busy = await item.client.callTool({ name: "slow", arguments: {} });
    assert.equal(busy.isError, true);
    assert.match(JSON.stringify(busy.content), /CONCURRENCY/);
    const timed = await first;
    assert.equal(timed.isError, true);
    assert.doesNotMatch(JSON.stringify(timed), new RegExp(secret));
    release?.();
  });

  it("binds stateful Streamable HTTP sessions to host-validated identity", async () => {
    const server = createPrismMcpServer({ authorize: () => ({ allowed: true }) });
    open.push(server);
    const handler = await createPrismMcpWebHandler(server, {
      allowedOrigins: ["https://example.test"],
      sessionIdGenerator: () => "session-1",
      resolveAuthInfo: (request) => ({ token: request.headers.get("authorization") ?? "", clientId: "client", scopes: [] }),
      resolveIdentity: (_request, auth) =>
        auth?.token === "Bearer a" ? { id: "principal-a" } : auth?.token === "Bearer b" ? { id: "principal-b" } : false,
    });
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

  it("provides a bounded web-standard Streamable HTTP handler", async () => {
    // Stateless handlers need a server factory: a fresh McpServer per request.
    const factory = () => createPrismMcpServer({ authorize: () => ({ allowed: true }) });
    const handler = await createPrismMcpWebHandler(factory, { maxRequestBytes: 256 });

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
});

describe("dual-era MCP serving (plan 063 task 4)", () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    while (open.length > 0) await open.pop()?.close();
  });

  const echoTool: ToolDefinition = {
    name: "echo",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } }),
  };
  const factory = () => createPrismMcpServer({ tools: [echoTool], authorize: () => ({ allowed: true, ownership: { tenantId: "tenant-1" } }) });

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
    const handler = await createPrismMcpWebHandler(factory);
    const wire = await listen(handler);
    open.push({ close: async () => { await handler.close(); await wire.close(); } });

    const client = new Client(
      { name: "modern-client", version: "1.0.0" },
      { capabilities: {}, versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`)));
    open.push({ close: () => client.close() });
    assert.equal(client.getProtocolEra(), "modern");

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["echo"]);
    // Tasks boundary (plan 063 task 6): the server advertises no Tasks capability.
    const serverCaps = client.getServerCapabilities() as { tasks?: unknown; extensions?: Record<string, unknown> };
    assert.equal(serverCaps.tasks, undefined);
    assert.equal("io.modelcontextprotocol/tasks" in (serverCaps.extensions ?? {}), false);
    const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    assert.equal(result.isError, false);
    assert.match(JSON.stringify(result.content), /hi/);
    assert.ok(
      wire.responseHeaders.every((headers) => !headers.some(([name]) => name.toLowerCase() === "mcp-session-id")),
      "modern responses carry no legacy session id",
    );
  });

  it("keeps legacy stateless HTTP clients on the SDK stateless fallback", async () => {
    const handler = await createPrismMcpWebHandler(factory);
    const wire = await listen(handler);
    open.push({ close: async () => { await handler.close(); await wire.close(); } });

    const client = new Client({ name: "legacy-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`)));
    open.push({ close: () => client.close() });
    assert.equal(client.getProtocolEra(), "legacy");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["echo"]);
    const result = await client.callTool({ name: "echo", arguments: { text: "yo" } });
    assert.match(JSON.stringify(result.content), /yo/);
  });

  it("routes classified legacy session traffic beside a strict modern handler", async () => {
    const handler = await createPrismMcpWebHandler(factory, {
      sessionIdGenerator: () => "session-9",
      resolveIdentity: () => ({ id: "principal-1" }),
      allowedOrigins: ["https://example.test"],
    });
    const wire = await listen(handler);
    open.push({ close: async () => { await handler.close(); await wire.close(); } });

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
    const originHandler = await createPrismMcpWebHandler(factory, { allowedOrigins: ["https://good.test"], maxRequestBytes: 64 });
    open.push(originHandler);
    const evil = await originHandler(
      new Request("https://good.test/mcp", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: evilBody,
      }),
    );
    assert.equal(evil.status, 403, "origin rejection precedes body parsing (403, not 413)");

    const hostHandler = await createPrismMcpWebHandler(factory, { allowedHosts: ["good.test"] });
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
      () =>
        createPrismMcpServer({
          tools: [echoTool],
          authorize: (input) => {
            seenAuth.push(input.authInfo);
            return { allowed: true, ownership: { tenantId: "tenant-1" } };
          },
        }),
      {
        resolveAuthInfo: (request) => ({
          token: request.headers.get("authorization") ?? "",
          clientId: "web-client",
          scopes: [],
        }),
      },
    );
    const wire = await listen(authHandler);
    open.push({ close: async () => { await authHandler.close(); await wire.close(); } });
    const client = new Client({ name: "legacy-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${wire.origin}/mcp`), {
      requestInit: { headers: { authorization: "Bearer token-1" } },
    }));
    open.push({ close: () => client.close() });
    await client.callTool({ name: "echo", arguments: { text: "auth" } });
    assert.ok(seenAuth.some((authInfo) => authInfo?.clientId === "web-client"), "verified AuthInfo reaches authorize");
  });

  it("keeps the handler callable and exposes SDK fetch/close/notify/bus lifecycle", async () => {
    const handler = await createPrismMcpWebHandler(factory);
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
      createPrismMcpWebHandler(factory, { maxSubscriptions: 5000 }),
      /maxSubscriptions must be a positive safe integer/,
    );
    await assert.rejects(
      createPrismMcpWebHandler(factory, { keepAliveMs: -1 }),
      /keepAliveMs must be a safe integer/,
    );
  });

  it("serves auto and legacy stdio connections with protocol-only stdout", async () => {
    const distServer = new URL("../server.js", import.meta.url).href;
    const script = `
import { createPrismMcpServer, servePrismMcpStdio } from "${distServer}";
const echo = {
  name: "echo",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } }),
};
servePrismMcpStdio(() => createPrismMcpServer({ tools: [echo], authorize: async () => ({ allowed: true, ownership: { tenantId: "t" } }) }));
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
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["echo"], label);
      const result = await client.callTool({ name: "echo", arguments: { text: label } });
      assert.match(JSON.stringify(result.content), new RegExp(label.replace(" ", ".")));
      await client.close();
    }
  });
});
