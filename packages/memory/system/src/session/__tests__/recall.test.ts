import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { SessionEntry, ToolExecutionContext } from "@arnilo/prism";
import { type MemoryObservation, type MemoryWmItem, OBSERVATIONS_RECORDED, WM_RECORDED } from "../../index.js";
import { recallObservationalMemory, recallObservationalMemoryBranchPage, recallObservationalMemoryQuery } from "../recall.js";
import { createObservationalRecallTool } from "../recall-tool.js";
import { OBSERVATIONS_DROPPED } from "../types.js";

const source: SessionEntry = {
  id: "m1",
  sessionId: "s1",
  timestamp: "2026-06-20T00:00:00.000Z",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Prefer the shortest path; token secret-value" }] },
};
const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  kind: "statement",
  description: "User prefers shortest path.",
  timestamp: source.timestamp,
  relevance: "high",
  sourceEntryIds: [source.id, "missing"],
  tokenCount: 5,
};
const reflection: MemoryWmItem = {
  id: "bbbbbbbbbbbb",
  kind: "summary",
  text: "Prefer minimal package-only changes.",
  relevance: "medium",
  citedIds: [observation.id],
  tokenCount: 5,
};

function custom(id: string, data: unknown): SessionEntry {
  return { id, sessionId: "s1", timestamp: source.timestamp, kind: "custom", data };
}

describe("observational memory recall", () => {
  it("observational_memory_recall_observation_returns_current_branch_sources", () => {
    const result = recallObservationalMemory(
      [source, custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] })],
      observation.id,
      ["secret-value"],
      { detail: "full" },
    );
    assert.equal(result.found, true);
    assert.equal(result.kind, "observation");
    assert.deepEqual(
      result.sourceEntries?.map((entry) => entry.id),
      [source.id],
    );
    assert.deepEqual(result.missingSourceEntryIds, ["missing"]);
    assert.doesNotMatch(result.text, /secret-value/);
  });

  it("observational_memory_recall_wm_item_returns_dropped_cited_records", () => {
    const result = recallObservationalMemory(
      [
        source,
        custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
        custom("r", { type: WM_RECORDED, items: [reflection] }),
        custom("d", { type: OBSERVATIONS_DROPPED, observationIds: [observation.id] }),
      ],
      reflection.id,
    );

    assert.equal(result.found, true);
    assert.equal(result.kind, "wm_item");
    assert.deepEqual(
      result.citedObservations?.map((item) => item.id),
      [observation.id],
    );
    assert.match(result.text, /\(dropped\)/);
    assert.deepEqual(
      result.sourceEntries?.map((entry) => entry.id),
      [source.id],
    );
  });

  it("observational_memory_recall_wm_item_returns_cited_record_sources", () => {
    const result = recallObservationalMemory(
      [
        source,
        custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
        custom("r", { type: WM_RECORDED, items: [reflection] }),
      ],
      reflection.id,
    );

    assert.equal(result.found, true);
    assert.equal(result.kind, "wm_item");
    assert.deepEqual(
      result.citedObservations?.map((item) => item.id),
      [observation.id],
    );
    assert.match(result.text, /Cited STM records/);
    assert.match(result.text, /Source evidence/);
  });

  it("invalidated source withholds the WM item even after a compaction drop", () => {
    const entries = [
      source,
      custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      custom("r", { type: WM_RECORDED, items: [reflection] }),
      custom("d", { type: OBSERVATIONS_DROPPED, observationIds: [observation.id] }),
    ];
    const dropped = recallObservationalMemory(entries, reflection.id, [], { invalidatedIds: ["m1"] });
    assert.equal(dropped.reason, "revoked");
    assert.equal(dropped.dropped, true);
    assert.doesNotMatch(dropped.text, /minimal package-only/);
    assert.equal(recallObservationalMemory(entries, observation.id, [], { invalidatedIds: ["m1"] }).reason, "revoked");
  });

  it("observational_memory_recall_invalid_or_missing_id_fails_closed", () => {
    assert.deepEqual(recallObservationalMemory([], "not-an-id").reason, "invalid_id");
    assert.deepEqual(recallObservationalMemory([], "cccccccccccc").reason, "unknown_id");
  });

  it("observational_memory_recall_reports_dropped_observation", () => {
    const result = recallObservationalMemory(
      [
        source,
        custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
        custom("d", { type: OBSERVATIONS_DROPPED, observationIds: [observation.id] }),
      ],
      observation.id,
    );

    assert.equal(result.found, true);
    assert.equal(result.dropped, true);
    assert.match(result.text, /dropped/);
  });

  it("observational_memory_branch_page_pages_backward_and_forward", () => {
    const m = (id: string, text: string): SessionEntry => ({
      id,
      sessionId: "s1",
      timestamp: source.timestamp,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    const entries = [m("m1", "one"), m("m2", "two"), m("m3", "three"), m("m4", "four")];
    const backward = recallObservationalMemoryBranchPage(entries, { cursor: "m3", limit: 2, direction: "backward" });
    assert.equal(backward.found, true);
    assert.deepEqual(
      backward.entries.map((entry) => entry.id),
      ["m2", "m3"],
    );
    assert.equal(backward.nextCursor, "m1");

    const forward = recallObservationalMemoryBranchPage(entries, { cursor: "m2", limit: 2, direction: "forward" });
    assert.deepEqual(
      forward.entries.map((entry) => entry.id),
      ["m2", "m3"],
    );
    assert.equal(forward.nextCursor, "m4");
  });

  it("observational_memory_branch_page_fails_closed_for_missing_or_invalid_cursor", () => {
    const entries = [source];
    assert.equal(recallObservationalMemoryBranchPage(entries, { cursor: "" }).reason, "invalid_cursor");
    assert.equal(recallObservationalMemoryBranchPage(entries, { cursor: "missing" }).reason, "cursor_not_found");
    assert.equal(
      recallObservationalMemoryBranchPage([source, custom("x", { type: OBSERVATIONS_RECORDED, observations: [] })], {
        cursor: "x",
      }).reason,
      "cursor_not_message",
    );
    assert.equal(recallObservationalMemoryBranchPage(entries, { cursor: "m1", limit: 10_000 }).reason, "limit_exceeded");
  });
});

