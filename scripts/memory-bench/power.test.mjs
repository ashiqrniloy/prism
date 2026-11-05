import { test } from "bun:test";
import assert from "node:assert/strict";
import { minDetectableDifference, normalQuantile } from "./power.mjs";

test("power_check_matches_the_closed_form_for_a_known_paired_design", () => {
  // Reference values: z(0.975) = 1.959964, z(0.8) = 0.841621.
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(normalQuantile(0.8) - 0.841621) < 1e-5);
  assert.ok(Math.abs(normalQuantile(0.025) + 1.959964) < 1e-5);
  // 60 pairs, 10% of them answered differently: delta = 2.8016 * sqrt(0.1 / (60 + 7.849)) = 0.1076.
  const delta = minDetectableDifference({ n: 60, discordance: 0.1 });
  assert.ok(Math.abs(delta - 0.1076) < 5e-4, `got ${delta}`);
  // More pairs see smaller differences; more discordance hides them.
  assert.ok(minDetectableDifference({ n: 240, discordance: 0.1 }) < delta);
  assert.ok(minDetectableDifference({ n: 60, discordance: 0.3 }) > delta);
});

test("power_check_rejects_impossible_designs", () => {
  assert.throws(() => minDetectableDifference({ n: 1, discordance: 0.1 }), /n must be/);
  assert.throws(() => minDetectableDifference({ n: 60, discordance: 0 }), /discordance/);
  assert.throws(() => minDetectableDifference({ n: 60, discordance: 0.1, alpha: 1 }), /alpha and power/);
});
