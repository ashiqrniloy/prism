import {
  type AgentEvent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type JsonObject,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { connectA2A, serveA2A } from "@arnilo/prism-hosts/a2a";

// Bun-only demo (the examples tsconfig is Node-typed): the one Bun global this file uses.
declare const Bun: {
  serve(options: { hostname: string; port: number; fetch: (request: Request) => Response | Promise<Response> }): {
    readonly port: number;
    stop(closeActiveConnections?: boolean): void;
  };
};

/**
 * Calls a remote A2A 1.0 agent as a local `Agent`, offline: an approval-gated peer is served with `serveA2A`
 * on a loopback port (Bun-only, `Bun.serve`), and `connectA2A` reads its Agent Card and returns a proxy.
 * The peer's `TASK_STATE_INPUT_REQUIRED` becomes a suspended run, and `session.resume` answers it.
 * In a real host the peer is another framework's agent at an `https:` URL, and `allowLoopback` stays off.
 */
export async function demo() {
  const executed: string[] = [];
  let turn = 0;
  const peerAgent = await createAgent({
    id: "a2a-publisher",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("demo-provider", [
        {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-1", "publish_draft", { title: "Release notes" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta(turn === 2 ? "Published." : "Here is a summary.");
            yield providerDone();
          },
        },
      ]),
    ],
    hooks: askEveryTool(),
    tools: {
      add: [
        {
          name: "publish_draft",
          parameters: { type: "object" },
          execute: (args: JsonObject, context: { toolCallId: string }) => {
            executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
          },
        },
      ],
    },
  });

  // The peer. Its `authorize` checks the Bearer token the client sends.
  process.env.DEMO_A2A_TOKEN = "demo-peer-token";
  let handle: ReturnType<typeof serveA2A> | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => (handle as ReturnType<typeof serveA2A>)(request) });
  const base = `http://127.0.0.1:${server.port}`;
  handle = serveA2A(peerAgent, {
    card: {
      name: "Publisher",
      description: "Publishes drafts after a human approves.",
      version: "1.0.0",
      supportedInterfaces: [{ url: `${base}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{ id: "publish", name: "Publish", description: "Publishes a draft.", tags: ["publishing"] }],
    },
    authorize: ({ request }) =>
      request.headers.get("authorization") === "Bearer demo-peer-token"
        ? { principal: { kind: "agent", id: "demo-client" }, ownership: { tenantId: "demo" } }
        : false,
  });

  // The client: the token is a ref, never a literal.
  const publisher = await connectA2A({ url: base, token: "env:DEMO_A2A_TOKEN" }, { allowLoopback: true });
  const session = await publisher.session();

  // 1. The run stops at the peer's approval: a suspended result with the pending decision.
  const first = await session.run("Publish the release notes");
  const pending = first.pending ?? [];

  // 2. Answer it; the peer continues the same task.
  const resumed: AgentEvent[] = [];
  for await (const event of session.resume(
    pending.map((decision) => ({ approvalId: decision.approvalId, outcome: "allow_once" as const })),
  )) {
    resumed.push(event);
  }

  // 3. A streamed second task in the same context.
  const streamed: AgentEvent[] = [];
  for await (const event of session.stream("Summarize")) streamed.push(event);

  await publisher.dispose();
  await handle.close();
  server.stop(true);
  return {
    firstStatus: first.status,
    pendingTool: pending[0]?.scope.toolName,
    resumedFinal: resumed.at(-1)?.type,
    streamedText: (await session.messages())
      .at(-1)
      ?.content.map((block) => (block.type === "text" ? block.text : ""))
      .join(""),
    origin: streamed[0]?.origin?.kind,
    executedBy: streamed[0]?.origin?.executedBy,
    executedCalls: executed.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
