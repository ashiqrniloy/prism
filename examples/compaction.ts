import {
  createMemorySessionStore,
  createSessionEntry,
  createMockProvider,
  providerTextDelta,
  providerDone,
} from "@arnilo/prism";
import { createLlmCompactionStrategy } from "@arnilo/prism-compaction-llm";

// LLM compaction with a mock summarization provider: the strategy calls the
// provider to summarize older history, then appends a `compaction` entry. Raw
// history is never deleted. No network, no real credentials.
export async function demo() {
  const sessionId = "s1";
  const store = createMemorySessionStore();
  let prev: string | undefined;
  for (let i = 0; i < 4; i++) {
    const entry = createSessionEntry({
      sessionId,
      kind: "message",
      parentId: prev,
      message: {
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `message ${i} with enough words to summarize` }],
      },
    });
    await store.append(entry);
    prev = entry.id;
  }

  const strategy = createLlmCompactionStrategy({
    provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]),
    model: { provider: "mock", model: "summary" },
    keepRecentTokens: 1,
  });

  const entries = await store.list(sessionId);
  const result = await strategy.compact({ sessionId, entries });

  return {
    strategyName: strategy.name,
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
