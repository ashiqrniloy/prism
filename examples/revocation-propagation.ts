/**
 * Cross-layer revocation composition (plan 122 Task 7).
 *
 * One host, one in-memory vector store, three scenarios that a Synapta-shaped
 * host needs proven end to end:
 *
 *  1. access loss  — a principal loses a grant; the source stays for others.
 *  2. deletion     — `createDeletionPropagator` tombstones the source (and its
 *                    lineage-closed derived ids) and the registered handlers
 *                    delete chunk rows and retire observational-memory entries.
 *  3. mid-flight   — a grant revoked *while a reranker runs* still cannot leak:
 *                    the post-rerank gate re-reads and withholds the source.
 *
 * Revocation has two read paths into derived context and this example exercises
 * both: the physical drop entry (`om.observations.dropped`) and the build-time
 * `invalidatedIds` filter fed by `listInvalidatedIds`. Nothing here grants or
 * commits: retrieval, grants, and commit authority stay with the host.
 *
 * Offline: hash embedder, in-memory vector/session stores, no network.
 */
import {
  type AgentSession,
  type ContextBlock,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  type SessionEntry,
} from "@arnilo/prism";
import {
  createDeletionPropagator,
  createHashEmbedder,
  createMemoryVectorStore,
  listInvalidatedIds,
  type MemoryScope,
  type VectorStore,
} from "@arnilo/prism-memory";
import {
  activeObservations,
  buildObservationalMemoryContextBlocks,
  createMemoryId,
  createObservationalMemoryDropHandler,
  foldObservationalMemoryLedger,
  OBSERVATIONS_RECORDED,
} from "@arnilo/prism-memory/compaction/observational-memory";
import { chunkMarkdown, createRagDeletionHandler, indexChunks, retrieveContext } from "@arnilo/prism-memory/rag";

const TENANT = "t1";
const RESOURCE = "docs";
const CORPUS = "handbook";
const vectorScope: Required<MemoryScope> = { tenantId: TENANT, resourceId: RESOURCE, threadId: CORPUS };
const ragScope = { tenantId: TENANT, resourceId: RESOURCE, corpusId: CORPUS };
const analyst = { tenantId: TENANT, principalId: "analyst" };
const auditor = { tenantId: TENANT, principalId: "auditor" };
const DENIAL_SECRET = "sk-live-never-persist-this";

const PAYROLL = "payroll-export";
const SECURITY = "security-guide";
const PLAN_NOTES = "plan-notes";
const VENDOR = "vendor-contract";
const OBSERVATION_TEXT = "Payroll export moved to the new bucket";

const embedder = createHashEmbedder();
const store = createMemoryVectorStore();

await store.setSourceAccess(vectorScope, [
  { sourceId: PAYROLL, principalIds: ["analyst", "auditor"], accessVersion: 1 },
  { sourceId: SECURITY, principalIds: ["analyst", "auditor"], accessVersion: 1 },
  { sourceId: PLAN_NOTES, principalIds: ["analyst", "auditor"], accessVersion: 1 },
  { sourceId: VENDOR, principalIds: ["analyst", "auditor"], accessVersion: 1 },
]);

await indexChunks({
  chunks: chunkMarkdown("# Payroll export\n\nPayroll figures move to the new bucket in March.", { sourceId: PAYROLL }),
  embedder,
  store,
  scope: ragScope,
});
await indexChunks({
  chunks: chunkMarkdown("# Approval policy\n\nApprovers recheck current execution policy before side effects.", { sourceId: SECURITY }),
  embedder,
  store,
  scope: ragScope,
});
await indexChunks({
  chunks: chunkMarkdown("# Delivery plan\n\nThe rollout plan notes the staging window and rollback owner.", { sourceId: PLAN_NOTES }),
  embedder,
  store,
  scope: ragScope,
});
await indexChunks({
  chunks: chunkMarkdown("# Vendor contract\n\nVendor contract renewal terms expire next quarter.", { sourceId: VENDOR }),
  embedder,
  store,
  scope: ragScope,
});

function sourcesOf(result: Awaited<ReturnType<typeof retrieveContext>>): readonly string[] {
  return [...new Set(result.hits.map((hit) => hit.sourceId))];
}

