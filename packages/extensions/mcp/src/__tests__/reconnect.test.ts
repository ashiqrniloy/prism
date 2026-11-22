import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  definePackage,
  type PackageAPI,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createScriptedHostUi, mockProvider } from "@arnilo/prism/testing";
import { InMemoryTransport, type Transport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { connectMcpTools, type McpPackageConfig, type McpServerConfig, mcp, mcpServerFingerprint } from "../index.js";
import { checkServerTrust } from "../trust.js";

const testModel = { provider: "mock", model: "test" };

/**
 * A raw-transport server that a test can drop. Every connect asks `transport` for a fresh in-memory pair; the
 * `failures` connects after the first get a pair whose server side is already closed, so they fail.
 */
function droppableServer(options: { failures?: number } = {}) {
  let failures = options.failures ?? 0;
  const connects: number[] = [];
  let live: Transport | undefined;
  return {
    connects,
    get transport(): Transport {
      connects.push(Date.now());
      const [client, server] = InMemoryTransport.createLinkedPair();
      if (connects.length > 1 && failures > 0) {
        failures -= 1;
        void server.close();
        return client;
      }
      const mcpServer = new McpServer({ name: "droppable", version: "1.0.0" }, { capabilities: { tools: {} } });
      mcpServer.registerTool("echo", { description: "echo", inputSchema: { msg: z.string().optional() } }, async (args) => ({
        content: [{ type: "text", text: `echoed: ${args.msg ?? ""}` }],
      }));
      void mcpServer.connect(server);
      live = server;
      return client;
    },
    /** The server side goes away: the client transport closes, as when a stdio child exits. */
    drop() {
      void live?.close();
    },
    setFailures(next: number) {
      failures = next;
    },
  };
}

type Droppable = ReturnType<typeof droppableServer>;
type Status = { id: string; state: string; reason?: string; attempt?: number; attempts?: number; toolCount: number };

async function startAgent(
  fixture: Droppable,
  config: Omit<McpPackageConfig, "servers"> = {},
  steps?: Parameters<typeof mockProvider>[0],
  onRequest?: () => void,
) {
  const events: AgentEvent[] = [];
  const offered: string[][] = [];
  const service = definePackage({
    name: "raw-transport-droppable",
    version: "1.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide("mcp.transport", {
        get live() {
          return fixture.transport;
        },
      });
      prism.hooks.on("package.event", (event) => void events.push(event));
    },
  });
  const agent = await createAgent({
    model: testModel,
    packages: [
      mockProvider(steps ?? [[providerTextDelta("ok"), providerDone()]], {
        onRequest: (request) => {
          offered.push((request.tools ?? []).map((tool) => tool.name));
          onRequest?.();
        },
      }),
      service,
      mcp({ ...config, servers: [{ id: "live", transport: "raw", allow: "raw" }] }),
    ],
  });
  const statuses = () =>
    events
      .map((event) => (event as { data?: Status }).data)
      .filter((data): data is Status => data?.id === "live" && typeof data.state === "string");
  return { agent, events, offered, statuses };
}

async function status(agent: Agent): Promise<Status> {
  return ((await agent.commands.run("mcp:status")) as { servers: Status[] }).servers[0] as Status;
}

