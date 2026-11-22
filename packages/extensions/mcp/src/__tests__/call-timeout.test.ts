import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import {
  type AgentEvent,
  createAgent,
  definePackage,
  PackageLoadError,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { attachMcpToolBridge, connectMcpTools } from "../bridge.js";
import { mcp } from "../package.js";

// Timings are a scaled-down real clock (ms, not s): the SDK's request timers and the
// in-memory transport both run on real timers, and the repo has no fake-clock harness.

const executionContext = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SlowServer {
  readonly clientTransport: InMemoryTransport;
  readonly server: McpServer;
  readonly cancelled: string[];
}

/** One `slow` tool: runs `durationMs`, optionally sending progress every `progressEveryMs`. */
async function slowServer(options: { readonly durationMs: number; readonly progressEveryMs?: number }): Promise<SlowServer> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "slow", version: "1.0.0" }, { capabilities: { tools: {} } });
  const cancelled: string[] = [];
  server.registerTool("slow", { description: "slow", inputSchema: { msg: z.string().optional() } }, async (_args, ctx) => {
    const signal = ctx.mcpReq.signal;
    signal.addEventListener("abort", () => cancelled.push(String(ctx.mcpReq.id)), { once: true });
    const token = ctx.mcpReq._meta?.progressToken;
    const started = Date.now();
    let progress = 0;
    while (Date.now() - started < options.durationMs && !signal.aborted) {
      await sleep(options.progressEveryMs ?? options.durationMs);
      if (options.progressEveryMs !== undefined && token !== undefined && !signal.aborted) {
        progress += 1;
        await ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress } });
      }
    }
    return { content: [{ type: "text" as const, text: "done" }] };
  });
  await server.connect(serverTransport);
  return { clientTransport, server, cancelled };
}

