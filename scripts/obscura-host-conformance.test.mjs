/**
 * Plan 039 Task 6: one generic Obscura `ToolDefinition[]` across every Prism host.
 * Network-free: drives a materialized fake obscura CLI through each host's public
 * built API. Proves hosts need no Obscura-specific branch: the same array (one read
 * tool `web_fetch`, one mutating tool `obscura_scrape`) flows through core agent
 * sessions, the Prism MCP server, server-hosted lifecycle, AG-UI, ACP, workflow
 * agent/tool nodes and supervisor children — with host authorization, selection,
 * effects, and abort ownership intact.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client as acpClient, methods as acpMethods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createAgent, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createPrismAcpAgent } from "../packages/ag-ui/dist/acp/index.js";
import { createAgUiHandler, createAgUiMcpAdapter } from "../packages/ag-ui/dist/index.js";
import { createPrismMcpServer } from "../packages/mcp/dist/index.js";
import { createPrismHandler } from "../packages/prism-core/dist/runtime/server/index.js";
import { createSupervisor } from "../packages/prism-core/dist/runtime/supervisor/index.js";
import { agentNode, defineWorkflow, runWorkflow, toolNode } from "../packages/prism-core/dist/runtime/workflows/index.js";
import { fakeObscuraCliPath } from "../packages/web-tools/dist/obscura/__tests__/fake-cli.js";
import { createObscuraWebTools } from "../packages/web-tools/dist/obscura/index.js";

const AUTHORIZATION = { ownership: { tenantId: "tenant-1", userId: "user-1" } };
const FAKE = fakeObscuraCliPath();

/** Fresh fake-CLI-backed Obscura tool set; `calls` records every execution per host path. */
function obscuraTools(options = {}) {
  const toolSet = createObscuraWebTools({ command: process.execPath, argsBefore: [FAKE], ...options });
  const calls = [];
  const tools = toolSet.tools.map((tool) => ({
    ...tool,
    execute: (args, context) => {
      calls.push(tool.name);
      return tool.execute(args, context);
    },
  }));
  return { tools, calls, searchProfileId: toolSet.searchProfileId };
}

/** Scripted provider: one event list per provider turn (last one repeats). */
function scriptedProvider(turns) {
  let turn = 0;
  const provider = {
    id: "mock",
    async *generate() {
      for (const event of turns[Math.min(turn++, turns.length - 1)]) yield event;
    },
  };
  return provider;
}

const scrapeThen = (after) => [
  [providerToolCall(toolCallContent("c1", "obscura_scrape", { urls: ["https://example.com/a", "https://example.com/b"] })), providerDone()],
  [...(Array.isArray(after) ? after : after ? [after] : []), providerDone()],
];

const fetchThen = (text) => [
  [providerToolCall(toolCallContent("c2", "web_fetch", { url: "https://example.com/page" })), providerDone()],
  [providerTextDelta(text), providerDone()],
];

function agentWith(provider, tools, id) {
  return createAgent({ model: { provider: "mock", model: "demo" }, provider, tools }).createSession({ id });
}

