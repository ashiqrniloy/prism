import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JsonObject, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderStreamConforms,
  assertUsageAccounting,
} from "@arnilo/prism/testing/provider-conformance";
import { AwsEventStreamError, crc32, readAwsEventStream } from "../eventstream.js";
import {
  BEDROCK_THINKING_DEFAULT_BUDGET,
  bedrockConverseBody,
  createBedrockConverseProvider,
  createBedrockProviderPackage,
} from "../index.js";

const CREDENTIAL = { accessKeyId: "AKIATEST", secretAccessKey: "secret-key", sessionToken: "session-token" };

/** Independent frame encoder: layout from the Smithy amazon-eventstream spec. */
function encodeFrame(headers: Record<string, string>, payload: string): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = new TextEncoder().encode(name);
    const valueBytes = new TextEncoder().encode(value);
    const header = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
    const view = new DataView(header.buffer);
    header[0] = nameBytes.length;
    header.set(nameBytes, 1);
    header[1 + nameBytes.length] = 7;
    view.setUint16(1 + nameBytes.length + 1, valueBytes.length);
    header.set(valueBytes, 1 + nameBytes.length + 3);
    parts.push(header);
  }
  const headersBytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    headersBytes.set(part, offset);
    offset += part.length;
  }
  const payloadBytes = new TextEncoder().encode(payload);
  const total = 12 + headersBytes.length + payloadBytes.length + 4;
  const frame = new Uint8Array(total);
  const view = new DataView(frame.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headersBytes.length);
  view.setUint32(8, crc32(frame.subarray(0, 8)));
  frame.set(headersBytes, 12);
  frame.set(payloadBytes, 12 + headersBytes.length);
  view.setUint32(total - 4, crc32(frame.subarray(0, total - 4)));
  return frame;
}

function eventFrame(eventType: string, payload: JsonObject): Uint8Array {
  return encodeFrame({ ":message-type": "event", ":event-type": eventType }, JSON.stringify(payload));
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const message of readAwsEventStream(stream)) messages.push(message);
  return messages;
}

const MODEL = { provider: "bedrock", model: "us.anthropic.claude-haiku-4-5-20251001-v1:0" };
const textRequest = (extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: MODEL,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  ...extra,
});

describe("@arnilo/prism-providers/bedrock event stream decoder", () => {
  it("decodes a canonical AWS frame byte-for-byte, in split chunks", async () => {
    // Bytes produced independently (zlib CRC32 + the documented prelude/header layout).
    const canonical = Uint8Array.from(
      Buffer.from(
        "000000590000003076f8427f0d3a6d6573736167652d747970650700056576656e740b3a6576656e742d7479706507000b6d65737361676553746f707b2273746f70526561736f6e223a22656e645f7475726e227def4f02c7",
        "hex",
      ),
    );
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "CRC32 known-answer vector");
    const whole = (await drain(streamOf(canonical))) as { headers: Record<string, unknown>; payload: Uint8Array }[];
    const split = (await drain(streamOf(canonical.subarray(0, 7), canonical.subarray(7, 20), canonical.subarray(20)))) as {
      headers: Record<string, unknown>;
      payload: Uint8Array;
    }[];
    for (const frames of [whole, split]) {
      assert.equal(frames.length, 1);
      assert.equal(frames[0]!.headers[":event-type"], "messageStop");
      assert.equal(new TextDecoder().decode(frames[0]!.payload), '{"stopReason":"end_turn"}');
    }
  });

  it("terminates on checksum mismatch, oversized frames, and partial tails", async () => {
    const frame = eventFrame("messageStop", { stopReason: "end_turn" });
    const corrupted = frame.slice();
    corrupted[14] = corrupted[14]! ^ 0xff;
    await assert.rejects(
      () => drain(streamOf(corrupted)),
      (error: AwsEventStreamError) => error.code === "crc_mismatch",
    );

    const oversized = frame.slice();
    new DataView(oversized.buffer).setUint32(0, 25_165_824 + 1);
    await assert.rejects(
      () => drain(streamOf(oversized)),
      (error: AwsEventStreamError) => error.code === "bad_frame",
    );

    await assert.rejects(
      () => drain(streamOf(frame.subarray(0, frame.length - 2))),
      (error: AwsEventStreamError) => error.code === "truncated",
    );
  });
});