describe("recall query over the session tiers (plan 218.2 Task 7)", () => {
  const at = "2026-11-15T10:00:00.000Z";
  const record = (id: string, description: string, kind: MemoryObservation["kind"] = "result"): MemoryObservation => ({
    id,
    kind,
    description,
    timestamp: at,
    relevance: "medium",
    sourceEntryIds: [source.id],
    tokenCount: 5,
  });
  const discarded = record("cccccccccccc", "Retry maxAttempts set to 5 after the interrupted upload.");
  const active = record("dddddddddddd", "Upload interrupted twice on the CI runner.", "error");
  const ledgerEntries = (sessionId = "s1"): SessionEntry[] =>
    [
      { type: OBSERVATIONS_RECORDED, observations: [discarded, active] },
      { type: WM_RECORDED, items: [reflection] },
      { type: "memory.session.observations.tombstoned", observationIds: [discarded.id], reason: "wm discard finished", at },
    ].map((data, index) => ({ ...custom(`q${index}`, data), sessionId }));

  it("query_finds_tombstoned_record_with_its_discard_reason", () => {
    const result = recallObservationalMemoryQuery(ledgerEntries(), { query: "retry maxAttempts interrupted", limit: 8 });
    assert.equal(result.found, true);
    assert.equal(result.hits[0]?.id, discarded.id, "full coverage ranks first");
    assert.equal(result.hits[0]?.state, "tombstoned");
    assert.equal(result.hits[0]?.stateReason, "wm discard finished");
    assert.match(result.text, /\[cccccccccccc\] result 2026-11-15T10:00:00\.000Z \(tombstoned: wm discard finished\): Retry maxAttempts/);
    assert.deepEqual(
      result.hits.map((hit) => [hit.id, hit.state]),
      [
        [discarded.id, "tombstoned"],
        [active.id, "active"],
      ],
    );
  });

  it("query_searches_wm_items_and_reports_no_match_with_the_tiers", () => {
    const wm = recallObservationalMemoryQuery(ledgerEntries(), { query: "minimal package changes" });
    assert.equal(wm.hits[0]?.kind, "wm_item");
    const none = recallObservationalMemoryQuery(ledgerEntries(), { query: "kubernetes helm" });
    assert.equal(none.found, false);
    assert.equal(none.reason, "no_match");
    assert.deepEqual(none.tiers, ["stm", "wm"]);
    assert.equal(recallObservationalMemoryQuery(ledgerEntries(), { query: "the of" }).reason, "invalid_query");
    assert.equal(recallObservationalMemoryQuery(ledgerEntries(), { query: "retry", limit: 0 }).reason, "limit_exceeded");
  });

  it("query_output_is_redacted_with_the_session_secrets", () => {
    const leaky = record("eeeeeeeeeeee", "Deploy token tok-12345 rotated");
    const entries = [custom("x", { type: OBSERVATIONS_RECORDED, observations: [leaky] })];
    const result = recallObservationalMemoryQuery(entries, { query: "deploy token" }, ["tok-12345"]);
    assert.equal(result.found, true);
    assert.doesNotMatch(result.text, /tok-12345/);
    assert.doesNotMatch(JSON.stringify(result.hits), /tok-12345/);
  });

  it("recall_requires_exactly_one_of_id_cursor_query", async () => {
    const tool = createObservationalRecallTool();
    const session = { id: "s1", entries: async () => ledgerEntries() };
    const run = async (args: Record<string, unknown>) =>
      (await tool.execute(args as never, { toolCallId: "t", session } as unknown as ToolExecutionContext)).value as {
        found: boolean;
        reason?: string;
      };
    for (const args of [{}, { id: discarded.id, query: "retry" }, { cursor: "m1", query: "retry" }, { id: discarded.id, cursor: "m1" }]) {
      assert.equal((await run(args)).reason, "invalid_request", JSON.stringify(args));
    }
    assert.equal((await run({ query: "retry maxAttempts" })).found, true);
    assert.equal((await run({ id: discarded.id })).found, true);
  });

  it("query_reads_only_the_executing_session", async () => {
    const tool = createObservationalRecallTool();
    // Session s2's branch holds no memory records; s1's records are not reachable from it.
    const other = { id: "s2", entries: async () => [{ ...source, sessionId: "s2" }] };
    const result = (
      await tool.execute(
        { query: "retry maxAttempts" } as never,
        {
          toolCallId: "t",
          session: other,
        } as unknown as ToolExecutionContext,
      )
    ).value as { found: boolean; reason?: string };
    assert.equal(result.found, false);
    assert.equal(result.reason, "no_match");
    const own = (
      await tool.execute(
        { query: "retry maxAttempts" } as never,
        {
          toolCallId: "t",
          session: { id: "s1", entries: async () => ledgerEntries() },
        } as unknown as ToolExecutionContext,
      )
    ).value as { found: boolean };
    assert.equal(own.found, true);
  });
});
