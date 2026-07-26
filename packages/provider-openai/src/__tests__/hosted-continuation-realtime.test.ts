import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, ModelConfig, ProviderEvent, ProviderRequest, RealtimeEvent } from "@arnilo/prism";
import { createOpenAIRealtimeSession, createOpenAIResponsesProvider, type RealtimeTransport } from "../index.js";

const model: ModelConfig = { provider: "openai", model: "gpt-5.1" };
const baseRequest: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "search the web" }] }],
};

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
function ok(body: ReadableStream<Uint8Array>): Response { return new Response(body, { status: 200 }); }

async function collect(provider: AIProvider, request: ProviderRequest): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of provider.generate(request)) out.push(event);
  return out;
}

describe("@arnilo/prism-provider-openai hosted tools", () => {
  it("web_search_call emits a provider-hosted tool_call (no host dispatch, no tool_result)", async () => {
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async () => ok(sse([
        { type: "response.output_item.added", output_index: 0, item: { type: "web_search_call", id: "ws_1" } },
        { type: "response.output_text.delta", delta: "result: " },
        { type: "response.output_text.delta", delta: "42" },
        { type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ]))) as typeof fetch,
    });
    const events = await collect(provider, baseRequest);
    const hosted = events.filter((e) => e.type === "tool_call") as Extract<ProviderEvent, { type: "tool_call" }>[];
    assert.equal(hosted.length, 1, "exactly one hosted tool_call");
    assert.equal(hosted[0]!.call.authority, "provider-hosted");
    assert.equal(hosted[0]!.call.name, "web_search_call");
    assert.equal(hosted[0]!.call.id, "ws_1");
    assert.deepEqual(hosted[0]!.call.arguments, {});
    // No function_call tool_call (host tool) present; core agent-loop coverage verifies
    // this authority is neither dispatched nor followed by a tool_result.
    assert.equal(events.filter((e) => e.type === "tool_call" && (e as Extract<ProviderEvent, { type: "tool_call" }>).call.authority !== "provider-hosted").length, 0);
  });

  it("hosted assistant tool_call is not re-serialized as function_call on the next turn", async () => {
    let body: unknown;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([{ type: "response.completed", response: { id: "resp_2", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]));
      }) as typeof fetch,
    });
    await collect(provider, {
      ...baseRequest,
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "ws_1", name: "web_search_call", arguments: {}, authority: "provider-hosted" } as never] },
        { role: "assistant", content: [{ type: "text", text: "result: 42" }] },
      ],
    });
    const input = (body as { input: { type: string }[] }).input;
    assert.ok(!input.some((item) => item.type === "function_call"), "hosted tool_call must not be re-serialized as function_call");
  });
});

