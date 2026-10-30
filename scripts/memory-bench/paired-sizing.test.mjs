import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildPairedSizing, pairedSizingMarkdown } from "./paired-sizing.mjs";
import { robustnessCriteriaHash } from "./robustness.mjs";

test("prospective_sizing_pins_frozen_design_and_uses_metadata_cluster_supply", async () => {
  const result = await buildPairedSizing();
  assert.equal(result.protocol.criteriaHash, robustnessCriteriaHash());
  assert.match(result.protocol.normalization.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(result.protocol.judges.gradedTemplate, /^[a-f0-9]{64}$/);
  assert.equal(result.protocol.context.policyVersion, 1);
  assert.equal(result.acceptance.length, 27);
  assert.ok(result.acceptance.every((row) => row.margin === 0.03 && row.status === "claim unresolved"));
  assert.ok(result.supply.filter((row) => row.suite.startsWith("beam-")).every((row) => row.clusters < row.questions));
  assert.equal(result.supply.find((row) => row.suite === "memoryagentbench-cr" && row.partition === "heldout-a").clusters, 7);
  const ordering = result.rubric.find((row) => row.ability === "event_ordering");
  assert.equal(ordering.primary[0].clusters, 3);
  assert.ok(Math.abs(ordering.primary[0].oracleCeiling - 0.8988) < 1e-9);
  assert.equal(ordering.primary[0].status, "not lever-discriminating at this sample");
  assert.equal(ordering.secondaryBinary[0].oracleCeiling, 0);
  assert.ok(result.rubric.every((row) => row.primary.every((sizing) => sizing.minimumDetectableDifference === null)));
  assert.match(pairedSizingMarkdown(result), /no finite detectable difference/);
});
