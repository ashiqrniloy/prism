import { it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { JsonObject, Message, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { createKiloProvider, KILO_TASK_ID_HEADER, kiloModels } from "../index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../../scripts/cache-parity/fixtures/three-turn-coding.json", import.meta.url), "utf8"),
);

type Wire = "chat" | "responses" | "messages";

function reference(wire: Wire): {
  request: { status: number; headers: Record<string, string>; body: JsonObject };
} {
  return JSON.parse(readFileSync(new URL(`./fixtures/kilo-cli-request-${wire}.json`, import.meta.url), "utf8"));
}

const TERMINAL: Readonly<Record<Wire, string>> = {
  chat: 'data: {"id":"chatcmpl-fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2,"cost":0}}\n\ndata: [DONE]\n\n',
  responses:
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_fixture","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"cost":0}}}\n\n',
  messages:
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_fixture","type":"message","role":"assistant","content":[],"model":"fixture","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
};

const MODELS: Readonly<Record<Wire, (typeof kiloModels)[number]>> = {
  chat: kiloModels[0]!,
  responses: kiloModels[1]!,
  messages: kiloModels[2]!,
};

function tools(): ToolDefinition[] {
  return fixture.tools.map((tool: JsonObject) => ({ ...tool, execute: () => ({ name: String(tool.name), toolCallId: "unused" }) }));
}

/** The plan-203 transcript without the fixture's synthetic, non-replayable thinking blocks. */
function messages(count: number): Message[] {
  return [
    { role: "system", content: [{ type: "text", text: fixture.system }] },
    ...structuredClone(fixture.messages.slice(0, count)).map((message: JsonObject) => ({
      ...message,
      content: (message.content as JsonObject[]).filter((part) => part.type !== "thinking"),
    })),
  ] as Message[];
}

interface Capture {
  readonly bodies: JsonObject[];
  readonly headers: Headers[];
}

async function capture(wire: Wire): Promise<Capture> {
  const bodies: JsonObject[] = [];
  const headers: Headers[] = [];
  const sessionId = reference(wire).request.headers[KILO_TASK_ID_HEADER.toLowerCase()]!;
  assert.match(sessionId, /^ses_[A-Za-z0-9]+$/, `${wire}: fixture carries the CLI task id`);
  const provider = createKiloProvider({
    apiKey: async () => "offline-fixture-never-used",
    fetch: (async (_url, init) => {
      headers.push(new Headers(init?.headers));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(TERMINAL[wire], { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch,
  });
  for (const count of fixture.turnMessageCounts) {
    const request: ProviderRequest = {
      model: MODELS[wire],
      messages: messages(count),
      tools: tools(),
      options: { sessionId, cacheRetention: "short" },
    };
    await collectProviderEvents(provider, request);
  }
  return { bodies, headers };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function withoutCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCacheControl);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([key]) => key !== "cache_control" && key !== "prompt_cache_breakpoint")
        .map(([key, entry]) => [key, withoutCacheControl(entry)]),
    );
  }
  return value;
}

function assertTaskId(wire: Wire, headers: readonly Headers[]): void {
  const expected = reference(wire).request.headers[KILO_TASK_ID_HEADER.toLowerCase()]!;
  for (const [index, header] of headers.entries())
    assert.equal(header.get(KILO_TASK_ID_HEADER), expected, `${wire}: task id on turn ${index + 1}`);
}

function assertStablePrefix(wire: Wire, bodies: readonly JsonObject[], systemField: "messages" | "instructions" | "input"): void {
  for (const [index, body] of bodies.entries()) {
    if (index === 0) continue;
    const previous = bodies[index - 1]!;
    if (systemField === "messages") {
      assert.equal(stableJson(body.system), stableJson(previous.system), `${wire}: system changed on turn ${index + 1}`);
      assert.equal(stableJson(body.tools), stableJson(previous.tools), `${wire}: tools changed on turn ${index + 1}`);
      const prior = previous.messages as JsonObject[];
      assert.equal(
        stableJson(withoutCacheControl((body.messages as JsonObject[]).slice(0, prior.length))),
        stableJson(withoutCacheControl(prior)),
        `${wire}: earlier message changed on turn ${index + 1}`,
      );
      continue;
    }
    assert.equal(stableJson(body[systemField]), stableJson(previous[systemField]), `${wire}: system changed on turn ${index + 1}`);
    assert.equal(stableJson(body.tools), stableJson(previous.tools), `${wire}: tools changed on turn ${index + 1}`);
    const prior = previous.input as JsonObject[];
    assert.equal(
      stableJson((body.input as JsonObject[]).slice(0, prior.length)),
      stableJson(prior),
      `${wire}: earlier input changed on turn ${index + 1}`,
    );
  }
}

function messageMarkers(body: JsonObject): string[] {
  const found: string[] = [];
  (body.system as JsonObject[] | undefined)?.forEach((part, index) => {
    if (part.cache_control) found.push(`system:${index}:${String((part.cache_control as JsonObject).type)}`);
  });
  (body.messages as JsonObject[] | undefined)?.forEach((message, messageIndex) => {
    (message.content as JsonObject[] | undefined)?.forEach((part, partIndex) => {
      if (part.cache_control) found.push(`message:${messageIndex}:${partIndex}:${String((part.cache_control as JsonObject).type)}`);
    });
  });
  (body.tools as JsonObject[] | undefined)?.forEach((tool, index) => {
    if (tool.cache_control) found.push(`tool:${index}`);
  });
  return found;
}

