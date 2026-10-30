#!/usr/bin/env bun
/**
 * Plan 202 Task 2: write the frozen robustness partitions. Run once, after the pins are verified,
 * and commit the outputs. The draw reads ids and ability labels only (never questions, gold or
 * history), and `heldout-b` exists only for the single remediation round in the plan header.
 *
 *   timeout 1800 bun scripts/memory-bench/robustness-draw.mjs
 */
import { writeFile } from "node:fs/promises";
import { DATASETS, loadDataset, normalizeDataset } from "./datasets.mjs";
import { drawRobustnessPartitions, ROBUSTNESS_PARTITIONS, ROBUSTNESS_STRATA } from "./robustness.mjs";

const SUITES = [
  "longmemeval-m",
  "beam-100k",
  "beam-500k",
  "beam-1m",
  "locomo",
  "memoryagentbench-cr",
  "memorycode",
  "vibemembench",
  "dreambench-swe",
];
/** The coding lifecycle suite is generated from a project-owned persona setting, not downloaded. */
const CODING_PERSONAS = 12;

async function main(argv = []) {
  const selected = argv.length ? SUITES.filter((suite) => argv.includes(suite)) : SUITES;
  for (const suite of selected) {
    const pin = DATASETS[suite];
    // LongMemEval-M extends LongMemEval-S with ~500-session haystacks but keeps the same question
    // ids and ability labels, so the draw is taken from the pinned S ids (the 2.7 GB M file is not
    // downloaded at draw time). A wrong id fails closed in selectQuestions at the first M run.
    const items =
      suite === "longmemeval-m"
        ? normalizeDataset(await loadDataset("longmemeval-s"), "longmemeval-s")
        : normalizeDataset(await loadDataset(suite), suite);
    const draw = drawRobustnessPartitions(items, suite);
    const output = {
      seed: draw.seed,
      draw: `SHA-256("${draw.seed}:" + id), ascending inside each ability and partition`,
      source: pin.url ?? pin.generated,
      datasetSha256: pin.sha256 ?? null,
      ...(suite === "longmemeval-m"
        ? { idSource: "longmemeval-s@98d7416c (same question ids and abilities; M extends the haystack)" }
        : {}),
      strata: ROBUSTNESS_STRATA[suite],
      part: "dev | heldout-a | heldout-b; heldout-b is reserved for the single remediation round",
      residualPool: draw.residualPool,
      idsHash: draw.idsHash,
      abilities: draw.abilities,
    };
    await writeFile(new URL(`./robustness-${suite}.json`, import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
    const counts = ROBUSTNESS_PARTITIONS.map((partition) => `${partition}=${Object.values(draw.abilities[partition]).flat().length}`).join(
      " ",
    );
    console.log(`${suite}: ${counts}`);
  }
  const personas = Array.from({ length: CODING_PERSONAS }, (_, index) => ({ id: `p${index}`, ability: "coding-lifecycle" }));
  const coding = drawRobustnessPartitions(personas, "coding-longitudinal");
  const output = {
    seed: coding.seed,
    draw: `SHA-256("${coding.seed}:" + id), ascending inside the coding-lifecycle stratum`,
    source: "lifecycle/synth.mjs personas=12 (project-owned synthetic generator)",
    datasetSha256: null,
    strata: ROBUSTNESS_STRATA["coding-longitudinal"],
    part: "dev | heldout-a | heldout-b; heldout-b is reserved for the single remediation round",
    residualPool: coding.residualPool,
    idsHash: coding.idsHash,
    abilities: coding.abilities,
  };
  await writeFile(new URL("./robustness-coding-longitudinal.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
  console.log("coding-longitudinal: 4 personas per partition");
}

if (import.meta.main) await main(process.argv.slice(2));