describe("@arnilo/prism-providers/bedrock native Converse route", () => {
  it("converse_stream_maps_text_thinking_tools_usage_and_signs_the_request", async () => {
    const seen: { url?: string; auth?: string; accept?: string; body?: JsonObject } = {};
    const provider = createBedrockConverseProvider({
      region: "eu-west-1",
      endpoint: "https://vpce-123.bedrock-runtime.eu-west-1.vpce.amazonaws.com",
      credential: CREDENTIAL,
      fetch: (async (input, init) => {
        seen.url = String(input);
        const headers = new Headers(init?.headers);
        seen.auth = headers.get("authorization") ?? undefined;
        seen.accept = headers.get("accept") ?? undefined;
        seen.body = JSON.parse(String(init?.body));
        return new Response(
          streamOf(
            eventFrame("messageStart", { role: "assistant" }),
            eventFrame("contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "thinking…" } } }),
            eventFrame("contentBlockStop", { contentBlockIndex: 0 }),
            eventFrame("contentBlockDelta", { contentBlockIndex: 1, delta: { text: "pong" } }),
            eventFrame("contentBlockStop", { contentBlockIndex: 1 }),
            eventFrame("contentBlockStart", { contentBlockIndex: 2, start: { toolUse: { toolUseId: "tu_1", name: "get_weather" } } }),
            eventFrame("contentBlockDelta", { contentBlockIndex: 2, delta: { toolUse: { input: '{"city":' } } }),
            eventFrame("contentBlockDelta", { contentBlockIndex: 2, delta: { toolUse: { input: '"Paris"}' } } }),
            eventFrame("contentBlockStop", { contentBlockIndex: 2 }),
            eventFrame("messageStop", { stopReason: "tool_use" }),
            eventFrame("metadata", {
              metrics: { latencyMs: 42 },
              usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19, cacheReadInputTokens: 3, cacheWriteInputTokens: 4 },
            }),
          ),
          { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } },
        );
      }) as typeof fetch,
    });

    const events = await assertProviderStreamConforms({ provider, request: textRequest({ tools: [weatherTool] }) });
    assert.equal(
      seen.url,
      "https://vpce-123.bedrock-runtime.eu-west-1.vpce.amazonaws.com/model/us.anthropic.claude-haiku-4-5-20251001-v1%3A0/converse-stream",
    );
    assert.match(seen.auth ?? "", /^AWS4-HMAC-SHA256 Credential=AKIATEST\/.+\/eu-west-1\/bedrock\/aws4_request/);
    assert.equal(seen.accept, "application/vnd.amazon.eventstream");
    assert.deepEqual(seen.body?.messages, [{ role: "user", content: [{ text: "hi" }] }]);
    assert.deepEqual((seen.body?.toolConfig as JsonObject)?.tools, [
      {
        toolSpec: {
          name: "get_weather",
          description: "Get the current weather for a city.",
          inputSchema: { json: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
        },
      },
    ]);
    const text = events
      .map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : ""))
      .join("");
    assert.equal(text, "pong");
    assert.ok(
      events.some((event) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "thinking…"),
    );
    const calls = events.filter((event): event is Extract<ProviderEvent, { type: "tool_call" }> => event.type === "tool_call");
    assert.deepEqual(
      calls.map((event) => [event.call.id, event.call.name, event.call.arguments]),
      [["tu_1", "get_weather", { city: "Paris" }]],
    );
    assertUsageAccounting(events, { inputTokens: 12, outputTokens: 7, totalTokens: 19, cacheReadTokens: 3, cacheWriteTokens: 4 });
    assertNoSecretLeak(events, [CREDENTIAL.accessKeyId, CREDENTIAL.secretAccessKey, CREDENTIAL.sessionToken]);
  });

  it("converse_stream_fails_closed_on_exception_frames_and_truncated_streams", async () => {
    const provider = (body: ReadableStream<Uint8Array>) =>
      createBedrockConverseProvider({
        region: "us-east-1",
        credential: CREDENTIAL,
        fetch: (async () => new Response(body, { status: 200 })) as typeof fetch,
      });

    const throttled = await collectProviderEvents(
      provider(
        streamOf(
          encodeFrame({ ":message-type": "exception", ":exception-type": "ThrottlingException" }, JSON.stringify({ message: "slow down" })),
        ),
      ),
      textRequest(),
    );
    assert.equal(throttled.at(-1)?.type, "error");
    assert.match(String((throttled.at(-1) as { error: { message: string } }).error.message), /ThrottlingException: slow down/);

    const truncated = await collectProviderEvents(
      provider(
        streamOf(
          eventFrame("messageStart", { role: "assistant" }),
          eventFrame("contentBlockDelta", { contentBlockIndex: 0, delta: { text: "par" } }),
        ),
      ),
      textRequest(),
    );
    assert.equal(truncated.at(-1)?.type, "error");
    assert.match(String((truncated.at(-1) as { error: { message: string } }).error.message), /without completion evidence/);
  });

  it("converse_non_streaming_maps_a_single_response", async () => {
    let url: string | undefined;
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      stream: false,
      fetch: (async (input) => {
        url = String(input);
        return new Response(
          JSON.stringify({
            output: {
              message: {
                role: "assistant",
                content: [
                  { text: "pong" },
                  { reasoningContent: { reasoningText: { text: "why", signature: "sig" } } },
                  { toolUse: { toolUseId: "tu_2", name: "get_weather", input: { city: "Paris" } } },
                ],
              },
            },
            stopReason: "tool_use",
            usage: { inputTokens: 5, outputTokens: 6 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    const events = await assertProviderStreamConforms({ provider, request: textRequest() });
    assert.equal(url, "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-haiku-4-5-20251001-v1%3A0/converse");
    assert.ok(
      events.some((event) => event.type === "content_delta" && event.content.type === "thinking" && event.content.signature === "sig"),
    );
    assert.ok(events.some((event) => event.type === "tool_call" && event.call.id === "tu_2"));
    assertUsageAccounting(events, { inputTokens: 5, outputTokens: 6 });
  });

  it("converse_non_streaming_bounds_the_response_body", async () => {
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      stream: false,
      fetch: (async () =>
        new Response(JSON.stringify({ output: { message: { content: [{ text: "x".repeat(5 * 1024 * 1024) }] } } }), {
          status: 200,
        })) as typeof fetch,
    });
    const events = await collectProviderEvents(provider, textRequest());
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error: { message: string } }).error.message), /exceeded 4194304 bytes/);
  });

  it("converse_observes_an_already_aborted_signal", async () => {
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      fetch: (async () => new Response(streamOf(), { status: 200 })) as typeof fetch,
    });
    await assertAbortIsObserved({ provider, request: textRequest() });
  });

  it("emits cachePoint markers only for declared cache-control breakpoints", async () => {
    const bodies: JsonObject[] = [];
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      fetch: (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(streamOf(eventFrame("messageStop", { stopReason: "end_turn" })), { status: 200 });
      }) as typeof fetch,
    });
    const request = textRequest({
      model: { ...MODEL, cache: { kind: "cache_control", longRetention: true } },
      messages: [
        { role: "system", content: [{ type: "text", text: "You are terse." }] },
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      options: { cacheRetention: "long", cache: { breakpoints: [{ location: "system_prompt" }, { location: "last_stable_message" }] } },
    });
    await collectProviderEvents(provider, request);
    assert.deepEqual(bodies[0]?.system, [{ text: "You are terse." }, { cachePoint: { type: "default", ttl: "1h" } }]);
    assert.deepEqual(bodies[0]?.messages, [
      { role: "user", content: [{ text: "first" }] },
      { role: "assistant", content: [{ text: "ok" }, { cachePoint: { type: "default", ttl: "1h" } }] },
      { role: "user", content: [{ text: "hi" }] },
    ]);

    await collectProviderEvents(
      provider,
      textRequest({
        model: { ...MODEL, cache: { kind: "none" } },
        options: { cache: { mode: "on", breakpoints: [{ location: "system_prompt" }] } },
      }),
    );
    assert.equal(bodies[1]?.system, undefined);
    assert.equal(bodies[1]?.messages !== undefined, true);
  });

  it("structured output requires the declared capability and emits a JSON-string schema", async () => {
    const bodies: JsonObject[] = [];
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      fetch: (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(streamOf(eventFrame("messageStop", { stopReason: "end_turn" })), { status: 200 });
      }) as typeof fetch,
    });
    const structuredOutput = {
      name: "answer",
      schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    };
    const capabilityError = await collectProviderEvents(provider, {
      ...textRequest(),
      model: { ...MODEL, capabilities: { structuredOutput: false } },
      options: { structuredOutput },
    });
    assert.equal(capabilityError.at(-1)?.type, "error");

    await collectProviderEvents(provider, {
      ...textRequest(),
      model: { ...MODEL, capabilities: { structuredOutput: "json_schema" } },
      options: { structuredOutput },
    });
    const textFormat = (bodies[0]?.outputConfig as JsonObject | undefined)?.textFormat as JsonObject | undefined;
    assert.equal(textFormat?.type, "json_schema");
    const jsonSchema = (textFormat?.structure as JsonObject | undefined)?.jsonSchema as JsonObject;
    assert.equal(jsonSchema.name, "answer");
    assert.deepEqual(JSON.parse(String(jsonSchema.schema)), structuredOutput.schema);
  });

  it("refuses denied/unknown capabilities before any request is sent", async () => {
    const calls: unknown[] = [];
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      fetch: (async (input) => {
        calls.push(input);
        return new Response(streamOf(), { status: 200 });
      }) as typeof fetch,
    });

    const noStream = await collectProviderEvents(provider, { ...textRequest(), model: { ...MODEL, capabilities: { streaming: false } } });
    assert.match(String((noStream[0] as { error: { message: string } }).error.message), /declares streaming: false/);

    const noTools = await collectProviderEvents(provider, {
      ...textRequest({ tools: [weatherTool] }),
      model: { ...MODEL, capabilities: { tools: false } },
    });
    assert.match(String((noTools[0] as { error: { message: string } }).error.message), /declares tools: false/);

    const noAudio = await collectProviderEvents(provider, {
      ...textRequest(),
      messages: [{ role: "user", content: [{ type: "audio", mediaType: "audio/wav", data: Buffer.from("wav").toString("base64") }] }],
    });
    assert.match(String((noAudio[0] as { error: { message: string } }).error.message), /does not support audio/);

    const noReasoning = await collectProviderEvents(provider, {
      ...textRequest(),
      model: { ...MODEL, capabilities: { reasoning: false } },
      options: { compat: { thinking: true } },
    });
    assert.match(String((noReasoning[0] as { error: { message: string } }).error.message), /declares reasoning: false/);

    assert.deepEqual(calls, [], "capability refusals must not reach the network");
  });

  it("maps reasoning fields and keeps opaque compat off the wire", async () => {
    const bodies: JsonObject[] = [];
    const provider = createBedrockConverseProvider({
      region: "us-east-1",
      credential: CREDENTIAL,
      fetch: (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(streamOf(eventFrame("messageStop", { stopReason: "end_turn" })), { status: 200 });
      }) as typeof fetch,
    });
    await collectProviderEvents(provider, {
      ...textRequest(),
      options: { compat: { thinking: true, route: "hint", bogus: 1 } },
    });
    assert.deepEqual(bodies[0]?.additionalModelRequestFields, {
      thinking: { type: "enabled", budget_tokens: BEDROCK_THINKING_DEFAULT_BUDGET },
    });
    assert.equal(bodies[0]?.route, undefined);
    assert.equal(bodies[0]?.bogus, undefined);

    await collectProviderEvents(provider, {
      ...textRequest(),
      model: { ...MODEL, model: "openai.gpt-5.1", capabilities: { reasoning: true } },
      options: { compat: { reasoning_effort: "xhigh" } },
    });
    assert.deepEqual(bodies[1]?.additionalModelRequestFields, { reasoning_effort: "high" });

    await collectProviderEvents(provider, {
      ...textRequest(),
      model: { ...MODEL, parameters: { top_k: 200, maxTokens: 128 } },
    });
    assert.deepEqual(bodies[2]?.additionalModelRequestFields, { top_k: 200 });
    assert.deepEqual(bodies[2]?.inferenceConfig, { maxTokens: 128 });
  });

  it("converse_body_serializes_multimodal_content", async () => {
    const body = await bedrockConverseBody({
      model: { ...MODEL, capabilities: { input: ["text", "image", "document"] } },
      messages: [
        { role: "system", content: [{ type: "text", text: "be brief" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "why", signature: "sig" },
            { type: "tool_call", id: "tu_1", name: "get_weather", arguments: { city: "Paris" } },
          ],
        },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "tu_1", name: "get_weather", result: { temp: 20 } }] },
        {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: Buffer.from("png").toString("base64") },
            { type: "document", mediaType: "application/pdf", name: "spec.pdf", data: Buffer.from("pdf").toString("base64") },
          ],
        },
      ],
    });
    assert.deepEqual(body.system, [{ text: "be brief" }]);
    assert.deepEqual(body.messages, [
      {
        role: "assistant",
        content: [{ text: "why" }, { toolUse: { toolUseId: "tu_1", name: "get_weather", input: { city: "Paris" } } }],
      },
      { role: "user", content: [{ toolResult: { toolUseId: "tu_1", content: [{ text: '{"temp":20}' }] } }] },
      {
        role: "user",
        content: [
          { image: { format: "png", source: { bytes: Buffer.from("png").toString("base64") } } },
          { document: { format: "pdf", name: "spec.pdf", source: { bytes: Buffer.from("pdf").toString("base64") } } },
        ],
      },
    ]);
  });

  it("package setup selects the route, stays inert, and records the route", async () => {
    const calls: unknown[] = [];
    let registered: string | undefined;
    const pkg = createBedrockProviderPackage({
      region: "us-east-1",
      credential: () => {
        calls.push("credential");
        return CREDENTIAL;
      },
      api: "converse",
      stream: false,
      models: [{ provider: "bedrock", model: "m" }],
      fetch: (async (input) => {
        calls.push(input);
        throw new Error("should not fetch");
      }) as typeof fetch,
    });
    assert.equal(pkg.metadata?.route, "converse");
    await pkg.setup({
      registerProvider: (provider: { id: string }) => {
        registered = provider.id;
      },
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as never);
    assert.equal(registered, "bedrock");
    assert.deepEqual(calls, []);
  });
});

const weatherTool = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: () => ({ toolCallId: "x", name: "get_weather", value: { temp: 20 } }),
};