async function attachSlow(fixture: SlowServer, limits: { callTimeoutMs?: number; maxCallTimeMs?: number }) {
  const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
  await client.connect(fixture.clientTransport);
  return attachMcpToolBridge(client, fixture.clientTransport, { serverId: "slow", ...limits });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe("MCP call timeouts (plan 234 Task 2)", () => {
  it("tool_call_outlives_the_connect_timeout", async () => {
    const fixture = await slowServer({ durationMs: 150 });
    const transports = definePackage({
      name: "raw-transport-service",
      version: "1.0.0",
      requires: { api: 2 },
      setup(prism) {
        prism.services.provide("mcp.transport", { slow: fixture.clientTransport });
      },
    });
    const events: AgentEvent[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "test" },
      packages: [
        mockProvider([
          [providerToolCall(toolCallContent("call_slow", "mcp:slow:slow", {})), providerDone()],
          [providerTextDelta("ok"), providerDone()],
        ]),
        transports,
        // The call (150) runs well past the connect timeout (40); before Task 2 the
        // connect value was also the call limit and cut it.
        mcp({ servers: [{ id: "slow", transport: "raw", allow: "raw", connectTimeoutMs: 40 }] }),
      ],
    });
    cleanups.push(() => agent.dispose());
    const session = await agent.session();
    const sub = session.subscribe();
    const pump = (async () => {
      for await (const event of sub) events.push(event);
    })();
    await session.run("go");
    await pump;
    const ends = events.filter((event) => event.type === "tool.completed");
    assert.equal(ends.length, 1);
    assert.doesNotMatch(JSON.stringify(ends[0]), /timed out|"error"/);
    assert.match(JSON.stringify(ends[0]), /done/);
  }, 5_000);

  it("call_times_out_at_call_timeout_without_progress", async () => {
    const fixture = await slowServer({ durationMs: 2_000 });
    const bridge = await attachSlow(fixture, { callTimeoutMs: 60, maxCallTimeMs: 5_000 });
    cleanups.push(() => bridge.close());
    const started = Date.now();
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.ok(Date.now() - started < 1_000, "ended at callTimeoutMs, not maxCallTimeMs or the tool's end");
    assert.match(result.error?.message ?? "", /MCP server "slow" tool call timed out after callTimeoutMs \(60ms\) without progress/);
  }, 5_000);

  it("progress_extends_a_call_up_to_max_call_time", async () => {
    // Progress every 20 ms keeps a 60 ms call timeout alive for a 250 ms call.
    const finishes = await slowServer({ durationMs: 250, progressEveryMs: 20 });
    const ok = await attachSlow(finishes, { callTimeoutMs: 60, maxCallTimeMs: 2_000 });
    cleanups.push(() => ok.close());
    const done = await ok.tools[0]!.execute({}, executionContext);
    assert.equal(done.error, undefined, done.error?.message);

    // Endless progress still ends at maxCallTimeMs.
    const endless = await slowServer({ durationMs: 10_000, progressEveryMs: 20 });
    const capped = await attachSlow(endless, { callTimeoutMs: 60, maxCallTimeMs: 200 });
    cleanups.push(() => capped.close());
    const started = Date.now();
    const result = await capped.tools[0]!.execute({}, executionContext);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 190 && elapsed < 1_000, `ended at maxCallTimeMs, took ${elapsed}ms`);
    assert.match(result.error?.message ?? "", /MCP server "slow" tool call exceeded maxCallTimeMs \(200ms\)/);
  }, 5_000);

  it("timeout_cancels_the_server_request: legacy era sends notifications/cancelled", async () => {
    const fixture = await slowServer({ durationMs: 2_000 });
    const bridge = await attachSlow(fixture, { callTimeoutMs: 50 });
    cleanups.push(() => bridge.close());
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.ok(result.error);
    for (let i = 0; i < 40 && fixture.cancelled.length === 0; i += 1) await sleep(10);
    assert.equal(fixture.cancelled.length, 1, "the server's request signal aborted from notifications/cancelled");
  }, 5_000);

  it("timeout_cancels_the_server_request: 2026-07-28 era aborts the HTTP request", async () => {
    const bodies: string[] = [];
    let callAborted = false;
    const http: HttpServer = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      bodies.push(body);
      const parsed = JSON.parse(body) as { id?: unknown; method?: string };
      response.setHeader("content-type", "application/json");
      const reply = (result: unknown) => response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));
      if (parsed.method === "server/discover") {
        reply({
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: {} },
          _meta: { "io.modelcontextprotocol/serverInfo": { name: "raw", version: "1.0.0" } },
        });
      } else if (parsed.method === "tools/list") {
        reply({ tools: [{ name: "slow", inputSchema: { type: "object" } }], ttlMs: 0, cacheScope: "private", resultType: "complete" });
      } else if (parsed.method === "tools/call") {
        response.on("close", () => {
          if (!response.writableEnded) callAborted = true;
        });
        await sleep(2_000);
        if (!response.destroyed) reply({ content: [], resultType: "complete" });
      } else {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32601, message: "Method not found" } }));
      }
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    cleanups.push(async () => {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    });
    const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const bridge = await connectMcpTools({
      serverId: "modern",
      transport: { type: "streamable-http", url: `${origin}/mcp`, allowedOrigins: [origin], allowLoopbackHttp: true },
      connectTimeoutMs: 5_000,
      callTimeoutMs: 50,
    });
    cleanups.push(() => bridge.close());
    assert.equal(bridge.protocolEra, "modern");
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.match(result.error?.message ?? "", /callTimeoutMs \(50ms\)/);
    for (let i = 0; i < 40 && !callAborted; i += 1) await sleep(10);
    assert.equal(callAborted, true, "the per-request HTTP stream was aborted");
    assert.equal(bodies.filter((body) => body.includes("notifications/cancelled")).length, 0);
  }, 5_000);

  it("run_abort_still_cancels_a_call_at_once", async () => {
    const fixture = await slowServer({ durationMs: 2_000 });
    const bridge = await attachSlow(fixture, {});
    cleanups.push(() => bridge.close());
    const controller = new AbortController();
    const started = Date.now();
    const pending = bridge.tools[0]!.execute({}, { ...executionContext, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("run aborted")), 20);
    const result = await pending;
    assert.ok(Date.now() - started < 500);
    assert.match(result.error?.message ?? "", /run aborted/);
  }, 5_000);

  it("invalid_timeout_config_fails_the_load", async () => {
    const server = { id: "s", transport: "raw" as const, allow: "raw" };
    const cases = [
      { connectTimeoutMs: 0 },
      { callTimeoutMs: -1 },
      { maxCallTimeMs: 1.5 },
      { servers: [{ ...server, callTimeoutMs: 0 }] },
      { servers: [{ ...server, callTimeoutMs: 10_000, maxCallTimeMs: 5_000 }] },
    ];
    for (const config of cases) {
      await assert.rejects(
        createAgent({ model: { provider: "mock", model: "test" }, packages: [mockProvider(), mcp({ servers: [server], ...config })] }),
        (error: unknown) => error instanceof PackageLoadError && error.code === "config_invalid",
        JSON.stringify(config),
      );
    }
    // Any positive host value loads, hours included (a server with no transport service just fails to connect).
    const agent = await createAgent({
      model: { provider: "mock", model: "test" },
      packages: [
        mockProvider(),
        mcp({ servers: [server], connectTimeoutMs: 50, callTimeoutMs: 4 * 3_600_000, maxCallTimeMs: 4 * 3_600_000 }),
      ],
    });
    await agent.dispose();
  });
});
