import { expect, test } from "bun:test";
import { toolSurfacing } from "./replay.mjs";

test("diagnostic_counts_rounds_never_surfaced_by_any_tool_result", () => {
  const result = toolSurfacing(["a", "b", "c"], ["a", "a", "c", "unrelated"]);
  expect(result.rounds).toEqual([
    { id: "a", surfaced: true },
    { id: "b", surfaced: false },
    { id: "c", surfaced: true },
  ]);
  expect(result.neverSurfaced).toBe(1);
  expect(result.candidateGap).toBe(true);
  expect(toolSurfacing(["a", "b"], ["b", "a"]).candidateGap).toBe(false);
  expect(toolSurfacing([], []).candidateGap).toBe(false);
});