async function until(check: () => boolean | Promise<boolean>, label: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("@arnilo/prism-extensions/mcp reconnect (plan 234 Task 5)", () => {
  it("closed_transport_reconnects_with_backoff", async () => {
    const fixture = droppableServer();
    const { agent, statuses } = await startAgent(fixture, { reconnect: { attempts: 5, baseDelayMs: 40, maxDelayMs: 1000 } });
    assert.equal((await status(agent)).state, "connected");

    fixture.setFailures(2);
    const dropped = Date.now();
    fixture.drop();
    await until(async () => (await status(agent)).state === "connected" && fixture.connects.length === 4, "the reconnect");

    // Attempt n waits baseDelayMs * 2^(n-1): 40, 80, 160 ms (scaled real clock).
    const gaps = [fixture.connects[1]! - dropped, fixture.connects[2]! - fixture.connects[1]!, fixture.connects[3]! - fixture.connects[2]!];
    assert.ok(gaps[0]! >= 35, `first wait ${gaps[0]}`);
    assert.ok(gaps[1]! >= 75, `second wait ${gaps[1]}`);
    assert.ok(gaps[2]! >= 150, `third wait ${gaps[2]}`);
    const states = statuses().map((entry) => `${entry.state}${entry.attempt ? `:${entry.attempt}/${entry.attempts}` : ""}`);
    assert.deepEqual(states.slice(-4), ["reconnecting:1/5", "reconnecting:2/5", "reconnecting:3/5", "connected"]);
    assert.equal(
      agent.tools.some((tool) => tool.name === "mcp:live:echo"),
      true,
    );
    await agent.dispose();
  });

  it("reconnect_gives_up_after_attempts_and_reports_failed", async () => {
    const fixture = droppableServer();
    const { agent, statuses } = await startAgent(fixture, { reconnect: { attempts: 3, baseDelayMs: 5, maxDelayMs: 10 } });
    fixture.setFailures(100);
    fixture.drop();
    await until(async () => (await status(agent)).state === "failed", "the final failure");
    assert.equal(fixture.connects.length, 4, "one initial connect and three attempts");
    const states = statuses().map((entry) => entry.state);
    assert.deepEqual(states.slice(-4), ["reconnecting", "reconnecting", "reconnecting", "failed"]);
    // No intermediate `failed` between attempts.
    assert.equal(states.filter((state) => state === "failed").length, 1);
    // `mcp:reconnect` still works afterwards.
    fixture.setFailures(0);
    assert.equal(((await agent.commands.run("mcp:reconnect", { id: "live" })) as Status).state, "connected");
    await agent.dispose();
  });

  it("tools_are_absent_while_disconnected_and_return_after", async () => {
    const fixture = droppableServer();
    let requests = 0;
    // The server drops while the model is asking for the call: after the run snapshotted its tools.
    const dropOnFirstRequest = () => {
      requests += 1;
      if (requests === 1) fixture.drop();
    };
    const { agent, offered } = await startAgent(
      fixture,
      { reconnect: { attempts: 1, baseDelayMs: 400, maxDelayMs: 400 } },
      [
        // Run 1: the server drops while the model is asking for the call.
        [{ type: "tool_call", call: toolCallContent("call-1", "mcp:live:echo", { msg: "hi" }) }, providerDone()],
        [providerTextDelta("after the call"), providerDone()],
        // Run 2: still reconnecting. Run 3: back.
        [providerTextDelta("while reconnecting"), providerDone()],
        [providerTextDelta("after"), providerDone()],
      ],
      dropOnFirstRequest,
    );
    const session = await agent.session();
    await session.run("one");
    const results = (await session.entries()).flatMap((entry) =>
      entry.kind === "message" && entry.message ? entry.message.content.filter((block) => block.type === "tool_result") : [],
    ) as Array<{ error?: { message: string } }>;
    assert.equal(results.length, 1);
    assert.match(results[0]?.error?.message ?? "", /MCP server "live" is reconnecting/);

    assert.equal((await status(agent)).state, "reconnecting");
    await session.run("two");
    assert.equal(offered.at(-1)?.includes("mcp:live:echo"), false, "a disconnected server's tools leave new runs");

    await until(async () => (await status(agent)).state === "connected", "the reconnect");
    await session.run("three");
    assert.equal(offered.at(-1)?.includes("mcp:live:echo"), true, "the tools return after the reconnect");
    await agent.dispose();
  });

  it("changed_fingerprint_asks_for_trust_again", async () => {
    const ui = createScriptedHostUi((request) =>
      request.kind === "confirm" ? { status: "answered", value: true } : { status: "unavailable" },
    );
    const prism = { configSources: { servers: "project" }, host: { ui: ui.ui } } as unknown as PackageAPI<McpPackageConfig>;
    const known = new Set<string>();
    const server: McpServerConfig = { id: "build", transport: "stdio", command: "mcp-build", allow: "stdio:mcp-build" };

    assert.equal(await checkServerTrust(server, prism, new Set(), known), true);
    assert.equal(await checkServerTrust(server, prism, new Set(), known), true);
    assert.equal(ui.requestsOf("confirm").length, 1, "a trusted server is not asked again");
    assert.ok(known.has(mcpServerFingerprint(server)), "the cache is keyed by fingerprint");

    const changed: McpServerConfig = { ...server, args: ["--evil"] };
    assert.equal(await checkServerTrust(changed, prism, new Set(), known), true);
    assert.equal(ui.requestsOf("confirm").length, 2, "a changed fingerprint asks again");
  });

  it("dispose_cancels_pending_reconnects", async () => {
    const fixture = droppableServer();
    const { agent } = await startAgent(fixture, { reconnect: { attempts: 5, baseDelayMs: 60_000, maxDelayMs: 60_000 } });
    fixture.drop();
    await until(async () => (await status(agent)).state === "reconnecting", "reconnecting");
    const started = Date.now();
    await agent.dispose();
    assert.ok(Date.now() - started < 1000, "dispose does not wait out the backoff");
    assert.equal(fixture.connects.length, 1, "no attempt ran after dispose");
  });

  it("close_command_cancels_a_pending_reconnect", async () => {
    const fixture = droppableServer();
    const { agent } = await startAgent(fixture, { reconnect: { attempts: 5, baseDelayMs: 50, maxDelayMs: 50 } });
    fixture.drop();
    await until(async () => (await status(agent)).state === "reconnecting", "reconnecting");
    assert.equal(((await agent.commands.run("mcp:close", { id: "live" })) as Status).state, "closed");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await status(agent)).state, "closed");
    assert.equal(fixture.connects.length, 1);
    await agent.dispose();
  });

  it("attempts_zero_disables_reconnect", async () => {
    const fixture = droppableServer();
    const { agent, statuses } = await startAgent(fixture, { reconnect: { attempts: 0 } });
    fixture.drop();
    await until(async () => (await status(agent)).state === "failed", "the failure");
    const current = await status(agent);
    assert.equal(current.reason, "connection_lost");
    assert.equal(fixture.connects.length, 1);
    assert.equal(
      statuses().some((entry) => entry.state === "reconnecting"),
      false,
    );
    await agent.dispose();
  });

  it("package_limits_config_is_validated", async () => {
    // Plan 239 Task 5: the server-data bounds are package config; any positive host value loads.
    for (const limits of [{ maxTools: 0 }, { maxResultBytes: -1 }, { unknownKey: 1 }]) {
      await assert.rejects(
        createAgent({
          model: testModel,
          packages: [mcp({ limits, servers: [{ id: "x", transport: "raw", allow: "raw" }] } as McpPackageConfig)],
        }),
        /config/i,
      );
    }
    const agent = await createAgent({
      model: testModel,
      packages: [mcp({ limits: { maxTools: 50_000, maxResultBytes: 256 * 1024 * 1024 }, signInTimeoutMs: 3_600_000, servers: [] })],
    });
    await agent.dispose();
  });

  it("reconnect_config_is_validated", async () => {
    for (const reconnect of [{ attempts: -1 }, { baseDelayMs: 0 }, { extra: 1 }]) {
      await assert.rejects(
        createAgent({
          model: testModel,
          packages: [mcp({ reconnect, servers: [{ id: "x", transport: "raw", allow: "raw" }] } as McpPackageConfig)],
        }),
        /config/i,
      );
    }
  });
});

