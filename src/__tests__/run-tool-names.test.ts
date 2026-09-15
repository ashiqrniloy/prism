import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAgentRunState } from "../agent-run-state.js";
import {
  type AgentEvent,
  type AIProvider,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMiddlewareRegistry,
  createSkillRegistry,
  createToolRegistry,
  type PermissionPolicy,
  providerDone,
  resumeAgentRun,
  type ToolCallContent,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { HARD_RUN_TOOL_NAMES, selectRunTools } from "../tools.js";

function tool(name: string, executed?: string[]): ToolDefinition {
  return {
    name,
    parameters: { type: "object", properties: {} },
    execute(_args, context) {
      executed?.push(name);
      return { toolCallId: context.toolCallId, name, value: name };
    },
  };
}

function providerCalls(...names: string[]): AIProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      const name = names[turn];
      turn += 1;
      if (name) yield { type: "tool_call" as const, call: toolCallContent(`c${turn}`, name, {}) };
      yield providerDone();
    },
  };
}

async function blockedReasons(session: { subscribe(): AsyncIterable<AgentEvent> }, run: Promise<unknown>): Promise<string[]> {
  const reasons: string[] = [];
  const consume = (async () => {
    for await (const event of session.subscribe()) {
      if (event.type === "tool_execution_blocked") reasons.push(`${event.name}:${event.reason}`);
    }
  })();
  await Promise.all([consume, run.catch(() => undefined)]);
  return reasons;
}

describe("selectRunTools", () => {
  const listed = [tool("echo"), tool("secret")];

  it("omitted grant keeps the full list", () => {
    assert.deepEqual(
      selectRunTools(listed, undefined).tools.map((item) => item.name),
      ["echo", "secret"],
    );
  });

  it("empty grant hides every tool", () => {
    assert.deepEqual(
      selectRunTools(listed, []).tools.map((item) => item.name),
      [],
    );
  });

  it("unknown names fail closed on a fresh run", () => {
    assert.throws(() => selectRunTools(listed, ["nope"]), /Unknown run tool: nope/);
  });

  it("resume drops missing names and refuses to widen the checkpoint", () => {
    const current = [tool("echo")];
    const resumed = selectRunTools(current, ["echo", "secret", "extra"], ["echo", "secret"]);
    assert.deepEqual(
      resumed.tools.map((item) => item.name),
      ["echo"],
    );
    assert.deepEqual(resumed.grant, ["echo", "secret"]);
  });

  it("rejects over-cap allow lists", () => {
    assert.throws(
      () =>
        selectRunTools(
          listed,
          Array.from({ length: HARD_RUN_TOOL_NAMES + 1 }, (_, i) => `t${i}`),
        ),
      /exceeds/,
    );
  });
});

