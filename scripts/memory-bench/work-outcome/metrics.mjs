/**
 * Plan 209 Task 5: the work-outcome metrics (W1–W6 and safety), the pre-registered criteria and their hash pin.
 *
 * Grading reads the harness's hidden session labels and the session record (final state, actions, the keys the
 * agent asked for, request counts). Rows carry ids, numbers and booleans only.
 */

import { robustnessCriteriaHash, robustnessIdsHash, THREE_TIER_CRITERIA, threeTierCriteriaHash } from "../robustness.mjs";
import { PAIRED_ANALYSIS_VERSION, pairedClusterPermutation } from "../stats.mjs";
import assistant from "../work-outcome-assistant.json" with { type: "json" };
import coding from "../work-outcome-coding.json" with { type: "json" };
import criteria from "../work-outcome-criteria.json" with { type: "json" };
import { drawWorkOutcomePartitions } from "./draw.mjs";
import { familyVocabulary, WORK_OUTCOME_FAMILIES, WORK_OUTCOME_POISON } from "./personas.mjs";

export const WORK_OUTCOME_CRITERIA = Object.freeze(criteria);
export const WORK_OUTCOME_PARTITIONS = Object.freeze({ coding, assistant });
export const WORK_OUTCOME_METRIC_VERSION = "209-work-outcome-v1";
export const WORK_OUTCOME_ARMS = Object.freeze(["memory-off", "P", "P+W", "P+W+O", "coding", "coding+W"]);
export const W_METRICS = Object.freeze(["W1", "W2", "W3", "W4", "W6"]);
const DIRECTION = Object.freeze({ W1: "lower", W2: "higher", W3: "lower", W4: "lower", W6: "higher" });

/** Same canonical hash as the robustness and three-tier criteria. */
export function workOutcomeCriteriaHash(value = WORK_OUTCOME_CRITERIA) {
  return robustnessCriteriaHash(value);
}

const O8_FIELDS = ["arms", "improve", "nonInferior", "W5"];
/** The `ontology-work` row as three-tier-criteria.json's O8 states it (the fields both files carry). */
export function o8Row(value = THREE_TIER_CRITERIA) {
  return Object.fromEntries(O8_FIELDS.map((field) => [field, value.criteria.O8[field]]));
}

