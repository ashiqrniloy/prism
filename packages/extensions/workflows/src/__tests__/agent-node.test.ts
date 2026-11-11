import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createSessionIndex,
  definePackage,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";
import workflows, {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  startWorkflow,
  type WorkflowRun,
  WorkflowRuntimeError,
} from "../index.js";

const fakeWorkspace = () => {
  const calls: string[] = [];
  return {
    calls,
    service: {
      worktree: {
        async create(request: { sessionId: string }) {
          calls.push(`create:${request.sessionId}`);
          return {
            path: "/wt/one",
            branch: "prism/one",
            async dispose() {
              calls.push("dispose");
            },
          };
        },
      },
      async diff(path: string) {
        calls.push(`diff:${path}`);
        return {
          changes: [{ kind: "file", path: "ui/Button.tsx", change: "modified", diff: "--- a\n+++ b", source: "diff" }],
          truncated: false,
        };
      },
    },
  };
};

async function host(options: {
  worker?: Agent;
  workspace?: ReturnType<typeof fakeWorkspace>;
  definition: (worker: Agent) => ReturnType<typeof defineWorkflow>;
}) {
  const store = createMemorySessionStore();
  const worker =
    options.worker ??
    (await createAgent({
      id: "ui-engineer",
      slots: { store },
      model: { provider: "mock", model: "m" },
      packages: [mockProvider([[providerTextDelta("built"), providerDone()]])],
    }));
  const observed: { name: string; data: unknown }[] = [];
  const agent = await createAgent({
    model: { provider: "openai-compatible", model: "test" },
    slots: { store },
    hooks(hooks) {
      hooks.on("package.event", (event: { name?: string; data?: unknown }) => {
        if (event.name?.startsWith("agent.")) observed.push({ name: event.name, data: event.data });
      });
    },
    packages: [
      definePackage({
        ...workflows,
        setup(prism) {
          workflows.setup(prism);
          if (options.workspace) prism.services.provide("workspace", options.workspace.service);
          prism.commands.register({
            name: "go",
            description: "run",
            run(_args, ctx) {
              return startWorkflow(options.definition(worker), "task", {
                prism,
                session: ctx.session!,
                runId: "run-1",
                checkpoints: createMemoryWorkflowCheckpoints(),
              });
            },
          });
        },
      }),
    ],
  });
  const session = await agent.session();
  const run = (await agent.commands.run("go", undefined, { session })) as WorkflowRun;
  return { run, session, store, observed, worker };
}

const single = (config: Record<string, unknown>) => (worker: Agent) =>
  defineWorkflow({
    id: "wf",
    revision: "1",
    nodes: { build: agentNode({ agent: worker, input: (ctx) => String(ctx.workflowInput), ...config }) },
  });

describe("agentNode", () => {
  it("agent_node_child_session_has_parent_links", async () => {
    const h = await host({ definition: single({}) });
    const result = await h.run.result();
    assert.equal(result.outputs.build, "built");
    const page = await createSessionIndex(h.store).list({ workflowRunId: "run-1" });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.parentSessionId, h.session.id);
    assert.equal(page.items[0]!.agentId, "ui-engineer");
  });

  it("worktree_node_records_diff_as_agent_file", async () => {
    const workspace = fakeWorkspace();
    const h = await host({ workspace, definition: single({ worktree: { dispose: "dispose" } }) });
    const result = await h.run.result();
    const output = result.outputs.build as { output: string; worktree: { path: string; branch: string } };
    assert.equal(output.output, "built");
    assert.deepEqual([output.worktree.path, output.worktree.branch], ["/wt/one", "prism/one"]);
    assert.ok(workspace.calls[0]!.startsWith("create:"));
    assert.deepEqual(workspace.calls.slice(1), ["diff:/wt/one", "dispose"]);
    const files = h.observed.filter((e) => e.name === "agent.file");
    assert.equal(files.length, 1);
    assert.equal((files[0]!.data as { source: string }).source, "diff");
  });

  it("failed_child_run_fails_node", async () => {
    const workspace = fakeWorkspace();
    const refusing: ModelProvider = {
      id: "refusing",
      async *generate() {
        throw Object.assign(new Error("profile_busy: profile at its cap"), { code: "profile_busy" });
      },
    };
    const worker = await createAgent({
      id: "refused",
      model: { provider: "refusing", model: "m" },
      packages: [providerPackage("refusing-provider", [refusing])],
    });
    const h = await host({ worker, workspace, definition: single({ worktree: true }) });
    await assert.rejects(
      () => h.run.result(),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.message.includes("child run failed"),
    );
  });

  it("worktree_without_workspace_service_fails_closed", async () => {
    const h = await host({ definition: single({ worktree: true }) });
    await assert.rejects(
      () => h.run.result(),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "missing_service" && error.message.includes("workspace"),
    );
  });

  it("child_suspension_suspends_workflow", async () => {
    let turn = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("c1", "write", {}) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const worker = await createAgent({
      id: "gated",
      model: { provider: "mock", model: "m" },
      hooks: askEveryTool(),
      packages: [providerPackage("gated-provider", [provider])],
      tools: {
        add: [
          {
            name: "write",
            parameters: {},
            execute: (_a: unknown, c: { toolCallId: string }) => ({ toolCallId: c.toolCallId, name: "write", value: "done" }),
          },
        ],
      },
    });
    const h = await host({ worker, definition: single({}) });
    const result = await h.run.result();
    assert.equal(result.status, "suspended");
    assert.equal(result.suspension?.nodeId, "build");
    assert.equal(result.suspension?.reason, "child_session_suspended");
    assert.ok((result.suspension?.data as { childSessionId?: string } | undefined)?.childSessionId);
  });

  it("workflows_source_names_no_vendor", () => {
    const vendors = /\b(claude|codex|gemini|anthropic|openai|copilot)\b/i;
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (name === "__tests__") return [];
        return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
      });
    for (const file of walk(join(import.meta.dirname!, ".."))) {
      assert.ok(!vendors.test(readFileSync(file, "utf8")), `${file} names a vendor`);
    }
  });
});
