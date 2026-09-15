import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceFromRagCitation } from "../citations.js";
import type { RagCitation } from "../types.js";

test("evidenceFromRagCitation projects provenance without refetch", () => {
  const citation: RagCitation = {
    id: "src#0001",
    sourceId: "src",
    chunkId: "src#0001",
    provenance: {
      sourceId: "src",
      chunkId: "src#0001",
      citationId: "src#0001",
      provider: "host",
      tenantId: "t1",
      resourceId: "docs",
      corpusId: "c1",
      retrieval: "hybrid",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
    trust: { untrusted: true, inert: true, injectionCapable: true },
  };
  const evidence = evidenceFromRagCitation(citation, { contentHash: "ab".repeat(32), revision: "3", excerpt: "fact" });
  assert.equal(evidence.kind, "rag");
  assert.equal(evidence.sourceId, "src");
  assert.equal(evidence.revision, "3");
  assert.equal(evidence.tenantId, "t1");
  assert.equal(evidence.support, "unverified");
  assert.equal(evidence.uri, "rag:src");
});
