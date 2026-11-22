import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type JsonObject,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { PRISM_DECISIONS_EXTENSION, serveA2A } from "@arnilo/prism-hosts/a2a";

/**
 * Serves one approval-gated agent to A2A 1.0 peers, offline: the peer reads the Agent Card, sends a
 * message, gets `TASK_STATE_INPUT_REQUIRED`, answers with a decision, and streams a second task.
 * In a real host, pass the handler to `Bun.serve({ fetch: handle })`.
 */
export async function demo() {
  const executed: string[] = [];
  let turn = 0;
  const agent = await createAgent({
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

  const endpoint = "https://agents.example.test/a2a";
  const handle = serveA2A(agent, {
    card: {
      name: "Publisher",
      description: "Publishes drafts after a human approves.",
      version: "1.0.0",
      supportedInterfaces: [{ url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{ id: "publish", name: "Publish", description: "Publishes a draft.", tags: ["publishing"] }],
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    },
    // A real host verifies a token here. Without `authorize`, every call is refused.
    authorize: ({ request }) =>
      request.headers.get("authorization") === "Bearer demo-peer"
        ? { principal: { kind: "agent", id: "demo-peer" }, ownership: { tenantId: "demo" } }
        : false,
  });

  let id = 0;
  const call = (method: string, params: unknown) =>
    handle(
      new Request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "a2a-version": "1.0", authorization: "Bearer demo-peer" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
    );

  const card = await (await handle(new Request("https://agents.example.test/.well-known/agent-card.json"))).json();

  // 1. A blocking send: the run asks to call a tool, so the task stops at INPUT_REQUIRED.
  const first = (await (
    await call("SendMessage", { message: { messageId: "m-1", role: "ROLE_USER", parts: [{ text: "Publish the release notes" }] } })
  ).json()) as {
    result: { task: { id: string; contextId: string; status: { state: string; message: { parts: { data: { approvalId: string } }[] } } } };
  };
  const task = first.result.task;
  const approvalId = task.status.message.parts[0]?.data.approvalId;

  // 2. The peer answers with one decision through the Prism decisions extension.
  const resumed = (await (
    await call("SendMessage", {
      message: {
        messageId: "m-2",
        role: "ROLE_USER",
        taskId: task.id,
        extensions: [PRISM_DECISIONS_EXTENSION],
        parts: [{ data: { decisions: [{ approvalId, outcome: "allow_once" }] } }],
      },
    })
  ).json()) as { result: { task: { status: { state: string }; artifacts: { parts: { text: string }[] }[] } } };

  // 3. A streaming send in the same context.
  const stream = await (
    await call("SendStreamingMessage", {
      message: { messageId: "m-3", role: "ROLE_USER", contextId: task.contextId, parts: [{ text: "Summarize" }] },
    })
  ).text();
  const frames = stream
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)).result);

  await handle.close();
  return {
    cardStreaming: card.capabilities.streaming,
    firstState: task.status.state,
    resumedState: resumed.result.task.status.state,
    resumedText: resumed.result.task.artifacts.at(-1)?.parts[0]?.text,
    streamedFrames: frames.length,
    streamedFinalState: frames.at(-1)?.statusUpdate?.status.state,
    executedCalls: executed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
