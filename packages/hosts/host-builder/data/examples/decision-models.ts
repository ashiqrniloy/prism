import { createAgent, DecisionsError, definePackage, type DecisionsProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

/**
 * A package routes a support ticket with a decision model before the turn starts.
 *
 * The `@acme/decision-router` package declares `models`, registers a `run.input` hook, and calls
 * `prism.models.decisions()` there. The mock provider's `decisions` adapter returns raw answers, so the
 * hook prints the probabilities and appends the chosen route to the state instead of asking for prose.
 * A second call with `capabilities.decisions: false` proves the kernel fails closed.
 * Imports only `@arnilo/prism` and `@arnilo/prism/testing`. Network-free.
 * Run: npm run build:core && node examples/decision-models.ts
 */

const decisions: DecisionsProvider = {
  id: "mock-decisions",
  async decide(request) {
    return {
      model: request.model,
      answers: {
        urgent: { type: "noul", noul: 0.93 },
        team: { type: "choice", choice: "billing", probabilities: { billing: 0.81, shipping: 0.19 }, confidence: 0.81 },
        severity: { type: "score", score: 2, legend: { "1": "low", "2": "medium", "3": "high" }, confidence: 0.72 },
      },
      timingMs: 1,
    };
  },
};

export async function demo(): Promise<Record<string, unknown>> {
  let routed = "";
  let unsupported = "";

  const router = definePackage({
    name: "@acme/decision-router",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["models"],
    setup(prism) {
      prism.hooks.on("run.input", async (messages) => {
        const state = messages
          .flatMap((message) => message.content)
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n");

        const { answers, model, timingMs } = await prism.models
          .decisions({ provider: "mock", model: "demo", capabilities: { decisions: true } })
          .decide({
            state,
            questions: {
              urgent: {
                type: "noul",
                instructions: "Is the customer blocked right now?",
                criteria: { true: "blocked", false: "not blocked" },
              },
              team: {
                type: "choice",
                instructions: "Which team owns this ticket?",
                criteria: { billing: null, shipping: null },
              },
              severity: { type: "score", instructions: "How severe is it?", criteria: ["low", "medium", "high"] },
            },
          });

        // Raw probabilities are the product of a decision call; print them, never parse prose.
        console.log(JSON.stringify({ model, timingMs, answers }));

        try {
          prism.models.decisions({ provider: "mock", model: "text-only", capabilities: { decisions: false } });
          throw new Error("a model without the decisions capability was accepted");
        } catch (error) {
          if (!(error instanceof DecisionsError) || error.code !== "unsupported_model") throw error;
          unsupported = error.code;
        }

        if (answers.team?.type === "choice") routed = answers.team.choice;
        const route = answers.team?.type === "choice" ? `Route: ${answers.team.choice}` : "Route: unknown";
        return [...messages, { role: "system", content: [{ type: "text", text: route }] }];
      });
    },
  });

  const agent = await createAgent({
    id: "decision-models-demo",
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([[providerTextDelta("routed to billing"), providerDone()]], { id: "mock", decisions }), router],
  });

  const session = await agent.session();
  const result = await session.run("My invoice is wrong and I cannot pay it.");
  await agent.dispose();

  if (unsupported !== "unsupported_model") throw new Error("the fail-closed decisions check did not run");
  if (routed !== "billing") throw new Error(`the ticket was routed to ${routed}`);
  return { status: result.status, routed, unsupported, text: result.text };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
