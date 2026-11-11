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
import { createAgUiHandler } from "@arnilo/prism-hosts/ag-ui";

export async function demo() {
  const executed: string[] = [];
  let turn = 0;

  const agent = await createAgent({
    id: "approvals-agent",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            if (++turn === 1) {
              yield {
                type: "tool_call" as const,
                call: toolCallContent("call-1", "publish_draft", { title: "Draft Post", content: "Unchecked draft" }),
              };
              yield providerDone();
              return;
            }
            yield providerTextDelta("Publication complete.");
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
          parameters: {},
          execute: (args: JsonObject, context: { toolCallId: string }) => {
            executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
            return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
          },
        },
      ],
    },
  });

  const handle = createAgUiHandler(agent, {
    authorize: () => ({ ownership: { userId: "demo", tenantId: "demo-tenant" } }),
  });

  const parse = async (response: Response) =>
    (await response.text())
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^data:\s*/, "")));

  // 1. Initial run: the agent asks to call a tool and the run suspends as an AG-UI interrupt.
  const startResponse = await handle(
    new Request("https://example.test/ag-ui", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "ag-ui-thread",
        runId: "ag-ui-run-1",
        state: {},
        messages: [{ id: "m-1", role: "user", content: "Publish the blog post" }],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    }),
  );

  const startEvents = await parse(startResponse);
  const finish = startEvents.at(-1);
  const interrupt = finish?.outcome?.interrupts?.[0];

  // 2. Resume with one decision: the reviewer approves the pending tool call.
  const resumeResponse = await handle(
    new Request("https://example.test/ag-ui", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "ag-ui-thread",
        runId: "ag-ui-run-2",
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {},
        resume: [{ interruptId: interrupt?.id, status: "resolved", payload: { outcome: "allow_once" } }],
      }),
    }),
  );

  const resumeEvents = await parse(resumeResponse);

  return {
    interruptAdvertised: handle.capabilities.humanInTheLoop?.interrupts ?? false,
    startStatus: startResponse.status,
    startEventsCount: startEvents.length,
    interruptType: finish?.outcome?.type,
    resumeStatus: resumeResponse.status,
    resumeEventsCount: resumeEvents.length,
    executedCalls: executed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
