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
  createRoutedProvider,
  OPENAI_RESPONSES_UNSUPPORTED_FIELDS,
  type OpenAIResponsesEventsOptions,
  openAIResponsesBody,
  openAIResponsesEvents,
  providerConformance,
  providerPackage,
  replayFetch,
  ResponsesMaxOutputTokensError,
} from "../provider-kit/index.js";
import { failedRun } from "./run-result-helpers.js";

/** A Responses SSE body from raw frames; `[DONE]` is optional because the wire never sends it. */
function sseBody(frames: readonly unknown[]): ReadableStream<Uint8Array> {
  const text = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } }).body!;
}

async function eventsOf(frames: readonly unknown[], options: OpenAIResponsesEventsOptions = {}): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of openAIResponsesEvents(sseBody(frames), options)) events.push(event);
  return events;
}

function terminalError(events: readonly ProviderEvent[]): Extract<ProviderEvent, { type: "error" }> {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error", "the stream must end with one terminal error");
  return terminal as Extract<ProviderEvent, { type: "error" }>;
}

const text = (value: string): ContentBlock => ({ type: "text", text: value });

const tool = (name: string): ToolDefinition =>
  ({
    name,
    description: `${name} it`,
    parameters: { type: "object", properties: { city: { type: "string" } } },
    execute: () => ({ name, toolCallId: name, content: [] }),
  }) as unknown as ToolDefinition;

function spec(overrides: Partial<ModelSpec> = {}): ModelSpec {
  return { provider: "acme", model: "wire-model", capabilities: { reasoning: true, structuredOutput: true }, ...overrides };
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return { model: spec(), messages: [{ role: "user", content: [text("hi")] }], ...overrides };
}

/** The reasoning item shape the wire returns, shortened from the live capture (plan 204 Task 1 (e)). */
const reasoningItem = {
  id: "rs_1",
  type: "reasoning",
  content: [],
  encrypted_content: "gAAAAABencrypted-payload",
  summary: [{ type: "summary_text", text: "Thinking it over." }],
};

const reasoningData = (provider: string, item: JsonObject = reasoningItem as unknown as JsonObject): ContentBlock => ({
  type: "thinking",
  text: "",
  redacted: true,
  data: JSON.stringify({ provider, item }),
});

