/**
 * Plan 218.2 Task 8: the long-horizon family, at the shipped triggers.
 *
 * The long-session family's arms run `stm.triggerTokens: 1_000` and `recentMessages: 4` on sessions of about 20K
 * eligible tokens, so the package defaults have never been measured live. This family chains the long-session
 * persona template (`codingProject`, six tasks, two related pairs) into one session of several projects: every
 * project's source tasks first (rename, build log, config, deploy log), then every project's dependent tasks (report,
 * retries doc). A dependent task therefore sits after all the other projects' work, and its project's facts sit among
 * look-alike facts of the other projects. Each task names its project (`[project pN]`); the tools act on that
 * project's files (as a host that changes directory), so no task sees another project's files.
 *
 * Every memory arm runs the package defaults: no `stm.triggerTokens`, `context.recentMessages` or `context.compactAt`
 * override, so compaction follows the model's real window. memory-off and `fold` keep the runner's kernel gate;
 * `llm-summary` compacts at the memory system's default ratio of the window (`SHIPPED_COMPACT_AT_RATIO`). Before any spend the scripted worker must show WM engaging at the defaults
 * (`assertLongHorizonEngages`): at least `LONG_HORIZON_MIN_WM_PASSES` WM passes with an item in every session.
 *
 *   timeout 1200 bun scripts/memory-bench/work-outcome/run.mjs --family long-horizon --arms memory-off,fold,llm-summary,STM-only,WM --offline
 *   timeout 1200 bun scripts/memory-bench/work-outcome/run.mjs --family long-horizon --estimate
 *
 * Partitions live in `work-outcome-long-horizon.json`, drawn label-blind once from the session ids
 * (`drawLongSessionPartitions` with this family's seed) and pinned by `idsHash`; `memory-model-criteria.json` pins
 * that file's hash (fixture `long-horizon`). No gate names the family yet, so it has no live job.
 */
import { readFile, writeFile } from "node:fs/promises";
import { robustnessIdsHash } from "../robustness.mjs";
import { codingProject, drawLongSessionPartitions, longSessionPairs, longSessionTasks } from "./long-session.mjs";

export const LONG_HORIZON_FAMILY = "long-horizon";
export const LONG_HORIZON_SESSION_COUNT = 6;
/** Projects chained into one session: enough for at least `LONG_HORIZON_MIN_ELIGIBLE_TOKENS` eligible tokens. */
export const LONG_HORIZON_PROJECTS = 13;
export const LONG_HORIZON_MIN_ELIGIBLE_TOKENS = 150_000;
/** The precondition: WM passes with at least one item, per session, on the scripted worker at the defaults. */
export const LONG_HORIZON_MIN_WM_PASSES = 5;
/** Sessions per partition: [dev, heldout-a, heldout-b]. */
export const LONG_HORIZON_STRATA = Object.freeze({ "long-horizon-coding": [2, 2, 2] });
export const LONG_HORIZON_SEED = "prism-218.2-long-horizon";
export const LONG_HORIZON_ARMS = Object.freeze(["memory-off", "fold", "llm-summary", "STM-only", "WM"]);
export const LONG_HORIZON_METRIC =
  "task success on each project's dependent tasks after every other project's work, at the package defaults (re-derivations and whole-run tokens per successful task beside it)";
const PARTITION_FILE = new URL("../work-outcome-long-horizon.json", import.meta.url);
/** Source tasks of every project first, then dependent tasks: the long-session template's task ids. */
const SOURCE_TASKS = ["task1", "task2", "task4", "task5"];
const DEPENDENT_TASKS = ["task3", "task6"];

export const longHorizonSessionIds = () => Array.from({ length: LONG_HORIZON_SESSION_COUNT }, (_, index) => `lh${index}`);

/** The label-blind three-way draw of the family's session ids. */
export function drawLongHorizonPartitions(ids = longHorizonSessionIds()) {
  return drawLongSessionPartitions(ids, { seed: LONG_HORIZON_SEED, strata: LONG_HORIZON_STRATA, name: "LongHorizonDraw" });
}

export function longHorizonPartitionFile() {
  const draw = drawLongHorizonPartitions();
  return {
    seed: draw.seed,
    draw: `SHA-256("${draw.seed}:" + id), ascending inside the family stratum`,
    source: "work-outcome/long-horizon.mjs (project-owned synthetic generator, the long-session template chained); ids only",
    strata: LONG_HORIZON_STRATA,
    projectsPerSession: LONG_HORIZON_PROJECTS,
    part: "dev | heldout-a | heldout-b; dev is the development reading; heldout-a and heldout-b belong to the memory model's gate A",
    residualPool: draw.residualPool,
    idsHash: draw.idsHash,
    abilities: draw.abilities,
  };
}

