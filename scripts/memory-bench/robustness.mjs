/**
 * Plan 202 Task 2: the pre-registered robustness definitions and the frozen partitions.
 *
 * The partitions are label-blind: a draw orders candidate ids by `SHA-256(seed + ":" + id)` inside
 * each ability stratum, so dataset order and row content never participate. Ids, abilities and the
 * residual pool counts are committed in `robustness-<suite>.json`; `heldout-b` exists only for the
 * single remediation round in the plan header and is otherwise never read.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import cleanup from "./cleanup-criteria.json" with { type: "json" };
import memoryModel from "./memory-model-criteria.json" with { type: "json" };
import { minDetectableDifference } from "./power.mjs";
import beam1m from "./robustness-beam-1m.json" with { type: "json" };
import beam100k from "./robustness-beam-100k.json" with { type: "json" };
import beam500k from "./robustness-beam-500k.json" with { type: "json" };
import codingLongitudinal from "./robustness-coding-longitudinal.json" with { type: "json" };
import criteria from "./robustness-criteria.json" with { type: "json" };
import dreambench from "./robustness-dreambench-swe.json" with { type: "json" };
import locomo from "./robustness-locomo.json" with { type: "json" };
import longmemevalM from "./robustness-longmemeval-m.json" with { type: "json" };
import memoryagentbench from "./robustness-memoryagentbench-cr.json" with { type: "json" };
import memorycode from "./robustness-memorycode.json" with { type: "json" };
import vibemembench from "./robustness-vibemembench.json" with { type: "json" };
import threeTier from "./three-tier-criteria.json" with { type: "json" };
import workOutcome from "./work-outcome-criteria.json" with { type: "json" };

export const ROBUSTNESS_PARTITIONS = Object.freeze(["dev", "heldout-a", "heldout-b"]);
export const ROBUSTNESS_CRITERIA = Object.freeze(criteria);
/** Kept in sync with the files above; a suite without a draw cannot be selected. */
export const ROBUSTNESS_DRAWS = Object.freeze({
  "longmemeval-m": longmemevalM,
  "beam-100k": beam100k,
  "beam-500k": beam500k,
  "beam-1m": beam1m,
  locomo,
  "memoryagentbench-cr": memoryagentbench,
  memorycode,
  "coding-longitudinal": codingLongitudinal,
  vibemembench,
  "dreambench-swe": dreambench,
});

export function isRobustnessSubset(subset) {
  return ROBUSTNESS_PARTITIONS.includes(subset);
}

export function robustnessDraw(suite) {
  const draw = ROBUSTNESS_DRAWS[suite];
  if (!draw) throw new Error(`MemoryBenchArguments: ${suite} has no frozen robustness partition`);
  return draw;
}

/** Canonical JSON so the hash does not depend on key order or formatting. */
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
export function robustnessCriteriaHash(value = ROBUSTNESS_CRITERIA) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export const THREE_TIER_CRITERIA = Object.freeze(threeTier);
/** Plan 208 Task 1: the same canonical hash, over the pre-registered three-tier criteria. */
export function threeTierCriteriaHash(value = THREE_TIER_CRITERIA) {
  return robustnessCriteriaHash(value);
}

/**
 * Checks the three-tier criteria against the files they pin: plan 202's criteria hash, each
 * suite's committed partition ids hash, and that every consolidation-sensitive ability has items
 * in every partition. Returns the criteria hash, throws on any mismatch.
 */
