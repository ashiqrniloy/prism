import { createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import memoryCompaction from "@arnilo/prism-memory-compaction";

// LLM compaction as a package: it claims the `compaction` slot and summarizes the
// history a cut drops with one model call per compaction, then appends a
// `compaction` entry. Raw history is never deleted. No network, no real credentials.
export async function demo() {
  const store = createMemorySessionStore();
  const agent = await createAgent({
    model: { provider: "mock", model: "summary" },
    packages: [memoryCompaction(), mockProvider([[providerTextDelta("compact summary"), providerDone()]])],
    slots: { store },
  });
  const session = await agent.session({ id: "s1", create: true });
  for (let i = 0; i < 4; i++) await session.run(`message ${i} with enough words to summarize`);

  const result = await session.compact();

  return {
    strategyName: (result.entries?.[0]?.data as { strategy?: string } | undefined)?.strategy,
    summary: result.summary.slice(0, 20),
    appendedKind: result.entries?.[0]?.kind,
  };
}

// Runnable end-to-end demo: `node examples/compaction.ts` (Node 24 strips
// types natively). Mock summarizer — no network, no real credentials.
export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
