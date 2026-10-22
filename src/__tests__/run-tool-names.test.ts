import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  type ModelProvider,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  loadSuspendedRunEntry,
  createSkillRegistry,
  createToolRegistry,
  providerDone,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { HARD_RUN_TOOL_NAMES, selectRunTools } from "../tools.js";
import { failedRun } from "./run-result-helpers.js";
import { providerPackage } from "../provider-kit/index.js";

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

function providerCalls(...names: string[]): ModelProvider {
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
      if (event.type === "tool.completed" && event.status === "blocked") reasons.push(`${event.name}:${event.reason}`);
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
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((item) => item.name));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [echo, secret] },
      })
    ).session();
    const reasons = await blockedReasons(session, session.run("Hi", { tools: { only: ["echo"] } }));
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((names) => names.length === 1 && names[0] === "echo"));
    assert.deepEqual(reasons, ["secret:unknown_tool"]);
    assert.deepEqual(executed, []);

    const full: string[][] = [];
    const open: ModelProvider = {
      id: "mock",
      async *generate(request) {
        full.push((request.tools ?? []).map((item) => item.name));
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [open])],
          tools: { add: [echo, secret] },
        })
      ).session()
    ).run("Hi");
    assert.deepEqual(full, [["echo", "secret"]]);
  });

  it("empty set sends no tools", async () => {
    const seen: Array<number | undefined> = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(request.tools?.length);
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          tools: { add: [tool("echo")] },
        })
      ).session()
    ).run("Hi", { tools: { only: [] } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0] ?? 0, 0);
  });

  it("concurrent runs snapshot distinct subsets of a shared registry", async () => {
    const registry = createToolRegistry([tool("echo"), tool("secret")]);
    const seenA: string[][] = [];
    const seenB: string[][] = [];
    const sessionA = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [{
          id: "mock",
          async *generate(request) {
            seenA.push((request.tools ?? []).map((item) => item.name));
            yield providerDone();
          },
        }])],
        tools: { add: registry.list() },
      })
    ).session();
    const sessionB = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [{
          id: "mock",
          async *generate(request) {
            seenB.push((request.tools ?? []).map((item) => item.name));
            yield providerDone();
          },
        }])],
        tools: { add: registry.list() },
      })
    ).session();
    await Promise.all([sessionA.run("a", { tools: { only: ["echo"] } }), sessionB.run("b", { tools: { only: ["secret"] } })]);
    assert.deepEqual(seenA, [["echo"]]);
    assert.deepEqual(seenB, [["secret"]]);
    registry.register(tool("late"));
    const seenC: string[][] = [];
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [{
            id: "mock",
            async *generate(request) {
              seenC.push((request.tools ?? []).map((item) => item.name));
              yield providerDone();
            },
          }])],
          tools: { add: registry.list() },
        })
      ).session()
    ).run("c", { tools: { only: ["echo"] } });
    assert.deepEqual(seenC, [["echo"]]);
  });

  it("skill toolNames uses the narrowed set", async () => {
    const registry = createSkillRegistry([{ name: "needs-secret", instructions: "Use secret.", toolNames: ["secret"] }]);
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [{
          id: "mock",
          async *generate() {
            yield providerDone();
          },
        }])],
        tools: { add: [tool("echo"), tool("secret")] },
        skills: { add: registry.list() },
      })
    ).session();
    await failedRun(session.run("Hi", { tools: { only: ["echo"] } }), /requires inactive tool: secret/);
  });

  it("durable resume keeps the stored grant", async () => {
    const store = createMemorySessionStore();
    const registry = createToolRegistry([tool("echo"), tool("secret")]);
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "narrow",
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [providerCalls("echo")])],
      tools: { add: registry.list() },
      slots: { store },
    });
    const first = await (await agent.session({ id: "s1", create: true })).run("go", { tools: { only: ["echo"] } });
    assert.equal(first.status, "suspended");
    const stored = await loadSuspendedRunEntry(store, "s1");
    assert.deepEqual(stored?.state.toolNames, ["echo"]);
    const seen: string[][] = [];
    const resumeProvider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((item) => item.name));
        yield providerDone();
      },
    };
    const fresh = await createAgent({ ...agent.config, packages: [providerPackage("test-provider", [resumeProvider])] });
    const resumed = await fresh.session({ id: "s1" });
    for await (const _event of resumed.resume(
      first.pending!.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })),
    )) {
      // drain: the resumed leg re-derives its tool menu from the stored grant
    }
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
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((item) => item.name));
        turn += 1;
        if (turn === 1) yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          tools: { add: registry.list() },
        })
      ).session()
    ).run("Hi", { limits: { maxToolRounds: 2 } });
    assert.deepEqual(seen, [["echo"], ["echo"]]);
    assert.ok(registry.get("late"));
  });

  it("tool.call denial still applies inside the narrowed set", async () => {
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [providerCalls("echo")])],
        tools: { add: [tool("echo")] },
        hooks: (hooks) => hooks.on("tool.call", (payload) => (payload.name === "echo" ? { deny: "revoked" } : undefined)),
      })
    ).session();
    await session.run("Hi", { tools: { only: ["echo"] } });
    const blocks = (await session.entries()).flatMap((entry) => entry.message?.content ?? []);
    const denied = blocks.find((block) => block.type === "tool_result" && block.error !== undefined);
    assert.ok(denied && denied.type === "tool_result" && denied.error?.message === "revoked");
  });
});
