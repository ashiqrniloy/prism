import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, createMemorySessionStore, definePackage, type PackageAPI, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import workflows, { defineWorkflow, functionNode, type WorkflowRun, type WorkflowRuntime, workflowCommand } from "../index.js";

function build(register: (prism: PackageAPI) => void) {
  const host = definePackage({
    name: "test-host-workflows",
    version: "1.0.0",
    capabilities: ["session-state"],
    requires: { api: 1 },
    setup: register,
  });
  return createAgent({
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), workflows, host],
  });
}

describe("workflowCommand", () => {
  it("workflow_command_starts_run_with_parent_session", async () => {
    const seen: unknown[] = [];
    const wf = defineWorkflow({
      id: "cmd",
      revision: "1",
      nodes: {
        n: functionNode({
          execute: (ctx) => {
            seen.push(ctx.workflowInput);
            return "done";
          },
        }),
      },
    });
    const agent = await build((prism) => {
      prism.commands.register(workflowCommand(prism, "run-cmd", wf, { args: { type: "object", properties: { x: { type: "number" } } } }));
      prism.commands.register({
        name: "probe",
        description: "reads the workflow log",
        run: (_args, ctx) => prism.services.require<WorkflowRuntime>("workflows").log.entries(ctx.session!).length,
      });
    });
    const session = await agent.session();
    const result = (await agent.commands.run("run-cmd", { x: 1 }, { session })) as { workflowRunId: string; status: string };
    assert.equal(result.status, "succeeded");
    assert.match(result.workflowRunId, /\S/);
    assert.deepEqual(seen, [{ x: 1 }]);
    // Persisted on the caller's branch as a workflow package-state record.
    assert.ok(((await agent.commands.run("probe", {}, { session })) as number) >= 2);
    // Without a caller session the command opens and binds a parent itself.
    const bare = (await agent.commands.run("run-cmd", { x: 2 })) as { status: string };
    assert.equal(bare.status, "succeeded");
    await agent.dispose();
  });

  it("workflow_command_on_run_exposes_stream", async () => {
    const wf = defineWorkflow({ id: "hook", revision: "1", nodes: { n: functionNode({ execute: () => "ok" }) } });
    let captured: WorkflowRun | undefined;
    const names: string[] = [];
    const agent = await build((prism) =>
      prism.commands.register(
        workflowCommand(prism, "hooked", wf, {
          onRun: async (run) => {
            captured = run;
            for await (const event of run.stream()) if (event.type === "package.event") names.push(event.name);
          },
        }),
      ),
    );
    const session = await agent.session();
    const result = (await agent.commands.run("hooked", {}, { session })) as { workflowRunId: string; status: string };
    assert.equal(result.status, "succeeded");
    assert.equal(captured?.id, result.workflowRunId);
    assert.ok(names.length > 0);
    await agent.dispose();
  });

  it("workflow_command_on_run_throw_fails_command", async () => {
    const wf = defineWorkflow({ id: "hookfail", revision: "1", nodes: { n: functionNode({ execute: () => "ok" }) } });
    const agent = await build((prism) =>
      prism.commands.register(
        workflowCommand(prism, "boom", wf, {
          onRun: () => {
            throw new Error("hook failed");
          },
        }),
      ),
    );
    const session = await agent.session();
    await assert.rejects(agent.commands.run("boom", {}, { session }), /hook failed/);
    await agent.dispose();
  });

  it("workflow_command_lazy_definition", async () => {
    let resolved = 0;
    const agent = await build((prism) =>
      prism.commands.register(
        workflowCommand(prism, "lazy", () => {
          resolved++;
          return defineWorkflow({ id: "lazy", revision: "1", nodes: { n: functionNode({ execute: () => 1 }) } });
        }),
      ),
    );
    assert.equal(resolved, 0);
    const session = await agent.session();
    await agent.commands.run("lazy", {}, { session });
    await agent.commands.run("lazy", {}, { session });
    assert.equal(resolved, 1);
    await agent.dispose();
  });

  it("workflow_command_invalid_args_rejected", async () => {
    let ran = 0;
    const wf = defineWorkflow({
      id: "args",
      revision: "1",
      nodes: {
        n: functionNode({
          execute: () => {
            ran += 1;
            return 1;
          },
        }),
      },
    });
    const agent = await build((prism) =>
      prism.commands.register(
        workflowCommand(prism, "typed", wf, {
          args: { type: "object", required: ["goal"], additionalProperties: false, properties: { goal: { type: "string" } } },
        }),
      ),
    );
    const session = await agent.session();
    await assert.rejects(agent.commands.run("typed", { goal: 3 }, { session }));
    await assert.rejects(agent.commands.run("typed", {}, { session }));
    assert.equal(ran, 0);
    assert.equal(((await agent.commands.run("typed", { goal: "x" }, { session })) as { status: string }).status, "succeeded");
    await agent.dispose();
  });
});
