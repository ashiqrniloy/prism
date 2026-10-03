import { createAgent } from "@arnilo/prism";
import { clinePassModels, clinepassPackage } from "@arnilo/prism-providers/clinepass";

export async function demo() {
  const agent = await createAgent({
    model: { provider: "clinepass", model: clinePassModels[0]!.model },
    packages: [clinepassPackage({ apiKey: () => "fake-cline-key" })],
  });
  try {
    return {
      package: agent.inspect().packages[0]?.name,
      slugs: clinePassModels.map((model) => model.model),
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
