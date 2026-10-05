import { createAgent } from "@arnilo/prism";
import { anthropic } from "@arnilo/prism-provider-anthropic";

/**
 * Provider-package model switching (roadmap Phase 5): one `@arnilo/prism-provider-anthropic`
 * package, two models, no host provider.
 *
 * The package is listed with an `env:` key ref that this example sets in-process, and a `baseUrl`
 * pointing at a local fake Messages endpoint. The first turn runs the configured
 * `anthropic/claude-sonnet-4-5`; the second passes `RunOptions.model` for
 * `anthropic/claude-haiku-4-5`, and the same registered provider serves it — the ref resolves per
 * request, so a switched or rotated key needs no rebuild. The fake endpoint requires `x-api-key`,
 * so a turn only completes if the credentials slot resolved the ref. Imports only `@arnilo/prism`
 * and the provider package. Network-free (loopback only).
 * Run: npm run build:core && bun examples/anthropic-model-switch.ts
 */

const KEY = "local-demo-key-1234";
const SONNET = "anthropic/claude-sonnet-4-5";
const HAIKU = "anthropic/claude-haiku-4-5";

// Bun-only demo (the examples tsconfig is Node-typed): the one Bun global this file uses.
declare const Bun: {
  serve(options: { port: number; fetch: (request: Request) => Response | Promise<Response> }): {
    readonly url: string;
    stop(closeActiveConnections?: boolean): void;
  };
};

/** Anthropic Messages SSE: a text block, a stop reason with usage, then `message_stop`. */
function messagesStream(text: string): ReadableStream<Uint8Array> {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } },
    { type: "message_stop" },
  ];
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

export async function demo(): Promise<Record<string, unknown>> {
  process.env.EXAMPLE_ANTHROPIC_KEY = KEY;
  const seenModels: string[] = [];
  let sawKey = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/messages") return new Response("not found", { status: 404 });
      if (request.headers.get("x-api-key") !== KEY) return new Response("unauthorized", { status: 401 });
      sawKey = true;
      const body = (await request.json()) as { model?: string };
      seenModels.push(body.model ?? "");
      return new Response(messagesStream(`Hello from ${body.model ?? "the fake endpoint"}.`), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  try {
    const agent = await createAgent({
      id: "anthropic-model-switch-demo",
      model: SONNET,
      packages: [anthropic({ apiKey: "env:EXAMPLE_ANTHROPIC_KEY", baseUrl: String(server.url) })],
    });
    const session = await agent.session();
    const first = await session.run("Say hello");
    const second = await session.run("And once more", { model: HAIKU });
    await agent.dispose();
    if (!sawKey) throw new Error("the fake endpoint never saw the API key");
    if (`${first.text}${second.text}`.includes(KEY)) throw new Error("the reply leaked the key");
    return {
      models: seenModels,
      text: [first.text, second.text],
      status: [first.status, second.status],
      sawKey,
    };
  } finally {
    server.stop(true);
    delete process.env.EXAMPLE_ANTHROPIC_KEY;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