describe("OpenAI Responses codec: body (plan 204 Task 3)", () => {
  it("responses_body_instructions_not_system_items", () => {
    const body = openAIResponsesBody(
      request({
        messages: [
          { role: "system", content: [text("You are terse.")] },
          { role: "system", content: [text("Cite sources.")] },
          { role: "user", content: [text("hi")] },
        ],
      }),
    );
    assert.equal(body.instructions, "You are terse.");
    const input = body.input as readonly JsonObject[];
    assert.deepEqual(
      input[0],
      { role: "developer", content: [{ type: "input_text", text: "Cite sources." }] },
      "later system content is a developer message",
    );
    assert.equal(
      input.some((item) => item.role === "system"),
      false,
      "no system-role items on the wire",
    );
    assert.deepEqual(input[1], { role: "user", content: [{ type: "input_text", text: "hi" }] });
  });

  it("responses_body_replays_encrypted_reasoning_byte_equal", () => {
    const message: Message = {
      role: "assistant",
      content: [reasoningData("acme"), text("answer")],
    };
    const body = openAIResponsesBody(request({ messages: [message] }));
    const input = body.input as readonly JsonObject[];
    assert.deepEqual(input[0], {
      type: "reasoning",
      id: "rs_1",
      encrypted_content: "gAAAAABencrypted-payload",
      summary: [{ type: "summary_text", text: "Thinking it over." }],
    });
    assert.deepEqual(input[1], { role: "assistant", content: [{ type: "output_text", text: "answer" }] });
    // Byte-identical replay: the encrypted payload and the summary array go back untouched, so the
    // provider can decrypt its own blob; the item id keeps the reasoning chain aligned.
    assert.equal((input[0] as JsonObject).encrypted_content, reasoningItem.encrypted_content);
    assert.deepEqual((input[0] as JsonObject).summary, reasoningItem.summary);
    assert.equal(JSON.stringify((input[0] as JsonObject).summary), JSON.stringify(JSON.parse(JSON.stringify(reasoningItem.summary))));
  });

  it("responses_body_omit_fields_applied_last", () => {
    const body = openAIResponsesBody(
      request({
        model: spec({ model: "wire-model", parameters: { temperature: 0.5, top_p: 0.9, max_output_tokens: 32 } }),
        options: { extra: { metadata: { probe: "1" } } },
      }),
      { omitFields: OPENAI_RESPONSES_UNSUPPORTED_FIELDS },
    );
    assert.equal("temperature" in body, false, "a model `parameters` field is removed after construction");
    assert.equal("top_p" in body, false);
    assert.equal("metadata" in body, false, "an `extra` field is removed too");
    assert.equal(body.max_output_tokens, 32, "the accepted token ceiling survives");
  });

  it("responses_max_output_tokens_passes_through_and_rejects_below_16", () => {
    assert.equal((OPENAI_RESPONSES_UNSUPPORTED_FIELDS as readonly string[]).includes("max_output_tokens"), false);
    const body = openAIResponsesBody(request({ model: spec({ parameters: { max_output_tokens: 16 } }) }));
    assert.equal(body.max_output_tokens, 16);

    const legacy = openAIResponsesBody(request({ model: spec({ parameters: { maxTokens: 64 } }) }));
    assert.equal(legacy.max_output_tokens, 64, "the portable maxTokens field maps onto the wire field");
    assert.equal("maxTokens" in legacy, false);

    assert.throws(
      () => openAIResponsesBody(request({ model: spec({ parameters: { max_output_tokens: 8 } }) })),
      (error: unknown) => error instanceof ResponsesMaxOutputTokensError && error.code === "max_output_tokens_below_minimum",
      "a ceiling under the route minimum fails locally with a named error",
    );
  });

  it("responses_prompt_cache_key_clamped_to_64", () => {
    const long = "s".repeat(100);
    assert.equal((openAIResponsesBody(request({ options: { sessionId: long } })).prompt_cache_key as string).length, 64);
    assert.equal(openAIResponsesBody(request({ options: { sessionId: "sess-1" } })).prompt_cache_key, "sess-1");
    assert.equal(
      openAIResponsesBody(request({ options: { sessionId: "sess-1", cacheKey: "cache-1" } })).prompt_cache_key,
      "cache-1",
      "an explicit cacheKey wins over the session id",
    );
    assert.equal("prompt_cache_key" in openAIResponsesBody(request()), false);
  });

  it("responses_never_sends_previous_response_id_over_http", async () => {
    const bodies: JsonObject[] = [];
    const provider = createRoutedProvider({
      id: "acme",
      baseUrl: "https://acme.test",
      routes: { responses: { format: "openai-responses", path: "/responses" } },
      fetch: (async (_input: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as JsonObject);
        return new Response(new Blob([""]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } });
      }) as unknown as typeof fetch,
    });

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(
      request({
        options: { continuation: { cursor: "resp_stored" }, compat: { previous_response_id: "resp_stored" } },
      }),
    )) {
      events.push(event);
    }
    assert.equal(bodies.length, 1);
    assert.equal("previous_response_id" in bodies[0]!, false, "a stateless route never continues a stored response");
  });

  it("responses_store_and_include_follow_route_options", () => {
    const stored = openAIResponsesBody(request(), { store: true });
    assert.equal(stored.store, true);
    assert.equal("include" in stored, false, "the encrypted-reasoning include is only forced for stateless requests");
    assert.deepEqual(openAIResponsesBody(request()).include, ["reasoning.encrypted_content"]);
    assert.deepEqual(openAIResponsesBody(request(), { store: true, include: ["reasoning.encrypted_content"] }).include, [
      "reasoning.encrypted_content",
    ]);
  });

  it("responses_body_reasoning_effort_and_structured_output", () => {
    const body = openAIResponsesBody(
      request({
        model: spec({ capabilities: { reasoning: true, structuredOutput: true, thinkingLevels: ["low", "medium", "high"] } }),
        options: {
          compat: { reasoning_effort: "xhigh" },
          structuredOutput: { name: "capital", schema: { type: "object" }, strict: true },
        },
      }),
      { reasoningSummary: "auto" },
    );
    assert.deepEqual(body.reasoning, { effort: "high", summary: "auto" }, "effort snaps to the declared levels");
    assert.deepEqual(body.text, {
      format: { type: "json_schema", name: "capital", strict: true, schema: { type: "object" } },
    });
    assert.deepEqual((openAIResponsesBody(request({ tools: [tool("get_weather")] })).tools as readonly JsonObject[])[0], {
      type: "function",
      name: "get_weather",
      description: "get_weather it",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    });
  });
});