/** The CLI's default placement: the first two system messages and the last two non-system messages. */
function expectedMessageMarkers(body: JsonObject): string[] {
  const found: string[] = [];
  const system = body.system as JsonObject[] | undefined;
  system?.slice(0, 2).forEach((part, index) => {
    if (Array.isArray(part.content) ? part.content.length > 0 : Boolean(part.text)) found.push(`system:${index}:ephemeral`);
  });
  const conversation = body.messages as JsonObject[] | undefined;
  conversation?.slice(-2).forEach((message) => {
    const index = conversation.indexOf(message);
    const content = message.content as JsonObject[] | undefined;
    // The CLI skips a trailing environment block and marks the last stable part.
    let part = content && content.length > 0 ? content.length - 1 : -1;
    while (
      part >= 0 &&
      String((content![part] as JsonObject).text ?? "")
        .trimStart()
        .startsWith("<environment_details>")
    )
      part -= 1;
    if (part >= 0) found.push(`message:${index}:${part}:ephemeral`);
  });
  return found;
}

it("cache_levers_match_kilo_cli: chat", async () => {
  const pi = reference("chat").request;
  const { bodies, headers } = await capture("chat");
  assert.equal(bodies.length, fixture.turnMessageCounts.length);
  assertTaskId("chat", headers);
  assert.equal(headers[0]!.get("authorization"), "Bearer offline-fixture-never-used");

  for (const [index, body] of bodies.entries()) {
    for (const name of ["prompt_cache_key", "prompt_cache_breakpoint", "store"]) {
      assert.equal(body[name], undefined, `chat turn ${index + 1}: Prism sent ${name}`);
      assert.equal(pi.body[name], undefined, `chat reference sent ${name}`);
    }
    assert.equal(stableJson(body).includes('"cache_control"'), false, `chat turn ${index + 1}: cache markers`);
  }
  assertStablePrefix("chat", bodies, "messages");
});

it("cache_levers_match_kilo_cli: responses", async () => {
  const pi = reference("responses").request;
  const { bodies, headers } = await capture("responses");
  assert.equal(bodies.length, fixture.turnMessageCounts.length);
  assertTaskId("responses", headers);

  for (const [index, body] of bodies.entries()) {
    // The CLI sends no prompt_cache_key on this route. Its GPT-5.6+ explicit
    // prompt_cache_breakpoint is a content marker, not a key, and the gateway
    // places its own breakpoints, so Prism sends neither.
    assert.equal(body.prompt_cache_key, undefined, `responses turn ${index + 1}: prompt_cache_key`);
    assert.equal(pi.body.prompt_cache_key, undefined, "responses reference prompt_cache_key");
    assert.equal(body.prompt_cache_breakpoint, undefined, `responses turn ${index + 1}: top-level breakpoint`);
    assert.equal(body.store, false, `responses turn ${index + 1}: store`);
    assert.equal(body.store, pi.body.store, `responses turn ${index + 1}: store vs reference`);
  }
  assertStablePrefix("responses", bodies, "instructions");
});

it("cache_levers_match_kilo_cli: messages", async () => {
  const pi = reference("messages").request;
  const { bodies, headers } = await capture("messages");
  assert.equal(bodies.length, fixture.turnMessageCounts.length);
  assertTaskId("messages", headers);

  for (const [index, body] of bodies.entries()) {
    const actual = messageMarkers(body);
    assert.deepEqual(actual, expectedMessageMarkers(body), `messages turn ${index + 1}: marker placement`);
    assert.equal(actual.filter((marker) => marker.startsWith("system:")).length, 1, `messages turn ${index + 1}: system marker`);
    assert.equal(
      actual.filter((marker) => marker.startsWith("message:")).length,
      expectedMessageMarkers(body).filter((marker) => marker.startsWith("message:")).length,
      `messages turn ${index + 1}: cacheable message markers`,
    );
    assert.equal(
      actual.some((marker) => marker.startsWith("tool:")),
      false,
      `messages turn ${index + 1}: tool marker`,
    );
    assert.equal(stableJson(body).includes('"ttl"'), false, `messages turn ${index + 1}: ttl`);
    for (const name of ["prompt_cache_key", "store"]) assert.equal(body[name], undefined, `messages turn ${index + 1}: ${name}`);
  }

  // The reference is the CLI's paid Claude request captured before its 402: same placement,
  // same marker type, and no TTL or tool marker.
  assert.deepEqual(messageMarkers(pi.body), expectedMessageMarkers(pi.body), "reference marker placement");
  assert.deepEqual(messageMarkers(pi.body), ["system:0:ephemeral", "message:0:0:ephemeral"]);
  assert.equal(stableJson(pi.body).includes('"ttl"'), false, "reference ttl");
  assertStablePrefix("messages", bodies, "messages");
});