export function verifyThreeTierCriteria(value = THREE_TIER_CRITERIA) {
  const fail = (message) => {
    throw new Error(`ThreeTierCriteria: ${message}`);
  };
  if (value.schemaVersion !== 1 || value.plan !== 208 || typeof value.frozen !== "string") fail("schema, plan or frozen date is wrong");
  if (!value.hashRule || !value.ownerDecisions) fail("hashRule and ownerDecisions are required");
  if (value.pins?.robustnessCriteriaHash !== robustnessCriteriaHash()) fail("plan 202 robustness criteria changed");
  for (const [suite, pinned] of Object.entries(value.pins.partitionIdsHash ?? {})) {
    const draw = robustnessDraw(suite);
    if (draw.idsHash !== pinned || robustnessIdsHash(draw.abilities) !== pinned) fail(`${suite} partition ids changed`);
  }
  const sensitive = value.abilities?.consolidationSensitive ?? {};
  if (!Object.keys(sensitive).length) fail("no consolidation-sensitive abilities");
  for (const [suite, abilities] of Object.entries(sensitive)) {
    if (!value.pins.partitionIdsHash[suite]) fail(`${suite} partition is not pinned`);
    const draw = robustnessDraw(suite);
    for (const ability of abilities)
      for (const partition of value.partitions.all)
        if (!draw.abilities[partition]?.[ability]?.length) fail(`${suite}/${ability} has no items in ${partition}`);
  }
  for (const id of ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8"]) if (!value.criteria?.[id]) fail(`criterion ${id} is missing`);
  if (value.criteria.O8.row !== value.pins.workOutcomeRow) fail("O8 row is not the pinned work-outcome row");
  for (const suite of value.criteria.O6.suites) if (!ROBUSTNESS_DRAWS[suite]) fail(`O6 suite ${suite} has no frozen partition`);
  return threeTierCriteriaHash(value);
}

/** The two hashes every ontology manifest and report carries. */
export function threeTierManifestPin() {
  return { criteriaHash: robustnessCriteriaHash(), threeTierCriteriaHash: verifyThreeTierCriteria() };
}

/** Manifest rule (as 188.10): an ontology manifest or report must carry the current criteria hash. */
export function assertThreeTierCriteriaPin(manifest) {
  const expected = verifyThreeTierCriteria();
  if (manifest?.threeTierCriteriaHash !== expected)
    throw new Error(
      `ThreeTierCriteria: manifest ${manifest?.threeTierCriteriaHash ? "pins a different" : "does not pin the"} three-tier criteria hash`,
    );
  if (manifest.criteriaHash !== undefined && manifest.criteriaHash !== robustnessCriteriaHash())
    throw new Error("ThreeTierCriteria: manifest pins different robustness criteria");
  return manifest;
}

export const CLEANUP_CRITERIA = Object.freeze(cleanup);
const REPO_ROOT = new URL("../../", import.meta.url);
const readRepoJson = (path) => JSON.parse(readFileSync(new URL(path, REPO_ROOT), "utf8"));

/** Plan 210 Task 4: the same canonical hash, over the pre-registered cleanup decision rules. */
export function cleanupCriteriaHash(value = CLEANUP_CRITERIA) {
  return robustnessCriteriaHash(value);
}

/**
 * Checks the cleanup criteria against everything they pin: the robustness, three-tier and work-outcome
 * criteria hashes, the frozen Task 3 predictions, plan 202 Task 5's frozen criteria, and the ledger and
 * gap-analysis rows the inert-removal lists and pre-registered legs name. Returns the hash, throws on any
 * mismatch. `files` lets a test substitute the ledger, predictions or 202 manifest.
 */
export function verifyCleanupCriteria(value = CLEANUP_CRITERIA, files = {}) {
  const fail = (message) => {
    throw new Error(`CleanupCriteria: ${message}`);
  };
  if (value.schemaVersion !== 1 || value.plan !== 210 || value.task !== 4 || typeof value.frozen !== "string")
    fail("schema, plan, task or frozen date is wrong");
  if (!value.hashRule || !value.ownerDecisions) fail("hashRule and ownerDecisions are required");
  const pins = value.pins ?? {};
  if (pins.robustnessCriteriaHash !== robustnessCriteriaHash()) fail("plan 202 robustness criteria changed");
  if (pins.threeTierCriteriaHash !== verifyThreeTierCriteria()) fail("plan 208 three-tier criteria changed");
  if (pins.workOutcomeCriteriaHash !== robustnessCriteriaHash(workOutcome)) fail("plan 209 work-outcome criteria changed");

  const gap = files.gapPredictions ?? readRepoJson(pins.gapPredictions?.path ?? "");
  if (gap.schemaVersion !== pins.gapPredictions.schemaVersion || gap.plan !== 210) fail("gap predictions schema changed");
  if (robustnessCriteriaHash(gap.predictions) !== pins.gapPredictions.predictionsHash) fail("Task 3 predictions changed");
  const task5 = files.plan202Task5 ?? readRepoJson(pins.plan202Task5?.manifest ?? "");
  if (task5.criteriaHash !== pins.plan202Task5.criteriaHash || task5.criteria?.version !== pins.plan202Task5.criteriaVersion)
    fail("plan 202 Task 5 frozen criteria changed");

  if (JSON.stringify(value.partitions?.reads) !== JSON.stringify(["dev"])) fail("rules may read development partitions only");
  const { vocabulary, tiers, precedence } = value.verdicts ?? {};
  for (const verdict of vocabulary ?? []) if (!tiers?.[verdict]) fail(`verdict ${verdict} has no tier`);
  if (precedence?.[0] !== "negative" || value.rules?.negative?.verdict !== "remove") fail("negative must decide first and remove");
  if (tiers?.["owner-hold"] !== "experimental" || tiers?.inconclusive !== "experimental") fail("holds must route to the experimental tier");
  if (!value.rules?.ownerHold?.never?.includes("negative")) fail("an owner hold must never apply to a negative feature");
  if (value.rules?.fixKept?.secondTry !== false) fail("a missed fix gets no second try");
  if (value.rules?.keep?.anyOf?.benefit?.ciLowAbove !== 0) fail("keep needs a CI lower bound above 0");
  if (value.rules?.keep?.anyOf?.costOrLatency?.relativeReductionAtLeast !== 0.1) fail("cost role threshold must be 10%");
  if (value.rules?.remove?.nonInferior?.everySuiteCiLowAtLeastPoints !== -2) fail("removal margin must be 2 points");
  for (const feature of ["write.keyword-enrichment", "navigation.agentic-lexical"])
    if (!value.rules?.keep?.plan202Task5?.features?.includes(feature)) fail(`${feature} must carry the plan 202 Task 5 rules`);
  for (const shim of value.ownerNamedShims ?? [])
    if (!shim?.feature || !shim?.reason) fail("an owner-named shim needs a feature and a reason");

  const ledger = files.ledger ?? readRepoJson("docs/_evidence/memory-bench/210/feature-ledger.json");
  const candidates = new Set(ledger.candidates?.features ?? []);
  const rows = new Map((ledger.features ?? []).map((row) => [row.id, row]));
  const noPath = new Set(gap.predictions.filter((entry) => entry.verdict === "no-credible-path").map((entry) => entry.feature));
  const inert = value.inertRemoval?.features ?? [];
  const conditional = value.inertRemoval?.conditional?.features ?? [];
  for (const id of [...inert, ...conditional]) {
    if (!candidates.has(id)) fail(`${id} is not a ledger candidate`);
    if (!noPath.has(id)) fail(`${id} is not a no-credible-path row`);
    if (Object.values(rows.get(id)?.presets ?? {}).includes("member")) fail(`${id} is a preset member and needs a paid arm`);
  }
  const transferred = (value.transferred?.features ?? []).map((row) => row.feature);
  const knownRows = new Set(rows.keys());
  for (const row of value.transferred?.features ?? []) {
    if (!knownRows.has(row.feature)) fail(`transferred row ${row.feature} is not a ledger feature`);
    if (!Number.isInteger(row.plan) || typeof row.reason !== "string" || !row.reason.trim())
      fail(`transferred row ${row.feature} needs a destination plan and a reason`);
  }
  if (new Set(transferred).size !== transferred.length) fail("a feature is transferred twice");
  for (const id of transferred)
    if (inert.includes(id) || conditional.includes(id)) fail(`${id} is transferred and cannot also be an inert removal`);
  for (const id of noPath)
    if (!inert.includes(id) && !conditional.includes(id) && !transferred.includes(id))
      fail(`no-credible-path row ${id} has no removal route`);
  for (const override of value.ownerNegativeOverrides ?? [])
    if (!override?.feature || typeof override.reason !== "string" || !override.reason.trim() || !override.decided)
      fail("an owner negative override needs a feature, a date and a written reason");
  if (value.closure && value.closure.afterWave !== 1) fail("gate C-1 closed after wave 1");

  const legs = value.preRegistered ?? {};
  for (const [leg, id] of [
    ["f4DiagnosticLeg", "202-task17"],
    ["task13SharedEntity", "202-task13"],
  ]) {
    const deferred = gap.deferred?.find((entry) => entry.id === id);
    if (legs[leg]?.deferredId !== id || !deferred) fail(`${leg} does not name deferred lever ${id}`);
    if (deferred.protocol !== legs[leg].protocol || deferred.rule !== legs[leg].rule)
      fail(`${leg} protocol or rule drifted from gap analysis`);
    if (legs[leg].thresholdShare !== 0.05) fail(`${leg} threshold must be 5%`);
  }
  if (legs.f4DiagnosticLeg.heldOutTrigger !== false) fail("held-out data may not trigger the Task 17 build");
  const maintain = legs.maintainThenAnswer;
  if (!gap.predictions.some((entry) => entry.arm === maintain?.arm && entry.feature === maintain?.feature))
    fail("maintain-then-answer arm is not a Task 3 prediction");
  const weak = legs.weakHitsBelowFloor;
  if (weak?.status !== "recorded-not-built" || !candidates.has(weak.feature) || !weak.buildOnlyIf)
    fail("weak-hits variant must be recorded, not built");
  return cleanupCriteriaHash(value);
}

/** The hashes every plan 210 Task 5 manifest, report and decision record carries. */
export function cleanupManifestPin() {
  return { criteriaHash: robustnessCriteriaHash(), cleanupCriteriaHash: verifyCleanupCriteria() };
}

/** Manifest rule (as 188.10): a plan 210 manifest or report must carry the current cleanup criteria hash. */
export function assertCleanupCriteriaPin(manifest, expected = verifyCleanupCriteria()) {
  if (manifest?.cleanupCriteriaHash !== expected)
    throw new Error(
      `CleanupCriteria: manifest ${manifest?.cleanupCriteriaHash ? "pins a different" : "does not pin the"} cleanup criteria hash`,
    );
  if (manifest.criteriaHash !== undefined && manifest.criteriaHash !== robustnessCriteriaHash())
    throw new Error("CleanupCriteria: manifest pins different robustness criteria");
  return manifest;
}

/**
 * Applies the pre-registered rules to one candidate's evidence. Every field is optional; a missing
 * measurement never counts as a pass. Points are percentage points; `answerModels` holds one entry per
 * answer model so "some model above 0, none negative" and "non-inferior on every model" are checked.
 *
 * evidence: { feature, status, safetyFailure, abilities: [{ ciHigh }], benefit: [{ ciLow }], plan202Task5Pass,
 *   cost: { relativeReduction, accuracyCiLow }, fix: { real, measured, directionMet, ciLow } | null,
 *   removal: { inert, byteIdentical, suites: [{ ciLow }], workOutcomeNonInferior } | null,
 *   ownerHold: { reason } | null }
 * `plan202Task5Pass` matters only for the features `rules.keep.plan202Task5` names: without a pass of the
 * pinned Task 5 rules they cannot be kept on benefit.
 */
export function cleanupVerdict(evidence, value = CLEANUP_CRITERIA) {
  const rules = value.rules;
  const result = (verdict, reason) => ({ feature: evidence.feature, verdict, tier: value.verdicts.tiers[verdict], reason });
  // An owner override waives only the per-ability CI trigger; a ledger `negative` or a safety failure still removes.
  const waived = (value.ownerNegativeOverrides ?? []).some((item) => item.feature === evidence.feature && item.reason);
  const negative =
    evidence.status === "negative" ||
    evidence.safetyFailure === true ||
    (!waived && (evidence.abilities ?? []).some((ability) => typeof ability.ciHigh === "number" && ability.ciHigh < 0));
  if (negative) return result("remove", "negative");

  const fix = evidence.fix;
  if (fix?.real && fix.measured && fix.directionMet && typeof fix.ciLow === "number" && fix.ciLow > rules.fixKept.ciLowAbove)
    return result("fix-kept", "fix met its prediction");

  const keep = rules.keep.anyOf;
  const benefits = evidence.benefit ?? [];
  const task5Miss = rules.keep.plan202Task5.features.includes(evidence.feature) && evidence.plan202Task5Pass !== true;
  if (!task5Miss && (evidence.status === "benefit" || benefits.some((model) => model.ciLow > keep.benefit.ciLowAbove)))
    return result("keep", "benefit");
  if (evidence.status === keep.safetyProven.status) return result("keep", "safety-proven");
  const cost = evidence.cost;
  if (
    cost &&
    cost.relativeReduction >= keep.costOrLatency.relativeReductionAtLeast &&
    typeof cost.accuracyCiLow === "number" &&
    cost.accuracyCiLow >= -keep.costOrLatency.andNonInferiorPoints
  )
    return result("keep", "cost or latency");
  if ((value.ownerNamedShims ?? []).some((shim) => shim.feature === evidence.feature && shim.reason))
    return result("keep", "owner-named shim");

  const removal = evidence.removal;
  const margin = rules.remove.nonInferior.everySuiteCiLowAtLeastPoints;
  const nonInferior =
    removal &&
    ((removal.inert && removal.byteIdentical === true) ||
      (removal.suites?.length > 0 &&
        removal.suites.every((suite) => typeof suite.ciLow === "number" && suite.ciLow >= margin) &&
        removal.workOutcomeNonInferior === true));
  const verdict = nonInferior ? "remove" : "inconclusive";
  if (evidence.ownerHold) {
    if (!rules.ownerHold.appliesTo.includes(verdict)) throw new Error(`CleanupCriteria: owner hold does not apply to ${verdict}`);
    if (typeof evidence.ownerHold.reason !== "string" || !evidence.ownerHold.reason.trim())
      throw new Error(`CleanupCriteria: owner hold on ${evidence.feature} needs a written reason`);
    return result("owner-hold", evidence.ownerHold.reason);
  }
  return result(verdict, nonInferior ? "removal non-inferior" : "removal not shown non-inferior");
}

export const MEMORY_MODEL_CRITERIA = Object.freeze(memoryModel);
export const MEMORY_MODEL_CRITERIA_RECORD = "docs/_evidence/memory-bench/memory-model/criteria.json";
export const MEMORY_MODEL_ROW_IDS = Object.freeze(
  [
    ["S", 4],
    ["M", 5],
    ["R", 6],
    ["T", 8],
    ["L", 4],
    ["Z", 4],
  ].flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`)),
);
const MEMORY_MODEL_QA_ROWS = ["S3", "M5", "R5", "R6", "T7", "L4", "Z1"];
const MEMORY_MODEL_RETRIEVAL_SETS = ["paraphrase", "non-english", "parity", "abstention"];
const MEMORY_MODEL_ACCEPTANCE_FILES = [
  "robustness-criteria.json",
  "three-tier-criteria.json",
  "work-outcome-criteria.json",
  "memory-model-criteria.json",
];

/** Plan 216 Task 2: the same canonical hash, over the pre-registered memory-model criteria. */
export function memoryModelCriteriaHash(value = MEMORY_MODEL_CRITERIA) {
  return robustnessCriteriaHash(value);
}

/**
 * Checks the memory-model criteria: the criteria hashes they pin (202, 208, 209), plan 210's slimmed
 * product hash for `P`, that every row names metric, unit, direction, arms, scope, tests and a gate that
 * lists it, the QA rows' evidence-coverage rule, the retrieval-set rules, R1's power, and the four hashes
 * gate A pins. Returns the hash, throws on any mismatch. `files.slimmed` substitutes plan 210's record.
 */
export function verifyMemoryModelCriteria(value = MEMORY_MODEL_CRITERIA, files = {}) {
  const fail = (message) => {
    throw new Error(`MemoryModelCriteria: ${message}`);
  };
  if (value.schemaVersion !== 1 || value.plan !== 216 || value.task !== 2 || typeof value.frozen !== "string")
    fail("schema, plan, task or frozen date is wrong");
  if (!value.hashRule || !value.ownerDecisions) fail("hashRule and ownerDecisions are required");
  const pins = value.pins ?? {};
  const current = {
    "robustness-criteria.json": robustnessCriteriaHash(),
    "three-tier-criteria.json": verifyThreeTierCriteria(),
    "work-outcome-criteria.json": robustnessCriteriaHash(workOutcome),
  };
  if (pins.robustnessCriteriaHash !== current["robustness-criteria.json"]) fail("plan 202 robustness criteria changed");
  if (pins.threeTierCriteriaHash !== current["three-tier-criteria.json"]) fail("plan 208 three-tier criteria changed");
  if (pins.workOutcomeCriteriaHash !== current["work-outcome-criteria.json"]) fail("plan 209 work-outcome criteria changed");

  const partitions = value.partitions ?? {};
  if (JSON.stringify(partitions.development) !== JSON.stringify(["dev"])) fail("development gates read development partitions only");
  const acceptance = partitions.acceptance ?? {};
  if (
    JSON.stringify(acceptance.reads) !== JSON.stringify(["heldout-a"]) ||
    acceptance.remediation !== "heldout-b" ||
    acceptance.remediationRounds !== 1
  )
    fail("gate A reads heldout-a, with one remediation round on heldout-b");
  const stats = value.statistics ?? {};
  if (stats.nonInferiorPoints !== 2 || stats.gainCiLowAbove !== 0) fail("non-inferiority is 2 points and a gain needs CI low > 0");

  const kinds = new Set(Object.keys(value.testKinds ?? {}));
  const gates = value.gates ?? {};
  const rows = value.rows ?? {};
  if (JSON.stringify(Object.keys(rows).sort()) !== JSON.stringify([...MEMORY_MODEL_ROW_IDS].sort()))
    fail(`rows must be exactly ${MEMORY_MODEL_ROW_IDS.join(", ")}`);
  for (const [id, row] of Object.entries(rows)) {
    for (const field of ["gate", "component", "metric", "unit", "direction"])
      if (typeof row[field] !== "string" || !row[field].trim()) fail(`row ${id} has no ${field}`);
    if (!gates[row.gate]?.rows?.includes(id)) fail(`row ${id} names gate ${row.gate}, which does not list it`);
    if (typeof row.arms?.candidate !== "string") fail(`row ${id} names no candidate arm`);
    if (!row.scope || !Object.keys(row.scope).length) fail(`row ${id} names no suite, fixture or scope`);
    if (!Array.isArray(row.tests) || !row.tests.length) fail(`row ${id} has no threshold`);
    for (const test of row.tests) {
      if (!test.id || !kinds.has(test.kind)) fail(`row ${id} has a test with an unknown kind ${test.kind}`);
      if (test.vs !== undefined && !row.arms.vs?.includes(test.vs))
        fail(`row ${id} compares with ${test.vs}, which is not one of its arms`);
      if (["exact", "atMost", "atLeast", "atMostOrJustified"].includes(test.kind) && test.value === undefined)
        fail(`row ${id} test ${test.id} has no value`);
      if (test.kind === "anyGainNoneRegress" && !test.metrics?.length) fail(`row ${id} test ${test.id} names no metrics`);
    }
  }
  for (const [gate, entry] of Object.entries(gates)) {
    if (gate === "rule" || gate === "K-1") continue;
    for (const id of entry.rows ?? []) if (!rows[id]) fail(`gate ${gate} lists unknown row ${id}`);
    if (gate !== "A" && entry.rows.some((id) => rows[id].gate !== gate)) fail(`gate ${gate} lists a row of another gate`);
    // Plan 217 Task 6: a gate may defer one of its rows to a later gate that reads the same row, by an owner decision.
    for (const [id, deferral] of Object.entries(entry.deferred ?? {})) {
      if (!entry.rows.includes(id)) fail(`gate ${gate} defers ${id}, which it does not list`);
      if (!gates[deferral?.to]?.rows?.includes(id)) fail(`gate ${gate} defers ${id} to ${deferral?.to}, which does not read it`);
      if (!value.ownerDecisions?.[deferral.decision]?.decision) fail(`gate ${gate} defers ${id} without an owner decision`);
    }
  }
  for (const gate of ["M-1", "M-2", "M-3", "M-T", "M-4", "M-5", "K-1", "A"]) {
    if (!gates[gate]) fail(`gate ${gate} is missing`);
    if (!/^docs\/_evidence\/memory-bench\/[0-9.]+\/gates\/owner-gate-[a-z0-9]+\.json$/.test(gates[gate].record ?? ""))
      fail(`gate ${gate} names no owner-gate record`);
  }
  if (!gates.rule?.includes("owner's word")) fail("each gate must start only on the owner's word");

  if (JSON.stringify(value.qaRows) !== JSON.stringify(MEMORY_MODEL_QA_ROWS)) fail(`QA rows must be ${MEMORY_MODEL_QA_ROWS.join(", ")}`);
  if (value.evidenceCoverage?.metric !== "all-required evidence coverage per ability") fail("QA rows must report evidence coverage");

  const r1 = rows.R1.tests[0];
  if (r1.kind !== "atLeast" || !(r1.value > 0) || !Number.isSafeInteger(r1.minWrites))
    fail("R1 needs a share threshold and a minimum write count");
  if (minDetectableDifference({ n: r1.minWrites, discordance: r1.value }) > r1.value) fail("R1 minWrites cannot detect the threshold");
  if (r1.minWrites > 2 && minDetectableDifference({ n: r1.minWrites - 1, discordance: r1.value }) <= r1.value)
    fail("R1 minWrites is not the smallest powered count");

  const sets = value.retrievalSets ?? {};
  for (const name of MEMORY_MODEL_RETRIEVAL_SETS) {
    if (typeof sets.rules?.[name] !== "string" || !sets.rules[name].trim()) fail(`retrieval set ${name} has no construction rule`);
    if (!(name in (sets.hashes ?? {}))) fail(`retrieval set ${name} has no hash slot`);
  }
  if (sets.thresholdFit?.set !== "abstention" || sets.thresholdFit.falseAbstentionWeight !== 2 || !sets.thresholdFit.rule)
    fail("the threshold-fit rule must be pinned");
  const amendments = value.amendments ?? [];
  for (const amendment of amendments)
    if (!/^[0-9a-f]{64}$/.test(amendment?.previousHash ?? "") || !amendment.date || !amendment.reason)
      fail("an amendment needs a previousHash, a date and a reason");
  const filled = Object.values(sets.hashes ?? {}).some((hash) => hash !== null) || sets.thresholds !== null;
  if (filled && !amendments.length) fail("retrieval-set hashes and thresholds are added only by an amendment");
  const index = value.fixtures?.index ?? [];
  const fixtureIds = new Set(index.map((entry) => entry.id));
  if (fixtureIds.size !== index.length) fail("a fixture is listed twice");
  for (const entry of index) if (!entry.plan || !entry.spec) fail(`fixture ${entry.id} needs an owner plan and a spec`);
  // Plan 217 Task 6: a fixture's hash is added by an amendment (fixtures.rule), as a sha256 of the file it names.
  for (const entry of index)
    if (entry.hash !== null && entry.hash !== undefined && (!/^[0-9a-f]{64}$/.test(entry.hash) || !entry.hashOf))
      fail(`fixture ${entry.id} needs a sha256 hash and the file it hashes`);
  if (index.some((entry) => entry.hash) && !amendments.length) fail("fixture hashes are added only by an amendment");
  for (const name of MEMORY_MODEL_RETRIEVAL_SETS) if (!fixtureIds.has(name)) fail(`retrieval set ${name} is not in the fixture index`);
  for (const [id, row] of Object.entries(rows))
    for (const fixture of row.scope.fixtures ?? []) if (!fixtureIds.has(fixture)) fail(`row ${id} reads unindexed fixture ${fixture}`);

  const wiki = value.wiki ?? {};
  if (wiki.criteriaFile !== "scripts/memory-bench/three-tier-criteria.json" || wiki.criteriaHash !== current["three-tier-criteria.json"])
    fail("the wiki rows must reference three-tier-criteria.json by its current hash");
  if (wiki.armMapping?.["P+O"] !== "ltm+wiki") fail("P+O must map to ltm+wiki");
  if ("criteria" in wiki || "O1" in rows) fail("the wiki rows are referenced, never copied");

  const pinned = value.acceptance?.pinsCriteria ?? {};
  if (JSON.stringify(Object.keys(pinned).sort()) !== JSON.stringify([...MEMORY_MODEL_ACCEPTANCE_FILES].sort()))
    fail(`gate A must pin exactly ${MEMORY_MODEL_ACCEPTANCE_FILES.join(", ")}`);
  for (const file of MEMORY_MODEL_ACCEPTANCE_FILES.slice(0, 3)) if (pinned[file] !== current[file]) fail(`gate A pins a stale ${file}`);

  const baselines = value.baselines ?? {};
  const slimmed = files.slimmed ?? readRepoJson(baselines.P?.record ?? "");
  if (slimmed.kind !== "210-slimmed-product-record" || baselines.P.productHash !== slimmed.productHash)
    fail("P must be plan 210's recorded slimmed product");
  if (baselines.omBefore?.config !== "om" || !baselines.omBefore.revisionRule?.includes("plan 216 Task 4"))
    fail("OM-before must be the om config pinned at plan 216 Task 4");
  return memoryModelCriteriaHash(value);
}

/**
 * Plan 217 Task 6: a gate reads a fixture only when the criteria pin its hash and the file still hashes to it. Returns
 * the hash; an unhashed or drifted fixture is refused.
 */
export function assertMemoryModelFixture(id, { value = MEMORY_MODEL_CRITERIA, root = REPO_ROOT } = {}) {
  const entry = (value.fixtures?.index ?? []).find((row) => row.id === id);
  if (!entry) throw new Error(`MemoryModelCriteria: no fixture ${id}`);
  if (!entry.hash)
    throw new Error(`MemoryModelCriteria: fixture ${id} has no hash yet (fixtures.rule: an amendment adds it before the gate)`);
  const actual = createHash("sha256")
    .update(readFileSync(new URL(entry.hashOf, root)))
    .digest("hex");
  if (actual !== entry.hash) throw new Error(`MemoryModelCriteria: fixture ${id} (${entry.hashOf}) does not hash to its pinned value`);
  return entry.hash;
}

/** The frozen hash, read from the evidence record; the current file must hash to it. */
export function frozenMemoryModelHash(record = readRepoJson(MEMORY_MODEL_CRITERIA_RECORD), value = MEMORY_MODEL_CRITERIA) {
  const hash = verifyMemoryModelCriteria(value);
  if (record?.memoryModelCriteriaHash !== hash)
    throw new Error("MemoryModelCriteria: memory-model-criteria.json changed without a new recorded hash (add an amendment)");
  return hash;
}

/**
 * Plan 218 Task 5: every hash the criteria record's amendment log has held, oldest first, ending with the current one.
 * Amendments change no row, threshold or partition rule, so a record pinning one of them still reads these criteria.
 */
export function memoryModelCriteriaHashes(record = readRepoJson(MEMORY_MODEL_CRITERIA_RECORD)) {
  const hashes = [];
  for (const amendment of record?.amendments ?? [])
    for (const hash of [amendment.previousHash, amendment.hash]) if (hash && !hashes.includes(hash)) hashes.push(hash);
  if (record?.memoryModelCriteriaHash && !hashes.includes(record.memoryModelCriteriaHash)) hashes.push(record.memoryModelCriteriaHash);
  return hashes;
}

/**
 * Plan 218 Task 5: the criteria hash a closed gate's records read. A gate the owner closed (`closed` on its owner-gate
 * record) keeps the hash it ran on when a later amendment moves the current one; that hash must be in the amendment
 * log. An open gate gets `null` and reads the current hash.
 */
export function closedGateCriteriaHash(gateRecord, record = readRepoJson(MEMORY_MODEL_CRITERIA_RECORD)) {
  if (!gateRecord?.closed) return null;
  if (gateRecord.closed.by !== "owner" || !gateRecord.closed.at)
    throw new Error(`MemoryModelCriteria: gate ${gateRecord.gate} is closed without the owner's date`);
  if (!memoryModelCriteriaHashes(record).includes(gateRecord.memoryModelCriteriaHash))
    throw new Error(`MemoryModelCriteria: closed gate ${gateRecord.gate} pins a criteria hash the amendment log never held`);
  return gateRecord.memoryModelCriteriaHash;
}

/** The hashes every memory-model manifest, evidence file and report carries. */
export function memoryModelManifestPin({ gate } = {}) {
  const pin = { criteriaHash: robustnessCriteriaHash(), memoryModelCriteriaHash: frozenMemoryModelHash() };
  if (gate !== "A") return pin;
  return {
    ...pin,
    criteriaPins: {
      "robustness-criteria.json": robustnessCriteriaHash(),
      "three-tier-criteria.json": verifyThreeTierCriteria(),
      "work-outcome-criteria.json": robustnessCriteriaHash(workOutcome),
      "memory-model-criteria.json": pin.memoryModelCriteriaHash,
    },
  };
}

/**
 * Manifest rule (as 188.10): a memory-model manifest, evidence file or report must carry the frozen
 * criteria hash; a gate A manifest must also pin all four criteria files.
 */
export function assertMemoryModelPin(manifest, expected = frozenMemoryModelHash()) {
  if (manifest?.memoryModelCriteriaHash !== expected)
    throw new Error(
      `MemoryModelCriteria: manifest ${manifest?.memoryModelCriteriaHash ? "pins a different" : "does not pin the"} memory-model criteria hash`,
    );
  if (manifest.criteriaHash !== undefined && manifest.criteriaHash !== robustnessCriteriaHash())
    throw new Error("MemoryModelCriteria: manifest pins different robustness criteria");
  if (manifest.gate === "A") {
    const want = { ...memoryModelManifestPin({ gate: "A" }).criteriaPins, "memory-model-criteria.json": expected };
    for (const file of MEMORY_MODEL_ACCEPTANCE_FILES)
      if (manifest.criteriaPins?.[file] !== want[file])
        throw new Error(
          `MemoryModelCriteria: gate A manifest ${manifest.criteriaPins?.[file] ? "pins a different" : "does not pin"} ${file}`,
        );
  }
  return manifest;
}

/**
 * Checks the baselines record against the criteria: `P` is plan 210's slimmed product; `OM-before` is
 * either still unpinned (allowed only while plan 216 Task 4 has not started) or a commit `resolve` finds.
 */
export function verifyMemoryModelBaselines(record, { task4Started = false, resolve = () => false, value = MEMORY_MODEL_CRITERIA } = {}) {
  const fail = (message) => {
    throw new Error(`MemoryModelBaselines: ${message}`);
  };
  if (record?.kind !== "memory-model-baselines" || record.memoryModelCriteriaHash !== memoryModelCriteriaHash(value))
    fail("the record must pin the memory-model criteria hash");
  if (record.P?.productHash !== value.baselines.P.productHash) fail("P is not plan 210's slimmed product");
  const om = record.omBefore ?? {};
  if (om.revision === null) {
    if (task4Started) fail("OM-before must be pinned once plan 216 Task 4 starts");
    return { P: record.P.productHash, omBefore: null };
  }
  if (!/^[0-9a-f]{40}$/.test(om.revision ?? "") || !resolve(om.revision)) fail("OM-before revision does not resolve to a commit");
  if (!/^[0-9a-f]{64}$/.test(om.productHash ?? "")) fail("OM-before needs the observational product hash");
  return { P: record.P.productHash, omBefore: om.revision };
}

const ciModels = (entry) => (Array.isArray(entry?.models) && entry.models.length ? entry.models : null);
function gainOf(entry, stats) {
  const models = ciModels(entry);
  if (!models || models.some((model) => typeof model.ciLow !== "number" || typeof model.ciHigh !== "number")) return null;
  return models.some((model) => model.ciLow > stats.gainCiLowAbove) && models.every((model) => model.ciHigh >= 0);
}
function nonInferiorOf(entry, stats) {
  const models = ciModels(entry);
  if (!models || models.some((model) => typeof model.ciLow !== "number")) return null;
  return models.every((model) => model.ciLow >= -stats.nonInferiorPoints);
}
const measured = (entry) => (entry && (typeof entry.value === "number" || typeof entry.value === "string") ? entry.value : null);

function memoryModelTest(test, entry, stats) {
  if (entry === undefined || entry === null) return null;
  if (test.requiresPanelCalibrated && entry.panelCalibrated !== true) return null;
  switch (test.kind) {
    case "gain":
      return gainOf(entry, stats);
    case "nonInferior":
      return nonInferiorOf(entry, stats);
    case "pooledGainNoAbilityBelow": {
      const pooled = gainOf(entry.pooled, stats);
      const abilities = entry.abilities;
      if (pooled === null || !Array.isArray(abilities) || !abilities.length || abilities.some((row) => typeof row.estimate !== "number"))
        return null;
      return pooled && abilities.every((row) => row.estimate >= -test.points);
    }
    case "anyGainNoneRegress": {
      const metrics = entry.metrics ?? {};
      if (test.metrics.some((name) => !metrics[name])) return null;
      const all = Object.values(metrics).map((metric) => nonInferiorOf(metric, stats));
      const gains = test.metrics.map((name) => gainOf(metrics[name], stats));
      if (all.includes(null) || gains.includes(null)) return null;
      return all.every(Boolean) && gains.some(Boolean);
    }
    case "exact":
      return measured(entry) === null ? null : measured(entry) === test.value;
    case "atMost":
      return typeof entry.value !== "number" ? null : entry.value <= test.value;
    case "atLeast":
      if (typeof entry.value !== "number") return null;
      if (test.minWrites !== undefined && !(entry.writes >= test.minWrites)) return null;
      return entry.value >= test.value;
    case "atMostOrJustified":
      if (typeof entry.value !== "number") return null;
      return entry.value <= test.value || (typeof entry.justification === "string" && entry.justification.trim().length > 0);
    case "atMostTargetPlus":
      return typeof entry.value !== "number" || typeof entry.target !== "number" ? null : entry.value - entry.target <= test.margin + 1e-9;
    case "withinBudget":
      return typeof entry.value !== "number" || typeof entry.budget !== "number" ? null : entry.value <= entry.budget;
    case "pass":
      return typeof entry.pass === "boolean" ? entry.pass : null;
    default:
      throw new Error(`MemoryModelCriteria: unknown test kind ${test.kind}`);
  }
}

/**
 * Applies one pre-registered row to its evidence. `evidence.tests[<test id>]` holds each test's measurement;
 * a QA row also needs `evidence.coverage` (all-required evidence coverage per ability, beside accuracy).
 * Status is `pass`, `miss` (some test failed) or `missing` (a measurement is absent; never a pass).
 */
export function memoryModelVerdict(rowId, evidence, value = MEMORY_MODEL_CRITERIA) {
  const row = value.rows[rowId];
  if (!row) throw new Error(`MemoryModelCriteria: unknown row ${rowId}`);
  const tests = row.tests.map((test) => ({ id: test.id, pass: memoryModelTest(test, evidence?.tests?.[test.id], value.statistics) }));
  const qa = value.qaRows.includes(rowId);
  const coverage = evidence?.coverage;
  const coverageReported =
    !qa ||
    (coverage &&
      typeof coverage === "object" &&
      Object.values(coverage).length > 0 &&
      Object.values(coverage).every((v) => typeof v === "number"));
  if (qa) tests.push({ id: "evidence-coverage", pass: coverageReported ? true : null });
  const status = tests.some((test) => test.pass === false) ? "miss" : tests.some((test) => test.pass === null) ? "missing" : "pass";
  return { row: rowId, gate: row.gate, status, tests };
}

/**
 * One gate's verdicts from a pinned evidence file: `{ memoryModelCriteriaHash, gate, partition, rows: { <row>: evidence } }`.
 * Development gates read `dev` only; gate A reads `heldout-a` (or `heldout-b` for its one remediation round).
 */
export function memoryModelGateVerdict(gate, evidence, { value = MEMORY_MODEL_CRITERIA, expected, partition: requested } = {}) {
  const entry = value.gates[gate];
  if (!entry || gate === "rule") throw new Error(`MemoryModelCriteria: unknown gate ${gate}`);
  if (gate === "K-1")
    throw new Error("MemoryModelCriteria: gate K-1 is plan 208's criteria; run acceptance-report.mjs --plan 208 --gate K-1");
  expected ??= frozenMemoryModelHash(undefined, value);
  if (evidence && requested && evidence.partition !== requested)
    throw new Error(`MemoryModelCriteria: evidence is for partition ${evidence.partition}, not ${requested}`);
  const partition = evidence ? evidence.partition : (requested ?? (gate === "A" ? "heldout-a" : "dev"));
  const allowed = gate === "A" ? ["heldout-a", value.partitions.acceptance.remediation] : value.partitions.development;
  if (!allowed.includes(partition)) throw new Error(`MemoryModelCriteria: gate ${gate} may not read ${partition}`);
  if (evidence) {
    assertMemoryModelPin({ ...evidence, gate }, expected);
    if (evidence.gate !== gate) throw new Error(`MemoryModelCriteria: evidence is for gate ${evidence.gate}, not ${gate}`);
  }
  // A deferred row (an owner decision) is reported `deferred` with the gate that reads it, and the gate is decided
  // by its other rows; the later gate still holds the row.
  const deferred = entry.deferred ?? {};
  const rows = entry.rows.map((id) =>
    deferred[id]
      ? { row: id, gate, status: "deferred", to: deferred[id].to, decision: deferred[id].decision, tests: [] }
      : memoryModelVerdict(id, evidence?.rows?.[id], value),
  );
  const decided = rows.filter((row) => row.status !== "deferred");
  const status = !evidence
    ? "pending"
    : decided.some((row) => row.status === "miss")
      ? "miss"
      : decided.every((row) => row.status === "pass")
        ? "pass"
        : "missing";
  return { gate, plan: entry.plan, partition, memoryModelCriteriaHash: expected, status, rows };
}

/** Hash of the ids a draw holds, so a committed draw can be re-derived and compared. */
export function robustnessIdsHash(abilities) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          ROBUSTNESS_PARTITIONS.map((partition) => [
            partition,
            Object.fromEntries(
              Object.keys(abilities[partition] ?? {})
                .sort()
                .map((ability) => [ability, abilities[partition][ability]]),
            ),
          ]),
        ),
      ),
    )
    .digest("hex");
}

