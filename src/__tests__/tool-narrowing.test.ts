import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, ModelProvider, ProviderRequest } from "../contracts.js";
import type { ContextDraft, HookRegistrar } from "../hooks/index.js";
import { createAgent, providerDone, providerTextDelta, toolCallContent } from "../index.js";
import { kernelEvents } from "./kernel-event-helpers.js";
import { clampTurnToolNames } from "../tools.js";
import { failedRun } from "./run-result-helpers.js";
import { providerPackage } from "../provider-kit/index.js";

const tool = (name: string, executed?: string[]) => ({
  name,
  parameters: {} as never,
  execute: () => {
    executed?.push(name);
    return { toolCallId: `t-${name}`, name, value: name };
  },
});

const schemaOf = (request: ProviderRequest) => (request.tools ?? []).map((entry) => entry.name);

async function collect(session: { subscribe: () => AsyncIterable<AgentEvent> }, run: Promise<unknown>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  await run;
  await pump;
  return events;
}

/** Narrow the turn's tool schemas to `names` through the `context.build` hook. */
function narrowing(name: string, pick: (ids: readonly string[]) => readonly string[]): (hooks: HookRegistrar) => void {
  return (hooks) =>
    hooks.on(
      "context.build",
      (draft: ContextDraft) => {
        const listed = draft.tools ?? [];
        const clamped = clampTurnToolNames(listed, pick(listed.map((entry) => entry.name)));
        return clamped.tools.length === listed.length && clamped.dropped.length === 0 ? undefined : { ...draft, tools: clamped.tools };
      },
      { id: name },
    );
}

describe("context.build tool narrowing", () => {
  it("subset is the request schema; a hidden call is still dispatched (provider view only)", async () => {
    const seen: string[][] = [];
    const executed: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [tool("echo", executed), tool("secret", executed)] },
        hooks: narrowing("narrow", (ids) => ids.filter((id) => id === "echo")),
      })
    ).session();
    await collect(session, session.run("Hi"));
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((names) => names.length === 1 && names[0] === "echo"));
    // `context.build` shapes the provider view; refusing a call the model should not make is the
    // `tool.call` gate's job (see the deny test below).
    assert.deepEqual(executed, ["secret"]);
  });

  it("a tool.call deny refuses a narrowed-out name, with no execution", async () => {
    const executed: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [tool("echo", executed), tool("secret", executed)] },
        hooks: (hooks) => {
          narrowing("narrow", (ids) => ids.filter((id) => id === "echo"))(hooks);
          hooks.on("tool.call", (payload) => (payload.name === "secret" ? { deny: "not available this turn" } : undefined), {
            id: "deny-secret",
          });
        },
      })
    ).session();
    await session.run("Hi");
    assert.deepEqual(executed, []);
  });

  it("identical consecutive subsets keep schema bytes identical", async () => {
    const schemas: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        schemas.push(JSON.stringify(request.tools ?? []));
        if (schemas.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          tools: { add: [tool("echo"), tool("secret")] },
          hooks: narrowing("narrow", () => ["echo"]),
        })
      ).session()
    ).run("Hi", { limits: { maxToolRounds: 1 } });
    assert.equal(schemas.length, 2);
    assert.equal(schemas[0], schemas[1]);
  });

  it("a handler throw fails the turn with no provider request", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [tool("echo")] },
        hooks: (hooks) =>
          hooks.on(
            "context.build",
            () => {
              throw new Error("plane-classifier-failed");
            },
            { id: "narrow" },
          ),
      })
    ).session();
    await failedRun(session.run("Hi"), /plane-classifier-failed/);
    assert.equal(calls, 0);
  });

  it("the handler sees every turn, so a policy can widen on a later turn", async () => {
    const seen: string[][] = [];
    let generateTurn = 0;
    let contextBuilds = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        generateTurn += 1;
        seen.push(schemaOf(request));
        if (generateTurn === 1) {
          yield providerTextDelta("first-reply");
          yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        }
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          tools: { add: [tool("echo"), tool("secret")] },
          hooks: (hooks) =>
            hooks.on(
              "context.build",
              (draft) => {
                contextBuilds += 1;
                const ids = (draft.tools ?? []).map((entry) => entry.name);
                // Turn 1 shows only `echo`; every later turn shows the full set.
                const keep = ids.filter((id) => (contextBuilds > 1 ? true : id === "echo"));
                return keep.length === ids.length
                  ? undefined
                  : { ...draft, tools: (draft.tools ?? []).filter((entry) => keep.includes(entry.name)) };
              },
              { id: "narrow" },
            ),
        })
      ).session()
    ).run("Hi", { limits: { maxToolRounds: 1 } });
    assert.deepEqual(seen, [["echo"], ["echo", "secret"]]);
  });

  it("provider_turn metadata records the narrowed count and a stable idsHash", async () => {
    let generateTurn = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        generateTurn += 1;
        if (generateTurn === 1) yield { type: "tool_call", call: toolCallContent("c1", "echo", {}) };
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [tool("echo"), tool("secret")] },
        hooks: narrowing("narrow", () => ["echo"]),
      })
    ).session();
    const events = await collect(session, session.run("Hi", { limits: { maxToolRounds: 1 } }));
    const started = events.filter((event) => event.type === "turn.started");
    assert.equal(started.length, 2);
    const hashes = started.map((event) => (event.type === "turn.started" ? event.metadata?.tools : undefined));
    assert.ok(hashes.every((tools) => tools?.count === 1 && /^sha256:[0-9a-f]{64}$/.test(tools.idsHash)));
    assert.equal(hashes[0]?.idsHash, hashes[1]?.idsHash);
  });
});

