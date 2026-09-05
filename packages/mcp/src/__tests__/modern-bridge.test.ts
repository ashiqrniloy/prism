import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { acceptedContent, createMcpHandler, inputRequired, McpServer, WebStandardStreamableHTTPServerTransport, fromJsonSchema } from "@modelcontextprotocol/server";
import { Client, type Transport } from "@modelcontextprotocol/client";
import { attachMcpToolBridge, connectMcpTools } from "../bridge.js";
import { connectMcpCapabilities } from "../capabilities.js";
import type { ConnectMcpToolsOptions } from "../types.js";
import { McpBridgeError } from "../types.js";

const executionContext = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

interface WireFixture {
  readonly origin: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

const wireFixtures: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (wireFixtures.length > 0) await wireFixtures.pop()!.close();
});

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<HttpServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return server;
}

async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function bridgeTransport(origin: string): ConnectMcpToolsOptions["transport"] {
  return {
    type: "streamable-http",
    url: `${origin}/mcp`,
    allowedOrigins: [origin],
    allowLoopbackHttp: true,
  };
}

function bodyMethod(raw: string): string | undefined {
  try {
    return (JSON.parse(raw) as { method?: string }).method;
  } catch {
    return undefined;
  }
}

function requestCount(fixture: WireFixture, method: string): number {
  return fixture.requests.filter((request) => bodyMethod(request.body) === method).length;
}

async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("condition not reached before timeout");
}

interface ModernTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly ui?: { readonly resourceUri: string; readonly visibility?: readonly string[] };
  /** Overrides the echo callback (e.g. MRTR tools reading `ctx.mcpReq.inputResponses`). */
  readonly handler?: (args: Record<string, unknown>, ctx: { readonly mcpReq?: { readonly inputResponses?: Record<string, unknown> } }) => unknown;
}

interface ModernFixture extends WireFixture {
  readonly notify: ReturnType<typeof createMcpHandler>["notify"];
}

/** Real SDK serving: `createMcpHandler` over node:http, fresh McpServer per request from the mutable registry. */
async function modernServer(
  tools: ModernTool[],
  options?: { readonly cacheHints?: Record<string, { readonly ttlMs: number; readonly cacheScope?: "public" | "private" }> },
): Promise<ModernFixture> {
  const requests: RecordedRequest[] = [];
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "modern-server", version: "1.0.0" },
        {
          capabilities: { tools: { listChanged: true } },
          ...(options?.cacheHints ? { cacheHints: options.cacheHints } : {}),
        },
      );
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: fromJsonSchema(tool.inputSchema ?? { type: "object" }) },
          async (args: unknown, ctx) => {
            if (tool.handler) return tool.handler((args ?? {}) as Record<string, unknown>, ctx) as never;
            return { content: [{ type: "text" as const, text: JSON.stringify(args ?? {}) }] };
          },
        );
      }
      return server;
    },
    {},
  );
  const http = await listen(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: body.toString() });
    const webRequest = new Request(url, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body: request.method === "GET" || request.method === "DELETE" ? undefined : body,
    });
    const webResponse = await handler.fetch(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    for await (const chunk of webResponse.body ?? new Uint8Array()) response.write(chunk);
    response.end();
  });
  wireFixtures.push({
    close: async () => {
      await handler.close();
      await closeHttp(http);
    },
  });
  return {
    origin: `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    requests,
    notify: handler.notify,
    close: wireFixtures[wireFixtures.length - 1]!.close,
  };
}

/** Legacy-only 2025 serving: fresh stateless `WebStandardStreamableHTTPServerTransport` per request. */
async function legacyServer(
  tools: ModernTool[],
  options?: {
    readonly extensions?: Record<string, Record<string, never>>;
    readonly resources?: readonly { readonly name: string; readonly uri: string; readonly html: string }[];
  },
): Promise<WireFixture> {
  const requests: RecordedRequest[] = [];
  const http = await listen(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: body.toString() });
    const webRequest = new Request(url, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body: request.method === "GET" || request.method === "DELETE" ? undefined : body,
    });
    const server = new McpServer(
      { name: "legacy-server", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true }, ...(options?.extensions ? { extensions: options.extensions } : {}) } },
    );
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: fromJsonSchema(tool.inputSchema ?? { type: "object" }),
          ...(tool.ui ? { _meta: { ui: tool.ui } } : {}),
        },
        async (args: unknown) => ({
          content: [{ type: "text" as const, text: JSON.stringify(args ?? {}) }],
        }),
      );
    }
    for (const resource of options?.resources ?? []) {
      server.registerResource(resource.name, resource.uri, { mimeType: "text/html;profile=mcp-app" }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: resource.html }],
      }));
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const webResponse = await transport.handleRequest(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    for await (const chunk of webResponse.body ?? new Uint8Array()) response.write(chunk);
    response.end();
  });
  wireFixtures.push({
    close: async () => closeHttp(http),
  });
  return {
    origin: `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    requests,
    close: wireFixtures[wireFixtures.length - 1]!.close,
  };
}

