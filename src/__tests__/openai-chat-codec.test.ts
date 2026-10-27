import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type {
  ContentBlock,
  JsonObject,
  Message,
  ModelConfig,
  ModelSpec,
  ProviderEvent,
  ProviderRequest,
  RunResult,
  ToolDefinition,
} from "../index.js";
import { createAgent } from "../index.js";
import {
  assertRecordedStreamConforms,
  createRoutedProvider,
  type OpenAIChatEventsOptions,
  openAIChatBody,
  openAIChatEvents,
  providerPackage,
  replayFetch,
} from "../provider-kit/index.js";
import { failedRun } from "./run-result-helpers.js";

/** A Chat Completions SSE body from raw chunks, ending in `[DONE]` unless `done: false`. */
function sseStream(frames: readonly unknown[], options: { readonly done?: boolean } = {}): ReadableStream<Uint8Array> {
  const text = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + (options.done === false ? "" : "data: [DONE]\n\n");
  return new Response(text, { headers: { "content-type": "text/event-stream" } }).body!;
}

async function eventsOf(frames: readonly unknown[], options: OpenAIChatEventsOptions = {}): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of openAIChatEvents(sseStream(frames), options)) events.push(event);
  return events;
}

function terminalError(events: readonly ProviderEvent[]): Extract<ProviderEvent, { type: "error" }> {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error", "the stream must end with one terminal error");
  return terminal as Extract<ProviderEvent, { type: "error" }>;
}

const text = (value: string): ContentBlock => ({ type: "text", text: value });

/** Provider tools carry an executor; the codec only reads name/description/parameters. */
const tool = (name: string, description?: string): ToolDefinition =>
  ({ name, description, parameters: { type: "object" }, execute: () => ({ name, toolCallId: name }) }) as unknown as ToolDefinition;

function thinkingBlocks(events: readonly ProviderEvent[]): Extract<ContentBlock, { type: "thinking" }>[] {
  const blocks: Extract<ContentBlock, { type: "thinking" }>[] = [];
  for (const event of events) {
    if (event.type === "content_delta" && event.content.type === "thinking") blocks.push(event.content);
  }
  return blocks;
}

function spec(overrides: Partial<ModelSpec> = {}): ModelSpec {
  return { provider: "openrouter", model: "anthropic/claude-haiku-4.5", capabilities: { reasoning: true }, ...overrides };
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return { model: spec(), messages: [{ role: "user", content: [text("hi")] }], ...overrides };
}

describe("OpenAI Chat codec: stream error frames (plan 203 Task 3)", () => {
  it("openai_chat_mid_stream_error_frame_is_terminal_error", async () => {
    const cases: readonly (readonly [number, string, string])[] = [
      [429, "rate_limited", "rate limit exceeded"],
      [429, "quota", "You exceeded your current quota"],
      [502, "transient", "bad gateway"],
      [503, "transient", "upstream overloaded"],
      [400, "permanent", "invalid tool schema"],
      [402, "permanent", "payment required"],
    ];
    for (const [code, failureClass, message] of cases) {
      const events = await eventsOf([
        { choices: [{ delta: { content: "partial" } }] },
        { error: { code, message, metadata: { error_type: "upstream_error" } } },
      ]);
      const error = terminalError(events);
      assert.equal(error.error.code, code);
      assert.equal(error.error.failureClass, failureClass, `status ${code}`);
      assert.equal(error.error.message, `upstream_error: ${message}`);
      assert.equal(
        events.some((event) => event.type === "done"),
        false,
        "no done follows an error frame",
      );
    }
  });

  it("openai_chat_finish_reason_error_without_error_object_is_error", async () => {
    const events = await eventsOf([{ choices: [{ delta: { content: "partial" } }] }, { choices: [{ delta: {}, finish_reason: "error" }] }]);
    terminalError(events);
    assert.equal(
      events.some((event) => event.type === "done"),
      false,
    );
  });

  it("openai_chat_overflow_error_frame_recovers_once", async () => {
    const overflow = { error: { code: 400, message: "This endpoint's maximum context length is 204800 tokens" } };
    const before = terminalError(await eventsOf([overflow]));
    assert.equal(before.error.failureClass, "context_overflow");

    const recovery = await runSession([
      { path: "/chat/completions", status: 200, contentType: "text/event-stream", responseBody: frameBody([overflow]) },
      okRecording("recovered"),
    ]);
    assert.equal(recovery.result.status, "completed", "one compaction and one retry");
    assert.equal(recovery.requests.length, 2);
    const compactions = recovery.entries.filter((entry) => entry.kind === "compaction");
    assert.equal(compactions.length, 1);
    assert.equal((compactions[0]!.data as { trigger?: string }).trigger, "overflow");

    const started = await runSession([
      {
        path: "/chat/completions",
        status: 200,
        contentType: "text/event-stream",
        responseBody: frameBody([{ choices: [{ delta: { content: "partial " } }] }, overflow]),
      },
    ]);
    const failed = await failedRun(Promise.resolve(started.result), /already started/, "failed");
    assert.equal(failed.error?.code, "context_overflow");
    assert.equal(started.requests.length, 1, "a started stream is never replayed");
  });
});