/**
 * Stratum sizes: `[dev, heldout-a, heldout-b]` per ability. Every ability gets items in both
 * held-out partitions, including abstention and preference. Sizes are frozen in the draw files.
 */
export const ROBUSTNESS_STRATA = {
  "longmemeval-m": {
    "multi-session": [12, 6, 6],
    "knowledge-update": [8, 4, 4],
    "temporal-reasoning": [8, 4, 4],
    "single-session-user": [6, 3, 3],
    "single-session-assistant": [4, 2, 2],
    "single-session-preference": [4, 2, 2],
    abstention: [8, 4, 4],
  },
  "beam-100k": {
    abstention: [4, 2, 2],
    contradiction_resolution: [4, 2, 2],
    event_ordering: [4, 2, 2],
    information_extraction: [4, 2, 2],
    instruction_following: [4, 2, 2],
    knowledge_update: [4, 2, 2],
    multi_session_reasoning: [4, 2, 2],
    preference_following: [4, 2, 2],
    summarization: [4, 2, 2],
    temporal_reasoning: [4, 2, 2],
  },
  locomo: {
    "multi-hop": [12, 6, 6],
    temporal: [12, 6, 6],
    "open-domain": [12, 6, 6],
    "single-hop": [12, 6, 6],
    adversarial: [12, 6, 6],
  },
  "memoryagentbench-cr": {
    "conflict-resolution-single-hop": [10, 5, 5],
    "conflict-resolution-multi-hop": [10, 5, 5],
  },
  memorycode: {
    "instruction-add": [40, 20, 20],
    "instruction-update": [40, 20, 20],
  },
  "coding-longitudinal": {
    "coding-lifecycle": [4, 4, 4],
  },
  vibemembench: {
    coding: [30, 15, 15],
  },
  "dreambench-swe": {
    C2: [2, 1, 1],
    C3: [2, 1, 1],
    C5: [2, 1, 1],
    C6: [1, 1, 1],
    C7: [1, 1, 1],
    C9: [1, 1, 1],
  },
};

