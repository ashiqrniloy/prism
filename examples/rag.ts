import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkMarkdown, createRagContextProvider, indexChunks, retrieveContext } from "@arnilo/prism-rag";

const embedder = createHashEmbedder();
const store = createMemoryVectorStore();
const scope = { tenantId: "demo", resourceId: "docs", corpusId: "handbook" };

const chunks = chunkMarkdown(
  "# Durable approval\n\nA resumed tool rechecks current execution policy before side effects.",
  { sourceId: "security-guide", metadata: { category: "security" } },
);
await indexChunks({ chunks, embedder, store, scope });

const retrieved = await retrieveContext("execution policy approval", {
  embedder,
  store,
  scope,
  filter: { category: "security" },
});

const agent = createAgent({
  model: { provider: "mock", model: "rag-demo" },
  provider: createMockProvider([
    providerTextDelta(`Policy answer ${retrieved.citations[0]?.id ?? "without citation"}`),
    providerDone(),
  ]),
  context: [createRagContextProvider({ embedder, store, scope })],
});

const result = await agent.createSession().run("How does approval protect tool execution?");
console.log(JSON.stringify({ context: retrieved.text, answer: result.text }));
