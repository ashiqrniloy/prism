import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

/**
 * A long investigation survives a dead worker (plan 168 Task 5).
 *
 * The suspension is the durable unit: a run that needs a decision writes one self-contained
 * `suspended_run` entry through the store slot, and a later process reads it from the store and
 * continues the same run with `session.resume(decisions)` — no tool re-dispatch, no re-run from
 * turn zero. The retired `checkpointPolicy: "every-turn"` crash-recovery checkpoint was replaced by
 * this store-slot anchor, so a worker that dies *mid-turn* simply restarts it; a worker that dies
 * *after* a suspension loses nothing.
 *
 * Network-free: mock provider and a memory session store standing in for the host's database.
 */
export async function demo() {
  const store = createMemorySessionStore();
  const requests: ProviderRequest[] = [];
  const executed: string[] = [];

  const buildWorker = async () =>
    await createAgent({
      id: "durable-investigation",
      slots: { store },
      model: { provider: "mock", model: "demo" },
      // The `ask` gate makes the first tool call a suspension instead of a side effect.
      hooks: askEveryTool(),
      packages: [providerPackage("test-provider", [{
        id: "mock",
        async *generate(request) {
          requests.push(request);
          if (executed.length === 0) {
            // Turn 1: the agent opens the investigation by running one research tool.
            yield { type: "tool_call" as const, call: toolCallContent("gather-1", "gather", { query: "revenue by region" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("North America leads revenue at 4,320.50 (gather-1).");
          yield providerDone();
        },
      }])],
      tools: {
        add: [
          {
            name: "gather",
            parameters: { type: "object" },
            execute: () => {
              executed.push("gather-1");
              return { toolCallId: "gather-1", name: "gather", value: { total: 4320.5, region: "North America" } };
            },
          },
        ],
      },
    });

  // Worker 1: suspends before the tool runs, then the process dies.
  const first = await buildWorker();
  const session = await first.session({ id: "investigation-session", create: true });
  const suspended = await session.run("Investigate revenue by region");
  if (suspended.status !== "suspended") throw new Error(`expected a suspension, got ${suspended.status}`);
  const pending = suspended.pending ?? [];
  if (pending.length !== 1 || executed.length !== 0) throw new Error("expected one gated research call before any side effect");

  // Worker 2: a new process over the same store resumes the same run.
  const second = await buildWorker();
  const resumedSession = await second.session({ id: "investigation-session" });
  let last: string | undefined;
  for await (const event of resumedSession.resume(
    pending.map((decision) => ({ approvalId: decision.approvalId, outcome: "allow_once" as const })),
  )) {
    last = event.type;
  }

  return {
    status: last === "run.completed" ? "completed" : last,
    toolExecutions: executed,
    providerTurns: requests.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