function legsOf(result: Awaited<ReturnType<typeof retrieveContext>>, sourceId: string): readonly string[] {
  return result.hits.filter((hit) => hit.sourceId === sourceId).map((hit) => hit.provenance.retrieval);
}

/** Scenario 1: baseline retrieval sees both readable sources through the vector + lexical legs. */
const baseline = await retrieveContext("payroll export approval policy", {
  embedder,
  store,
  scope: ragScope,
  authorization: analyst,
  lexical: "fts",
  topK: 5,
});
const report = baseline.text; // host report generated from the authorized baseline

/** Scenario 2: access loss for the analyst only; the auditor still reads the retained rows. */
await store.setSourceAccess(vectorScope, [{ sourceId: PAYROLL, principalIds: ["auditor"], accessVersion: 2 }]);
const accessLossDenials: unknown[] = [];
const analystAfterAccessLoss = await retrieveContext("payroll export approval policy", {
  embedder,
  store,
  scope: ragScope,
  authorization: analyst,
  lexical: "fts",
  topK: 5,
  onAccessDenied: (denial) => accessLossDenials.push({ sourceId: denial.sourceId, reason: denial.reason, hits: denial.hits }),
});
const auditorAfterAccessLoss = await retrieveContext("payroll export approval policy", {
  embedder,
  store,
  scope: ragScope,
  authorization: auditor,
  lexical: "fts",
  topK: 5,
});
const tombstonesAfterAccessLoss = await listInvalidatedIds(store, vectorScope);
const rowsRetainedAfterAccessLoss = (await store.getBySource(vectorScope, PAYROLL)).length;

/** Scenario 3: observational memory holds one observation that rests on the payroll source. */
const sessionStore = createMemorySessionStore();
const session: AgentSession = createAgent({
  model: { provider: "mock", model: "revocation-demo" },
  provider: createMockProvider([]),
  store: sessionStore,
}).createSession({ id: "s-revocation" });
const observation = {
  id: createMemoryId("x"),
  content: OBSERVATION_TEXT,
  timestamp: "2026-01-01T00:00:00.000Z",
  relevance: "high" as const,
  sourceEntryIds: [PAYROLL],
  tokenCount: 8,
};
const observationEntry = createSessionEntry({
  id: "e-om-1",
  sessionId: session.id,
  parentId: session.leafId,
  kind: "custom",
  data: { type: OBSERVATIONS_RECORDED, observations: [observation] },
});
await sessionStore.append(observationEntry);
await session.checkout(observationEntry.id);

const memoryContent = (blocks: readonly ContextBlock[]): string => {
  const content = blocks.find((block) => block.title === "observational-memory")?.content;
  return typeof content === "string" ? content : "";
};
const entriesBeforeRevocation = await session.entries();
const contextBeforeRevocation = memoryContent(buildObservationalMemoryContextBlocks(entriesBeforeRevocation));

/** Deletion pass one: tombstone the lineage-closed id set and delete the chunk rows. */
const propagator = createDeletionPropagator({
  scope: vectorScope,
  vectorStore: store,
  authorization: auditor,
  handlers: [createRagDeletionHandler({ store, scope: ragScope })],
});
const deletion = await propagator.propagate(PAYROLL);

/** Read path: build-time `invalidatedIds` withholds what the drop entry has not retired yet. */
const invalidatedIds = await listInvalidatedIds(store, vectorScope);
const contextReadPath = memoryContent(buildObservationalMemoryContextBlocks(entriesBeforeRevocation, { invalidatedIds }));

const analystAfterDeletion = await retrieveContext("payroll export approval policy", {
  embedder,
  store,
  scope: ragScope,
  authorization: analyst,
  lexical: "fts",
  topK: 5,
});
const auditorAfterDeletion = await retrieveContext("payroll export approval policy", {
  embedder,
  store,
  scope: ragScope,
  authorization: auditor,
  lexical: "fts",
  topK: 5,
});

/** Write path: register the observational-memory leg and propagate again so the drop entry lands. */
const appends: SessionEntry[] = [];
propagator.register(
  createObservationalMemoryDropHandler({
    session,
    appendEntry: async (entry) => {
      appends.push(entry);
      await sessionStore.append(entry);
    },
  }),
);
const dropPass = await propagator.propagate(PAYROLL);
const entriesAfterDrop = await session.entries();
const contextAfterDrop = memoryContent(buildObservationalMemoryContextBlocks(entriesAfterDrop));
const dropObservationIds = appends.flatMap((entry) => {
  const data = entry.data as { readonly observationIds?: readonly string[] } | undefined;
  return data?.observationIds ?? [];
});
const activeObservationIdsAfterDrop = activeObservations(foldObservationalMemoryLedger(entriesAfterDrop)).map((active) => active.id);

