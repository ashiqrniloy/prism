/**
 * Validator Demo (plan 191 Task 8).
 *
 * `validate` makes completion a checked claim. The run's task is captured, and at the natural end of every
 * run one validator review asks a second model whether the answer completes it. The first review answers
 * `incomplete` with what is missing, so the run continues with that list as a steer; the second answers
 * `complete`, and the run is verified. The host gates on the `validator.verdict` events — a run that merely
 * reports `completed` is not the same as a verified run.
 *
 * With `engine: { child }` the review is a hidden `delegate` child instead, which can check evidence with
 * its own tools. This demo uses the model engine so it runs offline.
 *
 * Run: bun examples/validator.ts
 */
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import advisor from "@arnilo/prism-advisor";

function mockProvider(): ModelProvider {
  let reviews = 0;
  return {
    id: "mock",
    async *generate(request) {
      if (JSON.stringify(request.messages).includes("completion validator")) {
        reviews += 1;
        yield providerTextDelta(
          reviews === 1
            ? '{"verdict":"incomplete","missing":["Add the CHANGELOG entry."],"evidence":"no changelog diff"}'
            : '{"verdict":"complete","missing":[],"evidence":"CHANGELOG.md updated, tests pass"}',
        );
      } else {
        yield providerTextDelta("Implemented the fix and added the CHANGELOG entry.");
      }
      yield providerDone({ inputTokens: 6, outputTokens: 3, totalTokens: 9 });
    },
  };
}

export async function demo() {
  const verdicts: unknown[] = [];
  const agent = await createAgent({
    id: "validator-demo",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) => {
      hooks.on("package.event", (event: Extract<AgentEvent, { type: "package.event" }>) => {
        if (event.name === "validator.verdict") verdicts.push(event.data);
      });
    },
    packages: [
      providerPackage("mock-provider", [mockProvider()]),
      advisor({
        model: { provider: "mock", model: "demo" },
        tool: false,
        validate: { criteria: "Tests pass and the changelog is updated.", maxRounds: 2 },
      }),
    ],
  });
  const session = await agent.session();
  const result = await session.run("Fix the parser bug and finish the task.");
  await session.close();
  await agent.dispose();
  const verified = verdicts.at(-1) as { verdict?: string } | undefined;
  return { status: result.status, verified: verified?.verdict === "verified", verdicts };
}

if (import.meta.main) console.log(JSON.stringify(await demo(), null, 2));
