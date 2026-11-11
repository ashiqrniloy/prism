import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, createMemorySessionStore, type ModelProvider, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createScriptedHostUi, loopConformance, textProvider } from "@arnilo/prism/testing";
import {
  agentNode,
  defineWorkflow,
  functionNode,
  gateNode,
  loopAgentNode,
  WorkflowDefinitionError,
  workflowLoop,
  workflowLoopStrategy,
} from "../index.js";

/** generate (calls `write` once, then answers) → validate; the first answer fails validation. */
function generateValidateRevise() {
  return defineWorkflow({
    id: "gvr",
    revision: "1",
    nodes: {
      seed: functionNode({ execute: () => "seed" }),
      generate: loopAgentNode({
        activation: "any",
        input: (ctx) => (ctx.upstream.validate ? `Revise: ${JSON.stringify(ctx.upstream.validate)}` : "Draft the answer."),
      }),
      validate: gateNode({
        check: (ctx) => (String(ctx.upstream.generate).includes("final") ? { pass: true } : { pass: false, reason: "not final" }),
      }),
    },
    edges: [
      ["seed", "generate"],
      ["generate", "validate"],
      ["validate", "generate"],
    ],
    limits: { maxSupersteps: 12 },
  });
}

function scriptedProvider(): { provider: ModelProvider; turns: () => number } {
  let turn = 0;
  return {
    turns: () => turn,
    provider: {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("c1", "write", { path: "a.txt" }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta(turn === 2 ? "first draft" : "final answer");
        yield providerDone();
      },
    },
  };
}

async function agentWith(options: { deny?: boolean; ui?: ReturnType<typeof createScriptedHostUi>["ui"] }) {
  const executed: string[] = [];
  const { provider, turns } = scriptedProvider();
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    ...(options.ui ? { host: { ui: options.ui } } : {}),
    hooks: (hooks) =>
      hooks.on("tool.call", (call) =>
        call.name === "write" ? (options.deny ? { deny: "writes are disabled" } : { ask: "Write a file?" }) : undefined,
      ),
    packages: [providerPackage("test-provider", [provider]), workflowLoop(generateValidateRevise())],
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          effects: ["write"],
          execute: (_args, context) => {
            executed.push("write");
            return { toolCallId: context.toolCallId, name: "write", value: "written" };
          },
        },
      ],
    },
  });
  return { agent, executed, turns };
}

describe("workflowLoop", () => {
  it("workflow_loop_gates_tools_under_approval", async () => {
    // Denied: the tool never runs, and the workflow still revises to a passing answer.
    const denied = await agentWith({ deny: true });
    const deniedResult = await (await denied.agent.session()).run("go");
    assert.equal(deniedResult.status, "completed", JSON.stringify(deniedResult.error));
    assert.deepEqual(denied.executed, []);
    assert.match(deniedResult.text, /final answer/);
    await denied.agent.dispose();

    // Asked and approved through a scripted HostUi: the tool runs exactly once.
    const ui = createScriptedHostUi({ confirm: true });
    const allowed = await agentWith({ ui: ui.ui });
    const allowedResult = await (await allowed.agent.session()).run("go");
    assert.equal(allowedResult.status, "completed");
    assert.deepEqual(allowed.executed, ["write"]);
    assert.equal(ui.requestsOf("confirm").length, 1);
    await allowed.agent.dispose();
  });

  it("workflow_loop_revises_through_gate", async () => {
    const { agent, turns } = await agentWith({ deny: true });
    const result = await (await agent.session()).run("go");
    // turn 1 tool call, turn 2 first draft (gate fails), turn 3 final answer (gate passes)
    assert.equal(turns(), 3);
    assert.match(result.text, /final answer/);
    await agent.dispose();
  });

  it("workflow_loop_passes_loop_conformance", async () => {
    const wf = defineWorkflow({ id: "one", revision: "1", nodes: { step: loopAgentNode() } });
    const result = await loopConformance({ loop: workflowLoopStrategy(wf) });
    assert.equal(result.error, undefined);
    assert.equal(result.result?.status, "completed");
    for (const hook of ["turn.before", "model.call", "tool.call", "tool.execute", "tool.result", "message.append"] as const) {
      assert.ok(result.fired.has(hook), hook);
    }
  });

  it("workflow_loop_rejects_foreign_agent_node", async () => {
    const other = await createAgent({
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("test-provider", [textProvider("x")])],
    });
    const wf = defineWorkflow({ id: "foreign", revision: "1", nodes: { a: agentNode({ agent: other }) } });
    assert.throws(() => workflowLoop(wf), WorkflowDefinitionError);
    const nested = defineWorkflow({
      id: "outer",
      revision: "1",
      nodes: { n: { kind: "workflow", workflow: wf } },
    });
    assert.throws(() => workflowLoop(nested), WorkflowDefinitionError);
    await other.dispose();
  });

  it("loop_agent_node_fails_outside_loop", async () => {
    const node = loopAgentNode();
    assert.throws(() => (node.execute as () => unknown)(), /only inside workflowLoop/);
  });
});