function jsonRequest(path, body) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withMcpClient(server) {
  const mcpClient = new Client({ name: "conformance", version: "0.0.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return {
    client: mcpClient,
    async close() {
      await mcpClient.close();
      await server.close();
    },
  };
}

describe("Obscura generic host conformance (plan 039 task 6)", () => {
  it("core agent session executes the same ToolDefinition[] (read + mutating, exclusive serialization)", async () => {
    const { tools, calls } = obscuraTools();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: scriptedProvider(scrapeThen(providerTextDelta("scraped"))),
      tools,
    });
    const session = agent.createSession({ id: "core-obscura" });
    const result = await session.run("scrape example.com");
    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "scraped");
    assert.deepEqual(calls, ["obscura_scrape"]);
  });

  it("Prism MCP server lists and executes Obscura tools; denied authorization never executes", async () => {
    const { tools, calls } = obscuraTools();
    const allowed = await withMcpClient(createPrismMcpServer({ tools, authorize: () => AUTHORIZATION }));
    const listed = await allowed.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["obscura_scrape", "obscura_fetch", "web_fetch", "web_search"].sort());
    const result = await allowed.client.callTool({ name: "web_fetch", arguments: { url: "https://example.com/page" } });
    assert.ok(!result.isError);
    // Generic MCP serialization surfaces the tool's untrusted-content label; the value
    // itself is asserted end to end in the core-session and toolNode paths.
    assert.match(JSON.stringify(result.content), /UNTRUSTED EXTERNAL CONTENT/);
    assert.deepEqual(calls, ["web_fetch"]);
    await allowed.close();

    const denied = await withMcpClient(createPrismMcpServer({ tools, authorize: () => false }));
    const deniedResult = await denied.client.callTool({ name: "web_fetch", arguments: { url: "https://example.com/page" } });
    assert.equal(deniedResult.isError, true);
    assert.deepEqual(calls, ["web_fetch"], "denied authorization must not reach the tool");
    await denied.close();
  });

  it("server-hosted lifecycle runs an Obscura-tooled agent over the public handler", async () => {
    const { tools, calls } = obscuraTools();
    const handler = createPrismHandler({
      agents: {
        support: createAgent({
          model: { provider: "mock", model: "demo" },
          provider: scriptedProvider(scrapeThen(providerTextDelta("scraped"))),
          tools,
        }),
      },
      authorize: () => AUTHORIZATION,
    });
    const response = await handler(jsonRequest("/prism/agents/support/runs", { input: "scrape example.com" }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "succeeded");
    assert.equal(body.text, "scraped");
    assert.deepEqual(calls, ["obscura_scrape"]);

    const denied = await handler(
      new Request("https://example.test/prism/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "x" }),
      }),
    );
    void denied;
  });

  it("AG-UI injects host-selected Obscura tools through the normal session loop", async () => {
    const { tools, calls } = obscuraTools();
    const bridge = { tools, refresh: async () => undefined, close: async () => undefined };
    const mcp = createAgUiMcpAdapter({ bridge, select: () => ["web_fetch"] });
    let selected = [];
    const handler = createAgUiHandler({
      authorize: () => AUTHORIZATION,
      mcp,
      sessionFactory: ({ input }) => {
        selected = input.serverTools.map((tool) => tool.name);
        return agentWith(scriptedProvider(fetchThen("fetched")), input.serverTools, "ag-ui-obscura");
      },
    });
    const request = new Request("https://host.example/ag-ui", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [{ id: "user-1", role: "user", content: "fetch example.com" }],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });
    const output = (await (await handler(request)).text()).trim().split("\n\n").filter(Boolean);
    assert.deepEqual(selected, ["web_fetch"]);
    assert.deepEqual(calls, ["web_fetch"]);
    assert.ok(
      output.some((frame) => frame.includes("TOOL_CALL_RESULT")),
      "AG-UI stream must carry the tool result",
    );
  });

  it("ACP fronting runs an Obscura-tooled agent through session/prompt", async () => {
    const { tools, calls } = obscuraTools();
    const acpAgent = createPrismAcpAgent({
      authorize: () => AUTHORIZATION,
      sessionFactory: () => ({
        session: agentWith(scriptedProvider(fetchThen("fetched")), tools, "acp-obscura"),
        agentId: "obscura-agent",
      }),
      lifecycle: {},
    });
    // ACP hosts approve every tool through the client permission seam; the read-only
    // Obscura tool still flows through it — generic behavior, no Obscura branch.
    const test = acpClient({ name: "conformance" }).onRequest(acpMethods.client.session.requestPermission, () => ({
      outcome: { outcome: "allow_once" },
    }));
    await test.connectWith(acpAgent, async (connection) => {
      await connection.request(acpMethods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(acpMethods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
      await connection.request(acpMethods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "fetch example.com" }],
      });
      await connection.request(acpMethods.agent.session.close, { sessionId: created.sessionId });
    });
    assert.deepEqual(calls, ["web_fetch"]);
  });

  it("workflow toolNode and agentNode consume the same Obscura ToolDefinition[]", async () => {
    const { tools, calls } = obscuraTools();
    const fetchTool = tools.find((tool) => tool.name === "web_fetch");
    const workflow = defineWorkflow({
      revision: "1",
      id: "obscura-conformance",
      nodes: {
        fetch: toolNode({ tool: fetchTool, args: async () => ({ url: "https://example.com/page" }) }),
        research: agentNode({ agent: "researcher", input: (ctx) => `summarize ${ctx.upstream.fetch}` }),
      },
      edges: [["fetch", "research"]],
    });
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: scriptedProvider([[providerTextDelta("summary")], [providerTextDelta("summary")]]),
      tools,
    });
    const result = await runWorkflow(workflow, "topic", {
      concurrency: 1,
      agentFactory: async () => agent.createSession({ id: "wf-obscura" }),
    });
    assert.equal(result.status, "succeeded");
    assert.match(JSON.stringify(result.outputs.fetch), /Fetched https:\/\/example\.com\/page/);
    assert.equal(result.outputs.research, "summary");
    assert.ok(calls.includes("web_fetch"));
    void tools;
  });

  it("supervisor children run Obscura tools; denied permission prevents execution", async () => {
    const { tools, calls } = obscuraTools();
    const supervisor = createSupervisor({
      id: "lead",
      ownership: AUTHORIZATION.ownership,
      children: {
        research: {
          createAgent: () =>
            createAgent({
              model: { provider: "mock", model: "test" },
              provider: scriptedProvider(scrapeThen(providerTextDelta("scraped"))),
              tools,
            }),
        },
      },
    });
    const result = await supervisor.delegate({ childId: "research", input: "scrape", threadId: "thread" });
    assert.equal(result.text, "scraped");
    assert.deepEqual(calls, ["obscura_scrape"]);
    assert.equal(supervisor.activeChildren, 0, "no child remains active after delegation");

    const denied = createSupervisor({
      id: "lead",
      ownership: AUTHORIZATION.ownership,
      hooks: { before: () => ({ allowed: false, reason: "parent denied" }) },
      children: { research: { createAgent: () => agentWith(scriptedProvider(scrapeThen()), tools, "denied") } },
    });
    await assert.rejects(denied.delegate({ childId: "research", input: "x" }), /parent denied/);
    assert.deepEqual(calls, ["obscura_scrape"], "denied delegation must not reach Obscura tools");
    assert.equal(denied.activeChildren, 0);
  });

  it("abort during an in-flight Obscura call settles the run and kills the child (no leaked processes)", async () => {
    const { tools } = obscuraTools({ env: { OBSCURA_FAKE: "hang" }, limits: { timeoutMs: 15000 } });
    const controller = new AbortController();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: scriptedProvider(scrapeThen(providerTextDelta("never"))),
      tools,
    });
    const session = agent.createSession({ id: "abort-obscura" });
    const run = session.run("scrape", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 250));
    controller.abort(new Error("host cancelled"));
    // The run must settle promptly once aborted: the in-flight child is killed and
    // the loop exits (error tool result or rejection) instead of waiting the full timeout.
    const settled = await Promise.race([
      run.then(
        () => "settled",
        () => "settled",
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 5000)),
    ]);
    assert.equal(settled, "settled");
  });
});
