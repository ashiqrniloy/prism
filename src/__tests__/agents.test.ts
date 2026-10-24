import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { RuntimeAgentSession } from "../agent-session/session.js";
import {
  type AgentDefinition,
  type AgentEvent,
  type ModelProvider,
  type CompactionContext,
  type ContentBlock,
  createAgent,
  createDefaultCompactor,
  createMemorySessionStore,
  registerContextSources,
  createSecretRedactor,
  DEFAULT_SNAPSHOT_CACHE_TTL_MS,
  getSessionBranchEntries,
  HARD_MAX_SNAPSHOT_CACHE_TTL_MS,
  type Message,
  type ProviderRequest,
  type Session,
  providerDone,
  providerTextDelta,
  providerToolCallDelta,
  providerUsage,
  type SessionEntry,
  type SessionStore,
  type ToolDefinition,
  toolCallContent,
  SubscriberOverflowError,
} from "../index.js";
import { applyThinkingLevelForModel } from "../provider-kit/index.js";
import { failedRun } from "./run-result-helpers.js";
import { mockProvider, createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function textOf(message: ProviderRequest["messages"][number] | undefined): string {
  return message?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
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
  it("rejects legacy RunOptions.maxToolRounds (removed 0.1.5 alias) before any side effects", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
      tools: {
        add: [
          {
            name: "echo",
            execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
          },
        ],
      },
    });
    const session = await agent.session({ id: "legacy-alias", create: true });

    await assert.rejects(
      // @ts-expect-error removed in 0.1.5; use RunOptions.limits.maxToolRounds instead (untyped-JS simulation)
      session.run("Hi", { maxToolRounds: 1 }),
      (err) =>
        err instanceof TypeError &&
        String(err.message).includes("RunOptions.maxToolRounds was removed in 0.1.5") &&
        String(err.message).includes("limits.maxToolRounds"),
    );

    // fail-closed: rejection happens before any session append or provider call (the guard is the
    // first statement of the run entry, so no events are emitted and no provider request is made)
    assert.deepEqual(await session.entries(), [], "legacy alias rejection must not append session entries");
  });

  it("streams mock provider text to subscriber", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
    });
    const session = await agent.session({ id: "s1", create: true });
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.deepEqual(
      events.map((event) => event.type),
      ["run.started", "turn.started", "message.delta", "turn.completed", "message.completed", "run.completed"],
    );
    const delta = events.find((event) => event.type === "message.delta");
    assert.equal(delta?.content.type, "text");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "Hello");
  });

  it("closes slow subscriber on bounded queue overflow", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("a"), providerTextDelta("b"), providerTextDelta("c"), providerDone()]])],
    });
    const session = await agent.session({ id: "overflow-session", create: true });
    const iterator = session.subscribe({ maxQueuedEvents: 2 })[Symbol.asyncIterator]();

    await session.run("Hi");

    await assert.rejects(
      () => iterator.next(),
      (error: unknown) => error instanceof SubscriberOverflowError && error.maxQueuedEvents === 2,
    );
  });

  it("drop_oldest subscriber overflow keeps the newest bounded events", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
    });
    const session = await agent.session({ id: "drop-oldest-session", create: true });
    const iterator = session.subscribe({ maxQueuedEvents: 2, overflow: "drop_oldest" })[Symbol.asyncIterator]();

    await session.run("Hi");
    const events: AgentEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }

    assert.deepEqual(
      events.map((event) => event.type),
      ["message.completed", "run.completed"],
    );
  });

  it("resolves the model's provider from a package", async () => {
    const own = createMockProvider([providerTextDelta("from-resolver"), providerDone()], { id: "own" });
    const agent = await createAgent({
      model: { provider: "own", model: "demo" },
      packages: [providerPackage("test-provider", [own])],
    });
    const session = await agent.session({ id: "s-resolve", create: true });
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    const delta = events.find((event) => event.type === "message.delta");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "from-resolver");
  });

  it("fails closed when no package registers the model's provider", async () => {
    const agent = await createAgent({
      model: { provider: "missing", model: "demo" },
    });
    const session = await agent.session({ id: "s-missing", create: true });
    const reader = collect(session.subscribe());

    await failedRun(session.run("Hi"), /Unknown provider: missing/);
    const events = await reader;
    assert.equal(
      events.some((event) => event.type === "run.failed"),
      true,
    );
  });

  it("RunOptions.model override routes through the provider registry with the new model", async () => {
    const a = createMockProvider([providerTextDelta("from-a"), providerDone()], { id: "a" });
    const agent = await createAgent({
      model: { provider: "a", model: "demo" },
      packages: [providerPackage("test-provider", [a])],
    });
    const session = await agent.session({ id: "s-model-override", create: true });
    const reader = collect(session.subscribe());

    await session.run("Hi", { model: { provider: "a", model: "other" } });
    const events = await reader;

    const delta = events.find((event) => event.type === "message.delta");
    assert.equal(delta?.content.type === "text" ? delta.content.text : undefined, "from-a");
  });

  it("agent.session() uses agent config", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi");

    assert.equal(
      (await reader).some((event) => event.type === "run.completed"),
      true,
    );
  });

  it("session prompt delegates to run for string input", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi");

    assert.equal(
      (await reader).some((event) => event.type === "message.delta"),
      true,
    );
  });

  it("missing provider fails closed and emits error", async () => {
    const agent = await createAgent({ model: { provider: "missing", model: "demo" } });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await failedRun(session.run("Hi"), /Unknown provider: missing/);

    const events = await reader;
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "run.failed");
    assert.equal(events[0]?.type === "run.failed" ? events[0].error.message : undefined, "Unknown provider: missing");
  });

  it("runs a disabled maxToolRounds (null) past the old default ceiling of 8 rounds", async () => {
    const requests: ProviderRequest[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        // 9 tool rounds, then a final text turn — one past the legacy default of 8.
        if (requests.length <= 9) yield { type: "tool_call", call: toolCallContent(`call_${requests.length}`, "echo", { text: "hi" }) };
        else yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    const result = await session.run("Hi", { limits: { maxToolRounds: null } });
    const events = await reader;

    assert.equal(result.status, "completed");
    assert.equal(requests.length, 10);
    assert.equal(events.filter((event) => event.type === "tool.completed").length, 9);
  });

  it("executes one registered tool and continues", async () => {
    const requests: ProviderRequest[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
        else yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    assert.equal(requests.length, 2);
    assert.equal(
      requests[1]?.messages.some((message) => message.role === "tool"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "tool.completed"),
      true,
    );
    const deltas = events.filter((event) => event.type === "message.delta");
    const lastDelta = deltas[deltas.length - 1];
    assert.equal(lastDelta?.type === "message.delta" && lastDelta.content.type === "text" ? lastDelta.content.text : undefined, "done");
  });

  it("runtime_reconstructs_tool_call_delta_executes_persists_and_replays", async () => {
    const requests: ProviderRequest[] = [];
    const entriesStore = createMemorySessionStore();
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          yield providerToolCallDelta({ index: 0, id: "call_1", name: "echo", argumentsText: '{"text":' });
          yield providerToolCallDelta({ index: 0, argumentsText: '"hi"}' });
        } else {
          yield providerTextDelta("done");
        }
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
      slots: { store: entriesStore },
    });
    const session = await agent.session({ id: "delta-session", create: true });
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    assert.equal(requests.length, 2);
    assert.ok(
      events.some(
        (event) => event.type === "message.delta" && event.content.type === "tool_call_delta" && event.content.argumentsText === '{"text":',
      ),
      "expected streamed tool_call_delta event",
    );
    assert.equal(events.filter((event) => event.type === "tool.completed").length, 1);
    const replay = requests[1]!;
    const assistant = replay.messages.find((message) => message.role === "assistant");
    assert.ok(assistant, "expected assistant message in replay");
    assert.ok(
      assistant.content.some(
        (block) => block.type === "tool_call" && block.id === "call_1" && block.name === "echo" && block.arguments.text === "hi",
      ),
      "expected reconstructed tool_call in assistant message",
    );
    const tool = replay.messages.find((message) => message.role === "tool");
    assert.ok(tool, "expected tool message in replay");
    assert.ok(
      tool.content.some((block) => block.type === "tool_result" && block.toolCallId === "call_1" && block.name === "echo"),
      "expected tool_result in tool message",
    );
    assert.ok(replay.messages.indexOf(assistant) < replay.messages.indexOf(tool), "assistant tool_call must precede tool_result");
    const persisted = await session.entries();
    assert.ok(
      persisted.some(
        (entry) =>
          entry.message?.role === "assistant" && entry.message.content.some((block) => block.type === "tool_call" && block.id === "call_1"),
      ),
      "expected persisted assistant tool_call",
    );
    assert.ok(
      persisted.some(
        (entry) =>
          entry.message?.role === "tool" &&
          entry.message.content.some((block) => block.type === "tool_result" && block.toolCallId === "call_1"),
      ),
      "expected persisted tool_result",
    );
    assert.equal(
      persisted.some((entry) => entry.message?.content.some((block) => block.type === "tool_call_delta")),
      false,
      "tool deltas are UI events, not persisted transcript blocks",
    );
  });

  it("malformed_streamed_tool_arguments_become_failed_tool_results", async () => {
    const requests: ProviderRequest[] = [];
    let executed = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          yield providerToolCallDelta({ index: 0, id: "c1", name: "echo", argumentsText: "{invalid" });
        } else {
          yield providerTextDelta("recovered");
        }
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (_args, context) => {
        executed += 1;
        return { toolCallId: context.toolCallId, name: "echo", value: "should-not-run" };
      },
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    const result = await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    assert.equal(result.status, "completed");
    assert.equal(result.text, "recovered");
    assert.equal(executed, 0, "tool must not execute on malformed arguments");
    assert.equal(
      events.some((event) => event.type === "tool.completed" && event.status === "blocked" && event.reason === "invalid_arguments"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "run.failed"),
      false,
      "must not surface as run-level transport error",
    );
    const tool = requests[1]?.messages.find((message) => message.role === "tool");
    assert.ok(
      tool?.content.some(
        (block) => block.type === "tool_result" && block.toolCallId === "c1" && block.error?.code === "invalid_json_arguments",
      ),
    );
  });

  it("incomplete_tool_call_deltas_fail_turn_with_typed_incomplete_delta", async () => {
    let executed = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield providerToolCallDelta({ index: 0, id: "c1", argumentsText: '{"a":1}' }); // missing name
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (_args, context) => {
        executed += 1;
        return { toolCallId: context.toolCallId, name: "echo", value: "should-not-run" };
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } })).session();

    {
      const outcome = await session.run("Hi");
      assert.equal(outcome.status, "failed");
      assert.equal(outcome.error?.code, "incomplete_delta");
      assert.match(outcome.error?.message ?? "", /Incomplete tool call delta/);
    }
    assert.equal(executed, 0);
  });

  it("mixed_complete_and_incomplete_deltas_fail_closed_without_executing", async () => {
    let executed = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield providerToolCallDelta({ index: 0, id: "ok", name: "echo", argumentsText: '{"text":"hi"}' });
        yield providerToolCallDelta({ index: 1, id: "bad", argumentsText: "{}" }); // missing name
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (_args, context) => {
        executed += 1;
        return { toolCallId: context.toolCallId, name: "echo", value: "nope" };
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } })).session();

    {
      const outcome = await session.run("Hi");
      assert.equal(outcome.error?.code, "incomplete_delta");
    }
    assert.equal(executed, 0, "complete sibling must not execute when an incomplete delta fails the turn");
  });

  it("runtime_replays_provider_tool_call_and_tool_result_before_final_response", async () => {
    const requests: ProviderRequest[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
        else yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    assert.equal(requests.length, 2);
    const replay = requests[1]!;
    const assistant = replay.messages.find((message) => message.role === "assistant");
    assert.ok(assistant, "expected assistant message in replay");
    assert.ok(
      assistant.content.some((block) => block.type === "tool_call" && block.id === "call_1" && block.name === "echo"),
      "expected tool_call in assistant message",
    );
    const tool = replay.messages.find((message) => message.role === "tool");
    assert.ok(tool, "expected tool message in replay");
    assert.ok(
      tool.content.some((block) => block.type === "tool_result" && block.toolCallId === "call_1" && block.name === "echo"),
      "expected tool_result in tool message",
    );
    assert.ok(replay.messages.indexOf(assistant) < replay.messages.indexOf(tool), "assistant tool_call must precede tool_result");
    const deltas = events.filter((event) => event.type === "message.delta");
    const lastDelta = deltas[deltas.length - 1];
    assert.equal(lastDelta?.type === "message.delta" && lastDelta.content.type === "text" ? lastDelta.content.text : undefined, "done");
  });

  it("runtime_tool_replay_preserves_tool_error_result", async () => {
    const requests: ProviderRequest[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) yield { type: "tool_call", call: toolCallContent("call_1", "boom") };
        else yield providerTextDelta("after error");
        yield providerDone();
      },
    };
    const boom: ToolDefinition = {
      name: "boom",
      execute: () => {
        throw new Error("tool failed");
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [boom] } })).session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
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
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield { type: "tool_call", call: toolCallContent("call_1", "missing") };
        yield providerDone();
      },
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.equal(
      events.some((event) => event.type === "tool.started"),
      false,
    );
    assert.equal(
      events.some((event) => event.type === "tool.completed" && event.status === "blocked"),
      true,
    );
  });

  it("stops at max tool rounds", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        yield { type: "tool_call", call: toolCallContent(`call_${calls}`, "echo") };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } });

    await (await agent.session()).run("Hi", { limits: { maxToolRounds: 1 } });

    assert.equal(calls, 2);
  });

  it("passes only host active tools to provider", async () => {
    const seen: string[][] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push((request.tools ?? []).map((tool) => tool.name));
        yield providerDone();
      },
    };
    const echo: ToolDefinition = { name: "echo", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo" }) };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
    });

    await (await agent.session()).run("Hi");

    assert.deepEqual(seen, [["echo"]]);

    // A skill that needs a tool the host never added fails the run closed before any provider call.
    const strict = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider-strict", [provider])],
      tools: { add: [echo] },
      skills: { add: [{ name: "wants-missing", toolNames: ["missing"], instructions: "Use missing." }] },
    });
    seen.length = 0;
    const failed = await (await strict.session()).run("Hi");
    assert.equal(failed.status, "failed");
    assert.match(failed.error?.message ?? "", /requires inactive tool: missing/);
    assert.deepEqual(seen, []);
  });

  it("abort stops before next provider turn", async () => {
    let turns = 0;
    let session!: Awaited<ReturnType<Awaited<ReturnType<typeof createAgent>>["session"]>>;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        turns += 1;
        yield { type: "tool_call", call: toolCallContent("call_1", "stop") };
        yield providerDone();
      },
    };
    const stop: ToolDefinition = {
      name: "stop",
      execute: (_args, context) => {
        session.abort(new Error("stop"));
        return { toolCallId: context.toolCallId, name: "stop" };
      },
    };
    const store = createMemorySessionStore();
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [stop] }, slots: { store } });
    session = await agent.session({ id: "s1", create: true });
    const reader = collect(session.subscribe());

    await failedRun(session.run("Hi"), /stop/, "aborted");
    await reader;

    assert.equal(turns, 1);
    assert.equal((await store.list("s1")).filter((entry) => entry.message?.role === "assistant").length, 1);
  });

  it("run options signal aborts provider request", async () => {
    let seenSignal!: AbortSignal;
    let seen!: () => void;
    const seenPromise = new Promise<void>((resolve) => {
      seen = resolve;
    });
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seenSignal = request.signal!;
        seen();
        await new Promise<void>((_resolve, reject) =>
          request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true }),
        );
      },
    };
    const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] });
    const controller = new AbortController();
    const run = (await agent.session()).run("Hi", { signal: controller.signal });

    await seenPromise;
    controller.abort(new Error("cancelled"));

    await failedRun(run, /cancelled/, "aborted");
    assert.equal(seenSignal.aborted, true);
  });

  it("rejects concurrent runs", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        await blocked;
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session();
    const first = session.run("one");

    await assert.rejects(session.run("two"), /active run/);
    release();
    await first;
  });

  it("steer without active run fails closed", async () => {
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [mockProvider([[providerDone()]])],
      })
    ).session();
    assert.throws(() => session.steer("later"), /no active run/);
  });

  it("steer between tool rounds injects user message before next provider turn", async () => {
    const requests: ProviderRequest[] = [];
    let toolStarted!: () => void;
    const toolGate = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    let releaseTool!: () => void;
    const toolHold = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: "tool_call", call: toolCallContent("call_1", "hold", {}) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("after-steer");
        yield providerDone();
      },
    };
    const tools: ToolDefinition[] = [
      {
        name: "hold",
        async execute() {
          toolStarted();
          await toolHold;
          return { toolCallId: "call_1", name: "hold", value: { ok: true } };
        },
      },
    ];
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: tools } })).session({
      id: "steer-turn",
      create: true,
    });
    const reader = collect(session.subscribe());
    const run = session.run("Hi", { limits: { maxToolRounds: 2 } });
    await toolGate;
    session.steer("Prefer SQLite");
    releaseTool();
    const result = await run;
    const events = await reader;
    assert.equal(result.status, "completed");
    assert.equal(result.runId, events.find((e) => e.type === "run.started")?.runId);
    assert.equal(requests.length, 2);
    const steered = requests[1]!.messages.some(
      (message) =>
        message.role === "user" && message.content.some((block) => block.type === "text" && block.text.includes("Prefer SQLite")),
    );
    assert.equal(steered, true);
    const entries = await session.entries();
    assert.equal(
      entries.some(
        (entry) =>
          entry.message?.role === "user" && entry.message.content.some((b) => b.type === "text" && b.text.includes("Prefer SQLite")),
      ),
      true,
    );
  });

  it("steer blocked mid-run is dropped with steer_rejected and the run continues", async () => {
    const requests: ProviderRequest[] = [];
    let toolStarted!: () => void;
    const toolGate = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    let releaseTool!: () => void;
    const toolHold = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: "tool_call", call: toolCallContent("call_1", "hold", {}) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const tools: ToolDefinition[] = [
      {
        name: "hold",
        async execute() {
          toolStarted();
          await toolHold;
          return { toolCallId: "call_1", name: "hold", value: { ok: true } };
        },
      },
    ];
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: { add: tools },
        hooks: (hooks) => {
          // `run.input` drops a steered message by returning fewer messages than it received.
          hooks.on("run.input", (messages) =>
            messages.some((m) => m.content.some((b) => b.type === "text" && b.text.includes("blocked-steer"))) ? [] : messages,
          );
        },
      })
    ).session({ id: "steer-blocked", create: true });
    const reader = collect(session.subscribe());
    // Run-start input passes the guardrail ("Hi" is clean), so the run starts.
    const run = session.run("Hi", { limits: { maxToolRounds: 2 } });
    await toolGate;
    session.steer("blocked-steer");
    releaseTool();
    const result = await run;
    const events = await reader;

    assert.equal(result.status, "completed");
    const rejected = events.find((e) => e.type === "package.event" && e.name === "steer.rejected");
    assert.ok(rejected && rejected.type === "package.event" && rejected.name === "steer.rejected");
    const rejectedRecord = (rejected.data as { record: { action: string; guardrail: string; stage: string } }).record;
    assert.equal(rejectedRecord.action, "block");
    assert.equal(rejectedRecord.guardrail, "run.input");
    assert.equal(rejectedRecord.stage, "input");
    // Dropped message never reaches the next provider turn or the session store.
    assert.equal(requests.length, 2);
    assert.equal(JSON.stringify(requests[1]!.messages).includes("blocked-steer"), false);
    const entries = await session.entries();
    assert.equal(JSON.stringify(entries).includes("blocked-steer"), false);
  });

  it("softInterrupt aborts provider stream then continues same runId", async () => {
    const requests: ProviderRequest[] = [];
    let firstSignal!: AbortSignal;
    let seenFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      seenFirst = resolve;
    });
    const provider: ModelProvider = {
      id: "blocking",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          firstSignal = request.signal!;
          yield providerTextDelta("working");
          seenFirst();
          while (!request.signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          throw request.signal!.reason;
        }
        yield providerTextDelta("steered-ok");
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "blocking", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session({
      id: "steer-soft",
      create: true,
    });
    const reader = collect(session.subscribe());
    const run = session.run("Hi");
    await firstReady;
    session.steer("Stop editing auth; fix tests first", { softInterrupt: true });
    const result = await run;
    const events = await reader;
    assert.equal(result.status, "completed");
    assert.equal(firstSignal.aborted, true);
    assert.equal(requests.length, 2);
    assert.equal(result.runId, events.find((e) => e.type === "run.started")?.runId);
    assert.equal(
      requests[1]!.messages.some(
        (message) =>
          message.role === "user" && message.content.some((block) => block.type === "text" && block.text.includes("fix tests first")),
      ),
      true,
    );
    assert.equal(
      events.some((e) => e.type === "message.delta" && e.content.type === "text" && e.content.text === "steered-ok"),
      true,
    );
  });

  it("steer_over_cap_fails_closed", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let seen!: () => void;
    const ready = new Promise<void>((resolve) => {
      seen = resolve;
    });
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen();
        await blocked;
        if (request.signal?.aborted) throw request.signal.reason;
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session();
    const run = session.run("one");
    await ready;
    for (let i = 0; i < 8; i += 1) session.steer(`msg-${i}`);
    assert.throws(() => session.steer("overflow"), /max pending messages/);
    release();
    await run;
  });

  it("emits error for provider error", async () => {
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield { type: "error", error: { name: "ProviderError", message: "provider failed" } };
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session();
    const reader = collect(session.subscribe());

    await failedRun(session.run("Hi"), /provider failed/);
    const events = await reader;

    assert.equal(
      events.some((event) => event.type === "run.failed" && event.error.message === "provider failed"),
      true,
    );
  });

  it("tool errors emit tool error events and continue", async () => {
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("after error");
        else yield { type: "tool_call", call: toolCallContent("call_1", "boom") };
        yield providerDone();
      },
    };
    const boom: ToolDefinition = {
      name: "boom",
      execute: () => {
        throw new Error("tool failed");
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [boom] } })).session();
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.equal(
      events.some((event) => event.type === "tool.completed" && event.status === "error" && event.error?.message === "tool failed"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "message.delta" && event.content.type === "text" && event.content.text === "after error"),
      true,
    );
  });

  it("composes context.build ahead of the transcript and rewrites input through run.input", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      metadata: { source: "agent" },
      hooks: (hooks) => {
        hooks.on("context.build", (draft) => ({
          ...draft,
          messages: [{ role: "system", content: [{ type: "text", text: "prompt" }] }, ...draft.messages],
        }));
        hooks.on("run.input", (messages) => [
          { role: "user", content: [{ type: "text", text: `input:${messages.length > 0 ? "rewritten" : "empty"}` }] },
        ]);
      },
    });

    const session = await agent.session({ metadata: { session: true } });
    await session.run("ignored", { metadata: { run: true } });

    const texts = request.messages.map((m) => (m.content[0]?.type === "text" ? m.content[0].text : undefined));
    assert.equal(texts[0], "prompt", "the context.build handler composes ahead of the transcript");
    assert.equal(texts.at(-1), "ignored", "the run input stays last");
    assert.equal(texts.filter((t) => t === "input:rewritten").length, 0, "turn 1 still sees the raw input");
    assert.deepEqual(request.metadata, { source: "agent", session: true, run: true });

    // `run.input` rewrites what the session persists, so the rewritten message reaches the provider
    // from the next turn on; a rejection still fails the run before the first provider request.
    await session.run("second");
    assert.ok(
      request.messages.some((message) => message.content.some((block) => block.type === "text" && block.text === "input:rewritten")),
    );
  });

  it("agent_config_instructions_preserves_existing_default_prompt_path", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], instructions: "Base" })).session()).run("Hi");

    assert.equal(textOf(request.messages[0]), "System instruction:\nBase");
  });

  it("run_system_prompt_override_can_disable_configured_layers", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          instructions: "Base",
          systemPrompt: { id: "app", source: "app", text: "App" },
        })
      ).session()
    ).run("Hi", { systemPrompt: false });

    assert.equal(textOf(request.messages[0]), "System instruction:\nBase");
    assert.equal(
      request.messages.some((message) => textOf(message).includes("App")),
      false,
    );
  });

  it("uses layered system prompts before provider generate", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          instructions: "Base",
          systemPrompt: [
            { id: "pkg", source: "package", text: "Package" },
            { id: "app", source: "app", mode: "replace", text: "App" },
          ],
        })
      ).session()
    ).run("Hi", { systemPrompt: { id: "run", source: "run", text: "Run" } });

    assert.equal(textOf(request.messages[0]), "System instruction:\nApp\n\nRun");
  });

  it("uses a context.build source and selected skills", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      skills: { add: [{ name: "brief", instructions: "Be brief." }] },
      hooks: (hooks) =>
        registerContextSources(hooks, [{ name: "ctx", contextBlocks: [{ title: "Runtime context", content: "selected context" }] }]),
    });

    await (await agent.session()).run("Hi");

    const text = request.messages
      .flatMap((message) => message.content)
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    assert.equal(text.includes("selected context"), true);
    assert.equal(text.includes("- brief:"), true);
  });

  it("plain-array AgentConfig.skills still activates all configured skills without overrides", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      skills: { add: [{ name: "brief", instructions: "Be brief." }] },
    });

    await (await agent.session()).run("Hi");

    const text = request.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    assert.equal(text.includes("- brief:"), true);
  });

  it("external agent definition can create runtime agent", async () => {
    const definition: AgentDefinition = {
      name: "demo",
      create: async () => await createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider([[providerDone()]])] }),
    };
    const agent = await definition.create!();
    const session = await agent.session({ id: "s1", create: true });

    await session.run("Hi");
    assert.equal(session.id, "s1");
  });

  it("persists user assistant and tool messages to store", async () => {
    const store = createMemorySessionStore();
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
        else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { ok: true }) };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
    };
    const session = await (
      await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] }, slots: { store } })
    ).session({ id: "s1", create: true });

    await session.run("Hi");

    assert.deepEqual(
      (await store.list("s1")).map((entry) => entry.kind),
      ["message", "message", "message", "message"],
    );
    assert.deepEqual(
      (await store.list("s1")).map((entry) => entry.message?.role),
      ["user", "assistant", "tool", "assistant"],
    );
  });

  it("resumes history from leaf and checkouts old leaves", async () => {
    const store = createMemorySessionStore();
    const seen: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(
          request.messages.map((message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join("")).join("|"),
        );
        yield providerTextDelta(`reply ${seen.length}`);
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })).session({
      id: "s1",
      create: true,
    });

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
      async append(entry) {
        stored.push(structuredClone(entry));
      },
      async list() {
        throw new Error("full scan");
      },
      async readBranchPath(query) {
        readCalls++;
        return {
          items: getSessionBranchEntries(
            stored.filter((entry) => entry.sessionId === query.sessionId),
            { leafId: query.leafId },
          ),
        };
      },
    };
    const seen: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        seen.push(request.messages.map(textOf).join("|"));
        yield providerTextDelta(`reply ${seen.length}`);
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })).session({
      id: "s1",
      create: true,
    });

    await session.run("first");
    await session.run("second");
    const entries = await session.entries();

    assert.ok(entries.length > 0, "reader returned the branch");
    assert.ok(readCalls >= 3, "readBranchPath was used for rebuilds and entries()");
    assert.equal(seen[1]?.includes("first"), true);
    assert.equal(seen[1]?.includes("reply 1"), true);
  });

  it("caches one stable leaf snapshot and invalidates after append and checkout", async () => {
    const memory = createMemorySessionStore();
    let reads = 0;
    const store: SessionStore = {
      append: memory.append.bind(memory),
      async list(sessionId) {
        reads += 1;
        return memory.list(sessionId);
      },
    };
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        slots: { store },
        compaction: { thresholdEntries: 100 },
      })
    ).session({ id: "cache", create: true });
    assert.equal(reads, 1, "opening by id reads the branch once, to resume or create");
    reads = 0;

    await session.run("first");
    assert.equal(reads, 2, "auto-compaction and provider assembly share the stable-leaf snapshot");
    const leaf = session.leafId;
    await session.checkout(leaf);
    assert.equal(reads, 3, "checkout invalidates the snapshot");
    await session.run("second");
    assert.equal(reads, 4, "successful append invalidates once; stable-leaf reads remain shared");
  });

  it("fork_at_entry_copies_branch_and_package_state", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone(), providerTextDelta("two"), providerDone()]);
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })).session({
      id: "s1",
      create: true,
    });

    await session.run("base");
    const entries = await session.entries();
    const firstAssistant = entries.find((entry) => entry.message?.role === "assistant")!;
    await session.run("later");

    const fork = await session.fork({ at: firstAssistant.id });
    assert.notEqual(fork.id, session.id, "a fork is a new session");
    const copied = await store.list(fork.id);
    assert.deepEqual(
      copied.map((entry) => entry.message?.role),
      ["user", "assistant"],
      "only the branch that ends at `at` is copied",
    );
    assert.ok(copied.every((entry) => entry.sessionId === fork.id));
    assert.deepEqual(
      copied.map((entry) => entry.id).filter((id) => entries.some((entry) => entry.id === id)),
      [],
      "copied entries get fresh ids",
    );
    assert.equal((await session.entries()).length, entries.length + 2, "the original is untouched");
    assert.equal((await fork.messages()).length, 2);
  });

  it("messages_returns_stored_branch_not_context_draft", async () => {
    const sentinel = "context-draft-sentinel";
    const requests: ProviderRequest[] = [];
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()], { onRequest: (request) => requests.push(request) });
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      hooks: (hooks) =>
        hooks.on("context.build", (draft) => ({
          ...draft,
          messages: [{ role: "system", content: [{ type: "text", text: sentinel }] }, ...draft.messages],
        })),
    });
    const session = await agent.session();
    await session.run("hello");

    assert.ok(JSON.stringify(requests[0]?.messages).includes(sentinel), "the provider saw the draft");
    const messages = await session.messages();
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(JSON.stringify(messages).includes(sentinel), false, "a context.build mutation stays out of messages()");
    // Mutating the returned array cannot change the session.
    (messages as Message[]).length = 0;
    assert.equal((await session.messages()).length, 2);
  });

  it("session_type_has_exactly_the_documented_members", async () => {
    type Documented =
      | "id"
      | "leafId"
      | "run"
      | "stream"
      | "steer"
      | "abort"
      | "messages"
      | "fork"
      | "compact"
      | "close"
      | "subscribe"
      | "entries"
      | "checkout"
      | "contextMeter"
      | "getLoadedSkillNames"
      | "restoreLoadedSkills"
      | "resume";
    type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const exact: Exactly<keyof Session, Documented> = true;
    assert.equal(exact, true);
    const session = (await (
      await createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider([[providerDone()]])] })
    ).session()) as unknown as Record<string, unknown>;
    assert.equal(session.prompt, undefined, "prompt was an alias for run and is deleted");
    assert.equal(session.clone, undefined, "clone folded into fork");
  });

  it("fork_without_at_forks_from_leaf", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })).session({
      id: "s1",
      create: true,
    });

    await session.run("base");
    const fork = await session.fork();

    assert.notEqual(fork.id, session.id);
    assert.deepEqual(
      (await store.list(fork.id)).map((entry) => entry.sessionId),
      [fork.id, fork.id],
    );
    assert.deepEqual(await fork.messages(), await session.messages());
    await assert.rejects(session.fork({ at: "no-such-entry" }));
  });

  it("model override appends model change entry", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerDone()]);

    await (
      await (
        await createAgent({ model: { provider: "mock", model: "default" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })
      ).session({ id: "s1", create: true })
    ).run("Hi", { model: { provider: "mock", model: "override" } });

    const model = (await store.list("s1")).find((entry) => entry.kind === "model_change");
    assert.equal(model?.model?.model, "override");
  });

  it("session.run returns RunResult with final assistant text and usage", async () => {
    const provider = createMockProvider([
      providerTextDelta("Hello"),
      providerTextDelta(" world"),
      providerUsage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 }),
      providerDone(),
    ]);
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session({
      id: "result-ok",
      create: true,
    });

    const result = await session.run("Hi");

    assert.equal(result.sessionId, "result-ok");
    assert.equal(typeof result.runId, "string");
    assert.equal(result.status, "completed");
    assert.equal(result.text, "Hello world");
    assert.ok(result.content.every((block) => block.type === "text"));
    assert.equal(result.content.map((block) => (block.type === "text" ? block.text : "")).join(""), "Hello world");
    assert.equal(result.usage?.totalTokens, 5);
    assert.equal(result.error, undefined);
    assert.ok(result.leafId);
  });

  it("failed_run_returns_result_with_error: failed and aborted runs return their result", async () => {
    const failingProvider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield { type: "error", error: { name: "ProviderError", message: "provider failed" } };
      },
    };
    const failing = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [failingProvider])],
      })
    ).session({ id: "result-fail", create: true });
    {
      const outcome = await failing.run("Hi");
      assert.equal(outcome.status, "failed");
      assert.equal(outcome.sessionId, "result-fail");
      assert.equal(outcome.error?.message, "provider failed");
      assert.match(outcome.error?.message ?? "", /provider failed/);
    }

    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
        });
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session({
      id: "result-abort",
      create: true,
    });
    const controller = new AbortController();
    const run = session.run("Hi", { signal: controller.signal });
    controller.abort(new Error("cancelled"));
    {
      const outcome = await run;
      assert.equal(outcome.status, "aborted");
      assert.equal(outcome.sessionId, "result-abort");
      assert.match(String(outcome.abortReason), /cancelled/);
    }
  });

  it("session.stream subscribes before the run and yields only owned-run events", async () => {
    const provider = createMockProvider([providerTextDelta("streamed"), providerDone()]);
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session({
      id: "stream-1",
      create: true,
    });

    const events: AgentEvent[] = [];
    for await (const event of session.stream("Hi")) events.push(event);

    assert.equal(events[0]?.type, "run.started");
    assert.equal(events.at(-1)?.type, "run.completed");
    const runIds = new Set(events.flatMap((event) => ("runId" in event && event.runId ? [event.runId] : [])));
    assert.equal(runIds.size, 1);
    assert.ok(events.some((event) => event.type === "message.delta" && event.content.type === "text" && event.content.text === "streamed"));
  });

  it("early stream consumer return aborts the owned run and releases the session", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        calls += 1;
        if (calls === 1) {
          yield providerTextDelta("partial");
          await new Promise<void>((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => reject(request.signal?.reason ?? new Error("aborted")), { once: true });
          });
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session({
      id: "stream-early",
      create: true,
    });

    for await (const event of session.stream("Hi")) {
      if (event.type === "message.delta") break;
    }

    const result = await session.run("again");
    assert.equal(calls, 2);
    assert.equal(result.text, "done");
  });

  it("store entries do not include provider credentials", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

    await (
      await (
        await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })
      ).session({ id: "s1", create: true })
    ).run("Hi");

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
      append: async (entry, options) => {
        seen.push(JSON.stringify(entry));
        return memory.append(entry, options);
      },
      list: (id) => memory.list(id),
    };
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          slots: { store },
          redactor: createSecretRedactor([secret]),
        })
      ).session({ id: "s1", create: true })
    ).run(`My token is ${secret}`);

    assert.equal(
      seen.some((s) => s.includes(secret)),
      false,
      "raw secret never reached store.append",
    );
    assert.equal(
      seen.some((s) => s.includes("[REDACTED]")),
      true,
      "secret was redacted before append",
    );
    assert.equal(JSON.stringify(await memory.list("s1")).includes(secret), false, "persisted store has no raw secret");
  });

  it("passes redacted current input and prior history to a run.input handler", async () => {
    const firstSecret = "input-secret-12345";
    const secondSecret = "next-secret-12345";
    const captures: Message[][] = [];
    // `run.input` sees this run's own input, already redacted; it never sees the history.
    const capture = (messages: readonly Message[]) => {
      captures.push([...messages]);
      return undefined;
    };
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield providerDone();
      },
    };
    const redactor = createSecretRedactor([firstSecret, secondSecret]);
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        redactor,
        hooks: (hooks) => hooks.on("run.input", capture, { id: "capture" }),
      })
    ).session();

    await session.run(`first ${firstSecret}`);
    await session.run(`second ${secondSecret}`);
    const stored = JSON.stringify(await session.entries());

    assert.equal(stored.includes(firstSecret), false, "persisted entries kept raw first secret");
    assert.equal(stored.includes(secondSecret), false, "persisted entries kept raw second secret");
    assert.equal(stored.includes("[REDACTED]"), true, "persisted entries were not redacted");
    assert.equal(messageText(captures[0]!).includes(firstSecret), false, "current input leaked to the handler");
    assert.equal(messageText(captures[0]!).includes("[REDACTED]"), true, "current input was not redacted");
    assert.equal(messageText(captures[1]!).includes(secondSecret), false, "second input leaked to the handler");
    assert.equal(messageText(captures[1]!).includes(firstSecret), false, "prior run text leaked into the second input");
  });

  it("manual compact appends compaction entry and updates leaf", async () => {
    const store = createMemorySessionStore();
    const provider = createMockProvider([providerTextDelta("reply"), providerDone()]);
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], slots: { store } })).session({
      id: "s1",
      create: true,
    });

    await session.run("old");
    const previousLeaf = (await session.entries()).at(-1)!.id;
    const result = await session.compact({ keepRecentEntries: 1 });
    const entries = await session.entries();

    assert.equal(result.entries?.[0]?.kind, "compaction");
    assert.equal(result.entries?.[0]?.parentId, previousLeaf);
    assert.equal(entries.at(-1)?.kind, "compaction");
    assert.equal(entries.at(-1)?.id, result.entries?.[0]?.id);
  });

  it("auto-compaction dedupes trailing input even when the store reorders message keys", async () => {
    // A store whose serialization normalizes key order must not defeat trailing-input dedupe.
    const requests: ProviderRequest[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        yield providerTextDelta(`reply ${requests.length}`);
        yield providerDone();
      },
    };
    const memory = createMemorySessionStore();
    const store = {
      ...memory,
      append: (entry: Parameters<typeof memory.append>[0], context: Parameters<typeof memory.append>[1]) =>
        memory.append(
          entry.message
            ? {
                ...entry,
                message: Object.fromEntries(Object.entries(entry.message).reverse()) as typeof entry.message,
              }
            : entry,
          context,
        ),
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      slots: { store },
      compaction: { thresholdEntries: 2, keepRecentEntries: 1 },
    });
    const session = await agent.session({ id: "s1", create: true });

    await session.run("old");
    await session.run("new");

    assert.equal(
      requests[1]!.messages.filter((message) => message.role === "user").length,
      1,
      "reordered keys must not duplicate the trailing input after auto-compaction",
    );
  });

  it("auto compacts before provider input when threshold is exceeded", async () => {
    const requests: ProviderRequest[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        yield providerTextDelta(`reply ${requests.length}`);
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      compaction: { thresholdEntries: 2, keepRecentEntries: 1 },
    });
    const session = await agent.session({ id: "s1", create: true });

    await session.run("old");
    await session.run("new");

    const text = requests[1]!.messages
      .flatMap((message) => message.content)
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    assert.equal(text.includes("Summary:"), true);
    assert.equal(requests[1]!.messages.filter((message) => message.role === "user").length, 1);
    assert.equal(text.includes("new"), true);
  });

  it("compaction events are emitted with redacted summary", async () => {
    const secret = "secret-value";
    const provider = createMockProvider([providerDone()]);
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session({ id: "s1", create: true });

    await session.run(`old ${secret}`);
    const eventsPromise = take(session.subscribe(), 2);
    await session.compact({ keepRecentEntries: 0, secrets: [secret] });
    const events = await eventsPromise;

    assert.deepEqual(
      events.map((event) => event.type),
      ["compaction.started", "compaction.completed"],
    );
    const finished = events[1];
    assert.equal(finished?.type === "compaction.completed" && finished.summary?.includes(secret), false);
    assert.equal(finished?.type === "compaction.completed" && finished.summary?.includes("[REDACTED]"), true);
  });

  it("the compaction slot decides the summary that is written", async () => {
    const compactor = {
      name: "fixed-summary",
      async compact(context: CompactionContext) {
        const inner = await createDefaultCompactor().compact(context);
        return { ...inner, summary: "slot summary", entries: inner.entries?.map((entry) => ({ ...entry, summary: "slot summary" })) };
      },
    };
    const provider = createMockProvider([providerDone()]);
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        slots: { compaction: compactor },
      })
    ).session();

    await session.run("old");
    const result = await session.compact();

    assert.equal(result.summary, "slot summary");
    assert.equal((await session.entries()).at(-1)?.summary, "slot summary");
  });

  it("run compaction false disables configured auto compaction", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        compaction: { thresholdEntries: 0 },
      })
    ).session({ id: "s1", create: true });

    await session.run("Hi", { compaction: false });

    assert.equal(
      request.messages.some((message) => message.content.some((block) => block.type === "text" && block.text.includes("Summary:"))),
      false,
    );
    assert.equal(
      (await session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
  });

  it("compaction context excludes credentials and provider objects", async () => {
    let keys: string[] = [];
    const strategy = {
      name: "inspect",
      compact(context: object) {
        keys = Object.keys(context);
        return { summary: "ok" };
      },
    };
    const provider = createMockProvider([providerDone()]);
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        slots: { compaction: strategy },
      })
    ).session({ id: "s1", create: true });

    await session.compact();

    assert.equal(keys.includes("provider"), false);
    assert.equal(keys.includes("credentials"), false);
  });

  it("retries provider turn before output and emits retry_scheduled", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        if (calls === 1) yield { type: "error", error: { message: "busy", code: 503 } };
        else yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        retry: { baseDelayMs: 0, maxAttempts: 2 },
      })
    ).session();
    const reader = collect(session.subscribe());

    await session.run("Hi");
    const events = await reader;

    assert.equal(calls, 2);
    assert.equal(
      events.some((event) => event.type === "turn.started" && event.attempt === 1 && event.retry?.delayMs === 0),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "message.delta" && event.content.type === "text" && event.content.text === "ok"),
      true,
    );
  });

  it("does not retry after observable output", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        yield providerTextDelta("partial");
        yield { type: "error", error: { message: "busy", code: 503 } };
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        retry: { baseDelayMs: 0, maxAttempts: 2 },
      })
    ).session();
    const reader = collect(session.subscribe());

    await failedRun(session.run("Hi"), /busy/);
    const events = await reader;

    assert.equal(calls, 1);
    assert.equal(
      events.some((event) => event.type === "turn.started" && event.retry !== undefined),
      false,
    );
  });

  it("retry backoff honors abort signal", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        yield { type: "error", error: { message: "busy", code: 503 } };
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        retry: { baseDelayMs: 100, maxAttempts: 2 },
      })
    ).session();
    const controller = new AbortController();
    const run = session.run("Hi", { signal: controller.signal });

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("cancelled"));

    await failedRun(run, /cancelled|aborted/i, "aborted");
    assert.equal(calls, 1);
  });

  it("a model.request transform adds session cache options before provider generate", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        hooks: (hooks) => {
          hooks.on("model.request", (req) => ({
            request: { ...req, options: { ...req.options, cacheRetention: "long" } },
          }));
        },
      })
    ).session({ id: "cache-session", create: true });

    await session.run("Hi");

    assert.equal(request.options?.sessionId, "cache-session");
    assert.equal(request.options?.cacheKey, "cache-session");
    assert.equal(request.options?.cacheRetention, "long");
    assert.equal(JSON.stringify(request.messages).includes("Hi"), true);
    assert.equal(request.options?.cacheKey?.includes("Hi"), false);
  });

  it("no provider request policies still stamps sessionId and cacheKey", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
      })
    ).session({ id: "s1", create: true });

    await session.run("Hi");

    assert.equal(request.options?.sessionId, session.id);
    assert.equal(request.options?.cacheKey, session.id);
  });

  it("cache_control model gets default breakpoints and short retention without policies", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo", cache: { kind: "cache_control" } },
          packages: [providerPackage("test-provider", [provider])],
        })
      ).session({ id: "s1", create: true })
    ).run("Hi");

    assert.equal(request.options?.sessionId, "s1");
    assert.equal(request.options?.cacheRetention, "short");
    assert.deepEqual(request.options?.cache?.breakpoints, [{ location: "system_prompt" }, { location: "last_message" }]);
  });

  it("host providerOptions.sessionId wins over kernel session id", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          providerOptions: { sessionId: "custom" },
        })
      ).session({ id: "s1", create: true })
    ).run("Hi");

    assert.equal(request.options?.sessionId, "custom");
    assert.equal(request.options?.cacheKey, "custom");
  });

  it("agent thinkingLevel stamps the same compat as applyThinkingLevelForModel", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "openai",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const model = { provider: "openai", model: "gpt" };
    await (await (await await createAgent({ model, packages: [providerPackage("test-provider", [provider])], thinkingLevel: "low" })).session()).run("Hi");
    assert.deepEqual(request.options?.compat, applyThinkingLevelForModel(undefined, "low", model).compat);
  });

  it("run thinkingLevel overrides agent thinkingLevel", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "openai",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const model = { provider: "openai", model: "gpt" };
    await (await (await await createAgent({ model, packages: [providerPackage("test-provider", [provider])], thinkingLevel: "low" })).session()).run("Hi", { thinkingLevel: "high" });
    assert.deepEqual(request.options?.compat, applyThinkingLevelForModel(undefined, "high", model).compat);
  });

  it("omitted thinkingLevel invents no thinking compat on a noop model", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] })).session()).run("Hi");
    assert.equal(request.options?.compat, undefined);
  });

  it("thinkingLevel snaps to the catalog model declared set", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "openai",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const model = {
      provider: "openai",
      model: "gpt",
      capabilities: { reasoning: true, thinkingLevels: ["low", "medium", "high"] as const },
    };
    await (await (await await createAgent({ model, packages: [providerPackage("test-provider", [provider])], thinkingLevel: "max" })).session()).run("Hi");
    assert.equal((request.options?.compat?.reasoning as { effort?: string } | undefined)?.effort, "high");
  });

  it("thinkingLevel wins over stale agent providerOptions compat", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "openai",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "openai", model: "gpt" },
          packages: [providerPackage("test-provider", [provider])],
          thinkingLevel: "low",
          providerOptions: { compat: { reasoning: { effort: "high", summary: "auto" } } },
        })
      ).session()
    ).run("Hi");
    assert.deepEqual(request.options?.compat?.reasoning, { effort: "low", summary: "auto" });
  });

  it("a model.request transform still sets cacheKey and retention over the stamped defaults", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          hooks: (hooks) => {
            hooks.on("model.request", (req) => ({
              request: { ...req, options: { ...req.options, cacheKey: "custom", cacheRetention: "long" } },
            }));
          },
        })
      ).session({ id: "s1", create: true })
    ).run("Hi");

    assert.equal(request.options?.sessionId, "s1");
    assert.equal(request.options?.cacheKey, "custom");
    assert.equal(request.options?.cacheRetention, "long");
  });

  it("model.request transforms run in registration order", async () => {
    const order: string[] = [];
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };

    await (
      await (
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [provider])],
          hooks: (hooks) => {
            hooks.on("model.request", (req) => {
              order.push("first");
              return { ...req, options: { ...req.options, cacheRetention: "short" } };
            });
            hooks.on("model.request", (req) => {
              order.push(`second:${req.options?.cacheRetention}`);
              return { request: { ...req, metadata: { ...req.metadata, middleware: true } } };
            });
          },
        })
      ).session()
    ).run("Hi");

    assert.deepEqual(order, ["first", "second:short"]);
    assert.equal(request.metadata?.middleware, true);
  });

  it("usage carries provider-reported cache fields into finish metadata", async () => {
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [mockProvider([[providerUsage({ inputTokens: 10, cacheReadTokens: 4, cacheWriteTokens: 2 }), providerDone()]])],
      })
    ).session();
    const reader = collect(session.subscribe());

    await session.run("Hi");

    const events = await reader;
    const finished = events.find((event) => event.type === "run.completed");
    const providerTurn = events.find((event) => event.type === "turn.completed");
    assert.equal(finished?.type === "run.completed" ? finished.usage?.cacheReadTokens : undefined, 4);
    assert.equal(finished?.type === "run.completed" ? finished.usage?.cacheWriteTokens : undefined, 2);
    assert.deepEqual(providerTurn?.type === "turn.completed" ? providerTurn.metadata?.cache : undefined, {
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
      hitRate: 0.4,
    });
  });

  it("request policy redacts secret from provider errors", async () => {
    const secret = "policy-secret-value";
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        throw new Error(`bad ${secret}`);
      },
    };
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        hooks: (hooks) => {
          hooks.on("model.request", (request) => ({
            request: { ...request, options: { ...request.options, headers: { authorization: secret } } },
            secrets: [secret],
          }));
        },
      })
    ).session();
    const reader = collect(session.subscribe());

    await failedRun(session.run("Hi"), /\[REDACTED\]/);

    const error = (await reader).find((event) => event.type === "run.failed");
    assert.equal(error?.type === "run.failed" ? error.error.message.includes(secret) : true, false);
  });

  it("provider request policy auth header overrides caller-supplied providerOptions headers", async () => {
    // Security: a caller (RunOptions.providerOptions.headers or AgentConfig headers) cannot
    // override provider auth. Provider-request policies run AFTER the providerOptions merge,
    // so a policy injecting Authorization from credentials wins over any caller header.
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const providerKey = "provider-real-key";
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        // Caller tries to inject its own auth header via AgentConfig + per-run override.
        providerOptions: { headers: { authorization: "caller-evil" } },
        hooks: (hooks) => {
          hooks.on("model.request", (req) => ({
            request: { ...req, options: { ...req.options, headers: { ...req.options?.headers, authorization: providerKey } } },
            secrets: [providerKey],
          }));
        },
      })
    ).session();

    await session.run("Hi", { providerOptions: { headers: { authorization: "caller-evil-run" } } });

    assert.equal(request.options?.headers?.authorization, providerKey, "provider-policy auth must override caller-supplied headers");
  });

  it("run model override changes provider request model", async () => {
    let request!: ProviderRequest;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield providerDone();
      },
    };
    const agent = await createAgent({ model: { provider: "mock", model: "default" }, packages: [providerPackage("test-provider", [provider])] });

    await (await agent.session()).run("Hi", { model: { provider: "mock", model: "override" } });

    assert.equal(request.model.model, "override");
  });

  it("AgentConfig.validator blocks with validation_failed and skips execute", async () => {
    const executed: unknown[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
        else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi", forbidden: true }) };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => {
        executed.push(args);
        return { toolCallId: context.toolCallId, name: "echo", value: "ok" };
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
      validator: (_tool, args) => (args.forbidden ? "forbidden argument" : undefined),
      redactor: { redact: (value) => value },
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    const blocked = events.find((event) => event.type === "tool.completed" && event.status === "blocked");
    assert.equal(blocked?.type === "tool.completed" ? blocked.reason : undefined, "validation_failed");
    assert.equal(blocked?.type === "tool.completed" ? blocked.error?.message : undefined, "forbidden argument");
    assert.equal(
      events.some((event) => event.type === "tool.started"),
      false,
    );
    assert.equal(
      events.some((event) => event.type === "tool.completed" && event.status === "finished"),
      false,
      "a blocked call must never settle as finished",
    );
    assert.equal(executed.length, 0);
  });

  it("AgentConfig.validator void return lets the tool execute normally", async () => {
    const executed: unknown[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
        else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => {
        executed.push(args);
        return { toolCallId: context.toolCallId, name: "echo", value: "ok" };
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
      validator: () => undefined,
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    await reader;

    assert.equal(executed.length, 1);
  });

  it("RunOptions.validate overrides AgentConfig.validator per run", async () => {
    const executed: unknown[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
        else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (args, context) => {
        executed.push(args);
        return { toolCallId: context.toolCallId, name: "echo", value: "ok" };
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
      validator: () => "agent-level block",
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 }, validate: () => undefined });
    await reader;

    assert.equal(executed.length, 1);
  });

  it("no validator keeps existing dispatch behavior unchanged", async () => {
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
        else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])], tools: { add: [echo] } })).session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    assert.equal(
      events.some((event) => event.type === "tool.completed" && event.status === "blocked" && event.reason === "validation_failed"),
      false,
    );
    assert.equal(
      events.some((event) => event.type === "tool.completed"),
      true,
    );
  });

  it("validator ErrorInfo return is redacted when secrets are configured", async () => {
    const secret = "leak-token";
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) yield providerTextDelta("done");
        else yield { type: "tool_call", call: toolCallContent("call_1", "echo", { text: "hi" }) };
        yield providerDone();
      },
    };
    const echo: ToolDefinition = { name: "echo", execute: () => ({ toolCallId: "x", name: "echo", value: "ok" }) };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
      validator: () => ({ name: "ValidatorError", message: `errored on ${secret}` }),
      redactor: createSecretRedactor([secret]),
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());

    await session.run("Hi", { limits: { maxToolRounds: 1 } });
    const events = await reader;

    const blocked = events.find((event) => event.type === "tool.completed" && event.status === "blocked");
    const msg = blocked?.type === "tool.completed" ? blocked.error?.message : undefined;
    assert.equal(msg?.includes(secret), false);
    assert.equal(msg?.includes("[REDACTED]"), true);
  });

  it("session snapshot cache TTL is host-tunable and defaults to the 1000ms contract value", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
    });
    // Counting store: every snapshot cache miss lands as one list() read.
    const reads = (): { store: SessionStore; count: () => number } => {
      const inner = createMemorySessionStore([
        { id: "e1", sessionId: "ttl", timestamp: "2026-01-01T00:00:00.000Z", kind: "label", label: "one" },
      ]);
      let count = 0;
      const readBranchPath = inner.readBranchPath;
      if (readBranchPath === undefined) throw new Error("memory store missing readBranchPath");
      return {
        store: {
          ...inner,
          async list(sessionId) {
            count += 1;
            return inner.list(sessionId);
          },
          async readBranchPath(query) {
            count += 1;
            return readBranchPath(query);
          },
        },
        count: () => count,
      };
    };

    assert.equal(DEFAULT_SNAPSHOT_CACHE_TTL_MS, 1_000);
    assert.equal(HARD_MAX_SNAPSHOT_CACHE_TTL_MS, 30_000);

    const defaultTtl = reads();
    const cached = new RuntimeAgentSession({ agent, id: "ttl", store: defaultTtl.store });
    await cached.snapshot();
    await cached.snapshot();
    assert.equal(defaultTtl.count(), 1, "default TTL reuses the cached snapshot");

    // TTL 0 disables the cache: every read rebuilds from the store (byte-identical values).
    const disabled = reads();
    const uncached = new RuntimeAgentSession({ agent, id: "ttl", store: disabled.store, snapshotCacheTtlMs: 0 });
    const first = await uncached.snapshot();
    const second = await uncached.snapshot();
    assert.equal(disabled.count(), 2, "snapshotCacheTtlMs: 0 disables reuse");
    assert.deepEqual(second, first);

    // A raised TTL keeps one read; bounded by the hard cap and fail-closed below 0.
    const raised = reads();
    const longTtl = new RuntimeAgentSession({ agent, id: "ttl", store: raised.store, snapshotCacheTtlMs: HARD_MAX_SNAPSHOT_CACHE_TTL_MS });
    await longTtl.snapshot();
    await longTtl.snapshot();
    assert.equal(raised.count(), 1);
    for (const bad of [-1, 1.5, Number.NaN, HARD_MAX_SNAPSHOT_CACHE_TTL_MS + 1]) {
      assert.throws(() => new RuntimeAgentSession({ agent, id: "ttl", store: reads().store, snapshotCacheTtlMs: bad }), TypeError);
    }
  });

  it("agent_config_provider_and_provider_source_are_rejected", async () => {
    const provider = createMockProvider([providerDone()]);
    for (const field of ["provider", "providerSource"] as const) {
      const config = { model: { provider: "mock", model: "demo" }, [field]: field === "provider" ? provider : () => provider };
      await assert.rejects(
        createAgent(config as never),
        (error: unknown) => error instanceof TypeError && /packages/.test(error.message) && /providers\.register/.test(error.message) && !error.message.includes("demo"),
      );
    }
  });
});