describe("OpenAI Responses codec: events (plan 204 Task 3)", () => {
  const liveShapedStream = [
    { type: "response.created", response: { id: "resp_1", status: "in_progress" }, sequence_number: 0 },
    { type: "response.in_progress", response: { id: "resp_1", status: "in_progress" }, sequence_number: 1 },
    { type: "response.output_item.added", item: { id: "rs_1", type: "reasoning", summary: [] }, output_index: 0, sequence_number: 2 },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, delta: "Thinking ", sequence_number: 3 },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, delta: "it over.", sequence_number: 4 },
    { type: "response.output_item.done", item: reasoningItem, output_index: 0, sequence_number: 5 },
    { type: "response.output_item.added", item: { id: "msg_1", type: "message", role: "assistant" }, output_index: 1, sequence_number: 6 },
    { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, delta: "Let me ", sequence_number: 7 },
    { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, delta: "check.", sequence_number: 8 },
    {
      type: "response.output_item.added",
      item: { id: "fc_1", type: "function_call", arguments: "", call_id: "call_1", name: "get_weather" },
      output_index: 2,
      sequence_number: 9,
    },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 2, delta: '{"city":', sequence_number: 10 },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 2, delta: '"Vienna"}', sequence_number: 11 },
    {
      type: "response.output_item.done",
      item: { id: "fc_1", type: "function_call", arguments: '{"city":"Vienna"}', call_id: "call_1", name: "get_weather" },
      output_index: 2,
      sequence_number: 12,
    },
    {
      type: "response.completed",
      response: {
        id: "resp_1",
        status: "completed",
        usage: {
          input_tokens: 1024,
          input_tokens_details: { cached_tokens: 512 },
          output_tokens: 19,
          output_tokens_details: { reasoning_tokens: 7 },
          total_tokens: 1043,
        },
      },
      sequence_number: 13,
    },
  ];

  it("responses_events_text_reasoning_tools_usage", async () => {
    const events = await eventsOf(liveShapedStream, { provider: "acme" });

    const text_chunks = events.flatMap((event) =>
      event.type === "content_delta" && event.content.type === "text" ? [event.content.text] : [],
    );
    assert.deepEqual(text_chunks, ["Let me ", "check."], "output_text deltas stream as they arrive");

    const thinking = events.flatMap((event) =>
      event.type === "content_delta" && event.content.type === "thinking" ? [event.content] : [],
    );
    assert.deepEqual(
      thinking.map((block) => block.text),
      ["Thinking ", "it over.", ""],
      "summary deltas stream, and the item's own summary text is not repeated on the replay block",
    );
    const replay = thinking.at(-1)!;
    assert.equal(replay.redacted, true);
    assert.deepEqual(JSON.parse(replay.data!), { provider: "acme", item: reasoningItem });

    const call = events.find((event) => event.type === "tool_call");
    assert.ok(call && call.type === "tool_call");
    assert.deepEqual(call.call, { type: "tool_call", id: "call_1", name: "get_weather", arguments: { city: "Vienna" } });
    const deltas = events.flatMap((event) => (event.type === "tool_call_delta" ? [event] : []));
    assert.deepEqual(
      deltas.map((delta) => delta.argumentsText),
      ['{"city":', '"Vienna"}'],
    );
    assert.equal(deltas[0]!.id, "call_1", "argument deltas carry the call id, not the item id");

    const usage = events.find((event) => event.type === "usage");
    assert.ok(usage && usage.type === "usage");
    assert.equal(usage.usage.inputTokens, 1024, "Responses input_tokens is already inclusive");
    assert.equal(usage.usage.cacheReadTokens, 512);
    assert.equal(usage.usage.outputTokens, 19);
    assert.equal(usage.usage.totalTokens, 1043);
    assert.deepEqual(usage.usage.metadata, { reasoningTokens: 7 });

    const done = events.at(-1);
    assert.ok(done && done.type === "done");
    assert.equal(done.stopReason, "end_turn");
    assert.equal(done.usage?.cacheReadTokens, 512);
  });

  it("responses_failed_event_is_classified_error", async () => {
    const events = await eventsOf([
      { type: "response.created", response: { id: "resp_1" }, sequence_number: 0 },
      {
        type: "response.failed",
        response: {
          id: "resp_1",
          status: "failed",
          error: { code: "invalid_request_error", message: "bad tool schema", param: "tools[0]" },
        },
        sequence_number: 1,
      },
    ]);
    const error = terminalError(events);
    assert.equal(error.error.code, "invalid_request_error", "the wire code is preserved");
    assert.match(error.error.message, /invalid_request_error/);
    assert.match(error.error.message, /tools\[0\]/, "the wire param is preserved");
    assert.equal(error.error.failureClass, "unknown");
    assert.equal(
      events.some((event) => event.type === "done"),
      false,
      "no done follows a failure",
    );
  });

  it("responses_error_event_is_classified_error", async () => {
    const error = terminalError(await eventsOf([{ type: "error", code: 429, message: "Rate limit reached", param: null }]));
    assert.equal(error.error.code, 429);
    assert.equal(error.error.failureClass, "rate_limited");
  });

  it("responses_measured_usage_limit_frame_is_quota_not_unknown", async () => {
    // The live shape, measured 2026-10-25 (plan 204 Task 9): a 200 response whose stream carries a
    // nested error frame with a string code and no HTTP status.
    const error = terminalError(
      await eventsOf([
        { type: "response.created", response: { id: "resp_1" }, sequence_number: 0 },
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            code: "subscription_sharing_usage_limit_exceeded",
            message: "The ChatGPT user has reached their Subscription Sharing usage limit.",
            param: null,
          },
          sequence_number: 3,
        },
      ]),
    );
    assert.equal(error.error.code, "subscription_sharing_usage_limit_exceeded");
    assert.equal(error.error.failureClass, "quota");
    assert.match(String(error.error.message), /subscription_sharing_usage_limit_exceeded: The ChatGPT user/);
  });

  it("responses_incomplete_maps_stop_reason", async () => {
    const base = {
      type: "response.incomplete",
      response: {
        id: "resp_1",
        status: "incomplete",
        usage: { input_tokens: 10, output_tokens: 16, total_tokens: 26 },
      },
    };
    const length = await eventsOf([{ ...base, response: { ...base.response, incomplete_details: { reason: "max_output_tokens" } } }]);
    assert.equal((length.at(-1) as Extract<ProviderEvent, { type: "done" }>).stopReason, "max_output_tokens");

    const filtered = await eventsOf([{ ...base, response: { ...base.response, incomplete_details: { reason: "content_filter" } } }]);
    assert.equal((filtered.at(-1) as Extract<ProviderEvent, { type: "done" }>).stopReason, "content_filter");
  });

  it("responses_missing_completed_is_error", async () => {
    const events = await eventsOf([
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "partial" },
    ]);
    terminalError(events);
    assert.equal(
      events.some((event) => event.type === "done"),
      false,
      "a truncated stream never reports done",
    );

    const lenient = await eventsOf(
      [
        { type: "response.created", response: { id: "resp_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "partial" },
      ],
      { strictCompletion: false },
    );
    assert.equal(lenient.at(-1)?.type, "done");
  });

  it("responses_reasoning_not_replayed_to_other_provider", () => {
    const body = openAIResponsesBody(request({ messages: [{ role: "assistant", content: [reasoningData("other")] }] }));
    assert.deepEqual(body.input, [], "a foreign provider's encrypted payload is never sent back");
    const own = openAIResponsesBody(request({ messages: [{ role: "assistant", content: [reasoningData("acme")] }] }));
    assert.equal((own.input as readonly JsonObject[]).length, 1);
  });
});