// BEAM tracks are the same generator at different scales; 500K/1M reuse 100K's strata.
ROBUSTNESS_STRATA["beam-500k"] = ROBUSTNESS_STRATA["beam-100k"];
ROBUSTNESS_STRATA["beam-1m"] = ROBUSTNESS_STRATA["beam-100k"];
Object.freeze(ROBUSTNESS_STRATA);

/**
 * LongMemEval-M is drawn from the pinned S ids (same questions, larger haystack). This check runs
 * whenever the 2.7 GB M file is cached, so a divergence is caught before a paid campaign, not after.
 */
export function verifyLongMemEvalMItems(items, draw) {
  const abilityOf = new Map(items.map((item) => [String(item.id), item.ability]));
  const ids = ROBUSTNESS_PARTITIONS.flatMap((partition) => Object.values(draw.abilities[partition]).flat());
  const missing = ids.filter((id) => !abilityOf.has(id));
  if (missing.length) throw new Error(`LongMemEval-M draw ids missing from the dataset: ${missing.slice(0, 5).join(", ")}`);
  for (const partition of ROBUSTNESS_PARTITIONS) {
    for (const [ability, partitionIds] of Object.entries(draw.abilities[partition])) {
      const wrong = partitionIds.filter((id) => abilityOf.get(id) !== ability);
      if (wrong.length) throw new Error(`LongMemEval-M ability mismatch for ${wrong[0]} (${ability})`);
    }
  }
}

