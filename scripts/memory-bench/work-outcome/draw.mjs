#!/usr/bin/env bun
/**
 * Plan 209 Task 5: the frozen work-outcome partitions. Run once and commit the outputs before any measurement:
 *
 *   timeout 60 bun scripts/memory-bench/work-outcome/draw.mjs
 *
 * Label-blind (the `drawHeldoutV3` / plan 202 Task 2 pattern): persona ids are ordered by
 * `SHA-256(seed + ":" + id)` inside the family stratum. The draw reads ids only, never labels, schedules or values.
 * `heldout-a` and `heldout-b` belong to plan 210 Task 9; `heldout-b` is its single remediation round.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { ROBUSTNESS_PARTITIONS, robustnessIdsHash } from "../robustness.mjs";
import { personaIds, WORK_OUTCOME_FAMILIES } from "./personas.mjs";

/** Personas per partition: [dev, heldout-a, heldout-b]. */
export const WORK_OUTCOME_STRATA = Object.freeze({
  coding: Object.freeze({ "coding-work": [4, 4, 4] }),
  assistant: Object.freeze({ "assistant-work": [3, 3, 3] }),
});

export const workOutcomeSeed = (family) => `prism-209-work-outcome-${family}`;

/** Pure draw over ids; throws when the stratum is short, so a changed generator needs a deliberate re-draw. */
export function drawWorkOutcomePartitions(family, ids = personaIds(family)) {
  const strata = WORK_OUTCOME_STRATA[family];
  if (!strata) throw new Error(`WorkOutcomeArguments: unknown family ${family}`);
  const seed = workOutcomeSeed(family);
  const hash = (id) => createHash("sha256").update(`${seed}:${id}`).digest("hex");
  const abilities = Object.fromEntries(ROBUSTNESS_PARTITIONS.map((partition) => [partition, {}]));
  const residualPool = {};
  for (const [stratum, sizes] of Object.entries(strata)) {
    const unique = [...new Set(ids.map(String))];
    const needed = sizes.reduce((sum, size) => sum + size, 0);
    if (unique.length < needed) throw new Error(`WorkOutcomeDraw: ${family}/${stratum} has ${unique.length} of ${needed}`);
    const ordered = unique.sort((a, b) => hash(a).localeCompare(hash(b)));
    let start = 0;
    ROBUSTNESS_PARTITIONS.forEach((partition, index) => {
      abilities[partition][stratum] = ordered.slice(start, start + sizes[index]);
      start += sizes[index];
    });
    residualPool[stratum] = unique.length - needed;
  }
  return { seed, abilities, residualPool, idsHash: robustnessIdsHash(abilities) };
}

export function partitionFile(family) {
  const draw = drawWorkOutcomePartitions(family);
  return {
    seed: draw.seed,
    draw: `SHA-256("${draw.seed}:" + id), ascending inside the family stratum`,
    source: `work-outcome/personas.mjs family=${family} (project-owned synthetic generator)`,
    strata: WORK_OUTCOME_STRATA[family],
    part: "dev | heldout-a | heldout-b; dev is plan 209 Task 6's; heldout-a and heldout-b are plan 210 Task 9's (heldout-b only for its single remediation round)",
    residualPool: draw.residualPool,
    idsHash: draw.idsHash,
    abilities: draw.abilities,
  };
}

if (import.meta.main) {
  for (const family of WORK_OUTCOME_FAMILIES) {
    const output = partitionFile(family);
    await writeFile(new URL(`../work-outcome-${family}.json`, import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
    console.log(`${family}: ${ROBUSTNESS_PARTITIONS.map((p) => `${p}=${Object.values(output.abilities[p]).flat().length}`).join(" ")}`);
  }
}
