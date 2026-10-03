import { createAgent } from "@arnilo/prism";
import { xaiModels, xaiPackage } from "@arnilo/prism-providers/xai";

export async function demo() {
  const agent = await createAgent({
    model: { provider: "xai", model: xaiModels[0]!.model },
    packages: [xaiPackage({ apiKey: () => "fake-xai-key" })],
  });
  try {
    return {
      package: agent.inspect().packages[0]?.name,
      models: xaiModels.map((model) => model.model),
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
