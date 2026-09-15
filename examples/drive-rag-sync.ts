import { createMemoryCheckpointStore } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { type KnowledgeConnector, retrieveContext, syncKnowledge } from "@arnilo/prism-memory/rag";

const scope = { tenantId: "demo", resourceId: "docs", corpusId: "drive" };
const store = createMemoryVectorStore();
const embedder = createHashEmbedder();
const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const connector: KnowledgeConnector = {
  async listChanges(input) {
    if (input.cursor) return { changes: [], resumeCursor: input.cursor, done: true };
    return {
      changes: [
        {
          kind: "upsert",
          sourceId: "handbook",
          text: "Recheck policy before side effects.",
          contentHash: hash,
          grants: { sourceId: "handbook", principalIds: ["alice"], accessVersion: 1 },
        },
      ],
      resumeCursor: "c1",
      done: true,
    };
  },
};

const first = await syncKnowledge({
  connector,
  checkpoints: createMemoryCheckpointStore(),
  checkpoint: { namespace: "prism.rag.sync", key: "demo", tenantId: scope.tenantId },
  store,
  embedder,
  scope,
});
const found = await retrieveContext("policy", {
  embedder,
  store,
  scope,
  authorization: { principalId: "alice", tenantId: scope.tenantId },
  lexical: "off",
});
console.log(JSON.stringify({ pages: first.pages, upserted: first.upserted, citation: found.citations[0]?.id }));
