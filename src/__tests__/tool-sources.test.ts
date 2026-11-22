import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type HookRegistrar,
  type JsonObject,
  type LoopStrategy,
  type ModelProvider,
  type PackageAPI,
  providerDone,
  providerTextDelta,
  toolCallContent,
  type ToolDefinition,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

/**
 * Plan 234 Task 4: `PackageAPI.tools.source` — a package's current tools, read once at run start. A run keeps its
 * snapshot, a conflicting or invalid tool is dropped with a note, `disable` applies by name, the `tool.call` gate
 * sees source tools on every loop, and a list change does not break resuming a suspended run.
 */

type Step = { readonly call: string; readonly args?: JsonObject } | { readonly text: string };

/** A provider that plays `steps` in order and records the tool names each turn was offered. */
function recordingProvider(steps: Step[]): { provider: ModelProvider; offered: string[][] } {
  const offered: string[][] = [];
  let index = 0;
  let callId = 0;
  return {
    offered,
    provider: {
      id: "mock",
      async *generate(request) {
        offered.push((request.tools ?? []).map((tool) => tool.name));
        const step = steps[index++] ?? { text: "done" };
        if ("call" in step) {
          callId += 1;
          yield { type: "tool_call" as const, call: toolCallContent(`call-${callId}`, step.call, step.args ?? {}) };
        } else {
          yield providerTextDelta(step.text);
        }
        yield providerDone();
      },
    },
  };
}

function tool(name: string, onCall?: () => void): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: {},
    effects: ["read"],
    execute: (_args, context) => {
      onCall?.();
      return { toolCallId: context.toolCallId, name, value: `${name} ran` };
    },
  };
}

const pkg = (name: string, setup: (prism: PackageAPI<any>) => void) =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup });

async function agentWith(options: {
  readonly steps: Step[];
  readonly packages: ReturnType<typeof pkg>[];
  readonly hostTools?: ToolDefinition[];
  readonly disable?: { readonly tools?: string[] };
  readonly hooks?: (hooks: HookRegistrar) => void;
  readonly loop?: LoopStrategy;
  readonly id?: string;
}) {
  const recorded = recordingProvider(options.steps);
  const store = createMemorySessionStore();
  const agent = await createAgent({
    ...(options.id ? { id: options.id } : {}),
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("source-test-provider", [recorded.provider]), ...options.packages],
    ...(options.hostTools ? { tools: { add: options.hostTools } } : {}),
    ...(options.disable ? { disable: options.disable } : {}),
    slots: { store, ...(options.loop ? { loop: options.loop } : {}) },
    hooks: options.hooks,
  });
  return { agent, offered: recorded.offered, store };
}

const warns = (agent: { inspect(): { statusNotes: readonly { level: string; message: string; package: string }[] } }) =>
  agent.inspect().statusNotes.filter((note) => note.level === "warn");