describe("per-turn tool scoping through the loop", () => {
  // `RunTurnOptions.tools` is a loop-level option: a custom loop narrows a single turn by name.
  // `allowHiddenToolCalls` is the escape hatch for the tools that scoping hides.
  const scopingLoop = (tools: false | readonly string[]) => ({
    name: "scoping-loop",
    revision: "1",
    async run(run: {
      turn: (options?: { tools?: false | readonly string[] }) => Promise<{ stopped: boolean; toolCalls: readonly unknown[] }>;
      executeTools: (calls: readonly never[]) => Promise<void>;
    }) {
      for (;;) {
        const turn = await run.turn({ tools });
        if (turn.stopped) return;
        if (turn.toolCalls.length > 0) {
          await run.executeTools(turn.toolCalls as readonly never[]);
          continue;
        }
        return;
      }
    },
  });

  it("a superset is clamped and emits tool_narrowing_clamped", async () => {
    const seen: string[][] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [tool("echo"), tool("secret")] },
        slots: { loop: scopingLoop(["echo", "nope"]) },
      })
    ).session();
    const events = await collect(session, session.run("Hi"));
    assert.deepEqual(seen, [["echo"]]);
    const clamped = kernelEvents<{ dropped: readonly string[]; turn: number }>(events, "tools.clamped")[0];
    assert.ok(clamped);
    assert.deepEqual(clamped.dropped, ["nope"]);
    assert.equal(clamped.turn, 1);
  });

  it("allowHiddenToolCalls dispatches names the turn scoping hid", async () => {
    const seen: string[][] = [];
    const executed: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          tools: { add: [tool("echo", executed), tool("secret", executed)] },
          slots: { loop: scopingLoop(["echo"]) },
        })
      ).session()
    ).run("Hi", { allowHiddenToolCalls: true });
    assert.ok(seen.every((names) => names.length === 1 && names[0] === "echo"));
    assert.deepEqual(executed, ["secret"]);
  });

  it("without allowHiddenToolCalls a hidden name is denied at dispatch", async () => {
    const seen: string[][] = [];
    const executed: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(schemaOf(request));
        if (seen.length === 1) yield { type: "tool_call", call: toolCallContent("c1", "secret", {}) };
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: [tool("echo", executed), tool("secret", executed)] },
        slots: { loop: scopingLoop(["echo"]) },
      })
    ).session();
    const events = await collect(session, session.run("Hi"));
    assert.ok(
      events.some(
        (event) =>
          event.type === "tool.completed" && event.status === "blocked" && event.name === "secret" && event.reason === "tool_denied",
      ),
    );
    assert.deepEqual(executed, []);
  });
});
