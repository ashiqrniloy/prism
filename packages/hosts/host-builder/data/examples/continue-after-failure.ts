import { createAgent, createMemorySessionStore, type ModelProvider, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

/**
 * Network-free demo (plan 231 Task 2): a run fails partway, after a tool round, when its provider goes
 * down. A second agent over the same store picks the session up with `session.continue()`: no new user
 * message, the tool is not run again, and the model finishes the task.
 * Run: npm run build:core && node examples/continue-after-failure.ts
 */
export async function demo(): Promise<Record<string, unknown>> {
  const store = createMemorySessionStore();
  const executed: string[] = [];
  const lookup = {
    name: "lookup",
    parameters: { type: "object", properties: { city: { type: "string" } } },
    execute: (_args: unknown, context: { readonly toolCallId: string }) => {
      executed.push(context.toolCallId);
      return { toolCallId: context.toolCallId, name: "lookup", value: "18°C, clear" };
    },
  };

  // Process A: the model calls `lookup`, then the provider fails on the next turn.
  let turnA = 0;
  const failing: ModelProvider = {
    id: "mock",
    async *generate() {
      turnA += 1;
      if (turnA === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("call-1", "lookup", { city: "Oslo" }) };
        yield providerDone();
        return;
      }
      throw new Error("provider unavailable");
    },
  };
  const agentA = await createAgent({
    model: { provider: "mock", model: "demo" },
    slots: { store },
    packages: [providerPackage("test-provider", [failing])],
    tools: { add: [lookup] },
  });
  const sessionA = await agentA.session({ id: "trip", create: true });
  const failed = await sessionA.run("What is the weather in Oslo?");
  await agentA.dispose();

  // Process B: same store, a healthy provider. `continue()` needs no input.
  const healthy: ModelProvider = {
    id: "mock",
    async *generate() {
      yield providerTextDelta("It is 18°C and clear in Oslo.");
      yield providerDone();
    },
  };
  const agentB = await createAgent({
    model: { provider: "mock", model: "demo" },
    slots: { store },
    packages: [providerPackage("test-provider", [healthy])],
    tools: { add: [lookup] },
  });
  const sessionB = await agentB.session({ id: "trip" });
  const continued = await sessionB.continue();
  const messages = await sessionB.messages();
  // A second call has nothing to continue: the branch ends in a completed answer.
  const again = await sessionB.continue().then(
    () => "continued",
    (error: { code?: string }) => error.code,
  );
  await agentB.dispose();

  return {
    firstRun: failed.status,
    continued: continued.status,
    text: continued.text,
    toolRuns: executed.length,
    userMessages: messages.filter((message) => message.role === "user").length,
    again,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
