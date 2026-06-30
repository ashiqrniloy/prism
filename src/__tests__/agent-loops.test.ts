import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  redactAgentEvent,
  toolCallContent,
  type AgentEvent,
  type AIProvider,
  type LoopContext,
  type Message,
  type ProviderRequest,
  type ProviderTurnResult,
  type ToolDefinition,
  type Usage,
  type ArtifactValidation,
} from "../index.js";
import { generateValidateReviseLoop, singleShotLoop } from "../agent-loops.js";
import type { AgentInput } from "../input.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function stubCtx(overrides: Partial<LoopContext> & { generate: LoopContext["generate"] }): LoopContext {
  const events: AgentEvent[] = [];
  return {
    sessionId: "s",
    runId: "r",
    metadata: {},
    signal: new AbortController().signal,
    history: [],
    input: "Hi",
    inputMessages: [],
    maxToolRounds: 1,
    assemble: async () => ({ model: { provider: "mock", model: "demo" }, messages: [] }) as ProviderRequest,
    dispatchToolCall: async () => { throw new Error("no tools"); },
    appendMessage: async () => {},
    emit: (event) => events.push(event),
    ...overrides,
  };
}

describe("agent loop strategies", () => {
  describe("singleShotLoop (direct, stub LoopContext)", () => {
    it("emits turn_started/message_finished/turn_finished and stops on zero calls", async () => {
      const events: AgentEvent[] = [];
      const ctx = stubCtx({
        input: "Hi",
        generate: async () => ({ content: [{ type: "text", text: "ok" }], calls: [], messageId: "m1", started: true }) as ProviderTurnResult,
        emit: (event) => events.push(event),
      });
      const usage = await singleShotLoop.run(ctx);
      assert.deepEqual(events.map((event) => event.type), ["turn_started", "message_finished", "turn_finished"]);
      assert.equal(usage, undefined);
      assert.equal(ctx.history.length, 1);
      assert.equal(ctx.history[0]?.role, "assistant");
    });

    it("respects maxToolRounds and dispatches tools, then stops", async () => {
      const events: AgentEvent[] = [];
      const toolResults: { toolCallId: string; name: string; value?: unknown }[] = [];
      let generateCalls = 0;
      const ctx = stubCtx({
        input: "Hi",
        maxToolRounds: 1,
        generate: async () => {
          generateCalls += 1;
          if (generateCalls === 1) return { content: [{ type: "text", text: "calling" }], calls: [toolCallContent("c1", "echo", { text: "hi" })], messageId: "m1", started: true };
          return { content: [{ type: "text", text: "done" }], calls: [], messageId: "m2", started: true };
        },
        dispatchToolCall: async (call) => {
          const result = { toolCallId: call.id, name: call.name, value: call.arguments };
          toolResults.push(result);
          return result;
        },
        emit: (event) => events.push(event),
      });
      await singleShotLoop.run(ctx);
      assert.equal(generateCalls, 2);
      assert.equal(toolResults.length, 1);
      assert.equal(toolResults[0]?.name, "echo");
      // tool results accumulate in the loop-local array passed to assemble
      // (appendMessage is store-only; tool messages are not pushed to history)
      assert.equal(ctx.history.filter((message) => message.role === "assistant").length, 2);
    });
  });

  describe("singleShotLoop end-to-end via RuntimeAgentSession", () => {
    it("default loop (no loop configured) is bit-for-bit single-shot", async () => {
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
      });
      const session = agent.createSession({ id: "s1" });
      const reader = collect(session.subscribe());
      await session.run("Hi");
      const events = await reader;
      assert.deepEqual(events.map((event) => event.type), [
        "agent_started", "turn_started", "message_started",
        "message_delta", "message_finished", "turn_finished", "agent_finished",
      ]);
    });

    it("RunOptions.loop overrides AgentConfig.loop", async () => {
      const requests: ProviderRequest[] = [];
      const provider: AIProvider = { id: "mock", async *generate(request) { requests.push(request); yield providerTextDelta("x"); yield providerDone(); } };
      const echo: ToolDefinition = { name: "echo", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ignored" }) };
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider,
        tools: [echo],
        // config pins single-shot explicitly; run opts into a different (object literal) strategy
        loop: { strategy: "single-shot" },
      });
      const session = agent.createSession();
      const reader = collect(session.subscribe());
      let ran = "init";
      await session.run("Hi", {
        maxToolRounds: 1,
        loop: { name: "counter", async run() { ran = "custom"; return undefined; } } as never,
      });
      await reader;
      assert.equal(ran, "custom");
    });

    it("loop: { strategy: 'single-shot' } behaves as default", async () => {
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("Hi"), providerDone()]),
      });
      const session = agent.createSession();
      const reader = collect(session.subscribe());
      await session.run("Hi", { loop: { strategy: "single-shot" } });
      const events = await reader;
      assert.equal(events.some((event) => event.type === "turn_finished"), true);
      assert.equal(events.some((event) => event.type === "agent_finished"), true);
    });
  });

  describe("generateValidateReviseLoop (direct, stub LoopContext)", () => {
    function reviseCtx(opts: {
      generateTexts: readonly string[];
      validator: (value: unknown) => { ok: boolean; errors?: { message: string }[] };
    }): { ctx: LoopContext; assistantTexts: string[]; appendedMessages: Message[] } {
      let generateCalls = 0;
      const assistantTexts: string[] = [];
      const appendedMessages: Message[] = [];
      const ctx = stubCtx({
        input: "build a thing",
        generate: async () => {
          const text = opts.generateTexts[generateCalls] ?? "fallback";
          generateCalls += 1;
          return { content: [{ type: "text", text }], calls: [], messageId: `m${generateCalls}`, started: true };
        },
        appendMessage: async (message) => { appendedMessages.push(message); },
        emit: () => {},
      });
      // patch generate to record the text it produced
      const orig = ctx.generate;
      ctx.generate = async (request) => {
        const result = await orig(request);
        const produced = result.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("");
        assistantTexts.push(produced);
        return result;
      };
      // intercept validator via parser default (value = text)
      (ctx as { validator?: unknown }).validator = opts.validator;
      return { ctx, assistantTexts, appendedMessages };
    }

    it("fails twice then passes: loops 3 turns, appends 2 repair messages, returns final usage", async () => {
      const { ctx, assistantTexts, appendedMessages } = reviseCtx({
        generateTexts: ["draft1", "draft2", "draft3"],
        validator: (value) => value === "draft3" ? { ok: true } : { ok: false, errors: [{ message: "not draft3" }] },
      });
      const loop = generateValidateReviseLoop({
        validator: (value) => (value === "draft3" ? { ok: true } : { ok: false, errors: [{ message: "not draft3" }] }),
        maxRevisions: 3,
      });
      const usage = await loop.run(ctx);
      assert.equal(assistantTexts.length, 3);
      assert.deepEqual(assistantTexts, ["draft1", "draft2", "draft3"]);
      // appendedMessages: assistant + repair + assistant + repair + assistant = 5
      assert.equal(appendedMessages.length, 5);
      const repairs = appendedMessages.filter((message) => message.role === "user");
      assert.equal(repairs.length, 2);
      assert.equal(repairs[0]?.content[0]?.type === "text" ? repairs[0].content[0].text : undefined, "not draft3");
      assert.equal(usage, undefined);
    });

    it("ok on first validation: returns after 1 turn, no revision messages", async () => {
      const { ctx, appendedMessages } = reviseCtx({
        generateTexts: ["good"],
        validator: () => ({ ok: true }),
      });
      const loop = generateValidateReviseLoop({ validator: () => ({ ok: true }), maxRevisions: 3 });
      await loop.run(ctx);
      assert.equal(appendedMessages.length, 1);
      assert.equal(appendedMessages[0]?.role, "assistant");
      assert.equal(appendedMessages.filter((message) => message.role === "user").length, 0);
    });

    it("budget exhaustion terminates; exactly maxRevisions repair messages, no infinite loop", async () => {
      const { ctx, assistantTexts, appendedMessages } = reviseCtx({
        generateTexts: ["a", "b", "c", "d"],
        validator: () => ({ ok: false, errors: [{ message: "always bad" }] }),
      });
      const loop = generateValidateReviseLoop({ validator: () => ({ ok: false, errors: [{ message: "always bad" }] }), maxRevisions: 1 });
      await loop.run(ctx);
      // maxRevisions=1 → 2 turns (1 generate + 1 revision attempt); 1 repair message
      assert.equal(assistantTexts.length, 2);
      assert.equal(appendedMessages.filter((message) => message.role === "user").length, 1);
    });

    it("no parser: text is passed as the value to validator", async () => {
      let seenValue: unknown = "untouched";
      const { ctx } = reviseCtx({
        generateTexts: ["plaintext"],
        validator: (value) => { seenValue = value; return { ok: true }; },
      });
      const loop = generateValidateReviseLoop({ validator: (value) => { seenValue = value; return { ok: true }; } });
      await loop.run(ctx);
      assert.equal(seenValue, "plaintext");
    });

    it("default repairer builds a user message stringifying validation errors", async () => {
      const { ctx, appendedMessages } = reviseCtx({
        generateTexts: ["x", "y"],
        validator: () => ({ ok: false, errors: [{ message: "err1" }, { message: "err2" }] }),
      });
      const loop = generateValidateReviseLoop({
        validator: (value) => value === "y" ? { ok: true } : { ok: false, errors: [{ message: "err1" }, { message: "err2" }] },
        maxRevisions: 1,
      });
      await loop.run(ctx);
      const repair = appendedMessages.find((message) => message.role === "user");
      assert.ok(repair, "no repair message");
      assert.equal(repair?.content[0]?.type === "text" ? repair.content[0].text : undefined, "err1\nerr2");
    });

    it("host-supplied repairer output is appended verbatim and seeded as next input", async () => {
      const assembledInputs: AgentInput[] = [];
      const { ctx, appendedMessages } = reviseCtx({
        generateTexts: ["bad", "good"],
        validator: () => ({ ok: false, errors: [{ message: "nope" }] }),
      });
      const loop = generateValidateReviseLoop({
        validator: (value, _c) => value === "good" ? { ok: true } : { ok: false, errors: [{ message: "nope" }] },
        repairer: () => ({ role: "user", content: [{ type: "text", text: "try again with good" }] }),
        maxRevisions: 1,
      });
      // wrap assemble to capture what the loop seeds as next input
      ctx.assemble = async (nextInput) => {
        assembledInputs.push(nextInput);
        return { model: { provider: "mock", model: "demo" }, messages: [] } as ProviderRequest;
      };
      await loop.run(ctx);
      // first assemble: initial input "build a thing"; second assemble: repair message
      assert.equal(assembledInputs.length, 2);
      const second = assembledInputs[1];
      assert.ok(Array.isArray(second) && (second as readonly Message[])[0]?.role === "user");
      assert.deepEqual(
        (second as readonly Message[])[0]?.content.map((block) => block.type === "text" ? block.text : ""),
        ["try again with good"],
      );
      // repair message was appended to history/store
      assert.ok(appendedMessages.some((message) => message.role === "user"));
    });

    it("emits turn events and pushes first input to history once", async () => {
      const events: AgentEvent[] = [];
      const { ctx } = reviseCtx({
        generateTexts: ["bad", "good"],
        validator: () => ({ ok: false, errors: [{ message: "nope" }] }),
      });
      (ctx as { inputMessages: readonly Message[] }).inputMessages = [{ role: "user", content: [{ type: "text", text: "build a thing" }] }];
      ctx.emit = (event) => events.push(event);
      const loop = generateValidateReviseLoop({
        validator: (value) => value === "good" ? { ok: true } : { ok: false, errors: [{ message: "nope" }] },
        maxRevisions: 1,
      });
      await loop.run(ctx);
      assert.deepEqual(events.map((event) => event.type), [
        "turn_started", "message_finished", "turn_finished",
        "artifact_validation_started", "artifact_validation_finished", "artifact_revision_started",
        "turn_started", "message_finished", "turn_finished",
        "artifact_validation_started", "artifact_validation_finished", "artifact_finished",
      ]);
      assert.deepEqual(ctx.history.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
    });

    it("validation failure does not emit an error event", async () => {
      const events: AgentEvent[] = [];
      const { ctx } = reviseCtx({
        generateTexts: ["bad", "good"],
        validator: () => ({ ok: false, errors: [{ message: "nope" }] }),
      });
      ctx.emit = (event) => events.push(event);
      const loop = generateValidateReviseLoop({
        validator: (value, _c) => value === "good" ? { ok: true } : { ok: false, errors: [{ message: "nope" }] },
        maxRevisions: 1,
      });
      await loop.run(ctx);
      assert.equal(events.some((event) => event.type === "error"), false, "validation failure raised an error event");
    });
  });

  describe("generateValidateReviseLoop end-to-end via RuntimeAgentSession", () => {
    it("loops generate→validate→revise against a mock provider and ends on success", async () => {
      const texts = ["draft1", "draft2", "draftFINAL"];
      let perRun = 0;
      const provider: AIProvider = { id: "mock", async *generate() {
        const text = texts[perRun++] ?? "fallback";
        yield providerTextDelta(text);
        yield providerDone();
      } };
      const store = createMemorySessionStore();
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider,
        store,
      });
      const session = agent.createSession({ id: "s-revise" });
      const reader = collect(session.subscribe());
      await session.run("build", {
        loop: {
          strategy: "generate-validate-revise",
          validator: (value: unknown) => value === "draftFINAL" ? { ok: true } : { ok: false, errors: [{ message: "not final" }] },
          maxRevisions: 3,
        },
      });
      const events = await reader;
      assert.equal(perRun, 3, "should have made 3 provider turns");
      // assistant messages: 3; user repair messages between them: 2 → total assistant+user store messages emit message_finished for assistant only
      const finished = events.filter((event) => event.type === "message_finished");
      assert.equal(finished.length, 3, "expected 3 message_finished events (one per assistant draft)");
      assert.deepEqual(events.filter((event) => event.type === "turn_started" || event.type === "turn_finished").map((event) => `${event.type}:${event.turn}`), [
        "turn_started:1", "turn_finished:1",
        "turn_started:2", "turn_finished:2",
        "turn_started:3", "turn_finished:3",
      ]);
      assert.deepEqual((await store.list("s-revise")).map((entry) => entry.message?.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
      assert.equal(events.some((event) => event.type === "agent_finished"), true);
      assert.equal(events.some((event) => event.type === "error"), false);
    });

  it("redactAgentEvent redacts ArtifactValidation payloads (nested/cyclic metadata) without crashing", () => {
    const secret = "SUPERSECRET-api-key";
    const redactor = createSecretRedactor([secret]);
    const cyclic: Record<string, unknown> = { leak: secret };
    cyclic.self = cyclic; // cyclic reference
    const failure: ArtifactValidation = {
      ok: false,
      errors: [{ path: "title", message: `echo ${secret}` }],
      metadata: { nested: { leak: secret }, list: [secret], cyclic },
    };
    const started = { type: "artifact_validation_started", sessionId: "s", runId: "r", turn: 1, attempt: 1 } as const;
    const events = [
      started,
      { type: "artifact_validation_finished", sessionId: "s", runId: "r", turn: 1, attempt: 1, result: failure },
      { type: "artifact_revision_started", sessionId: "s", runId: "r", turn: 1, attempt: 1, failure },
      { type: "artifact_finished", sessionId: "s", runId: "r", turn: 2, attempt: 2, result: failure },
      { type: "artifact_failed", sessionId: "s", runId: "r", turn: 3, attempt: 3, result: failure },
    ] as const;
    // ponytail: generic redactSecrets walker already covers nesting + cycles (WeakSet guard).
    for (const event of events) {
      const out = redactAgentEvent(event, redactor);
      assert.equal(JSON.stringify(out).includes(secret), false, `${event.type} leaked secret`);
    }
    // cyclic metadata replaced with [Circular], no throw
    const failedOut = redactAgentEvent(events[4], redactor) as { result: ArtifactValidation };
    assert.equal(JSON.stringify(failedOut).includes("[Circular]"), true, "cyclic metadata not replaced");
  });
  });

  describe("LoopContext.assemble turn plumbing (Phase 30 Task 4)", () => {
    it("singleShotLoop passes turn=1 then turn=2 across a tool round", async () => {
      const turns: number[] = [];
      let generateCalls = 0;
      const ctx = stubCtx({
        input: "Hi",
        maxToolRounds: 1,
        assemble: async (_nextInput, _toolResults, turn) => {
          turns.push(turn ?? 1);
          return { model: { provider: "mock", model: "demo" }, messages: [] };
        },
        generate: async () => {
          generateCalls += 1;
          if (generateCalls === 1) return { content: [{ type: "text", text: "calling" }], calls: [toolCallContent("c1", "echo", { text: "hi" })], messageId: "m1", started: true };
          return { content: [{ type: "text", text: "done" }], calls: [], messageId: "m2", started: true };
        },
        dispatchToolCall: async (call) => ({ toolCallId: call.id, name: call.name, value: call.arguments }),
        emit: () => {},
      });
      await singleShotLoop.run(ctx);
      assert.equal(generateCalls, 2);
      assert.deepEqual(turns, [1, 2], "assemble should receive turn 1 then turn 2");
    });

    it("generateValidateReviseLoop passes turn=1,2,3 across revisions", async () => {
      const turns: number[] = [];
      let generateCalls = 0;
      const ctx = stubCtx({
        input: "build a thing",
        assemble: async (_nextInput, _toolResults, turn) => {
          turns.push(turn ?? 1);
          return { model: { provider: "mock", model: "demo" }, messages: [] };
        },
        generate: async () => {
          generateCalls += 1;
          const text = ["draft1", "draft2", "draft3"][generateCalls - 1] ?? "fallback";
          return { content: [{ type: "text", text }], calls: [], messageId: `m${generateCalls}`, started: true };
        },
        appendMessage: async () => {},
        emit: () => {},
      });
      const loop = generateValidateReviseLoop({
        validator: (value: unknown) => value === "draft3" ? { ok: true } : { ok: false, errors: [{ message: "not draft3" }] },
        maxRevisions: 3,
      });
      await loop.run(ctx);
      assert.equal(generateCalls, 3);
      assert.deepEqual(turns, [1, 2, 3], "GVR assemble should receive turn 1, 2, 3");
    });
  });
});
