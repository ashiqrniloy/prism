/**
 * Advisor Demo (plan 191 Task 8).
 *
 * `@arnilo/prism-extensions/advisor` gives an agent a second opinion. The parent model calls `advise` once and gets
 * one model call's worth of advice, then `triggers.beforeFinish` reviews the answer at the natural end of
 * the run: the first review says `revise`, so the run continues with that advice as a steer; the second
 * says `proceed`. Every consult is an `advisor.consult` package event.
 *
 * The advisor is advisory: it has no tools, cannot act, and a failure never blocks a run.
 *
 * Run: bun examples/advisor.ts
 */
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import advisor from "@arnilo/prism-extensions/advisor";

function mockProvider(): ModelProvider {
  let parentCalls = 0;
  let finishReviews = 0;
  return {
    id: "mock",
    async *generate(request) {
      const prompts = JSON.stringify(request.messages);
      if ((request.tools ?? []).some((tool) => tool.name === "advise")) {
        parentCalls += 1;
        if (parentCalls === 1) {
          yield providerToolCall(toolCallContent("call_advice", "advise", { question: "Patch the parser or the caller?" }));
        } else {
          yield providerTextDelta("Patched the caller and finished.");
        }
        yield providerDone({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
        return;
      }
      if (prompts.includes("about to finish")) {
        finishReviews += 1;
        yield providerTextDelta(
          finishReviews === 1
            ? '{"verdict":"revise","advice":"Add a regression test for the parse edge case, then finish."}'
            : '{"verdict":"proceed","advice":""}',
        );
      } else if (prompts.includes("about to call the tool")) {
        yield providerTextDelta('{"verdict":"proceed","advice":""}');
      } else {
        yield providerTextDelta("Patch the caller: the parser accepts the input the spec allows, and the caller is what broke.");
      }
      yield providerDone({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    },
  };
}

export async function demo() {
  const consults: unknown[] = [];
  let advice = "";
  const agent = await createAgent({
    id: "advisor-demo",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) => {
      hooks.on("tool.completed", (event) => {
        if (event.name !== "advise") return;
        const block = event.result.content?.[0];
        advice = block?.type === "text" ? (block.text.split("\n")[0] ?? "") : "";
      });
      hooks.on("package.event", (event: Extract<AgentEvent, { type: "package.event" }>) => {
        if (event.name === "advisor.consult") consults.push(event.data);
      });
    },
    packages: [
      providerPackage("mock-provider", [mockProvider()]),
      advisor({
        model: { provider: "mock", model: "demo" },
        context: { lastTurns: 8 },
        triggers: { beforeFinish: true },
        maxConsultsPerRun: 4,
      }),
    ],
  });
  const session = await agent.session();
  const result = await session.run("The parser rejects valid input; find the right fix.");
  await session.close();
  await agent.dispose();
  return { status: result.status, advice, consults };
}

if (import.meta.main) console.log(JSON.stringify(await demo(), null, 2));
