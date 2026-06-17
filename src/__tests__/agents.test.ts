import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createAgentSession,
  createContributionRegistries,
  createMemorySessionStore,
  createMiddlewareRegistry,
  createMockProvider,
  providerDone,
  providerTextDelta,
  toolCallContent,
  type AgentDefinition,
  type AgentEvent,
  type AIProvider,
  type ContextProvider,
  type InputBuilder,
  type PromptBuilder,
  type ProviderRequest,
  type ToolDefinition,
} from "../index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("agent session runtime", () => {
  it("streams mock provider text to subscriber", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
    });
    const session = agent.createSession({ id: "s1" });
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.deepEqual(events.map((event) => event.type), [
      "agent_started",
      "turn_started",
      "message_started",
      "message_delta",
      "message_finished",
      "turn_finished",
      "agent_finished",
    ]);
    const delta = events.find((event) => event.type === "message_delta");
    assert.equal(delta?.content.type, "text");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "Hello");
  });

  it("createAgentSession standalone uses agent config", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
    });
    const session = createAgentSession({ agent });
    const reader = collect(session.subscribe());

    await session.run("Hi");

    assert.equal((await reader).some((event) => event.type === "agent_finished"), true);
  });

  it("session prompt delegates to run for string input", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
    });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.prompt("Hi");

    assert.equal((await reader).some((event) => event.type === "message_delta"), true);
  });

  it("missing provider fails closed and emits error", async () => {
    const agent = createAgent({ model: { provider: "missing", model: "demo" } });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await assert.rejects(session.run("Hi"), /Unknown provider: missing/);

    const events = await reader;
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "error");
    assert.equal(events[0]?.type === "error" ? events[0].error.message : undefined, "Unknown provider: missing");
  });

  it("executes one registered tool and continues", async () => {
    const requests: ProviderRequest[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
      else yield providerTextDelta("done");
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }) };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo] });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    const events = await reader;

    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.messages.some((message) => message.role === "tool"), true);
    assert.equal(events.some((event) => event.type === "tool_execution_finished"), true);
    const deltas = events.filter((event) => event.type === "message_delta");
    const lastDelta = deltas[deltas.length - 1];
    assert.equal(lastDelta?.type === "message_delta" && lastDelta.content.type === "text" ? lastDelta.content.text : undefined, "done");
  });

  it("blocks unknown tool without executing", async () => {
    const provider: AIProvider = { id: "mock", async *generate() {
      yield { type: "tool_call", call: toolCallContent("call_1", "missing") };
      yield providerDone();
    } };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.equal(events.some((event) => event.type === "tool_execution_started"), false);
    assert.equal(events.some((event) => event.type === "tool_execution_blocked"), true);
  });

  it("stops at max tool rounds", async () => {
    let calls = 0;
    const provider: AIProvider = { id: "mock", async *generate() {
      calls += 1;
      yield { type: "tool_call", call: toolCallContent(`call_${calls}`, "echo") };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }) };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo] });

    await agent.createSession().run("Hi", { maxToolRounds: 1 });

    assert.equal(calls, 2);
  });

  it("passes only host active tools to provider", async () => {
    const seen: string[][] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      seen.push((request.tools ?? []).map((tool) => tool.name));
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo" }) };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [echo],
      skills: [{ name: "wants-missing", toolNames: ["missing"], instructions: "Use missing." }],
    });

    await agent.createSession().run("Hi");

    assert.deepEqual(seen, [["echo"]]);
  });

  it("abort stops before next provider turn", async () => {
    let turns = 0;
    let session!: ReturnType<typeof createAgent>["createSession"] extends (...args: never[]) => infer R ? R : never;
    const provider: AIProvider = { id: "mock", async *generate() {
      turns += 1;
      yield { type: "tool_call", call: toolCallContent("call_1", "stop") };
      yield providerDone();
    } };
    const stop: ToolDefinition = { name: "stop", execute: (_args, context) => {
      session.abort(new Error("stop"));
      return { toolCallId: context.toolCallId, name: "stop" };
    } };
    const store = createMemorySessionStore();
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [stop], store });
    session = agent.createSession({ id: "s1" });
    const reader = collect(session.subscribe());

    await assert.rejects(session.run("Hi"), /stop/);
    await reader;

    assert.equal(turns, 1);
    assert.equal((await store.list("s1")).filter((entry) => entry.message?.role === "assistant").length, 1);
  });

  it("run options signal aborts provider request", async () => {
    let seenSignal!: AbortSignal;
    let seen!: () => void;
    const seenPromise = new Promise<void>((resolve) => { seen = resolve; });
    const provider: AIProvider = { id: "mock", async *generate(request) {
      seenSignal = request.signal!;
      seen();
      await new Promise<void>((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true }));
    } };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider });
    const controller = new AbortController();
    const run = agent.createSession().run("Hi", { signal: controller.signal });

    await seenPromise;
    controller.abort(new Error("cancelled"));

    await assert.rejects(run, /cancelled/);
    assert.equal(seenSignal.aborted, true);
  });

  it("rejects concurrent runs", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const provider: AIProvider = { id: "mock", async *generate() {
      await blocked;
      yield providerDone();
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider }).createSession();
    const first = session.run("one");

    await assert.rejects(session.run("two"), /active run/);
    release();
    await first;
  });

  it("emits error for provider error", async () => {
    const provider: AIProvider = { id: "mock", async *generate() {
      yield { type: "error", error: { name: "ProviderError", message: "provider failed" } };
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider }).createSession();
    const reader = collect(session.subscribe());

    await assert.rejects(session.run("Hi"), /provider failed/);
    const events = await reader;

    assert.equal(events.some((event) => event.type === "error" && event.error.message === "provider failed"), true);
  });

  it("tool errors emit tool error events and continue", async () => {
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("after error");
      else yield { type: "tool_call", call: toolCallContent("call_1", "boom") };
      yield providerDone();
    } };
    const boom: ToolDefinition = { name: "boom", execute: () => { throw new Error("tool failed"); } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [boom] }).createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.equal(events.some((event) => event.type === "tool_execution_error" && event.error.message === "tool failed"), true);
    assert.equal(events.some((event) => event.type === "message_delta" && event.content.type === "text" && event.content.text === "after error"), true);
  });

  it("uses configured input and prompt builders", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) {
      request = input;
      yield providerDone();
    } };
    const inputBuilder: InputBuilder = { name: "custom-input", build: (_input, context) => [
      { role: "user", content: [{ type: "text", text: `input:${String(context?.metadata?.source)}` }] },
    ] };
    const promptBuilder: PromptBuilder = { name: "custom-prompt", build: (input) => [
      { role: "system", content: [{ type: "text", text: "prompt" }] },
      ...input.messages,
    ] };
    const middleware = createMiddlewareRegistry();
    middleware.use<{ readonly messages: ProviderRequest["messages"] }>("prompt_build", (value) => ({
      ...value,
      messages: [...value.messages, { role: "system", content: [{ type: "text", text: "middleware" }] }],
    }));
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      inputBuilder,
      promptBuilder,
      middleware,
      metadata: { source: "agent" },
    });

    await agent.createSession({ metadata: { session: true } }).run("ignored", { metadata: { run: true } });

    assert.equal(request.messages[0]?.content[0]?.type === "text" ? request.messages[0].content[0].text : undefined, "prompt");
    assert.equal(request.messages[1]?.content[0]?.type === "text" ? request.messages[1].content[0].text : undefined, "input:agent");
    assert.equal(request.messages[2]?.content[0]?.type === "text" ? request.messages[2].content[0].text : undefined, "middleware");
    assert.deepEqual(request.metadata, { source: "agent", session: true, run: true });
  });

  it("uses context providers and selected skills", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) {
      request = input;
      yield providerDone();
    } };
    const context: ContextProvider = { name: "ctx", resolve: () => [{ title: "Runtime context", content: "selected context" }] };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      context: [context],
      skills: [{ name: "brief", instructions: "Be brief." }],
    });

    await agent.createSession().run("Hi");

    const text = request.messages.flatMap((message) => message.content).map((block) => block.type === "text" ? block.text : "").join("\n");
    assert.equal(text.includes("selected context"), true);
    assert.equal(text.includes("Skill brief"), true);
  });

  it("external agent definition can create runtime agent", async () => {
    const contributions = createContributionRegistries();
    const definition: AgentDefinition = {
      name: "demo",
      create: () => createAgent({ model: { provider: "mock", model: "demo" }, provider: createMockProvider([providerDone()]) }),
    };
    contributions.agents.register("demo", definition);

    const agent = await contributions.agents.resolve("demo").create();
    const session = agent.createSession({ id: "s1" });

    await session.run("Hi");
    assert.equal(session.id, "s1");
  });

  it("persists user assistant and tool messages to store", async () => {
    const store = createMemorySessionStore();
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
      else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { ok: true }) };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }) };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo], store }).createSession({ id: "s1" });

    await session.run("Hi");

    assert.deepEqual((await store.list("s1")).map((entry) => entry.kind), ["message", "message", "message", "message"]);
    assert.deepEqual((await store.list("s1")).map((entry) => entry.message?.role), ["user", "assistant", "tool", "assistant"]);
  });

  it("resumes history from leaf and checkouts old leaves", async () => {
    const store = createMemorySessionStore();
    const seen: string[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      seen.push(request.messages.map((message) => message.content.map((block) => block.type === "text" ? block.text : "").join("")).join("|"));
      yield providerTextDelta(`reply ${seen.length}`);
      yield providerDone();
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, store }).createSession({ id: "s1" });

    await session.run("first");
    const firstLeaf = (await session.entries()).at(-1)!.id;
    await session.run("second");
    await session.checkout(firstLeaf);
    await session.run("branch");

    assert.equal(seen[1]?.includes("first"), true);
    assert.equal(seen[1]?.includes("second"), true);
    assert.equal(seen[2]?.includes("second"), false);
    assert.equal(seen[2]?.includes("branch"), true);
  });

  it("fork uses same session store and selected leaf", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, store }).createSession({ id: "s1" });

    await session.run("base");
    const leaf = (await session.entries()).at(-1)!.id;
    const fork = session.fork({ leafId: leaf });
    await fork.run("forked");

    assert.equal((await store.list("s1")).some((entry) => entry.message?.content[0]?.type === "text" && entry.message.content[0].text === "forked"), true);
  });

  it("clone copies current branch to new session id", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, store }).createSession({ id: "s1" });

    await session.run("base");
    const clone = await session.clone({ id: "s2" });

    assert.notEqual(clone.id, session.id);
    assert.deepEqual((await store.list("s2")).map((entry) => entry.sessionId), ["s2", "s2"]);
    assert.notEqual((await store.list("s2"))[0]?.id, (await store.list("s1"))[0]?.id);
  });

  it("model override appends model change entry", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerDone()]);

    await createAgent({ model: { provider: "mock", model: "default" }, provider, store }).createSession({ id: "s1" }).run("Hi", { model: { provider: "mock", model: "override" } });

    const model = (await store.list("s1")).find((entry) => entry.kind === "model_change");
    assert.equal(model?.model?.model, "override");
  });

  it("store entries do not include provider credentials", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

    await createAgent({ model: { provider: "mock", model: "demo" }, provider, store, credentials: { resolve: () => ({ type: "bearer", value: "secret" }) } }).createSession({ id: "s1" }).run("Hi");

    assert.equal(JSON.stringify(await store.list("s1")).includes("secret"), false);
  });

  it("run model override changes provider request model", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) {
      request = input;
      yield providerDone();
    } };
    const agent = createAgent({ model: { provider: "mock", model: "default" }, provider });

    await agent.createSession().run("Hi", { model: { provider: "mock", model: "override" } });

    assert.equal(request.model.model, "override");
  });
});
