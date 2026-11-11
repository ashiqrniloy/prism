import { it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { JsonObject, Message, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { applyDefaultProviderRequestOptions, collectProviderEvents } from "@arnilo/prism/provider-kit";
import { commandCodeModels, createCommandCodeProvider } from "../index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../../scripts/cache-parity/fixtures/three-turn-coding.json", import.meta.url), "utf8"),
);
const reference = (wire: string): JsonObject =>
  JSON.parse(readFileSync(new URL(`./fixtures/pi-request-${wire}.json`, import.meta.url), "utf8"));
const SESSION = "cache-parity-fixture-205";
const TERMINAL: Readonly<Record<string, string>> = {
  chat: 'data: {"id":"chatcmpl-fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n',
  responses:
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_fixture","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
  messages:
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_fixture","type":"message","role":"assistant","content":[],"model":"fixture","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
};

const TOOL_SCHEMA_DEFAULTS = { properties: {}, required: [] };

/** Prism's tools; the shared fixture declares only `{type: "object"}`. */
function tools(): ToolDefinition[] {
  return fixture.tools.map((tool: JsonObject) => ({ ...tool, execute: () => ({ name: String(tool.name), toolCallId: "unused" }) }));
}

/**
 * The plan-203 transcript with the per-wire thinking adaptation the reference needs:
 * Chat stores `reasoning_details`, Messages an opaque signature, and the Responses wire
 * returns no replayable reasoning item at all (plan 205 Task 1b correction 11).
 */
function messages(wire: string, count: number): Message[] {
  return [
    { role: "system", content: [{ type: "text", text: fixture.system }] },
    ...structuredClone(fixture.messages.slice(0, count)).map((message: JsonObject) => {
      if (message.role !== "assistant") return message;
      return {
        ...message,
        content: (message.content as JsonObject[]).flatMap((part) => {
          if (part.type !== "thinking") return [part];
          if (wire === "responses") return [];
          if (wire === "chat") {
            const detail = { type: "reasoning.text", text: part.text, signature: "fixture-signature", format: "unknown", index: 0 };
            return [{ ...part, data: JSON.stringify(detail), signature: JSON.stringify([detail]) }];
          }
          return [{ ...part, data: "fixture-signature" }];
        }),
      };
    }),
  ] as Message[];
}

interface Capture {
  readonly bodies: JsonObject[];
  readonly headers: Headers[];
}

