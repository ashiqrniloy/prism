import { createAgent } from "@arnilo/prism";

/**
 * The kernel's built-in `openai-compatible` provider against a local fake endpoint (roadmap Phase 5).
 *
 * No package is listed: `openai-compatible` ships with the kernel. The `ModelSpec` object carries the
 * `baseUrl` and an `env:` credential ref; the provider resolves the ref through the `credentials` slot on
 * every request. The fake endpoint requires the bearer token, so a run only completes if resolution worked.
 * Imports only `@arnilo/prism`. Network-free (loopback only).
 * Run: npm run build:core && node examples/openai-compatible.ts
 */

const KEY = "local-demo-key-1234";

// Bun-only demo (the examples tsconfig is Node-typed): the one Bun global this file uses.
declare const Bun: {
  serve(options: { port: number; fetch: (request: Request) => Response | Promise<Response> }): {
    readonly url: string;
    stop(closeActiveConnections?: boolean): void;
  };
};

export async function demo(): Promise<Record<string, unknown>> {
  process.env.EXAMPLE_LOCAL_KEY = KEY;
  let sawBearer = false;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      if (request.headers.get("authorization") !== `Bearer ${KEY}`) return new Response("unauthorized", { status: 401 });
      sawBearer = true;
      const chunks = [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " from the fake endpoint." } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } },
      ];
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });

  try {
    const agent = await createAgent({
      id: "openai-compatible-demo",
      model: { provider: "openai-compatible", model: "demo", baseUrl: `${server.url}v1`, credential: "env:EXAMPLE_LOCAL_KEY" },
    });
    const session = await agent.session();
    let streamed = "";
    for await (const event of session.stream("Say hello")) {
      if (event.type === "message.delta" && event.content.type === "text") streamed += event.content.text;
    }
    const result = await session.run("And once more");
    await agent.dispose();
    if (!sawBearer) throw new Error("the fake endpoint never saw the bearer token");
    if (streamed.includes(KEY)) throw new Error("the stream leaked the key");
    return { streamed, status: result.status, text: result.text, sawBearer };
  } finally {
    server.stop(true);
    delete process.env.EXAMPLE_LOCAL_KEY;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