describe("OpenAI Responses codec: overflow (plan 204 Task 3)", () => {
  const overflowFrame = {
    type: "response.failed",
    response: {
      id: "resp_1",
      status: "failed",
      error: {
        code: "context_length_exceeded",
        message: "Your input exceeds the context window of this model.",
        param: "input",
      },
    },
  };

  it("responses_overflow_failure_classifies_context_overflow", async () => {
    const before = terminalError(await eventsOf([overflowFrame]));
    assert.equal(before.error.failureClass, "context_overflow", "an overflow frame is a 400 for the classifier");
    assert.equal(before.error.code, 400);
    assert.match(before.error.message, /context_length_exceeded/);

    const after = terminalError(
      await eventsOf([{ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "partial " }, overflowFrame]),
    );
    assert.equal(after.error.failureClass, "context_overflow");

    const frameBody = (frames: readonly unknown[]) => `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}`;
    const ok = {
      path: "/responses",
      status: 200,
      contentType: "text/event-stream",
      responseBody: frameBody([
        { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "recovered" },
        { type: "response.completed", response: { id: "resp_2", status: "completed", usage: { input_tokens: 100, output_tokens: 5 } } },
      ]),
    };
    const recovery = await runSession([
      { path: "/responses", status: 200, contentType: "text/event-stream", responseBody: frameBody([overflowFrame]) },
      ok,
    ]);
    assert.equal(recovery.result.status, "completed", "before output the same turn recovers once");
    assert.equal(recovery.requests.length, 2);
    const compactions = recovery.entries.filter((entry) => entry.kind === "compaction");
    assert.equal(compactions.length, 1);
    assert.equal((compactions[0]!.data as { trigger?: string }).trigger, "overflow");

    const started = await runSession([
      {
        path: "/responses",
        status: 200,
        contentType: "text/event-stream",
        responseBody: frameBody([
          { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "partial " },
          overflowFrame,
        ]),
      },
    ]);
    const failed = await failedRun(Promise.resolve(started.result), /already started/, "failed");
    assert.equal(failed.error?.code, "context_overflow");
    assert.equal(started.requests.length, 1, "a started stream is never replayed");
  });
});

