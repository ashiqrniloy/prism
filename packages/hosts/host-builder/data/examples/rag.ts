import { createAgent, providerDone, providerTextDelta, withContextBlocks } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { chunkMarkdown, indexChunks, registerRagContext, retrieveContext } from "@arnilo/prism-memory-rag";
import { mockProvider } from "@arnilo/prism/testing";

const embedder = createHashEmbedder();
const store = createMemoryVectorStore();
const scope = { tenantId: "demo", resourceId: "docs", corpusId: "handbook" };

const chunks = chunkMarkdown("# Durable approval\n\nA resumed tool rechecks current execution policy before side effects.", {
  sourceId: "security-guide",
  metadata: { category: "security" },
});
await indexChunks({ chunks, embedder, store, scope });

const retrieved = await retrieveContext("execution policy approval", {
  embedder,
  store,
  scope,
  filter: { category: "security" },
});

// RAG retrieval rides the `context.build` hook (roadmap §2.4): the retrieved blocks join this
// turn's provider view only. The session store is never touched.
const agent = await createAgent({
  model: { provider: "mock", model: "rag-demo" },
  packages: [mockProvider([[providerTextDelta(`Policy answer ${retrieved.citations[0]?.id ?? "without citation"}`), providerDone()]])],
  hooks: (hooks) => {
    registerRagContext(hooks, { embedder, store, scope });
    // A second handler composes on top of the retrieved blocks, in registration order.
    hooks.on(
      "context.build",
      (draft) => withContextBlocks(draft, [{ id: "house-rule", title: "House rule", content: "Cite the security guide." }]),
      { id: "house-rule" },
    );
  },
});

const result = await (await agent.session()).run("How does approval protect tool execution?");
console.log(JSON.stringify({ context: retrieved.text, answer: result.text }));
