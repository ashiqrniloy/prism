import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type AIProvider,
  createAgent,
  providerDone,
  providerTextDelta,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { clampTurnToolNames } from "../tools.js";

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

function schemaOf(request: { tools?: readonly { name: string }[] }): string[] {
  return (request.tools ?? []).map((item) => item.name);
}

async function collect(session: { subscribe(): AsyncIterable<AgentEvent> }, run: Promise<unknown>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const consume = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  await Promise.all([consume, run.catch(() => undefined)]);
  return events;
}

describe("clampTurnToolNames", () => {
  const listed = [tool("echo"), tool("secret")];

  it("keeps grant order and drops names outside the grant", () => {
    const clamped = clampTurnToolNames(listed, ["secret", "echo", "nope"]);
    assert.deepEqual(
      clamped.tools.map((item) => item.name),
      ["echo", "secret"],
    );
    assert.deepEqual(clamped.dropped, ["nope"]);
  });

  it("empty request hides every tool", () => {
    assert.deepEqual(clampTurnToolNames(listed, []).tools, []);
  });
});

describe("toolNarrowing", () => {
  it("subset is the request schema; hidden tools are denied at dispatch", async () => {
    const seen: string[][] = [];
    const executed: string[] = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo", executed), tool("secret", executed)],
      toolNarrowing: async ({ toolIds }) => toolIds.filter((id) => id === "echo"),
    }).createSession();
    const events = await collect(session, session.run("Hi"));
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((names) => names.length === 1 && names[0] === "echo"));
    assert.ok(events.some((event) => event.type === "tool_execution_blocked" && event.name === "secret" && event.reason === "tool_denied"));
    assert.deepEqual(executed, []);
  });

  it("superset return is clamped and emits tool_narrowing_clamped", async () => {
    const seen: string[][] = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        yield providerDone();
      },
    };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo"), tool("secret")],
      toolNarrowing: async () => ["echo", "nope"],
    }).createSession();
    const events = await collect(session, session.run("Hi"));
    assert.deepEqual(seen, [["echo"]]);
    const clamped = events.find((event) => event.type === "tool_narrowing_clamped");
    assert.ok(clamped && clamped.type === "tool_narrowing_clamped");
    assert.deepEqual(clamped.dropped, ["nope"]);
    assert.equal(clamped.turn, 1);
  });

  it("identical consecutive subsets keep schema bytes identical", async () => {
    const schemas: string[] = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        schemas.push(JSON.stringify(request.tools ?? []));
        if (schemas.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        yield providerDone();
      },
    };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo"), tool("secret")],
      toolNarrowing: async () => ["echo"],
    })
      .createSession()
      .run("Hi", { limits: { maxToolRounds: 1 } });
    assert.equal(schemas.length, 2);
    assert.equal(schemas[0], schemas[1]);
  });

  it("hook throw fails the turn with no provider request", async () => {
    let calls = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        yield providerDone();
      },
    };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo")],
      toolNarrowing: async () => {
        throw new Error("plane-classifier-failed");
      },
    }).createSession();
    await assert.rejects(session.run("Hi"), /plane-classifier-failed/);
    assert.equal(calls, 0);
  });

  it("RunOptions override AgentConfig; allowHiddenToolCalls dispatches hidden names", async () => {
    const seen: string[][] = [];
    const executed: string[] = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo", executed), tool("secret", executed)],
      toolNarrowing: async () => ["echo"],
    })
      .createSession()
      .run("Hi", {
        toolNarrowing: async () => ["echo"],
        allowHiddenToolCalls: true,
      });
    assert.ok(seen.every((names) => names.length === 1 && names[0] === "echo"));
    assert.deepEqual(executed, ["secret"]);
  });

  it("passes turn index and last assistant text on later turns", async () => {
    const seen: Array<{ turn: number; last?: string }> = [];
    let generateTurn = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        generateTurn += 1;
        if (generateTurn === 1) {
          yield providerTextDelta("first-reply");
          yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        }
        yield providerDone();
      },
    };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo")],
      toolNarrowing: async ({ turn, lastAssistantText }) => {
        seen.push({ turn, last: lastAssistantText });
        return ["echo"];
      },
    })
      .createSession()
      .run("Hi", { limits: { maxToolRounds: 1 } });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.turn, 1);
    assert.equal(seen[0]?.last, undefined);
    assert.equal(seen[1]?.turn, 2);
    assert.ok(seen[1]?.last?.includes("first-reply"));
  });

  it("provider_turn metadata records narrowed count and stable idsHash", async () => {
    let generateTurn = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        generateTurn += 1;
        if (generateTurn === 1) yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        yield providerDone();
      },
    };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [tool("echo"), tool("secret")],
      toolNarrowing: async () => ["echo"],
    }).createSession();
    const events = await collect(session, session.run("Hi", { limits: { maxToolRounds: 1 } }));
    const started = events.filter((event) => event.type === "provider_turn_started");
    assert.equal(started.length, 2);
    const hashes = started.map((event) => (event.type === "provider_turn_started" ? event.metadata.tools : undefined));
    assert.ok(hashes.every((tools) => tools?.count === 1 && /^sha256:[0-9a-f]{64}$/.test(tools.idsHash)));
    assert.equal(hashes[0]?.idsHash, hashes[1]?.idsHash);
    assert.ok(hashes.every((tools) => JSON.stringify(tools).includes("arguments") === false));
  });
});