/** Runs one session against a recording-driven routed Responses provider and returns what it observed. */
async function runSession(
  exchanges: readonly { path: string; status: number; contentType: string; responseBody: string }[],
): Promise<{ result: RunResult; requests: ProviderRequest[]; entries: readonly { kind: string; data?: unknown }[] }> {
  const requests: ProviderRequest[] = [];
  const fetchImpl = replayFetch(exchanges as never);
  const provider = createRoutedProvider({
    id: "acme",
    baseUrl: "https://acme.test",
    fetch: ((input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as ProviderRequest);
      return fetchImpl(input as never, init as never);
    }) as typeof fetch,
    routes: { responses: { format: "openai-responses", path: "/responses" } },
  });
  const model: ModelConfig = { provider: "acme", model: "wire-model", limits: { contextWindow: 2000, maxOutputTokens: 100 } };
  const agent = await createAgent({
    model,
    packages: [providerPackage("test-provider", [provider])],
    compaction: { keepRecentEntries: 1 },
  });
  const session = await agent.session({ id: `s-openai-responses-${Math.random()}`, create: true });
  const result = await session.run("a long request");
  const entries = await session.entries();
  await session.close();
  return { result, requests, entries: entries as readonly { kind: string; data?: unknown }[] };
}

describe("OpenAI Responses codec: recorded wire conformance (plan 204 Task 3)", () => {
  it("responses_recordings_conform", async () => {
    const bodies: JsonObject[] = [];
    const result = await providerConformance(
      (fetchImpl) =>
        createRoutedProvider({
          id: "acme",
          baseUrl: "https://acme.test",
          fetch: ((input: unknown, init?: RequestInit) => {
            bodies.push(JSON.parse(String(init?.body)) as JsonObject);
            return fetchImpl!(input as never, init as never);
          }) as typeof fetch,
          routes: { responses: { format: "openai-responses", path: "/responses" } },
        }),
      { recordings: new URL("./wire/responses", import.meta.url) },
    );
    assert.equal(result.ok, true);
    const byName = new Map(result.scenarios.map((scenario) => [scenario.name, scenario]));
    assert.deepEqual([...byName.keys()].sort(), ["overflow", "text", "tool-loop"]);

    const textScenario = byName.get("text")!;
    const joined = textScenario.events.flatMap((event) =>
      event.type === "content_delta" && event.content.type === "text" ? [event.content.text] : [],
    );
    assert.equal(joined.join(""), "Hello, world!");

    const toolScenario = byName.get("tool-loop")!;
    const calls = toolScenario.events.flatMap((event) => (event.type === "tool_call" ? [event.call] : []));
    assert.deepEqual(
      calls.map((call) => [call.id, call.name, call.arguments]),
      [["call_1", "get_weather", { city: "Vienna" }]],
      "the tool call is reconstructed from argument deltas",
    );
    assert.ok(
      toolScenario.events.some((event) => event.type === "done" && (event.usage?.cacheReadTokens ?? 0) === 64),
      "the second turn's cached input lands in cacheReadTokens",
    );
    assert.equal(byName.get("overflow")!.events.at(-1)?.type, "error");

    // The recorded second turn replays its reasoning item; the codec must put that encrypted
    // payload back on the wire, which is what the conformance guard above refuses to skip.
    const replayed = bodies.filter((body) =>
      Array.isArray(body.input)
        ? (body.input as readonly JsonObject[]).some(
            (item) => item.type === "reasoning" && item.encrypted_content === "gAAAAABsyntheticencryptedpayload-from-plan-204-task-1",
          )
        : false,
    );
    assert.equal(replayed.length, 1, "the encrypted reasoning item round-trips through body construction");
    assert.equal(JSON.stringify(replayed[0]!.input).includes("syntheticencryptedpayload"), true, "the payload is sent back byte-for-byte");
  });
});
