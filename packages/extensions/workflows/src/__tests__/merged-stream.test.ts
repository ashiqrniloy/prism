import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  definePackage,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createScriptedCli, mockProvider, type ScriptStep } from "@arnilo/prism/testing";
import workflows, {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  startWorkflow,
  type WorkflowDefinition,
  type WorkflowRun,
  WorkflowRuntimeError,
  type WorkflowStreamEvent,
} from "../index.js";

async function host(definition: () => WorkflowDefinition, options: { maxQueuedEvents?: number } = {}) {
  const agent = await createAgent({
    model: { provider: "openai-compatible", model: "test" },
    packages: [
      definePackage({
        ...workflows,
        setup(prism) {
          workflows.setup(prism);
          prism.commands.register({
            name: "go",
            description: "run",
            run(_args, ctx) {
              return startWorkflow(definition(), "task", {
                prism,
                session: ctx.session!,
                runId: "run-1",
                checkpoints: createMemoryWorkflowCheckpoints(),
                ...options,
              });
            },
          });
        },
      }),
    ],
  });
  const session = await agent.session();
  return (await agent.commands.run("go", undefined, { session })) as WorkflowRun;
}

async function collect(run: WorkflowRun): Promise<WorkflowStreamEvent[]> {
  const out: WorkflowStreamEvent[] = [];
  for await (const event of run.stream()) out.push(event);
  return out;
}

const hostWorker = (id: string, text: string) =>
  createAgent({ id, model: { provider: "mock", model: "m" }, packages: [mockProvider([[providerTextDelta(text), providerDone()]])] });

/** A provider whose first turn calls a tool, then waits on `gate`; later turns record what they saw. */
function gatedWorker(gate: Promise<void>, seen: string[]): Promise<Agent> {
  let turn = 0;
  const provider: ModelProvider = {
    id: "gated",
    async *generate(request) {
      turn += 1;
      if (turn === 1) {
        await gate;
        yield { type: "tool_call" as const, call: toolCallContent("c1", "noop", {}) };
        yield providerDone();
        return;
      }
      seen.push(JSON.stringify(request.messages));
      yield providerTextDelta("finished");
      yield providerDone();
    },
  };
  return createAgent({
    id: "slow",
    model: { provider: "gated", model: "m" },
    packages: [providerPackage("gated-provider", [provider])],
    tools: {
      add: [
        {
          name: "noop",
          parameters: {},
          execute: (_a: unknown, c: { toolCallId: string }) => ({ toolCallId: c.toolCallId, name: "noop", value: "ok" }),
        },
      ],
    },
  });
}

// The reference stream adapter and its dialect are unpublished examples; computed imports keep them outside the build.
const exampleRoot = "../../../../../examples/adapters/";
const { streamCli }: { streamCli: import("@arnilo/prism-hosts/driver-process").AgentAdapter } = await import(`${exampleRoot}stream-cli.ts`);
const { streamCliDialect, streamCliFixtures }: { streamCliDialect: never; streamCliFixtures: { config(cli: unknown): object } } =
  await import(`${exampleRoot}stream-cli.dialect.ts`);
const { processDriver, adapterDriver } = await import("@arnilo/prism-hosts/driver-process");

