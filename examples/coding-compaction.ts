import { createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import memoryCompaction from "@arnilo/prism-memory-compaction";

// Coding-focused LLM compaction stays normal bounded compaction: raw history
// stays in the store, and the coding profile adds read/modified file reporting.
// A mock summarizer keeps this demo network-free.
export async function demo() {
  const store = createMemorySessionStore();
  const agent = await createAgent({
    model: { provider: "mock", model: "summary" },
    packages: [memoryCompaction({ profile: "coding" }), mockProvider([[providerTextDelta("Changed src/app.ts; npm test passed."), providerDone()]])],
    slots: { store },
  });
  const session = await agent.session({ id: "coding-demo", create: true });
  await session.run("Fix src/app.ts and run npm test");

  const result = await session.compact();

  return {
    strategyName: (result.entries?.[0]?.data as { strategy?: string } | undefined)?.strategy,
    summary: result.summary.slice(0, 20),
    appendedKind: result.entries?.[0]?.kind,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