/**
 * Draw three disjoint, stratified partitions from id/ability metadata only. Throws when a stratum
 * is short, duplicated or unknown: a suite whose generator changed needs a deliberate re-draw.
 */
export function drawRobustnessPartitions(items, suite, { seed = `prism-202-memory-bench-${suite}` } = {}) {
  const strata = ROBUSTNESS_STRATA[suite];
  if (!strata) throw new Error(`No robustness strata defined for ${suite}`);
  const hash = (id) => createHash("sha256").update(`${seed}:${id}`).digest("hex");
  const abilities = Object.fromEntries(ROBUSTNESS_PARTITIONS.map((partition) => [partition, {}]));
  const residualPool = {};
  for (const [ability, [devSize, heldoutASize, heldoutBSize]] of Object.entries(strata)) {
    const candidates = items.filter((item) => item.ability === ability).map((item) => String(item.id));
    const unique = [...new Set(candidates)];
    const needed = devSize + heldoutASize + heldoutBSize;
    if (unique.length < needed) throw new Error(`Robustness stratum is short: ${suite}/${ability} has ${unique.length} of ${needed}`);
    const ordered = unique.sort((a, b) => hash(a).localeCompare(hash(b)));
    abilities.dev[ability] = ordered.slice(0, devSize);
    abilities["heldout-a"][ability] = ordered.slice(devSize, devSize + heldoutASize);
    abilities["heldout-b"][ability] = ordered.slice(devSize + heldoutASize, needed);
    residualPool[ability] = unique.length - needed;
  }
  return { seed, abilities, residualPool, idsHash: robustnessIdsHash(abilities) };
}

if (import.meta.main) {
  const flag = process.argv.indexOf("--verify-criteria");
  if (flag >= 0) {
    const file = process.argv[flag + 1];
    const verifiers = {
      "three-tier-criteria.json": () => ({ threeTierCriteriaHash: verifyThreeTierCriteria() }),
      "cleanup-criteria.json": () => ({ cleanupCriteriaHash: verifyCleanupCriteria() }),
      "memory-model-criteria.json": () => ({ memoryModelCriteriaHash: verifyMemoryModelCriteria() }),
    };
    if (!verifiers[file]) {
      console.error(
        "MemoryBenchArguments: --verify-criteria takes three-tier-criteria.json, cleanup-criteria.json or memory-model-criteria.json",
      );
      process.exit(2);
    }
    try {
      console.log(JSON.stringify({ file, ...verifiers[file]() }));
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
}
