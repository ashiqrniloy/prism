import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExtensionKernel } from "@arnilo/prism";
import { createImpeccableExtension } from "@arnilo/prism-coding-tools/impeccable";

const upstreamPath = join(dirname(fileURLToPath(import.meta.url)), "../packages/prism-coding-tools/fixtures/impeccable/upstream-minimal");

export async function demo() {
  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([createImpeccableExtension({ upstreamPath })]);
  const skill = kernel.registries.skills.get("impeccable");
  const command = kernel.registries.commands.get("impeccable");
  const result = command ? await command.execute({}, { sessionId: "s1" }) : undefined;
  return { skill: skill?.name, dispatch: result?.value };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
