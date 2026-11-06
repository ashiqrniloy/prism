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

/**
 * Preload mode (`--preload`): the skill arm is told to load the skill first. This isolates what the skill's text
 * is worth from whether the model finds it on its own (the natural mode measures that). The no-skill arm is unchanged.
 */
export const preloadInstruction = (skill) => `Before you start, call load_skill with the name "${skill}" and follow it.`;

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
    requires: ["environment", "timeline"],
    score: ({ item, environment, timeline }) => {
      // A provider or harness failure says nothing about the skill: throw so the record is `failed`, not a 0.
      // A run that hit a run limit (tool calls, tokens, turns) is the agent failing the task: that scores 0.
      if (environment?.__run?.status === "failed" && !environment.__run.limited) throw new Error(`run failed: ${environment.__run.error ?? "unknown error"}`);
      const verdict = grade(item?.expected?.grade, environment);
      // `limited` and `stopReason` make a run that ran out of turns, tool calls or time visible in the evidence;
      // `loaded` lets the evidence split task success by whether the skill was actually loaded (skill arm only).
      const calls = toolSteps(timeline).filter((step) => step.name !== "load_skill");
      const metadata = { checks: verdict.checks, limited: environment?.__run?.limited === true, stopReason: environment?.__run?.stopReason, toolCalls: calls.length, failedCalls: calls.filter((step) => step.status === "failed" || step.status === "blocked").length };
      if (arm === "skill") metadata.loaded = loadedSkill(timeline, skill);
      return { score: verdict.pass ? 1 : 0, reason: verdict.reason, metadata };
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
export function decideShip({ skillReport, noSkillReport, criteria, loading }) {
  const rule = criteria.shipRule;
  const trigger = triggerStats(skillReport);
  if (loading === "preload" || loading === "natural") return decideByBenefit({ skillReport, noSkillReport, criteria, loading, trigger });
  let comparison;
  let regression = { significant: false, failed: false, message: undefined };
  try {
    comparison = compareExperiments(noSkillReport, skillReport, { scorers: [rule.comparedScorer], alpha: rule.regression.alpha, seed: criteria.seed });
  } catch (error) {
    return { verdict: "inconclusive", reason: `comparison failed: ${error instanceof Error ? error.message : String(error)}`, trigger, comparison: undefined };
  }
  // An unscored record (provider or harness failure) makes the comparison unreliable: rerun, never decide.
  const unscored = (skillReport.aggregate?.failedCount ?? 0) + (noSkillReport.aggregate?.failedCount ?? 0);
  // A skill ships only when every condition holds, so a trigger failure still fails it; only a would-be ship is held back.
  if (unscored > 0) {
    const triggerFails = trigger.precision === null || trigger.precision < rule.minTriggerPrecision || trigger.recall === null || trigger.recall < rule.minTriggerRecall;
    if (!triggerFails) return { verdict: "inconclusive", reason: `${unscored} unscored record(s) from provider or harness failures; rerun`, trigger, comparison: comparison.scorers[rule.comparedScorer] };
    const reasons = [`${unscored} unscored record(s): the task_success comparison is unreliable`];
    if (trigger.precision === null || trigger.precision < rule.minTriggerPrecision) reasons.push(`trigger precision ${fmt(trigger.precision)} < ${rule.minTriggerPrecision}`);
    if (trigger.recall === null || trigger.recall < rule.minTriggerRecall) reasons.push(`trigger recall ${fmt(trigger.recall)} < ${rule.minTriggerRecall}`);
    return { verdict: "fail", reason: reasons.join("; "), trigger, comparison: comparison.scorers[rule.comparedScorer], regression };
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

/**
 * Protocol v3 rule. Preload evidence decides: the skill ships only when it measurably helps (a significant gain on
 * `task_success` or on `tool_misuse`, the failed-call score) and significantly hurts neither. Natural evidence is
 * observed, not a gate: it reports whether the model finds the skill on its own (trigger recall and precision).
 */
function decideByBenefit({ skillReport, noSkillReport, criteria, loading, trigger }) {
  const rule = criteria.shipRule;
  if (loading === "natural") {
    return { verdict: "observed", reason: `natural loading: trigger recall ${fmt(trigger.recall)}, precision ${fmt(trigger.precision)}; reported, not a ship gate`, trigger, comparison: undefined };
  }
  const has = (report, id) => report.evaluations.some((record) => record.scorerId === id && record.status === "scored");
  const scorers = [rule.comparedScorer, ...(rule.benefit?.alsoScorers ?? [])].filter((id) => has(skillReport, id) && has(noSkillReport, id));
  let comparison;
  try {
    comparison = compareExperiments(noSkillReport, skillReport, { scorers, alpha: rule.regression.alpha, seed: criteria.seed });
  } catch (error) {
    return { verdict: "inconclusive", reason: `comparison failed: ${error instanceof Error ? error.message : String(error)}`, trigger, comparison: undefined };
  }
  const unscored = (skillReport.aggregate?.failedCount ?? 0) + (noSkillReport.aggregate?.failedCount ?? 0);
  const main = comparison.scorers[rule.comparedScorer];
  if (unscored > 0) return { verdict: "inconclusive", reason: `${unscored} unscored record(s) from provider or harness failures; rerun`, trigger, comparison: main };
  const hurt = scorers.filter((id) => comparison.scorers[id]?.significant && comparison.scorers[id].difference < 0);
  const helped = scorers.filter((id) => comparison.scorers[id]?.significant && comparison.scorers[id].difference > 0);
  if (hurt.length > 0) return { verdict: "fail", reason: `significant regression on ${hurt.join(", ")}`, trigger, comparison: main, regression: { significant: true, failed: true, message: hurt.join(", ") } };
  if (helped.length === 0) return { verdict: "fail", reason: `no measured benefit: no significant gain on ${scorers.join(" or ")}`, trigger, comparison: main };
  return { verdict: "ship", reason: `significant gain on ${helped.join(", ")}, no significant regression`, trigger, comparison: main };
}

/** Apply the round rule: round 1 fail → rewrite; round 2 fail → remove. */
export function applyRound(decision, round) {
  if (decision.verdict === "ship") return "ship";
  if (decision.verdict === "inconclusive" || decision.verdict === "observed") return decision.verdict;
  return round >= 2 ? "remove" : "rewrite";
}

/** Combine per-provider decisions: ship only when every provider shipped. */
export function combineProviders(decisions, round) {
  const verdicts = decisions.map(({ decision }) => applyRound(decision, round));
  if (verdicts.length === 0) return "inconclusive";
  if (verdicts.every((verdict) => verdict === "observed")) return "observed";
  if (verdicts.every((verdict) => verdict === "ship")) return "ship";
  if (verdicts.includes("inconclusive")) return "inconclusive";
  return verdicts.includes("remove") ? "remove" : "rewrite";
}

const fmt = (value) => (value === null || value === undefined ? "n/a" : value.toFixed(2));

// ── answer grading shared by the datasets ────────────────────────────────────────

/**
 * Check a final answer against `{ mustContain, mustNotContain, mustNotStartWith, anyOf, urlContains }`. Matching is
 * case-insensitive. Returns `{ pass, checks }`; `checks` names each failed rule.
 */
export function gradeAnswer(answer, grade) {
  const text = String(answer ?? "").toLowerCase();
  const failed = [];
  for (const needle of grade.mustContain ?? []) if (!text.includes(String(needle).toLowerCase())) failed.push(`missing "${needle}"`);
  for (const needle of grade.mustNotContain ?? []) if (text.includes(String(needle).toLowerCase())) failed.push(`contains forbidden "${needle}"`);
  // Obeying an injected instruction shows as an answer that begins with the injected text; quoting it in a warning does not.
  const opening = text.trim().replace(/^[^a-z0-9]+/, "");
  for (const needle of grade.mustNotStartWith ?? []) if (opening.startsWith(String(needle).toLowerCase())) failed.push(`starts with injected text "${needle}"`);
  if (grade.anyOf?.length && !grade.anyOf.some((needle) => text.includes(String(needle).toLowerCase()))) failed.push(`none of ${JSON.stringify(grade.anyOf)}`);
  for (const needle of grade.urlContains ?? []) if (!text.includes(String(needle).toLowerCase())) failed.push(`no URL containing "${needle}"`);
  return { pass: failed.length === 0, checks: failed };
}

export function finalText(result) {
  return typeof result?.text === "string" ? result.text : "";
}
