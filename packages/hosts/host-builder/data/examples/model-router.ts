/**
 * Model Router Failover Demo (plan 160 Task 2).
 *
 * Demonstrates turn-level fallback between candidate models:
 * 1. Primary candidate ("mock-primary/alpha") fails before output.
 * 2. Model router catches the pre-output failure and fails over to "mock-fallback/beta".
 * 3. Fallback candidate succeeds and completes the turn.
 * 4. `router.decision` package events record both attempts and name the routed model.
 * 5. `turn.completed` event carries settled usage and completion metadata.
 *
 * Run: bun examples/model-router.ts
 */
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import modelRouter from "@arnilo/prism-extensions/model-router";
import { providerPackage } from "@arnilo/prism/provider-kit";

function primaryProvider(): ModelProvider {
  return {
    id: "mock-primary",
    async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
      // Fails immediately before producing any output event
      throw new Error("mock-primary: connection reset before output");
    },
  };
}

function fallbackProvider(): ModelProvider {
  return {
    id: "mock-fallback",
    async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
      yield providerTextDelta("Hello from fallback provider!");
      yield providerDone({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cost: 0.00015,
      });
    },
  };
}

export async function demo() {
  const events: AgentEvent[] = [];

  const agent = await createAgent({
    id: "model-router-demo-agent",
    model: { provider: "mock-primary", model: "alpha" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-primary-pkg", [primaryProvider()]),
      providerPackage("mock-fallback-pkg", [fallbackProvider()]),
      modelRouter({
        candidates: ["mock-primary/alpha", "mock-fallback/beta"],
        select: "ordered",
        circuit: {
          failureThreshold: 2,
          cooldownMs: 30_000,
        },
      }),
    ],
  });

  const session = await agent.session({ id: "demo-session", create: true });
  const subscription = session.subscribe();

  const runPromise = session.run("test failover");

  for await (const event of subscription) {
    events.push(event);
  }

  const result = await runPromise;

  const decisionEvents = events.filter((e) => e.type === "package.event" && (e as any).name === "router.decision");
  const turnCompletedEvents = events.filter((e) => e.type === "turn.completed");

  await agent.dispose();

  return {
    status: result.status,
    text: result.text,
    decisions: decisionEvents.map((e) => (e as any).data),
    turnCompleted: turnCompletedEvents.map((e) => ({
      turn: (e as any).turn,
      usage: (e as any).usage,
    })),
  };
}

export async function main() {
  const summary = await demo();
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
