/**
 * Structured Output Demo (plan 235 Task 3).
 *
 * A run that passes `providerOptions.structuredOutput` gets `RunResult.output` (the parsed, schema-checked
 * value) or `RunResult.outputError` (paths and messages). The mock model here does not declare the
 * `structuredOutput` capability, so `mode: "auto"` uses prompted mode: the schema goes to the model as one
 * instruction block instead of a native response format. The first reply misses a required field, so the
 * kernel sends one repair message listing the violation (`repair` defaults to 1); the second reply is valid.
 *
 * Run: bun examples/structured-output.ts
 */
import { createAgent, type ModelProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

const schema = {
  type: "object",
  properties: { city: { type: "string" }, celsius: { type: "number" } },
  required: ["city", "celsius"],
};

function scriptedModel(): ModelProvider & { readonly prompts: string[] } {
  const prompts: string[] = [];
  let turn = 0;
  return {
    id: "mock",
    prompts,
    async *generate(request) {
      turn += 1;
      const last = request.messages.at(-1);
      prompts.push(last?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "");
      // First reply: a JSON object without the required `celsius`. Second: the corrected object.
      yield providerTextDelta(turn === 1 ? '{"city":"Oslo"}' : '```json\n{"city":"Oslo","celsius":18}\n```');
      yield providerDone();
    },
  };
}

const model = scriptedModel();
const agent = await createAgent({
  model: { provider: "mock", model: "plain" },
  packages: [providerPackage("structured-output-demo", [model])],
});
const session = await agent.session({ id: "structured-output-demo", create: true });
const result = await session.run("What is the weather in Oslo?", {
  providerOptions: { structuredOutput: { name: "weather", schema, mode: "auto", repair: 1 } },
});
await agent.dispose();

console.log(
  JSON.stringify({
    status: result.status,
    requests: model.prompts.length,
    repairMessage: model.prompts[1],
    output: result.output,
    outputError: result.outputError ?? null,
  }),
);
