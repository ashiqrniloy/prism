import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "@arnilo/prism";
import { impeccable } from "@arnilo/prism-coding-tools/impeccable";

const upstreamPath = join(dirname(fileURLToPath(import.meta.url)), "../packages/prism-coding-tools/fixtures/impeccable/upstream-minimal");

export async function demo() {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [impeccable({ upstreamPath })],
  });
  try {
    const skill = agent.inspect().skills.find((entry) => entry.name === "impeccable");
    const result = (await agent.commands.run("impeccable", {})) as { value?: unknown };
    return { skill: skill?.name, dispatch: result.value };
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