describe("@arnilo/prism-provider-openai response continuation", () => {
  it("incomplete response emits continuation_required and self-continues with previous_response_id (bounded)", async () => {
    const calls: string[] = [];
    let hop = 0;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        hop += 1;
        calls.push(hop.toString());
        const parsed = JSON.parse(String(init?.body)) as { previous_response_id?: string; input?: unknown[] };
        if (hop === 1) {
          return ok(sse([
            { type: "response.output_text.delta", delta: "part1 " },
            { type: "response.completed", response: { id: "resp_A", status: "incomplete", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
          ]));
        }
        assert.equal(parsed.previous_response_id, "resp_A", "second hop must resume from the cursor");
        assert.deepEqual(parsed.input, [], "cursor resumption must not replay prompt history");
        return ok(sse([
          { type: "response.output_text.delta", delta: "part2" },
          { type: "response.completed", response: { id: "resp_B", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
        ]));
      }) as typeof fetch,
    });
    const events = await collect(provider, baseRequest);
    const continuations = events.filter((e) => e.type === "continuation_required") as Extract<ProviderEvent, { type: "continuation_required" }>[];
    assert.equal(continuations.length, 1, "exactly one continuation_required");
    assert.equal(continuations[0]!.cursor, "resp_A");
    assert.equal(continuations[0]!.reason, "incomplete");
    assert.equal(calls.length, 2, "exactly two HTTP hops");
    assert.ok(events.some((e) => e.type === "content_delta" && e.content.type === "text" && e.content.text === "part1 "));
    assert.ok(events.some((e) => e.type === "content_delta" && e.content.type === "text" && e.content.text === "part2"));
    assert.equal(events[events.length - 1]!.type, "done");
  });

  it("options.continuation.cursor seeds the first hop", async () => {
    let firstBody: { previous_response_id?: string; input?: unknown[] } | undefined;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        if (!firstBody) firstBody = JSON.parse(String(init?.body)) as { previous_response_id?: string; input?: unknown[] };
        return ok(sse([{ type: "response.completed", response: { id: "resp_C", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]));
      }) as typeof fetch,
    });
    await collect(provider, { ...baseRequest, options: { continuation: { cursor: "resp_seed" } } });
    assert.equal(firstBody!.previous_response_id, "resp_seed");
    assert.deepEqual(firstBody!.input, []);
  });

  it("continuation hop cap (8) fail-closed on runaway incomplete loop", async () => {
    let hop = 0;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async () => {
        hop += 1;
        return ok(sse([
          { type: "response.output_text.delta", delta: "x" },
          { type: "response.completed", response: { id: `resp_${hop}`, status: "incomplete", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
        ]));
      }) as typeof fetch,
    });
    const events = await collect(provider, baseRequest);
    const continuations = events.filter((e) => e.type === "continuation_required");
    assert.equal(continuations.length, 8, "exactly 8 continuation_required events then stop");
    assert.equal(hop, 8, "no more than maxHops HTTP calls");
    assert.equal(events[events.length - 1]!.type, "error", "hop cap is terminal, never silently truncated");
  });

  it("abort after continuation telemetry prevents the next HTTP hop", async () => {
    const abort = new AbortController();
    let calls = 0;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async () => {
        calls += 1;
        return ok(sse([{ type: "response.completed", response: { id: "resp_abort", status: "incomplete" } }]));
      }) as typeof fetch,
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({ ...baseRequest, signal: abort.signal })) {
      events.push(event);
      if (event.type === "continuation_required") abort.abort(new Error("stop"));
    }
    assert.equal(calls, 1);
    assert.equal(events[events.length - 1]!.type, "error");
  });

  it("rejects duplicate and oversized opaque cursors before a runaway resume", async () => {
    let calls = 0;
    const provider = createOpenAIResponsesProvider({
      apiKey: "fake-key",
      fetch: (async () => {
        calls += 1;
        return ok(sse([{ type: "response.completed", response: { id: "resp_seed", status: "incomplete" } }]));
      }) as typeof fetch,
    });
    const duplicate = await collect(provider, { ...baseRequest, options: { continuation: { cursor: "resp_seed" } } });
    assert.equal(calls, 1);
    assert.equal(duplicate[duplicate.length - 1]!.type, "error");
    const oversized = await collect(provider, { ...baseRequest, options: { continuation: { cursor: "x".repeat(4_097) } } });
    assert.equal(calls, 1, "oversized cursor must fail before fetch");
    assert.equal(oversized[0]!.type, "error");
  });
});

