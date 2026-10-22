import { test } from "bun:test";
import assert from "node:assert/strict";
import { replayMatrixArms } from "./replay-matrix.mjs";
import { parseVariantSpecs, VARIANT_PATHS } from "./variants.mjs";

test("replay_matrix_covers_every_historical_mechanism_once", () => {
  const arms = replayMatrixArms();
  const ids = arms.map((arm) => arm.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("baseline"));
  for (const spec of Object.keys(VARIANT_PATHS)) {
    parseVariantSpecs([spec]);
    assert.equal(arms.filter((arm) => arm.sourceVariants.includes(spec)).length, 1, spec);
  }
  for (const spec of ["lifecycle.scope=flat"]) assert.equal(arms.filter((arm) => arm.replayVariants.includes(spec)).length, 1, spec);
  for (const notes of [2, 10, 500]) assert.ok(ids.includes(`capacity-${notes}`));
  assert.ok(arms.filter((arm) => arm.exercise).length > 0);
});

import { classifyMechanism } from "./replay-matrix.mjs";

test("unexercised_variant_cannot_be_reported_as_live_evidence", () => {
  const baselineMetrics = { promotionPrecision: 1, promotionRecall: 1, archiveRegret: 0, graveyardIndex: 0.4, scopeAccuracy: 0.8 };
  const arm = { id: "om-taskState-off", sourceVariants: ["om.taskState=off"], exercise: "OM is not exercised by replay." };
  const changed = { ...baselineMetrics, graveyardIndex: 0 };
  assert.equal(classifyMechanism({ arm, baselineMetrics, metrics: changed }).status, "unexercised");
  assert.equal(
    classifyMechanism({ arm: { ...arm, exercise: undefined }, baselineMetrics, metrics: baselineMetrics }).status,
    "insensitive",
  );
  assert.equal(classifyMechanism({ arm: { ...arm, exercise: undefined }, baselineMetrics, metrics: changed }).status, "exercised");
  assert.equal(classifyMechanism({ arm: { ...arm, id: "baseline" }, baselineMetrics, metrics: baselineMetrics }).status, "baseline");
});