async function driverWorker(script: readonly ScriptStep[]) {
  const root = mkdtempSync(join(tmpdir(), "wf-merged-"));
  const cli = createScriptedCli({ dialect: streamCliDialect, script });
  await createProfiles({ root, driver: adapterDriver(streamCli) }).create("test", { mode: "key", principal: "test" });
  const agent = await createAgent({
    id: "external",
    packages: [processDriver(streamCli)],
    packageConfig: {
      [streamCli.name]: { ...streamCliFixtures.config(cli), name: "test", profile: "test", profilesRoot: root, principal: "test" },
    },
  });
  return {
    agent,
    dispose() {
      cli.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("merged workflow stream", () => {
  it("merged_stream_carries_every_agent_with_origin", async () => {
    const driver = await driverWorker([
      { raw: '{"type":"delta","block":"thinking","text":"hmm"}' },
      { raw: '{"type":"subagent","phase":"started","parentToolId":"parent","name":"review"}' },
      { raw: '{"type":"tool_use","id":"child","name":"read","input":{}}' },
      { raw: '{"type":"subagent","phase":"completed","parentToolId":"parent"}' },
      { raw: '{"type":"delta","block":"text","text":"done"}' },
    ]);
    try {
      const mock = await hostWorker("native", "built");
      const run = await host(() =>
        defineWorkflow({
          id: "wf",
          revision: "1",
          nodes: {
            native: agentNode({ agent: mock, input: () => "go" }),
            external: agentNode({ agent: driver.agent, input: () => "go" }),
          },
        }),
      );
      const events = await collect(run);
      assert.equal((await run.result()).status, "succeeded");
      const agentEvents = events.filter((e): e is AgentEvent => e.type !== "package.event" || "origin" in e);
      assert.ok(events.some((e) => e.type === "package.event" && (e as { name?: string }).name === "workflow.node.completed"));
      const external = agentEvents.filter((e) => e.origin?.kind === "external");
      assert.ok(external.length > 0, "driver events carry an external origin");
      assert.ok(
        external.some((e) => e.type === "message.delta" && JSON.stringify(e).includes("hmm")),
        "thinking delta present",
      );
      const nested = agentEvents.find((e) => e.type === "tool.started");
      assert.equal(nested?.origin?.depth, 1);
      assert.equal(nested?.origin?.subagentId, "parent");
      // Native Prism children carry no origin (it is stamped for delegated/external scopes only).
      assert.ok(
        agentEvents.some((e) => e.origin === undefined && JSON.stringify(e).includes("built")),
        "native child text present",
      );
    } finally {
      driver.dispose();
    }
  }, 60_000);

  it("late_child_events_not_lost", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const worker = await hostWorker("late", "late-text");
    const run = await host(() =>
      defineWorkflow({
        id: "wf",
        revision: "1",
        nodes: {
          first: functionNode({
            execute: async () => {
              await gate;
              return "one";
            },
          }),
          late: agentNode({ agent: worker, input: () => "go" }),
        },
        edges: [["first", "late"]],
      }),
    );
    const seen = collect(run);
    release();
    const events = await seen;
    assert.equal((await run.result()).status, "succeeded");
    const types = events.map((e) => e.type);
    assert.ok(types.includes("run.started") && types.includes("run.completed"), `child lifecycle seen: ${types.join(",")}`);
  });

  it("steer_reaches_active_child", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: string[] = [];
    const worker = await gatedWorker(gate, seen);
    const run = await host(() =>
      defineWorkflow({ id: "wf", revision: "1", nodes: { work: agentNode({ agent: worker, input: () => "go" }) } }),
    );
    const streamed = collect(run);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await run.steer("work", "prefer the Button component");
    release();
    assert.equal((await run.result()).status, "succeeded");
    await streamed;
    assert.ok(
      seen.some((m) => m.includes("prefer the Button component")),
      "steer text reached the next turn",
    );
  });

  it("steer_inactive_node_fails", async () => {
    const run = await host(() => defineWorkflow({ id: "wf", revision: "1", nodes: { a: functionNode({ execute: () => 1 }) } }));
    await run.result();
    await assert.rejects(
      () => run.steer("a", "x"),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "node_not_running",
    );
  });

  it("abort_stops_driver_child_within_grace", async () => {
    const driver = await driverWorker([{ raw: '{"type":"delta","block":"text","text":"working"}' }, { wait: 60_000 }]);
    try {
      const run = await host(() =>
        defineWorkflow({ id: "wf", revision: "1", nodes: { ext: agentNode({ agent: driver.agent, input: () => "go" }) } }),
      );
      const streamed = collect(run);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const started = Date.now();
      run.abort(new Error("stop"));
      const result = await run.result().catch((error: unknown) => ({ status: "aborted", error }));
      await streamed;
      assert.equal(result.status, "aborted");
      assert.ok(Date.now() - started < 15_000, "driver child stopped within its abort ladder");
    } finally {
      driver.dispose();
    }
  }, 60_000);

  it("slow_consumer_overflow_policy", async () => {
    const worker = await hostWorker("chatty", "x");
    // A tiny bound with no reader until the run ends forces overflow.
    const small = await host(
      () => defineWorkflow({ id: "wf2", revision: "1", nodes: { a: agentNode({ agent: worker, input: () => "go" }) } }),
      { maxQueuedEvents: 2 },
    );
    await small.result();
    const events = await collect(small);
    const notice = events.find((e) => e.type === "package.event" && (e as { name?: string }).name === "workflow.notice");
    assert.ok(notice, "overflow produced a workflow.notice");
    assert.equal(events.length <= 2, true, "stream closed after the notice");
  });
});