/** Scenario 4: revoke landing while the reranker runs — the post-rerank gate re-reads and withholds. */
const midFlightDenials: unknown[] = [];
let preRerankSources: readonly string[] = [];
const midFlight = await retrieveContext("delivery plan staging window", {
  embedder,
  store,
  scope: ragScope,
  authorization: analyst,
  lexical: "fts",
  topK: 5,
  onAccessDenied: (denial) => midFlightDenials.push({ sourceId: denial.sourceId, reason: denial.reason, hits: denial.hits }),
  reranker: {
    async rerank({ hits }) {
      preRerankSources = [...new Set(hits.map((hit) => hit.sourceId))];
      // A revoke during rerank must not leak into the prompt.
      await store.setSourceAccess(vectorScope, [{ sourceId: PLAN_NOTES, principalIds: ["auditor"], accessVersion: 2 }]);
      return hits;
    },
  },
});

/** Scenario 5: a throwing grant check fails closed and the error is redacted and capped, never a payload. */
const flakyStore: VectorStore = {
  ...store,
  checkSourceAccess: async (scope, sourceId, authorization, accessOptions) => {
    if (sourceId === VENDOR) {
      throw new Error(`grant check failed for ${sourceId}: ${DENIAL_SECRET} ${"detail ".repeat(60)}`);
    }
    return store.checkSourceAccess(scope, sourceId, authorization, accessOptions);
  },
};
const denialPath: { sourceId: string; reason: string; error?: string }[] = [];
const deniedQuery = await retrieveContext("vendor contract approval policy", {
  embedder,
  store: flakyStore,
  scope: ragScope,
  authorization: analyst,
  lexical: "fts",
  topK: 5,
  secrets: [DENIAL_SECRET],
  onAccessDenied: (denial) => denialPath.push({ sourceId: denial.sourceId, reason: denial.reason, error: denial.error }),
});

const payload = {
  scenario: "cross-layer-revocation",
  baseline: { sources: sourcesOf(baseline), payrollLegs: legsOf(baseline, PAYROLL), hasRevokedText: report.includes("Payroll figures") },
  accessLoss: {
    analystSources: sourcesOf(analystAfterAccessLoss),
    analystDenials: accessLossDenials,
    auditorSources: sourcesOf(auditorAfterAccessLoss),
    tombstones: tombstonesAfterAccessLoss,
    retainedRows: rowsRetainedAfterAccessLoss,
  },
  deletion: {
    tombstonedIds: deletion.ids,
    layers: deletion.layers,
    dropLayers: dropPass.layers,
    analystSources: sourcesOf(analystAfterDeletion),
    auditorSources: sourcesOf(auditorAfterDeletion),
    invalidatedIds,
  },
  context: {
    beforeHasRevoked: contextBeforeRevocation.includes(OBSERVATION_TEXT),
    readPathHasRevoked: contextReadPath.includes(OBSERVATION_TEXT),
    afterDropHasRevoked: contextAfterDrop.includes(OBSERVATION_TEXT),
    parity: contextReadPath === contextAfterDrop,
    dropObservationIds,
    activeObservationIds: activeObservationIdsAfterDrop,
  },
  exposure: {
    reportHadRevokedText: report.includes("Payroll figures"),
    postDeletionRetrievedRevoked: [...sourcesOf(analystAfterDeletion), ...sourcesOf(auditorAfterDeletion)].includes(PAYROLL),
  },
  midFlight: { preRerankSources, sources: sourcesOf(midFlight), denials: midFlightDenials },
  denialPath: {
    denials: denialPath,
    remainingSources: sourcesOf(deniedQuery),
    errorCapped: denialPath.every((denial) => (denial.error?.length ?? 0) <= 256),
  },
  policy: {
    attentionThresholdsTouched: false,
    executionAuthority: "host",
    priorDisclosure: "not erased by revocation",
  },
};

console.log(JSON.stringify(payload));
