/**
 * Pure helpers for the paired skill evaluations (plan 215 Task 11): hashing, scorers, trigger statistics,
 * the arm description, and the ship rule. Nothing here calls a model or touches the network.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertEvaluationThreshold, compareExperiments, defineScorer } from "@arnilo/prism-evals";

export const ROOT = import.meta.dir;
export const CRITERIA_PATH = join(ROOT, "criteria.json");
export const LOCK_PATH = join(ROOT, "criteria.lock.json");
export const EVIDENCE_DIR = join(ROOT, "../../docs/_evidence/skill-evals/211");

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** JSON with sorted object keys, so a hash does not depend on key order. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function loadCriteria() {
  const text = readFileSync(CRITERIA_PATH, "utf8");
  return { criteria: JSON.parse(text), hash: sha256(text) };
}

/** What the task asks the agent to be told, identical for both arms. */
export const ARM_INSTRUCTIONS =
  "You are a capable assistant working for a user. Use the tools you have when they help, finish the task, and end with a short final answer.";

export const ARMS = Object.freeze(["skill", "no-skill"]);

/**
 * The parts of an agent configuration that must be identical between arms. Only `disable.skills`
 * may differ; `describeArm` returns it separately so a test can assert exactly that.
 */
export function describeArm({ skill, arm, model, packageNames, toolNames, skillDirs }) {
  if (!ARMS.includes(arm)) throw new TypeError(`SkillEvalArm: unknown arm ${arm}`);
  return {
    shared: { model, instructions: ARM_INSTRUCTIONS, packageNames: [...packageNames], toolNames: [...toolNames], skillDirs: [...skillDirs] },
    disable: arm === "no-skill" ? { skills: [skill] } : undefined,
  };
}

// ── scoring ────────────────────────────────────────────────────────────────────

/** Steps of the execution timeline that were tool calls. */
const toolSteps = (timeline) => (timeline?.steps ?? []).filter((step) => step.kind === "tool");

export function loadedSkill(timeline, skill) {
  return toolSteps(timeline).some((step) => step.name === "load_skill" && (step.input?.name === skill || JSON.stringify(step.input ?? "").includes(`"${skill}"`)));
}

export function failedToolCalls(timeline) {
  return toolSteps(timeline).filter((step) => step.status === "failed" || step.status === "blocked").length;
}

/**
 * `grade` is the dataset module's grading function over `(expected, snapshot)`, where `snapshot` is the
 * JSON the environment captured after the run (final answer plus fixture state).
 */
export function createScorers({ skill, arm, grade }) {
  const taskSuccess = defineScorer({
    id: "task_success",
    requires: ["environment"],
    score: ({ item, environment }) => {
      // A provider or harness failure says nothing about the skill: throw so the record is `failed`, not a 0.
      // A run that hit a run limit (tool calls, tokens, turns) is the agent failing the task: that scores 0.
      if (environment?.__run?.status === "failed" && !environment.__run.limited) throw new Error(`run failed: ${environment.__run.error ?? "unknown error"}`);
      const verdict = grade(item?.expected?.grade, environment);
      return { score: verdict.pass ? 1 : 0, reason: verdict.reason, metadata: { checks: verdict.checks } };
    },
  });
  const toolMisuse = defineScorer({
    id: "tool_misuse",
    requires: ["timeline"],
    score: ({ timeline }) => {
      const count = failedToolCalls(timeline);
      return { score: 1 / (1 + count), metadata: { count } };
    },
  });
  if (arm !== "skill") return [taskSuccess, toolMisuse];
  const skillTriggered = defineScorer({
    id: "skill_triggered",
    requires: ["timeline"],
    score: ({ item, timeline }) => {
      const loaded = loadedSkill(timeline, skill);
      const kind = item?.expected?.kind;
      return { score: (kind === "trigger") === loaded ? 1 : 0, metadata: { loaded, kind } };
    },
  });
  return [taskSuccess, skillTriggered, toolMisuse];
}

/**
 * Precision and recall of skill loading across every scored trial of the skill arm.
 * recall = loaded on trigger trials / trigger trials; precision = loaded on trigger trials / all loaded trials.
 * A run that never loaded the skill has no precision (null), which fails the ship rule.
 */
