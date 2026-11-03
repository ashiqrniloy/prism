/**
 * Plan 102 Task 8: the cross-layer host entry point.
 *
 * One propagation pass wires the RAG and fabric-note legs in one place (the ontology tier's concept cascade is `memory.fabric.concept-deletion`, pinned in `ontology.test.ts`), and the
 * same tombstone set is what a projection reads when it builds instead of writing a drop entry. These
 * tests are the executable recipe: no in-tree runtime is invented, no facade is added, and every import
 * is a published entry point (`@arnilo/prism-memory-core`, `-rag`, `-fabric`).
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createDeletionPropagator,
  createHashEmbedder,
  createMemoryVectorStore,
  listInvalidatedIds,
  type MemoryScope,
  MemoryScopeError,
  type MemoryVectorRecord,
} from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, createMemoryWorkingStore } from "@arnilo/prism-memory-fabric";
import { chunkText, createRagDeletionHandler, indexChunks, type RagScope } from "@arnilo/prism-memory-rag";
import { createFabricRepointHandler } from "../repoint.js";

const scope: Required<MemoryScope> = { tenantId: "t1", resourceId: "handbook", threadId: "s1" };
const ragScope: RagScope = { tenantId: scope.tenantId, resourceId: scope.resourceId, corpusId: scope.threadId };
const principal = { tenantId: scope.tenantId, principalId: "p1", groupIds: ["eng"] };
const sourceId = "docs/policy.md";
const derivedId = "summary:docs/policy.md";
const at = "2026-01-01T00:00:00.000Z";
function derived(id: string, sourceIds: readonly string[]): MemoryVectorRecord {
  return {
    id,
    ...scope,
    text: id,
    embedding: [0.5, 0.5],
    sequence: 99,
    embedderId: "hash",
    createdAt: at,
    metadata: { _lineage: { v: 1, sourceIds: [...sourceIds] } },
  };
}

describe("host wiring: one propagation, two layers", () => {
  it("runs rag and fabric legs in one pass and feeds the same tombstones to a projection", async () => {
    const store = createMemoryVectorStore();
    const embedder = createHashEmbedder({ dimensions: 8 });
    await indexChunks({
      chunks: chunkText("Payroll approvals need finance sign-off.", { sourceId }),
      embedder,
      store,
      scope: ragScope,
    });
    await store.upsert([derived(derivedId, [sourceId])]);
    await store.setSourceAccess(scope, [{ sourceId, principalIds: ["p1"], groupIds: [], accessVersion: 1 }]);
    // Notes live in the same store and name their document by path, so this leg is the only path to them.
    const fabric = createMemoryFabric({
      memory: createMemory({
        ...scope,
        embedder,
        vectorStore: store,
        workingStore: createMemoryWorkingStore(),
      }),
    });
    const note = await fabric.remember({ kind: "file", content: "Payroll approvals need finance sign-off.", path: sourceId });

    // The host's wiring: two handlers, one propagator, one privileged principal. The
    // observational-memory leg lived here in 0.12; its attach surface is deleted (plan 157 Task 5).
    const propagator = createDeletionPropagator({
      scope,
      vectorStore: store,
      authorization: principal,
      handlers: [createRagDeletionHandler({ store, scope: ragScope }), createFabricRepointHandler({ scope, vectorStore: store })],
    });
    // Privilege stays explicit: the type requires it, and a principal from another tenant is refused.
    assert.throws(
      () => createDeletionPropagator({ scope, vectorStore: store, authorization: { ...principal, tenantId: "t2" }, handlers: [] }),
      MemoryScopeError,
      "the host-verified principal must belong to the scope's tenant",
    );

    let invalidationReads = 0;
    const counted = {
      ...store,
      async listInvalidated(scopeInput: Required<MemoryScope>, options?: { readonly signal?: AbortSignal }) {
        invalidationReads += 1;
        return store.listInvalidated(scopeInput, options);
      },
    };

    const result = await propagator.propagate(sourceId);
    assert.equal(result.layers.rag, 1, "the rag leg removes the source's own chunk rows");
    assert.equal(result.layers.fabric, 1, "the fabric leg tombstones the note recorded against the path");
    assert.ok(result.ids.includes(sourceId) && result.ids.includes(derivedId));

    // Physical removal, tombstone and the ledger: each layer's own evidence.
    assert.equal((await store.getBySource?.(scope, sourceId))?.length ?? 0, 0);
    const invalidated = await store.listInvalidated(scope);
    assert.ok(
      invalidated.some((entry) => entry.id === derivedId),
      "the derived row stays as a tombstone",
    );
    assert.equal(
      (await fabric.recall("Payroll approvals need finance sign-off.")).hits.some((hit) => hit.id === note.id),
      false,
      "a deleted path stops serving its notes, without a lineage edge to walk",
    );

    // The same tombstones are what a projection reads: one read per build, and the derived id is in it.
    const blocked = await listInvalidatedIds(counted, scope);
    assert.equal(invalidationReads, 1, "the recipe reads the scope's invalidations once per projection build");
    assert.ok(blocked.includes(sourceId) && blocked.includes(derivedId));
  });
});