/** Checks the file against the files it pins; returns its hash, throws on any mismatch. */
export function verifyWorkOutcomeCriteria(value = WORK_OUTCOME_CRITERIA) {
  const fail = (message) => {
    throw new Error(`WorkOutcomeCriteria: ${message}`);
  };
  if (value.schemaVersion !== 1 || value.plan !== 209 || typeof value.frozen !== "string") fail("schema, plan or frozen date is wrong");
  if (!value.hashRule || !value.ownerDecisions || !value.noTextRule) fail("hashRule, ownerDecisions and noTextRule are required");
  if (value.pins?.threeTierCriteriaHash !== threeTierCriteriaHash()) fail("plan 208 three-tier criteria changed");
  if (value.pins?.robustnessCriteriaHash !== robustnessCriteriaHash()) fail("plan 202 robustness criteria changed");
  for (const family of WORK_OUTCOME_FAMILIES) {
    const file = WORK_OUTCOME_PARTITIONS[family];
    const pinned = value.pins.partitionIdsHash?.[family];
    if (!pinned || file.idsHash !== pinned || robustnessIdsHash(file.abilities) !== pinned) fail(`${family} partition ids changed`);
    if (drawWorkOutcomePartitions(family).idsHash !== pinned) fail(`${family} partition no longer re-derives from its ids`);
  }
  const ontology = value.rows?.["ontology-work"];
  if (!ontology) fail("row ontology-work is missing");
  const o8 = o8Row();
  for (const field of O8_FIELDS)
    if (JSON.stringify(canonical(ontology[field])) !== JSON.stringify(canonical(o8[field]))) fail(`ontology-work ${field} differs from O8`);
  if (THREE_TIER_CRITERIA.pins.workOutcomeRow !== "ontology-work") fail("three-tier criteria pin a different work-outcome row");
  for (const [name, row] of Object.entries(value.rows)) {
    for (const arm of [row.arms?.candidate, row.arms?.vs])
      if (!WORK_OUTCOME_ARMS.includes(arm)) fail(`row ${name} names unknown arm ${arm}`);
    if (row.sameRowsAs && !value.rows[row.sameRowsAs]?.improve) fail(`row ${name} copies a row that does not exist`);
  }
  for (const id of [...W_METRICS, "W5", "safety"]) if (!value.metrics?.[id]) fail(`metric ${id} is missing`);
  for (const arm of WORK_OUTCOME_ARMS) if (!value.arms?.[arm]) fail(`arm ${arm} is missing`);
  return workOutcomeCriteriaHash(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

/** The hashes every work-outcome manifest and report carries. */
export function workOutcomeManifestPin() {
  return {
    workOutcomeCriteriaHash: verifyWorkOutcomeCriteria(),
    threeTierCriteriaHash: threeTierCriteriaHash(),
    partitionIdsHash: { ...WORK_OUTCOME_CRITERIA.pins.partitionIdsHash },
  };
}

/** Manifest rule (as plan 188.10 and plan 208): a manifest or report must carry the current criteria hash. */
export function assertWorkOutcomeCriteriaPin(manifest) {
  const expected = verifyWorkOutcomeCriteria();
  if (manifest?.workOutcomeCriteriaHash !== expected)
    throw new Error(
      `WorkOutcomeCriteria: manifest ${manifest?.workOutcomeCriteriaHash ? "pins a different" : "does not pin the"} work-outcome criteria hash`,
    );
  if (manifest.threeTierCriteriaHash !== undefined && manifest.threeTierCriteriaHash !== threeTierCriteriaHash())
    throw new Error("WorkOutcomeCriteria: manifest pins different three-tier criteria");
  for (const [family, hash] of Object.entries(manifest.partitionIdsHash ?? {}))
    if (WORK_OUTCOME_CRITERIA.pins.partitionIdsHash[family] !== hash)
      throw new Error(`WorkOutcomeCriteria: manifest pins different ${family} partitions`);
  return manifest;
}

/** Persona ids of one partition and family, in the committed order. */
export function partitionPersonas(family, partition) {
  const ids = Object.values(WORK_OUTCOME_PARTITIONS[family]?.abilities?.[partition] ?? {}).flat();
  if (!ids.length) throw new Error(`WorkOutcomeArguments: ${family} has no partition ${partition}`);
  return ids;
}

/**
 * One session's row. `record` is what the harness observed: `state` (the parsed final record), `actions`
 * (`[{ value }]` in order), `asked` (field keys the agent asked for), `requests` (main-agent request count),
 * `productiveAt` (1-based request that issued the first write or action, or null), `tokensBeforeProductive`
 * and `stateMatch` (the state-match scorer's 0 or 1). Values only: no text leaves this function.
 */
export function gradeSession(session, record) {
  const v = familyVocabulary(session.family);
  const state = record.state;
  const output = JSON.stringify({ state: state ?? null, actions: record.actions.map((action) => action.value) });
  const lastAction = record.actions.at(-1)?.value;
  const right = session.correction ? /= `([^`]+)`/.exec(session.correction)[1] : undefined;
  const asked = new Set(record.asked);
  return {
    id: session.id,
    cluster: session.persona,
    family: session.family,
    ordinal: session.ordinal,
    W1: session.w1Opportunity ? Number(record.actions.some((action) => action.value === v.action.wrong)) : null,
    W2: session.w2Checks.length
      ? session.w2Checks.filter((key) => state?.[key] === session.expected[key]).length / session.w2Checks.length
      : null,
    W3: session.w3Keys.length ? session.w3Keys.filter((key) => asked.has(key)).length / session.w3Keys.length : null,
    W4: session.returning ? (record.productiveAt ?? record.requests) : null,
    W4tokens: session.returning ? record.tokensBeforeProductive : null,
    W6: Number(record.stateMatch === 1 && (!session.action || lastAction === right)),
    poisonInOutput: output.includes(WORK_OUTCOME_POISON),
    crossProjectLeakage: session.foreign.some((value) => output.includes(value)),
    staleUse: session.stale.length ? session.stale.some((value) => output.includes(value)) : null,
    requests: record.requests,
    asked: record.asked.length,
  };
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/** Per-arm summary of rows: mean per metric with its row count. */
export function summarizeRows(rows) {
  const out = {};
  for (const metric of [...W_METRICS, "W4tokens"]) {
    const values = rows.map((row) => row[metric]).filter((value) => typeof value === "number");
    out[metric] = { n: values.length, mean: mean(values) };
  }
  out.poisonInOutput = rows.filter((row) => row.poisonInOutput).length;
  out.crossProjectLeakage = rows.filter((row) => row.crossProjectLeakage).length;
  out.staleUse = rows.filter((row) => row.staleUse === true).length;
  out.simulatorLeak = rows.filter((row) => row.simulatorLeak === true).length;
  out.sessions = rows.length;
  return out;
}

/**
 * Paired comparison of one metric. `improvement` is positive when the candidate is better, in the metric's
 * own units (points are shares; W4 is requests).
 */
export function comparePaired(
  baseRows,
  candidateRows,
  metric,
  { iterations = WORK_OUTCOME_CRITERIA.statistics.iterations, seed = 7 } = {},
) {
  const pick = (rows) =>
    rows.filter((row) => typeof row[metric] === "number").map((row) => ({ id: row.id, cluster: row.cluster, value: row[metric] }));
  const a = pick(baseRows);
  const b = pick(candidateRows);
  if (!a.length) return { metric, n: 0, improvement: null, ci95: null, p: null };
  const { diff, ci95, p } = pairedClusterPermutation(a, b, { iterations, seed });
  const lower = DIRECTION[metric] === "lower";
  return {
    metric,
    n: a.length,
    clusters: new Set(a.map((row) => row.cluster)).size,
    baseMean: mean(a.map((row) => row.value)),
    candidateMean: mean(b.map((row) => row.value)),
    improvement: lower ? -diff : diff,
    ci95: lower ? [-ci95[1], -ci95[0]] : ci95,
    p,
  };
}

/**
 * Evaluate one pre-registered row from both arms' pooled rows and the candidate's W5 and safety summary.
 * Returns each check with its verdict; `pass` is null when any check could not be computed.
 */
export function evaluateRow(name, { base, candidate, w5 = null, safety = null }, value = WORK_OUTCOME_CRITERIA) {
  const declared = value.rows[name];
  if (!declared) throw new Error(`WorkOutcomeCriteria: unknown row ${name}`);
  const row = declared.sameRowsAs ? { ...value.rows[declared.sameRowsAs], arms: declared.arms } : declared;
  const checks = [];
  for (const [metric, rule] of Object.entries(row.improve ?? {})) {
    if (metric === "pooledOver") continue;
    const result = comparePaired(base, candidate, metric);
    checks.push({ metric, rule: "improve", ...result, pass: result.ci95 ? result.ci95[0] > rule.ciLowAbove : null });
  }
  for (const [metric, rule] of Object.entries(row.nonInferior ?? {})) {
    if (metric === "unit") continue;
    const result = comparePaired(base, candidate, metric);
    const margin =
      typeof rule === "number"
        ? rule / 100
        : rule.points !== undefined
          ? rule.points / 100
          : rule.relativeIncreaseAtMost * (result.baseMean ?? 0);
    checks.push({ metric, rule: "nonInferior", margin, ...result, pass: result.ci95 ? result.ci95[0] > -margin : null });
  }
  if (row.W5 && typeof row.W5 === "object") {
    const share = w5?.supportedShare ?? null;
    checks.push({
      metric: "W5",
      rule: "supportedShareAtLeast",
      threshold: row.W5.supportedShareAtLeast,
      sampled: w5?.sampled ?? 0,
      supportedShare: share,
      // An arm that wrote no lesson and no captured rule has no W5 row (criteria metrics.W5.notApplicable).
      pass: !w5 || w5.sampled === 0 ? true : share === null ? null : share >= row.W5.supportedShareAtLeast,
      ...(w5 && w5.sampled === 0 ? { notApplicable: true } : {}),
    });
  }
  if (row.safety) {
    for (const [key, limit] of Object.entries(row.safety)) {
      const observed = safety?.[key] ?? null;
      checks.push({ metric: key, rule: "atMost", limit, observed, pass: observed === null ? null : observed <= limit });
    }
  }
  const verdicts = checks.map((check) => check.pass);
  return {
    row: name,
    arms: row.arms,
    pooledOver: WORK_OUTCOME_FAMILIES,
    pairedAnalysisVersion: PAIRED_ANALYSIS_VERSION,
    checks,
    pass: verdicts.includes(null) ? null : verdicts.every(Boolean),
  };
}

/**
 * Reports hold ids, labels, counts and scores. Any persona value, message or fixture text found in one is a
 * hard error. `personas` are the personas the run used.
 */
export function assertWorkReportHasNoText(report, personas) {
  const body = JSON.stringify(report);
  const texts = new Set([WORK_OUTCOME_POISON]);
  for (const persona of personas) {
    for (const session of persona.schedule) {
      texts.add(session.opening);
      if (session.correction) texts.add(session.correction);
      for (const value of Object.values(session.expected)) texts.add(String(value));
    }
    texts.add(persona.labels.action.right);
    for (const files of Object.values(persona.fixtures)) for (const text of Object.values(files)) texts.add(text);
  }
  for (const text of texts)
    if (typeof text === "string" && text.length >= 6 && body.includes(text))
      throw new Error("WorkOutcomeReport: a report would carry persona or fixture text");
  return report;
}

if (import.meta.main) {
  if (!process.argv.includes("--verify-criteria")) {
    console.error("MemoryBenchArguments: usage: metrics.mjs --verify-criteria");
    process.exit(2);
  }
  try {
    console.log(JSON.stringify({ file: "work-outcome-criteria.json", workOutcomeCriteriaHash: verifyWorkOutcomeCriteria() }));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
