import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "bun:test";
import type { JsonObject, Message, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { createOpenRouterProvider, mapOpenRouterModel } from "../index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../../scripts/cache-parity/fixtures/three-turn-coding.json", import.meta.url), "utf8"),
);
const reference = JSON.parse(readFileSync(new URL("./fixtures/pi-request-openrouter.json", import.meta.url), "utf8"));
const tools: ToolDefinition[] = fixture.tools.map((tool: JsonObject) => ({
  ...tool,
  execute: () => ({ name: String(tool.name), toolCallId: "unused" }),
}));
function withoutMovingMarker(value: unknown): unknown {
  if (Array.isArray(value)) {
    const parts = value.map(withoutMovingMarker);
    if (parts.length === 1 && (parts[0] as JsonObject)?.type === "text") return (parts[0] as JsonObject).text;
    return parts;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "cache_control")
      .map(([key, part]) => [key, withoutMovingMarker(part)]),
  );
}
it("cache_levers_match_pi_openrouter", async () => {
  for (const expected of reference.models) {
    const bodies: JsonObject[] = [];
    const provider = createOpenRouterProvider({
      apiKey: async () => "offline-fixture",
      fetch: (async (_url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-session-id"), reference.sessionId);
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    for (const count of fixture.turnMessageCounts) {
      const request: ProviderRequest = {
        model: mapOpenRouterModel({ id: expected.model, context_length: 200000 }),
        messages: [{ role: "system", content: [{ type: "text", text: fixture.system }] }, ...fixture.messages.slice(0, count)] as Message[],
        tools,
        options: { sessionId: reference.sessionId, cacheRetention: "short" },
      };
      await collectProviderEvents(provider, request);
    }
    for (const [index, body] of bodies.entries()) {
      const pi = expected.requests[index];
      assert.equal("prompt_cache_key" in body, false);
      assert.deepEqual(body.tools, pi.tools, `${expected.model} turn ${index + 1} tools`);
      assert.deepEqual(body.messages, pi.messages, `${expected.model} turn ${index + 1} messages / markers / reasoning_details`);
      if (index === 0) continue;
      assert.equal(JSON.stringify(body.tools), JSON.stringify(bodies[index - 1]!.tools), "tools changed on wire");
      const previous = bodies[index - 1]!.messages as JsonObject[];
      const current = body.messages as JsonObject[];
      for (let message = 0; message < previous.length; message++) {
        assert.equal(
          JSON.stringify(withoutMovingMarker(current[message])),
          JSON.stringify(withoutMovingMarker(previous[message])),
          `prefix message ${message} changed (other than moving cache marker)`,
        );
      }
    }
    assert.deepEqual((bodies[2]!.messages as JsonObject[])[2]?.reasoning_details, [JSON.parse(fixture.messages[1].content[0].data)]);
  }
});
