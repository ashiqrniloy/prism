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
import { dispatchToolCallsInOrder, generateValidateReviseLoop, resolveToolConcurrency, singleShotLoop } from "../agent-loops.js";
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
    toolConcurrency: 1,
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
      assert.equal(ctx.history.filter((message) => message.role === "assistant").length, 2);
      assert.equal(ctx.history.filter((message) => message.role === "tool").length, 1);
    });

    it("keeps multi-round tool transcript chronological in history and requests", async () => {
      const assembledRoles: string[][] = [];
      const assembledToolCallIds: Array<Array<string | undefined>> = [];
      let generateCalls = 0;
      const ctx = stubCtx({
        input: "Hi",
        inputMessages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxToolRounds: 2,
        assemble: async (_nextInput, _toolResults, turn) => {
          assembledRoles.push(ctx.history.map((message) => message.role));
          assembledToolCallIds.push(
            ctx.history
              .filter((message) => message.role === "tool")
              .map((message) => message.content[0]?.type === "tool_result" ? message.content[0].toolCallId : undefined),
          );
          return { model: { provider: "mock", model: "demo" }, messages: ctx.history } as ProviderRequest;
        },
        generate: async () => {
          generateCalls += 1;
          if (generateCalls === 1) {
            return {
              content: [{ type: "text", text: "round1" }],
              calls: [
                toolCallContent("c1a", "echo", { text: "one-a" }),
                toolCallContent("c1b", "echo", { text: "one-b" }),
              ],
              messageId: "m1",
              started: true,
            };
          }
          if (generateCalls === 2) {
            return {
              content: [{ type: "text", text: "round2" }],
              calls: [
                toolCallContent("c2a", "echo", { text: "two-a" }),
                toolCallContent("c2b", "echo", { text: "two-b" }),
              ],
              messageId: "m2",
              started: true,
            };
          }
          return { content: [{ type: "text", text: "done" }], calls: [], messageId: "m3", started: true };
        },
        dispatchToolCall: async (call) => ({ toolCallId: call.id, name: call.name, value: call.arguments }),
        emit: () => {},
      });
      await singleShotLoop.run(ctx);
      assert.equal(generateCalls, 3);
      assert.deepEqual(ctx.history.map((message) => message.role), [
        "user", "assistant", "tool", "tool", "assistant", "tool", "tool", "assistant",
      ]);
      assert.deepEqual(
        ctx.history
          .filter((message) => message.role === "tool")
          .map((message) => message.content[0]?.type === "tool_result" ? message.content[0].toolCallId : undefined),
        ["c1a", "c1b", "c2a", "c2b"],
      );
      assert.deepEqual(assembledRoles[2], ["user", "assistant", "tool", "tool", "assistant", "tool", "tool"]);
      assert.deepEqual(assembledToolCallIds[2], ["c1a", "c1b", "c2a", "c2b"]);
    });

    it("defaults toolConcurrency to sequential dispatch", async () => {
      const order: string[] = [];
      const ctx = stubCtx({
        input: "Hi",
        maxToolRounds: 1,
        toolConcurrency: 1,
        generate: async () => ({
          content: [{ type: "text", text: "calling" }],
          calls: [toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {})],
          messageId: "m1",
          started: true,
        }),
        dispatchToolCall: async (call) => {
          order.push(call.id);
          return { toolCallId: call.id, name: call.name, value: call.id };
        },
        emit: () => {},
      });
      await singleShotLoop.run(ctx);
      assert.deepEqual(order, ["c1", "c2"]);
      assert.deepEqual(
        ctx.history.filter((message) => message.role === "tool").map((message) => message.content[0]?.type === "tool_result" ? message.content[0].toolCallId : undefined),
        ["c1", "c2"],
      );
    });

    it("dispatches concurrently but appends tool results in call order", async () => {
      const active = new Set<string>();
      let maxActive = 0;
      const ctx = stubCtx({
        input: "Hi",
        maxToolRounds: 1,
        toolConcurrency: 2,
        generate: async () => ({
          content: [{ type: "text", text: "calling" }],
          calls: [toolCallContent("c1", "slow", {}), toolCallContent("c2", "fast", {})],
          messageId: "m1",
          started: true,
        }),
        dispatchToolCall: async (call) => {
          active.add(call.id);
          maxActive = Math.max(maxActive, active.size);
          await new Promise((resolve) => setTimeout(resolve, call.id === "c1" ? 40 : 5));
          active.delete(call.id);
          return { toolCallId: call.id, name: call.name, value: call.id };
        },
        emit: () => {},
      });
      await singleShotLoop.run(ctx);
      assert.equal(maxActive, 2);
      assert.deepEqual(
        ctx.history.filter((message) => message.role === "tool").map((message) => message.content[0]?.type === "tool_result" ? message.content[0].toolCallId : undefined),
        ["c1", "c2"],
      );
    });

    it("serializes an exclusive turn without lowering later non-exclusive concurrency", async () => {
      let active = 0;
      let maxActive = 0;
      const runBatch = async (exclusiveName?: string) => {
        maxActive = 0;
        const ctx = stubCtx({
          generate: async () => ({ content: [], calls: [], started: true }),
          toolConcurrency: 2,
          isToolCallExclusive: (call) => call.name === exclusiveName,
          dispatchToolCall: async (call) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active -= 1;
            return { toolCallId: call.id, name: call.name };
          },
        });
        await dispatchToolCallsInOrder([
          toolCallContent("c1", exclusiveName ?? "read", {}),
          toolCallContent("c2", "read", {}),
        ], ctx);
        return maxActive;
      };

      assert.equal(await runBatch("shell"), 1);
      assert.equal(await runBatch(), 2);
    });

    it("caps concurrency at the number of calls in the turn", async () => {
      let maxActive = 0;
      let active = 0;
      const ctx = stubCtx({
        input: "Hi",
        maxToolRounds: 1,
        toolConcurrency: 8,
        generate: async () => ({
          content: [{ type: "text", text: "calling" }],
          calls: [toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {})],
          messageId: "m1",
          started: true,
        }),
        dispatchToolCall: async (call) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return { toolCallId: call.id, name: call.name };
        },
        emit: () => {},
      });
      await singleShotLoop.run(ctx);
      assert.equal(maxActive, 2);
    });

    it("aborts pending parallel dispatches when the run signal is aborted", async () => {
      const controller = new AbortController();
      let started = 0;
      const ctx = stubCtx({
        input: "Hi",
        maxToolRounds: 1,
        toolConcurrency: 2,
        signal: controller.signal,
        generate: async () => ({
          content: [{ type: "text", text: "calling" }],
          calls: [toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {})],
          messageId: "m1",
          started: true,
        }),
        dispatchToolCall: async (call) => {
          started += 1;
          if (call.id === "c1") controller.abort(new Error("aborted run"));
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { toolCallId: call.id, name: call.name };
        },
        emit: () => {},
      });
      await assert.rejects(() => singleShotLoop.run(ctx), /aborted run/);
      assert.equal(ctx.history.filter((message) => message.role === "tool").length, 0);
      assert.ok(started >= 1);
    });

    it("resolveToolConcurrency reads single-shot loop options with RunOptions precedence", () => {
      assert.equal(resolveToolConcurrency({}, {}), 1);
      assert.equal(resolveToolConcurrency({ loop: { strategy: "single-shot", toolConcurrency: 3 } }, {}), 3);
      assert.equal(resolveToolConcurrency({ loop: { strategy: "single-shot", toolConcurrency: 2 } }, { loop: { strategy: "single-shot", toolConcurrency: 5 } }), 2);
      assert.equal(resolveToolConcurrency({}, { loop: { strategy: "generate-validate-revise", validator: () => ({ ok: true }) } }), 1);
      assert.equal(resolveToolConcurrency({ loop: { strategy: "single-shot", toolConcurrency: 0 } }, {}), 1);
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
        "agent_started", "turn_started", "provider_turn_started", "message_started",
        "message_delta", "provider_turn_finished", "message_finished", "turn_finished", "agent_finished",
      ]);
    });

    it("uses ToolDefinition.exclusive to serialize a runtime turn", async () => {
      let turn = 0;
      let active = 0;
      let maxActive = 0;
      const provider: AIProvider = {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call", call: toolCallContent("c1", "shell", {}) };
            yield { type: "tool_call", call: toolCallContent("c2", "read", {}) };
          }
          yield providerDone();
        },
      };
      const execute: ToolDefinition["execute"] = async (_args, context) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { toolCallId: context.toolCallId, name: context.toolCallId === "c1" ? "shell" : "read" };
      };
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider,
        tools: [{ name: "shell", exclusive: true, execute }, { name: "read", execute }],
        loop: { strategy: "single-shot", toolConcurrency: 2 },
      });

      await agent.createSession().run("work", { maxToolRounds: 1 });
      assert.equal(maxActive, 1);
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

    it("dispatches bounded initial tool calls before parsing the artifact", async () => {
      const seen: string[] = [];
      const assembled: string[][] = [];
      let generated = 0;
      let active = 0;
      let maxActive = 0;
      const ctx = stubCtx({
        input: "build",
        inputMessages: [{ role: "user", content: [{ type: "text", text: "build" }] }],
        toolConcurrency: 2,
        assemble: async () => {
          assembled.push(ctx.history.map((message) => message.role));
          return { model: { provider: "mock", model: "demo" }, messages: ctx.history };
        },
        generate: async () => {
          generated += 1;
          return generated === 1
            ? {
                content: [toolCallContent("lookup-1", "read", {}), toolCallContent("lookup-2", "read", {})],
                calls: [toolCallContent("lookup-1", "read", {}), toolCallContent("lookup-2", "read", {})],
                messageId: "m1",
                started: true,
              }
            : { content: [{ type: "text", text: "artifact" }], calls: [], messageId: "m2", started: true };
        },
        dispatchToolCall: async (call) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { toolCallId: call.id, name: call.name, value: "reference" };
        },
        emit: () => {},
      });
      await generateValidateReviseLoop({ toolCalls: "bounded", maxRevisions: 0, validator: (value) => { seen.push(String(value)); return { ok: true }; } }).run(ctx);
      assert.deepEqual(seen, ["artifact"]);
      assert.equal(generated, 2);
      assert.equal(maxActive, 1, "artifact tools stay sequential");
      assert.deepEqual(assembled[1], ["user", "assistant", "tool", "tool"]);
      assert.deepEqual(ctx.history.map((message) => message.role), ["user", "assistant", "tool", "tool", "assistant"]);
    });

    it("shares tool-round budget across revisions and preserves candidate budget", async () => {
      const validated: string[] = [];
      const calls: string[] = [];
      let generated = 0;
      const ctx = stubCtx({
        maxToolRounds: 2,
        generate: async () => {
          generated += 1;
          if (generated === 1) return { content: [{ type: "text", text: "bad" }], calls: [], started: true };
          if (generated === 2) return { content: [toolCallContent("repair-lookup", "read", {})], calls: [toolCallContent("repair-lookup", "read", {})], started: true };
          if (generated === 3) return { content: [toolCallContent("final-lookup", "read", {})], calls: [toolCallContent("final-lookup", "read", {})], started: true };
          return { content: [{ type: "text", text: "good" }], calls: [], started: true };
        },
        dispatchToolCall: async (call) => { calls.push(call.id); return { toolCallId: call.id, name: call.name, value: "ok" }; },
        emit: () => {},
      });
      await generateValidateReviseLoop({
        toolCalls: "bounded",
        maxRevisions: 1,
        validator: (value) => { validated.push(String(value)); return { ok: value === "good", errors: [{ message: "bad" }] }; },
      }).run(ctx);
      assert.deepEqual(validated, ["bad", "good"]);
      assert.deepEqual(calls, ["repair-lookup", "final-lookup"]);
      assert.equal(generated, 4, "1 + maxRevisions + maxToolRounds");
      assert.equal(ctx.history.filter((message) => message.role === "user").length, 1, "tool rounds do not create repairs");
    });

    it("fails closed without dispatching a tool round beyond the shared limit", async () => {
      const events: AgentEvent[] = [];
      const calls: string[] = [];
      let generated = 0;
      const ctx = stubCtx({
        maxToolRounds: 1,
        generate: async () => {
          generated += 1;
          const call = toolCallContent(`c${generated}`, "read", {});
          return { content: [call], calls: [call], started: true };
        },
        dispatchToolCall: async (call) => { calls.push(call.id); return { toolCallId: call.id, name: call.name }; },
        emit: (event) => events.push(event),
      });
      await generateValidateReviseLoop({ toolCalls: "bounded", maxRevisions: 0, validator: () => ({ ok: true }) }).run(ctx);
      assert.equal(generated, 2);
      assert.deepEqual(calls, ["c1"]);
      const failure = events.find((event) => event.type === "artifact_failed");
      assert.deepEqual(failure?.type === "artifact_failed" ? failure.result.metadata : undefined, { reason: "tool_round_limit" });
    });

    it("aborts after bounded dispatch without another provider turn", async () => {
      const controller = new AbortController();
      let generated = 0;
      const call = toolCallContent("abort", "read", {});
      const ctx = stubCtx({
        signal: controller.signal,
        generate: async () => { generated += 1; return { content: [call], calls: [call], started: true }; },
        dispatchToolCall: async () => {
          controller.abort(new Error("stop artifact tools"));
          return { toolCallId: "abort", name: "read" };
        },
        emit: () => {},
      });
      await assert.rejects(() => generateValidateReviseLoop({ toolCalls: "bounded", validator: () => ({ ok: true }) }).run(ctx), /stop artifact tools/);
      assert.equal(generated, 1);
    });

    it("keeps tool calls inert unless bounded mode is explicitly selected", async () => {
      let dispatched = 0;
      const call = toolCallContent("inert", "read", {});
      const ctx = stubCtx({
        generate: async () => ({ content: [call], calls: [call], started: true }),
        dispatchToolCall: async () => { dispatched += 1; throw new Error("must stay inert"); },
        emit: () => {},
      });
      await generateValidateReviseLoop({ validator: (value) => ({ ok: value === "" }) }).run(ctx);
      assert.equal(dispatched, 0);
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

    it("uses runtime tool guards and redacts bounded artifact-tool transcripts", async () => {
      const secret = "bounded-artifact-secret";
      const requests: ProviderRequest[] = [];
      let generated = 0;
      let executed = 0;
      const provider: AIProvider = {
        id: "mock",
        async *generate(request) {
          requests.push(request);
          generated += 1;
          if (generated === 1) yield { type: "tool_call", call: toolCallContent("blocked", "read", { token: secret }) };
          else yield providerTextDelta("good");
          yield providerDone();
        },
      };
      const store = createMemorySessionStore();
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider,
        store,
        redactor: createSecretRedactor([secret]),
        tools: [{ name: "read", execute: () => { executed += 1; return { toolCallId: "blocked", name: "read" }; } }],
        validator: () => `blocked ${secret}`,
      });
      const session = agent.createSession({ id: "s-bounded-artifact-tools" });
      const reader = collect(session.subscribe());
      await session.run("build", { maxToolRounds: 1, loop: { strategy: "generate-validate-revise", toolCalls: "bounded", validator: (value) => ({ ok: value === "good" }) } });
      const events = await reader;
      assert.equal(executed, 0);
      assert.equal(generated, 2);
      assert.equal(events.some((event) => event.type === "tool_execution_blocked"), true);
      assert.equal(JSON.stringify(events).includes(secret), false);
      assert.equal(JSON.stringify(requests[1]).includes(secret), false);
      assert.equal(JSON.stringify(await store.list("s-bounded-artifact-tools")).includes(secret), false);
    });

    it("revision with redactor reaches second provider request without duplicate repair messages", async () => {
      const secret = "SUPERSECRET-api-key";
      const requests: ProviderRequest[] = [];
      let generateCalls = 0;
      const provider: AIProvider = {
        id: "mock",
        async *generate(request) {
          requests.push(request);
          generateCalls += 1;
          const text = generateCalls === 1 ? "draft1" : "draft2";
          yield providerTextDelta(text);
          yield providerDone();
        },
      };
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider,
        redactor: createSecretRedactor([secret]),
      });
      const session = agent.createSession({ id: "s-redact-revise" });
      await session.run("build", {
        loop: {
          strategy: "generate-validate-revise",
          validator: (value: unknown) => value === "draft2" ? { ok: true } : { ok: false, errors: [{ message: `fix ${secret}` }] },
          maxRevisions: 1,
        },
      });
      assert.equal(generateCalls, 2, "revision turn should reach provider");
      const revisionRequest = requests[1]!;
      const repairMessages = revisionRequest.messages.filter((message) => message.role === "user");
      assert.equal(repairMessages.length, 2, "expected original user prompt plus one repair message");
      const repairTexts = repairMessages.map((message) => message.content[0]?.type === "text" ? message.content[0].text : undefined);
      assert.deepEqual(repairTexts, ["build", "fix [REDACTED]"]);
      assert.equal(JSON.stringify(revisionRequest).includes(secret), false);
      assert.equal(JSON.stringify(revisionRequest).includes("[Circular]"), false);
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
