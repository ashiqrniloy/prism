// Semantic memory with a hash embedder: remember, recall with adjacent entries, and context injection.
// Long-term working memory was retired in 0.13.0 (plan 216 Task 7); the memory system's WM component replaces it.
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { createHashEmbedder } from "@arnilo/prism-memory-core";
import { createMemory } from "@arnilo/prism-memory-system";
import { mockProvider } from "@arnilo/prism/testing";

const memory = createMemory({
  tenantId: "demo",
  resourceId: "user-ada",
  threadId: "thread-1",
  embedder: createHashEmbedder({ dimensions: 32 }),
  secrets: ["DEMO_SECRET_VALUE"],
});

await memory.remember(
  {
    entries: [
      { id: "m1", text: "Prefers concise answers", sequence: 1 },
      { id: "m2", text: "Lives in Lisbon", sequence: 2 },
    ],
  },
  { wait: true },
);

const recalled = await memory.recall("concise answers", { topK: 2, messageRange: 1 });
console.log(
  "recall",
  recalled.hits.map((hit) => hit.id),
  "adjacent",
  recalled.adjacent.map((item) => item.id),
);

// The same projection the agent's `context.build` handler runs, called directly here.
const draft = await memory.contextBlocks(
  { messages: [{ role: "user", content: [{ type: "text", text: "Do I prefer concise answers?" }] }] },
  { sessionId: "s", runId: "r", emit: () => undefined, reject: () => ({ __prismHookRejection: "x" }) },
  { includeSemantic: true },
);
console.log(
  "context blocks",
  (draft?.messages.at(-1)?.metadata?.contextBlocks as { title?: string }[] | undefined)?.map((block) => block.title) ?? [],
);

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [mockProvider([[providerTextDelta("Understood."), providerDone()]])],
  hooks: (hooks) => memory.registerContextBuild(hooks, { includeSemantic: true }),
});

const result = await (await agent.session()).run("Remind me how to format answers");
console.log("agent", result.text);
