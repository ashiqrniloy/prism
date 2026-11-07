import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPredictions, JSON_PATH, MD_PATH, predictionProblems, ROOT, renderMarkdown, validate } from "./gap-analysis.mjs";
import { DEFERRED, ROWS } from "./gap-analysis-rows.mjs";

const ledger = JSON.parse(readFileSync(join(ROOT, "docs/_evidence/memory-bench/210/feature-ledger.json"), "utf8"));
const throws = (input) => {
  try {
    validate({ ledger, ...input });
  } catch (error) {
    return String(error.message);
  }
  return "";
};

describe("plan 210 Task 3 gap analysis", () => {
  test("gap_predictions_schema_valid_and_reference_ledger_rows", () => {
    expect(throws({})).toBe("");
    const predictions = buildPredictions({ ledger });
    const candidates = ledger.features.filter((f) => f.candidate).map((f) => f.id);
    // Every ledger candidate has exactly one row, and every entry names a ledger candidate.
    expect(new Set(ROWS.map((r) => r.id))).toEqual(new Set(candidates));
    for (const entry of predictions.predictions) {
      expect(candidates).toContain(entry.feature);
      expect(predictionProblems(entry, entry.feature)).toEqual([]);
    }
    // Task 3.1's predictions survive, folded into their ledger rows.
    for (const name of ["recall.expansion", "recall.gather", "recall.supersession-hint"])
      expect(predictions.predictions.some((p) => p.feature === name)).toBe(true);
    for (const name of ["inject.cardExcerpt", "directory.stopWords", "early-give-up"])
      expect(predictions.predictions.some((p) => p.variant === name)).toBe(true);
    expect(predictions.deferred.map((d) => d.id)).toEqual(expect.arrayContaining(["202-task17", "202-task13"]));

    // Each guard fails with a named problem.
    expect(throws({ rows: ROWS.slice(1) })).toContain(`${ROWS[0].id}: candidate has no gap-analysis row`);
    expect(throws({ rows: [...ROWS, { ...ROWS[0], id: "not.a.feature" }] })).toContain("not.a.feature: not a candidate");
    expect(throws({ rows: [{ ...ROWS[0], verdict: "maybe" }, ...ROWS.slice(1)] })).toContain("verdict maybe");
    const fix = ROWS.find((r) => r.verdict === "fix-and-measure");
    const others = ROWS.filter((r) => r !== fix);
    expect(throws({ rows: [{ ...fix, predicted: "" }, ...others] })).toContain(`${fix.id}: predicted missing`);
    expect(throws({ rows: [{ ...fix, suite: "locomo/heldout-a" }, ...others] })).toContain("held-out");
    const removal = ROWS.find((r) => r.verdict === "no-credible-path");
    expect(throws({ rows: [{ ...removal, removal: "" }, ...ROWS.filter((r) => r !== removal)] })).toContain("needs a removal");
    expect(throws({ deferred: DEFERRED.filter((d) => d.id !== "202-task17") })).toContain("deferred lever 202-task17 missing");
  });

  test("gap_analysis_is_text_free_and_committed_copy_is_current", () => {
    expect(readFileSync(join(ROOT, JSON_PATH), "utf8")).toBe(`${JSON.stringify(buildPredictions({ ledger }), null, 2)}\n`);
    expect(readFileSync(join(ROOT, MD_PATH), "utf8")).toBe(renderMarkdown());
  });
});
