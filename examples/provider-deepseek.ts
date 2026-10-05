import { createAgent } from "@arnilo/prism";
import deepseek, { deepseekModels } from "@arnilo/prism-provider-deepseek";

export async function demo() {
  const agent = await createAgent({
    model: { provider: "deepseek", model: deepseekModels[0]!.model },
    packages: [deepseek({ apiKey: "env:PRISM_TEST_DEEPSEEK_KEY" })],
  });
  try {
    return {
      package: agent.inspect().packages[0]?.name,
      models: deepseekModels.map((model) => model.model),
    };
  } finally {
    await agent.dispose();
  }
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