async function capture(wire: "chat" | "responses" | "messages", sessionId = SESSION): Promise<Capture> {
  const bodies: JsonObject[] = [];
  const headers: Headers[] = [];
  const provider = createCommandCodeProvider({
    apiKey: async () => "offline-fixture-never-used",
    fetch: (async (_url, init) => {
      headers.push(new Headers(init?.headers));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(TERMINAL[wire], { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch,
  });
  const route = wire === "chat" ? "openai" : wire === "responses" ? "responses" : "anthropic";
  const model = commandCodeModels.find((entry) => entry.compat?.route === route);
  assert.ok(model, `a static ${wire} exemplar must exist`);
  for (const count of fixture.turnMessageCounts) {
    const request: ProviderRequest = applyDefaultProviderRequestOptions(
      {
        model,
        messages: messages(wire, count),
        tools: tools(),
        options: { sessionId, compat: { reasoning_effort: "high" } },
      },
      { sessionId },
    );
    await collectProviderEvents(provider, request);
  }
  return { bodies, headers };
}

/** The reference adds JSON-Schema defaults the shared fixture omits; semantics are equal. */
function normalizedTools(value: unknown): unknown {
  return (value as JsonObject[]).map((tool) => {
    const schema = structuredClone((tool.input_schema ?? (tool.function as JsonObject)?.parameters) as Record<string, unknown>);
    for (const [key, fallback] of Object.entries(TOOL_SCHEMA_DEFAULTS)) if (schema[key] === undefined) schema[key] = fallback;
    return { ...tool, input_schema: schema, function: undefined };
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Markers move with the last message on both harnesses (pi recomputes them per turn), so the
 * token prefix is stable while the control field is not. Compare content without them.
 */
function withoutCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCacheControl);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([key]) => key !== "cache_control")
        .map(([key, entry]) => [key, withoutCacheControl(entry)]),
    );
  }
  return value;
}

it("cache_levers_match_pi_commandcode: chat", async () => {
  const pi = reference("chat").requests as { body: JsonObject }[];
  const { bodies } = await capture("chat");
  assert.equal(bodies.length, pi.length);
  assert.equal(fixture.turnMessageCounts.length, pi.length);

  for (const [index, body] of bodies.entries()) {
    const referenceRequest = pi[index];
    assert.ok(referenceRequest);
    const expected = referenceRequest.body;
    // The Chat wire has no cache lever: neither harness sends a cache field or marker.
    for (const name of ["prompt_cache_key", "prompt_cache_retention", "store"]) {
      assert.equal(body[name], undefined, `turn ${index + 1}: Prism sent ${name}`);
      assert.equal(expected[name], undefined, `turn ${index + 1}: reference sent ${name}`);
    }
    assert.equal(stableJson(body).includes('"cache_control"'), false, `turn ${index + 1}: cache markers on chat`);
  }

  // The cached prefix cannot move: system, tools and every earlier message stay byte-identical.
  for (const [index, body] of bodies.entries()) {
    if (index === 0) continue;
    const previous = bodies[index - 1];
    assert.ok(previous);
    assert.equal(
      stableJson((body.messages as JsonObject[])[0]),
      stableJson((previous.messages as JsonObject[])[0]),
      `system changed on turn ${index + 1}`,
    );
    assert.equal(stableJson(body.tools), stableJson(previous.tools), `tools changed on turn ${index + 1}`);
    const prior = previous.messages as JsonObject[];
    assert.equal(
      stableJson(withoutCacheControl((body.messages as JsonObject[]).slice(0, prior.length))),
      stableJson(withoutCacheControl(prior)),
      `earlier message content changed on turn ${index + 1}`,
    );
  }

  // Cross-harness: the shared prompt text and tool definitions are the same bytes.
  const [firstBody, , thirdBody] = bodies;
  const [firstReference, , thirdReference] = pi;
  assert.ok(firstBody);
  assert.ok(thirdBody);
  assert.ok(firstReference);
  assert.ok(thirdReference);
  const [system] = firstBody.messages as JsonObject[];
  const [referenceSystem] = firstReference.body.messages as JsonObject[];
  assert.ok(system);
  assert.ok(referenceSystem);
  assert.equal(system.content, referenceSystem.content);
  const [, userMessage] = thirdBody.messages as JsonObject[];
  const [, referenceUser] = thirdReference.body.messages as JsonObject[];
  assert.ok(userMessage);
  assert.ok(referenceUser);
  const prompt = userMessage.content;
  assert.equal(typeof prompt, "string");
  const [referencePrompt] = referenceUser.content as JsonObject[];
  assert.ok(referencePrompt);
  assert.equal(prompt, referencePrompt.text);
  assert.deepEqual(normalizedTools(thirdBody.tools), normalizedTools(thirdReference.body.tools));
});

it("cache_levers_match_pi_commandcode: responses", async () => {
  const pi = reference("responses").requests as { body: JsonObject; headers: Record<string, string> }[];
  const { bodies, headers } = await capture("responses");
  assert.equal(bodies.length, pi.length);

  for (const [index, body] of bodies.entries()) {
    const referenceRequest = pi[index];
    assert.ok(referenceRequest);
    const expected = referenceRequest.body;
    // Explicit-cache pricing: same key, same store flag, same include list, same affinity header.
    assert.equal(body.prompt_cache_key, SESSION, `turn ${index + 1}: prompt_cache_key`);
    assert.equal(body.prompt_cache_key, expected.prompt_cache_key, `turn ${index + 1}: prompt_cache_key vs reference`);
    assert.equal(body.store, false, `turn ${index + 1}: store`);
    assert.equal(body.store, expected.store, `turn ${index + 1}: store vs reference`);
    assert.deepEqual(body.include, expected.include, `turn ${index + 1}: include`);
    const requestHeaders = headers[index];
    assert.ok(requestHeaders);
    assert.equal(requestHeaders.get("x-client-request-id") ?? undefined, SESSION, `turn ${index + 1}: affinity header`);
    assert.equal(
      requestHeaders.get("x-client-request-id") ?? undefined,
      referenceRequest.headers["x-client-request-id"],
      `turn ${index + 1}: affinity header vs reference`,
    );
    // The prompt sits in `instructions` on both wires (the reference fixture keeps it as input[0]).
    const [referenceInstructions] = expected.input as JsonObject[];
    assert.ok(referenceInstructions);
    assert.equal(body.instructions, referenceInstructions.content, `turn ${index + 1}: instructions text`);
  }

  for (const [index, body] of bodies.entries()) {
    if (index === 0) continue;
    const previous = bodies[index - 1];
    assert.ok(previous);
    assert.equal(body.instructions, previous.instructions, `instructions changed on turn ${index + 1}`);
    assert.equal(stableJson(body.tools), stableJson(previous.tools), `tools changed on turn ${index + 1}`);
    const prior = previous.input as JsonObject[];
    assert.equal(
      stableJson((body.input as JsonObject[]).slice(0, prior.length)),
      stableJson(prior),
      `earlier input changed on turn ${index + 1}`,
    );
  }

  // The 104-character session id keeps the 64-character key and the full affinity header, as the reference does.
  const long = `${"cache-parity-".padEnd(103, "x")}-long`;
  const clamped = await capture("responses", long);
  const [clampedBody] = clamped.bodies;
  const [clampedHeaders] = clamped.headers;
  assert.ok(clampedBody);
  assert.ok(clampedHeaders);
  const cacheKey = clampedBody.prompt_cache_key;
  assert.ok(typeof cacheKey === "string");
  assert.equal(cacheKey.length, 64);
  assert.equal(clampedHeaders.get("x-client-request-id"), long);
  assert.deepEqual(clampedBody.include, ["reasoning.encrypted_content"]);
});

it("cache_levers_match_pi_commandcode: messages", async () => {
  const pi = reference("messages").requests as { body: JsonObject }[];
  const { bodies } = await capture("messages");
  assert.equal(bodies.length, pi.length);

  const markers = (body: JsonObject): string[] => {
    const found: string[] = [];
    for (const block of (body.system as JsonObject[] | undefined) ?? []) if (block.cache_control) found.push(`system:${block.type}`);
    for (const [index, message] of (body.messages as JsonObject[]).entries())
      for (const block of message.content as JsonObject[]) if (block.cache_control) found.push(`message:${index}:${block.type}`);
    for (const tool of (body.tools as JsonObject[] | undefined) ?? []) if (tool.cache_control) found.push(`tool:${String(tool.name)}`);
    return found;
  };

  for (const [index, body] of bodies.entries()) {
    const referenceRequest = pi[index];
    assert.ok(referenceRequest);
    const expected = referenceRequest.body;
    // Explicit cache: the system prompt and the last message carry one ephemeral marker each,
    // earlier messages and tool definitions carry none, and no TTL is requested.
    assert.deepEqual(markers(body), markers(expected), `turn ${index + 1}: cache_control placement`);
    const last = (body.messages as JsonObject[]).at(-1);
    assert.ok(last);
    const lastBlock = (last.content as JsonObject[]).at(-1);
    assert.ok(lastBlock);
    assert.deepEqual(markers(body), ["system:text", `message:${(body.messages as JsonObject[]).length - 1}:${String(lastBlock.type)}`]);
    assert.equal(stableJson(body).includes('"ttl"'), false, `turn ${index + 1}: ttl`);
    for (const name of ["prompt_cache_key", "store"]) assert.equal(body[name], undefined, `turn ${index + 1}: ${name}`);
    assert.deepEqual(body.thinking, expected.thinking, `turn ${index + 1}: thinking object`);
    assert.deepEqual(body.output_config, expected.output_config, `turn ${index + 1}: output_config effort`);
    assert.equal((body.output_config as JsonObject).effort, "high");
  }

  for (const [index, body] of bodies.entries()) {
    if (index === 0) continue;
    const previous = bodies[index - 1];
    assert.ok(previous);
    assert.equal(stableJson(body.system), stableJson(previous.system), `system changed on turn ${index + 1}`);
    assert.equal(stableJson(body.tools), stableJson(previous.tools), `tools changed on turn ${index + 1}`);
    const prior = previous.messages as JsonObject[];
    assert.equal(
      stableJson(withoutCacheControl((body.messages as JsonObject[]).slice(0, prior.length))),
      stableJson(withoutCacheControl(prior)),
      `earlier message content changed on turn ${index + 1}`,
    );
  }

  // Cross-harness: the stable system prompt and tools are the same content.
  const [firstBody] = bodies;
  const [firstReference] = pi;
  assert.ok(firstBody);
  assert.ok(firstReference);
  const [system] = firstBody.system as JsonObject[];
  const [referenceSystem] = firstReference.body.system as JsonObject[];
  assert.ok(system);
  assert.ok(referenceSystem);
  assert.equal(system.text, referenceSystem.text);
  assert.deepEqual(normalizedTools(firstBody.tools), normalizedTools(firstReference.body.tools));
});