describe("RunOptions.toolNames", () => {
  it("hides schemas and blocks guessed calls; omitted option keeps the full set", async () => {
    const seen: string[][] = [];
    const executed: string[] = [];
    const echo = tool("echo", executed);
    const secret = tool("secret", executed);
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((item) => item.name));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [echo, secret],
    }).createSession();
    const reasons = await blockedReasons(session, session.run("Hi", { toolNames: ["echo"] }));
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((names) => names.length === 1 && names[0] === "echo"));
    assert.deepEqual(reasons, ["secret:unknown_tool"]);
    assert.deepEqual(executed, []);

    const full: string[][] = [];
    const open: AIProvider = {
      id: "mock",
      async *generate(request) {
        full.push((request.tools ?? []).map((item) => item.name));
        yield providerDone();
      },
    };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider: open,
      tools: [echo, secret],
    })
      .createSession()
      .run("Hi");
    assert.deepEqual(full, [["echo", "secret"]]);
  });

  it("empty set sends no tools", async () => {
    const seen: Array<number | undefined> = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(request.tools?.length);
        yield providerDone();
      },
    };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo")],
    })
      .createSession()
      .run("Hi", { toolNames: [] });
    assert.equal(seen.length, 1);
    assert.equal(seen[0] ?? 0, 0);
  });

  it("concurrent runs snapshot distinct subsets of a shared registry", async () => {
    const registry = createToolRegistry([tool("echo"), tool("secret")]);
    const seenA: string[][] = [];
    const seenB: string[][] = [];
    const sessionA = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate(request) {
          seenA.push((request.tools ?? []).map((item) => item.name));
          yield providerDone();
        },
      },
      tools: registry,
    }).createSession();
    const sessionB = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate(request) {
          seenB.push((request.tools ?? []).map((item) => item.name));
          yield providerDone();
        },
      },
      tools: registry,
    }).createSession();
    await Promise.all([sessionA.run("a", { toolNames: ["echo"] }), sessionB.run("b", { toolNames: ["secret"] })]);
    assert.deepEqual(seenA, [["echo"]]);
    assert.deepEqual(seenB, [["secret"]]);
    registry.register(tool("late"));
    const seenC: string[][] = [];
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate(request) {
          seenC.push((request.tools ?? []).map((item) => item.name));
          yield providerDone();
        },
      },
      tools: registry,
    })
      .createSession()
      .run("c", { toolNames: ["echo"] });
    assert.deepEqual(seenC, [["echo"]]);
  });

  it("middleware rename cannot widen the run grant", async () => {
    const middleware = createMiddlewareRegistry();
    middleware.use<ToolCallContent>("tool_call", (value) => ({ ...value, name: "secret" }));
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: providerCalls("echo"),
      tools: [tool("echo"), tool("secret")],
      middleware,
    }).createSession();
    const reasons = await blockedReasons(session, session.run("Hi", { toolNames: ["echo"] }));
    assert.deepEqual(reasons, ["secret:unknown_tool"]);
  });

  it("skill toolNames uses the narrowed set", async () => {
    const registry = createSkillRegistry([{ name: "needs-secret", instructions: "Use secret.", toolNames: ["secret"] }]);
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerDone();
        },
      },
      tools: [tool("echo"), tool("secret")],
      skills: registry,
    }).createSession();
    await assert.rejects(session.run("Hi", { toolNames: ["echo"], activeSkills: ["needs-secret"] }), /requires inactive tool: secret/);
  });

  it("durable resume keeps the checkpointed grant", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const store = createMemorySessionStore();
    const registry = createToolRegistry([tool("echo"), tool("secret")]);
    const agent = createAgent({
      id: "narrow",
      model: { provider: "mock", model: "demo" },
      provider: providerCalls("echo"),
      tools: registry,
      store,
    });
    const first = await agent.createSession({ id: "s1" }).run("go", {
      toolNames: ["echo"],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    assert.equal(first.status, "suspended");
    const loaded = await loadAgentRunState(checkpoints, { runId: first.runId, sessionId: first.sessionId });
    assert.deepEqual(loaded.state.toolNames, ["echo"]);
    const seen: string[][] = [];
    const resumeProvider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((item) => item.name));
        yield providerDone();
      },
    };
    const result = await resumeAgentRun(
      createAgent({ ...agent.config, provider: resumeProvider }),
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState!.version!,
        decisions: first.interruption!.pendingDecisions!.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })),
      },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(seen, [["echo"]]);
  });

  it("in-flight registry.register cannot widen the run", async () => {
    const registry = createToolRegistry();
    const seen: string[][] = [];
    let turn = 0;
    registry.register({
      name: "echo",
      parameters: { type: "object", properties: {} },
      execute(_args, context) {
        registry.register(tool("late"));
        return { toolCallId: context.toolCallId, name: "echo", value: "ok" };
      },
    });
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((item) => item.name));
        turn += 1;
        if (turn === 1) yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        yield providerDone();
      },
    };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: registry,
    })
      .createSession()
      .run("Hi", { limits: { maxToolRounds: 2 } });
    assert.deepEqual(seen, [["echo"], ["echo"]]);
    assert.ok(registry.get("late"));
  });

  it("policy denial still applies inside the narrowed set", async () => {
    const permission: PermissionPolicy = {
      async check(input) {
        if (input.target === "echo") return { allowed: false, reason: "revoked" };
        return { allowed: true };
      },
    };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: providerCalls("echo"),
      tools: [tool("echo")],
      permission,
    }).createSession();
    const reasons = await blockedReasons(session, session.run("Hi", { toolNames: ["echo"] }));
    assert.deepEqual(reasons, ["echo:permission_denied"]);
  });
});