/** The committed partitions; refuses a file that no longer re-derives from the ids. */
export async function longHorizonPartitions() {
  const file = JSON.parse(await readFile(PARTITION_FILE, "utf8"));
  const expected = longHorizonPartitionFile();
  if (
    file.idsHash !== expected.idsHash ||
    robustnessIdsHash(file.abilities) !== file.idsHash ||
    file.projectsPerSession !== LONG_HORIZON_PROJECTS
  )
    throw new Error("LongHorizonPartitions: work-outcome-long-horizon.json no longer matches its draw");
  return file;
}

/**
 * One session: `LONG_HORIZON_PROJECTS` projects from the long-session generator under this family's seed (a project
 * is a function of its id), their tasks tagged with the project, source tasks first. The prompts are the long-session
 * template's (`longSessionTasks`) with the project named, so the dependent prompts still name nothing a dependent task
 * needs.
 */
export function createLongHorizonSession(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= LONG_HORIZON_SESSION_COUNT)
    throw new Error("LongHorizonArguments: session index out of range");
  const id = `lh${index}`;
  const projects = Array.from({ length: LONG_HORIZON_PROJECTS }, (_, k) => {
    const project = `p${k}`;
    const { word, files, labels } = codingProject(`${id}.${project}`, LONG_HORIZON_SEED);
    const prompts = Object.fromEntries(longSessionTasks(word, labels).map((entry) => [entry.id, longHorizonPrompt(entry.prompt, project)]));
    return { id: project, files, labels, pairs: longSessionPairs(labels), prompts };
  });
  const task = (project, taskId) => ({
    id: `${project.id}.${taskId}`,
    project: project.id,
    taskId,
    prompt: project.prompts[taskId],
  });
  const tasks = [
    ...projects.flatMap((project) => SOURCE_TASKS.map((taskId) => task(project, taskId))),
    ...projects.flatMap((project) => DEPENDENT_TASKS.map((taskId) => task(project, taskId))),
  ];
  return {
    id,
    family: LONG_HORIZON_FAMILY,
    projects: projects.map(({ prompts: _prompts, ...project }) => project),
    tasks,
  };
}

/** Tag a prompt with its project: `Task 1. [project p3] Rename ...`; dependent prompts name the project's task. */
export function longHorizonPrompt(prompt, project) {
  return prompt.replace(/^Task (\d)\. /, `Task $1. [project ${project}] `).replace(/in task (\d)\b/, `in task $1 of project ${project}`);
}

/**
 * The precondition, on the scripted worker before any spend: WM records at least `LONG_HORIZON_MIN_WM_PASSES` passes
 * with an item in every session at the defaults. Otherwise the family is not run and the finding goes to the owner.
 * `report` is an offline `WM`-arm report (tests pass one); without it the dev sessions run offline here.
 */
export async function assertLongHorizonEngages({ partition = "dev", personaLimit, report } = {}) {
  const reading = longHorizonEngagement(
    report ??
      (await (
        await import("./long-session.mjs")
      ).runLongSession({
        family: LONG_HORIZON_FAMILY,
        partition,
        arms: ["WM"],
        offline: true,
        ...(personaLimit ? { personaLimit } : {}),
      })),
  );
  if (!reading.engaged)
    throw new Error(
      `LongHorizonPrecondition: at the package defaults the scripted worker's WM recorded ${reading.sessions
        .map((row) => `${row.passesWithItem} passes with an item in ${row.session}`)
        .join(", ")}; the family needs ${LONG_HORIZON_MIN_WM_PASSES} per session, so it is not run (finding to the owner)`,
    );
  return reading;
}

/** WM passes with at least one item, per session of a report's `WM` arm (ids and counts only). */
export function longHorizonEngagement(report) {
  const sessions = (report?.usage ?? [])
    .filter((row) => row.arm === "WM")
    .map((row) => ({
      session: row.persona,
      eligibleTokens: row.eligibleTokens,
      passes: row.session?.passes ?? 0,
      passesWithItem: (row.session?.items ?? []).filter((count) => count > 0).length,
      compactions: row.session?.compactions ?? 0,
    }));
  return {
    rule: `>= ${LONG_HORIZON_MIN_WM_PASSES} WM passes with an item per session, scripted worker, package defaults`,
    sessions,
    engaged: sessions.length > 0 && sessions.every((row) => row.passesWithItem >= LONG_HORIZON_MIN_WM_PASSES),
  };
}

if (import.meta.main && process.argv.includes("--write-partitions")) {
  await writeFile(PARTITION_FILE, `${JSON.stringify(longHorizonPartitionFile(), null, 2)}\n`);
  console.log("wrote work-outcome-long-horizon.json");
}
