import {
  type AgentRunRef,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  type JsonObject,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

export async function demo() {
  const checkpoints = createMemoryCheckpointStore();
  const sessionStore = createMemorySessionStore();
  const executed: string[] = [];
  let turn = 0;

  const agent = createAgent({
    id: "approvals-agent",
    model: { provider: "mock", model: "mock" },
    provider: {
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
    store: sessionStore,
    tools: [
      {
        name: "publish_draft",
        parameters: {},
        execute: (args: JsonObject, context: { toolCallId: string }) => {
          executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
          return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
        },
      },
    ],
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  });

  const lifecycle = createAgentRunLifecycle({
    checkpoints,
    resolveAgent: () => ({ agent, definitionRevision: "1" }),
  });

  let suspended: AgentRunRef | undefined;

  const handle = createAgUiHandler({
    authorize: () => ({ ownership: { userId: "demo", tenantId: "demo-tenant" } }),
    capabilities: { humanInTheLoop: { approveWithEdits: true } },
    lifecycle,
    resolveRun: () => (suspended ? { ref: suspended, agentId: "approvals-agent" } : undefined),
    onSuspended: ({ run }) => {
      suspended = run.ref;
    },
    sessionFactory: () => agent.createSession({ id: "approval-session" }),
  });

  // 1. Initial run: agent requests tool call and suspends at durable checkpoint
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

  const startLines = (await startResponse.text()).trim().split("\n\n").filter(Boolean);
  const startEvents = startLines.map((line) => JSON.parse(line.replace(/^data:\s*/, "")));
  const finish = startEvents.at(-1);
  const interrupt = finish?.outcome?.interrupts?.[0];

  // 2. Resume with edited arguments: reviewer edits draft content before approving
  const resumeResponse = await handle(
    new Request("https://example.test/ag-ui", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "ag-ui-thread",
        runId: "ag-ui-run-2",
        parentRunId: "ag-ui-run-1",
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {},
        resume: [
          {
            interruptId: interrupt?.id,
            status: "resolved",
            payload: {
              decision: "approve",
              editedArgs: { title: "Draft Post", content: "Reviewed & Approved safe content" },
            },
          },
        ],
      }),
    }),
  );

  const resumeLines = (await resumeResponse.text()).trim().split("\n\n").filter(Boolean);
  const resumeEvents = resumeLines.map((line) => JSON.parse(line.replace(/^data:\s*/, "")));

  return {
    approveWithEditsAdvertised: handle.capabilities.humanInTheLoop?.approveWithEdits ?? false,
    startStatus: startResponse.status,
    startEventsCount: startEvents.length,
    interruptType: finish?.outcome?.type,
    resumeStatus: resumeResponse.status,
    resumeEventsCount: resumeEvents.length,
    executedCalls: executed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
