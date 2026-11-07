import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

// Network-free durable approval: no tool side effect occurs before resume approval. The suspension
// lives in the store slot's `suspended_run` entry (plan 168 Task 5), so `session.resume` is the only
// durable path a host needs.
export async function demo() {
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
  const session = await agent.session({ id: "approval-session", create: true });
  const suspended = await session.run("write");
  if (suspended.status !== "suspended" || writes !== 0) throw new Error("expected pre-tool suspension");
  let last: string | undefined;
  for await (const event of session.resume(
    suspended.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
  )) {
    last = event.type;
  }
  return { status: last === "run.completed" ? "completed" : last, writes };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