describe("@arnilo/prism-provider-openai realtime session", () => {
  function fakeTransport(): {
    transport: RealtimeTransport;
    emit: (type: "open" | "message" | "close" | "error", data?: string) => void;
    sent: string[];
    connection?: { url: string; headers: Readonly<Record<string, string>> };
  } {
    const sent: string[] = [];
    const handlers = new Map<string, Array<(e: { data?: string }) => void>>();
    let state = 1; // OPEN
    const transport: RealtimeTransport = {
      get readyState() { return state; },
      send: (data: string) => { sent.push(data); },
      close: () => { state = 3; for (const h of handlers.get("close") ?? []) h({}); },
      addEventListener: (type: "open" | "message" | "close" | "error", h: (e: { data?: string }) => void) => {
        (handlers.get(type) ?? handlers.set(type, []).get(type)!).push(h);
      },
      removeEventListener: () => {},
    };
    return { transport, sent, emit: (type: "open" | "message" | "close" | "error", data?: string) => { for (const h of handlers.get(type) ?? []) h({ data }); } };
  }

  async function start(session: ReturnType<typeof createOpenAIRealtimeSession>, fake: ReturnType<typeof fakeTransport>): Promise<{ iter: AsyncIterator<RealtimeEvent>; started: RealtimeEvent }> {
    const iter = session.events()[Symbol.asyncIterator]();
    const first = iter.next();
    await new Promise((r) => setTimeout(r, 0));
    fake.emit("open");
    fake.emit("message", JSON.stringify({ type: "session.created", session: { id: "server_session_1" } }));
    return { iter, started: (await first).value };
  }

  it("session_started + audio_delta decode + interrupt sends response.cancel + close is idempotent", async () => {
    const fake = fakeTransport();
    const session = createOpenAIRealtimeSession({
      model,
      ownerId: "owner_1",
      apiKey: "fake-key",
      webSocket: (url, options) => { fake.connection = { url, headers: options.headers }; return fake.transport; },
    });
    const { iter, started } = await start(session, fake);
    const events: RealtimeEvent[] = [started];
    fake.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.from([1, 2, 3]).toString("base64") }));
    events.push((await iter.next()).value);
    await session.interrupt();
    events.push((await iter.next()).value);
    await session.close("done");
    events.push((await iter.next()).value);
    await session.close("again"); // idempotent
    assert.equal(events[0]!.type, "session_started");
    assert.equal((events[0] as Extract<RealtimeEvent, { type: "session_started" }>).sessionId, "server_session_1");
    const audio = events.find((e) => e.type === "audio_delta") as Extract<RealtimeEvent, { type: "audio_delta" }> | undefined;
    assert.ok(audio, "audio_delta emitted");
    assert.deepEqual(Array.from(audio!.audio), [1, 2, 3]);
    assert.ok(events.some((e) => e.type === "interrupted"), "interrupted event");
    assert.equal(events[events.length - 1]!.type, "session_closed");
    assert.ok(fake.sent.some((s) => s.includes("response.cancel")), "response.cancel sent");
    assert.equal(fake.connection!.headers.Authorization, "Bearer fake-key");
    assert.equal(fake.connection!.headers["OpenAI-Safety-Identifier"], "owner_1");
    assert.ok(!fake.connection!.url.includes("fake-key"), "credentials stay out of WebSocket URL");
  });

  it("sendAudio sends input_audio_buffer.append with base64 payload", async () => {
    const fake = fakeTransport();
    const session = createOpenAIRealtimeSession({ model, ownerId: "owner_1", apiKey: "fake-key", webSocket: () => fake.transport });
    await start(session, fake);
    await session.sendAudio(new Uint8Array([10, 20, 30]));
    const append = fake.sent.find((s) => s.includes("input_audio_buffer.append"));
    assert.ok(append, "append event sent");
    const parsed = JSON.parse(append!) as { audio: string };
    assert.deepEqual(Array.from(Buffer.from(parsed.audio, "base64")), [10, 20, 30]);
    await session.close();
  });

  it("audio event cap fail-closed (maxAudioEventsPerSecond=2)", async () => {
    const fake = fakeTransport();
    const session = createOpenAIRealtimeSession({
      model,
      ownerId: "owner_1",
      apiKey: "fake-key",
      webSocket: () => fake.transport,
      caps: { maxAudioEventsPerSecond: 2, maxBytesPerSecond: 1_048_576, maxWallMs: 600_000 },
    });
    await start(session, fake);
    await session.sendAudio(new Uint8Array([1]));
    await session.sendAudio(new Uint8Array([1]));
    await assert.rejects(() => session.sendAudio(new Uint8Array([1])), /audio cap|closed/i);
  });

  it("byte and wall-time caps fail closed", async () => {
    const bytesFake = fakeTransport();
    const bytesSession = createOpenAIRealtimeSession({
      model,
      ownerId: "owner_bytes",
      apiKey: "fake-key",
      webSocket: () => bytesFake.transport,
      caps: { maxAudioEventsPerSecond: 256, maxBytesPerSecond: 1, maxWallMs: 600_000 },
    });
    await start(bytesSession, bytesFake);
    await assert.rejects(() => bytesSession.sendAudio(new Uint8Array([1, 2])), /byte cap|closed/i);

    const wallFake = fakeTransport();
    const wallSession = createOpenAIRealtimeSession({
      model,
      ownerId: "owner_wall",
      apiKey: "fake-key",
      webSocket: () => wallFake.transport,
      caps: { maxAudioEventsPerSecond: 256, maxBytesPerSecond: 1_048_576, maxWallMs: 20 },
    });
    const { iter } = await start(wallSession, wallFake);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await iter.next()).value.type, "error");
    assert.equal((await iter.next()).value.type, "session_closed");
  });

  it("limits concurrent sessions to one host ownership scope", async () => {
    const firstFake = fakeTransport();
    const first = createOpenAIRealtimeSession({ model, ownerId: "owner_shared", apiKey: "fake-key", webSocket: () => firstFake.transport });
    await start(first, firstFake);
    const second = createOpenAIRealtimeSession({ model, ownerId: "owner_shared", apiKey: "fake-key", webSocket: () => fakeTransport().transport });
    await assert.rejects(() => second.events()[Symbol.asyncIterator]().next(), /already active/i);
    await first.close();
  });

  it("disconnect fails closed and credentials never appear in realtime events", async () => {
    const fake = fakeTransport();
    const session = createOpenAIRealtimeSession({ model, ownerId: "owner_1", apiKey: "super-secret-key", webSocket: () => fake.transport });
    const { iter, started } = await start(session, fake);
    const events: RealtimeEvent[] = [started];
    fake.emit("message", JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "super-secret-key hello" }));
    events.push((await iter.next()).value);
    fake.emit("close");
    events.push((await iter.next()).value);
    assert.equal(events[events.length - 1]!.type, "session_closed");
    assert.ok(!JSON.stringify(events).includes("super-secret-key"), "api key must not leak into realtime events");
    await assert.rejects(() => session.sendAudio(new Uint8Array([1])), /closed/i);
  });
});