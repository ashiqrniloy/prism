import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEventRecord, OwnershipScope, PersistencePage, ProductionPersistenceStore, RunRecord } from "@arnilo/prism";
import { createMemoryRunFeedbackStore, createSecretRedactor, type RunFeedbackStore } from "@arnilo/prism";
import { datasetFromRuns, defineDataset, EvalError } from "../index.js";

const SECRET = "SECRET_CANARY_VALUE";
const OWN = { tenantId: "t1" };
/** Feedback queries require tenant plus account/user, so feedback tests use this scope. */
const OWN_U = { tenantId: "t1", userId: "u1" };

function run(id: string, sessionId: string, own: OwnershipScope = OWN): RunRecord {
  return { id, sessionId, status: "succeeded", startedAt: "2026-01-01T00:00:00Z", ...own };
}

function userEvent(id: string, runId: string, sessionId: string, own: OwnershipScope = OWN): AgentEventRecord {
  return {
    id,
    sessionId,
    runId,
    type: "message_started",
    timestamp: "2026-01-01T00:00:00Z",
    redacted: true,
    ...own,
    event: { type: "message_started", sessionId, runId, message: { role: "user", content: [{ type: "text", text: "question" }] } },
  };
}

function assistantEvent(id: string, runId: string, sessionId: string, text: string, own: OwnershipScope = OWN): AgentEventRecord {
  return {
    id,
    sessionId,
    runId,
    type: "message_finished",
    timestamp: "2026-01-01T00:00:01Z",
    redacted: true,
    ...own,
    event: { type: "message_finished", sessionId, runId, message: { role: "assistant", content: [{ type: "text", text }] } },
  };
}

/** Ownership-sloppy fake: the resolver's exact ownership check is what must reject cross-tenant runs. */
function store(runs: readonly RunRecord[], events: readonly AgentEventRecord[], feedback?: RunFeedbackStore): ProductionPersistenceStore {
  const page = <T>(items: readonly T[]): PersistencePage<T> => ({ items: [...items] });
  return {
    queryRuns: async (query: { sessionId?: string }) =>
      page(runs.filter((candidate) => !query.sessionId || candidate.sessionId === query.sessionId)),
    queryEvents: async (query: { sessionId?: string; runId?: string }) =>
      page(
        events.filter(
          (candidate) => (!query.sessionId || candidate.sessionId === query.sessionId) && (!query.runId || candidate.runId === query.runId),
        ),
      ),
    queryToolCalls: async () => page([]),
    queryUsage: async () => page([]),
    ...(feedback ? { feedback } : {}),
  } as unknown as ProductionPersistenceStore;
}

function feedbackStoreFor(runs: readonly string[], own: OwnershipScope): RunFeedbackStore {
  return createMemoryRunFeedbackStore({
    resolveRun: ({ runId }) => (runs.includes(runId) ? { runId, sessionId: "s1", ...own } : false),
  });
}

