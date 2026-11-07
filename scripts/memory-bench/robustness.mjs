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
  for (const id of noPath) if (!inert.includes(id) && !conditional.includes(id)) fail(`no-credible-path row ${id} has no removal route`);

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
  const negative =
    evidence.status === "negative" ||
    evidence.safetyFailure === true ||
    (evidence.abilities ?? []).some((ability) => typeof ability.ciHigh === "number" && ability.ciHigh < 0);
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
    };
    if (!verifiers[file]) {
      console.error("MemoryBenchArguments: --verify-criteria takes three-tier-criteria.json or cleanup-criteria.json");
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
