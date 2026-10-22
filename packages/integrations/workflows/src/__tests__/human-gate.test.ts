import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, definePackage, type HostPort } from "@arnilo/prism";
import { createScriptedHostUi } from "@arnilo/prism/testing";
import workflows, {
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  humanGate,
  resumeWorkflow,
  startWorkflow,
  WORKFLOW_EVENTS,
  type WorkflowPackageEvent,
  type WorkflowRun,
} from "../index.js";

const definition = () =>
  defineWorkflow({
    id: "approval",
    revision: "1",
    limits: { maxSupersteps: 10 },
    nodes: {
      research: functionNode({ execute: () => "r" }),
      plan: functionNode({ activation: "any", execute: () => "the plan" }),
      approve: humanGate({ request: { kind: "confirm", title: "Execute this plan?" } }),
      execute: functionNode({ execute: () => "executed" }),
    },
    edges: [
      ["research", "plan"],
      ["plan", "approve"],
      ["approve", "plan"],
      ["approve", "execute"],
    ],
  });

async function host(ui?: HostPort["ui"], checkpoints = createMemoryWorkflowCheckpoints()) {
  const agent = await createAgent({
    model: { provider: "openai-compatible", model: "test" },
    host: { ui },
    packages: [
      definePackage({
        ...workflows,
        setup(prism) {
          workflows.setup(prism);
          prism.commands.register({
            name: "go",
            description: "run",
            run: (_args, ctx) => startWorkflow(definition(), null, { prism, session: ctx.session!, runId: "gate-run", checkpoints }),
          });
        },
      }),
    ],
  });
  const session = await agent.session();
  const run = (await agent.commands.run("go", undefined, { session })) as WorkflowRun;
  return { run, checkpoints };
}

describe("humanGate", () => {
  it("human_gate_answered_inline", async () => {
    const scripted = createScriptedHostUi({ confirm: true });
    const { run } = await host(scripted.ui);
    const events: WorkflowPackageEvent[] = [];
    for await (const event of run.stream()) if (event.type === "package.event") events.push(event as WorkflowPackageEvent);
    const result = await run.result();
    assert.equal(result.status, "succeeded");
    assert.equal(result.outputs.execute, "executed");
    assert.equal(scripted.requests.length, 1);
    assert.equal(scripted.requests[0]!.package, "@arnilo/prism-workflows");
    const gates = events.filter((event) => event.name === WORKFLOW_EVENTS.gate);
    assert.equal(gates.length, 1);
    assert.equal(gates[0]!.data.pass, true);
  });

  it("human_gate_declined_routes_back", async () => {
    const answers = [false, true];
    const ui = { request: async () => ({ status: "answered" as const, value: answers.shift() as never }) };
    const { run } = await host(ui as HostPort["ui"]);
    const result = await run.result();
    assert.equal(result.status, "succeeded");
    assert.equal(answers.length, 0);
  });

  it("human_gate_dismissed_fails_gate_and_routes", async () => {
    const responses = [{ status: "dismissed" as const }, { status: "answered" as const, value: true }];
    const ui = { request: async () => responses.shift() as never };
    const { run } = await host(ui);
    const events: WorkflowPackageEvent[] = [];
    for await (const event of run.stream()) if (event.type === "package.event") events.push(event as WorkflowPackageEvent);
    assert.equal((await run.result()).status, "succeeded");
    const failed = events.find((event) => event.name === WORKFLOW_EVENTS.gate && event.data.pass === false);
    assert.equal(failed?.data.reason, "dismissed");
  });

  it("human_gate_without_ui_suspends_then_resumes", async () => {
    const { run, checkpoints } = await host(undefined);
    const suspended = await run.result();
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.suspension?.nodeId, "approve");
    const resumed = await resumeWorkflow(
      definition(),
      { runId: "gate-run" },
      { checkpoints, resume: { decision: "approve", input: true, expectedVersion: suspended.version } },
    );
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.outputs.execute, "executed");
  });
});
