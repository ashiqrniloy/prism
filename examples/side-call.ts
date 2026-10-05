import { createAgent, definePackage, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

/**
 * A package calling a second model mid-turn (roadmap Phase 5).
 *
 * The agent runs on two `mockProvider` packages: `main` answers the run and `side` is reached only through
 * `PackageAPI.models.client("side/side")` from inside the `ask_side` tool. The package declares the `models`
 * capability; the main provider emits the tool call, the tool streams the side model's text, and the side
 * provider is called exactly once. Imports only `@arnilo/prism` and `@arnilo/prism/testing`. Network-free.
 * Run: npm run build:core && node examples/side-call.ts
 */

export async function demo(): Promise<Record<string, unknown>> {
  let sideCalls = 0;
  let sideText = "";

  const sideCall = definePackage({
    name: "@acme/side-call",
    version: "1.0.0",
    requires: { prism: "^0.12.1 || ^0.13.0-0" },
    capabilities: ["models"],
    setup(prism) {
      prism.tools.register({
        name: "ask_side",
        description: "Asks the side model a question and returns its text.",
        parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
        execute: async (args, context) => {
          for await (const event of prism.models.client("side/side").generate({
            messages: [{ role: "user", content: [{ type: "text", text: String(args.question ?? "") }] }],
          })) {
            if (event.type === "content_delta" && event.content.type === "text") sideText += event.content.text;
          }
          return { toolCallId: context.toolCallId, name: "ask_side", value: sideText };
        },
      });
    },
  });

  const agent = await createAgent({
    id: "side-call-demo",
    model: { provider: "main", model: "main" },
    packages: [
      mockProvider(
        [
          [{ type: "tool_call", call: toolCallContent("c1", "ask_side", { question: "What is the side answer?" }) }, providerDone()],
          [providerTextDelta("main done"), providerDone()],
        ],
        { id: "main" },
      ),
      mockProvider([[providerTextDelta("side answer"), providerDone()]], { id: "side", onRequest: () => void (sideCalls += 1) }),
      sideCall,
    ],
  });

  const session = await agent.session();
  const result = await session.run("Ask the side model, then finish.");
  await agent.dispose();

  if (sideCalls !== 1) throw new Error(`the side provider was called ${sideCalls} times`);
  return { status: result.status, mainText: result.text, sideText, sideCalls };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