/**
 * Minimal modern JSON-RPC endpoint with full response control (cache hints,
 * mismatch errors, hostile hints). Serves a single tool named `weather` and
 * honors `server/discover` / `tools/list` / `tools/call`.
 */
async function rawModernServer(handlers: {
  readonly toolsList?: () => unknown;
  readonly toolsCall?: () => unknown;
  readonly resourcesList?: () => unknown;
  readonly resourcesRead?: () => unknown;
  readonly slowListMs?: number;
  readonly extensions?: Record<string, Record<string, never>>;
}): Promise<WireFixture> {
  const requests: RecordedRequest[] = [];
  const http = await listen(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: body.toString() });
    const parsed = JSON.parse(body.toString()) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    response.setHeader("content-type", "application/json");
    if (parsed.method === "server/discover") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: {
            supportedVersions: ["2026-07-28"],
            capabilities: {
              tools: { listChanged: true },
              ...(handlers.resourcesList ? { resources: { listChanged: true } } : {}),
              ...(handlers.extensions ? { extensions: handlers.extensions } : {}),
            },
            _meta: { "io.modelcontextprotocol/serverInfo": { name: "raw-server", version: "1.0.0" } },
          },
        }),
      );
      return;
    }
    if (parsed.method === "tools/list") {
      if (handlers.slowListMs) await new Promise((resolve) => setTimeout(resolve, handlers.slowListMs));
      const result = handlers.toolsList?.() ?? { tools: [] };
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { tools: [], ttlMs: 0, cacheScope: "private", ...(result as object), resultType: "complete" },
        }),
      );
      return;
    }
    if (parsed.method === "resources/list") {
      const result = handlers.resourcesList?.() ?? { resources: [] };
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { resources: [], ttlMs: 0, cacheScope: "private", ...(result as object), resultType: "complete" },
        }),
      );
      return;
    }
    if (parsed.method === "resources/read") {
      const result = handlers.resourcesRead?.() ?? { contents: [] };
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { contents: [], ttlMs: 0, cacheScope: "private", ...(result as object), resultType: "complete" },
        }),
      );
      return;
    }
    if (parsed.method === "tools/call") {
      const outcome = handlers.toolsCall?.() ?? { content: [] };
      const envelope = { jsonrpc: "2.0" as const, id: parsed.id };
      response.end(
        JSON.stringify(
          "error" in (outcome as object)
            ? { ...envelope, error: (outcome as { error: unknown }).error }
            : { ...envelope, result: { ...(outcome as object), resultType: "complete" } },
        ),
      );
      return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32601, message: "Method not found" } }));
  });
  wireFixtures.push({
    close: async () => closeHttp(http),
  });
  return {
    origin: `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    requests,
    close: wireFixtures[wireFixtures.length - 1]!.close,
  };
}

const weatherTool: ModernTool = {
  name: "weather",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" }, apiKey: { type: "string", "x-mcp-header": "X-API-Key" } },
    required: ["city", "apiKey"],
  },
};

describe("modern client negotiation (plan 063 task 2)", () => {
  it("auto mode negotiates modern against createMcpHandler and exposes the era", async () => {
    const fixture = await modernServer([{ name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }]);
    const bridge = await connectMcpTools({
      serverId: "modern",
      transport: bridgeTransport(fixture.origin),
    });
    assert.equal(bridge.protocolEra, "modern");
    assert.equal(bridge.protocolVersion, "2026-07-28");
    assert.deepEqual(bridge.tools.map((tool) => tool.name), ["mcp:modern:echo"]);
    const result = await bridge.tools[0]!.execute({ text: "hi" }, executionContext);
    assert.equal(result.error, undefined);
    await bridge.close();
  });

  it("auto mode falls back to legacy against a 2025-only server", async () => {
    const fixture = await legacyServer([{ name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }]);
    const bridge = await connectMcpTools({
      serverId: "legacy",
      transport: bridgeTransport(fixture.origin),
    });
    assert.equal(bridge.protocolEra, "legacy");
    assert.ok(bridge.protocolVersion === "2025-11-25" || bridge.protocolVersion === "2025-06-18" || bridge.protocolVersion === "2025-03-26");
    assert.deepEqual(bridge.tools.map((tool) => tool.name), ["mcp:legacy:echo"]);
    const result = await bridge.tools[0]!.execute({ text: "hi" }, executionContext);
    assert.equal(result.error, undefined);
    await bridge.close();
  });

  it("explicit legacy mode stays on the 2025 handshake even against a modern server", async () => {
    const fixture = await modernServer([{ name: "echo" }]);
    const bridge = await connectMcpTools({
      serverId: "pinned-legacy",
      transport: bridgeTransport(fixture.origin),
      protocolVersion: "legacy",
    });
    assert.equal(bridge.protocolEra, "legacy");
    await bridge.close();
  });

  it("pin mode rejects a legacy server and accepts a modern one", async () => {
    const legacy = await legacyServer([{ name: "echo" }]);
    await assert.rejects(
      connectMcpTools({
        serverId: "pinned",
        transport: bridgeTransport(legacy.origin),
        protocolVersion: { pin: "2026-07-28" },
      }),
      /did not offer pinned protocol version 2026-07-28/,
    );
    const modern = await modernServer([{ name: "echo" }]);
    const bridge = await connectMcpTools({
      serverId: "pinned",
      transport: bridgeTransport(modern.origin),
      protocolVersion: { pin: "2026-07-28" },
    });
    assert.equal(bridge.protocolEra, "modern");
    await bridge.close();
  });
});

describe("modern routing headers and x-mcp-header mirroring (plan 063 task 2)", () => {
  it("emits protocol/method/name headers plus Mcp-Param mirrors for declared x-mcp-header params", async () => {
    const fixture = await modernServer([weatherTool]);
    const bridge = await connectMcpTools({ serverId: "headers", transport: bridgeTransport(fixture.origin) });
    const result = await bridge.tools[0]!.execute({ city: "Berlin", apiKey: "k-123" }, executionContext);
    assert.equal(result.error, undefined);
    const call = fixture.requests.find((request) => bodyMethod(request.body) === "tools/call");
    assert.ok(call, "expected a tools/call request");
    assert.equal(call.headers["mcp-protocol-version"], "2026-07-28");
    assert.equal(call.headers["mcp-method"], "tools/call");
    assert.equal(call.headers["mcp-name"], "weather");
    // SEP-2243 mirroring uses the declared header name as suffix and carries only
    // the mirror value; undeclared parameters are never mirrored.
    assert.equal(call.headers["mcp-param-x-api-key"], "k-123");
    assert.equal(call.headers["mcp-param-city"], undefined);
    assert.equal(call.headers["x-api-key"], undefined, "the declared header itself is not synthesized by the SDK client");
    await bridge.close();
  });

  it("excludes tools with malformed x-mcp-header declarations before retention", async () => {
    const fixture = await modernServer([
      {
        name: "broken",
        inputSchema: { type: "object", properties: { city: { type: "string", "x-mcp-header": 123 } }, required: ["city"] },
      },
    ]);
    const bridge = await connectMcpTools({ serverId: "malformed", transport: bridgeTransport(fixture.origin) });
    assert.equal(bridge.tools.length, 0, "the malformed tool is excluded by the serving SDK and never retained");
    const call = fixture.requests.find((request) => bodyMethod(request.body) === "tools/call");
    assert.equal(call, undefined, "no call can target an excluded tool");
    await bridge.close();
  });

  it("surfaces a header-mismatch response safely without retry loops", async () => {
    const toolList = {
      tools: [{ name: "weather", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    };
    const fixture = await rawModernServer({
      toolsList: () => toolList,
      toolsCall: () => ({ error: { code: -32020, message: `Header mismatch: Mcp-Param-city=Berlin (${"x".repeat(400)})` } }),
    });
    const bridge = await connectMcpTools({
      serverId: "mismatch",
      transport: bridgeTransport(fixture.origin),
      maxResultBytes: 1_024,
    });
    const result = await bridge.tools[0]!.execute({ city: "Berlin" }, executionContext);
    assert.ok(result.error, "-32020 must surface as a bounded tool error, not a hang or retry loop");
    assert.match(result.error!.message, /Header mismatch/);
    assert.ok(result.error!.message.length <= 1_024, "error message stays bounded");
    assert.equal(requestCount(fixture, "tools/call"), 1, "no evict-refetch-retry when a toolDefinition is supplied");
    await bridge.close();
  });
});

describe("modern subscriptions and cache hints (plan 063 task 2)", () => {
  // Subscription invalidation is exercised in the dedicated describe below; this
  // block covers the local TTL/cache-hint honoring via refresh().
  it("serves refresh() from the local list cache within a server hint capped by the configured ceiling", async () => {
    const fixture = await modernServer([{ name: "echo" }], { cacheHints: { "tools/list": { ttlMs: 60_000, cacheScope: "public" } } });
    const bridge = await connectMcpTools({
      serverId: "cached",
      transport: bridgeTransport(fixture.origin),
      listCacheTtlMs: 200,
    });
    assert.equal(requestCount(fixture, "tools/list"), 1);
    await bridge.refresh();
    assert.equal(requestCount(fixture, "tools/list"), 1, "fresh hinted entry must be served locally");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await bridge.refresh();
    assert.equal(requestCount(fixture, "tools/list"), 2, "configured ceiling must force a refetch");
    await bridge.close();
  });

  it("treats zero server TTL as immediately stale and honors private scope in the per-bridge cache", async () => {
    const zero = await modernServer([{ name: "echo" }], { cacheHints: { "tools/list": { ttlMs: 0, cacheScope: "private" } } });
    const bridgeZero = await connectMcpTools({ serverId: "zero", transport: bridgeTransport(zero.origin) });
    assert.equal(requestCount(zero, "tools/list"), 1);
    await bridgeZero.refresh();
    assert.equal(requestCount(zero, "tools/list"), 2, "zero ttlMs must never serve locally");
    await bridgeZero.close();

    const privateScoped = await modernServer([{ name: "echo" }], { cacheHints: { "tools/list": { ttlMs: 60_000, cacheScope: "private" } } });
    const bridgePrivate = await connectMcpTools({ serverId: "private", transport: bridgeTransport(privateScoped.origin) });
    assert.equal(requestCount(privateScoped, "tools/list"), 1);
    await bridgePrivate.refresh();
    assert.equal(requestCount(privateScoped, "tools/list"), 1, "per-bridge cache never crosses principals; private scope stays local");
    await bridgePrivate.close();
  });

  it("ignores malformed cache hints (refetch-always) and caches valid draft-era hints on attached clients", async () => {
    let calls = 0;
    const hostilePages: unknown[] = [
      { tools: [{ name: "weather", inputSchema: { type: "object" } }], _meta: { cacheHint: { ttlMs: -5, cacheScope: "weird" } } },
      { tools: [{ name: "weather", inputSchema: { type: "object" } }], _meta: { cacheHint: { ttlMs: "60s" } } },
    ];
    const hostile = {
      setNotificationHandler: () => undefined,
      close: async () => undefined,
      listTools: async () => {
        calls += 1;
        return hostilePages[Math.min(calls, hostilePages.length) - 1]!;
      },
    } as unknown as Client;
    const bridge = await attachMcpToolBridge(hostile, { close: async () => undefined } as unknown as Transport, {
      serverId: "hostile",
      listCacheTtlMs: 60_000,
    });
    assert.equal(calls, 1);
    await bridge.refresh();
    await bridge.refresh();
    assert.equal(calls, 3, "malformed hints must fall back to refetch-always");
    await bridge.close();

    // A valid draft-era `_meta.cacheHint` on an attached (host-owned) client is honored.
    let cachedCalls = 0;
    const cached = {
      setNotificationHandler: () => undefined,
      close: async () => undefined,
      listTools: async () => {
        cachedCalls += 1;
        return { tools: [{ name: "weather", inputSchema: { type: "object" } }], _meta: { cacheHint: { ttlMs: 60_000, cacheScope: "private" } } };
      },
    } as unknown as Client;
    const cachedBridge = await attachMcpToolBridge(cached, { close: async () => undefined } as unknown as Transport, {
      serverId: "draft-hint",
      listCacheTtlMs: 200,
    });
    assert.equal(cachedCalls, 1);
    await cachedBridge.refresh();
    assert.equal(cachedCalls, 1, "valid hint serves the local per-bridge cache");
    await cachedBridge.close();

    const noHint = await modernServer([{ name: "echo" }]);
    const noHintBridge = await connectMcpTools({ serverId: "no-hint", transport: bridgeTransport(noHint.origin) });
    assert.equal(requestCount(noHint, "tools/list"), 1);
    await noHintBridge.refresh();
    assert.equal(requestCount(noHint, "tools/list"), 2, "absent hint (immediately stale) must refetch");
    await noHintBridge.close();
  });

  it("cancels an in-flight list during connect", async () => {
    const fixture = await rawModernServer({ slowListMs: 400, toolsList: () => ({ tools: [] }) });
    const controller = new AbortController();
    const pending = connectMcpTools({
      serverId: "abort",
      transport: bridgeTransport(fixture.origin),
      signal: controller.signal,
    });
    controller.abort(new Error("stop"));
    await assert.rejects(pending, /probe failed|closed during|stop|abort/i);
    await assert.rejects(
      connectMcpTools({ serverId: "abort", transport: bridgeTransport(fixture.origin), signal: AbortSignal.abort(new Error("stop")) }),
      /stop|aborted/i,
    );
  });
});

describe("modern subscriptions/listen invalidation (plan 063 task 2)", () => {
  it("invalidates exactly the affected bridge and tears the subscription down on close", async () => {
    const registryA: ModernTool[] = [{ name: "echo" }];
    const fixtureA = await modernServer(registryA);
    const fixtureB = await modernServer([{ name: "echo" }]);
    const bridgeA = await connectMcpTools({ serverId: "sub-a", transport: bridgeTransport(fixtureA.origin) });
    const bridgeB = await connectMcpTools({ serverId: "sub-b", transport: bridgeTransport(fixtureB.origin) });
    assert.equal(requestCount(fixtureA, "tools/list"), 1);
    assert.equal(requestCount(fixtureB, "tools/list"), 1);

    registryA.push({ name: "later" });
    fixtureA.notify.toolsChanged();
    await eventually(() => bridgeA.tools.map((tool) => tool.name).includes("mcp:sub-a:later"));
    assert.equal(requestCount(fixtureA, "tools/list"), 2, "affected bridge refreshes on subscriptions/listen delivery");
    assert.equal(bridgeB.tools.length, 1, "untouched bridge keeps its list");
    assert.equal(requestCount(fixtureB, "tools/list"), 1, "untouched bridge performs no list traffic");

    // close tears the subscription down without hanging and leaves the server bus usable.
    await bridgeA.close();
    fixtureA.notify.toolsChanged();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(requestCount(fixtureA, "tools/list"), 2, "closed bridge performs no further list traffic");
    await bridgeB.close();
  });
});

describe("modern MRTR auto-fulfilment (plan 063 task 3)", () => {
  const elicitationRequest = (message: string) => ({
    inputRequests: {
      confirm: inputRequired.elicit({
        message,
        requestedSchema: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"] },
      }),
    },
  });

  it("fulfils input_required through form elicitation and retries with a fresh wire id", async () => {
    const seenElicitations: unknown[] = [];
    const fixture = await modernServer([
      {
        name: "deploy",
        inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
        handler: async (args, ctx) => {
          const confirmed = acceptedContent<{ confirm: boolean }>(ctx.mcpReq?.inputResponses, "confirm");
          if (!confirmed) return inputRequired(elicitationRequest(`Deploy to ${String(args.env)}?`));
          return { content: [{ type: "text" as const, text: `deployed to ${String(args.env)} confirm=${confirmed.confirm}` }] };
        },
      },
    ]);
    const bridge = await connectMcpCapabilities({
      serverId: "mrtr",
      transport: bridgeTransport(fixture.origin),
      elicitation: async (request) => {
        seenElicitations.push(request.params);
        return { action: "accept" as const, content: { confirm: true }, humanInteraction: true as const };
      },
    });
    const result = await bridge.tools[0]!.execute({ env: "prod" }, executionContext);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
    assert.match(text, /deployed to prod confirm=true/, "accepted content must reach the retried operation");
    assert.equal(seenElicitations.length, 1, "one embedded elicitation round");
    const params = seenElicitations[0] as { mode?: unknown; message?: unknown };
    assert.equal(params.mode ?? "form", "form");
    assert.equal(params.message, "Deploy to prod?");

    const calls = fixture.requests.filter((request) => bodyMethod(request.body) === "tools/call");
    assert.equal(calls.length, 2, "original call plus one MRTR retry");
    const ids = calls.map((call) => (JSON.parse(call.body) as { id?: unknown }).id);
    assert.notEqual(ids[0], ids[1], "the retry must use a fresh wire request id");
    const retry = JSON.parse(calls[1]!.body) as { params?: { inputResponses?: unknown } };
    assert.deepEqual(retry.params?.inputResponses, {
      confirm: { action: "accept", content: { confirm: true } },
    });
    assert.match(JSON.stringify(retry.params?.inputResponses), /"action":"accept"/);
    assert.doesNotMatch(JSON.stringify(retry.params?.inputResponses), /humanInteraction/, "consent marker must stay off the wire");
    await bridge.close();
  });

  for (const action of ["decline", "cancel"] as const) {
    it(`propagates ${action} to the retried operation, which fails closed`, async () => {
      const fixture = await modernServer([
        {
          name: "gate",
          handler: async (_args, ctx) => {
            const view = ctx.mcpReq?.inputResponses?.confirm as { action?: string } | undefined;
            if (view?.action === action) throw new Error(`${action}d by user`);
            if (view?.action === "accept") return { content: [{ type: "text" as const, text: "gate open" }] };
            return inputRequired(elicitationRequest("Open the gate?"));
          },
        },
      ]);
      const bridge = await connectMcpCapabilities({
        serverId: `mrtr-${action}`,
        transport: bridgeTransport(fixture.origin),
        elicitation: async () => ({ action }),
      });
      const result = await bridge.tools[0]!.execute({}, executionContext);
      assert.ok(result.error, `${action} must reach the tool as a declined response`);
      assert.match(result.error!.message, new RegExp(`${action}d by user`));
      await bridge.close();
    });
  }

  it("fails bounded with a typed error when the capability has no registered handler", async () => {
    const fixture = await modernServer([
      {
        name: "gate",
        handler: async () => inputRequired(elicitationRequest("Approve?")),
      },
    ]);
    const bridge = await connectMcpCapabilities({ serverId: "mrtr-nohandler", transport: bridgeTransport(fixture.origin) });
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.ok(result.error);
    assert.match(
      result.error!.message,
      /client capabilities do not declare the required capability/,
      "the server refuses to emit input_required against a client that never declared the capability",
    );
    await bridge.close();
  });

  it("rejects malformed or oversized elicitation callback results before any retry", async () => {
    const fixture = await modernServer([
      {
        name: "gate",
        handler: async () => inputRequired(elicitationRequest("Approve?")),
      },
    ]);
    const malformed = await connectMcpCapabilities({
      serverId: "mrtr-malformed",
      transport: bridgeTransport(fixture.origin),
      elicitation: async () => 42 as never,
    });
    const bad = await malformed.tools[0]!.execute({}, executionContext);
    assert.ok(bad.error);
    assert.match(bad.error!.message, /Invalid MCP elicitation result/);
    await malformed.close();

    const huge = "x".repeat(8 * 1024);
    const oversized = await connectMcpCapabilities({
      serverId: "mrtr-oversized",
      transport: bridgeTransport(fixture.origin),
      maxCapabilityBytes: 1_024,
      elicitation: async () => ({ action: "accept" as const, content: { blob: huge }, humanInteraction: true as const }),
    });
    const tooBig = await oversized.tools[0]!.execute({}, executionContext);
    assert.ok(tooBig.error);
    assert.match(tooBig.error!.message, /MCP elicitation result exceeds 1024 bytes/);
    assert.equal(requestCount(fixture, "tools/call"), 2, "no retry happens after a rejected callback result");
    await oversized.close();
  });

  it("caps MRTR rounds at maxMrtrRounds and rejects out-of-range option values", async () => {
    const fixture = await modernServer([
      {
        name: "loop",
        handler: async () => inputRequired(elicitationRequest("Again?")),
      },
    ]);
    const bridge = await connectMcpCapabilities({
      serverId: "mrtr-cap",
      transport: bridgeTransport(fixture.origin),
      maxMrtrRounds: 3,
      elicitation: async () => ({ action: "decline" }),
    });
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.ok(result.error);
    assert.match(result.error!.message, /still required input after 3 rounds/);
    assert.equal(requestCount(fixture, "tools/call"), 4, "original call plus exactly three bounded retries");
    await bridge.close();

    await assert.rejects(
      connectMcpCapabilities({ serverId: "mrtr-too-many", transport: bridgeTransport(fixture.origin), maxMrtrRounds: 11 }),
      /maxMrtrRounds must be a positive safe integer <= 10/,
    );
  });

  it("aborts an in-flight MRTR round with the caller signal", async () => {
    const fixture = await modernServer([
      {
        name: "gate",
        handler: async () => inputRequired(elicitationRequest("Approve?")),
      },
    ]);
    const controller = new AbortController();
    const bridge = await connectMcpCapabilities({
      serverId: "mrtr-abort",
      transport: bridgeTransport(fixture.origin),
      elicitation: async (request) => {
        await new Promise<never>((_resolve, reject) => {
          if (request.signal.aborted) reject(request.signal.reason);
          else request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      },
    });
    const pending = bridge.tools[0]!.execute({}, { ...executionContext, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("mrtr aborted")), 50);
    const result = await pending;
    assert.ok(result.error);
    assert.match(result.error!.message, /mrtr aborted|abort/i);
    await bridge.close();
  });

  it("URL-mode elicitation reaches the host callback without any automatic navigation", async () => {
    const seen: unknown[] = [];
    const fixture = await modernServer([
      {
        name: "urlgate",
        handler: async (_args, ctx) => {
          const view = ctx.mcpReq?.inputResponses?.confirm as { action?: string } | undefined;
          if (view?.action !== undefined) {
            if (view.action !== "accept") throw new Error("url declined");
            return { content: [{ type: "text" as const, text: "url accepted" }] };
          }
          return inputRequired({ inputRequests: { confirm: inputRequired.elicitUrl({ url: "https://example.com/approve", message: "Approve via link?" }) } });
        },
      },
    ]);
    const bridge = await connectMcpCapabilities({
      serverId: "mrtr-url",
      transport: bridgeTransport(fixture.origin),
      elicitation: async (request) => {
        seen.push(request.params);
        return { action: "decline" };
      },
    });
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.ok(result.error);
    assert.match(result.error!.message, /url declined/, "host policy decides; the URL is never opened");
    const params = seen[0] as { mode?: unknown; url?: unknown; message?: unknown };
    assert.equal(params.mode, "url");
    assert.equal(params.url, "https://example.com/approve");
    assert.equal(params.message, "Approve via link?");
    for (const request of fixture.requests) assert.ok(request.url.startsWith("/mcp"), "no outbound fetch/navigation leaves the client");
    await bridge.close();
  });
});
describe("MCP Apps revalidation and Tasks boundary (plan 063 task 6)", () => {
  const appHtml = "<!doctype html><html><body>card</body></html>";

  it("negotiates io.modelcontextprotocol/ui and reads app resources on the modern era", async () => {
    const fixture = await rawModernServer({
      extensions: { "io.modelcontextprotocol/ui": {} },
      toolsList: () => ({
        tools: [
          {
            name: "card",
            inputSchema: { type: "object" },
            _meta: { ui: { resourceUri: "ui://app/card", visibility: ["app"] } },
          },
        ],
      }),
      resourcesList: () => ({
        resources: [{ uri: "ui://app/card", name: "card", mimeType: "text/html;profile=mcp-app" }],
      }),
      resourcesRead: () => ({
        contents: [{ uri: "ui://app/card", mimeType: "text/html;profile=mcp-app", text: appHtml }],
      }),
    });
    const bridge = await connectMcpTools({
      serverId: "app",
      transport: bridgeTransport(fixture.origin),
      mcpApps: true,
      protocolVersion: { pin: "2026-07-28" },
    });
    // Client advertises only the Apps extension on the wire — never Tasks.
    const discover = fixture.requests.find((request) => bodyMethod(request.body) === "server/discover");
    assert.ok(discover);
    // 2026-07-28: client capabilities are declared per request in params._meta.
    const clientCapabilities = JSON.parse(discover.body).params._meta["io.modelcontextprotocol/clientCapabilities"];
    assert.equal(clientCapabilities.extensions["io.modelcontextprotocol/ui"] !== undefined, true);
    assert.equal("io.modelcontextprotocol/tasks" in (clientCapabilities.extensions ?? {}), false);
    assert.equal(bridge.apps?.negotiated, true);
    assert.deepEqual(
      bridge.apps.tools.map((tool) => [tool.name, tool.visibility]),
      [["card", ["app"]]],
    );
    assert.deepEqual((await bridge.apps.listResources()).map((resource) => resource.uri), ["ui://app/card"]);
    const resource = await bridge.apps.readResource("ui://app/card");
    assert.equal(resource.html, appHtml);
    await bridge.close();
  });

  it("negotiates io.modelcontextprotocol/ui and reads app resources on the legacy era", async () => {
    const fixture = await legacyServer(
      [{ name: "card", inputSchema: { type: "object" }, ui: { resourceUri: "ui://app/card", visibility: ["app"] } }],
      {
        extensions: { "io.modelcontextprotocol/ui": {} },
        resources: [{ name: "card", uri: "ui://app/card", html: appHtml }],
      },
    );
    const bridge = await connectMcpTools({
      serverId: "app",
      transport: bridgeTransport(fixture.origin),
      mcpApps: true,
      protocolVersion: "legacy",
    });
    const initialize = fixture.requests.find((request) => request.body.includes("initialize") && !request.body.includes("notifications/initialized"));
    assert.ok(initialize);
    const clientCapabilities = JSON.parse(initialize.body).params.capabilities;
    assert.equal(clientCapabilities.extensions["io.modelcontextprotocol/ui"] !== undefined, true);
    assert.equal("io.modelcontextprotocol/tasks" in (clientCapabilities.extensions ?? {}), false);
    assert.equal(bridge.apps?.negotiated, true);
    const resource = await bridge.apps.readResource("ui://app/card");
    assert.equal(resource.html, appHtml);
    assert.equal(resource.mimeType, "text/html;profile=mcp-app");
    await bridge.close();
  });

  it("fails closed when a tool result carries the deprecated Tasks vocabulary", async () => {
    const fixture = await rawModernServer({
      toolsList: () => ({ tools: [{ name: "tasky", inputSchema: { type: "object" } }] }),
      toolsCall: () => ({ content: [], task: { taskId: "t-1", status: "completed" } }),
    });
    const bridge = await connectMcpTools({
      serverId: "tasky",
      transport: bridgeTransport(fixture.origin),
      protocolVersion: { pin: "2026-07-28" },
    });
    // Bridge contract: call failures surface as ToolResult.error, fail closed
    // with no value — the deprecated task payload is never read as tool output.
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.match(result.error?.message ?? "", /deprecated task result/);
    assert.equal(result.value, undefined);
    await bridge.close();
  });
});
