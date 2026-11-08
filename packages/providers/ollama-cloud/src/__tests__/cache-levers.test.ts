import { it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { JsonObject, Message, ToolDefinition } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { createOllamaCloudProvider, ollamaCloudModels } from "../index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../../scripts/cache-parity/fixtures/three-turn-coding.json", import.meta.url), "utf8"),
);
const reference = JSON.parse(readFileSync(new URL("./fixtures/pi-request-ollama-cloud.json", import.meta.url), "utf8"));
const tools: ToolDefinition[] = fixture.tools.map((tool: JsonObject) => ({
  ...tool,
  execute: () => {
    throw new Error("offline fixture tools must not execute");
  },
}));

function assertNoCacheFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /cache|affinity/i, `unexpected cache lever ${key}`);
    assertNoCacheFields(child);
  }
}

it("cache_levers_match_pi_ollama_cloud", async () => {
  const model = ollamaCloudModels.find((entry) => entry.model === reference.model)!;
  for (const route of ["native", "openai"] as const) {
    const bodies: JsonObject[] = [];
    const provider = createOllamaCloudProvider({
      route,
      apiKey: async () => "offline-fixture",
      fetch: (async (url, init) => {
        assert.equal(String(url).endsWith(route === "native" ? "/api/chat" : "/v1/chat/completions"), true);
        for (const name of new Headers(init?.headers).keys()) assert.doesNotMatch(name, /cache|session|affinity/i);
        bodies.push(JSON.parse(String(init?.body)));
        return route === "native"
          ? new Response('{"message":{"content":"OK"},"done":true}\n')
          : new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
              headers: { "content-type": "text/event-stream" },
            });
      }) as typeof fetch,
    });
    for (const count of fixture.turnMessageCounts) {
      await collectProviderEvents(provider, {
        model,
        messages: [
          { id: "system", role: "system", content: [{ type: "text", text: fixture.system }] },
          ...fixture.messages.slice(0, count),
        ] as Message[],
        tools,
        options: {
          sessionId: reference.sessionId,
          cacheKey: reference.sessionId,
          cacheRetention: "long",
          cache: { breakpoints: [{ location: "system_prompt" }, { location: "tools" }, { location: "message_id", messageId: "anchor" }] },
        },
      });
    }
    assert.equal(bodies.length, 3);
    for (const [index, body] of bodies.entries()) {
      const pi = reference.requests[index];
      assertNoCacheFields(pi);
      assertNoCacheFields(body);
      assert.equal(JSON.stringify(body.tools), JSON.stringify(pi.tools), `${route} tools match pi bytes`);
      assert.equal((body.messages as JsonObject[])[0]?.content, fixture.system);
      if (index === 0) continue;
      const previous = bodies[index - 1]!;
      assert.equal(JSON.stringify(body.tools), JSON.stringify(previous.tools), `${route} tools moved`);
      const earlier = previous.messages as JsonObject[];
      assert.equal(
        JSON.stringify((body.messages as JsonObject[]).slice(0, earlier.length)),
        JSON.stringify(earlier),
        `${route} prefix moved`,
      );
    }
  }
});
