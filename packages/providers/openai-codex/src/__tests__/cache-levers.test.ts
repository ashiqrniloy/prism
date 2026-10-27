import { it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { JsonObject, Message, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { createOpenAICodexProvider, openAICodexModels } from "../index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../../scripts/cache-parity/fixtures/three-turn-coding.json", import.meta.url), "utf8"),
);
const reference = JSON.parse(readFileSync(new URL("./fixtures/pi-request-openai-chatgpt.json", import.meta.url), "utf8"));
const model = openAICodexModels.find((entry) => entry.model === reference.model);
assert.ok(model, `reference model ${reference.model} must be in the catalog`);
const tools: ToolDefinition[] = fixture.tools.map((tool: JsonObject) => ({
  ...tool,
  execute: () => ({ name: String(tool.name), toolCallId: "unused" }),
}));

/**
 * The shared plan-203 transcript with the one adaptation this route needs: it replays only an
 * encrypted reasoning item, so the fixture's synthetic `reasoning.text` detail becomes the item pi
 * replays too, wrapped in prism's `{ provider, item }` envelope.
 */
function messagesFor(count: number): Message[] {
  const reasoning = JSON.stringify({ provider: "openai-codex", item: reference.reasoningItem });
  return [
    {
      role: "system",
      content: [{ type: "text", text: fixture.system }],
    },
    ...structuredClone(fixture.messages.slice(0, count)).map((message: JsonObject) => ({
      ...message,
      content: (message.content as JsonObject[]).map((part: JsonObject) =>
        part.type === "thinking" ? { ...part, data: reasoning } : part,
      ),
    })),
  ] as Message[];
}

function bodySystemText(body: JsonObject): string | undefined {
  return typeof body.instructions === "string" ? body.instructions : undefined;
}

it("cache_levers_match_pi_openai_chatgpt", async () => {
  const bodies: JsonObject[] = [];
  const headers: Headers[] = [];
  const provider = createOpenAICodexProvider({
    apiKey: "offline-fixture",
    fetch: (async (_url, init) => {
      headers.push(new Headers(init?.headers));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch,
  });

  for (const [index, count] of fixture.turnMessageCounts.entries()) {
    const request: ProviderRequest = {
      model,
      messages: messagesFor(count),
      tools,
      options: { sessionId: reference.sessionId, compat: { reasoning_effort: "medium" } },
    };
    await collectProviderEvents(provider, request);
  }

  assert.equal(bodies.length, reference.requests.length);
  for (const [index, body] of bodies.entries()) {
    const pi = reference.requests[index].body as JsonObject;
    const label = `turn ${index + 1}`;

    // --- levers identical -------------------------------------------------
    assert.equal(body.model, pi.model, `${label} model`);
    assert.equal(body.stream, true, `${label} stream`);
    assert.equal(body.store, false, `${label} store`);
    assert.deepEqual(body.include, pi.include, `${label} include`);
    assert.deepEqual(body.include, ["reasoning.encrypted_content"], `${label} encrypted reasoning include`);
    assert.deepEqual(body.reasoning, pi.reasoning, `${label} reasoning effort/summary`);
    assert.equal(body.prompt_cache_key, pi.prompt_cache_key, `${label} prompt_cache_key`);
    assert.equal(body.prompt_cache_key, reference.sessionId, `${label} prompt_cache_key value`);
    for (const name of ["session_id", "x-client-request-id"]) {
      assert.equal(headers[index]!.get(name), reference.requests[index].headers[name], `${label} ${name} header`);
      assert.equal(headers[index]!.get(name), reference.sessionId, `${label} ${name} value`);
    }

    // --- refused fields absent, exactly as pi omits them --------------------
    const refused = Object.keys(body).filter((key) =>
      [
        "temperature",
        "top_p",
        "max_output_tokens",
        "prompt_cache_retention",
        "prompt_cache_options",
        "previous_response_id",
        "instructions_override",
      ].includes(key),
    );
    assert.deepEqual(refused, [], `${label} sent a field this route refuses`);
    assert.deepEqual(
      Object.keys(pi).sort(),
      Object.keys(body)
        .sort()
        .filter((key) => key !== "instructions"),
    );

    // --- byte-identical tools and conversation items -----------------------
    assert.equal(JSON.stringify(body.tools), JSON.stringify(pi.tools), `${label} tools`);
    const piInput = pi.input as JsonObject[];
    // The one documented difference: pi carries the prompt as a leading `developer` item, prism as
    // the Responses `instructions` field. The text itself must be identical and appear exactly once.
    assert.equal((piInput[0] as JsonObject).role, "developer");
    assert.equal(bodySystemText(body), (piInput[0] as JsonObject).content, `${label} system prompt text`);
    const piItems = piInput.slice(1);
    assert.deepEqual(body.input, piItems, `${label} input items`);
    assert.equal(JSON.stringify(body.input), JSON.stringify(piItems), `${label} input items stay stable on the wire`);

    // --- the prompt does not move between turns ---------------------------
    if (index === 0) continue;
    assert.equal(body.instructions, bodies[index - 1]!.instructions, "instructions changed between turns");
    assert.equal(JSON.stringify(body.tools), JSON.stringify(bodies[index - 1]!.tools), "tools changed between turns");
    const previous = bodies[index - 1]!.input as JsonObject[];
    const current = body.input as JsonObject[];
    assert.equal(current.length > previous.length, true, "input must grow");
    for (const [position, item] of previous.entries()) {
      assert.deepEqual(current[position], item, `input item ${position} changed between turns`);
    }
  }

  // The replayed reasoning item is the wire item verbatim, in both directions.
  assert.deepEqual((bodies[1]!.input as JsonObject[])[1], reference.reasoningItem);
  assert.deepEqual((bodies[2]!.input as JsonObject[])[1], reference.reasoningItem);
});

it("cache_key_clamp_matches_pi", async () => {
  const keys: Array<string | undefined> = [];
  const provider = createOpenAICodexProvider({
    apiKey: "offline-fixture",
    fetch: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      keys.push(body.prompt_cache_key);
      const headers = new Headers(init?.headers);
      keys.push(headers.get("session_id") ?? undefined, headers.get("x-client-request-id") ?? undefined);
      return new Response(
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch,
  });
  await collectProviderEvents(provider, {
    model,
    messages: messagesFor(fixture.turnMessageCounts[0]),
    tools,
    options: { sessionId: reference.longSessionId.sessionId, compat: { reasoning_effort: "medium" } },
  });
  assert.equal(keys[0], reference.longSessionId.promptCacheKey);
  assert.equal(keys[0]!.length, 64);
  // Affinity keeps the caller's key uncompacted, exactly as pi's `session_id` header does.
  assert.deepEqual(keys.slice(1), [reference.longSessionId.sessionId, reference.longSessionId.sessionId]);
});
