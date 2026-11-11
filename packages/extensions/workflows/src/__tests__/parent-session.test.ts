import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, createMemorySessionStore, createSecretRedactor, definePackage, type SessionStore } from "@arnilo/prism";
import workflows, {
  conditionalNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  startWorkflow,
  suspend,
  WORKFLOW_EVENTS,
  type WorkflowDefinition,
  type WorkflowPackageEvent,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../index.js";

async function host(
  workflow: WorkflowDefinition,
  options: { store?: SessionStore; input?: unknown; redactor?: ReturnType<typeof createSecretRedactor> } = {},
) {
  const agent = await createAgent({
    model: { provider: "openai-compatible", model: "test" },
    slots: { store: options.store ?? createMemorySessionStore() },
    redactor: options.redactor,
    packages: [
      definePackage({
        ...workflows,
        setup(prism) {
          workflows.setup(prism);
          prism.commands.register({
            name: "test-workflow",
            description: "Run on the supplied parent session",
            run(_args, ctx) {
              assert.ok(ctx.session);
              return startWorkflow(workflow, options.input, {
                prism,
                session: ctx.session,
                runId: "parent-run",
                checkpoints: createMemoryWorkflowCheckpoints(),
                redactor: options.redactor,
              });
            },
          });
          prism.commands.register({
            name: "test-transitions",
            description: "Read restored transitions",
            run(_args, ctx) {
              return prism.services.require<WorkflowRuntime>("workflows").log.entries(ctx.session!);
            },
          });
        },
      }),
    ],
  });
  return {
    agent,
    async start(id?: string) {
      const session = await agent.session(id ? { id } : {});
      const run = (await agent.commands.run("test-workflow", undefined, { session })) as WorkflowRun;
      return { run, session };
    },
  };
}

const dag = () =>
  defineWorkflow({
    id: "parent",
    revision: "1",
    nodes: {
      a: functionNode({ execute: () => "private-output-a" }),
      b: functionNode({ execute: () => "private-output-b" }),
    },
    edges: [["a", "b"]],
  });

async function events(run: WorkflowRun) {
  const result: WorkflowPackageEvent[] = [];
  for await (const event of run.stream()) if (event.type === "package.event") result.push(event as WorkflowPackageEvent);
  return result;
}

describe("workflow parent session", () => {
  it("node_transitions_emitted_in_order", async () => {
    const h = await host(dag());
    try {
      const { run, session } = await h.start();
      const seen = events(run);
      assert.equal((await run.result()).status, "succeeded");
      const transitions = await seen;
      assert.deepEqual(
        transitions.map((e) => [e.name, e.data.nodeId]),
        [
          [WORKFLOW_EVENTS.nodeStarted, "a"],
          [WORKFLOW_EVENTS.nodeCompleted, "a"],
          [WORKFLOW_EVENTS.nodeStarted, "b"],
          [WORKFLOW_EVENTS.nodeCompleted, "b"],
        ],
      );
      assert.ok(transitions.every((e) => e.sessionId === session.id && e.data.workflowRunId === run.id && e.data.attempt === 1));
      const persisted = await h.agent.commands.run("test-transitions", undefined, { session });
      assert.deepEqual(
        persisted,
        transitions.map(({ name, data }) => ({ name, data })),
      );
    } finally {
      await h.agent.dispose();
    }
  });

  it("node_failure_emits_failed_with_reason", async () => {
    const h = await host(
      defineWorkflow({
        id: "failed",
        revision: "1",
        nodes: {
          fail: functionNode({
            execute() {
              throw new Error("private-input in error");
            },
          }),
        },
      }),
    );
    try {
      const { run } = await h.start();
      const seen = events(run);
      await assert.rejects(run.result(), /private-input/);
      const transitions = await seen;
      assert.equal(transitions.at(-1)?.name, WORKFLOW_EVENTS.nodeFailed);
      assert.equal(transitions.at(-1)?.data.reason, "node_failed");
      assert.doesNotMatch(JSON.stringify(transitions), /private-input/);
    } finally {
      await h.agent.dispose();
    }
  });

  it("workflow_event_payload_has_no_node_io", async () => {
    const h = await host(dag(), { input: "private-input" });
    try {
      const { run } = await h.start();
      const seen = events(run);
      await run.result();
      assert.doesNotMatch(JSON.stringify(await seen), /private-input|private-output/);
    } finally {
      await h.agent.dispose();
    }
  });

  it("transitions_persisted_across_restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prism-parent-"));
    try {
      const { createSqlitePersistence } = await import("@arnilo/prism-extensions/store-sqlite");
      const filename = join(dir, "sessions.sqlite");
      const first = createSqlitePersistence({ filename });
      const h = await host(dag(), { store: first });
      const { run, session } = await h.start();
      const seen = events(run);
      await run.result();
      const expected = (await seen).map(({ name, data }) => ({ name, data }));
      await session.close();
      await h.agent.dispose();
      first.close();
      const second = createSqlitePersistence({ filename });
      const restarted = await host(dag(), { store: second });
      try {
        const restored = await restarted.agent.session({ id: session.id });
        assert.deepEqual(await restarted.agent.commands.run("test-transitions", undefined, { session: restored }), expected);
        await restored.close();
      } finally {
        await restarted.agent.dispose();
        second.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("suspension_excludes_review_data_and_reason_text", async () => {
    const h = await host(
      defineWorkflow({
        id: "suspend",
        revision: "1",
        nodes: {
          review: functionNode({ execute: () => suspend({ reason: "private-input", data: { draft: "private-output" } }) }),
        },
      }),
    );
    try {
      const { run } = await h.start();
      const seen = events(run);
      assert.equal((await run.result()).status, "suspended");
      const transitions = await seen;
      assert.equal(transitions.at(-1)?.name, WORKFLOW_EVENTS.suspended);
      assert.doesNotMatch(JSON.stringify(transitions), /private-input|private-output/);
    } finally {
      await h.agent.dispose();
    }
  });

  it("gate_transition_records_only_selected_ids", async () => {
    const wf = defineWorkflow({
      id: "gate",
      revision: "1",
      nodes: {
        gate: conditionalNode({ when: () => true, then: ["done"] }),
        done: functionNode({ execute: () => "private-output" }),
      },
      edges: [["gate", "done"]],
    });
    const h = await host(wf);
    try {
      const { run } = await h.start();
      const seen = events(run);
      await run.result();
      const transitions = await seen;
      assert.deepEqual(transitions.find((e) => e.name === WORKFLOW_EVENTS.gate)?.data.route, ["done"]);
      assert.equal(transitions.length, 5);
    } finally {
      await h.agent.dispose();
    }
  });

  it("failed_transition_write_prevents_node_execution_and_live_emission", async () => {
    const store = createMemorySessionStore();
    let executions = 0;
    const h = await host(
      defineWorkflow({
        id: "write-failure",
        revision: "1",
        nodes: {
          node: functionNode({
            execute() {
              executions += 1;
              return "ok";
            },
          }),
        },
      }),
      {
        store: {
          ...store,
          async append(entry, options) {
            if (entry.kind === "package_state") throw new Error("transition write failed");
            return store.append(entry, options);
          },
        },
      },
    );
    try {
      const { run } = await h.start();
      const seen = events(run);
      await assert.rejects(run.result(), /transition write failed/);
      assert.equal(executions, 0);
      assert.deepEqual(await seen, []);
    } finally {
      await h.agent.dispose();
    }
  });

  it("host_command_keeps_namespace_under_concurrent_runs", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: { provider: "openai-compatible", model: "test" },
      slots: { store },
      packages: [
        workflows,
        definePackage({
          name: "host-workflow",
          version: "1.0.0",
          requires: { api: 1 },
          setup(prism) {
            prism.commands.register({
              name: "build",
              description: "Host workflow",
              run(_args, ctx) {
                return startWorkflow(dag(), null, {
                  session: ctx.session!,
                  prism: {
                    ...prism,
                    events: {
                      emit() {
                        throw new Error("workflow event must use the workflows package API");
                      },
                    },
                  },
                });
              },
            });
          },
        }),
      ],
    });
    try {
      const parent = await agent.session();
      const runs = await Promise.all(
        [0, 1].map(async () => (await agent.commands.run("build", undefined, { session: parent })) as WorkflowRun),
      );
      const seen = runs.map(events);
      await Promise.all(runs.map((run) => run.result()));
      const streams = await Promise.all(seen);
      for (const [index, stream] of streams.entries()) {
        assert.equal(stream.length, 4);
        assert.ok(
          stream.every((event) => event.package === "@arnilo/prism-extensions/workflows" && event.data.workflowRunId === runs[index]!.id),
        );
      }
      const records = (await store.list(parent.id)).filter((entry) => entry.kind === "package_state");
      assert.equal(records.length, 8);
      assert.ok(records.every((entry) => (entry.data as { package: string }).package === "@arnilo/prism-extensions/workflows"));
    } finally {
      await agent.dispose();
    }
  });

  it("parent_transitions_use_the_session_redactor", async () => {
    const wf = defineWorkflow({ id: "redacted", revision: "1", nodes: { "secret-node": functionNode({ execute: () => "ok" }) } });
    const h = await host(wf, { redactor: createSecretRedactor(["secret-node"]) });
    try {
      const { run } = await h.start();
      const seen = events(run);
      await run.result();
      assert.doesNotMatch(JSON.stringify(await seen), /secret-node/);
    } finally {
      await h.agent.dispose();
    }
  });
});
