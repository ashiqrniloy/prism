import { createAgent } from "@arnilo/prism";
import { deepseekModels, deepseekPackage } from "@arnilo/prism-providers/deepseek";

export async function demo() {
  const agent = await createAgent({
    model: { provider: "deepseek", model: deepseekModels[0]!.model },
    packages: [deepseekPackage({ apiKey: () => "fake-deepseek-key" })],
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