describe("datasetFromRuns", () => {
  it("appends one item per run in stable run-id order and bumps the dataset version", async () => {
    const fake = store(
      [run("run_b", "s1"), run("run_a", "s1")],
      [
        userEvent("e1", "run_a", "s1"),
        assistantEvent("e2", "run_a", "s1", "answer A"),
        userEvent("e3", "run_b", "s1"),
        assistantEvent("e4", "run_b", "s1", "answer B"),
      ],
    );
    const before = defineDataset({ id: "d", version: "1", items: [] });
    const result = await datasetFromRuns({ runIds: ["run_b", "run_a"], dataset: before, store: fake, ownership: OWN });
    assert.equal(result.added, 2);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.version, "2");
    assert.deepEqual(
      result.dataset.items.map((item) => item.id),
      ["run_a", "run_b"],
    );
    assert.deepEqual((result.dataset.items[0].input as { content: readonly unknown[] }).content, [{ type: "text", text: "question" }]);
    assert.equal(result.dataset.items[0].expected, undefined); // no feedback configured → no fabricated expected
    assert.equal((result.dataset.items[0].metadata as { output: string }).output, "answer A");
    assert.equal(Object.isFrozen(result.dataset), true);
  });

  it("redacts secrets before items are stored", async () => {
    const fake = store([run("run_1", "s1")], [userEvent("e1", "run_1", "s1"), assistantEvent("e2", "run_1", "s1", `answer ${SECRET}`)]);
    const result = await datasetFromRuns({
      runIds: ["run_1"],
      dataset: defineDataset({ id: "d", items: [] }),
      store: fake,
      ownership: OWN,
      redactor: createSecretRedactor([SECRET]),
    });
    const expected = JSON.stringify(result.dataset.items);
    assert.equal(expected.includes(SECRET), false);
    assert.equal(expected.includes("[REDACTED]"), true);
  });

  it("skips missing runs, foreign ownership, and empty outputs while still curating the rest", async () => {
    const fake = store(
      [run("run_x", "s1"), run("run_foreign", "s2", { tenantId: "t2" }), run("run_empty", "s3")],
      [
        userEvent("e1", "run_x", "s1"),
        assistantEvent("e2", "run_x", "s1", "answer"),
        userEvent("e3", "run_foreign", "s2", { tenantId: "t2" }),
        assistantEvent("e4", "run_foreign", "s2", "secret answer", { tenantId: "t2" }),
        userEvent("e5", "run_empty", "s3"),
        assistantEvent("e6", "run_empty", "s3", ""),
      ],
    );
    const result = await datasetFromRuns({
      runIds: ["run_unknown", "run_empty", "run_x"],
      sessionIds: ["s2", "s_none"],
      dataset: defineDataset({ id: "d", items: [] }),
      store: fake,
      ownership: OWN,
    });
    assert.equal(result.added, 1);
    assert.equal(result.dataset.version, "2");
    assert.deepEqual(
      result.dataset.items.map((item) => item.id),
      ["run_x"],
    );
    const skip = new Map(result.skipped.map((entry) => [entry.id, entry.reason]));
    assert.equal(skip.get("run_unknown"), "missing run");
    assert.equal(skip.get("run_foreign"), "ownership mismatch");
    assert.equal(skip.get("run_empty"), "empty output");
    assert.equal(skip.get("s_none"), "missing run");
  });

  it("leaves the prior dataset version untouched", async () => {
    const fake = store([run("run_1", "s1")], [assistantEvent("e1", "run_1", "s1", "answer")]);
    const before = defineDataset({ id: "d", version: "1", items: [{ id: "seed", input: "old", expected: "old" }] });
    const result = await datasetFromRuns({ runIds: ["run_1"], dataset: before, store: fake, ownership: OWN });
    assert.equal(before.items.length, 1);
    assert.equal(before.items[0].input, "old");
    assert.equal(before.version, "1");
    assert.equal(result.dataset.items.length, 2);
    assert.deepEqual(result.dataset.items[0], before.items[0]);
    assert.equal(result.dataset.version, "2");
  });

  it("fails closed on oversized items and persists nothing", async () => {
    const fake = store([run("run_1", "s1")], [assistantEvent("e1", "run_1", "s1", "answer")]);
    const before = defineDataset({ id: "d", version: "1", items: [] });
    await assert.rejects(
      () =>
        datasetFromRuns({
          runIds: ["run_1"],
          dataset: before,
          store: fake,
          ownership: OWN,
          toItem: () => ({ input: "x".repeat(5 * 1024 * 1024) }),
        }),
      (error: unknown) => error instanceof EvalError && error.code === "ERR_PRISM_EVAL_CURATE",
    );
    assert.equal(before.items.length, 0);
  });
});

