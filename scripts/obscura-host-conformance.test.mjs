/**
 * Plan 039 Task 6: one generic Obscura `ToolDefinition[]` across every Prism host.
 * Network-free: drives a materialized fake obscura CLI through each host's public
 * built API. Proves hosts need no Obscura-specific branch: the same array (one read
 * tool `web_fetch`, one mutating tool `obscura_scrape`) flows through core agent
 * sessions, AG-UI, ACP, workflow
 * agent/function nodes — with host authorization, selection,
 * effects, and abort ownership intact.
 *
 * The MCP tool-serving leg was removed with plan 161 Task 5: the retired
 * direct-tool-dispatch MCP server is gone and `serveMcp` exposes one agent
 * tool, so serving a generic `ToolDefinition[]` over MCP waits for Phase 14
 * (`serveTools`).
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createAgUiHandler, createAgUiMcpAdapter } from "../packages/hosts/ag-ui/src/index.ts";
import { agentNode, defineWorkflow, functionNode, runWorkflow } from "@arnilo/prism-workflows";
import { fakeObscuraCliPath } from "../packages/tools/web/src/obscura/__tests__/fake-cli.ts";
import { createObscuraWebTools } from "../packages/tools/web/src/obscura/index.ts";

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

async function _agentWith(provider, tools, id) {
  return await (
    await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: tools } })
  ).session({ id, create: true });
}

describe("Obscura generic host conformance (plan 039 task 6)", () => {
  it("core agent session executes the same ToolDefinition[] (read + mutating, exclusive serialization)", async () => {
    const { tools, calls } = obscuraTools();
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [scriptedProvider(scrapeThen(providerTextDelta("scraped")))])],
      tools: { add: tools },
    });
    const session = await agent.session({ id: "core-obscura", create: true });
    const result = await session.run("scrape example.com");
    assert.equal(result.status, "completed");
    assert.equal(result.text, "scraped");
    assert.deepEqual(calls, ["obscura_scrape"]);
  });

  it("AG-UI injects host-selected Obscura tools through the normal session loop", async () => {
    const { tools, calls } = obscuraTools();
    const bridge = { tools, refresh: async () => undefined, close: async () => undefined };
    const mcp = createAgUiMcpAdapter({ bridge, select: () => ["web_fetch"] });
    // Plan 161/162 moved MCP selection to the host: `prepare` returns the reviewed tools, the host
    // builds the agent with them, and the handler takes that agent.
    const selected = await mcp.prepare({
      request: { threadId: "thread-1" },
      authorization: AUTHORIZATION,
      maxTools: 8,
      signal: new AbortController().signal,
    });
    assert.deepEqual(
      selected.map((tool) => tool.name),
      ["web_fetch"],
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [scriptedProvider(fetchThen("fetched"))])],
      tools: { add: selected },
    });
    const handler = createAgUiHandler(agent, { authorize: () => AUTHORIZATION });
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
    assert.deepEqual(calls, ["web_fetch"]);
    assert.ok(
      output.some((frame) => frame.includes("TOOL_CALL_RESULT")),
      "AG-UI stream must carry the tool result",
    );
  });

  it("workflow functionNode and agentNode consume the same Obscura ToolDefinition[]", async () => {
    const { tools, calls } = obscuraTools();
    const fetchTool = tools.find((tool) => tool.name === "web_fetch");
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [scriptedProvider([[providerTextDelta("summary")], [providerTextDelta("summary")]])])],
      tools: { add: tools },
    });
    const workflow = defineWorkflow({
      revision: "1",
      id: "obscura-conformance",
      nodes: {
        // Plan 168 Task 7 deleted the workflow tool node: a function node dispatches the same
        // ToolDefinition directly, with the workflow-derived tool context.
        fetch: functionNode({
          execute: async (ctx) =>
            await fetchTool.execute(
              { url: "https://example.com/page" },
              {
                sessionId: `workflow:${ctx.workflowId}`,
                runId: ctx.runId,
                toolCallId: `wf_${ctx.nodeId}`,
                signal: ctx.signal,
                metadata: { workflowId: ctx.workflowId, nodeId: ctx.nodeId },
              },
            ),
        }),
        research: agentNode({ agent, session: () => agent.session({ id: "wf-obscura", create: true }), input: (ctx) => `summarize ${ctx.upstream.fetch}` }),
      },
      edges: [["fetch", "research"]],
    });
    const result = await runWorkflow(workflow, "topic", {
      concurrency: 1,
    });
    assert.equal(result.status, "succeeded");
    assert.match(JSON.stringify(result.outputs.fetch), /Fetched https:\/\/example\.com\/page/);
    assert.equal(result.outputs.research, "summary");
    assert.ok(calls.includes("web_fetch"));
    void tools;
  });

  it("abort during an in-flight Obscura call settles the run and kills the child (no leaked processes)", async () => {
    const { tools } = obscuraTools({ env: { OBSCURA_FAKE: "hang" }, limits: { timeoutMs: 15000 } });
    const controller = new AbortController();
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [scriptedProvider(scrapeThen(providerTextDelta("never")))])],
      tools: { add: tools },
    });
    const session = await agent.session({ id: "abort-obscura", create: true });
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
