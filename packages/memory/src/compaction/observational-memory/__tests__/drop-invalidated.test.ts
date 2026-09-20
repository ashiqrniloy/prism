/**
 * Plan 102 Task 2: observational-memory ledger invalidation drop handler.
 *
 * The handler is the OM layer's `DeletionPropagator` leg: a revoked source id is
 * mapped through the folded ledger to the observations that rest on it, and one
 * `om.observations.dropped` entry retires them. These tests run the real
 * propagator against the in-memory vector store (no store query inside the
 * handler) and assert both halves of the defense in depth: the projection
 * hides `invalidatedIds` before the entry lands, the fold hides the entry's ids
 * after it lands, and both render the same memory.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentSession,
  type SessionEntry,
  type SessionStore,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
} from "@arnilo/prism";
import { type MemoryScope, createDeletionPropagator, createMemoryVectorStore } from "../../../index.js";
import {
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  activeObservations,
  buildObservationalMemoryProjection,
  createMemoryId,
  createObservationalMemoryDropHandler,
  foldObservationalMemoryLedger,
  renderObservationalMemory,
} from "../index.js";

const scope: Required<MemoryScope> = { tenantId: "t1", resourceId: "res1", threadId: "th1" };
const authority = { tenantId: "t1", principalId: "p1", groupIds: ["eng"] };
const granted = (sourceId: string) => ({ sourceId, principalIds: ["p1"], groupIds: [], accessVersion: 1 });

const observationX = {
  id: createMemoryId("x"),
  content: "Payroll export moved to the new bucket",
  timestamp: "2026-01-01T00:00:00.000Z",
  relevance: "high" as const,
  sourceEntryIds: ["src:payroll"],
  tokenCount: 8,
};
const observationY = {
  id: createMemoryId("y"),
  content: "Standup notes kept the old schema",
  timestamp: "2026-01-02T00:00:00.000Z",
  relevance: "medium" as const,
  sourceEntryIds: ["src:standup"],
  tokenCount: 7,
};

/** Seed an observation entry on the session branch (test-local writer; the handler uses the host's appendEntry). */
async function seed(session: AgentSession, store: SessionStore, entryId: string, observation: object): Promise<void> {
  const entry = createSessionEntry({
    id: entryId,
    sessionId: session.id,
    parentId: session.leafId,
    kind: "custom",
    data: { type: OBSERVATIONS_RECORDED, observations: [observation] },
  });
  await store.append(entry);
  await session.checkout(entry.id);
}

async function setup() {
  const store = createMemorySessionStore();
  const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider: createMockProvider([]), store });
  const session = agent.createSession({ id: "s1" });
  await seed(session, store, "e1", observationX);
  await seed(session, store, "e2", observationY);
  const appends: SessionEntry[] = [];
  const vectorStore = createMemoryVectorStore();
  await vectorStore.setSourceAccess(scope, [granted("src:payroll"), granted("src:unrelated")]);
  const propagator = createDeletionPropagator({
    scope,
    vectorStore,
    authorization: authority,
    handlers: [
      createObservationalMemoryDropHandler({
        session,
        appendEntry: async (entry) => {
          appends.push(entry);
          await store.append(entry);
        },
      }),
    ],
  });
  return { session, propagator, appends };
}

function dropEntries(entries: readonly SessionEntry[]): readonly SessionEntry[] {
  return entries.filter((entry) => entry.kind === "custom" && (entry.data as { type?: string } | undefined)?.type === OBSERVATIONS_DROPPED);
}

describe("observational memory invalidation drop handler", () => {
  it("drop_handler_retires_only_the_observations_that_rest_on_the_tombstoned_id", async () => {
    const { session, propagator, appends } = await setup();
    const result = await propagator.propagate("src:payroll");
    assert.equal(result.layers.observational, 1);
    assert.equal(appends.length, 1, "exactly one ledger append");
    const drops = dropEntries(await session.entries());
    assert.equal(drops.length, 1);
    const drop = drops[0];
    assert.ok(drop, "exactly one drop entry");
    const data = drop.data as { observationIds: readonly string[]; coversUpToId?: string };
    assert.deepEqual(data.observationIds, [observationX.id]);
    assert.equal(data.coversUpToId, undefined, "a tombstone set is not a coverage position");
    assert.deepEqual(
      activeObservations(foldObservationalMemoryLedger(await session.entries())).map((observation) => observation.id),
      [observationY.id],
      "the untouched observation stays active",
    );
  });

  it("drop_handler_no_match_appends_nothing_and_reports_zero", async () => {
    const { propagator, appends } = await setup();
    const result = await propagator.propagate("src:unrelated");
    assert.equal(result.layers.observational, 0);
    assert.equal(appends.length, 0, "append spy must not be called");
  });

  it("drop_handler_is_idempotent_for_a_repeated_propagation", async () => {
    const { session, propagator, appends } = await setup();
    await propagator.propagate("src:payroll");
    const second = await propagator.propagate("src:payroll");
    assert.equal(second.layers.observational, 0, "the dropped observation is no longer active");
    assert.equal(appends.length, 1);
    assert.equal(dropEntries(await session.entries()).length, 1);
  });

  it("drop_handler_projection_parity_with_invalidatedIds", async () => {
    const { session, propagator } = await setup();
    const before = buildObservationalMemoryProjection(await session.entries(), undefined, { invalidatedIds: ["src:payroll"] });
    await propagator.propagate("src:payroll");
    const after = buildObservationalMemoryProjection(await session.entries(), undefined);
    const rendered = renderObservationalMemory(after.reflections, after.observations);
    assert.equal(rendered, renderObservationalMemory(before.reflections, before.observations));
    assert.ok(!rendered.includes(observationX.content), "revoked content leaves the rendered memory");
  });
});
