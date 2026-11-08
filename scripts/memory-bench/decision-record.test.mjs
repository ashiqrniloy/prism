import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertDecisionRecord, buildDecisionRecord, renderDecisionMarkdown } from "./decision-record.mjs";
import { CLEANUP_CRITERIA, cleanupVerdict } from "./robustness.mjs";

const read = (path) => readFileSync(new URL(`../../docs/_evidence/memory-bench/210/${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const inputs = () => ({
  ledger: json("feature-ledger.json"),
  report: json("ablations/c1-report.json"),
  predictions: json("gap-predictions.json"),
  owner: json("owner-decisions.json"),
});
const build = (edit) => {
  const value = structuredClone(inputs());
  edit?.(value);
  return { value, record: buildDecisionRecord(value) };
};

test("decision_record_matches_ledger_and_verdicts", () => {
  const { value, record } = build();
  assertDecisionRecord(record, value);

  // Every ledger row appears once, and the committed files are a fresh build.
  expect(record.features.map((item) => item.feature).sort()).toEqual(value.ledger.features.map((row) => row.id).sort());
  expect(JSON.parse(read("decisions.json"))).toEqual(JSON.parse(JSON.stringify(record)));
  expect(read("decisions.md")).toBe(renderDecisionMarkdown(record));
  expect(record.cleanupCriteriaHash).toBe(value.report.cleanupCriteriaHash);

  // Each measured verdict is the report's `cleanupVerdict()` result, changed only by a written owner hold.
  const holds = value.owner.holds;
  for (const item of record.features.filter((row) => row.section === "measured")) {
    const reported = value.report.verdicts.find((row) => row.feature === item.feature);
    expect(item.computed).toBe(reported.verdict);
    expect(cleanupVerdict(reported.evidence).verdict).toBe(item.computed);
    expect(item.verdict).toBe(holds[item.feature] ? "owner-hold" : item.computed);
  }
  expect(Object.keys(holds).sort()).toEqual(record.experimental.slice().sort());

  // The owner approved the removals: three negative wave-1 features and the eleven inert ones; lexical is kept.
  expect(record.removals.sort()).toEqual(
    [
      "write.keyword-enrichment",
      "timeline",
      "recall.supersession-hint",
      ...CLEANUP_CRITERIA.inertRemoval.features,
      ...CLEANUP_CRITERIA.inertRemoval.conditional.features,
    ].sort(),
  );
  const lexical = record.features.find((item) => item.feature === "retrieval.lexical");
  expect(lexical).toMatchObject({ verdict: "keep", tier: "stable", reason: "benefit" });

  // A hold needs a written reason, and never rescues a negative verdict.
  expect(() => build((v) => (v.owner.holds["recall.multi-query"] = " "))).toThrow(/needs a written reason/);
  expect(() => build((v) => (v.owner.holds["write.keyword-enrichment"] = "keep it"))).toThrow(/does not apply to a negative verdict/);
  expect(() => build((v) => (v.owner.holds["scope.user"] = "x"))).toThrow(/no wave-1 verdict/);
  // A report pinned to other criteria is refused.
  expect(() => build((v) => (v.report.cleanupCriteriaHash = "0".repeat(64)))).toThrow(/pins a different/);
  // Verdicts carry no text: ids, labels, counts and scores only.
  expect(JSON.stringify(record)).not.toMatch(/"(question|gold|answer|note)Text"/);
});

test("decision_record_lists_transferred_rows_with_destination", () => {
  const { value, record } = build();
  const transferred = record.features.filter((item) => item.section === "transferred");
  expect(transferred).toHaveLength(CLEANUP_CRITERIA.transferred.features.length);
  for (const item of transferred) {
    expect(item.verdict).toBe("transferred");
    expect(Number.isInteger(item.plan)).toBe(true);
    expect(item.tier).toBeUndefined();
  }
  expect(new Set(transferred.map((item) => item.plan))).toEqual(new Set([216, 217, 218, 219, 220, 221]));
  expect(record.features.find((item) => item.feature === "om.observer")).toMatchObject({ plan: 217 });
  expect(record.features.find((item) => item.feature === "lifecycle.maintain")).toMatchObject({ plan: 221 });
  // No transferred row is removed or held, and the markdown lists each with its destination.
  expect(record.removals.filter((id) => transferred.some((item) => item.feature === id))).toEqual([]);
  const markdown = renderDecisionMarkdown(record);
  for (const item of transferred) expect(markdown).toContain(`| \`${item.feature}\` | transferred | plan ${item.plan} |`);

  // The check fails if a transferred row carries a keep or remove verdict, or lacks a destination.
  for (const edit of [
    (row) => (row.verdict = "keep"),
    (row) => (row.verdict = "remove"),
    (row) => (row.plan = undefined),
    (row) => (row.plan = 99),
  ]) {
    const broken = structuredClone(record);
    edit(broken.features.find((item) => item.feature === "kind.concept"));
    expect(() => assertDecisionRecord(broken, value)).toThrow(/transferred|destination/);
  }
});

test("cancelled_wave_rows_recorded_unmeasured_not_removed", () => {
  const { value, record } = build();
  const cancelled = [
    "recall.gather",
    "recall.expansion",
    "delivery.precision-filter",
    "retrieval.strength-priors",
    "delivery.aggregation-abstention",
    "decisions.P3",
    "decisions.P4",
    "decisions.P5",
  ];
  for (const id of cancelled) {
    const item = record.features.find((row) => row.feature === id);
    expect(item).toMatchObject({ section: "unmeasured", verdict: "unmeasured", unmeasuredKind: "wave-cancelled" });
    expect(item.tier).toBeUndefined();
    expect(record.removals).not.toContain(id);
    expect(record.experimental).not.toContain(id);
  }
  // Opt-in variants stay opt-in and default-on features stay on: nothing about them changes here.
  expect(record.features.find((row) => row.feature === "retrieval.strength-priors").stays).toMatch(/default|preset/);
  // The check fails if a cancelled-wave row is removed or held.
  const broken = structuredClone(record);
  Object.assign(
    broken.features.find((row) => row.feature === "recall.gather"),
    { verdict: "remove" },
  );
  expect(() => assertDecisionRecord(broken, value)).toThrow(/unmeasured and must not be removed/);
  // And the report calls their predictions `cancelled`, never a miss.
  for (const arm of ["gather", "expansion", "precision-filter", "aggregation-loo", "decisions-p3", "decisions-p5"])
    expect(value.report.predictions.find((item) => item.arm === arm).outcome).toBe("cancelled");
});
