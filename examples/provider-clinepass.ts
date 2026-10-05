import { createAgent } from "@arnilo/prism";
import clinepass, { clinePassModels } from "@arnilo/prism-provider-clinepass";

export async function demo() {
  const agent = await createAgent({
    model: { provider: "clinepass", model: clinePassModels[0]!.model },
    packages: [clinepass({ apiKey: "env:PRISM_TEST_CLINEPASS_KEY" })],
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