describe("datasetFromRuns feedback-to-expected mapping", () => {
  it("uses feedback metadata.expected as the default item expected and omits it when absent", async () => {
    const feedback = feedbackStoreFor(["run_1", "run_2"], OWN_U);
    // Two corrections for run_1: the later record wins; run_2 has no feedback at all.
    await feedback.append({
      id: "fb_1",
      runId: "run_1",
      ...OWN_U,
      tags: [],
      scorerIds: [],
      evaluationIds: [],
      createdAt: "2026-01-01T00:00:00Z",
      rating: 0,
      metadata: { expected: "stale gold" },
    });
    await feedback.append({
      id: "fb_2",
      runId: "run_1",
      ...OWN_U,
      tags: [],
      scorerIds: [],
      evaluationIds: [],
      createdAt: "2026-01-02T00:00:00Z",
      rating: 1,
      comment: "human graded",
      metadata: { expected: "correct gold" },
    });
    let queries = 0;
    const counted = {
      ...feedback,
      query: async (query: Parameters<typeof feedback.query>[0]) => {
        queries += 1;
        return feedback.query(query);
      },
    };
    const fake = store(
      [run("run_1", "s1", OWN_U), run("run_2", "s1", OWN_U)],
      [assistantEvent("e1", "run_1", "s1", "answer one", OWN_U), assistantEvent("e2", "run_2", "s1", "answer two", OWN_U)],
      counted,
    );
    const result = await datasetFromRuns({
      runIds: ["run_1", "run_2"],
      dataset: defineDataset({ id: "d", items: [] }),
      store: fake,
      ownership: OWN_U,
    });
    assert.equal(result.added, 2);
    assert.equal(queries, 1); // one bounded feedback query per batch
    const byId = new Map(result.dataset.items.map((item) => [item.id, item]));
    assert.equal(byId.get("run_1")?.expected, "correct gold"); // latest feedback record wins
    assert.equal(byId.get("run_2")?.expected, undefined); // feedback-absent → omitted, not fabricated
  });

  it("redacts feedback-derived expected values", async () => {
    const feedback = feedbackStoreFor(["run_1"], OWN_U);
    await feedback.append({
      id: "fb_1",
      runId: "run_1",
      ...OWN_U,
      tags: [],
      scorerIds: [],
      evaluationIds: [],
      metadata: { expected: `gold ${SECRET}` },
      rating: 1,
    });
    const fake = store([run("run_1", "s1", OWN_U)], [assistantEvent("e1", "run_1", "s1", "answer", OWN_U)], feedback);
    const result = await datasetFromRuns({
      runIds: ["run_1"],
      dataset: defineDataset({ id: "d", items: [] }),
      store: fake,
      ownership: OWN_U,
      redactor: createSecretRedactor([SECRET]),
    });
    const serialized = JSON.stringify(result.dataset.items);
    assert.equal(serialized.includes(SECRET), false);
    assert.equal(serialized.includes("[REDACTED]"), true);
  });

  it("keeps curating when feedback is unreachable and lets a host toItem opt in to graded bits", async () => {
    const fake = store(
      [run("run_1", "s1", OWN_U)],
      [assistantEvent("e1", "run_1", "s1", "answer", OWN_U)],
      feedbackStoreFor(["run_1"], { tenantId: "t1" }), // scope mismatch → feedback query fails closed
    );
    const result = await datasetFromRuns({
      runIds: ["run_1"],
      dataset: defineDataset({ id: "d", items: [] }),
      store: fake,
      ownership: OWN_U,
      toItem: (curated) => ({
        id: curated.run.id,
        input: curated.input,
        expected: curated.feedback?.metadata?.expected,
        metadata: { graded: curated.feedback?.rating },
      }),
    });
    assert.equal(result.added, 1); // failed feedback query does not abort curation
    assert.equal(result.dataset.items[0].expected, undefined);
    assert.equal((result.dataset.items[0].metadata as { graded: number | undefined }).graded, undefined);
  });
});
