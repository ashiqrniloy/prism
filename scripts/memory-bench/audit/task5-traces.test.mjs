import { expect, test } from "bun:test";
import { recoverToolSurfacing } from "./task5-traces.mjs";

test("task5_trace_recovery_excludes_hidden_candidates_and_passive_context", () => {
  const trace = {
    recalls: [{ candidateIds: ["hidden"] }],
    requests: [
      {
        attempt: 0,
        context: [{ ids: ["passive"] }],
        messages: [
          {
            content: [
              { type: "text", text: "[passive]" },
              { type: "tool_result", name: "memory.recall", result: { hits: [{ id: "note-a" }] } },
              { type: "tool_result", name: "memory.read", result: { notes: [{ id: "note-b" }] } },
              { type: "tool_result", name: "memory.read", error: { code: "denied" }, result: { notes: [{ id: "failed" }] } },
            ],
          },
        ],
      },
    ],
  };
  const recovered = recoverToolSurfacing({
    trace,
    complete: true,
    needed: ["a", "b", "hidden", "passive", "failed"],
    roundMap: new Map([
      ["note-a", "a"],
      ["note-b", "b"],
    ]),
  });
  expect(recovered.surfacing.rounds.filter((r) => r.surfaced).map((r) => r.id)).toEqual(["a", "b"]);
  expect(recovered.surfacing.neverSurfaced).toBe(3);
});

test("task5_missing_trace_is_unknown", () => {
  expect(recoverToolSurfacing({ needed: ["a"] }).surfacing).toBeNull();
  expect(recoverToolSurfacing({ trace: { requests: [] }, needed: ["a"] }).surfacing).toBeNull();
});

test("task5_incomplete_labels_or_unmapped_results_cannot_prove_a_gap", () => {
  const trace = {
    requests: [
      { attempt: 0, messages: [{ content: [{ type: "tool_result", name: "memory.recall", result: { hits: [{ id: "unmapped" }] } }] }] },
    ],
  };
  expect(recoverToolSurfacing({ trace, complete: true, needed: ["a"] }).surfacing).toBeNull();
  expect(recoverToolSurfacing({ trace, complete: true, needed: ["a"], unresolvedGold: 1 }).surfacing).toBeNull();
  expect(recoverToolSurfacing({ trace, complete: true, needed: [] }).surfacing).toBeNull();
});

test("task5_recovery_discards_failed_answer_attempts", () => {
  const trace = {
    requests: [0, 1].map((attempt) => ({
      attempt,
      messages: [{ content: [{ type: "tool_result", name: "memory.recall", result: { hits: [{ id: attempt ? "b" : "a" }] } }] }],
    })),
  };
  const result = recoverToolSurfacing({
    trace,
    complete: true,
    needed: ["a", "b"],
    roundMap: new Map([
      ["a", "a"],
      ["b", "b"],
    ]),
    attempt: 1,
  });
  expect(result.surfacing.neverSurfaced).toBe(1);
  expect(result.surfacing.rounds[0].surfaced).toBe(false);
});