describe("tool sources", () => {
  it("source_tools_are_snapshotted_at_run_start", async () => {
    let reads = 0;
    let ran = 0;
    const { agent, offered } = await agentWith({
      steps: [{ call: "live" }, { text: "done" }],
      packages: [
        pkg("live-source", (prism) =>
          prism.tools.source(() => {
            reads += 1;
            return [tool("live", () => (ran += 1))];
          }),
        ),
      ],
    });
    reads = 0;
    const session = await agent.session();
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    assert.equal(ran, 1);
    assert.equal(reads, 1, "one read per run, at the snapshot");
    assert.deepEqual(offered, [["live"], ["live"]]);
  });

  it("change_during_a_run_applies_to_the_next_run", async () => {
    const list: ToolDefinition[] = [];
    list.push(tool("first", () => list.push(tool("late"))));
    const { agent, offered } = await agentWith({
      steps: [{ call: "first" }, { text: "done" }, { call: "late" }, { text: "done" }],
      packages: [pkg("changing-source", (prism) => prism.tools.source(() => list))],
    });
    const session = await agent.session();
    assert.deepEqual(
      agent.tools.map((entry) => entry.name),
      ["first"],
    );
    assert.equal((await session.run("one")).status, "completed");
    assert.deepEqual(offered.slice(0, 2), [["first"], ["first"]], "the run keeps the set it started with");
    // `agent.tools` is read fresh, not cached, once a source exists.
    assert.deepEqual(
      agent.tools.map((entry) => entry.name),
      ["first", "late"],
    );
    assert.equal((await session.run("two")).status, "completed");
    assert.deepEqual(offered[2], ["first", "late"]);
    const entries = await session.entries();
    const lateResult = entries.flatMap((entry) =>
      entry.kind === "message" && entry.message
        ? entry.message.content.filter((block) => block.type === "tool_result" && block.name === "late")
        : [],
    );
    assert.equal(lateResult.length, 1);
    assert.equal((lateResult[0] as { error?: unknown }).error, undefined);
  });

  it("source_tool_conflict_is_dropped_with_a_note", async () => {
    const { agent } = await agentWith({
      steps: [{ text: "done" }],
      hostTools: [tool("host_tool")],
      packages: [
        pkg("registered", (prism) => prism.tools.register(tool("taken"))),
        pkg("first-source", (prism) => prism.tools.source(() => [tool("shared")])),
        pkg("bad-source", (prism) =>
          prism.tools.source(() => [
            tool("host_tool"),
            tool("taken"),
            tool("load_skill"),
            tool("shared"),
            { ...tool("bad_effects"), effects: ["teleport" as never] },
            tool("fine"),
          ]),
        ),
      ],
    });
    const names = agent.tools.map((entry) => entry.name);
    assert.deepEqual(names, ["host_tool", "taken", "shared", "fine"]);
    assert.equal(agent.tools.find((entry) => entry.name === "shared")?.package, "first-source");
    // A standing conflict is noted once, not on every read.
    agent.tools;
    await (await agent.session()).run("go");
    const notes = warns(agent).filter((note) => note.package === "bad-source");
    assert.equal(notes.length, 5);
    assert.match(
      notes.map((note) => note.message).join("\n"),
      /host_tool.*the host[\s\S]*taken.*registered[\s\S]*load_skill.*the kernel[\s\S]*shared.*first-source[\s\S]*bad_effects/,
    );
  });

  it("throwing_source_contributes_nothing_and_notes", async () => {
    let fail = true;
    const { agent, offered } = await agentWith({
      steps: [{ text: "done" }, { text: "done" }],
      packages: [
        pkg("flaky-source", (prism) =>
          prism.tools.source(() => {
            if (fail) throw new Error("server list unavailable");
            return [tool("back")];
          }),
        ),
      ],
    });
    const session = await agent.session();
    assert.equal((await session.run("one")).status, "completed");
    assert.deepEqual(offered[0], []);
    assert.match(warns(agent)[0]?.message ?? "", /tools\.source failed.*server list unavailable/);
    fail = false;
    await session.run("two");
    assert.deepEqual(offered[1], ["back"]);
  });

  it("disable_removes_a_source_tool_by_name", async () => {
    const { agent, offered } = await agentWith({
      steps: [{ text: "done" }],
      disable: { tools: ["hidden"] },
      packages: [pkg("disabled-source", (prism) => prism.tools.source(() => [tool("hidden"), tool("shown")]))],
    });
    assert.deepEqual(
      agent.tools.map((entry) => entry.name),
      ["shown"],
    );
    await (await agent.session()).run("go");
    assert.deepEqual(offered[0], ["shown"]);
  });

  it("disable_names_a_source_only_tool_without_failing_the_load", async () => {
    // The name is not supplied yet; with a source present the load defers it instead of `unknown_disable_id`.
    const list: ToolDefinition[] = [];
    const { agent } = await agentWith({
      steps: [],
      disable: { tools: ["later"] },
      packages: [pkg("deferred-source", (prism) => prism.tools.source(() => list))],
    });
    list.push(tool("later"), tool("other"));
    assert.deepEqual(
      agent.tools.map((entry) => entry.name),
      ["other"],
    );
    // Without a source the same name still fails closed.
    await assert.rejects(
      agentWith({ steps: [], disable: { tools: ["later"] }, packages: [] }),
      /unknown_disable_id|nothing loaded carries/,
    );
  });

  for (const loop of ["default", "custom"] as const) {
    it(`source_tools_pass_the_tool_call_gate (${loop} loop)`, async () => {
      let ran = 0;
      const gated: { name: string; effects: readonly string[] }[] = [];
      const custom: LoopStrategy = {
        name: "plain-custom",
        revision: "1",
        async run(run) {
          for (;;) {
            const turn = await run.turn();
            if (turn.stopped || turn.toolCalls.length === 0) return;
            await run.executeTools(turn.toolCalls);
          }
        },
      };
      const { agent } = await agentWith({
        steps: [{ call: "guarded" }, { text: "done" }],
        packages: [pkg("gated-source", (prism) => prism.tools.source(() => [tool("guarded", () => (ran += 1))]))],
        hooks: (hooks) =>
          hooks.on("tool.call", (call) => {
            gated.push({ name: call.name, effects: call.effects });
            return { deny: "blocked by policy" };
          }),
        ...(loop === "custom" ? { loop: custom } : {}),
      });
      const session = await agent.session();
      await session.run("go");
      assert.equal(ran, 0, "a denied source tool never executes");
      assert.deepEqual(gated, [{ name: "guarded", effects: ["read"] }]);
    });
  }

  it("inspect_lists_source_tools_with_their_package", async () => {
    const { agent } = await agentWith({
      steps: [],
      hostTools: [tool("host_tool")],
      packages: [
        pkg("inspected-source", (prism) => {
          prism.tools.source(() => [tool("from_source")]);
        }),
        pkg("lister", (prism) => {
          prism.onDispose(() => undefined);
          listed = () => prism.tools.list().map((entry) => `${entry.name}:${entry.package}`);
        }),
      ],
    });
    assert.deepEqual(agent.inspect().tools, [
      { name: "host_tool", package: "host" },
      { name: "from_source", package: "inspected-source" },
    ]);
    assert.deepEqual(listed?.(), ["host_tool:host", "from_source:inspected-source"]);
  });

  it("source_tool_change_does_not_break_resume", async () => {
    const list: ToolDefinition[] = [];
    let ran = 0;
    list.push(tool("approve_me", () => (ran += 1)));
    const { agent } = await agentWith({
      id: "source-resume",
      steps: [{ call: "approve_me" }, { text: "done" }],
      packages: [pkg("resume-source", (prism) => prism.tools.source(() => list))],
      hooks: askEveryTool(),
    });
    const session = await agent.session({ id: "source-resume-session", create: true });
    const first = await session.run("go");
    assert.equal(first.status, "suspended");
    // The server's list changes while the run waits for approval.
    list.push(tool("arrived_later"));
    let last: string | undefined;
    for await (const event of session.resume(
      first.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      last = event.type;
    }
    assert.equal(last, "run.completed");
    assert.equal(ran, 1);
  });

  it("source_registration_closes_after_setup", async () => {
    let late: PackageAPI<any> | undefined;
    await agentWith({ steps: [], packages: [pkg("late-source", (prism) => void (late = prism))] });
    assert.throws(() => late?.tools.source(() => []), /registration_closed|setup was complete/);
  });
});

let listed: (() => string[]) | undefined;
