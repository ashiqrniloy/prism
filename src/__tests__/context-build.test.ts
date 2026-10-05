import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, registerContextSources, withContextBlocks, type ContextSource, type Message, type ProviderRequest } from "../index.js";
import { mockProvider } from "../testing/index.js";

const MODEL = { provider: "mock", model: "demo" };
const text = (m: Message) => m.content.find((p) => p.type === "text")?.text ?? "";
const systemTexts = (request: ProviderRequest) => request.messages.filter((m) => m.role === "system").map(text);

async function capturingAgent(sources: readonly ContextSource[], captured: ProviderRequest[]) {
  return await createAgent({
    model: MODEL,
    packages: [mockProvider([[{ type: "done" }]], { onRequest: (request) => captured.push(request) })],
    ...(sources.length > 0 ? { hooks: (hooks) => registerContextSources(hooks, sources) } : {}),
  });
}

describe("context.build sources", () => {
  it("context_build_injects_without_touching_store", async () => {
    const captured: ProviderRequest[] = [];
    const session = await (await capturingAgent([{ name: "json", instructions: "Always answer in JSON" }], captured)).session();
    const result = await session.run("hi");
    assert.equal(result.status, "completed");
    assert.ok(systemTexts(captured[0]!).some((t) => t.includes("Always answer in JSON")));
    // The draft is the provider view only: nothing the `context.build` handler contributed
    // reaches the store.
    const stored = JSON.stringify(await session.entries());
    assert.ok(!stored.includes("Always answer in JSON"), "context.build text must not reach the store");
  });

  it("places source instructions at the stable-prefix boundary, ahead of the transcript", async () => {
    const captured: ProviderRequest[] = [];
    const session = await (await capturingAgent([{ name: "agents", instructions: "repo rules" }], captured)).session();
    await session.run("hi");
    const messages = captured[0]!.messages;
    const injectedAt = messages.findIndex((m) => text(m).includes("repo rules"));
    const userAt = messages.findIndex((m) => m.role === "user" && text(m) === "hi");
    assert.ok(injectedAt >= 0 && userAt >= 0);
    assert.ok(injectedAt < userAt, "injected instructions sit ahead of the user turn");
  });

  it("appends context blocks to the draft", async () => {
    const captured: ProviderRequest[] = [];
    const session = await (
      await capturingAgent([{ name: "schema", contextBlocks: [{ id: "schema", title: "Schema", content: "type T = string" }] }], captured)
    ).session();
    await session.run("hi");
    assert.deepEqual(
      (captured[0]!.context ?? []).map((block) => block.id),
      ["schema"],
    );
  });

  it("composes several sources in registration order", async () => {
    const captured: ProviderRequest[] = [];
    const session = await (
      await capturingAgent(
        [
          { name: "a", instructions: "first" },
          { name: "b", instructions: "second" },
        ],
        captured,
      )
    ).session();
    await session.run("hi");
    const injected = systemTexts(captured[0]!).filter((t) => t === "first" || t === "second");
    assert.deepEqual(injected, ["first", "second"]);
  });

  it("registers nothing for a contentless source, leaving the request unchanged", async () => {
    const captured: ProviderRequest[] = [];
    await (await (await await capturingAgent([{ name: "empty" }], captured)).session()).run("hi");
    assert.equal(
      systemTexts(captured[0]!).some((t) => t.includes("empty")),
      false,
    );
  });

  it("a run with no sources sends byte-identical messages to one built without the hook", async () => {
    const withHook: ProviderRequest[] = [];
    const without: ProviderRequest[] = [];
    await (await (await await capturingAgent([{ name: "none" }], withHook)).session()).run("hi");
    await (await (await await capturingAgent([], without)).session()).run("hi");
    assert.deepEqual(withHook[0]!.messages.map(text), without[0]!.messages.map(text));
  });
});

describe("context.build tools are restrictive-only", () => {
  it("a handler may drop tools but never introduce one the request did not carry", async () => {
    const captured: ProviderRequest[] = [];
    const session = await (
      await createAgent({
        model: MODEL,
        packages: [mockProvider([[{ type: "done" }]], { onRequest: (request) => captured.push(request) })],
        tools: {
          add: [
            {
              name: "echo",
              description: "e",
              parameters: { type: "object" },
              execute: () => ({ toolCallId: "1", name: "echo", value: 1 }),
            },
            {
              name: "secret",
              description: "s",
              parameters: { type: "object" },
              execute: () => ({ toolCallId: "2", name: "secret", value: 2 }),
            },
          ],
        },
        hooks: (hooks) =>
          hooks.on(
            "context.build",
            (draft) => ({ ...draft, tools: [{ name: "dangerous", description: "d", inputSchema: { type: "object" } } as never] }),
            { id: "smuggle" },
          ),
      })
    ).session();
    await session.run("hi");
    const names = (captured[0]!.tools ?? []).map((entry) => entry.name);
    assert.deepEqual(names, [], "a smuggled tool name is dropped, and the emptied list stands");
  });

  it("an empty tools list is honoured as 'no tools this turn'", async () => {
    const captured: ProviderRequest[] = [];
    const session = await (
      await createAgent({
        model: MODEL,
        packages: [mockProvider([[{ type: "done" }]], { onRequest: (request) => captured.push(request) })],
        tools: {
          add: [
            {
              name: "echo",
              description: "e",
              parameters: { type: "object" },
              execute: () => ({ toolCallId: "1", name: "echo", value: 1 }),
            },
          ],
        },
        hooks: (hooks) => hooks.on("context.build", (draft) => ({ ...draft, tools: [] }), { id: "empty" }),
      })
    ).session();
    await session.run("hi");
    assert.deepEqual(captured[0]!.tools, []);
  });
});

describe("withContextBlocks", () => {
  it("abstains (undefined) when there is nothing to add, so the request keeps its bytes", () => {
    assert.equal(withContextBlocks({ messages: [] }, []), undefined);
  });

  it("appends onto an existing context list", () => {
    const draft = { messages: [] as readonly Message[], context: [{ id: "a", content: "one" }] };
    const next = withContextBlocks(draft, [{ id: "b", content: "two" }]);
    assert.deepEqual(
      next?.context?.map((block) => block.id),
      ["a", "b"],
    );
  });
});
