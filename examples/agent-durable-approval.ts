import {
  askEveryTool,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

// Network-free durable approval: no tool side effect occurs before resume approval.
export async function demo() {
  const checkpoints = createMemoryCheckpointStore();
  let turn = 0;
  let writes = 0;
  const agent = await createAgent({
    id: "approval-demo",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    hooks: askEveryTool(),
    packages: [providerPackage("test-provider", [{
      id: "mock",
      async *generate() {
        if (++turn === 1) yield { type: "tool_call" as const, call: toolCallContent("write-1", "write", { value: "approved" }) };
        else yield providerTextDelta("finished");
        yield providerDone();
      },
    }])],
    tools: {
      add: [{ name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-1", name: "write", value: ++writes }) }],
    },
  });
  const suspended = await (await agent.session({ id: "approval-session", create: true })).run("write", {
    runState: { checkpoints, definitionRevision: "1" },
  });
  if (suspended.status !== "suspended" || writes !== 0) throw new Error("expected pre-tool suspension");
  return resumeAgentRun(
    agent,
    { runId: suspended.runId, sessionId: suspended.sessionId },
    {
      decision: "approve",
      expectedVersion: suspended.runState!.version!,
    },
    { checkpoints, definitionRevision: "1" },
  );
}