export function triggerStats(report) {
  const records = report.evaluations.filter((record) => record.scorerId === "skill_triggered" && record.status === "scored");
  let triggerTrials = 0;
  let loadedOnTrigger = 0;
  let loaded = 0;
  let nonTriggerTrials = 0;
  let loadedOnNonTrigger = 0;
  for (const record of records) {
    const { loaded: didLoad, kind } = record.metadata ?? {};
    if (kind === "trigger") {
      triggerTrials += 1;
      if (didLoad) loadedOnTrigger += 1;
    } else {
      nonTriggerTrials += 1;
      if (didLoad) loadedOnNonTrigger += 1;
    }
    if (didLoad) loaded += 1;
  }
  return {
    triggerTrials,
    nonTriggerTrials,
    loaded,
    loadedOnTrigger,
    loadedOnNonTrigger,
    recall: triggerTrials === 0 ? null : loadedOnTrigger / triggerTrials,
    precision: loaded === 0 ? null : loadedOnTrigger / loaded,
  };
}

export function toolMisuseTotal(report) {
  return report.evaluations
    .filter((record) => record.scorerId === "tool_misuse" && record.status === "scored")
    .reduce((sum, record) => sum + Number(record.metadata?.count ?? 0), 0);
}

/**
 * The pre-registered ship rule for one skill on one provider. `skill` and `noSkill` are the two
 * experiment reports. Never throws on a statistical failure: an uncomputable comparison is
 * `inconclusive`, which is never a ship.
 */
export function decideShip({ skillReport, noSkillReport, criteria }) {
  const rule = criteria.shipRule;
  const trigger = triggerStats(skillReport);
  let comparison;
  let regression = { significant: false, failed: false, message: undefined };
  try {
    comparison = compareExperiments(noSkillReport, skillReport, { scorers: [rule.comparedScorer], alpha: rule.regression.alpha, seed: criteria.seed });
  } catch (error) {
    return { verdict: "inconclusive", reason: `comparison failed: ${error instanceof Error ? error.message : String(error)}`, trigger, comparison: undefined };
  }
  try {
    assertEvaluationThreshold(skillReport, {
      maximumRegression: { baseline: noSkillReport, delta: rule.regression.delta, alpha: rule.regression.alpha, scorers: [rule.comparedScorer] },
    });
  } catch (error) {
    regression = { significant: true, failed: true, message: error instanceof Error ? error.message : String(error) };
  }
  const reasons = [];
  if (regression.failed) reasons.push(`significant regression on ${rule.comparedScorer}`);
  if (trigger.precision === null || trigger.precision < rule.minTriggerPrecision) reasons.push(`trigger precision ${fmt(trigger.precision)} < ${rule.minTriggerPrecision}`);
  if (trigger.recall === null || trigger.recall < rule.minTriggerRecall) reasons.push(`trigger recall ${fmt(trigger.recall)} < ${rule.minTriggerRecall}`);
  return {
    verdict: reasons.length === 0 ? "ship" : "fail",
    reason: reasons.length === 0 ? "no significant regression; trigger precision and recall meet the minimums" : reasons.join("; "),
    trigger,
    comparison: comparison.scorers[rule.comparedScorer],
    regression,
  };
}

/** Apply the round rule: round 1 fail → rewrite; round 2 fail → remove. */
export function applyRound(decision, round) {
  if (decision.verdict === "ship") return "ship";
  if (decision.verdict === "inconclusive") return "inconclusive";
  return round >= 2 ? "remove" : "rewrite";
}

/** Combine per-provider decisions: ship only when every provider shipped. */
export function combineProviders(decisions, round) {
  const verdicts = decisions.map(({ decision }) => applyRound(decision, round));
  if (verdicts.length === 0) return "inconclusive";
  if (verdicts.every((verdict) => verdict === "ship")) return "ship";
  if (verdicts.includes("inconclusive")) return "inconclusive";
  return verdicts.includes("remove") ? "remove" : "rewrite";
}

const fmt = (value) => (value === null || value === undefined ? "n/a" : value.toFixed(2));

// ── answer grading shared by the datasets ────────────────────────────────────────

/**
 * Check a final answer against `{ mustContain, mustNotContain, anyOf, urlContains }`. Matching is
 * case-insensitive. Returns `{ pass, checks }`; `checks` names each failed rule.
 */
export function gradeAnswer(answer, grade) {
  const text = String(answer ?? "").toLowerCase();
  const failed = [];
  for (const needle of grade.mustContain ?? []) if (!text.includes(String(needle).toLowerCase())) failed.push(`missing "${needle}"`);
  for (const needle of grade.mustNotContain ?? []) if (text.includes(String(needle).toLowerCase())) failed.push(`contains forbidden "${needle}"`);
  if (grade.anyOf?.length && !grade.anyOf.some((needle) => text.includes(String(needle).toLowerCase()))) failed.push(`none of ${JSON.stringify(grade.anyOf)}`);
  for (const needle of grade.urlContains ?? []) if (!text.includes(String(needle).toLowerCase())) failed.push(`no URL containing "${needle}"`);
  return { pass: failed.length === 0, checks: failed };
}

export function finalText(result) {
  return typeof result?.text === "string" ? result.text : "";
}
