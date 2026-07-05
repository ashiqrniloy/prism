import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createAgentSession,
  createContributionRegistries,
  createMemorySessionStore,
  createMiddlewareRegistry,
  createMockProvider,
  createProviderResolver,
  createSecretRedactor,
  createSessionCachePolicy,
  createSkillRegistry,
  getSessionBranchEntries,
  providerDone,
  providerTextDelta,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
  type AgentDefinition,
  type AgentEvent,
  type AIProvider,
  type ContentBlock,
  type ContextProvider,
  type CredentialResolver,
  type Extension,
  type InputBuilder,
  type InstructionInjector,
  type Message,
  type PromptBuilder,
  type ProviderRequest,
  type SessionEntry,
  type SessionStore,
  type SettingsProvider,
  type ToolDefinition,
} from "../index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function textOf(message: ProviderRequest["messages"][number] | undefined): string {
  return message?.content.map((block) => block.type === "text" ? block.text : "").join("") ?? "";
}

function messageText(messages: readonly Message[]): string {
  return JSON.stringify(messages);
}

async function take(iterable: AsyncIterable<AgentEvent>, count: number): Promise<AgentEvent[]> {
  const iterator = iterable[Symbol.asyncIterator]();
  const events: AgentEvent[] = [];
  try {
    while (events.length < count) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }
    return events;
  } finally {
    await iterator.return?.();
  }
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

  it("closes slow subscriber on bounded queue overflow", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([
        providerTextDelta("a"),
        providerTextDelta("b"),
        providerTextDelta("c"),
        providerDone(),
      ]),
    });
    const session = agent.createSession({ id: "overflow-session" });
    const iterator = session.subscribe({ maxQueuedEvents: 2 })[Symbol.asyncIterator]();

    await session.run("Hi");

    const overflow = await iterator.next();
    assert.equal(overflow.done, false);
    assert.equal(overflow.value.type, "event_subscriber_overflow");
    assert.equal(overflow.value.type === "event_subscriber_overflow" ? overflow.value.maxQueuedEvents : undefined, 2);
    assert.equal(overflow.value.type === "event_subscriber_overflow" ? overflow.value.overflow : undefined, "close");
    assert.equal((await iterator.next()).done, true);
  });

  it("drop_oldest subscriber overflow keeps the newest bounded events", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
    });
    const session = agent.createSession({ id: "drop-oldest-session" });
    const iterator = session.subscribe({ maxQueuedEvents: 2, overflow: "drop_oldest" })[Symbol.asyncIterator]();

    await session.run("Hi");
    const events: AgentEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }

    assert.deepEqual(events.map((event) => event.type), ["turn_finished", "agent_finished"]);
  });

  it("resolves provider from AgentConfig.providerSource with no direct provider", async () => {
    const own = createMockProvider([providerTextDelta("from-resolver"), providerDone()], { id: "own" });
    const agent = createAgent({
      model: { provider: "own", model: "demo" },
      providerSource: createProviderResolver([own]),
    });
    const session = agent.createSession({ id: "s-resolve" });
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    const delta = events.find((event) => event.type === "message_delta");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "from-resolver");
  });

  it("fails closed when providerSource returns undefined for the model's provider", async () => {
    const agent = createAgent({
      model: { provider: "missing", model: "demo" },
      providerSource: createProviderResolver([]),
    });
    const session = agent.createSession({ id: "s-missing" });
    const reader = collect(session.subscribe());

    await assert.rejects(() => session.run("Hi"), /Unknown provider: missing/);
    const events = await reader;
    assert.equal(events.some((event) => event.type === "error"), true);
  });

  it("RunOptions.providerSource overrides AgentConfig.providerSource per run", async () => {
    const configProvider = createMockProvider([providerTextDelta("from-config"), providerDone()], { id: "config" });
    const runProvider = createMockProvider([providerTextDelta("from-run"), providerDone()], { id: "run" });
    const agent = createAgent({
      model: { provider: "run", model: "demo" },
      providerSource: createProviderResolver([configProvider]),
    });
    const session = agent.createSession({ id: "s-override" });
    const reader = collect(session.subscribe());

    await session.run("Hi", { providerSource: createProviderResolver([runProvider]) });
    const events = await reader;

    const delta = events.find((event) => event.type === "message_delta");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "from-run");
  });

  it("direct provider takes precedence and bypasses the resolver when both provider and providerSource are set", async () => {
    const direct = createMockProvider([providerTextDelta("from-direct"), providerDone()], { id: "direct" });
    // The resolver ALSO contains a provider for the model's `provider` id, so the
    // only way `direct` wins is if the resolver is bypassed entirely.
    const resolverProvider = createMockProvider([providerTextDelta("from-resolver"), providerDone()], { id: "direct" });
    const agent = createAgent({
      model: { provider: "direct", model: "demo" },
      provider: direct,
      providerSource: createProviderResolver([resolverProvider]),
    });
    const session = agent.createSession({ id: "s-precedence" });
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    const delta = events.find((event) => event.type === "message_delta");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "from-direct");
  });

  it("RunOptions.model override routes through the resolver with the new model", async () => {
    const a = createMockProvider([providerTextDelta("from-a"), providerDone()], { id: "a" });
    const agent = createAgent({
      model: { provider: "a", model: "demo" },
      providerSource: createProviderResolver([a]),
    });
    const session = agent.createSession({ id: "s-model-override" });
    const reader = collect(session.subscribe());

    await session.run("Hi", { model: { provider: "a", model: "other" } });
    const events = await reader;

    const delta = events.find((event) => event.type === "message_delta");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "from-a");
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

  it("runtime_reconstructs_tool_call_delta_executes_persists_and_replays", async () => {
    const requests: ProviderRequest[] = [];
    const entriesStore = createMemorySessionStore();
    const provider: AIProvider = { id: "mock", async *generate(request) {
      requests.push(request);
      if (requests.length === 1) {
        yield providerToolCallDelta({ index: 0, id: "call_1", name: "echo", argumentsText: "{\"text\":" });
        yield providerToolCallDelta({ index: 0, argumentsText: "\"hi\"}" });
      } else {
        yield providerTextDelta("done");
      }
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }) };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo], store: entriesStore });
    const session = agent.createSession({ id: "delta-session" });
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    const events = await reader;

    assert.equal(requests.length, 2);
    assert.ok(events.some((event) => event.type === "message_delta" && event.content.type === "tool_call_delta" && event.content.argumentsText === "{\"text\":"), "expected streamed tool_call_delta event");
    assert.equal(events.filter((event) => event.type === "tool_execution_finished").length, 1);
    const replay = requests[1]!;
    const assistant = replay.messages.find((message) => message.role === "assistant");
    assert.ok(assistant, "expected assistant message in replay");
    assert.ok(assistant.content.some((block) => block.type === "tool_call" && block.id === "call_1" && block.name === "echo" && block.arguments.text === "hi"), "expected reconstructed tool_call in assistant message");
    const tool = replay.messages.find((message) => message.role === "tool");
    assert.ok(tool, "expected tool message in replay");
    assert.ok(tool.content.some((block) => block.type === "tool_result" && block.toolCallId === "call_1" && block.name === "echo"), "expected tool_result in tool message");
    assert.ok(replay.messages.indexOf(assistant) < replay.messages.indexOf(tool), "assistant tool_call must precede tool_result");
    const persisted = await session.entries();
    assert.ok(persisted.some((entry) => entry.message?.role === "assistant" && entry.message.content.some((block) => block.type === "tool_call" && block.id === "call_1")), "expected persisted assistant tool_call");
    assert.ok(persisted.some((entry) => entry.message?.role === "tool" && entry.message.content.some((block) => block.type === "tool_result" && block.toolCallId === "call_1")), "expected persisted tool_result");
    assert.equal(persisted.some((entry) => entry.message?.content.some((block) => block.type === "tool_call_delta")), false, "tool deltas are UI events, not persisted transcript blocks");
  });

  it("runtime_replays_provider_tool_call_and_tool_result_before_final_response", async () => {
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
    const replay = requests[1]!;
    const assistant = replay.messages.find((message) => message.role === "assistant");
    assert.ok(assistant, "expected assistant message in replay");
    assert.ok(assistant.content.some((block) => block.type === "tool_call" && block.id === "call_1" && block.name === "echo"), "expected tool_call in assistant message");
    const tool = replay.messages.find((message) => message.role === "tool");
    assert.ok(tool, "expected tool message in replay");
    assert.ok(tool.content.some((block) => block.type === "tool_result" && block.toolCallId === "call_1" && block.name === "echo"), "expected tool_result in tool message");
    assert.ok(replay.messages.indexOf(assistant) < replay.messages.indexOf(tool), "assistant tool_call must precede tool_result");
    const deltas = events.filter((event) => event.type === "message_delta");
    const lastDelta = deltas[deltas.length - 1];
    assert.equal(lastDelta?.type === "message_delta" && lastDelta.content.type === "text" ? lastDelta.content.text : undefined, "done");
  });

  it("runtime_tool_replay_preserves_tool_error_result", async () => {
    const requests: ProviderRequest[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: toolCallContent("call_1", "boom") };
      else yield providerTextDelta("after error");
      yield providerDone();
    } };
    const boom: ToolDefinition = { name: "boom", execute: () => { throw new Error("tool failed"); } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [boom] }).createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    await reader;

    const replay = requests[1]!;
    const tool = replay.messages.find((message) => message.role === "tool");
    assert.ok(tool, "expected tool message in replay");
    const result = tool.content.find((block): block is Extract<ContentBlock, { type: "tool_result" }> => block.type === "tool_result");
    assert.ok(result, "expected tool_result block");
    assert.equal(result.toolCallId, "call_1");
    assert.equal(result.name, "boom");
    assert.equal(result.error?.message ?? result.error, "tool failed");
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

  it("agent_config_instructions_preserves_existing_default_prompt_path", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    await createAgent({ model: { provider: "mock", model: "demo" }, provider, instructions: "Base" }).createSession().run("Hi");

    assert.equal(textOf(request.messages[0]), "System instruction:\nBase");
  });

  it("run_system_prompt_override_can_disable_configured_layers", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      instructions: "Base",
      systemPrompt: { id: "app", source: "app", text: "App" },
    }).createSession().run("Hi", { systemPrompt: false });

    assert.equal(textOf(request.messages[0]), "System instruction:\nBase");
    assert.equal(request.messages.some((message) => textOf(message).includes("App")), false);
  });

  it("uses layered system prompts before provider generate", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      instructions: "Base",
      systemPrompt: [{ id: "pkg", source: "package", text: "Package" }, { id: "app", source: "app", mode: "replace", text: "App" }],
    }).createSession().run("Hi", { systemPrompt: { id: "run", source: "run", text: "Run" } });

    assert.equal(textOf(request.messages[0]), "System instruction:\nApp\n\nRun");
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

  it("activeSkills selects only the named skill for the run", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    const registry = createSkillRegistry([
      { name: "summarize", instructions: "Summarize." },
      { name: "translate", instructions: "Translate." },
    ]);
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, skills: registry });

    await agent.createSession().run("Hi", { activeSkills: ["summarize"] });

    const text = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.equal(text.includes("Skill summarize"), true);
    assert.equal(text.includes("Skill translate"), false);
  });

  it("two runs with different activeSkills activate different skills on the same config", async () => {
    const seen: string[] = [];
    const provider: AIProvider = { id: "mock", async *generate(input) {
      seen.push(input.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("|"));
      yield providerDone();
    } };
    const registry = createSkillRegistry([
      { name: "summarize", instructions: "Summarize." },
      { name: "translate", instructions: "Translate." },
    ]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, skills: registry }).createSession();

    await session.run("a", { activeSkills: ["summarize"] });
    await session.run("b", { activeSkills: ["translate"] });

    assert.equal(seen[0]?.includes("Skill summarize"), true);
    assert.equal(seen[0]?.includes("Skill translate"), false);
    assert.equal(seen[1]?.includes("Skill translate"), true);
    assert.equal(seen[1]?.includes("Skill summarize"), false);
  });

  it("Skill.context activates only when the skill is active", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    const schema: ContextProvider = { name: "schema", resolve: () => [{ title: "Schema", content: "selected schema" }] };
    const registry = createSkillRegistry([
      { name: "summarize", instructions: "Summarize.", context: [schema] },
      { name: "translate", instructions: "Translate." },
    ]);
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, skills: registry });

    await agent.createSession().run("Hi", { activeSkills: ["translate"] });

    const text = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.equal(text.includes("selected schema"), false);

    await agent.createSession().run("Hi", { activeSkills: ["summarize"] });
    const text2 = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.equal(text2.includes("selected schema"), true);
  });

  it("Skill.context blocks come after host AgentConfig.context blocks", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    const hostCtx: ContextProvider = { name: "host", resolve: () => [{ title: "Host", content: "host-block" }] };
    const skillCtx: ContextProvider = { name: "skill-ctx", resolve: () => [{ title: "Skill", content: "skill-block" }] };
    const registry = createSkillRegistry([
      { name: "with-ctx", instructions: "x", context: [skillCtx] },
    ]);
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      context: [hostCtx],
      skills: registry,
    });

    await agent.createSession().run("Hi", { activeSkills: ["with-ctx"] });

    const text = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.ok(text.includes("host-block"), "host context missing");
    assert.ok(text.includes("skill-block"), "skill context missing");
    assert.ok(text.indexOf("host-block") < text.indexOf("skill-block"), "host context must precede skill context");
  });

  it("skill with toolNames referencing an inactive tool fails fast before the first provider turn", async () => {
    let turns = 0;
    const store = createMemorySessionStore();
    const provider: AIProvider = { id: "mock", async *generate() { turns += 1; yield providerDone(); } };
    const registry = createSkillRegistry([
      { name: "needs-missing", instructions: "Use missing.", toolNames: ["missing"] },
    ]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, skills: registry, store }).createSession({ id: "skill-fail" });

    await assert.rejects(session.run("Hi", { activeSkills: ["needs-missing"] }), /requires inactive tool: missing/);
    assert.equal(turns, 0);
    assert.deepEqual(await store.list("skill-fail"), []);
  });

  it("RunOptions.skills overrides a plain-array AgentConfig.skills for the run", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      skills: [{ name: "brief", instructions: "Be brief." }],
    });

    await agent.createSession().run("Hi", { skills: [{ name: "verbose", instructions: "Be verbose." }] });

    let text = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.equal(text.includes("Skill verbose"), true);
    assert.equal(text.includes("Skill brief"), false);

    await agent.createSession().run("Hi", { skills: [] });

    text = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.equal(text.includes("Skill verbose"), false);
    assert.equal(text.includes("Skill brief"), false);
  });

  it("no skill overrides keeps all configured skills active", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    const registry = createSkillRegistry([
      { name: "summarize", instructions: "Summarize." },
      { name: "translate", instructions: "Translate." },
    ]);
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, skills: registry });

    await agent.createSession().run("Hi");

    const text = request.messages.flatMap((m) => m.content).map((b) => b.type === "text" ? b.text : "").join("\n");
    assert.equal(text.includes("Skill summarize"), true);
    assert.equal(text.includes("Skill translate"), true);
  });

  it("external agent definition can create runtime agent", async () => {
    const contributions = createContributionRegistries();
    const definition: AgentDefinition = {
      name: "demo",
      create: () => createAgent({ model: { provider: "mock", model: "demo" }, provider: createMockProvider([providerDone()]) }),
    };
    contributions.agents.register("demo", definition);

    const agent = await contributions.agents.resolve("demo").create!();
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

  it("uses store.readBranchPath instead of list() for entries and run history", async () => {
    const stored: SessionEntry[] = [];
    let readCalls = 0;
    const store: SessionStore = {
      async append(entry) { stored.push(structuredClone(entry)); },
      async list() { throw new Error("full scan"); },
      async readBranchPath(query) {
        readCalls++;
        return { items: getSessionBranchEntries(stored.filter((entry) => entry.sessionId === query.sessionId), { leafId: query.leafId }) };
      },
    };
    const seen: string[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      seen.push(request.messages.map(textOf).join("|"));
      yield providerTextDelta(`reply ${seen.length}`);
      yield providerDone();
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, store }).createSession({ id: "s1" });

    await session.run("first");
    await session.run("second");
    const entries = await session.entries();

    assert.ok(entries.length > 0, "reader returned the branch");
    assert.ok(readCalls >= 3, "readBranchPath was used for rebuilds and entries()");
    assert.equal(seen[1]?.includes("first"), true);
    assert.equal(seen[1]?.includes("reply 1"), true);
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

  it("AgentConfig extensions settings and credentials stay host-owned during runs", async () => {
    let setupCalls = 0;
    let settingsCalls = 0;
    let credentialCalls = 0;
    const extension: Extension = { name: "inert", setup: () => { setupCalls += 1; } };
    const settings: SettingsProvider = { get: () => { settingsCalls += 1; return undefined; } };
    const credentials: CredentialResolver = { resolve: () => { credentialCalls += 1; return { type: "api_key", value: "secret-unused" }; } };
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      extensions: [extension],
      settings,
      credentials,
      store,
    }).createSession({ id: "inert-fields" });

    await session.run("Hi");

    assert.equal(setupCalls, 0);
    assert.equal(settingsCalls, 0);
    assert.equal(credentialCalls, 0);
    assert.equal(JSON.stringify(await store.list("inert-fields")).includes("secret-unused"), false);
  });

  it("store entries do not include provider credentials", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

    await createAgent({ model: { provider: "mock", model: "demo" }, provider, store, credentials: { resolve: () => ({ type: "bearer", value: "secret" }) } }).createSession({ id: "s1" }).run("Hi");

    assert.equal(JSON.stringify(await store.list("s1")).includes("secret"), false);
  });

  it("redacts a known secret in an appended user message before it reaches the store", async () => {
    // Task 6 security criterion: redaction is preserved through the new SessionAppendOptions
    // path. appendEntry runs redactSessionEntry BEFORE store.append(entry, options), so the
    // store never sees the raw secret even though the append now carries concurrency options.
    const secret = "sk-super-secret-12345";
    const memory = createMemorySessionStore();
    const seen: string[] = [];
    const store: SessionStore = {
      append: async (entry, options) => { seen.push(JSON.stringify(entry)); return memory.append(entry, options); },
      list: (id) => memory.list(id),
    };
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    await createAgent({ model: { provider: "mock", model: "demo" }, provider, store, redactor: createSecretRedactor([secret]) }).createSession({ id: "s1" }).run(`My token is ${secret}`);

    assert.equal(seen.some((s) => s.includes(secret)), false, "raw secret never reached store.append");
    assert.equal(seen.some((s) => s.includes("[REDACTED]")), true, "secret was redacted before append");
    assert.equal(JSON.stringify(await memory.list("s1")).includes(secret), false, "persisted store has no raw secret");
  });

  it("passes redacted current input and prior history to instruction injectors", async () => {
    const firstSecret = "input-secret-12345";
    const secondSecret = "next-secret-12345";
    const captures: { input: readonly Message[]; history: readonly Message[] }[] = [];
    const capture: InstructionInjector = {
      name: "capture",
      apply: (ctx) => {
        captures.push({ input: ctx.input, history: ctx.history });
        return { when: "every_turn" };
      },
    };
    const provider: AIProvider = { id: "mock", async *generate() { yield providerDone(); } };
    const redactor = createSecretRedactor([firstSecret, secondSecret]);
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      redactor,
      instructionInjectors: [capture],
    }).createSession({ id: "s1" });

    await session.run(`first ${firstSecret}`);
    await session.run(`second ${secondSecret}`);
    const stored = JSON.stringify(await session.entries());

    assert.equal(stored.includes(firstSecret), false, "persisted entries kept raw first secret");
    assert.equal(stored.includes(secondSecret), false, "persisted entries kept raw second secret");
    assert.equal(stored.includes("[REDACTED]"), true, "persisted entries were not redacted");
    assert.equal(messageText(captures[0]!.input).includes(firstSecret), false, "current input leaked to injector");
    assert.equal(messageText(captures[0]!.input).includes("[REDACTED]"), true, "current input was not redacted");
    assert.equal(messageText(captures[1]!.input).includes(secondSecret), false, "second input leaked to injector");
    assert.equal(messageText(captures[1]!.history).includes(firstSecret), false, "prior history leaked to injector");
    assert.equal(messageText(captures[1]!.history).includes("[REDACTED]"), true, "prior history was not redacted");
  });

  it("manual compact appends compaction entry and updates leaf", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("reply"), providerDone()]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, store }).createSession({ id: "s1" });

    await session.run("old");
    const previousLeaf = (await session.entries()).at(-1)!.id;
    const result = await session.compact({ keepRecentEntries: 1 });
    const entries = await session.entries();

    assert.equal(result.entries?.[0]?.kind, "compaction");
    assert.equal(result.entries?.[0]?.parentId, previousLeaf);
    assert.equal(entries.at(-1)?.kind, "compaction");
    assert.equal(entries.at(-1)?.id, result.entries?.[0]?.id);
  });

  it("auto compacts before provider input when threshold is exceeded", async () => {
    const requests: ProviderRequest[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      requests.push(request);
      yield providerTextDelta(`reply ${requests.length}`);
      yield providerDone();
    } };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, compaction: { thresholdEntries: 2, keepRecentEntries: 1 } });
    const session = agent.createSession({ id: "s1" });

    await session.run("old");
    await session.run("new");

    const text = requests[1]!.messages.flatMap((message) => message.content).map((block) => block.type === "text" ? block.text : "").join("\n");
    assert.equal(text.includes("Summary:"), true);
    assert.equal(requests[1]!.messages.filter((message) => message.role === "user").length, 1);
    assert.equal(text.includes("new"), true);
  });

  it("compaction events are emitted with redacted summary", async () => {
    const secret = "secret-value";
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider }).createSession({ id: "s1" });

    await session.run(`old ${secret}`);
    const eventsPromise = take(session.subscribe(), 2);
    await session.compact({ keepRecentEntries: 0, secrets: [secret] });
    const events = await eventsPromise;

    assert.deepEqual(events.map((event) => event.type), ["compaction_started", "compaction_finished"]);
    const finished = events[1];
    assert.equal(finished?.type === "compaction_finished" && finished.summary.includes(secret), false);
    assert.equal(finished?.type === "compaction_finished" && finished.summary.includes("[REDACTED]"), true);
  });

  it("compaction middleware can adjust summary payload", async () => {
    const middleware = createMiddlewareRegistry();
    middleware.use("compaction", (payload: { readonly result: { readonly summary: string } }, next) => next({ ...payload, result: { ...payload.result, summary: "middleware summary" } }));
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, middleware }).createSession({ id: "s1" });

    await session.run("old");
    const result = await session.compact();

    assert.equal(result.summary, "middleware summary");
    assert.equal((await session.entries()).at(-1)?.summary, "middleware summary");
  });

  it("run compaction false disables configured auto compaction", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) {
      request = input;
      yield providerDone();
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, compaction: { thresholdEntries: 0 } }).createSession({ id: "s1" });

    await session.run("Hi", { compaction: false });

    assert.equal(request.messages.some((message) => message.content.some((block) => block.type === "text" && block.text.includes("Summary:"))), false);
    assert.equal((await session.entries()).some((entry) => entry.kind === "compaction"), false);
  });

  it("compaction context excludes credentials and provider objects", async () => {
    let keys: string[] = [];
    const strategy = { name: "inspect", compact(context: object) { keys = Object.keys(context); return { summary: "ok" }; } };
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, credentials: { resolve: () => ({ type: "bearer", value: "secret" }) } }).createSession({ id: "s1" });

    await session.compact({ strategy });

    assert.equal(keys.includes("provider"), false);
    assert.equal(keys.includes("credentials"), false);
  });

  it("retries provider turn before output and emits retry_scheduled", async () => {
    let calls = 0;
    const provider: AIProvider = { id: "mock", async *generate() {
      calls += 1;
      if (calls === 1) yield { type: "error", error: { message: "busy", code: 503 } };
      else yield providerTextDelta("ok");
      yield providerDone();
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, retry: { baseDelayMs: 0, maxAttempts: 2 } }).createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.equal(calls, 2);
    assert.equal(events.some((event) => event.type === "retry_scheduled" && event.attempt === 1 && event.delayMs === 0), true);
    assert.equal(events.some((event) => event.type === "message_delta" && event.content.type === "text" && event.content.text === "ok"), true);
  });

  it("does not retry after observable output", async () => {
    let calls = 0;
    const provider: AIProvider = { id: "mock", async *generate() {
      calls += 1;
      yield providerTextDelta("partial");
      yield { type: "error", error: { message: "busy", code: 503 } };
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, retry: { baseDelayMs: 0, maxAttempts: 2 } }).createSession();
    const reader = collect(session.subscribe());

    await assert.rejects(session.run("Hi"), /busy/);
    const events = await reader;

    assert.equal(calls, 1);
    assert.equal(events.some((event) => event.type === "retry_scheduled"), false);
  });

  it("retry backoff honors abort signal", async () => {
    let calls = 0;
    const provider: AIProvider = { id: "mock", async *generate() {
      calls += 1;
      yield { type: "error", error: { message: "busy", code: 503 } };
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, retry: { baseDelayMs: 100, maxAttempts: 2 } }).createSession();
    const controller = new AbortController();
    const run = session.run("Hi", { signal: controller.signal });

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("cancelled"));

    await assert.rejects(run, /cancelled|aborted/i);
    assert.equal(calls, 1);
  });

  it("retry middleware can stop or adjust retry decision", async () => {
    let calls = 0;
    const middleware = createMiddlewareRegistry();
    middleware.use("retry", (payload: { readonly decision: { readonly retry: boolean; readonly delayMs?: number } }) => ({ ...payload, decision: { retry: false, delayMs: 0 } }));
    const provider: AIProvider = { id: "mock", async *generate() {
      calls += 1;
      yield { type: "error", error: { message: "busy", code: 503 } };
    } };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, middleware, retry: { baseDelayMs: 0, maxAttempts: 2 } }).createSession();

    await assert.rejects(session.run("Hi"), /busy/);
    assert.equal(calls, 1);
  });

  it("run inputLayout overrides agent inputLayout and reaches custom input builders", async () => {
    const layouts: unknown[] = [];
    const requests: ProviderRequest[] = [];
    const inputBuilder: InputBuilder = {
      name: "capture-layout",
      build(_input, context) {
        layouts.push(context?.inputLayout);
        return [{ role: "user", content: [{ type: "text", text: String(context?.inputLayout) }] }];
      },
    };
    const provider: AIProvider = { id: "mock", async *generate(input) { requests.push(input); yield providerDone(); } };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      inputBuilder,
      inputLayout: "cache_aware",
    }).createSession();

    await session.run("Hi");
    await session.run("Hi", { inputLayout: "legacy" });

    assert.deepEqual(layouts, ["cache_aware", "legacy"]);
    assert.equal(textOf(requests[0]?.messages[0]), "cache_aware");
    assert.equal(textOf(requests[1]?.messages[0]), "legacy");
  });

  it("provider request policy adds session cache options before provider generate", async () => {
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) {
      request = input;
      yield providerDone();
    } };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      providerRequestPolicies: createSessionCachePolicy({ retention: "long" }),
    }).createSession({ id: "cache-session" });

    await session.run("Hi");

    assert.equal(request.options?.sessionId, "cache-session");
    assert.equal(request.options?.cacheKey, "cache-session");
    assert.equal(request.options?.cacheRetention, "long");
    assert.equal(JSON.stringify(request.messages).includes("Hi"), true);
    assert.equal(request.options?.cacheKey?.includes("Hi"), false);
  });

  it("provider request middleware runs once after policy", async () => {
    const order: string[] = [];
    let request!: ProviderRequest;
    const middleware = createMiddlewareRegistry();
    middleware.use("provider_request", (input: ProviderRequest) => {
      order.push(`middleware:${input.options?.cacheRetention}`);
      return { ...input, metadata: { ...input.metadata, middleware: true } };
    });
    const provider: AIProvider = { id: "mock", async *generate(input) {
      request = input;
      yield providerDone();
    } };

    await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      middleware,
      providerRequestPolicies: { name: "mark", apply(context) { order.push("policy"); return { ...context.request, options: { ...context.request.options, cacheRetention: "short" } }; } },
    }).createSession().run("Hi");

    assert.deepEqual(order, ["policy", "middleware:short"]);
    assert.equal(request.metadata?.middleware, true);
  });

  it("usage supports cache read and write tokens", async () => {
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerUsage({ inputTokens: 10, cacheReadTokens: 4, cacheWriteTokens: 2 }), providerDone()]),
    }).createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi");

    const finished = (await reader).find((event) => event.type === "agent_finished");
    assert.equal(finished?.type === "agent_finished" ? finished.usage?.cacheReadTokens : undefined, 4);
    assert.equal(finished?.type === "agent_finished" ? finished.usage?.cacheWriteTokens : undefined, 2);
  });

  it("request policy redacts secret from provider errors", async () => {
    const secret = "policy-secret-value";
    const provider: AIProvider = { id: "mock", async *generate() { throw new Error(`bad ${secret}`); } };
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      providerRequestPolicies: { name: "secret", apply: ({ request }) => ({ request: { ...request, options: { ...request.options, headers: { authorization: secret } } }, secrets: [secret] }) },
    }).createSession();
    const reader = collect(session.subscribe());

    await assert.rejects(session.run("Hi"), /\[REDACTED\]/);

    const error = (await reader).find((event) => event.type === "error");
    assert.equal(error?.type === "error" ? error.error.message.includes(secret) : true, false);
  });

  it("provider request policy auth header overrides caller-supplied providerOptions headers", async () => {
    // Security: a caller (RunOptions.providerOptions.headers or AgentConfig headers) cannot
    // override provider auth. Provider-request policies run AFTER the providerOptions merge,
    // so a policy injecting Authorization from credentials wins over any caller header.
    let request!: ProviderRequest;
    const provider: AIProvider = { id: "mock", async *generate(input) { request = input; yield providerDone(); } };
    const providerKey = "provider-real-key";
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      // Caller tries to inject its own auth header via AgentConfig + per-run override.
      providerOptions: { headers: { authorization: "caller-evil" } },
      providerRequestPolicies: { name: "provider-auth", apply: ({ request: req }) => ({ request: { ...req, options: { ...req.options, headers: { ...req.options?.headers, authorization: providerKey } } }, secrets: [providerKey] }) },
    }).createSession();

    await session.run("Hi", { providerOptions: { headers: { authorization: "caller-evil-run" } } });

    assert.equal(request.options?.headers?.authorization, providerKey, "provider-policy auth must override caller-supplied headers");
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

  it("AgentConfig.validator blocks with validation_failed and skips execute", async () => {
    const executed: unknown[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
      else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi", forbidden: true }) };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (args, context) => { executed.push(args); return { toolCallId: context.toolCallId, name: "echo", value: "ok" }; } };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [echo],
      validator: (_tool, args) => args.forbidden ? "forbidden argument" : undefined,
      redactor: { redact: (value) => value },
    });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    const events = await reader;

    const blocked = events.find((event) => event.type === "tool_execution_blocked");
    assert.equal(blocked?.type === "tool_execution_blocked" && blocked.reason, "validation_failed");
    assert.equal(blocked?.type === "tool_execution_blocked" && blocked.error.message, "forbidden argument");
    assert.equal(events.some((event) => event.type === "tool_execution_started"), false);
    assert.equal(events.some((event) => event.type === "tool_execution_finished"), false);
    assert.equal(executed.length, 0);
  });

  it("AgentConfig.validator void return lets the tool execute normally", async () => {
    const executed: unknown[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
      else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (args, context) => { executed.push(args); return { toolCallId: context.toolCallId, name: "echo", value: "ok" }; } };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [echo],
      validator: () => undefined,
    });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    await reader;

    assert.equal(executed.length, 1);
  });

  it("RunOptions.validate overrides AgentConfig.validator per run", async () => {
    const executed: unknown[] = [];
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
      else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (args, context) => { executed.push(args); return { toolCallId: context.toolCallId, name: "echo", value: "ok" }; } };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [echo],
      validator: () => "agent-level block",
    });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1, validate: () => undefined });
    await reader;

    assert.equal(executed.length, 1);
  });

  it("no validator keeps existing dispatch behavior unchanged", async () => {
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
      else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }) };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo] }).createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    const events = await reader;

    assert.equal(events.some((event) => event.type === "tool_execution_blocked" && event.reason === "validation_failed"), false);
    assert.equal(events.some((event) => event.type === "tool_execution_finished"), true);
  });

  it("validator ErrorInfo return is redacted when secrets are configured", async () => {
    const secret = "leak-token";
    const provider: AIProvider = { id: "mock", async *generate(request) {
      if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
      else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
      yield providerDone();
    } };
    const echo: ToolDefinition = { name: "echo", execute: () => ({ toolCallId: "x", name: "echo", value: "ok" }) };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [echo],
      validator: () => ({ name: "ValidatorError", message: `errored on ${secret}` }),
      redactor: createSecretRedactor([secret]),
    });
    const session = agent.createSession();
    const reader = collect(session.subscribe());

    await session.run("Hi", { maxToolRounds: 1 });
    const events = await reader;

    const blocked = events.find((event) => event.type === "tool_execution_blocked");
    const msg = blocked?.type === "tool_execution_blocked" ? blocked.error.message : undefined;
    assert.equal(msg?.includes(secret), false);
    assert.equal(msg?.includes("[REDACTED]"), true);
  });
});