describe("OpenAI Chat codec: reasoning_details (plan 203 Task 3)", () => {
  it("openai_chat_reasoning_details_merge_and_round_trip", async () => {
    const frames = [
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", index: 0, text: "Let me " }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", index: 0, text: "think." }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.encrypted", index: 1, id: "enc-1", data: "abc123" }] } }] },
      { choices: [{ delta: { content: "answer" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ];
    const events = await eventsOf(frames);
    const thinking = thinkingBlocks(events);
    assert.equal(thinking.length, 2, "two logical entries: merged text plus one discrete encrypted entry");
    assert.equal(thinking[0]!.text, "Let me think.");
    assert.deepEqual(JSON.parse(thinking[0]!.data!), { type: "reasoning.text", index: 0, text: "Let me think." });
    assert.equal(thinking[1]!.redacted, true);
    assert.equal(thinking[1]!.text, "");

    const body = openAIChatBody(request({ messages: [{ role: "assistant", content: [...thinking, text("answer")] }] }), {
      reasoningReplay: "reasoning_details",
    });
    const replayed = (body.messages as readonly JsonObject[])[0]!;
    assert.deepEqual(replayed.reasoning_details, [
      { type: "reasoning.text", index: 0, text: "Let me think." },
      { type: "reasoning.encrypted", index: 1, id: "enc-1", data: "abc123" },
    ]);
    assert.equal("reasoning_content" in replayed, false);
    assert.equal(replayed.content, "answer", "thinking text is not folded when it replays as details");
  });

  it("openai_chat_reasoning_not_duplicated", async () => {
    const frames = [
      {
        choices: [
          {
            delta: {
              reasoning: "abc",
              reasoning_details: [
                { type: "reasoning.text", index: 0, text: "abc" },
                { type: "reasoning.summary", index: 1, summary: "sum " },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { reasoning: "def", reasoning_details: [{ type: "reasoning.summary", index: 1, summary: "mary" }] } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ];
    const events = await eventsOf(frames);
    const streamed = thinkingBlocks(events).map((block) => block.text);
    assert.deepEqual(streamed, ["abc", "sum mary"], "details own the text; delta.reasoning never repeats it");
  });

  it("openai_chat_fold_mode_never_sends_reasoning_details", async () => {
    const thinking: ContentBlock = {
      type: "thinking",
      text: "internal",
      data: JSON.stringify({ type: "reasoning.text", text: "internal" }),
    };
    const body = openAIChatBody(request({ messages: [{ role: "assistant", content: [thinking, text("answer")] }] }));
    const message = (body.messages as readonly JsonObject[])[0]!;
    assert.equal("reasoning_details" in message, false);
    assert.deepEqual(
      message.content,
      [
        { type: "text", text: "internal" },
        { type: "text", text: "answer" },
      ],
      "fold mode keeps its existing text placement",
    );
  });
});

describe("OpenAI Chat codec: cache_control blocks (plan 203 Task 3)", () => {
  const tools = [tool("first"), tool("second")];
  const messages: readonly Message[] = [
    { role: "system", content: [text("system prompt")] },
    { role: "user", content: [text("hi")] },
    { role: "assistant", content: [text("hello")] },
    { role: "user", content: [text("   "), text("last question")] },
  ];
  const cacheModel = spec({ cache: { kind: "cache_control", longRetention: true } });

  it("openai_chat_cache_control_blocks_match_pi_placement", () => {
    const body = openAIChatBody(
      { model: cacheModel, messages, tools, options: { cacheRetention: "long" } },
      { cacheControl: "anthropic-blocks", cacheControlOnTools: true },
    );
    const marked: string[] = [];
    (body.messages as readonly JsonObject[]).forEach((message, index) => {
      const content = message.content;
      if (!Array.isArray(content)) return;
      content.forEach((part, partIndex) => {
        if ((part as JsonObject).cache_control) marked.push(`messages[${index}].content[${partIndex}]`);
      });
    });
    (body.tools as readonly JsonObject[]).forEach((tool, index) => {
      if (tool.cache_control) marked.push(`tools[${index}]`);
    });

    assert.deepEqual(marked.sort(), ["messages[0].content[0]", "messages[3].content[1]", "tools[1]"].sort());
    assert.equal(marked.length <= 4, true, "at most 4 markers");
    const marker = ((body.tools as readonly JsonObject[])[1]!.cache_control ?? {}) as JsonObject;
    assert.deepEqual(marker, { type: "ephemeral", ttl: "1h" }, "long retention is only sent when the model declares it");
  });

  it("openai_chat_no_cache_control_without_option", () => {
    const body = openAIChatBody({ model: cacheModel, messages, tools, options: { cacheRetention: "long" } });
    assert.equal(JSON.stringify(body).includes("cache_control"), false);
    assert.equal("cache_control" in ((body.tools as readonly JsonObject[])[1] as JsonObject), false);
  });

  it("marks tools only when the route declares cacheControlOnTools", () => {
    const body = openAIChatBody({ model: cacheModel, messages, tools }, { cacheControl: "anthropic-blocks" });
    const toolList = body.tools as readonly JsonObject[];
    assert.deepEqual(
      toolList.map((tool) => tool.cache_control),
      [undefined, undefined],
      "a gateway without tool-definition caching gets no tool markers",
    );
  });
});

describe("OpenAI Chat codec: usage and conformance (plan 203 Task 3)", () => {
  it("routed_provider_map_usage_receives_chunk", async () => {
    const seen: { usage: unknown; chunk?: JsonObject }[] = [];
    const provider = createRoutedProvider({
      id: "chunky",
      baseUrl: "https://chunky.test",
      fetch: replayFetch({
        path: "/chat/completions",
        status: 200,
        contentType: "text/event-stream",
        responseBody: frameBody([
          { id: "gen-1", model: "demo", choices: [{ delta: { content: "ok" } }] },
          { id: "gen-2", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
        ]),
      }),
      routes: {
        chat: {
          format: "openai-chat",
          path: "/chat/completions",
          mapUsage: (usage, chunk) => {
            seen.push({ usage, chunk });
            return undefined;
          },
        },
      },
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(request())) events.push(event);
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(seen.length, 2, "every chunk reaches the mapper");
    assert.equal(seen[1]!.chunk?.id, "gen-2");
    assert.deepEqual(seen[1]!.usage, { prompt_tokens: 3, completion_tokens: 1 });
  });

  it("assert_recorded_stream_conformance_accepts_a_200_error_frame", async () => {
    const provider = createRoutedProvider({
      id: "recorded",
      baseUrl: "https://recorded.test",
      fetch: replayFetch({
        path: "/chat/completions",
        status: 200,
        contentType: "text/event-stream",
        responseBody: frameBody([{ error: { code: 503, message: "overloaded" } }]),
      }),
      routes: { chat: { format: "openai-chat", path: "/chat/completions" } },
    });
    const events = await assertRecordedStreamConforms({
      provider,
      request: request(),
      recording: {
        path: "/chat/completions",
        status: 200,
        contentType: "text/event-stream",
        responseBody: frameBody([{ error: { code: 503, message: "overloaded" } }]),
      },
    });
    assert.equal(events.at(-1)?.type, "error");
  });

  it("openai_chat_existing_fixtures_unchanged", async () => {
    // The Hyper and OpenCode Go Chat routes set exactly these codec options.
    const body = openAIChatBody(
      {
        model: {
          provider: "hyper",
          model: "demo",
          parameters: { maxTokens: 64 },
          capabilities: { input: ["text"], reasoning: true },
        },
        messages: [
          { role: "system", content: [text("be brief")] },
          { role: "user", content: [text("hi")] },
          { role: "assistant", content: [{ type: "thinking", text: "plan" }, text("hello")] },
          { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "read", result: "ok" }] },
        ],
        tools: [tool("read", "read a file")],
      },
      { reasoningReplay: "reasoning_content", maxTokensField: "max_tokens" },
    );
    assert.deepEqual(body, {
      model: "demo",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", reasoning_content: "plan" },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
      tools: [{ type: "function", function: { name: "read", description: "read a file", parameters: { type: "object" } } }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 64,
    });

    const events = await eventsOf([
      { choices: [{ delta: { content: "ok" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ]);
    assert.deepEqual(
      events.map((event) => event.type),
      ["content_delta", "usage", "done"],
    );
    assert.deepEqual(events[0], { type: "content_delta", content: { type: "text", text: "ok" } });
    assert.equal((events[2] as Extract<ProviderEvent, { type: "done" }>).stopReason, "end_turn");
  });
});

/** One SSE frame per chunk, terminated by the `[DONE]` marker. */
function frameBody(frames: readonly unknown[]): string {
  return `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
}

function okRecording(content: string): { path: string; status: number; contentType: string; responseBody: string } {
  return {
    path: "/chat/completions",
    status: 200,
    contentType: "text/event-stream",
    responseBody: frameBody([
      { choices: [{ delta: { content } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 2 } },
    ]),
  };
}

/** Runs one session against a recording-driven routed provider and returns what it observed. */
async function runSession(
  exchanges: readonly { path: string; status: number; contentType: string; responseBody: string }[],
): Promise<{ result: RunResult; requests: ProviderRequest[]; entries: readonly { kind: string; data?: unknown }[] }> {
  const requests: ProviderRequest[] = [];
  const fetchImpl = replayFetch(exchanges as never);
  const provider = createRoutedProvider({
    id: "mock",
    baseUrl: "https://mock.test",
    fetch: (input, init) => {
      requests.push(JSON.parse(String(init?.body)) as ProviderRequest);
      return fetchImpl(input, init);
    },
    routes: { chat: { format: "openai-chat", path: "/chat/completions" } },
  });
  const model: ModelConfig = { provider: "mock", model: "demo", limits: { contextWindow: 2000, maxOutputTokens: 100 } };
  const agent = await createAgent({
    model,
    packages: [providerPackage("test-provider", [provider])],
    compaction: { keepRecentEntries: 1 },
  });
  const session = await agent.session({ id: `s-openai-chat-${Math.random()}`, create: true });
  const result = await session.run("a long request");
  const entries = await session.entries();
  await session.close();
  return { result, requests, entries: entries as readonly { kind: string; data?: unknown }[] };
}
