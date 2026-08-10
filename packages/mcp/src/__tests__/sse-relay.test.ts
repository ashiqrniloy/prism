import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrismMcpServer, createPrismMcpWebHandler, relayStatelessBody } from "../server.js";

const enc = new TextEncoder();

test("relayStatelessBody forwards chunks in order and closes once on completion", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode("data: a\n\n"));
      controller.enqueue(enc.encode("data: b\n\n"));
      controller.close();
    },
  });
  let closed = 0;
  const response = relayStatelessBody(body, () => {
    closed += 1;
  });
  assert.ok(response, "non-null body yields a relayed Response");
  assert.equal(await new Response(response.body).text(), "data: a\n\ndata: b\n\n");
  assert.equal(closed, 1, "onClose fired exactly once on body completion");
});

test("relayStatelessBody cancels the underlying body and closes exactly once on consumer cancel", async () => {
  let sourceCancelled = 0;
  let emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      emitted += 1;
      if (emitted === 1) controller.enqueue(enc.encode("data: first\n\n"));
      // Never completes: a pending body, like a long-lived SSE stream.
    },
    cancel() {
      sourceCancelled += 1;
    },
  });
  let closed = 0;
  const response = relayStatelessBody(body, () => {
    closed += 1;
  });
  assert.ok(response);
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.deepEqual(first.value, enc.encode("data: first\n\n"));
  await reader.cancel("test cancel");
  assert.equal(closed, 1, "onClose fired exactly once on cancel");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sourceCancelled, 1, "underlying body canceled");
});

test("relayStatelessBody closes immediately for a null body", () => {
  let closed = 0;
  const response = relayStatelessBody(null, () => {
    closed += 1;
  });
  assert.equal(response, null);
  assert.equal(closed, 1, "onClose fired immediately for a null body");
});

test("stateless web handler relays a bounded response and closes the per-request server on body completion", async () => {
  const closed: string[] = [];
  const handler = await createPrismMcpWebHandler(() => {
    const server = createPrismMcpServer({ authorize: () => ({ allowed: true }) });
    return new Proxy(server, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "close" && typeof value === "function") {
          return (...args: unknown[]) => {
            closed.push("server.close");
            return Reflect.apply(value, target, args);
          };
        }
        return value;
      },
    });
  });
  const response = await handler(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /prism-mcp-server/);
  assert.ok(closed.includes("server.close"), "per-request server close() fired when the relayed body completed");
});
