import { createMemorySessionStore, createMockProvider, createSessionEntry, providerDone, providerTextDelta } from "@arnilo/prism";
import { createCodingCompactionStrategy } from "@arnilo/prism-compaction-llm";

// Coding-focused LLM compaction remains normal bounded compaction: raw history
// stays in the store; a mock summarizer keeps this demo network-free.
export async function demo() {
  const sessionId = "coding-demo";
  const store = createMemorySessionStore();
  await store.append(createSessionEntry({
    sessionId,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "Fix src/app.ts and run npm test" }] },
  }));
  const strategy = createCodingCompactionStrategy({
    provider: createMockProvider([providerTextDelta("Changed src/app.ts; npm test passed."), providerDone()]),
    model: { provider: "mock", model: "summary" },
    keepRecentTokens: 1,
  });
  const result = await strategy.compact({ sessionId, entries: await store.list(sessionId) });
  return { strategyName: strategy.name, summary: result.summary, appendedKind: result.entries?.[0]?.kind };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