describe("@arnilo/prism-extensions/mcp bridge drop detection (plan 234 Task 5)", () => {
  it("stdio_child_exit_closes_the_bridge_and_reports_the_drop", async () => {
    const script = [
      'import { McpServer } from "@modelcontextprotocol/server";',
      'import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";',
      'const server = new McpServer({ name: "exiting", version: "1.0.0" }, { capabilities: { tools: {} } });',
      'server.registerTool("exit", { description: "exits" }, async () => { setTimeout(() => process.exit(0), 20); return { content: [{ type: "text", text: "bye" }] }; });',
      "await server.connect(new StdioServerTransport());",
    ].join("\n");
    const lost: unknown[] = [];
    const bridge = await connectMcpTools({
      serverId: "child",
      transport: { type: "stdio", command: process.execPath, args: ["-e", script], cwd: join(import.meta.dirname, "../../../../..") },
      connectTimeoutMs: 10_000,
      onConnectionLost: (error) => lost.push(error),
    });
    const exit = bridge.tools.find((tool) => tool.name.endsWith("exit"));
    assert.ok(exit);
    await exit.execute({}, { toolCallId: "call-1" } as Parameters<typeof exit.execute>[1]);
    await until(() => lost.length > 0, "the drop");
    assert.equal(bridge.isClosed, true, "isClosed turns true when the child exits");
    assert.equal(lost.length, 1, "the drop is reported once");
    await bridge.close();
    assert.equal(lost.length, 1, "an explicit close is not a drop");
  });
});
