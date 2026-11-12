/**
 * Plan 218 Task 5: the live re-plan family (row M1, gate M-2).
 *
 * One session per persona works through a plan whose later half changes midway. The first plan's steps 1-4 discover a
 * function to rename and a config key to raise; its step 5 needs neither, so under that plan their results are finished
 * work. Then the user re-plans: step 5 is dropped and two new steps read what steps 1 and 3 found (the renamed function's
 * module, the config file and key). Memory must still hold those results, or bring them back once the scope changes;
 * otherwise the agent re-derives them from the files. M1 is task success on the two tasks after the re-plan;
 * re-derivations (`searchRederivationCalls`) are reported beside it.
 *
 * The plan text goes to the agent as a turn, and to the `WM` arm as the episode scope (`memory:scope`) before that turn;
 * the re-plan does the same. Steps 1 and 3 name neither the file nor the symbol they change (the long-session rule), and
 * the persona labels are hidden: no prompt names what a post-re-plan task needs.
 *
 *   timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --family re-plan --offline [--partition dev]
 *
 * Partitions live in `work-outcome-re-plan.json`, drawn label-blind once from the ids (`drawLongSessionPartitions` with
 * this family's seed) and pinned by `idsHash`; `memory-model-criteria.json` pins that file's hash (fixture `re-plan`).
 * Live runs are gate M-2's (plan 218 Task 6), through the same campaign machinery as gate M-1.
 */
import { readFile, writeFile } from "node:fs/promises";
import { robustnessIdsHash } from "../robustness.mjs";
import { codingProject, drawLongSessionPartitions, longSessionPairs } from "./long-session.mjs";

export const RE_PLAN_FAMILY = "re-plan";
export const RE_PLAN_PERSONA_COUNT = 12;
/** Personas per partition: [dev, heldout-a, heldout-b]. */
export const RE_PLAN_STRATA = Object.freeze({ "re-plan-coding": [4, 4, 4] });
export const RE_PLAN_SEED = "prism-218-re-plan";
/** Gate M-2's arms (plan 218 Task 6) plus the no-memory control. */
export const RE_PLAN_ARMS = Object.freeze(["memory-off", "WM", "STM-only", "OM-before"]);
export const RE_PLAN_METRIC = "M1: task success on the tasks after a mid-episode re-plan (re-derivations reported beside it)";
const PARTITION_FILE = new URL("../work-outcome-re-plan.json", import.meta.url);

export const rePlanPersonaIds = () => Array.from({ length: RE_PLAN_PERSONA_COUNT }, (_, index) => `rp${index}`);

/** The label-blind three-way draw of the family's ids. */
export function drawRePlanPartitions(ids = rePlanPersonaIds()) {
  return drawLongSessionPartitions(ids, { seed: RE_PLAN_SEED, strata: RE_PLAN_STRATA, name: "RePlanDraw" });
}

export function rePlanPartitionFile() {
  const draw = drawRePlanPartitions();
  return {
    seed: draw.seed,
    draw: `SHA-256("${draw.seed}:" + id), ascending inside the family stratum`,
    source: "work-outcome/re-plan.mjs (project-owned synthetic generator); ids only",
    strata: RE_PLAN_STRATA,
    part: "dev | heldout-a | heldout-b; dev is plan 218 Task 6's gate M-2; heldout-a and heldout-b belong to the memory model's gate A",
    residualPool: draw.residualPool,
    idsHash: draw.idsHash,
    abilities: draw.abilities,
  };
}

/** The committed partitions; refuses a file that no longer re-derives from the ids. */
export async function rePlanPartitions() {
  const file = JSON.parse(await readFile(PARTITION_FILE, "utf8"));
  const expected = rePlanPartitionFile();
  if (file.idsHash !== expected.idsHash || robustnessIdsHash(file.abilities) !== file.idsHash)
    throw new Error("RePlanPartitions: work-outcome-re-plan.json no longer matches its draw");
  return file;
}

/**
 * One persona: the long-session project generator under this family's seed, the first plan, the re-plan and the turns
 * in order. Task ids keep the long-session checks' names (`task1` rename, `task4` config, `task3` and `task6` their
 * dependents), so `longSessionChecks` grades them; `plan` and `replan` are unscored turns.
 */
export function createRePlanPersona(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= RE_PLAN_PERSONA_COUNT)
    throw new Error("RePlanArguments: persona index out of range");
  const id = `rp${index}`;
  const { word, files, labels } = codingProject(id, RE_PLAN_SEED);
  const { to, before, after } = labels;
  const rename = `Rename the function that formats cents (src/cli.ts uses it) to \`${to}\` everywhere in this project (its definition and every caller), then run the tests.`;
  const build = "Read the build log, in four parts logs/build-1.log to logs/build-4.log, and tell me how many lines report a warning.";
  const retry = `The ${word} service retries too few times: raise its retry limit in the project config from ${before} to ${after}. Run the tests.`;
  const deploy = "Read the deploy log, in four parts logs/deploy-1.log to logs/deploy-4.log, and list the steps that failed.";
  const report =
    'Create src/report.ts exporting `summary(cents: number): string`, which returns "summary: " followed by the result of the function you renamed in task 1 (import it from its module). Run the tests.';
  const docs =
    "Write docs/retries.md with one line naming the config file and the key you changed in task 3, and its new value. Run the tests.";
  const plan = [
    `# Plan: ${word} service maintenance`,
    `1. ${rename}`,
    `2. ${build}`,
    `3. ${retry}`,
    `4. ${deploy}`,
    "5. Write docs/deploy-failures.md listing the failed deploy steps from step 4.",
  ].join("\n");
  const replan = [
    `# Plan: ${word} service maintenance (re-planned after step 4)`,
    "1-4. Done.",
    `5. ${report}`,
    `6. ${docs}`,
    "The old step 5 (docs/deploy-failures.md) is dropped.",
  ].join("\n");
  const tasks = [
    { id: "plan", prompt: `Here is the plan for this session; I will give you each step in turn.\n${plan}`, scope: plan },
    { id: "task1", prompt: `Task 1. ${rename}` },
    { id: "task2", prompt: `Task 2. ${build}` },
    { id: "task4", prompt: `Task 3. ${retry}` },
    { id: "task5", prompt: `Task 4. ${deploy}` },
    { id: "replan", prompt: `Change of plan. The rest of the plan is now:\n${replan}`, scope: replan },
    { id: "task3", prompt: `Task 5. ${report}` },
    { id: "task6", prompt: `Task 6. ${docs}` },
  ];
  return {
    id,
    family: RE_PLAN_FAMILY,
    files,
    tasks,
    plan,
    replan,
    // Scored after the re-plan: task 3 reads what task 1 renamed, task 6 what task 4 (prompt "Task 3") changed.
    pairs: longSessionPairs(labels),
    labels,
  };
}

if (import.meta.main && process.argv.includes("--write-partitions")) {
  await writeFile(PARTITION_FILE, `${JSON.stringify(rePlanPartitionFile(), null, 2)}\n`);
  console.log("wrote work-outcome-re-plan.json");
}
